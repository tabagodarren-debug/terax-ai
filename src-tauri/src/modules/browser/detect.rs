//! Chrome and Edge detection, plus validation of an explicit executable
//! override.
//!
//! Every source is injected and the host family is an explicit [`Platform`]
//! argument, so the macOS rules are exercised by ordinary tests on any host
//! rather than only on a Mac. Detection never executes a browser, asks Launch
//! Services, reads a version, or inspects authentication.

use std::path::{Path, PathBuf};

use super::platform::{app_bundle_name, executable_name, Platform};
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

/// Environment variables holding the standard Windows install roots, most
/// likely first. Edge ships 32-bit-registered on 64-bit Windows, so its
/// ordering deliberately differs from Chrome's.
fn windows_roots(browser: BrowserId) -> &'static [&'static str] {
    match browser {
        BrowserId::Chrome => &["LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)"],
        BrowserId::Edge => &["PROGRAMFILES(X86)", "PROGRAMFILES", "LOCALAPPDATA"],
    }
}

/// Kept as components rather than a joined string so the candidate builder
/// behaves identically on every host and stays unit-testable.
fn windows_subpath(browser: BrowserId) -> &'static [&'static str] {
    match browser {
        BrowserId::Chrome => &["Google", "Chrome", "Application", "chrome.exe"],
        BrowserId::Edge => &["Microsoft", "Edge", "Application", "msedge.exe"],
    }
}

/// The executable inside a macOS `.app` bundle rooted at `root`.
fn macos_bundle_executable(root: &Path, browser: BrowserId) -> PathBuf {
    root.join(app_bundle_name(browser))
        .join("Contents")
        .join("MacOS")
        .join(executable_name(browser, Platform::MacOs))
}

/// Ordered candidates for one browser.
///
/// Windows: HKCU App Paths, the HKLM 64-bit view, the HKLM 32-bit view, the
/// standard install locations, then a GUI-safe PATH lookup.
///
/// macOS: system `/Applications`, then the user's `~/Applications`, then a
/// GUI-safe PATH lookup. A missing home directory only drops the second
/// candidate; it never fails detection.
///
/// Anything else produces no candidates at all, so the browser is reported
/// unavailable rather than guessed at from an unreviewed path list.
pub fn candidate_paths<E, P>(
    browser: BrowserId,
    platform: Platform,
    app_paths: &AppPathEntries,
    env: &E,
    home: Option<&Path>,
    path_lookup: &P,
) -> Vec<PathBuf>
where
    E: Fn(&str) -> Option<String>,
    P: Fn(&str) -> Option<PathBuf>,
{
    let mut candidates: Vec<PathBuf> = Vec::new();

    match platform {
        Platform::Windows => {
            candidates.extend(app_paths.in_order().cloned());

            for var in windows_roots(browser) {
                let Some(root) = env(var)
                    .map(|v| v.trim().to_string())
                    .filter(|v| !v.is_empty())
                else {
                    continue;
                };
                let mut candidate = PathBuf::from(root);
                for part in windows_subpath(browser) {
                    candidate.push(part);
                }
                candidates.push(candidate);
            }
        }
        Platform::MacOs => {
            candidates.push(macos_bundle_executable(Path::new("/Applications"), browser));
            if let Some(home) = home {
                candidates.push(macos_bundle_executable(&home.join("Applications"), browser));
            }
        }
        Platform::Other => return candidates,
    }

    if let Some(found) = path_lookup(executable_name(browser, platform)) {
        candidates.push(found);
    }

    candidates.dedup();
    candidates
}

/// What the filesystem says about one candidate, reduced to the four facts the
/// accept/reject policy actually depends on.
///
/// Splitting this out is what makes the policy itself pure: the macOS rules
/// can be asserted from a Windows host without a macOS filesystem.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CandidateFacts {
    pub is_file: bool,
    pub is_executable: bool,
    pub basename: String,
    pub has_exe_extension: bool,
}

/// Whether a candidate is an acceptable executable for `expected_exe`.
///
/// A macOS `.app` is a directory, so the regular-file rule rejects the bundle
/// without needing a special case for it.
pub fn accepts(facts: &CandidateFacts, expected_exe: &str, platform: Platform) -> bool {
    if !facts.is_file {
        return false;
    }
    if !facts.basename.eq_ignore_ascii_case(expected_exe) {
        return false;
    }
    match platform {
        // Windows has no execute bit; the extension is the executable marker.
        Platform::Windows => facts.has_exe_extension,
        // The bundle executable must actually be runnable.
        Platform::MacOs => facts.is_executable,
        Platform::Other => false,
    }
}

/// Reads the four facts for an already-canonicalized path.
fn facts_for(path: &Path) -> Option<CandidateFacts> {
    let metadata = std::fs::metadata(path).ok()?;
    Some(CandidateFacts {
        is_file: metadata.is_file(),
        is_executable: is_executable(&metadata),
        basename: path.file_name()?.to_str()?.to_string(),
        has_exe_extension: path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("exe")),
    })
}

/// At least one Unix execute bit. Windows has no equivalent, so the extension
/// carries that meaning there instead.
fn is_executable(metadata: &std::fs::Metadata) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        let _ = metadata;
        true
    }
}

/// Canonicalizes a candidate and proves it is an acceptable executable.
/// Stale entries, directories, `.app` bundles, non-executable files, and
/// wrong basenames all fall through here rather than being reported as
/// installed.
pub fn verify_executable(path: &Path, expected_exe: &str) -> Option<PathBuf> {
    verify_executable_for(path, expected_exe, Platform::host())
}

pub fn verify_executable_for(
    path: &Path,
    expected_exe: &str,
    platform: Platform,
) -> Option<PathBuf> {
    let canonical = std::fs::canonicalize(path).ok()?;
    let facts = facts_for(&canonical)?;
    accepts(&facts, expected_exe, platform).then_some(canonical)
}

/// Detects Chrome then Edge, in that fixed order, on every platform.
///
/// `available` is derived from `resolved_path`, never computed separately, so
/// the two can never disagree.
pub fn detect_with<R, E, P, V>(
    platform: Platform,
    app_paths: R,
    env: E,
    home: Option<&Path>,
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
            let expected = executable_name(*browser, platform);
            let resolved_path =
                candidate_paths(*browser, platform, &entries, &env, home, &path_lookup)
                    .into_iter()
                    .find_map(|candidate| verify(&candidate, expected))
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
    validate_executable_for(browser, raw, Platform::host())
}

pub fn validate_executable_for(
    browser: BrowserId,
    raw: &str,
    platform: Platform,
) -> Result<String, String> {
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
    let display = to_canon(&canonical);

    let facts = facts_for(&canonical)
        .ok_or_else(|| format!("cannot inspect browser executable: {display}"))?;

    // A macOS `.app` is a directory, so this is also what rejects a bundle
    // selected instead of the executable inside it.
    if !facts.is_file {
        return Err(format!(
            "browser executable is not a regular file: {display}"
        ));
    }

    match platform {
        Platform::Windows => {
            if !facts.has_exe_extension {
                return Err(format!("browser executable must be a .exe: {display}"));
            }
        }
        Platform::MacOs => {
            if !facts.is_executable {
                return Err(format!("browser executable is not executable: {display}"));
            }
        }
        Platform::Other => {
            return Err("selecting a browser executable is not supported on this system".into())
        }
    }

    let expected = executable_name(browser, platform);
    if !facts.basename.eq_ignore_ascii_case(expected) {
        return Err(format!(
            "{} requires {expected}, but the selected file is {}",
            browser.display_name(),
            facts.basename
        ));
    }

    Ok(display)
}
#[cfg(test)]
mod tests {
    use super::{
        accepts, candidate_paths, detect_with, validate_executable, validate_executable_for,
        verify_executable, verify_executable_for, AppPathEntries, CandidateFacts,
    };
    use crate::modules::browser::platform::Platform;
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
            Platform::Windows,
            |_| AppPathEntries::default(),
            no_env,
            None,
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
            Platform::Windows,
            entries_for(Some(CHROME), Some(EDGE)),
            no_env,
            None,
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
            Platform::Windows,
            entries_for(Some(CHROME), Some(EDGE)),
            no_env,
            None,
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
            Platform::Windows,
            entries_for(Some(CHROME), Some(EDGE)),
            no_env,
            None,
            no_path,
            installed(&[EDGE]),
        );
        assert!(!found[0].available);
        assert!(found[1].available);
    }

    #[test]
    fn reports_both_and_available_tracks_the_resolved_path() {
        let found = detect_with(
            Platform::Windows,
            entries_for(Some(CHROME), Some(EDGE)),
            no_env,
            None,
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
            Platform::Windows,
            entries_for(Some(CHROME), None),
            no_env,
            None,
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
            Platform::Windows,
            &entries,
            &|var: &str| (var == "LOCALAPPDATA").then(|| "/d".to_string()),
            None,
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
            let resolved = candidate_paths(
                BrowserId::Chrome,
                Platform::Windows,
                &entries,
                &no_env,
                None,
                &no_path,
            )
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
            Platform::Windows,
            &entries,
            &|var: &str| (var == "PROGRAMFILES").then(|| "/pf".to_string()),
            None,
            &no_path,
        )
        .into_iter()
        .find_map(|c| verify(&c, "chrome.exe"));

        assert_eq!(resolved, Some(standard));
    }

    #[test]
    fn path_lookup_is_the_last_resort() {
        let found = detect_with(
            Platform::Windows,
            |_| AppPathEntries::default(),
            no_env,
            None,
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
            Platform::Windows,
            &AppPathEntries::default(),
            &|var: &str| Some(format!("/{var}")),
            None,
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

    // ---- macOS rules -------------------------------------------------------
    //
    // These run on every host: `candidate_paths`, `accepts`, and
    // `validate_executable_for` all take the platform as an argument, so the
    // macOS policy is asserted here rather than only on a Mac. What genuinely
    // needs a Mac is the `flock` probe in `macos.rs` and the execute bit,
    // which no Windows filesystem can express.

    const MAC_CHROME: &str = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    const MAC_EDGE: &str = "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";

    fn mac_facts(basename: &str) -> CandidateFacts {
        CandidateFacts {
            is_file: true,
            is_executable: true,
            basename: basename.to_string(),
            has_exe_extension: false,
        }
    }

    fn user_bundle(home: &Path, bundle: &str, exe: &str) -> PathBuf {
        home.join("Applications")
            .join(bundle)
            .join("Contents")
            .join("MacOS")
            .join(exe)
    }

    #[test]
    fn macos_looks_in_applications_then_the_user_folder_then_path() {
        let home = PathBuf::from("/Users/afflow");
        let candidates = candidate_paths(
            BrowserId::Chrome,
            Platform::MacOs,
            &AppPathEntries::default(),
            &no_env,
            Some(&home),
            &|exe: &str| Some(PathBuf::from("/opt/homebrew/bin").join(exe)),
        );

        assert_eq!(
            candidates,
            vec![
                PathBuf::from(MAC_CHROME),
                user_bundle(&home, "Google Chrome.app", "Google Chrome"),
                PathBuf::from("/opt/homebrew/bin/Google Chrome"),
            ]
        );
    }

    #[test]
    fn macos_edge_uses_its_own_bundle_and_executable_name() {
        let candidates = candidate_paths(
            BrowserId::Edge,
            Platform::MacOs,
            &AppPathEntries::default(),
            &no_env,
            None,
            &no_path,
        );
        assert_eq!(candidates, vec![PathBuf::from(MAC_EDGE)]);
    }

    #[test]
    fn macos_ignores_the_registry_and_the_windows_environment_roots() {
        let entries = AppPathEntries {
            hkcu: Some(PathBuf::from(r"C:\stale\chrome.exe")),
            hklm_64: Some(PathBuf::from(r"C:\stale64\chrome.exe")),
            hklm_32: Some(PathBuf::from(r"C:\stale32\chrome.exe")),
        };
        let candidates = candidate_paths(
            BrowserId::Chrome,
            Platform::MacOs,
            &entries,
            &|var: &str| Some(format!("/{var}")),
            None,
            &no_path,
        );
        assert_eq!(candidates, vec![PathBuf::from(MAC_CHROME)]);
    }

    #[test]
    fn a_missing_home_directory_only_drops_the_user_applications_candidate() {
        let candidates = candidate_paths(
            BrowserId::Chrome,
            Platform::MacOs,
            &AppPathEntries::default(),
            &no_env,
            None,
            &no_path,
        );
        assert_eq!(candidates, vec![PathBuf::from(MAC_CHROME)]);
    }

    #[test]
    fn a_user_installed_copy_is_found_when_applications_is_empty() {
        let home = PathBuf::from("/Users/afflow");
        let user_copy = user_bundle(&home, "Google Chrome.app", "Google Chrome");
        let verify = installed(&[user_copy.to_str().unwrap()]);

        let resolved = candidate_paths(
            BrowserId::Chrome,
            Platform::MacOs,
            &AppPathEntries::default(),
            &no_env,
            Some(&home),
            &no_path,
        )
        .into_iter()
        .find_map(|c| verify(&c, "Google Chrome"));

        assert_eq!(resolved, Some(user_copy));
    }

    #[test]
    fn macos_detection_reports_chrome_and_edge_from_their_bundles() {
        let found = detect_with(
            Platform::MacOs,
            |_| AppPathEntries::default(),
            no_env,
            None,
            no_path,
            installed(&[MAC_CHROME, MAC_EDGE]),
        );
        assert_eq!(found[0].resolved_path.as_deref(), Some(MAC_CHROME));
        assert_eq!(found[1].resolved_path.as_deref(), Some(MAC_EDGE));
        for entry in &found {
            assert!(entry.available);
        }
    }

    #[test]
    fn an_unsupported_platform_produces_no_candidates_and_reports_unavailable() {
        // Linux: Chromium's SingletonLock is a dangling symlink there, so
        // Afflow deliberately has no reviewed candidate list to guess from.
        let candidates = candidate_paths(
            BrowserId::Chrome,
            Platform::Other,
            &AppPathEntries::default(),
            &|var: &str| Some(format!("/{var}")),
            Some(Path::new("/home/afflow")),
            &|exe: &str| Some(PathBuf::from("/usr/bin").join(exe)),
        );
        assert!(candidates.is_empty());

        let found = detect_with(
            Platform::Other,
            |_| AppPathEntries::default(),
            no_env,
            None,
            |exe: &str| Some(PathBuf::from("/usr/bin").join(exe)),
            installed(&["/usr/bin/chrome.exe", "/usr/bin/Google Chrome"]),
        );
        for entry in &found {
            assert!(!entry.available);
            assert_eq!(entry.resolved_path, None);
        }
    }

    #[test]
    fn the_app_bundle_itself_is_rejected_because_it_is_a_directory() {
        let bundle = CandidateFacts {
            is_file: false,
            is_executable: true,
            basename: "Google Chrome.app".to_string(),
            has_exe_extension: false,
        };
        assert!(!accepts(&bundle, "Google Chrome", Platform::MacOs));
    }

    #[test]
    fn a_macos_candidate_without_an_execute_bit_is_rejected() {
        let mut facts = mac_facts("Google Chrome");
        facts.is_executable = false;
        assert!(!accepts(&facts, "Google Chrome", Platform::MacOs));

        facts.is_executable = true;
        assert!(accepts(&facts, "Google Chrome", Platform::MacOs));
    }

    #[test]
    fn a_macos_candidate_with_the_wrong_basename_is_rejected() {
        assert!(!accepts(
            &mac_facts("Microsoft Edge"),
            "Google Chrome",
            Platform::MacOs
        ));
        assert!(!accepts(
            &mac_facts("Chromium"),
            "Google Chrome",
            Platform::MacOs
        ));
    }

    #[test]
    fn windows_still_demands_a_dot_exe_and_macos_does_not() {
        let no_extension = mac_facts("chrome.exe");
        // Same basename, but nothing that parses as a .exe extension.
        assert!(!accepts(&no_extension, "chrome.exe", Platform::Windows));

        let with_extension = CandidateFacts {
            has_exe_extension: true,
            ..no_extension
        };
        assert!(accepts(&with_extension, "chrome.exe", Platform::Windows));

        // macOS never looks at the extension at all.
        assert!(accepts(
            &mac_facts("Google Chrome"),
            "Google Chrome",
            Platform::MacOs
        ));
    }

    #[test]
    fn no_candidate_is_ever_accepted_on_an_unsupported_platform() {
        let facts = CandidateFacts {
            has_exe_extension: true,
            ..mac_facts("chrome.exe")
        };
        assert!(!accepts(&facts, "chrome.exe", Platform::Other));
    }

    #[test]
    fn a_macos_override_accepts_the_bundle_executable_and_rejects_the_bundle() {
        let tmp = tempfile::tempdir().unwrap();
        let bundle = tmp.path().join("Google Chrome.app");
        std::fs::create_dir(&bundle).unwrap();

        let err = validate_executable_for(
            BrowserId::Chrome,
            &bundle.to_string_lossy(),
            Platform::MacOs,
        )
        .unwrap_err();
        assert!(err.contains("regular file"), "unexpected error: {err}");

        let inner = bundle.join("Contents").join("MacOS");
        std::fs::create_dir_all(&inner).unwrap();
        let exe = inner.join("Google Chrome");
        std::fs::write(&exe, b"stub").unwrap();

        // A file written by a test is not executable on Unix, so a Mac
        // exercises the execute-bit refusal here and a Windows host exercises
        // the accept path. Both halves of the rule are asserted somewhere.
        let outcome =
            validate_executable_for(BrowserId::Chrome, &exe.to_string_lossy(), Platform::MacOs);
        if cfg!(unix) {
            let err = outcome.unwrap_err();
            assert!(err.contains("not executable"), "unexpected error: {err}");
        } else {
            let accepted = outcome.expect("bundle executable");
            assert!(accepted.ends_with("Google Chrome"));
            assert!(!accepted.contains('\\'), "not forward-slashed: {accepted}");
        }
    }

    #[test]
    fn a_macos_override_rejects_a_windows_executable_name() {
        let tmp = tempfile::tempdir().unwrap();
        let windows_exe = temp_exe(tmp.path(), "chrome.exe");
        let err = validate_executable_for(
            BrowserId::Chrome,
            &windows_exe.to_string_lossy(),
            Platform::MacOs,
        )
        .unwrap_err();
        assert!(err.contains("Google Chrome"), "unexpected error: {err}");
    }

    #[test]
    fn a_macos_override_rejects_edge_selected_for_chrome() {
        let tmp = tempfile::tempdir().unwrap();
        let edge = temp_exe(tmp.path(), "Microsoft Edge");
        let err =
            validate_executable_for(BrowserId::Chrome, &edge.to_string_lossy(), Platform::MacOs)
                .unwrap_err();
        assert!(err.contains("Google Chrome"), "unexpected error: {err}");
    }

    #[test]
    fn blank_relative_and_missing_overrides_are_rejected_on_macos_too() {
        assert!(validate_executable_for(BrowserId::Chrome, "  ", Platform::MacOs).is_err());

        let err = validate_executable_for(
            BrowserId::Chrome,
            "Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            Platform::MacOs,
        )
        .unwrap_err();
        assert!(err.contains("absolute"), "unexpected error: {err}");

        let tmp = tempfile::tempdir().unwrap();
        let missing = tmp.path().join("Google Chrome");
        let err = validate_executable_for(
            BrowserId::Chrome,
            &missing.to_string_lossy(),
            Platform::MacOs,
        )
        .unwrap_err();
        assert!(err.contains("not found"), "unexpected error: {err}");
    }

    #[test]
    fn an_override_is_refused_outright_on_an_unsupported_platform() {
        let tmp = tempfile::tempdir().unwrap();
        let exe = temp_exe(tmp.path(), "chrome.exe");
        let err =
            validate_executable_for(BrowserId::Chrome, &exe.to_string_lossy(), Platform::Other)
                .unwrap_err();
        assert!(err.contains("not supported"), "unexpected error: {err}");
    }

    #[test]
    fn verification_on_disk_agrees_with_the_platform_policy() {
        let tmp = tempfile::tempdir().unwrap();
        let exe = temp_exe(tmp.path(), "Google Chrome");

        // No platform accepts a candidate it has no rule for, and a file with
        // no .exe extension is never a Windows candidate.
        assert!(verify_executable_for(&exe, "Google Chrome", Platform::Other).is_none());
        assert!(verify_executable_for(&exe, "Google Chrome", Platform::Windows).is_none());
    }
}
