// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::Manager;

struct AppState {
    server: Mutex<Option<Child>>,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // Start Node.js sidecar
            let server = start_node_server(&handle);
            app.manage(AppState {
                server: Mutex::new(server),
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
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn start_node_server(_handle: &tauri::AppHandle) -> Option<Child> {
    // Determine the project root relative to the executable
    let exe_path = std::env::current_exe().ok()?;
    let project_root = exe_path
        .parent()?
        .parent()?
        .parent()?;

    let server_script = project_root.join("dist/server.js");

    if !server_script.exists() {
        eprintln!("[Tauri] Server script not found: {:?}", server_script);
        return None;
    }

    let child = Command::new("node")
        .arg(&server_script)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;

    println!("[Tauri] Started Node.js sidecar (PID: {})", child.id());
    Some(child)
}
