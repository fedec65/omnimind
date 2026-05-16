// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::Manager;

struct AppState {
    server: Mutex<Option<Child>>,
    api_base: Mutex<String>,
}

/// Returns the base URL for the Omnimind HTTP API.
/// Called by the frontend to discover the correct port.
#[tauri::command]
fn get_api_base(state: tauri::State<AppState>) -> String {
    state.api_base.lock().unwrap().clone()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // Find an available port and start the Node.js sidecar
            let (server, api_base) = start_node_server(&handle);
            app.manage(AppState {
                server: Mutex::new(server),
                api_base: Mutex::new(api_base),
            });

            Ok(())
        })
        .on_window_event(|_app, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Kill Node.js server on window close
                if let Some(state) = _app.try_state::<AppState>() {
                    if let Ok(mut child) = state.server.lock() {
                        if let Some(mut c) = child.take() {
                            let _ = c.kill();
                        }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![get_api_base])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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

fn try_start_bundled_server(handle: &tauri::AppHandle) -> Option<(Child, u16)> {
    let resource_dir = handle.path().resource_dir().ok()?;
    let app_data_dir = handle.path().app_data_dir().ok()?;

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
    let _ = std::fs::create_dir_all(&app_data_dir);

    let transformers_cache = resource_dir.join(".cache");

    let child = Command::new(&node_binary)
        .arg(&server_script)
        .env("OMNIMIND_PORT", port.to_string())
        .env("OMNIMIND_DATA_DIR", &app_data_dir)
        .env("TRANSFORMERS_CACHE", &transformers_cache)
        .env("OMNIMIND_SKIP_ADAPTERS", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
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

    let child = Command::new("node")
        .arg(&server_script)
        .env("OMNIMIND_PORT", port.to_string())
        .env("OMNIMIND_SKIP_ADAPTERS", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;

    println!(
        "[Tauri] Started dev Node.js sidecar on port {} (PID: {})",
        port,
        child.id()
    );
    Some((child, port))
}
