//! Chrome and Edge detection, plus validation of an explicit executable
//! override.
//!
//! Every source is injected so tests exercise the precedence rules without
//! depending on which browsers the host machine happens to have installed.
//! Detection never executes a browser or reads its version.

use std::path::{Path, PathBuf};

use super::BrowserId;
use crate::modules::fs::to_canon;

/// The `App Paths` default values for one executable, in lookup order.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct AppPathEntries {
    pub hkcu: Option<PathBuf>,
    pub hklm_64: Option<PathBuf>,
    pub hklm_32: Option<PathBuf>,
}

impl AppPathEntries {
    pub fn from_registry(values: [Option<PathBuf>; 3]) -> Self {
        let [hkcu, hklm_64, hklm_32] = values;
        Self {
            hkcu,
            hklm_64,
            hklm_32,
        }
    }

    fn in_order(&self) -> impl Iterator<Item = &PathBuf> {
        [&self.hkcu, &self.hklm_64, &self.hklm_32]
            .into_iter()
            .flatten()
    }
}

/// Environment variables holding the standard install roots, most likely
/// first. Edge ships 32-bit-registered on 64-bit Windows, so its ordering
/// deliberately differs from Chrome's.
fn standard_roots(browser: BrowserId) -> &'static [&'static str] {
    match browser {
        BrowserId::Chrome => &["LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)"],
        BrowserId::Edge => &["PROGRAMFILES(X86)", "PROGRAMFILES", "LOCALAPPDATA"],
    }
}

/// Kept as components rather than a joined string so the candidate builder
/// behaves identically on every host and stays unit-testable.
fn standard_subpath(browser: BrowserId) -> &'static [&'static str] {
    match browser {
        BrowserId::Chrome => &["Google", "Chrome", "Application", "chrome.exe"],
        BrowserId::Edge => &["Microsoft", "Edge", "Application", "msedge.exe"],
    }
}

/// Ordered candidates for one browser: HKCU App Paths, the HKLM 64-bit view,
/// the HKLM 32-bit view, the standard install locations, then a GUI-safe PATH
/// lookup as the final fallback.
pub fn candidate_paths<E, P>(
    browser: BrowserId,
    app_paths: &AppPathEntries,
    env: &E,
    path_lookup: &P,
) -> Vec<PathBuf>
where
    E: Fn(&str) -> Option<String>,
    P: Fn(&str) -> Option<PathBuf>,
{
    let mut candidates: Vec<PathBuf> = app_paths.in_order().cloned().collect();

    for var in standard_roots(browser) {
        let Some(root) = env(var)
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
        else {
            continue;
        };
        let mut candidate = PathBuf::from(root);
        for part in standard_subpath(browser) {
            candidate.push(part);
        }
        candidates.push(candidate);
    }

    if let Some(found) = path_lookup(browser.exe_name()) {
        candidates.push(found);
    }

    candidates.dedup();
    candidates
}

/// Canonicalizes a candidate and proves it is a regular file with the exact
/// executable name for `browser`. Stale registry entries and directories fall
/// through here rather than being reported as installed.
pub fn verify_executable(path: &Path, expected_exe: &str) -> Option<PathBuf> {
    let canonical = std::fs::canonicalize(path).ok()?;
    if !std::fs::metadata(&canonical).ok()?.is_file() {
        return None;
    }
    let name = canonical.file_name()?.to_str()?;
    name.eq_ignore_ascii_case(expected_exe).then_some(canonical)
}

/// Detects Chrome then Edge, in that fixed order.
///
/// `available` is derived from `resolved_path`, never computed separately, so
/// the two can never disagree.
pub fn detect_with<R, E, P, V>(
    app_paths: R,
    env: E,
    path_lookup: P,
    verify: V,
) -> Vec<super::BrowserDetection>
where
    R: Fn(BrowserId) -> AppPathEntries,
    E: Fn(&str) -> Option<String>,
    P: Fn(&str) -> Option<PathBuf>,
    V: Fn(&Path, &str) -> Option<PathBuf>,
{
    BrowserId::ALL
        .iter()
        .map(|browser| {
            let entries = app_paths(*browser);
            let resolved_path = candidate_paths(*browser, &entries, &env, &path_lookup)
                .into_iter()
                .find_map(|candidate| verify(&candidate, browser.exe_name()))
                .map(to_canon);

            super::BrowserDetection {
                id: *browser,
                name: browser.display_name().to_string(),
                available: resolved_path.is_some(),
                resolved_path,
            }
        })
        .collect()
}

/// Validates an explicit executable override.
///
/// The override is still Chrome or Edge: it is not a command line, so no
/// arguments are accepted and the executable is never run. The same rules run
/// again at launch time, which is what catches a browser moved or uninstalled
/// after the override was saved.
pub fn validate_executable(browser: BrowserId, raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("browser executable path is empty".into());
    }

    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err(format!(
            "browser executable path must be absolute: {trimmed}"
        ));
    }

    let canonical = std::fs::canonicalize(&path)
        .map_err(|_| format!("browser executable not found: {trimmed}"))?;

    let metadata = std::fs::metadata(&canonical)
        .map_err(|e| format!("cannot inspect browser executable: {e}"))?;
    if !metadata.is_file() {
        return Err(format!(
            "browser executable is not a regular file: {}",
            to_canon(&canonical)
        ));
    }

    if cfg!(windows) {
        let is_exe = canonical
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("exe"));
        if !is_exe {
            return Err(format!(
                "browser executable must be a .exe: {}",
                to_canon(&canonical)
            ));
        }
    }

    let name = canonical
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "browser executable has no file name".to_string())?;
    if !name.eq_ignore_ascii_case(browser.exe_name()) {
        return Err(format!(
            "{} requires {}, but the selected file is {name}",
            browser.display_name(),
            browser.exe_name()
        ));
    }

    Ok(to_canon(&canonical))
}

#[cfg(test)]
mod tests {
    use super::{
        candidate_paths, detect_with, validate_executable, verify_executable, AppPathEntries,
    };
    use crate::modules::browser::BrowserId;
    use std::collections::HashSet;
    use std::path::{Path, PathBuf};

    const CHROME: &str = if cfg!(windows) {
        r"C:\Program Files\Google\Chrome\Application\chrome.exe"
    } else {
        "/opt/google/chrome/chrome.exe"
    };
    const EDGE: &str = if cfg!(windows) {
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    } else {
        "/opt/microsoft/edge/msedge.exe"
    };

    /// Stands in for the filesystem: only the listed paths "exist".
    fn installed(paths: &[&str]) -> impl Fn(&Path, &str) -> Option<PathBuf> {
        let set: HashSet<PathBuf> = paths.iter().map(PathBuf::from).collect();
        move |path, _exe| set.contains(path).then(|| path.to_path_buf())
    }

    fn no_env(_var: &str) -> Option<String> {
        None
    }

    fn no_path(_exe: &str) -> Option<PathBuf> {
        None
    }

    fn entries_for(
        chrome: Option<&str>,
        edge: Option<&str>,
    ) -> impl Fn(BrowserId) -> AppPathEntries {
        let chrome = chrome.map(PathBuf::from);
        let edge = edge.map(PathBuf::from);
        move |browser| AppPathEntries {
            hkcu: match browser {
                BrowserId::Chrome => chrome.clone(),
                BrowserId::Edge => edge.clone(),
            },
            ..Default::default()
        }
    }

    #[test]
    fn reports_chrome_then_edge_in_a_fixed_order() {
        let found = detect_with(
            |_| AppPathEntries::default(),
            no_env,
            no_path,
            installed(&[]),
        );
        let ids: Vec<&str> = found.iter().map(|d| d.id.id()).collect();
        assert_eq!(ids, vec!["chrome", "edge"]);
        assert_eq!(found[0].name, "Google Chrome");
        assert_eq!(found[1].name, "Microsoft Edge");
    }

    #[test]
    fn reports_neither_when_nothing_is_installed() {
        let found = detect_with(
            entries_for(Some(CHROME), Some(EDGE)),
            no_env,
            no_path,
            installed(&[]),
        );
        for entry in &found {
            assert!(!entry.available, "{} should be unavailable", entry.id.id());
            assert_eq!(entry.resolved_path, None);
        }
    }

    #[test]
    fn reports_chrome_only() {
        let found = detect_with(
            entries_for(Some(CHROME), Some(EDGE)),
            no_env,
            no_path,
            installed(&[CHROME]),
        );
        assert!(found[0].available);
        assert!(!found[1].available);
        assert_eq!(found[1].resolved_path, None);
    }

    #[test]
    fn reports_edge_only() {
        let found = detect_with(
            entries_for(Some(CHROME), Some(EDGE)),
            no_env,
            no_path,
            installed(&[EDGE]),
        );
        assert!(!found[0].available);
        assert!(found[1].available);
    }

    #[test]
    fn reports_both_and_available_tracks_the_resolved_path() {
        let found = detect_with(
            entries_for(Some(CHROME), Some(EDGE)),
            no_env,
            no_path,
            installed(&[CHROME, EDGE]),
        );
        for entry in &found {
            assert_eq!(entry.available, entry.resolved_path.is_some());
            assert!(entry.available);
        }
    }

    #[test]
    fn resolved_paths_are_forward_slashed() {
        let found = detect_with(
            entries_for(Some(CHROME), None),
            no_env,
            no_path,
            installed(&[CHROME]),
        );
        let path = found[0].resolved_path.as_deref().expect("chrome path");
        assert!(!path.contains('\\'), "not forward-slashed: {path}");
        assert!(path.ends_with("chrome.exe"));
    }

    #[test]
    fn hkcu_wins_over_every_other_source() {
        let entries = AppPathEntries {
            hkcu: Some(PathBuf::from("/a/chrome.exe")),
            hklm_64: Some(PathBuf::from("/b/chrome.exe")),
            hklm_32: Some(PathBuf::from("/c/chrome.exe")),
        };
        let candidates = candidate_paths(
            BrowserId::Chrome,
            &entries,
            &|var: &str| (var == "LOCALAPPDATA").then(|| "/d".to_string()),
            &|_: &str| Some(PathBuf::from("/e/chrome.exe")),
        );

        assert_eq!(candidates[0], PathBuf::from("/a/chrome.exe"));
        assert_eq!(candidates[1], PathBuf::from("/b/chrome.exe"));
        assert_eq!(candidates[2], PathBuf::from("/c/chrome.exe"));
        assert_eq!(
            candidates[3],
            PathBuf::from("/d")
                .join("Google")
                .join("Chrome")
                .join("Application")
                .join("chrome.exe")
        );
        assert_eq!(candidates.last().unwrap(), &PathBuf::from("/e/chrome.exe"));
    }

    #[test]
    fn each_registry_view_is_tried_in_turn() {
        let all = [
            "/hkcu/chrome.exe",
            "/hklm64/chrome.exe",
            "/hklm32/chrome.exe",
        ];
        let entries = AppPathEntries {
            hkcu: Some(PathBuf::from(all[0])),
            hklm_64: Some(PathBuf::from(all[1])),
            hklm_32: Some(PathBuf::from(all[2])),
        };

        for (index, winner) in all.iter().enumerate() {
            // Only the winner "exists"; everything before it is stale.
            let verify = installed(&[winner]);
            let resolved = candidate_paths(BrowserId::Chrome, &entries, &no_env, &no_path)
                .into_iter()
                .find_map(|c| verify(&c, "chrome.exe"));
            assert_eq!(resolved, Some(PathBuf::from(winner)), "view {index}");
        }
    }

    #[test]
    fn a_stale_registry_entry_falls_through_to_a_standard_location() {
        let entries = AppPathEntries {
            hkcu: Some(PathBuf::from("/uninstalled/chrome.exe")),
            ..Default::default()
        };
        let standard = PathBuf::from("/pf")
            .join("Google")
            .join("Chrome")
            .join("Application")
            .join("chrome.exe");
        let verify = installed(&[standard.to_str().unwrap()]);

        let resolved = candidate_paths(
            BrowserId::Chrome,
            &entries,
            &|var: &str| (var == "PROGRAMFILES").then(|| "/pf".to_string()),
            &no_path,
        )
        .into_iter()
        .find_map(|c| verify(&c, "chrome.exe"));

        assert_eq!(resolved, Some(standard));
    }

    #[test]
    fn path_lookup_is_the_last_resort() {
        let found = detect_with(
            |_| AppPathEntries::default(),
            no_env,
            |exe: &str| Some(PathBuf::from("/usr/bin").join(exe)),
            installed(&["/usr/bin/chrome.exe", "/usr/bin/msedge.exe"]),
        );
        assert_eq!(
            found[0].resolved_path.as_deref(),
            Some("/usr/bin/chrome.exe")
        );
        assert_eq!(
            found[1].resolved_path.as_deref(),
            Some("/usr/bin/msedge.exe")
        );
    }

    #[test]
    fn edge_prefers_the_x86_program_files_root() {
        let candidates = candidate_paths(
            BrowserId::Edge,
            &AppPathEntries::default(),
            &|var: &str| Some(format!("/{var}")),
            &no_path,
        );
        assert!(candidates[0].starts_with("/PROGRAMFILES(X86)"));
        assert!(candidates[0].ends_with("msedge.exe"));
    }

    // Real filesystem from here down: verification must reject directories and
    // wrong names, not just missing files.

    fn temp_exe(dir: &Path, name: &str) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, b"stub").unwrap();
        path
    }

    #[test]
    fn verification_rejects_a_directory_and_a_wrong_basename() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("chrome.exe");
        std::fs::create_dir(&dir).unwrap();
        assert_eq!(verify_executable(&dir, "chrome.exe"), None);

        let wrong = temp_exe(tmp.path(), "msedge.exe");
        assert_eq!(verify_executable(&wrong, "chrome.exe"), None);

        let missing = tmp.path().join("nothing.exe");
        assert_eq!(verify_executable(&missing, "chrome.exe"), None);

        let real = tmp.path().join("real");
        std::fs::create_dir(&real).unwrap();
        let right = temp_exe(&real, "chrome.exe");
        assert!(verify_executable(&right, "chrome.exe").is_some());
    }

    #[test]
    fn accepts_a_valid_chrome_and_edge_override() {
        let tmp = tempfile::tempdir().unwrap();
        let chrome = temp_exe(tmp.path(), "chrome.exe");
        let edge = temp_exe(tmp.path(), "msedge.exe");

        let c = validate_executable(BrowserId::Chrome, &chrome.to_string_lossy()).expect("chrome");
        let e = validate_executable(BrowserId::Edge, &edge.to_string_lossy()).expect("edge");

        assert!(c.ends_with("chrome.exe"));
        assert!(e.ends_with("msedge.exe"));
        for path in [&c, &e] {
            assert!(!path.contains('\\'), "not forward-slashed: {path}");
            assert!(!path.contains('?'), "verbatim prefix leaked: {path}");
        }
    }

    #[test]
    fn rejects_blank_and_relative_override_paths() {
        assert!(validate_executable(BrowserId::Chrome, "").is_err());
        assert!(validate_executable(BrowserId::Chrome, "   ").is_err());

        let err = validate_executable(BrowserId::Chrome, "chrome.exe").unwrap_err();
        assert!(err.contains("absolute"), "unexpected error: {err}");
    }

    #[test]
    fn rejects_a_missing_override_path() {
        let tmp = tempfile::tempdir().unwrap();
        let missing = tmp.path().join("chrome.exe");
        let err = validate_executable(BrowserId::Chrome, &missing.to_string_lossy()).unwrap_err();
        assert!(err.contains("not found"), "unexpected error: {err}");
    }

    #[test]
    fn rejects_a_directory_override_path() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("chrome.exe");
        std::fs::create_dir(&dir).unwrap();
        let err = validate_executable(BrowserId::Chrome, &dir.to_string_lossy()).unwrap_err();
        assert!(err.contains("regular file"), "unexpected error: {err}");
    }

    #[cfg(windows)]
    #[test]
    fn rejects_a_non_exe_override_path() {
        let tmp = tempfile::tempdir().unwrap();
        let bat = temp_exe(tmp.path(), "chrome.bat");
        let err = validate_executable(BrowserId::Chrome, &bat.to_string_lossy()).unwrap_err();
        assert!(err.contains(".exe"), "unexpected error: {err}");
    }

    #[test]
    fn rejects_the_wrong_browser_executable() {
        let tmp = tempfile::tempdir().unwrap();
        let edge = temp_exe(tmp.path(), "msedge.exe");

        let err = validate_executable(BrowserId::Chrome, &edge.to_string_lossy()).unwrap_err();
        assert!(err.contains("chrome.exe"), "unexpected error: {err}");

        let chrome = temp_exe(tmp.path(), "chrome.exe");
        let err = validate_executable(BrowserId::Edge, &chrome.to_string_lossy()).unwrap_err();
        assert!(err.contains("msedge.exe"), "unexpected error: {err}");
    }

    #[test]
    fn an_override_that_moves_fails_again_on_revalidation() {
        let tmp = tempfile::tempdir().unwrap();
        let chrome = temp_exe(tmp.path(), "chrome.exe");
        let saved = chrome.to_string_lossy().to_string();

        assert!(validate_executable(BrowserId::Chrome, &saved).is_ok());

        // Exactly what a browser update or uninstall does to a saved override.
        std::fs::remove_file(&chrome).unwrap();

        let err = validate_executable(BrowserId::Chrome, &saved).unwrap_err();
        assert!(err.contains("not found"), "unexpected error: {err}");
    }
}
