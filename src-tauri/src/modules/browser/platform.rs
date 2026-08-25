//! Platform dispatch for the browser module.
//!
//! Everything that differs between Windows and macOS is decided here, as a
//! function of an explicit [`Platform`] rather than of `cfg!`. That is what
//! lets the macOS detection and validation rules be tested from a Windows
//! host: only the genuinely native mechanics (registry reads, `CreateFileW`
//! sharing, `flock`) live behind `cfg` in `windows.rs` and `macos.rs`.
//!
//! The link-safety helpers also live here. They read as platform-specific but
//! are used unconditionally by profile handling, and the rule they enforce,
//! never following a link out of the managed profile, is the same everywhere.

use std::io;
use std::path::Path;

use super::BrowserId;

/// Result of asking whether Chromium currently holds a profile's lock.
///
/// `Unknown` is deliberately distinct from `Free`: reset must fail closed, so
/// "I could not tell" must never be mistaken for "nothing is running".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LockProbe {
    /// Nothing holds the lock, or the lock file does not exist.
    Free,
    /// The lock is held: Windows sharing violation, or a refused `flock`.
    Busy,
    /// Permission denial, a redirected path, or any unexpected error.
    Unknown,
}

/// The host families Afflow supports, as data rather than as `cfg!`.
///
/// `Other` is every remaining target. Linux lands here deliberately: Chromium
/// uses a dangling `SingletonLock` symlink there rather than an advisory lock,
/// so neither the macOS probe nor the Windows one would give a truthful
/// answer, and detection has no reviewed candidate list.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Windows,
    MacOs,
    Other,
}

impl Platform {
    pub fn host() -> Self {
        if cfg!(windows) {
            Platform::Windows
        } else if cfg!(target_os = "macos") {
            Platform::MacOs
        } else {
            Platform::Other
        }
    }
}

/// The exact executable basename a verified candidate must have.
///
/// macOS runs the executable inside the `.app` bundle, whose name carries a
/// space and no extension. `Other` reuses the Windows names only so the
/// function is total; it never matches anything, because that platform
/// produces no candidates at all.
pub fn executable_name(browser: BrowserId, platform: Platform) -> &'static str {
    match (platform, browser) {
        (Platform::MacOs, BrowserId::Chrome) => "Google Chrome",
        (Platform::MacOs, BrowserId::Edge) => "Microsoft Edge",
        (_, BrowserId::Chrome) => "chrome.exe",
        (_, BrowserId::Edge) => "msedge.exe",
    }
}

/// The name of the `.app` bundle holding the macOS executable. Identical to
/// the executable basename, which is why the bundle directory itself is
/// rejected by the regular-file check rather than by a special case.
pub fn app_bundle_name(browser: BrowserId) -> &'static str {
    match browser {
        BrowserId::Chrome => "Google Chrome.app",
        BrowserId::Edge => "Microsoft Edge.app",
    }
}

/// Chromium's per-profile lock file, selected per platform rather than probed
/// under both names.
///
/// `None` means this platform has no lock Afflow knows how to read, so
/// activity can never be proven idle and reset fails closed.
pub fn lock_file_name(platform: Platform) -> Option<&'static str> {
    match platform {
        // chrome/browser/process_singleton_win.cc
        Platform::Windows => Some("lockfile"),
        // chrome/browser/process_singleton_mac.cc
        Platform::MacOs => Some("SingletonLock"),
        Platform::Other => None,
    }
}

/// Probes the profile lock for `user_data` using the host's native mechanism.
pub fn probe_profile_lock(user_data: &Path) -> LockProbe {
    let Some(name) = lock_file_name(Platform::host()) else {
        return LockProbe::Unknown;
    };
    let lock = user_data.join(name);

    #[cfg(windows)]
    {
        super::windows::probe_lock(&lock)
    }
    #[cfg(target_os = "macos")]
    {
        super::macos::probe_lock(&lock)
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = lock;
        LockProbe::Unknown
    }
}

/// True for symlinks, junctions, and any other reparse point.
///
/// Used to refuse a managed profile container that has been redirected
/// somewhere outside the app-local base, and to stop recursive cleanup from
/// following a link out of the quarantine directory.
pub fn is_link_like(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

/// Whether the entry is a directory on disk, independent of whether it is also
/// a reparse point. Unix symlinks always unlink with `remove_file`, so only
/// Windows needs the raw attribute.
fn is_directory_attr(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_DIRECTORY;
        metadata.file_attributes() & FILE_ATTRIBUTE_DIRECTORY != 0
    }
    #[cfg(not(windows))]
    {
        let _ = metadata;
        false
    }
}

/// Removes a tree without ever descending through a link.
///
/// A link is unlinked, never followed, so a junction or symlink planted inside
/// a quarantined profile cannot redirect deletion outside the managed base.
pub fn remove_tree_no_follow(path: &Path) -> io::Result<()> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };

    if is_link_like(&metadata) {
        // Unlink the link itself, never its target. On Windows a directory-like
        // reparse point needs `remove_dir` even though nothing is inside it,
        // and `Metadata::is_dir` cannot be used to spot one: Rust classifies a
        // junction as a symlink, so `is_dir` is false for it. The raw directory
        // attribute is what actually distinguishes the two. On Unix every
        // symlink, including one to a directory, unlinks with `remove_file`.
        return if is_directory_attr(&metadata) {
            std::fs::remove_dir(path)
        } else {
            std::fs::remove_file(path)
        };
    }

    if metadata.is_dir() {
        for entry in std::fs::read_dir(path)? {
            remove_tree_no_follow(&entry?.path())?;
        }
        std::fs::remove_dir(path)
    } else {
        std::fs::remove_file(path)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        app_bundle_name, executable_name, is_link_like, lock_file_name, remove_tree_no_follow,
        Platform,
    };
    use crate::modules::browser::BrowserId;
    use std::path::Path;

    fn make_dir_link(link: &Path, target: &Path) -> bool {
        #[cfg(windows)]
        {
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

    #[test]
    fn the_host_platform_matches_the_compilation_target() {
        let host = Platform::host();
        if cfg!(windows) {
            assert_eq!(host, Platform::Windows);
        } else if cfg!(target_os = "macos") {
            assert_eq!(host, Platform::MacOs);
        } else {
            assert_eq!(host, Platform::Other);
        }
    }

    #[test]
    fn macos_expects_the_bundle_executable_names() {
        assert_eq!(
            executable_name(BrowserId::Chrome, Platform::MacOs),
            "Google Chrome"
        );
        assert_eq!(
            executable_name(BrowserId::Edge, Platform::MacOs),
            "Microsoft Edge"
        );
        assert_eq!(app_bundle_name(BrowserId::Chrome), "Google Chrome.app");
        assert_eq!(app_bundle_name(BrowserId::Edge), "Microsoft Edge.app");
    }

    #[test]
    fn windows_expects_the_exe_names() {
        assert_eq!(
            executable_name(BrowserId::Chrome, Platform::Windows),
            "chrome.exe"
        );
        assert_eq!(
            executable_name(BrowserId::Edge, Platform::Windows),
            "msedge.exe"
        );
    }

    #[test]
    fn each_platform_selects_its_own_chromium_lock_file() {
        // chrome/browser/process_singleton_win.cc and _mac.cc.
        assert_eq!(lock_file_name(Platform::Windows), Some("lockfile"));
        assert_eq!(lock_file_name(Platform::MacOs), Some("SingletonLock"));
        // Linux uses a dangling symlink instead of a lock Afflow can read, so
        // there is deliberately no name to probe.
        assert_eq!(lock_file_name(Platform::Other), None);
    }

    #[test]
    fn a_plain_directory_and_file_are_not_link_like() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("plain");
        std::fs::create_dir(&dir).unwrap();
        let file = tmp.path().join("plain.txt");
        std::fs::write(&file, b"x").unwrap();

        assert!(!is_link_like(&std::fs::symlink_metadata(&dir).unwrap()));
        assert!(!is_link_like(&std::fs::symlink_metadata(&file).unwrap()));
    }

    #[test]
    fn a_real_directory_link_is_link_like() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("target");
        std::fs::create_dir(&target).unwrap();
        let link = tmp.path().join("link");
        if !make_dir_link(&link, &target) {
            eprintln!("skipping: this host cannot create a directory link");
            return;
        }

        assert!(is_link_like(&std::fs::symlink_metadata(&link).unwrap()));
    }

    #[test]
    fn removes_a_nested_tree() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("quarantine");
        std::fs::create_dir_all(root.join("Default").join("Cache")).unwrap();
        std::fs::write(root.join("Cookies"), b"x").unwrap();
        std::fs::write(root.join("Default").join("History"), b"y").unwrap();
        std::fs::write(root.join("Default").join("Cache").join("data_0"), b"z").unwrap();

        remove_tree_no_follow(&root).unwrap();
        assert!(!root.exists());
    }

    #[test]
    fn removing_a_missing_path_succeeds() {
        let tmp = tempfile::tempdir().unwrap();
        remove_tree_no_follow(&tmp.path().join("never-existed")).unwrap();
    }

    #[test]
    fn cleanup_unlinks_a_planted_link_without_following_it() {
        let tmp = tempfile::tempdir().unwrap();
        let outside = tmp.path().join("outside");
        std::fs::create_dir(&outside).unwrap();
        std::fs::write(outside.join("important.txt"), b"keep me").unwrap();

        let root = tmp.path().join("quarantine");
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("Cookies"), b"x").unwrap();
        if !make_dir_link(&root.join("escape"), &outside) {
            eprintln!("skipping: this host cannot create a directory link");
            return;
        }

        remove_tree_no_follow(&root).unwrap();

        assert!(!root.exists(), "the quarantine tree should be gone");
        // The link was unlinked, never descended: its target is untouched.
        assert!(outside.is_dir());
        assert!(outside.join("important.txt").is_file());
    }

    #[test]
    fn cleanup_unlinks_a_link_passed_as_the_root() {
        let tmp = tempfile::tempdir().unwrap();
        let outside = tmp.path().join("outside");
        std::fs::create_dir(&outside).unwrap();
        std::fs::write(outside.join("important.txt"), b"keep me").unwrap();

        let link = tmp.path().join("link");
        if !make_dir_link(&link, &outside) {
            eprintln!("skipping: this host cannot create a directory link");
            return;
        }

        remove_tree_no_follow(&link).unwrap();

        assert!(!link.exists());
        assert!(outside.join("important.txt").is_file());
    }
}
