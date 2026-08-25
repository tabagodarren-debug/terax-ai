//! Afflow-managed browser profile containers.
//!
//! Every path here is derived natively from the app-local data directory. A
//! profile directory or user-data path is never accepted over IPC, and is
//! never derived from a workstation name. The frontend supplies only a browser
//! id and an opaque profile id.
//!
//! Layout, fixed:
//!
//! ```text
//! <base>/<browser-id>/<profile-id>/
//! |-- .afflow-profile.json
//! `-- user-data/
//! ```
//!
//! Chromium only ever sees the `user-data` path. The marker stays outside
//! browser-owned data so resetting user data never destroys Afflow's proof of
//! ownership.

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::platform::{is_link_like, probe_profile_lock, remove_tree_no_follow, LockProbe};
use super::{BrowserId, ProfileActivity};
use crate::modules::fs::to_canon;
use crate::modules::workstation::iso_time::iso8601_utc;

/// Directory under the app-local data dir that holds every managed profile.
pub const PROFILE_BASE_DIR: &str = "browser-profiles";
/// The only directory Chromium is ever pointed at.
pub const USER_DATA_DIR: &str = "user-data";
pub const MARKER_FILE: &str = ".afflow-profile.json";
pub const MARKER_SCHEMA_VERSION: u32 = 1;
const MAX_PROFILE_ID_LEN: usize = 64;

/// Windows device names are unusable as directories regardless of charset.
const RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Proof that a directory is Afflow's to manage. `deny_unknown_fields` means a
/// marker carrying anything beyond these four keys is rejected rather than
/// silently adopted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProfileMarker {
    pub schema_version: u32,
    pub browser_id: BrowserId,
    pub profile_id: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfilePaths {
    pub container: PathBuf,
    pub marker: PathBuf,
    pub user_data: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileStatus {
    pub profile_path: String,
    pub exists: bool,
    pub activity: ProfileActivity,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResetOutcome {
    pub profile_path: String,
    pub reset: bool,
    pub cleanup_pending: bool,
}

/// Accepts `[A-Za-z0-9][A-Za-z0-9_-]{0,63}` and nothing else.
///
/// The charset alone rules out traversal, separators, dots, drive prefixes,
/// whitespace, and non-ASCII; the reserved-name check covers the Windows
/// device names that would otherwise slip through it.
pub fn validate_profile_id(raw: &str) -> Result<&str, String> {
    if raw.is_empty() {
        return Err("browser profile id is empty".into());
    }
    if raw.len() > MAX_PROFILE_ID_LEN {
        return Err(format!(
            "browser profile id is longer than {MAX_PROFILE_ID_LEN} characters"
        ));
    }

    let mut chars = raw.chars();
    let first = chars.next().expect("non-empty");
    if !first.is_ascii_alphanumeric() {
        return Err(format!(
            "browser profile id must start with a letter or digit: {raw}"
        ));
    }
    for c in chars {
        if !(c.is_ascii_alphanumeric() || c == '_' || c == '-') {
            return Err(format!(
                "browser profile id has an invalid character: {raw}"
            ));
        }
    }
    if RESERVED_NAMES.iter().any(|r| r.eq_ignore_ascii_case(raw)) {
        return Err(format!("browser profile id is a reserved name: {raw}"));
    }

    Ok(raw)
}

/// Derives the managed paths. `base` is the native `browser-profiles`
/// directory; including the browser id in the path is what keeps Chrome and
/// Edge from ever sharing a user-data directory, even for the same logical
/// profile id.
pub fn derive_paths(
    base: &Path,
    browser: BrowserId,
    profile_id: &str,
) -> Result<ProfilePaths, String> {
    let id = validate_profile_id(profile_id)?;
    let container = base.join(browser.id()).join(id);
    Ok(ProfilePaths {
        marker: container.join(MARKER_FILE),
        user_data: container.join(USER_DATA_DIR),
        container,
    })
}

fn plain_directory_metadata(path: &Path, label: &str) -> Result<Option<fs::Metadata>, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if is_link_like(&metadata) {
                return Err(format!(
                    "{label} is a link or reparse point and cannot be used: {}",
                    to_canon(path)
                ));
            }
            if !metadata.is_dir() {
                return Err(format!("{label} is not a directory: {}", to_canon(path)));
            }
            Ok(Some(metadata))
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("cannot inspect {label}: {e}")),
    }
}

fn validate_managed_base(base: &Path, create: bool) -> Result<Option<PathBuf>, String> {
    let parent = base
        .parent()
        .ok_or_else(|| "the managed profile base has no parent directory".to_string())?;
    let parent_canon = match fs::canonicalize(parent) {
        Ok(canonical) => canonical,
        Err(e) if e.kind() == io::ErrorKind::NotFound && !create => return Ok(None),
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            fs::create_dir_all(parent)
                .map_err(|e| format!("cannot create the Afflow data directory: {e}"))?;
            fs::canonicalize(parent)
                .map_err(|e| format!("cannot resolve the Afflow data directory: {e}"))?
        }
        Err(e) => return Err(format!("cannot resolve the Afflow data directory: {e}")),
    };

    if plain_directory_metadata(base, "the managed profile base")?.is_none() {
        if !create {
            return Ok(None);
        }
        fs::create_dir(base).map_err(|e| format!("cannot create the profile base: {e}"))?;
        plain_directory_metadata(base, "the managed profile base")?.ok_or_else(|| {
            "the managed profile base disappeared while being created".to_string()
        })?;
    }

    let base_canon = fs::canonicalize(base)
        .map_err(|e| format!("cannot resolve the managed profile base: {e}"))?;
    if base_canon.parent() != Some(parent_canon.as_path()) {
        return Err(format!(
            "the managed profile base resolves outside the Afflow data directory: {}",
            to_canon(&base_canon)
        ));
    }
    Ok(Some(base_canon))
}

fn validate_browser_family(
    base: &Path,
    base_canon: &Path,
    browser: BrowserId,
    create: bool,
) -> Result<Option<PathBuf>, String> {
    let family = base.join(browser.id());
    if plain_directory_metadata(&family, "the browser profile family directory")?.is_none() {
        if !create {
            return Ok(None);
        }
        fs::create_dir(&family)
            .map_err(|e| format!("cannot create the browser profile directory: {e}"))?;
        plain_directory_metadata(&family, "the browser profile family directory")?.ok_or_else(
            || "the browser profile directory disappeared while being created".to_string(),
        )?;
    }
    require_contained(base_canon, &family, "the browser profile family directory").map(Some)
}

fn require_contained(base_canon: &Path, path: &Path, label: &str) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path).map_err(|e| format!("cannot resolve {label}: {e}"))?;
    if !canonical.starts_with(base_canon) {
        return Err(format!(
            "{label} resolves outside the managed profile base: {}",
            to_canon(&canonical)
        ));
    }
    Ok(canonical)
}

fn read_marker(
    marker: &Path,
    browser: BrowserId,
    profile_id: &str,
) -> Result<ProfileMarker, String> {
    let metadata = fs::symlink_metadata(marker).map_err(|e| {
        if e.kind() == io::ErrorKind::NotFound {
            "this directory is not an Afflow-managed browser profile".to_string()
        } else {
            format!("cannot inspect the browser profile marker: {e}")
        }
    })?;
    if is_link_like(&metadata) {
        return Err("the browser profile marker is a link or reparse point".into());
    }
    if !metadata.is_file() {
        return Err("the browser profile marker is not a regular file".into());
    }

    let raw = fs::read_to_string(marker).map_err(|e| {
        if e.kind() == io::ErrorKind::NotFound {
            "this directory is not an Afflow-managed browser profile".to_string()
        } else {
            format!("cannot read the browser profile marker: {e}")
        }
    })?;

    let parsed: ProfileMarker = serde_json::from_str(&raw)
        .map_err(|e| format!("the browser profile marker is malformed: {e}"))?;

    if parsed.schema_version != MARKER_SCHEMA_VERSION {
        return Err(format!(
            "unsupported browser profile marker version: {}",
            parsed.schema_version
        ));
    }
    if parsed.browser_id != browser || parsed.profile_id != profile_id {
        return Err("the browser profile marker does not match this profile".into());
    }
    Ok(parsed)
}

fn write_new_marker(path: &Path, marker: &ProfileMarker) -> Result<(), String> {
    let body = serde_json::to_string_pretty(marker)
        .map_err(|e| format!("cannot serialize the browser profile marker: {e}"))?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| format!("cannot create the browser profile marker: {e}"))?;
    if let Err(e) = file.write_all(body.as_bytes()) {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(format!("cannot write the browser profile marker: {e}"));
    }
    Ok(())
}

/// Validates or creates the managed container, then returns canonical paths.
///
/// A pre-existing directory without a matching marker is never adopted: that
/// is the rule that stops Afflow from pointing Chromium at, or later deleting,
/// something it did not create.
pub fn ensure_container(
    base: &Path,
    browser: BrowserId,
    profile_id: &str,
    now_secs: u64,
) -> Result<ProfilePaths, String> {
    let paths = derive_paths(base, browser, profile_id)?;

    let base_canon = validate_managed_base(base, true)?
        .ok_or_else(|| "the managed profile base could not be created".to_string())?;
    validate_browser_family(base, &base_canon, browser, true)?
        .ok_or_else(|| "the browser profile directory could not be created".to_string())?;

    if plain_directory_metadata(&paths.container, "the browser profile directory")?.is_some() {
        read_marker(&paths.marker, browser, profile_id)?;
    } else {
        fs::create_dir(&paths.container)
            .map_err(|e| format!("cannot create the browser profile directory: {e}"))?;
        let marker = ProfileMarker {
            schema_version: MARKER_SCHEMA_VERSION,
            browser_id: browser,
            profile_id: profile_id.to_string(),
            created_at: iso8601_utc(now_secs),
        };
        if let Err(e) = write_new_marker(&paths.marker, &marker) {
            // An unmarked directory could never be adopted later, so do not
            // leave one behind.
            let _ = fs::remove_dir(&paths.container);
            return Err(e);
        }
    }

    if plain_directory_metadata(&paths.user_data, "the browser user-data directory")?.is_none() {
        fs::create_dir(&paths.user_data)
            .map_err(|e| format!("cannot create the browser user-data directory: {e}"))?;
        plain_directory_metadata(&paths.user_data, "the browser user-data directory")?.ok_or_else(
            || "the browser user-data directory disappeared while being created".to_string(),
        )?;
    }

    let container = require_contained(
        &base_canon,
        &paths.container,
        "the browser profile directory",
    )?;
    let user_data = require_contained(
        &base_canon,
        &paths.user_data,
        "the browser user-data directory",
    )?;

    Ok(ProfilePaths {
        marker: container.join(MARKER_FILE),
        container,
        user_data,
    })
}

/// Maps a lock probe and native child tracking onto a reported activity.
///
/// A tracked live child is proof of `Active`, but its absence proves nothing:
/// Chromium forwards a launch to an existing instance and exits, and Afflow
/// can restart while the browser stays open. Only the lock probe can say
/// `Idle`, and anything ambiguous stays `Unknown`.
pub fn activity_from(probe: LockProbe, has_live_child: bool) -> ProfileActivity {
    if has_live_child {
        return ProfileActivity::Active;
    }
    match probe {
        LockProbe::Busy => ProfileActivity::Active,
        LockProbe::Free => ProfileActivity::Idle,
        LockProbe::Unknown => ProfileActivity::Unknown,
    }
}

/// Probes the host's Chromium lock for this profile. The lock file's name and
/// locking mechanism are platform-specific, so both are chosen in
/// `platform.rs` rather than here.
pub fn probe_activity(user_data: &Path, has_live_child: bool) -> ProfileActivity {
    activity_from(probe_profile_lock(user_data), has_live_child)
}

/// Read-only status. Never creates a directory or a marker: a profile that has
/// never been launched reports its derived path with `exists: false`.
pub fn status(
    base: &Path,
    browser: BrowserId,
    profile_id: &str,
    has_live_child: bool,
) -> Result<ProfileStatus, String> {
    let paths = derive_paths(base, browser, profile_id)?;

    let missing = || ProfileStatus {
        profile_path: to_canon(&paths.user_data),
        exists: false,
        activity: if has_live_child {
            ProfileActivity::Active
        } else {
            ProfileActivity::Idle
        },
    };

    let Some(base_canon) = validate_managed_base(base, false)? else {
        return Ok(missing());
    };
    if validate_browser_family(base, &base_canon, browser, false)?.is_none() {
        return Ok(missing());
    }
    if plain_directory_metadata(&paths.container, "the browser profile directory")?.is_none() {
        return Ok(missing());
    }

    read_marker(&paths.marker, browser, profile_id)?;

    require_contained(
        &base_canon,
        &paths.container,
        "the browser profile directory",
    )?;

    if plain_directory_metadata(&paths.user_data, "the browser user-data directory")?.is_none() {
        return Ok(ProfileStatus {
            profile_path: to_canon(&paths.user_data),
            exists: false,
            activity: if has_live_child {
                ProfileActivity::Active
            } else {
                ProfileActivity::Idle
            },
        });
    }

    let user_data = require_contained(
        &base_canon,
        &paths.user_data,
        "the browser user-data directory",
    )?;
    Ok(ProfileStatus {
        profile_path: to_canon(&user_data),
        exists: true,
        activity: probe_activity(&user_data, has_live_child),
    })
}

/// Clears one managed profile's user data.
///
/// `activity` is supplied by the caller so it is computed inside the same
/// per-profile lock that guards the reset itself. The browser is never killed:
/// `Active` and `Unknown` both refuse.
pub fn reset(
    base: &Path,
    browser: BrowserId,
    profile_id: &str,
    confirmed: bool,
    activity: ProfileActivity,
    now_secs: u64,
) -> Result<ResetOutcome, String> {
    reset_with(
        base,
        browser,
        profile_id,
        confirmed,
        activity,
        now_secs,
        &ResetOps {
            rename: &|from, to| fs::rename(from, to),
            create_dir: &|path| fs::create_dir(path),
            cleanup: &remove_tree_no_follow,
        },
    )
}

/// The two mutating steps, injected so their failure paths are testable
/// without depending on filesystem timing or open-handle behaviour.
pub struct ResetOps<'a> {
    pub rename: &'a dyn Fn(&Path, &Path) -> io::Result<()>,
    pub create_dir: &'a dyn Fn(&Path) -> io::Result<()>,
    pub cleanup: &'a dyn Fn(&Path) -> io::Result<()>,
}

pub fn reset_with(
    base: &Path,
    browser: BrowserId,
    profile_id: &str,
    confirmed: bool,
    activity: ProfileActivity,
    now_secs: u64,
    ops: &ResetOps<'_>,
) -> Result<ResetOutcome, String> {
    if !confirmed {
        return Err("resetting a browser profile requires explicit confirmation".into());
    }

    let paths = derive_paths(base, browser, profile_id)?;
    let base_canon = validate_managed_base(base, false)?
        .ok_or_else(|| "this Afflow-managed browser profile has not been created".to_string())?;
    validate_browser_family(base, &base_canon, browser, false)?
        .ok_or_else(|| "this Afflow-managed browser profile has not been created".to_string())?;
    plain_directory_metadata(&paths.container, "the browser profile directory")?
        .ok_or_else(|| "this Afflow-managed browser profile has not been created".to_string())?;
    read_marker(&paths.marker, browser, profile_id)?;

    match activity {
        ProfileActivity::Active => {
            return Err("close this browser profile's window before resetting it".into())
        }
        ProfileActivity::Unknown => {
            return Err(
                "cannot confirm this browser profile is closed; close the browser and try again"
                    .into(),
            )
        }
        ProfileActivity::Idle => {}
    }

    // Revalidate containment and link safety immediately before mutating.
    let base_canon = validate_managed_base(base, false)?
        .ok_or_else(|| "the managed profile base disappeared before reset".to_string())?;
    validate_browser_family(base, &base_canon, browser, false)?
        .ok_or_else(|| "the browser profile directory disappeared before reset".to_string())?;
    plain_directory_metadata(&paths.container, "the browser profile directory")?
        .ok_or_else(|| "the browser profile directory disappeared before reset".to_string())?;
    read_marker(&paths.marker, browser, profile_id)?;
    let container = require_contained(
        &base_canon,
        &paths.container,
        "the browser profile directory",
    )?;

    if plain_directory_metadata(&paths.user_data, "the browser user-data directory")?.is_none() {
        return Ok(ResetOutcome {
            profile_path: to_canon(&paths.user_data),
            reset: true,
            cleanup_pending: false,
        });
    }

    let user_data = require_contained(
        &base_canon,
        &paths.user_data,
        "the browser user-data directory",
    )?;

    // Rename first: it is atomic, it is a sibling so it stays on the same
    // volume, and a failure leaves the original profile untouched.
    let quarantine = container.join(quarantine_name(now_secs));
    (ops.rename)(&user_data, &quarantine)
        .map_err(|e| format!("cannot clear the browser profile: {e}"))?;

    if let Err(create_error) = (ops.create_dir)(&user_data) {
        // Put it back rather than leaving the profile with no user-data.
        return match (ops.rename)(&quarantine, &user_data) {
            Ok(()) => Err(format!(
                "cannot recreate the browser user-data directory: {create_error}; the original profile was restored"
            )),
            Err(rollback_error) => Err(format!(
                "cannot recreate the browser user-data directory: {create_error}; automatic rollback also failed: {rollback_error}; the original data remains at {}",
                to_canon(&quarantine)
            )),
        };
    }

    // The logical reset has happened. Deletion is best-effort from here, and a
    // failure is reported rather than claimed as a success.
    let cleanup_pending = match (ops.cleanup)(&quarantine) {
        Ok(()) => false,
        Err(e) => {
            log::debug!("browser profile quarantine cleanup failed: {e}");
            true
        }
    };

    Ok(ResetOutcome {
        profile_path: to_canon(&user_data),
        reset: true,
        cleanup_pending,
    })
}

/// Sibling of `user-data`, so the rename is same-volume and atomic. The random
/// suffix keeps repeated resets from colliding within the same second.
fn quarantine_name(now_secs: u64) -> String {
    let mut bytes = [0u8; 6];
    // Uniqueness only; a nanosecond fallback is fine if the OS RNG is
    // unavailable, because the rename would simply fail on a collision.
    if getrandom::fill(&mut bytes).is_err() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or_default();
        bytes[..4].copy_from_slice(&nanos.to_le_bytes());
    }
    let suffix: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!("{USER_DATA_DIR}.quarantine-{now_secs}-{suffix}")
}

#[cfg(test)]
mod tests {
    use super::{
        activity_from, derive_paths, ensure_container, reset, reset_with, status,
        validate_profile_id, ProfileMarker, ResetOps, MARKER_FILE, MARKER_SCHEMA_VERSION,
        USER_DATA_DIR,
    };
    use crate::modules::browser::platform::LockProbe;
    use crate::modules::browser::{BrowserId, ProfileActivity};
    use std::io;
    use std::path::{Path, PathBuf};

    const NOW: u64 = 1_770_000_000;

    fn base() -> (tempfile::TempDir, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path().join("browser-profiles");
        (tmp, base)
    }

    // ---- profile id validation ------------------------------------------

    #[test]
    fn accepts_the_shared_and_workstation_id_shapes() {
        for id in [
            "shared-v1",
            "ws-alpha",
            "workstation_01",
            "a",
            "A1",
            "9",
            &"a".repeat(64),
        ] {
            assert!(
                validate_profile_id(id).is_ok(),
                "should have accepted {id:?}"
            );
        }
    }

    #[test]
    fn rejects_traversal_separators_and_drive_prefixes() {
        for id in [
            "..",
            "../escape",
            "..\\escape",
            "a/b",
            "a\\b",
            "/abs",
            "C:",
            "C:/Windows",
            r"\\server\share",
            "a.b",
            ".hidden",
            "shared.v1",
        ] {
            assert!(
                validate_profile_id(id).is_err(),
                "should have rejected {id:?}"
            );
        }
    }

    #[test]
    fn rejects_whitespace_unicode_and_control_characters() {
        for id in [
            "",
            " ",
            "a b",
            " leading",
            "trailing ",
            "a\tb",
            "a\nb",
            "prof\u{0}ile",
            "profil\u{e9}",
            "\u{5de}\u{5e9}",
            "-leading-dash",
            "_leading_underscore",
        ] {
            assert!(
                validate_profile_id(id).is_err(),
                "should have rejected {id:?}"
            );
        }
    }

    #[test]
    fn rejects_reserved_windows_device_names_in_any_case() {
        for id in ["CON", "con", "NUL", "nul", "COM1", "lpt9", "AUX", "prn"] {
            let err = validate_profile_id(id).unwrap_err();
            assert!(err.contains("reserved"), "unexpected error for {id}: {err}");
        }
        // Only the bare device name is reserved.
        assert!(validate_profile_id("console").is_ok());
        assert!(validate_profile_id("com10").is_ok());
    }

    #[test]
    fn rejects_an_overlength_id() {
        let long = "a".repeat(65);
        let err = validate_profile_id(&long).unwrap_err();
        assert!(err.contains("longer than"), "unexpected error: {err}");
    }

    // ---- path derivation -------------------------------------------------

    #[test]
    fn the_same_pair_always_derives_the_same_path() {
        let (_tmp, base) = base();
        let a = derive_paths(&base, BrowserId::Chrome, "shared-v1").unwrap();
        let b = derive_paths(&base, BrowserId::Chrome, "shared-v1").unwrap();
        assert_eq!(a, b);
        assert_eq!(a.user_data, a.container.join(USER_DATA_DIR));
        assert_eq!(a.marker, a.container.join(MARKER_FILE));
    }

    #[test]
    fn chrome_and_edge_never_share_a_path_for_the_same_id() {
        let (_tmp, base) = base();
        let chrome = derive_paths(&base, BrowserId::Chrome, "shared-v1").unwrap();
        let edge = derive_paths(&base, BrowserId::Edge, "shared-v1").unwrap();

        assert_ne!(chrome.container, edge.container);
        assert_ne!(chrome.user_data, edge.user_data);
        assert!(chrome.container.starts_with(base.join("chrome")));
        assert!(edge.container.starts_with(base.join("edge")));
    }

    #[test]
    fn two_workstation_profiles_never_collide() {
        let (_tmp, base) = base();
        let a = derive_paths(&base, BrowserId::Chrome, "ws-alpha").unwrap();
        let b = derive_paths(&base, BrowserId::Chrome, "ws-beta").unwrap();
        assert_ne!(a.user_data, b.user_data);
    }

    #[test]
    fn derived_paths_stay_under_the_managed_base() {
        let (_tmp, base) = base();
        for browser in BrowserId::ALL {
            for id in ["shared-v1", "ws-alpha"] {
                let paths = derive_paths(&base, browser, id).unwrap();
                assert!(paths.container.starts_with(&base));
                assert!(paths.user_data.starts_with(&base));
                assert!(paths.marker.starts_with(&base));
            }
        }
    }

    // ---- container creation and ownership --------------------------------

    #[test]
    fn creates_the_container_marker_and_user_data_directory() {
        let (_tmp, base) = base();
        let paths = ensure_container(&base, BrowserId::Chrome, "shared-v1", NOW).unwrap();

        assert!(paths.container.is_dir());
        assert!(paths.user_data.is_dir());
        assert!(paths.marker.is_file());

        let marker: ProfileMarker =
            serde_json::from_str(&std::fs::read_to_string(&paths.marker).unwrap()).unwrap();
        assert_eq!(marker.schema_version, MARKER_SCHEMA_VERSION);
        assert_eq!(marker.browser_id, BrowserId::Chrome);
        assert_eq!(marker.profile_id, "shared-v1");
        assert!(marker.created_at.ends_with('Z'), "{}", marker.created_at);
    }

    #[test]
    fn launch_creation_can_initialize_a_missing_app_data_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let app_data = tmp.path().join("new-app-data");
        let base = app_data.join("browser-profiles");

        let paths = ensure_container(&base, BrowserId::Chrome, "shared-v1", NOW).unwrap();

        assert!(app_data.is_dir());
        assert!(paths.marker.is_file());
        assert!(paths.user_data.is_dir());
    }

    #[test]
    fn re_ensuring_accepts_a_matching_marker_and_is_idempotent() {
        let (_tmp, base) = base();
        let first = ensure_container(&base, BrowserId::Chrome, "shared-v1", NOW).unwrap();
        let created = std::fs::read_to_string(&first.marker).unwrap();

        let second = ensure_container(&base, BrowserId::Chrome, "shared-v1", NOW + 500).unwrap();

        assert_eq!(first, second);
        // The original creation timestamp is preserved, not rewritten.
        assert_eq!(created, std::fs::read_to_string(&second.marker).unwrap());
    }

    #[test]
    fn refuses_an_unmarked_pre_existing_directory() {
        let (_tmp, base) = base();
        let container = base.join("chrome").join("shared-v1");
        std::fs::create_dir_all(container.join("user-data")).unwrap();
        std::fs::write(container.join("user-data").join("Cookies"), b"private").unwrap();

        let err = ensure_container(&base, BrowserId::Chrome, "shared-v1", NOW).unwrap_err();
        assert!(
            err.contains("not an Afflow-managed"),
            "unexpected error: {err}"
        );
        // Nothing was taken over or destroyed.
        assert!(container.join("user-data").join("Cookies").is_file());
    }

    fn write_marker(dir: &Path, body: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join(MARKER_FILE), body).unwrap();
    }

    #[test]
    fn refuses_a_marker_naming_a_different_browser_or_profile() {
        let (_tmp, base) = base();

        let container = base.join("chrome").join("shared-v1");
        write_marker(
            &container,
            r#"{"schemaVersion":1,"browserId":"edge","profileId":"shared-v1","createdAt":"2026-01-01T00:00:00Z"}"#,
        );
        let err = ensure_container(&base, BrowserId::Chrome, "shared-v1", NOW).unwrap_err();
        assert!(err.contains("does not match"), "unexpected error: {err}");

        let other = base.join("chrome").join("ws-alpha");
        write_marker(
            &other,
            r#"{"schemaVersion":1,"browserId":"chrome","profileId":"shared-v1","createdAt":"2026-01-01T00:00:00Z"}"#,
        );
        let err = ensure_container(&base, BrowserId::Chrome, "ws-alpha", NOW).unwrap_err();
        assert!(err.contains("does not match"), "unexpected error: {err}");
    }

    #[test]
    fn refuses_a_malformed_or_wrong_version_marker() {
        let (_tmp, base) = base();

        let container = base.join("chrome").join("shared-v1");
        write_marker(&container, "{not json");
        let err = ensure_container(&base, BrowserId::Chrome, "shared-v1", NOW).unwrap_err();
        assert!(err.contains("malformed"), "unexpected error: {err}");

        write_marker(
            &container,
            r#"{"schemaVersion":99,"browserId":"chrome","profileId":"shared-v1","createdAt":"2026-01-01T00:00:00Z"}"#,
        );
        let err = ensure_container(&base, BrowserId::Chrome, "shared-v1", NOW).unwrap_err();
        assert!(err.contains("unsupported"), "unexpected error: {err}");
    }

    #[test]
    fn refuses_a_marker_carrying_extra_fields() {
        let (_tmp, base) = base();
        let container = base.join("chrome").join("shared-v1");
        write_marker(
            &container,
            r#"{"schemaVersion":1,"browserId":"chrome","profileId":"shared-v1","createdAt":"2026-01-01T00:00:00Z","userDataDir":"C:/elsewhere"}"#,
        );

        let err = ensure_container(&base, BrowserId::Chrome, "shared-v1", NOW).unwrap_err();
        assert!(err.contains("malformed"), "unexpected error: {err}");
    }

    #[test]
    fn an_invalid_id_never_touches_the_filesystem() {
        let (_tmp, base) = base();
        assert!(ensure_container(&base, BrowserId::Chrome, "../escape", NOW).is_err());
        assert!(!base.exists(), "base should not have been created");
    }

    // ---- link and reparse-point escapes ----------------------------------

    /// Creates a real directory link, or returns false when the host does not
    /// permit one, so the escape tests never pass vacuously.
    fn make_dir_link(link: &Path, target: &Path) -> bool {
        #[cfg(windows)]
        {
            // A junction needs no elevation, and is the reparse point an
            // attacker on Windows would actually be able to plant.
            let status = std::process::Command::new("cmd")
                .args(["/c", "mklink", "/J"])
                .arg(link)
                .arg(target)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();
            matches!(status, Ok(s) if s.success()) && link.exists()
        }
        #[cfg(not(windows))]
        {
            std::os::unix::fs::symlink(target, link).is_ok() && link.exists()
        }
    }

    fn make_file_link(link: &Path, target: &Path) -> bool {
        #[cfg(windows)]
        {
            std::os::windows::fs::symlink_file(target, link).is_ok() && link.exists()
        }
        #[cfg(not(windows))]
        {
            std::os::unix::fs::symlink(target, link).is_ok() && link.exists()
        }
    }

    #[test]
    fn refuses_a_linked_container() {
        let (tmp, base) = base();
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::create_dir_all(base.join("chrome")).unwrap();

        let container = base.join("chrome").join("shared-v1");
        if !make_dir_link(&container, &outside) {
            eprintln!("skipping: this host cannot create a directory link");
            return;
        }

        for result in [
            ensure_container(&base, BrowserId::Chrome, "shared-v1", NOW).map(|_| ()),
            status(&base, BrowserId::Chrome, "shared-v1", false).map(|_| ()),
            reset(
                &base,
                BrowserId::Chrome,
                "shared-v1",
                true,
                ProfileActivity::Idle,
                NOW,
            )
            .map(|_| ()),
        ] {
            let err = result.unwrap_err();
            assert!(
                err.contains("link or reparse point"),
                "unexpected error: {err}"
            );
        }
    }

    #[test]
    fn refuses_a_linked_user_data_directory() {
        let (tmp, base) = base();
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("important.txt"), b"keep me").unwrap();

        let paths = ensure_container(&base, BrowserId::Chrome, "shared-v1", NOW).unwrap();
        std::fs::remove_dir_all(&paths.user_data).unwrap();
        if !make_dir_link(&paths.user_data, &outside) {
            eprintln!("skipping: this host cannot create a directory link");
            return;
        }

        let err = status(&base, BrowserId::Chrome, "shared-v1", false).unwrap_err();
        assert!(
            err.contains("link or reparse point"),
            "unexpected error: {err}"
        );

        let err = reset(
            &base,
            BrowserId::Chrome,
            "shared-v1",
            true,
            ProfileActivity::Idle,
            NOW,
        )
        .unwrap_err();
        assert!(
            err.contains("link or reparse point"),
            "unexpected error: {err}"
        );

        // The link target was never followed or emptied.
        assert!(outside.join("important.txt").is_file());
    }

    #[test]
    fn refuses_a_linked_browser_family_directory() {
        let (tmp, base) = base();
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::create_dir_all(&base).unwrap();

        let family = base.join("chrome");
        if !make_dir_link(&family, &outside) {
            eprintln!("skipping: this host cannot create a directory link");
            return;
        }

        let err = ensure_container(&base, BrowserId::Chrome, "shared-v1", NOW).unwrap_err();
        assert!(
            err.contains("link or reparse point"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn refuses_a_linked_managed_profile_base() {
        let tmp = tempfile::tempdir().unwrap();
        let app_data = tmp.path().join("app-data");
        let outside = tmp.path().join("outside");
        std::fs::create_dir(&app_data).unwrap();
        std::fs::create_dir(&outside).unwrap();
        let base = app_data.join("browser-profiles");
        if !make_dir_link(&base, &outside) {
            eprintln!("skipping: this host cannot create a directory link");
            return;
        }

        for result in [
            ensure_container(&base, BrowserId::Chrome, "shared-v1", NOW).map(|_| ()),
            status(&base, BrowserId::Chrome, "shared-v1", false).map(|_| ()),
            reset(
                &base,
                BrowserId::Chrome,
                "shared-v1",
                true,
                ProfileActivity::Idle,
                NOW,
            )
            .map(|_| ()),
        ] {
            let err = result.unwrap_err();
            assert!(
                err.contains("link or reparse point"),
                "unexpected error: {err}"
            );
        }
        assert!(!outside.join("chrome").exists());
    }

    #[test]
    fn refuses_a_linked_marker_file() {
        let (tmp, base) = base();
        let container = base.join("chrome").join("shared-v1");
        std::fs::create_dir_all(container.join(USER_DATA_DIR)).unwrap();
        let external = tmp.path().join("external-marker.json");
        std::fs::write(
            &external,
            r#"{"schemaVersion":1,"browserId":"chrome","profileId":"shared-v1","createdAt":"2026-01-01T00:00:00Z"}"#,
        )
        .unwrap();
        if !make_file_link(&container.join(MARKER_FILE), &external) {
            eprintln!("skipping: this host cannot create a file link");
            return;
        }

        for result in [
            ensure_container(&base, BrowserId::Chrome, "shared-v1", NOW).map(|_| ()),
            status(&base, BrowserId::Chrome, "shared-v1", false).map(|_| ()),
            reset(
                &base,
                BrowserId::Chrome,
                "shared-v1",
                true,
                ProfileActivity::Idle,
                NOW,
            )
            .map(|_| ()),
        ] {
            let err = result.unwrap_err();
            assert!(
                err.contains("marker is a link or reparse point"),
                "unexpected error: {err}"
            );
        }
        assert!(external.is_file());
    }

    #[test]
    fn unexpected_directory_entries_are_errors_not_missing_profiles() {
        let (_tmp, base) = base();
        std::fs::create_dir(&base).unwrap();
        std::fs::write(base.join("chrome"), b"not a directory").unwrap();

        let status_error = status(&base, BrowserId::Chrome, "shared-v1", false).unwrap_err();
        assert!(status_error.contains("not a directory"));

        let reset_error = reset(
            &base,
            BrowserId::Chrome,
            "shared-v1",
            true,
            ProfileActivity::Idle,
            NOW,
        )
        .unwrap_err();
        assert!(reset_error.contains("not a directory"));
    }

    // ---- status ----------------------------------------------------------

    #[test]
    fn status_reports_a_never_launched_profile_without_creating_it() {
        let (_tmp, base) = base();
        let reported = status(&base, BrowserId::Chrome, "shared-v1", false).unwrap();

        assert!(!reported.exists);
        assert_eq!(reported.activity, ProfileActivity::Idle);
        assert!(reported.profile_path.ends_with("user-data"));
        assert!(!base.exists(), "status must not create anything");
    }

    #[test]
    fn status_does_not_create_a_missing_app_data_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let app_data = tmp.path().join("missing-app-data");
        let base = app_data.join("browser-profiles");

        let reported = status(&base, BrowserId::Chrome, "shared-v1", false).unwrap();

        assert!(!reported.exists);
        assert_eq!(reported.activity, ProfileActivity::Idle);
        assert!(!app_data.exists());
    }

    #[test]
    fn status_returns_the_user_data_path_forward_slashed() {
        let (_tmp, base) = base();
        ensure_container(&base, BrowserId::Chrome, "shared-v1", NOW).unwrap();

        let reported = status(&base, BrowserId::Chrome, "shared-v1", false).unwrap();
        assert!(reported.exists);
        assert!(!reported.profile_path.contains('\\'));
        assert!(reported
            .profile_path
            .ends_with("chrome/shared-v1/user-data"));
        // Internal implementation details never reach the response.
        assert!(!reported.profile_path.contains(MARKER_FILE));
    }

    #[test]
    fn status_reports_a_tracked_live_child_as_active() {
        let (_tmp, base) = base();
        ensure_container(&base, BrowserId::Chrome, "shared-v1", NOW).unwrap();

        let idle = status(&base, BrowserId::Chrome, "shared-v1", false).unwrap();
        let live = status(&base, BrowserId::Chrome, "shared-v1", true).unwrap();

        assert_eq!(live.activity, ProfileActivity::Active);
        assert_ne!(idle.activity, ProfileActivity::Active);
    }

    // ---- activity mapping -------------------------------------------------

    #[test]
    fn a_live_child_is_active_regardless_of_the_lock_probe() {
        for probe in [LockProbe::Free, LockProbe::Busy, LockProbe::Unknown] {
            assert_eq!(activity_from(probe, true), ProfileActivity::Active);
        }
    }

    #[test]
    fn the_lock_probe_decides_when_no_child_is_tracked() {
        // A pruned or exited child leaves the probe as the only evidence, which
        // is the case that matters: Chromium relaunches forward and exit.
        assert_eq!(
            activity_from(LockProbe::Busy, false),
            ProfileActivity::Active
        );
        assert_eq!(activity_from(LockProbe::Free, false), ProfileActivity::Idle);
        assert_eq!(
            activity_from(LockProbe::Unknown, false),
            ProfileActivity::Unknown
        );
    }

    #[test]
    fn a_missing_lockfile_reads_as_idle() {
        let (_tmp, base) = base();
        let paths = ensure_container(&base, BrowserId::Chrome, "shared-v1", NOW).unwrap();
        assert!(!paths.user_data.join("lockfile").exists());

        assert_eq!(
            super::probe_activity(&paths.user_data, false),
            ProfileActivity::Idle
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_lockfile_held_with_no_sharing_reads_as_active() {
        use std::fs::OpenOptions;
        use std::os::windows::fs::OpenOptionsExt;

        let (_tmp, base) = base();
        let paths = ensure_container(&base, BrowserId::Chrome, "shared-v1", NOW).unwrap();
        let lockfile = paths.user_data.join("lockfile");
        std::fs::write(&lockfile, b"").unwrap();

        // Chromium's ProcessSingleton keeps this open with no sharing.
        let held = OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&lockfile)
            .unwrap();
        assert_eq!(
            super::probe_activity(&paths.user_data, false),
            ProfileActivity::Active
        );

        drop(held);
        assert_eq!(
            super::probe_activity(&paths.user_data, false),
            ProfileActivity::Idle
        );
    }

    // ---- reset -----------------------------------------------------------

    fn seeded(base: &Path, browser: BrowserId, id: &str) -> super::ProfilePaths {
        let paths = ensure_container(base, browser, id, NOW).unwrap();
        std::fs::write(paths.user_data.join("Cookies"), b"cookie data").unwrap();
        std::fs::create_dir_all(paths.user_data.join("Default")).unwrap();
        std::fs::write(paths.user_data.join("Default").join("History"), b"history").unwrap();
        paths
    }

    #[test]
    fn reset_requires_explicit_confirmation() {
        let (_tmp, base) = base();
        let paths = seeded(&base, BrowserId::Chrome, "shared-v1");

        let err = reset(
            &base,
            BrowserId::Chrome,
            "shared-v1",
            false,
            ProfileActivity::Idle,
            NOW,
        )
        .unwrap_err();
        assert!(err.contains("confirmation"), "unexpected error: {err}");
        assert!(paths.user_data.join("Cookies").is_file());
    }

    #[test]
    fn reset_refuses_an_active_or_unknown_profile_without_touching_it() {
        let (_tmp, base) = base();
        let paths = seeded(&base, BrowserId::Chrome, "shared-v1");

        let err = reset(
            &base,
            BrowserId::Chrome,
            "shared-v1",
            true,
            ProfileActivity::Active,
            NOW,
        )
        .unwrap_err();
        assert!(
            err.contains("close this browser"),
            "unexpected error: {err}"
        );

        let err = reset(
            &base,
            BrowserId::Chrome,
            "shared-v1",
            true,
            ProfileActivity::Unknown,
            NOW,
        )
        .unwrap_err();
        assert!(err.contains("cannot confirm"), "unexpected error: {err}");

        assert!(paths.user_data.join("Cookies").is_file());
        assert!(paths.user_data.join("Default").join("History").is_file());
    }

    #[test]
    fn a_successful_reset_clears_user_data_and_preserves_the_marker() {
        let (_tmp, base) = base();
        let paths = seeded(&base, BrowserId::Chrome, "shared-v1");
        let marker_before = std::fs::read(&paths.marker).unwrap();

        let outcome = reset(
            &base,
            BrowserId::Chrome,
            "shared-v1",
            true,
            ProfileActivity::Idle,
            NOW,
        )
        .unwrap();

        assert!(outcome.reset);
        assert!(!outcome.cleanup_pending);
        assert!(outcome.profile_path.ends_with("chrome/shared-v1/user-data"));

        assert!(paths.user_data.is_dir());
        assert_eq!(std::fs::read_dir(&paths.user_data).unwrap().count(), 0);

        // Byte for byte: the marker is Afflow's proof of ownership.
        assert_eq!(std::fs::read(&paths.marker).unwrap(), marker_before);
        // And no quarantine directory is left behind.
        let leftovers: Vec<_> = std::fs::read_dir(&paths.container)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .filter(|n| n.contains("quarantine"))
            .collect();
        assert!(leftovers.is_empty(), "leftover quarantine: {leftovers:?}");
    }

    #[test]
    fn reset_is_idempotent_when_user_data_is_missing() {
        let (_tmp, base) = base();
        let paths = ensure_container(&base, BrowserId::Chrome, "shared-v1", NOW).unwrap();
        std::fs::remove_dir_all(&paths.user_data).unwrap();

        let outcome = reset(
            &base,
            BrowserId::Chrome,
            "shared-v1",
            true,
            ProfileActivity::Idle,
            NOW,
        )
        .unwrap();
        assert!(outcome.reset);
        assert!(!outcome.cleanup_pending);
    }

    #[test]
    fn reset_rejects_a_profile_that_was_never_created() {
        let (_tmp, base) = base();
        let err = reset(
            &base,
            BrowserId::Chrome,
            "shared-v1",
            true,
            ProfileActivity::Idle,
            NOW,
        )
        .unwrap_err();
        assert!(
            err.contains("has not been created"),
            "unexpected error: {err}"
        );
        assert!(!base.exists());
    }

    #[test]
    fn reset_never_crosses_a_browser_family_or_another_profile() {
        let (_tmp, base) = base();
        let chrome = seeded(&base, BrowserId::Chrome, "shared-v1");
        let edge = seeded(&base, BrowserId::Edge, "shared-v1");
        let other = seeded(&base, BrowserId::Chrome, "ws-alpha");

        reset(
            &base,
            BrowserId::Chrome,
            "shared-v1",
            true,
            ProfileActivity::Idle,
            NOW,
        )
        .unwrap();

        assert_eq!(std::fs::read_dir(&chrome.user_data).unwrap().count(), 0);
        assert!(edge.user_data.join("Cookies").is_file());
        assert!(other.user_data.join("Cookies").is_file());
    }

    #[test]
    fn reset_refuses_an_unmarked_directory() {
        let (_tmp, base) = base();
        let container = base.join("chrome").join("shared-v1");
        std::fs::create_dir_all(container.join(USER_DATA_DIR)).unwrap();
        std::fs::write(container.join(USER_DATA_DIR).join("Cookies"), b"private").unwrap();

        let err = reset(
            &base,
            BrowserId::Chrome,
            "shared-v1",
            true,
            ProfileActivity::Idle,
            NOW,
        )
        .unwrap_err();
        assert!(
            err.contains("not an Afflow-managed"),
            "unexpected error: {err}"
        );
        assert!(container.join(USER_DATA_DIR).join("Cookies").is_file());
    }

    #[test]
    fn reset_rejects_an_invalid_profile_id_before_doing_anything() {
        let (_tmp, base) = base();
        for id in ["../escape", "a/b", "CON", ""] {
            assert!(reset(
                &base,
                BrowserId::Chrome,
                id,
                true,
                ProfileActivity::Idle,
                NOW
            )
            .is_err());
        }
    }

    // The two mutating steps, exercised through their failure paths.

    fn failing_rename(_from: &Path, _to: &Path) -> io::Result<()> {
        Err(io::Error::other("rename refused"))
    }

    fn real_rename(from: &Path, to: &Path) -> io::Result<()> {
        std::fs::rename(from, to)
    }

    fn real_create_dir(path: &Path) -> io::Result<()> {
        std::fs::create_dir(path)
    }

    #[test]
    fn a_rename_failure_leaves_the_original_profile_intact() {
        let (_tmp, base) = base();
        let paths = seeded(&base, BrowserId::Chrome, "shared-v1");

        let err = reset_with(
            &base,
            BrowserId::Chrome,
            "shared-v1",
            true,
            ProfileActivity::Idle,
            NOW,
            &ResetOps {
                rename: &failing_rename,
                create_dir: &real_create_dir,
                cleanup: &|_| Ok(()),
            },
        )
        .unwrap_err();

        assert!(err.contains("cannot clear"), "unexpected error: {err}");
        assert!(paths.user_data.join("Cookies").is_file());
        assert!(paths.user_data.join("Default").join("History").is_file());
        assert!(paths.marker.is_file());
    }

    #[test]
    fn a_recreate_failure_rolls_the_quarantine_back() {
        let (_tmp, base) = base();
        let paths = seeded(&base, BrowserId::Chrome, "shared-v1");

        let err = reset_with(
            &base,
            BrowserId::Chrome,
            "shared-v1",
            true,
            ProfileActivity::Idle,
            NOW,
            &ResetOps {
                rename: &real_rename,
                create_dir: &|_| Err(io::Error::other("create refused")),
                cleanup: &|_| Ok(()),
            },
        )
        .unwrap_err();

        assert!(err.contains("original profile was restored"), "{err}");
        assert!(paths.user_data.join("Cookies").is_file());
        assert!(paths.user_data.join("Default").join("History").is_file());
        assert!(std::fs::read_dir(&paths.container)
            .unwrap()
            .all(|entry| !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains("quarantine")));
    }

    #[test]
    fn a_rollback_failure_reports_where_the_original_data_remains() {
        let (_tmp, base) = base();
        let paths = seeded(&base, BrowserId::Chrome, "shared-v1");
        let calls = std::cell::Cell::new(0usize);

        let err = reset_with(
            &base,
            BrowserId::Chrome,
            "shared-v1",
            true,
            ProfileActivity::Idle,
            NOW,
            &ResetOps {
                rename: &|from, to| {
                    let call = calls.get();
                    calls.set(call + 1);
                    if call == 0 {
                        std::fs::rename(from, to)
                    } else {
                        Err(io::Error::other("rollback refused"))
                    }
                },
                create_dir: &|_| Err(io::Error::other("create refused")),
                cleanup: &|_| Ok(()),
            },
        )
        .unwrap_err();

        assert!(err.contains("automatic rollback also failed"), "{err}");
        assert!(err.contains("user-data.quarantine-"), "{err}");
        assert!(!paths.user_data.exists());
        let quarantine = std::fs::read_dir(&paths.container)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| {
                path.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .contains("quarantine")
            })
            .expect("quarantined original data");
        assert!(quarantine.join("Cookies").is_file());
    }

    #[test]
    fn a_cleanup_failure_still_resets_but_reports_cleanup_pending() {
        let (_tmp, base) = base();
        let paths = seeded(&base, BrowserId::Chrome, "shared-v1");

        let outcome = reset_with(
            &base,
            BrowserId::Chrome,
            "shared-v1",
            true,
            ProfileActivity::Idle,
            NOW,
            &ResetOps {
                rename: &real_rename,
                create_dir: &real_create_dir,
                cleanup: &|_| Err(io::Error::other("still in use")),
            },
        )
        .unwrap();

        assert!(outcome.reset, "the logical reset did happen");
        assert!(outcome.cleanup_pending);
        // The user's profile is empty; only the quarantine copy survives.
        assert_eq!(std::fs::read_dir(&paths.user_data).unwrap().count(), 0);
        let quarantined = std::fs::read_dir(&paths.container)
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().contains("quarantine"));
        assert!(quarantined);
    }

    #[test]
    fn the_quarantine_directory_is_a_sibling_of_user_data() {
        let (_tmp, base) = base();
        let paths = seeded(&base, BrowserId::Chrome, "shared-v1");
        let seen = std::cell::RefCell::new(Vec::new());

        reset_with(
            &base,
            BrowserId::Chrome,
            "shared-v1",
            true,
            ProfileActivity::Idle,
            NOW,
            &ResetOps {
                rename: &|from: &Path, to: &Path| {
                    seen.borrow_mut().push(to.to_path_buf());
                    std::fs::rename(from, to)
                },
                create_dir: &real_create_dir,
                cleanup: &|p: &Path| std::fs::remove_dir_all(p),
            },
        )
        .unwrap();

        let quarantine = &seen.borrow()[0];
        assert_eq!(quarantine.parent(), paths.user_data.parent());
        assert!(quarantine.starts_with(&paths.container));
        let name = quarantine
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();
        assert!(name.starts_with("user-data.quarantine-"), "{name}");
    }

    #[test]
    fn repeated_resets_do_not_collide_on_a_quarantine_name() {
        let (_tmp, base) = base();
        let names = std::cell::RefCell::new(Vec::new());

        for _ in 0..8 {
            seeded(&base, BrowserId::Chrome, "shared-v1");
            reset_with(
                &base,
                BrowserId::Chrome,
                "shared-v1",
                true,
                ProfileActivity::Idle,
                NOW, // the same second every time
                &ResetOps {
                    rename: &|from: &Path, to: &Path| {
                        names.borrow_mut().push(to.to_path_buf());
                        std::fs::rename(from, to)
                    },
                    create_dir: &real_create_dir,
                    cleanup: &|p: &Path| std::fs::remove_dir_all(p),
                },
            )
            .unwrap();
        }

        let names = names.borrow();
        let unique: std::collections::HashSet<&PathBuf> = names.iter().collect();
        assert_eq!(unique.len(), names.len(), "quarantine names collided");
    }

    // ---- macOS SingletonLock end to end ---------------------------------
    //
    // The activity mapping and the reset rules are already asserted on every
    // host through `activity_from` and `reset_with`. What only a Mac can prove
    // is that a real Chromium-shaped `flock` on `SingletonLock` reaches those
    // rules through `probe_activity` and `reset`.

    #[cfg(target_os = "macos")]
    mod macos_singleton_lock {
        use super::{base, ensure_container, reset, status, NOW};
        use crate::modules::browser::profile::probe_activity;
        use crate::modules::browser::{BrowserId, ProfileActivity};
        use std::fs::File;
        use std::os::fd::AsRawFd;
        use std::path::{Path, PathBuf};

        const LOCK_CONTENTS: &[u8] = b"afflow-host-4321";

        fn managed_user_data(base: &Path) -> PathBuf {
            ensure_container(base, BrowserId::Chrome, "shared-v1", NOW)
                .unwrap()
                .user_data
        }

        fn write_singleton_lock(user_data: &Path) -> PathBuf {
            let lock = user_data.join("SingletonLock");
            std::fs::write(&lock, LOCK_CONTENTS).unwrap();
            lock
        }

        fn hold_exclusive(path: &Path) -> File {
            let file = File::options().read(true).write(true).open(path).unwrap();
            let taken = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
            assert_eq!(taken, 0, "the test could not hold the lock it needs");
            file
        }

        #[test]
        fn a_held_singleton_lock_reports_active_and_refuses_reset() {
            let (_tmp, base) = base();
            let user_data = managed_user_data(&base);
            let lock = write_singleton_lock(&user_data);
            let held = hold_exclusive(&lock);

            // No tracked child: this is a browser Afflow did not spawn, or one
            // that outlived an Afflow restart. Only the lock proves it is live.
            let activity = probe_activity(&user_data, false);
            assert_eq!(activity, ProfileActivity::Active);

            let err =
                reset(&base, BrowserId::Chrome, "shared-v1", true, activity, NOW).unwrap_err();
            assert!(
                err.contains("close this browser"),
                "unexpected error: {err}"
            );

            // The browser was never signalled and its lock was never removed,
            // renamed, truncated, or repaired.
            assert!(lock.exists());
            assert_eq!(std::fs::read(&lock).unwrap(), LOCK_CONTENTS);
            drop(held);
        }

        #[test]
        fn status_reports_active_while_the_lock_is_held() {
            let (_tmp, base) = base();
            let user_data = managed_user_data(&base);
            let held = hold_exclusive(&write_singleton_lock(&user_data));

            let reported = status(&base, BrowserId::Chrome, "shared-v1", false).unwrap();
            assert_eq!(reported.activity, ProfileActivity::Active);
            assert!(reported.exists);
            drop(held);
        }

        #[test]
        fn a_leftover_unlocked_singleton_lock_reports_idle_and_resets() {
            // Exactly the state after a Chromium crash, or after Afflow was
            // restarted while the browser had already exited: the file is
            // still there, but nobody holds it.
            let (_tmp, base) = base();
            let user_data = managed_user_data(&base);
            let lock = write_singleton_lock(&user_data);
            std::fs::write(user_data.join("Cookies"), b"session").unwrap();

            let activity = probe_activity(&user_data, false);
            assert_eq!(activity, ProfileActivity::Idle);

            let outcome =
                reset(&base, BrowserId::Chrome, "shared-v1", true, activity, NOW).unwrap();
            assert!(outcome.reset);

            // User data really was cleared, and Chromium's file went with it
            // as ordinary profile content, never as a repair step.
            assert!(user_data.is_dir());
            assert!(!lock.exists());
            assert!(!user_data.join("Cookies").exists());
        }

        #[test]
        fn a_profile_that_never_launched_has_no_lock_and_resets_cleanly() {
            let (_tmp, base) = base();
            let user_data = managed_user_data(&base);
            assert!(!user_data.join("SingletonLock").exists());

            let activity = probe_activity(&user_data, false);
            assert_eq!(activity, ProfileActivity::Idle);
            assert!(
                reset(&base, BrowserId::Chrome, "shared-v1", true, activity, NOW)
                    .unwrap()
                    .reset
            );
        }

        #[test]
        fn a_tracked_child_reports_active_even_before_the_lock_appears() {
            // Chromium creates SingletonLock a moment after launch. A tracked
            // child is proof on its own, so the window in between is never
            // reported as idle.
            let (_tmp, base) = base();
            let user_data = managed_user_data(&base);
            assert!(!user_data.join("SingletonLock").exists());

            assert_eq!(probe_activity(&user_data, true), ProfileActivity::Active);
        }

        #[test]
        fn a_symlinked_singleton_lock_is_unknown_and_reset_refuses() {
            let (_tmp, base) = base();
            let user_data = managed_user_data(&base);
            let outside = user_data.parent().unwrap().join("elsewhere");
            std::fs::write(&outside, b"keep me").unwrap();
            std::os::unix::fs::symlink(&outside, user_data.join("SingletonLock")).unwrap();

            let activity = probe_activity(&user_data, false);
            assert_eq!(activity, ProfileActivity::Unknown);

            let err =
                reset(&base, BrowserId::Chrome, "shared-v1", true, activity, NOW).unwrap_err();
            assert!(err.contains("cannot confirm"), "unexpected error: {err}");
            assert_eq!(std::fs::read(&outside).unwrap(), b"keep me");
        }
    }
}
