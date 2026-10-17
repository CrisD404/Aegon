// Sin consola en Windows al usar el binario de release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    aegon_desktop_lib::run()
}
