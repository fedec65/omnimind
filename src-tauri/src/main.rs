// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;

/// How often the supervisor polls the sidecar.
const SUPERVISE_INTERVAL: Duration = Duration::from_secs(2);
/// Uptime after which the crash backoff resets to its initial delay.
const UPTIME_RESET: Duration = Duration::from_secs(30);
/// Initial delay before respawning a dead sidecar (doubles up to UPTIME_RESET).
const INITIAL_BACKOFF: Duration = Duration::from_secs(1);

struct AppState {
    server: Mutex<Option<Child>>,
    api_base: Mutex<String>,
    /// Cleared when the sidecar is stopped on purpose (window closed), so the
    /// supervisor knows the death was intentional and does not respawn it.
    want_server: AtomicBool,
}

/// Returns the base URL for the Omnimind HTTP API.
/// Called by the frontend to discover the correct port.
#[tauri::command]
fn get_api_base(state: tauri::State<AppState>) -> String {
    state.api_base.lock().unwrap().clone()
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // Find an available port and start the Node.js sidecar
            let (server, api_base) = start_node_server(&handle);
            app.manage(AppState {
                server: Mutex::new(server),
                api_base: Mutex::new(api_base),
                want_server: AtomicBool::new(true),
            });

            // Keep the sidecar alive for the lifetime of the app. Without
            // this, a single crash (or OOM kill) leaves the GUI polling a
            // dead port forever — the "Starting backend…" spinner that never
            // resolves.
            spawn_supervisor(handle);

            Ok(())
        })
        .on_window_event(|_app, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Kill Node.js server on window close
                stop_server(_app.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![get_api_base])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            // WindowEvent::Destroyed covers window-close, but on macOS Cmd+Q
            // can terminate the app without ever firing it — without this,
            // the backend would outlive the GUI as an orphaned process.
            stop_server(app_handle);
        }
    });
}

/// Mark the sidecar as intentionally stopped and kill it. Shared by the
/// window-destroyed and app-exit paths.
fn stop_server(handle: &tauri::AppHandle) {
    if let Some(state) = handle.try_state::<AppState>() {
        // Flag the stop as intentional BEFORE killing so the supervisor
        // doesn't immediately respawn the child mid-shutdown.
        state.want_server.store(false, Ordering::SeqCst);
        if let Ok(mut child) = state.server.lock() {
            if let Some(mut c) = child.take() {
                let _ = c.kill();
            }
        }
    }
}

/// Find an available TCP port on localhost.
fn find_available_port() -> Option<u16> {
    let listener = TcpListener::bind("127.0.0.1:0").ok()?;
    let port = listener.local_addr().ok()?.port();
    drop(listener);
    Some(port)
}

fn start_node_server(handle: &tauri::AppHandle) -> (Option<Child>, String) {
    // Try bundled mode first (production build)
    if let Some((child, port)) = try_start_bundled_server(handle) {
        return (Some(child), format!("http://127.0.0.1:{}", port));
    }

    // Fallback to development mode (system node + project root dist/)
    if let Some((child, port)) = try_start_dev_server() {
        return (Some(child), format!("http://127.0.0.1:{}", port));
    }

    (None, String::new())
}

/// Watch the sidecar and restart it when it dies unexpectedly (crash, OOM
/// kill, external kill). The respawn delay doubles on every quick death —
/// capped at UPTIME_RESET — so a broken build can't spin the CPU, and resets
/// to INITIAL_BACKOFF once the child has stayed up for UPTIME_RESET.
/// Exits without respawning when the stop was intentional (window closed).
fn spawn_supervisor(handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut backoff = INITIAL_BACKOFF;
        let mut started_at = Instant::now();
        loop {
            std::thread::sleep(SUPERVISE_INTERVAL);

            let state = handle.state::<AppState>();
            if !state.want_server.load(Ordering::SeqCst) {
                return; // stopped on purpose — the app is shutting down
            }

            // Reap the child if it has exited.
            let needs_restart = {
                let mut child = state.server.lock().unwrap();
                match child.as_mut() {
                    Some(c) => match c.try_wait() {
                        Ok(None) => false, // still alive
                        Ok(Some(status)) => {
                            let uptime = started_at.elapsed();
                            eprintln!(
                                "[Tauri] Sidecar died unexpectedly (status: {status}, uptime: {uptime:?}) — restarting in {backoff:?}"
                            );
                            *child = None;
                            if uptime >= UPTIME_RESET {
                                backoff = INITIAL_BACKOFF;
                            }
                            true
                        }
                        Err(e) => {
                            eprintln!("[Tauri] Failed to poll sidecar: {e}");
                            false
                        }
                    },
                    // No child tracked: the initial start never succeeded —
                    // keep retrying at the backoff cadence.
                    None => {
                        eprintln!("[Tauri] Sidecar not running — trying to start it in {backoff:?}");
                        true
                    }
                }
            };

            if !needs_restart {
                continue;
            }

            std::thread::sleep(backoff);
            backoff = (backoff * 2).min(UPTIME_RESET);

            // The window may have been closed while we backed off.
            if !state.want_server.load(Ordering::SeqCst) {
                return;
            }

            restart_server(&handle);
            started_at = Instant::now();
        }
    });
}

/// Start (or restart) the sidecar and record it in AppState. The entire
/// spawn runs under the `server` mutex and re-checks `want_server` after
/// the fork: the Destroyed handler sets the flag *before* taking the same
/// mutex, so either shutdown ran first (we skip spawning entirely) or it is
/// blocked on us (we see the flag and kill the fresh child). A restart can
/// therefore never publish a child that shutdown will not clean up.
fn restart_server(handle: &tauri::AppHandle) {
    let state = handle.state::<AppState>();
    let mut guard = state.server.lock().unwrap();

    if !state.want_server.load(Ordering::SeqCst) {
        return; // shutdown already began — don't spawn at all
    }

    let (server, api_base) = start_node_server(handle);

    if !state.want_server.load(Ordering::SeqCst) {
        // The window was destroyed while we spawned — kill, don't leak.
        if let Some(mut child) = server {
            let _ = child.kill();
        }
        return;
    }

    if let Some(mut old) = guard.take() {
        let _ = old.kill();
    }
    *guard = server;
    drop(guard);

    {
        let mut base = state.api_base.lock().unwrap();
        *base = api_base;
    }
}

/// Rotate the sidecar log once it passes this size; one previous generation
/// (`gui-server.log.1`) is kept, bounding disk usage at ~2x this cap.
const LOG_ROTATE_SIZE: u64 = 5 * 1024 * 1024;

/// Redirect the sidecar's stdout/stderr to an append-mode log file under the
/// data dir. The previous `Stdio::piped()` buffers were never drained, so a
/// chatty server would eventually block on write (~64KB of pipe buffer) and
/// stop answering health checks while still looking alive. Past the rotation
/// cap the current log is moved aside (replacing the previous generation).
fn sidecar_log_stdio(data_dir: &Path) -> Stdio {
    let log_dir = data_dir.join("logs");
    let log_path = log_dir.join("gui-server.log");
    if let Ok(meta) = std::fs::metadata(&log_path) {
        if meta.len() > LOG_ROTATE_SIZE {
            let rotated = log_dir.join("gui-server.log.1");
            let _ = std::fs::remove_file(&rotated);
            let _ = std::fs::rename(&log_path, &rotated);
        }
    }
    match std::fs::create_dir_all(&log_dir)
        .and_then(|_| std::fs::OpenOptions::new().create(true).append(true).open(&log_path))
    {
        Ok(file) => Stdio::from(file),
        Err(e) => {
            eprintln!(
                "[Tauri] Cannot open sidecar log {:?} ({}); discarding sidecar output",
                log_path, e
            );
            Stdio::null()
        }
    }
}

/// Recursively copy a directory (std-only, no extra crates).
fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let target = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// The bundled .cache is read-only inside the installed app, so models that
/// download later (e.g. the optional 178MB NER model) cannot be stored
/// there. On first run, copy the bundled cache into the writable data dir
/// and point transformers.js at the copy. Falls back to the bundled cache
/// when the copy is not possible.
fn writable_transformers_cache(resource_dir: &Path, data_dir: &Path) -> PathBuf {
    let writable = data_dir.join(".cache");
    if writable.exists() {
        return writable;
    }
    let bundled = resource_dir.join(".cache");
    if bundled.exists() && copy_dir_recursive(&bundled, &writable).is_ok() {
        return writable;
    }
    bundled
}

fn try_start_bundled_server(handle: &tauri::AppHandle) -> Option<(Child, u16)> {
    let resource_dir = handle.path().resource_dir().ok()?;

    // Share the canonical data directory (~/.omnimind) with the MCP server
    // and CLI so the app, agents, and terminal all read/write one memory
    // store. Fall back to the app-private dir only if home is unavailable.
    let data_dir = match handle.path().home_dir() {
        Ok(home) => home.join(".omnimind"),
        Err(_) => handle.path().app_data_dir().ok()?,
    };

    // Platform-specific Node.js binary path
    let node_binary = if cfg!(target_os = "windows") {
        resource_dir.join("node/node.exe")
    } else {
        resource_dir.join("node/bin/node")
    };

    let server_script = resource_dir.join("dist/server.js");

    if !node_binary.exists() || !server_script.exists() {
        return None;
    }

    // Find an available port
    let port = find_available_port()?;

    // Ensure data directory exists
    let _ = std::fs::create_dir_all(&data_dir);

    let transformers_cache = writable_transformers_cache(&resource_dir, &data_dir);

    let child = Command::new(&node_binary)
        .arg(&server_script)
        .env("OMNIMIND_PORT", port.to_string())
        .env("OMNIMIND_DATA_DIR", &data_dir)
        .env("TRANSFORMERS_CACHE", &transformers_cache)
        .env("OMNIMIND_SKIP_ADAPTERS", "1")
        .stdout(sidecar_log_stdio(&data_dir))
        .stderr(sidecar_log_stdio(&data_dir))
        .spawn()
        .ok()?;

    println!(
        "[Tauri] Started bundled Node.js sidecar on port {} (PID: {})",
        port,
        child.id()
    );
    Some((child, port))
}

fn try_start_dev_server() -> Option<(Child, u16)> {
    let exe_path = std::env::current_exe().ok()?;
    let project_root = exe_path.parent()?.parent()?.parent()?;

    let server_script = project_root.join("dist/server.js");

    if !server_script.exists() {
        eprintln!("[Tauri] Server script not found: {:?}", server_script);
        return None;
    }

    let port = find_available_port()?;

    // Same canonical data dir as the bundled server, for its logs.
    let log_dir = std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".omnimind"));

    let child = Command::new("node")
        .arg(&server_script)
        .env("OMNIMIND_PORT", port.to_string())
        .env("OMNIMIND_SKIP_ADAPTERS", "1")
        .stdout(log_dir.as_deref().map(sidecar_log_stdio).unwrap_or_else(Stdio::null))
        .stderr(log_dir.as_deref().map(sidecar_log_stdio).unwrap_or_else(Stdio::null))
        .spawn()
        .ok()?;

    println!(
        "[Tauri] Started dev Node.js sidecar on port {} (PID: {})",
        port,
        child.id()
    );
    Some((child, port))
}
