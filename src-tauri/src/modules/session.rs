use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

const MARKER_FILE: &str = ".afflow-session.json";
const LOCK_FILE: &str = ".afflow-session.lock";
const MARKER_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionStartupKind {
    FirstRun,
    Clean,
    Unclean,
    Corrupt,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStartupStatus {
    pub status: SessionStartupKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum MarkerState {
    Running,
    Clean,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SessionMarker {
    schema_version: u32,
    state: MarkerState,
    session_id: String,
    started_at_unix_ms: u64,
    updated_at_unix_ms: u64,
}

impl SessionMarker {
    fn validate(&self) -> bool {
        self.schema_version == MARKER_SCHEMA_VERSION
            && self.session_id.len() == 32
            && self
                .session_id
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            && self.started_at_unix_ms > 0
            && self.updated_at_unix_ms >= self.started_at_unix_ms
    }
}

#[derive(Debug)]
struct RuntimeState {
    path: PathBuf,
    marker: SessionMarker,
    startup: SessionStartupStatus,
}

#[cfg(unix)]
#[derive(Debug)]
struct SessionLock {
    _file: std::fs::File,
}

#[cfg(windows)]
#[derive(Debug)]
struct SessionLock(isize);

#[cfg(windows)]
impl Drop for SessionLock {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(
                self.0 as windows_sys::Win32::Foundation::HANDLE,
            );
        }
    }
}

#[derive(Debug)]
pub struct SessionState {
    runtime: Mutex<RuntimeState>,
    _lock: SessionLock,
}

impl SessionState {
    pub fn initialize(app: &AppHandle) -> Result<Self, String> {
        app.path()
            .app_data_dir()
            .map_err(|error| format!("resolve session marker directory: {error}"))
            .and_then(|directory| Self::initialize_at(directory.join(MARKER_FILE)))
    }

    fn initialize_at(path: PathBuf) -> Result<Self, String> {
        let parent = path
            .parent()
            .ok_or_else(|| "session marker path has no parent".to_string())?;
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("create session marker directory: {error}"))?;
        let session_lock = acquire_session_lock(&parent.join(LOCK_FILE))?;
        let startup = SessionStartupStatus {
            status: inspect_previous(&path),
        };
        let now = unix_ms()?;
        let marker = SessionMarker {
            schema_version: MARKER_SCHEMA_VERSION,
            state: MarkerState::Running,
            session_id: new_session_id()?,
            started_at_unix_ms: now,
            updated_at_unix_ms: now,
        };
        write_marker_atomic(&path, &marker)?;
        Ok(Self {
            runtime: Mutex::new(RuntimeState {
                path,
                marker,
                startup,
            }),
            _lock: session_lock,
        })
    }

    pub fn startup_status(&self) -> Result<SessionStartupStatus, String> {
        Ok(self
            .runtime
            .lock()
            .expect("SessionState mutex poisoned")
            .startup
            .clone())
    }

    pub fn mark_clean(&self) -> Result<(), String> {
        let mut runtime = self.runtime.lock().expect("SessionState mutex poisoned");
        let RuntimeState { path, marker, .. } = &mut *runtime;

        let current =
            read_marker(path).map_err(|error| format!("read current session marker: {error}"))?;
        if current.session_id != marker.session_id {
            return Err("session marker belongs to a different app session".into());
        }

        marker.state = MarkerState::Clean;
        marker.updated_at_unix_ms = unix_ms()?.max(marker.started_at_unix_ms);
        write_marker_atomic(path, marker)
    }

    pub fn acknowledge_recovery(&self) -> Result<(), String> {
        let mut runtime = self.runtime.lock().expect("SessionState mutex poisoned");
        runtime.startup.status = SessionStartupKind::Clean;
        Ok(())
    }
}

#[tauri::command]
pub fn session_startup_status(
    state: State<'_, SessionState>,
) -> Result<SessionStartupStatus, String> {
    state.startup_status()
}

#[tauri::command]
pub fn session_acknowledge_recovery(state: State<'_, SessionState>) -> Result<(), String> {
    state.acknowledge_recovery()
}

#[tauri::command]
pub fn session_mark_clean(state: State<'_, SessionState>) -> Result<(), String> {
    state.mark_clean()
}

#[cfg(unix)]
fn acquire_session_lock(path: &Path) -> Result<SessionLock, String> {
    use std::os::fd::AsRawFd;
    use std::os::unix::fs::OpenOptionsExt;

    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .mode(0o600)
        .open(path)
        .map_err(|error| format!("open Afflow session lock: {error}"))?;
    let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if result != 0 {
        return Err("another Afflow process is already running".into());
    }
    Ok(SessionLock { _file: file })
}

#[cfg(windows)]
fn acquire_session_lock(path: &Path) -> Result<SessionLock, String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::{GENERIC_READ, GENERIC_WRITE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_ATTRIBUTE_NORMAL, OPEN_ALWAYS,
    };

    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            0,
            std::ptr::null(),
            OPEN_ALWAYS,
            FILE_ATTRIBUTE_NORMAL,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err("another Afflow process is already running".into());
    }
    Ok(SessionLock(handle as isize))
}

fn inspect_previous(path: &Path) -> SessionStartupKind {
    match std::fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => SessionStartupKind::FirstRun,
        Err(_) => SessionStartupKind::Corrupt,
        Ok(metadata) if !metadata.file_type().is_file() => SessionStartupKind::Corrupt,
        Ok(_) => match read_marker(path) {
            Ok(marker) if marker.state == MarkerState::Clean => SessionStartupKind::Clean,
            Ok(_) => SessionStartupKind::Unclean,
            Err(_) => SessionStartupKind::Corrupt,
        },
    }
}

fn read_marker(path: &Path) -> Result<SessionMarker, String> {
    let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
    let marker: SessionMarker =
        serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    if !marker.validate() {
        return Err("session marker failed validation".into());
    }
    Ok(marker)
}

fn write_marker_atomic(path: &Path, marker: &SessionMarker) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "session marker path has no parent".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("create session marker directory: {error}"))?;

    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| format!("create temporary session marker: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        temporary
            .as_file()
            .set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("secure temporary session marker: {error}"))?;
    }
    serde_json::to_writer(&mut temporary, marker)
        .map_err(|error| format!("serialize session marker: {error}"))?;
    temporary
        .write_all(b"\n")
        .map_err(|error| format!("write session marker: {error}"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("sync session marker: {error}"))?;
    temporary
        .persist(path)
        .map_err(|error| format!("publish session marker: {}", error.error))?;

    #[cfg(unix)]
    std::fs::File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("sync session marker directory: {error}"))?;

    Ok(())
}

fn unix_ms() -> Result<u64, String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("system clock is before Unix epoch: {error}"))?
        .as_millis();
    u64::try_from(millis).map_err(|_| "system time does not fit in u64".into())
}

fn new_session_id() -> Result<String, String> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|error| format!("generate session id: {error}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn marker(state: MarkerState, session_id: &str) -> SessionMarker {
        SessionMarker {
            schema_version: MARKER_SCHEMA_VERSION,
            state,
            session_id: session_id.to_string(),
            started_at_unix_ms: 10,
            updated_at_unix_ms: 20,
        }
    }

    #[test]
    fn first_run_is_reported_and_running_marker_is_published() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(MARKER_FILE);

        let state = SessionState::initialize_at(path.clone()).unwrap();

        assert_eq!(
            state.startup_status().unwrap().status,
            SessionStartupKind::FirstRun
        );
        assert_eq!(read_marker(&path).unwrap().state, MarkerState::Running);
    }

    #[test]
    fn clean_exit_is_distinct_from_a_process_crash() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(MARKER_FILE);
        let first = SessionState::initialize_at(path.clone()).unwrap();
        first.mark_clean().unwrap();
        drop(first);

        let after_clean = SessionState::initialize_at(path.clone()).unwrap();
        assert_eq!(
            after_clean.startup_status().unwrap().status,
            SessionStartupKind::Clean
        );
        drop(after_clean);

        let after_crash = SessionState::initialize_at(path).unwrap();
        assert_eq!(
            after_crash.startup_status().unwrap().status,
            SessionStartupKind::Unclean
        );
    }

    #[test]
    fn corrupt_and_non_file_markers_are_reported_strictly() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(MARKER_FILE);
        std::fs::write(
            &path,
            br#"{"schemaVersion":1,"state":"clean","extra":true}"#,
        )
        .unwrap();
        assert_eq!(inspect_previous(&path), SessionStartupKind::Corrupt);

        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();
        assert_eq!(inspect_previous(&path), SessionStartupKind::Corrupt);
    }

    #[test]
    fn invalid_marker_fields_are_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(MARKER_FILE);
        let mut invalid = marker(MarkerState::Running, "ABC");
        invalid.updated_at_unix_ms = 5;
        std::fs::write(&path, serde_json::to_vec(&invalid).unwrap()).unwrap();

        assert_eq!(inspect_previous(&path), SessionStartupKind::Corrupt);
        assert!(read_marker(&path).is_err());
    }

    #[test]
    fn a_second_process_cannot_replace_the_running_session() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(MARKER_FILE);
        let first = SessionState::initialize_at(path.clone()).unwrap();
        let second = SessionState::initialize_at(path.clone());

        assert!(second.is_err());
        assert_eq!(read_marker(&path).unwrap().state, MarkerState::Running);
        first.mark_clean().unwrap();
        assert_eq!(read_marker(&path).unwrap().state, MarkerState::Clean);
    }

    #[test]
    fn recovery_acknowledgement_survives_frontend_status_reloads() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(MARKER_FILE);
        let state = SessionState::initialize_at(path.clone()).unwrap();

        state.acknowledge_recovery().unwrap();

        assert_eq!(
            state.startup_status().unwrap().status,
            SessionStartupKind::Clean
        );
        assert_eq!(read_marker(&path).unwrap().state, MarkerState::Running);
    }

    #[test]
    fn startup_dto_has_one_exact_camel_case_status_field() {
        let value = serde_json::to_value(SessionStartupStatus {
            status: SessionStartupKind::FirstRun,
        })
        .unwrap();
        assert_eq!(value, serde_json::json!({ "status": "firstRun" }));
    }
}
