//! Phase 3 external browser support.
//!
//! Afflow launches a real Chrome or Edge window against an Afflow-owned
//! profile directory. It does not embed, automate, or inspect the browser: the
//! browser owns tabs, authentication, cookies, uploads, downloads, and
//! permissions, and its process deliberately outlives Afflow.
//!
//! Nothing here returns, persists, or logs credentials, cookies, query
//! strings, browser output, or profile contents.

pub mod detect;
pub mod launch;
pub mod profile;
pub mod windows;

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::modules::fs::to_canon;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BrowserId {
    Chrome,
    Edge,
}

impl BrowserId {
    /// Fixed reporting order: Chrome, then Edge.
    pub const ALL: [BrowserId; 2] = [BrowserId::Chrome, BrowserId::Edge];

    pub fn id(self) -> &'static str {
        match self {
            BrowserId::Chrome => "chrome",
            BrowserId::Edge => "edge",
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            BrowserId::Chrome => "Google Chrome",
            BrowserId::Edge => "Microsoft Edge",
        }
    }

    pub fn exe_name(self) -> &'static str {
        match self {
            BrowserId::Chrome => "chrome.exe",
            BrowserId::Edge => "msedge.exe",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProfileActivity {
    Active,
    Idle,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDetection {
    pub id: BrowserId,
    pub name: String,
    pub available: bool,
    pub resolved_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserExecutableRequest {
    pub browser_id: BrowserId,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserExecutable {
    pub browser_id: BrowserId,
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserProfileRequest {
    pub browser_id: BrowserId,
    pub profile_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserProfileStatus {
    pub browser_id: BrowserId,
    pub profile_id: String,
    pub profile_path: String,
    pub exists: bool,
    pub activity: ProfileActivity,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserProfileLocation {
    pub browser_id: BrowserId,
    pub profile_id: String,
    pub profile_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserLaunchRequest {
    pub browser_id: BrowserId,
    pub executable_path: Option<String>,
    pub profile_id: String,
    pub urls: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserLaunchResult {
    pub browser_id: BrowserId,
    pub executable_path: String,
    pub profile_id: String,
    pub profile_path: String,
    /// Strictly the process Afflow spawned. Chromium forwards a launch to an
    /// existing instance and exits, so this is never evidence of browser
    /// lifecycle or profile activity; the lock probe decides that.
    pub pid: u32,
    pub launched_url_count: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserProfileResetRequest {
    pub browser_id: BrowserId,
    pub profile_id: String,
    pub confirmed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserProfileResetResult {
    pub browser_id: BrowserId,
    pub profile_id: String,
    pub profile_path: String,
    pub reset: bool,
    /// True when user data was logically reset but the quarantined copy could
    /// not be deleted yet. Never claim deletion that did not happen.
    pub cleanup_pending: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct ProfileKey {
    browser: BrowserId,
    profile: String,
}

/// Process-lifetime only. Holds no credentials, cookies, URLs, browser output,
/// or profile contents, and is never persisted.
#[derive(Default)]
struct BrowserInner {
    /// One lock per profile so launch and reset cannot interleave on the same
    /// user-data directory. Different profiles stay independent.
    locks: Mutex<HashMap<ProfileKey, Arc<Mutex<()>>>>,
    /// Browsers launched by this Afflow process. Pruned, never killed.
    children: Mutex<HashMap<ProfileKey, Vec<Child>>>,
}

impl BrowserInner {
    fn lock_for(&self, key: &ProfileKey) -> Arc<Mutex<()>> {
        let mut locks = self.locks.lock().expect("browser locks poisoned");
        locks.entry(key.clone()).or_default().clone()
    }

    fn track(&self, key: &ProfileKey, child: Child) {
        let mut children = self.children.lock().expect("browser children poisoned");
        children.entry(key.clone()).or_default().push(child);
    }

    /// Prunes exited processes with `try_wait` and reports whether any remain.
    /// Never kills anything: the browser is expected to outlive Afflow.
    fn has_live_child(&self, key: &ProfileKey) -> bool {
        let mut children = self.children.lock().expect("browser children poisoned");
        let Some(tracked) = children.get_mut(key) else {
            return false;
        };
        tracked.retain_mut(|child| matches!(child.try_wait(), Ok(None)));
        let live = !tracked.is_empty();
        if !live {
            children.remove(key);
        }
        live
    }
}

#[derive(Default)]
pub struct BrowserState {
    inner: Arc<BrowserInner>,
}

fn profile_base(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("cannot resolve the Afflow data directory: {e}"))?;
    Ok(dir.join(profile::PROFILE_BASE_DIR))
}

/// Production detection: registry App Paths, process environment, and the
/// GUI-safe PATH lookup already used for language servers.
fn detect_installed() -> Vec<BrowserDetection> {
    detect::detect_with(
        |browser| {
            detect::AppPathEntries::from_registry(windows::read_app_paths(browser.exe_name()))
        },
        |var| std::env::var(var).ok(),
        crate::modules::lsp::env::resolve_binary,
        detect::verify_executable,
    )
}

/// Resolves the executable to launch: a revalidated override, or the detected
/// install. An override that has since moved fails here, exactly as it would
/// during validation.
fn resolve_executable(browser: BrowserId, override_path: Option<&str>) -> Result<String, String> {
    match override_path.map(str::trim).filter(|p| !p.is_empty()) {
        Some(path) => detect::validate_executable(browser, path),
        None => detect_installed()
            .into_iter()
            .find(|d| d.id == browser)
            .and_then(|d| d.resolved_path)
            .ok_or_else(|| format!("{} is not installed", browser.display_name())),
    }
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default()
}

fn spawn_browser_with<F>(
    browser: BrowserId,
    plan: &launch::LaunchPlan,
    spawn: F,
) -> Result<Child, String>
where
    F: FnOnce(&mut Command) -> std::io::Result<Child>,
{
    let mut command = Command::new(&plan.program);
    for arg in &plan.args {
        command.arg(arg);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    crate::modules::proc::hide_console(&mut command);

    // The error intentionally identifies only the browser family. The plan
    // contains URLs and must never be interpolated into a displayable error.
    spawn(&mut command).map_err(|e| format!("cannot start {}: {e}", browser.display_name()))
}

/// Reports which supported browsers are installed. Never executes a browser or
/// reads its version or authentication state.
#[tauri::command]
pub async fn browser_detect() -> Result<Vec<BrowserDetection>, String> {
    tauri::async_runtime::spawn_blocking(detect_installed)
        .await
        .map_err(|e| format!("browser detection failed: {e}"))
}

/// Validates an explicit Chrome or Edge executable. Accepts no arguments and
/// never launches the file.
#[tauri::command]
pub async fn browser_validate_executable(
    request: BrowserExecutableRequest,
) -> Result<BrowserExecutable, String> {
    let browser = request.browser_id;
    let path = tauri::async_runtime::spawn_blocking(move || {
        detect::validate_executable(browser, &request.path)
    })
    .await
    .map_err(|e| format!("browser executable validation failed: {e}"))??;

    Ok(BrowserExecutable {
        browser_id: browser,
        path,
    })
}

/// Read-only managed profile status. Creates nothing.
#[tauri::command]
pub async fn browser_profile_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, BrowserState>,
    request: BrowserProfileRequest,
) -> Result<BrowserProfileStatus, String> {
    let base = profile_base(&app)?;
    let inner = state.inner.clone();
    let browser = request.browser_id;
    let profile_id = request.profile_id;

    tauri::async_runtime::spawn_blocking(move || {
        let key = ProfileKey {
            browser,
            profile: profile_id.clone(),
        };
        let live = inner.has_live_child(&key);
        let status = profile::status(&base, browser, &profile_id, live)?;
        Ok(BrowserProfileStatus {
            browser_id: browser,
            profile_id,
            profile_path: status.profile_path,
            exists: status.exists,
            activity: status.activity,
        })
    })
    .await
    .map_err(|e| format!("browser profile status failed: {e}"))?
}

/// Opens one or more saved websites in a dedicated normal browser window
/// backed by an Afflow-managed profile.
#[tauri::command]
pub async fn browser_launch(
    app: tauri::AppHandle,
    state: tauri::State<'_, BrowserState>,
    request: BrowserLaunchRequest,
) -> Result<BrowserLaunchResult, String> {
    let base = profile_base(&app)?;
    let inner = state.inner.clone();
    let browser = request.browser_id;
    let profile_id = request.profile_id;
    let override_path = request.executable_path;
    let urls = request.urls;

    tauri::async_runtime::spawn_blocking(move || {
        let urls = launch::validate_urls(&urls)?;
        let executable = resolve_executable(browser, override_path.as_deref())?;

        let key = ProfileKey {
            browser,
            profile: profile_id.clone(),
        };
        let lock = inner.lock_for(&key);
        let _guard = lock.lock().expect("browser profile lock poisoned");

        let paths = profile::ensure_container(&base, browser, &profile_id, now_secs())?;
        let plan = launch::build_plan(std::path::Path::new(&executable), &paths.user_data, &urls);

        // Deliberately not attached to Afflow's kill-on-close Job Object: the
        // browser must survive Afflow exiting. The error text carries no URL.
        let child = spawn_browser_with(browser, &plan, Command::spawn)?;
        let pid = child.id();
        inner.track(&key, child);

        Ok(BrowserLaunchResult {
            browser_id: browser,
            executable_path: executable,
            profile_id,
            profile_path: to_canon(&paths.user_data),
            pid,
            launched_url_count: urls.len(),
        })
    })
    .await
    .map_err(|e| format!("browser launch failed: {e}"))?
}

/// Opens the managed `user-data` folder in the OS file manager. The path is
/// native-derived; no path is accepted from the frontend.
#[tauri::command]
pub async fn browser_profile_open_folder(
    app: tauri::AppHandle,
    state: tauri::State<'_, BrowserState>,
    request: BrowserProfileRequest,
) -> Result<BrowserProfileLocation, String> {
    let base = profile_base(&app)?;
    let inner = state.inner.clone();
    let browser = request.browser_id;
    let profile_id = request.profile_id;

    let user_data = {
        let profile_id = profile_id.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let key = ProfileKey {
                browser,
                profile: profile_id.clone(),
            };
            let lock = inner.lock_for(&key);
            let _guard = lock.lock().expect("browser profile lock poisoned");
            profile::ensure_container(&base, browser, &profile_id, now_secs())
                .map(|paths| paths.user_data)
        })
        .await
        .map_err(|e| format!("browser profile folder failed: {e}"))??
    };

    let profile_path = to_canon(&user_data);
    tauri_plugin_opener::open_path(&profile_path, None::<&str>)
        .map_err(|e| format!("cannot open the browser profile folder: {e}"))?;

    Ok(BrowserProfileLocation {
        browser_id: browser,
        profile_id,
        profile_path,
    })
}

/// Clears one managed profile's user data after explicit confirmation and a
/// native activity check. Never kills a browser.
#[tauri::command]
pub async fn browser_profile_reset(
    app: tauri::AppHandle,
    state: tauri::State<'_, BrowserState>,
    request: BrowserProfileResetRequest,
) -> Result<BrowserProfileResetResult, String> {
    let base = profile_base(&app)?;
    let inner = state.inner.clone();
    let browser = request.browser_id;
    let profile_id = request.profile_id;
    let confirmed = request.confirmed;

    tauri::async_runtime::spawn_blocking(move || {
        let key = ProfileKey {
            browser,
            profile: profile_id.clone(),
        };
        let lock = inner.lock_for(&key);
        // Held across the activity check and the reset, so a launch cannot
        // start a browser between deciding "idle" and clearing the directory.
        let _guard = lock.lock().expect("browser profile lock poisoned");

        let paths = profile::derive_paths(&base, browser, &profile_id)?;
        let live = inner.has_live_child(&key);
        let activity = profile::probe_activity(&paths.user_data, live);

        let outcome = profile::reset(&base, browser, &profile_id, confirmed, activity, now_secs())?;

        Ok(BrowserProfileResetResult {
            browser_id: browser,
            profile_id,
            profile_path: outcome.profile_path,
            reset: outcome.reset,
            cleanup_pending: outcome.cleanup_pending,
        })
    })
    .await
    .map_err(|e| format!("browser profile reset failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn keys(value: &Value) -> Vec<String> {
        let mut names: Vec<String> = value.as_object().expect("object").keys().cloned().collect();
        names.sort();
        names
    }

    // ---- browser identity -------------------------------------------------

    #[test]
    fn browser_ids_serialize_as_the_frontend_expects() {
        assert_eq!(
            serde_json::to_value(BrowserId::Chrome).unwrap(),
            json!("chrome")
        );
        assert_eq!(
            serde_json::to_value(BrowserId::Edge).unwrap(),
            json!("edge")
        );

        assert_eq!(
            serde_json::from_value::<BrowserId>(json!("chrome")).unwrap(),
            BrowserId::Chrome
        );
        assert_eq!(
            serde_json::from_value::<BrowserId>(json!("edge")).unwrap(),
            BrowserId::Edge
        );
        assert!(serde_json::from_value::<BrowserId>(json!("firefox")).is_err());
        assert!(serde_json::from_value::<BrowserId>(json!("Chrome")).is_err());
    }

    #[test]
    fn each_browser_has_a_distinct_id_name_and_executable() {
        assert_eq!(BrowserId::ALL.len(), 2);
        assert_eq!(BrowserId::Chrome.id(), "chrome");
        assert_eq!(BrowserId::Edge.id(), "edge");
        assert_eq!(BrowserId::Chrome.exe_name(), "chrome.exe");
        assert_eq!(BrowserId::Edge.exe_name(), "msedge.exe");
        assert_eq!(BrowserId::Chrome.display_name(), "Google Chrome");
        assert_eq!(BrowserId::Edge.display_name(), "Microsoft Edge");
    }

    #[test]
    fn profile_activity_serializes_as_three_lowercase_states() {
        assert_eq!(
            serde_json::to_value(ProfileActivity::Active).unwrap(),
            json!("active")
        );
        assert_eq!(
            serde_json::to_value(ProfileActivity::Idle).unwrap(),
            json!("idle")
        );
        assert_eq!(
            serde_json::to_value(ProfileActivity::Unknown).unwrap(),
            json!("unknown")
        );
    }

    // ---- response shapes --------------------------------------------------

    #[test]
    fn detection_responses_use_exact_camel_case_keys() {
        let value = serde_json::to_value(BrowserDetection {
            id: BrowserId::Chrome,
            name: "Google Chrome".into(),
            available: true,
            resolved_path: Some("C:/browsers/chrome.exe".into()),
        })
        .unwrap();

        assert_eq!(keys(&value), ["available", "id", "name", "resolvedPath"]);
        assert_eq!(value["resolvedPath"], json!("C:/browsers/chrome.exe"));

        let absent = serde_json::to_value(BrowserDetection {
            id: BrowserId::Edge,
            name: "Microsoft Edge".into(),
            available: false,
            resolved_path: None,
        })
        .unwrap();
        assert_eq!(absent["resolvedPath"], Value::Null);
    }

    #[test]
    fn profile_status_and_location_responses_use_exact_camel_case_keys() {
        let status = serde_json::to_value(BrowserProfileStatus {
            browser_id: BrowserId::Chrome,
            profile_id: "shared-v1".into(),
            profile_path: "C:/data/browser-profiles/chrome/shared-v1/user-data".into(),
            exists: true,
            activity: ProfileActivity::Idle,
        })
        .unwrap();
        assert_eq!(
            keys(&status),
            [
                "activity",
                "browserId",
                "exists",
                "profileId",
                "profilePath"
            ]
        );

        let location = serde_json::to_value(BrowserProfileLocation {
            browser_id: BrowserId::Edge,
            profile_id: "ws-alpha".into(),
            profile_path: "C:/data/browser-profiles/edge/ws-alpha/user-data".into(),
        })
        .unwrap();
        assert_eq!(keys(&location), ["browserId", "profileId", "profilePath"]);
    }

    #[test]
    fn the_launch_response_reports_a_count_and_never_the_command_line_or_urls() {
        let value = serde_json::to_value(BrowserLaunchResult {
            browser_id: BrowserId::Chrome,
            executable_path: "C:/browsers/chrome.exe".into(),
            profile_id: "shared-v1".into(),
            profile_path: "C:/data/browser-profiles/chrome/shared-v1/user-data".into(),
            pid: 4321,
            launched_url_count: 3,
        })
        .unwrap();

        assert_eq!(
            keys(&value),
            [
                "browserId",
                "executablePath",
                "launchedUrlCount",
                "pid",
                "profileId",
                "profilePath"
            ]
        );
        assert_eq!(value["launchedUrlCount"], json!(3));
        assert_eq!(value["pid"], json!(4321));

        // No argument vector, URL, cookie, credential, or browser output.
        let text = value.to_string();
        for leaked in ["args", "--user-data-dir", "http", "cookie", "token"] {
            assert!(!text.contains(leaked), "{leaked} leaked into the response");
        }
    }

    #[test]
    fn spawn_errors_never_expose_the_launch_urls() {
        let secret = "AFFLOW_PRIVATE_TOKEN_7319";
        let plan = launch::build_plan(
            std::path::Path::new("C:/browsers/chrome.exe"),
            std::path::Path::new("C:/profiles/chrome/shared-v1/user-data"),
            &[format!("https://example.com/?token={secret}")],
        );

        let err = spawn_browser_with(BrowserId::Chrome, &plan, |_| {
            Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "access denied",
            ))
        })
        .unwrap_err();

        assert!(err.contains("Google Chrome"));
        assert!(err.contains("access denied"));
        assert!(!err.contains(secret));
        assert!(!err.contains("example.com"));
    }

    #[test]
    fn the_reset_response_reports_cleanup_pending() {
        let value = serde_json::to_value(BrowserProfileResetResult {
            browser_id: BrowserId::Chrome,
            profile_id: "shared-v1".into(),
            profile_path: "C:/data/browser-profiles/chrome/shared-v1/user-data".into(),
            reset: true,
            cleanup_pending: true,
        })
        .unwrap();

        assert_eq!(
            keys(&value),
            [
                "browserId",
                "cleanupPending",
                "profileId",
                "profilePath",
                "reset"
            ]
        );
        assert_eq!(value["cleanupPending"], json!(true));
    }

    #[test]
    fn requests_deserialize_from_the_frontend_payload_shape() {
        let launch: BrowserLaunchRequest = serde_json::from_value(json!({
            "browserId": "chrome",
            "executablePath": null,
            "profileId": "shared-v1",
            "urls": ["https://a.example.com/"],
        }))
        .unwrap();
        assert_eq!(launch.browser_id, BrowserId::Chrome);
        assert_eq!(launch.executable_path, None);
        assert_eq!(launch.urls.len(), 1);

        let reset: BrowserProfileResetRequest = serde_json::from_value(json!({
            "browserId": "edge",
            "profileId": "ws-alpha",
            "confirmed": true,
        }))
        .unwrap();
        assert!(reset.confirmed);

        let executable: BrowserExecutableRequest = serde_json::from_value(json!({
            "browserId": "chrome",
            "path": "C:/browsers/chrome.exe",
        }))
        .unwrap();
        assert_eq!(executable.path, "C:/browsers/chrome.exe");

        let profile: BrowserProfileRequest = serde_json::from_value(json!({
            "browserId": "chrome",
            "profileId": "shared-v1",
        }))
        .unwrap();
        assert_eq!(profile.profile_id, "shared-v1");
    }

    #[test]
    fn no_request_accepts_a_profile_or_user_data_path() {
        // The only way to name a profile over IPC is the opaque id.
        let payload = json!({
            "browserId": "chrome",
            "profileId": "shared-v1",
            "profilePath": "C:/elsewhere",
            "userDataDir": "C:/elsewhere",
        });
        // The extra keys are simply dropped: the struct has nowhere to put a
        // caller-supplied path, so one can never reach the filesystem.
        let request: BrowserProfileRequest = serde_json::from_value(payload).unwrap();
        assert_eq!(request.profile_id, "shared-v1");
        assert_eq!(request.browser_id, BrowserId::Chrome);
    }

    #[test]
    fn the_executable_response_uses_exact_camel_case_keys() {
        let value = serde_json::to_value(BrowserExecutable {
            browser_id: BrowserId::Chrome,
            path: "C:/browsers/chrome.exe".into(),
        })
        .unwrap();
        assert_eq!(keys(&value), ["browserId", "path"]);
    }

    // ---- tracked child state ---------------------------------------------

    fn key(browser: BrowserId, profile: &str) -> ProfileKey {
        ProfileKey {
            browser,
            profile: profile.to_string(),
        }
    }

    /// A process that stays alive until killed, and one that exits at once.
    fn long_running() -> Child {
        #[cfg(windows)]
        let mut command = {
            let mut c = Command::new("cmd");
            c.args(["/c", "pause"]);
            c
        };
        #[cfg(not(windows))]
        let mut command = {
            let mut c = Command::new("sleep");
            c.arg("30");
            c
        };
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        command.spawn().expect("spawn long-running child")
    }

    fn already_exited() -> Child {
        #[cfg(windows)]
        let mut command = {
            let mut c = Command::new("cmd");
            c.args(["/c", "exit", "0"]);
            c
        };
        #[cfg(not(windows))]
        let mut command = Command::new("true");
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut child = command.spawn().expect("spawn short-lived child");
        child.wait().expect("wait");
        child
    }

    #[test]
    fn an_untracked_profile_has_no_live_child() {
        let inner = BrowserInner::default();
        assert!(!inner.has_live_child(&key(BrowserId::Chrome, "shared-v1")));
    }

    #[test]
    fn a_running_tracked_child_reports_live_and_is_never_killed() {
        let inner = BrowserInner::default();
        let k = key(BrowserId::Chrome, "shared-v1");
        inner.track(&k, long_running());

        assert!(inner.has_live_child(&k));
        // Repeated probes must neither kill nor prune a running browser.
        assert!(inner.has_live_child(&k));
        assert!(inner.has_live_child(&k));

        let mut children = inner.children.lock().unwrap();
        let tracked = children.get_mut(&k).expect("still tracked");
        assert_eq!(tracked.len(), 1);
        for child in tracked {
            assert_eq!(child.try_wait().unwrap(), None, "the child was killed");
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    #[test]
    fn a_completed_child_is_pruned_and_the_profile_reads_as_not_live() {
        let inner = BrowserInner::default();
        let k = key(BrowserId::Chrome, "shared-v1");
        inner.track(&k, already_exited());

        assert!(!inner.has_live_child(&k));
        // The entry is dropped rather than accumulating dead handles.
        assert!(!inner.children.lock().unwrap().contains_key(&k));
    }

    #[test]
    fn tracking_is_per_browser_and_per_profile() {
        let inner = BrowserInner::default();
        let chrome_shared = key(BrowserId::Chrome, "shared-v1");
        inner.track(&chrome_shared, already_exited());
        let mut live = long_running();
        inner.track(&key(BrowserId::Chrome, "ws-alpha"), long_running());

        assert!(!inner.has_live_child(&chrome_shared));
        assert!(inner.has_live_child(&key(BrowserId::Chrome, "ws-alpha")));
        // Same profile id, different browser family: independent.
        assert!(!inner.has_live_child(&key(BrowserId::Edge, "ws-alpha")));

        let _ = live.kill();
        let _ = live.wait();
    }

    #[test]
    fn a_live_child_next_to_a_dead_one_still_reports_live() {
        let inner = BrowserInner::default();
        let k = key(BrowserId::Chrome, "shared-v1");
        inner.track(&k, already_exited());
        inner.track(&k, long_running());
        inner.track(&k, already_exited());

        assert!(inner.has_live_child(&k));
        assert_eq!(inner.children.lock().unwrap()[&k].len(), 1);

        for child in inner.children.lock().unwrap().get_mut(&k).unwrap() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    // ---- per-profile serialization ---------------------------------------

    #[test]
    fn the_same_profile_returns_the_same_lock_and_different_profiles_do_not() {
        let inner = BrowserInner::default();
        let a = inner.lock_for(&key(BrowserId::Chrome, "shared-v1"));
        let b = inner.lock_for(&key(BrowserId::Chrome, "shared-v1"));
        let other = inner.lock_for(&key(BrowserId::Chrome, "ws-alpha"));
        let edge = inner.lock_for(&key(BrowserId::Edge, "shared-v1"));

        assert!(Arc::ptr_eq(&a, &b));
        assert!(!Arc::ptr_eq(&a, &other));
        assert!(!Arc::ptr_eq(&a, &edge));
    }

    #[test]
    fn same_profile_work_serializes_while_different_profiles_run_concurrently() {
        let inner = Arc::new(BrowserInner::default());
        let shared = key(BrowserId::Chrome, "shared-v1");

        let lock = inner.lock_for(&shared);
        let held = lock.lock().unwrap();

        // A different profile is unaffected by the held lock.
        let other = inner.lock_for(&key(BrowserId::Chrome, "ws-alpha"));
        assert!(other.try_lock().is_ok());

        // The same profile cannot proceed until the guard is released.
        let contender = Arc::clone(&inner);
        let contended = shared.clone();
        let joined = std::thread::spawn(move || {
            let lock = contender.lock_for(&contended);
            let _guard = lock.lock().expect("acquired after release");
            true
        });

        // Still blocked while the guard lives.
        assert!(!joined.is_finished());
        drop(held);
        assert!(joined.join().expect("thread"));
    }

    #[test]
    fn the_profile_base_is_always_the_managed_subdirectory() {
        // The path derivation is native and fixed; nothing from IPC reaches it.
        assert_eq!(profile::PROFILE_BASE_DIR, "browser-profiles");
        assert_eq!(profile::USER_DATA_DIR, "user-data");
        assert_eq!(profile::MARKER_FILE, ".afflow-profile.json");
    }
}
