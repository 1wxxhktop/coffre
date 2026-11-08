// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if coffre_lib::is_native_host_invocation() {
        if let Err(error) = coffre_lib::run_native_host() {
            eprintln!("Pont natif : {error}");
        }
        return;
    }
    coffre_lib::run();
}
