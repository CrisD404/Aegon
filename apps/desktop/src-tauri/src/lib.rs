//! Backend de la app de escritorio de Aegon.
//!
//! La UI es la misma app web; desde acá solo se exponen tres cosas que el navegador no puede:
//! leer/escribir la carpeta del workspace, ejecutar el `git` del sistema (con las credenciales
//! y la configuración del usuario) y avisar cuando algo cambia en el disco.

use std::collections::HashMap;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

/// Carpetas que nunca se leen ni se observan.
const IGNORED_DIRS: &[&str] = &[".git", "node_modules", ".aegon", "dist", "target"];
/// Extensiones de los archivos de un workspace (todos de texto).
const TEXT_EXT: &[&str] = &["yaml", "yml", "md", "svg", "json", "txt"];

/// Une una ruta relativa a la raíz rechazando rutas absolutas o que salgan de ella (`..`).
pub fn safe_join(root: &str, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    let escapes = rel_path
        .components()
        .any(|c| matches!(c, Component::ParentDir | Component::Prefix(_) | Component::RootDir));
    if rel.is_empty() || rel_path.is_absolute() || escapes {
        return Err(format!("Ruta inválida: {rel}"));
    }
    Ok(Path::new(root).join(rel_path))
}

fn is_workspace_file(name: &str) -> bool {
    if name == ".gitignore" || name == ".gitattributes" {
        return true;
    }
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| TEXT_EXT.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let Ok(kind) = entry.file_type() else { continue };
        let path = entry.path();
        if kind.is_dir() {
            if !IGNORED_DIRS.contains(&name.as_str()) {
                walk(root, &path, out);
            }
        } else if kind.is_file() && is_workspace_file(&name) {
            if let Ok(rel) = path.strip_prefix(root) {
                out.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
}

pub fn list_files(root: &str) -> Vec<String> {
    let mut out = Vec::new();
    walk(Path::new(root), Path::new(root), &mut out);
    out.sort();
    out
}

pub fn read_all(root: &str) -> Result<HashMap<String, String>, String> {
    let mut out = HashMap::new();
    for rel in list_files(root) {
        let full = safe_join(root, &rel)?;
        if let Ok(content) = std::fs::read_to_string(&full) {
            out.insert(rel, content);
        }
    }
    Ok(out)
}

pub fn write_many(root: &str, writes: Vec<(String, String)>, deletes: Vec<String>) -> Result<(), String> {
    for (rel, content) in writes {
        let full = safe_join(root, &rel)?;
        if let Some(parent) = full.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("{rel}: {e}"))?;
        }
        std::fs::write(&full, content).map_err(|e| format!("{rel}: {e}"))?;
    }
    for rel in deletes {
        let full = safe_join(root, &rel)?;
        match std::fs::remove_file(&full) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("{rel}: {e}")),
        }
    }
    Ok(())
}

/// Decodifica base64 estándar (con o sin relleno `=`).
pub fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    fn value(c: u8) -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some((c - b'A') as u32),
            b'a'..=b'z' => Some((c - b'a') as u32 + 26),
            b'0'..=b'9' => Some((c - b'0') as u32 + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let bytes: Vec<u8> = input.bytes().filter(|c| !c.is_ascii_whitespace() && *c != b'=').collect();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
    for chunk in bytes.chunks(4) {
        let mut acc = 0u32;
        for (i, c) in chunk.iter().enumerate() {
            acc |= value(*c).ok_or("base64 inválido")? << (18 - 6 * i);
        }
        out.push((acc >> 16) as u8);
        if chunk.len() > 2 {
            out.push((acc >> 8) as u8);
        }
        if chunk.len() > 3 {
            out.push(acc as u8);
        }
    }
    Ok(out)
}

#[derive(Debug, Serialize)]
pub struct GitOutput {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

/// Ejecuta `git` en `cwd`. Nunca pide credenciales por consola (GIT_TERMINAL_PROMPT=0).
pub fn git(cwd: &str, args: &[String], input: Option<&str>) -> Result<GitOutput, String> {
    let mut cmd = Command::new("git");
    cmd.args(args)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("No se pudo ejecutar git: {e}. ¿Está instalado y en el PATH?"))?;
    if let Some(text) = input {
        let mut stdin = child.stdin.take().ok_or("git no aceptó la entrada estándar")?;
        // En un hilo aparte: si git llena stdout antes de leer toda la entrada no se bloquea.
        let data = text.as_bytes().to_vec();
        std::thread::spawn(move || {
            let _ = stdin.write_all(&data);
        });
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    Ok(GitOutput {
        code: out.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
    })
}

// --- Comandos ----------------------------------------------------------------------------------

/// Guarda un archivo exportado (imagen, PDF) en la ruta que eligió el usuario en el diálogo.
#[tauri::command]
async fn save_file(path: String, base64: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = decode_base64(&base64)?;
        std::fs::write(&path, bytes).map_err(|e| format!("{path}: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn fs_list(root: String) -> Vec<String> {
    list_files(&root)
}

#[tauri::command]
fn fs_read(root: String, path: String) -> Result<Option<String>, String> {
    let full = safe_join(&root, &path)?;
    match std::fs::read_to_string(full) {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn fs_read_all(root: String) -> Result<HashMap<String, String>, String> {
    tauri::async_runtime::spawn_blocking(move || read_all(&root))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn fs_write_many(root: String, writes: Vec<(String, String)>, deletes: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || write_many(&root, writes, deletes))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn git_run(cwd: String, args: Vec<String>, input: Option<String>) -> Result<GitOutput, String> {
    tauri::async_runtime::spawn_blocking(move || git(&cwd, &args, input.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Default)]
struct Watchers(Mutex<HashMap<String, RecommendedWatcher>>);

#[derive(Clone, Serialize)]
struct FsChanged {
    root: String,
    paths: Vec<String>,
}

/// Observa la carpeta y emite `aegon://fs-changed` (la UI agrupa los eventos y relee).
#[tauri::command]
fn watch_start(app: AppHandle, watchers: State<'_, Watchers>, root: String) -> Result<(), String> {
    let mut map = watchers.0.lock().map_err(|e| e.to_string())?;
    if map.contains_key(&root) {
        return Ok(());
    }
    let root_path = PathBuf::from(&root);
    let event_root = root.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        if matches!(event.kind, EventKind::Access(_)) {
            return;
        }
        let paths: Vec<String> = event
            .paths
            .iter()
            .filter_map(|p| p.strip_prefix(&root_path).ok())
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .filter(|p| !p.split('/').any(|seg| IGNORED_DIRS.contains(&seg)))
            .collect();
        if !paths.is_empty() {
            let _ = app.emit("aegon://fs-changed", FsChanged { root: event_root.clone(), paths });
        }
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(Path::new(&root), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    map.insert(root, watcher);
    Ok(())
}

#[tauri::command]
fn watch_stop(watchers: State<'_, Watchers>, root: String) {
    if let Ok(mut map) = watchers.0.lock() {
        map.remove(&root);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Watchers::default())
        .invoke_handler(tauri::generate_handler![
            fs_list,
            fs_read,
            fs_read_all,
            fs_write_many,
            save_file,
            git_run,
            watch_start,
            watch_stop
        ])
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar Aegon");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aegon-desktop-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn decodifica_base64() {
        assert_eq!(decode_base64("").unwrap(), Vec::<u8>::new());
        assert_eq!(decode_base64("QQ==").unwrap(), b"A");
        assert_eq!(decode_base64("QUI=").unwrap(), b"AB");
        assert_eq!(decode_base64("QUJD").unwrap(), b"ABC");
        assert_eq!(decode_base64("iVBORw0KGgo=").unwrap(), [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]);
        assert!(decode_base64("a$b=").is_err());
    }

    #[test]
    fn safe_join_rechaza_rutas_fuera_de_la_raiz() {
        assert!(safe_join("C:/ws", "model/elements/a.yaml").is_ok());
        assert!(safe_join("C:/ws", "../secreto.txt").is_err());
        assert!(safe_join("C:/ws", "model/../../x").is_err());
        assert!(safe_join("C:/ws", "C:/Windows/system.ini").is_err());
        assert!(safe_join("C:/ws", "/etc/passwd").is_err());
        assert!(safe_join("C:/ws", "").is_err());
    }

    #[test]
    fn escribe_lista_lee_y_borra() {
        let dir = temp_dir("fs");
        let root = dir.to_string_lossy().to_string();
        write_many(
            &root,
            vec![
                ("aegon.yaml".into(), "schema: 2\n".into()),
                ("model/elements/api.yaml".into(), "id: api\n".into()),
                ("node_modules/x.yaml".into(), "ignorado\n".into()),
            ],
            vec![],
        )
        .unwrap();
        std::fs::write(dir.join("foto.png"), [0u8, 1, 2]).unwrap();
        assert_eq!(list_files(&root), vec!["aegon.yaml", "model/elements/api.yaml"]);
        let all = read_all(&root).unwrap();
        assert_eq!(all.get("model/elements/api.yaml").unwrap(), "id: api\n");
        write_many(&root, vec![], vec!["model/elements/api.yaml".into(), "no-existe.yaml".into()]).unwrap();
        assert_eq!(list_files(&root), vec!["aegon.yaml"]);
        assert!(write_many(&root, vec![("../fuera.yaml".into(), "x".into())], vec![]).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn ejecuta_git_con_entrada_estandar() {
        let dir = temp_dir("git");
        let root = dir.to_string_lossy().to_string();
        let init = git(&root, &["init".into(), "-q".into()], None).unwrap();
        assert_eq!(init.code, 0, "{}", init.stderr);
        let hash = git(&root, &["hash-object".into(), "--stdin".into()], Some("hello\n")).unwrap();
        assert_eq!(hash.stdout.trim(), "ce013625030ba8dba906f756967f9e9ca394464a");
        let bad = git(&root, &["no-existe".into()], None).unwrap();
        assert_ne!(bad.code, 0);
        let _ = std::fs::remove_dir_all(dir);
    }
}
