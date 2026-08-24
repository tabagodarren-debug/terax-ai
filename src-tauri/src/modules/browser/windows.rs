//! Platform probes for the browser module: Windows App Paths registry lookup,
//! the Chromium `lockfile` sharing probe, and reparse-point detection.
//!
//! Everything here is isolated behind small functions so the Chromium
//! ProcessSingleton details can change without touching profile logic. See
//! `chrome/browser/process_singleton_win.cc` upstream.

use std::io;
use std::path::{Path, PathBuf};

/// Result of asking whether Chromium currently holds a profile's `lockfile`.
/// `Unknown` is deliberately distinct from `Free`: reset must fail closed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LockProbe {
    /// Nothing holds the lock, or the lockfile does not exist.
    Free,
    /// The lock is held with exclusive sharing semantics.
    Busy,
    /// Permission denial or an unexpected error. Never treat as idle.
    Unknown,
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

/// Reads the `App Paths` default value for `exe` from HKCU, then the HKLM
/// 64-bit view, then the HKLM 32-bit view, in that order.
///
/// A value is returned exactly as the registry holds it; the caller still has
/// to verify that it points at a real executable, because uninstalled browsers
/// routinely leave stale entries behind.
#[cfg(windows)]
pub fn read_app_paths(exe: &str) -> [Option<PathBuf>; 3] {
    use windows_sys::Win32::System::Registry::{
        HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_WOW64_32KEY, KEY_WOW64_64KEY,
    };

    [
        read_app_path_value(HKEY_CURRENT_USER, 0, exe),
        read_app_path_value(HKEY_LOCAL_MACHINE, KEY_WOW64_64KEY, exe),
        read_app_path_value(HKEY_LOCAL_MACHINE, KEY_WOW64_32KEY, exe),
    ]
}

#[cfg(not(windows))]
pub fn read_app_paths(_exe: &str) -> [Option<PathBuf>; 3] {
    [None, None, None]
}

#[cfg(windows)]
fn read_app_path_value(
    root: windows_sys::Win32::System::Registry::HKEY,
    view: windows_sys::Win32::System::Registry::REG_SAM_FLAGS,
    exe: &str,
) -> Option<PathBuf> {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegGetValueW, RegOpenKeyExW, HKEY, KEY_READ, RRF_RT_REG_EXPAND_SZ,
        RRF_RT_REG_SZ,
    };

    let subkey = wide(&format!(
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{exe}"
    ));

    unsafe {
        let mut key: HKEY = std::ptr::null_mut();
        if RegOpenKeyExW(root, subkey.as_ptr(), 0, KEY_READ | view, &mut key) != ERROR_SUCCESS {
            return None;
        }

        // Two-pass: ask for the byte count, then read. RegGetValueW expands
        // REG_EXPAND_SZ for us, which App Paths entries sometimes use.
        let flags = RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ;
        let mut bytes: u32 = 0;
        let sized = RegGetValueW(
            key,
            std::ptr::null(),
            std::ptr::null(),
            flags,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut bytes,
        );
        if sized != ERROR_SUCCESS || bytes == 0 {
            RegCloseKey(key);
            return None;
        }

        let mut buffer: Vec<u16> = vec![0; bytes as usize / 2 + 1];
        let mut available = bytes;
        let read = RegGetValueW(
            key,
            std::ptr::null(),
            std::ptr::null(),
            flags,
            std::ptr::null_mut(),
            buffer.as_mut_ptr().cast(),
            &mut available,
        );
        RegCloseKey(key);
        if read != ERROR_SUCCESS {
            return None;
        }

        let end = buffer.iter().position(|c| *c == 0).unwrap_or(buffer.len());
        let value = String::from_utf16_lossy(&buffer[..end]);
        let trimmed = value.trim().trim_matches('"').trim();
        if trimmed.is_empty() {
            return None;
        }
        Some(PathBuf::from(trimmed))
    }
}

/// Probes Chromium's per-profile `lockfile`.
///
/// Opens with `OPEN_EXISTING` and no sharing: the call never creates,
/// truncates, or writes the file, and the handle is closed immediately. A
/// running Chromium holds this file with exclusive sharing semantics, so a
/// sharing violation is the signal that the profile is in use.
#[cfg(windows)]
pub fn probe_lockfile(path: &Path) -> LockProbe {
    use windows_sys::Win32::Foundation::{
        CloseHandle, GetLastError, ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND,
        ERROR_SHARING_VIOLATION, GENERIC_READ, INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_NONE, OPEN_EXISTING,
    };

    let wide_path = wide(&path.to_string_lossy());

    unsafe {
        let handle = CreateFileW(
            wide_path.as_ptr(),
            GENERIC_READ,
            FILE_SHARE_NONE,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_OPEN_REPARSE_POINT,
            std::ptr::null_mut(),
        );
        if !handle.is_null() && handle != INVALID_HANDLE_VALUE {
            CloseHandle(handle);
            return LockProbe::Free;
        }
        match GetLastError() {
            ERROR_SHARING_VIOLATION => LockProbe::Busy,
            ERROR_FILE_NOT_FOUND | ERROR_PATH_NOT_FOUND => LockProbe::Free,
            _ => LockProbe::Unknown,
        }
    }
}

/// Non-Windows hosts have no Chromium sharing probe, so activity is never
/// provably idle. Reset refuses `Unknown`, which is the fail-closed outcome.
#[cfg(not(windows))]
pub fn probe_lockfile(_path: &Path) -> LockProbe {
    LockProbe::Unknown
}

#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    let mut buffer: Vec<u16> = std::ffi::OsStr::new(value).encode_wide().collect();
    buffer.push(0);
    buffer
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
/// A reparse point is unlinked, never followed, so a junction planted inside a
/// quarantined profile cannot redirect deletion outside the managed base.
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
        // attribute is what actually distinguishes the two.
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
    use super::{is_link_like, probe_lockfile, read_app_paths, remove_tree_no_follow, LockProbe};
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
    fn a_missing_lockfile_probes_free_on_windows_and_never_claims_idle_elsewhere() {
        let tmp = tempfile::tempdir().unwrap();
        let missing = tmp.path().join("user-data").join("lockfile");

        let probe = probe_lockfile(&missing);
        if cfg!(windows) {
            assert_eq!(probe, LockProbe::Free);
        } else {
            assert_eq!(probe, LockProbe::Unknown);
        }
    }

    #[cfg(windows)]
    #[test]
    fn an_unheld_lockfile_probes_free_and_is_left_untouched() {
        let tmp = tempfile::tempdir().unwrap();
        let lockfile = tmp.path().join("lockfile");
        std::fs::write(&lockfile, b"chrome-host-4321").unwrap();

        assert_eq!(probe_lockfile(&lockfile), LockProbe::Free);

        // OPEN_EXISTING with no write access: nothing is created or truncated.
        assert_eq!(std::fs::read(&lockfile).unwrap(), b"chrome-host-4321");
    }

    #[cfg(windows)]
    #[test]
    fn the_probe_never_creates_a_lockfile() {
        let tmp = tempfile::tempdir().unwrap();
        let lockfile = tmp.path().join("lockfile");

        assert_eq!(probe_lockfile(&lockfile), LockProbe::Free);
        assert!(!lockfile.exists(), "the probe created the lockfile");
    }

    #[cfg(windows)]
    #[test]
    fn a_lockfile_held_with_no_sharing_probes_busy() {
        use std::fs::OpenOptions;
        use std::os::windows::fs::OpenOptionsExt;

        let tmp = tempfile::tempdir().unwrap();
        let lockfile = tmp.path().join("lockfile");
        std::fs::write(&lockfile, b"held").unwrap();

        let held = OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&lockfile)
            .unwrap();
        assert_eq!(probe_lockfile(&lockfile), LockProbe::Busy);

        drop(held);
        assert_eq!(probe_lockfile(&lockfile), LockProbe::Free);
    }

    #[cfg(windows)]
    #[test]
    fn a_directory_in_the_lockfile_path_probes_free_rather_than_busy() {
        // ERROR_PATH_NOT_FOUND: the profile has no user-data at all.
        let tmp = tempfile::tempdir().unwrap();
        let nested = tmp.path().join("no").join("such").join("lockfile");
        assert_eq!(probe_lockfile(&nested), LockProbe::Free);
    }

    #[cfg(windows)]
    #[test]
    fn an_unexpected_lockfile_entry_fails_closed_as_unknown() {
        let tmp = tempfile::tempdir().unwrap();
        let lockfile = tmp.path().join("lockfile");
        std::fs::create_dir(&lockfile).unwrap();

        assert_eq!(probe_lockfile(&lockfile), LockProbe::Unknown);
    }

    #[test]
    fn reading_app_paths_for_a_nonexistent_executable_yields_nothing() {
        let values = read_app_paths("afflow-does-not-exist.exe");
        assert_eq!(values, [None, None, None]);
    }

    #[cfg(not(windows))]
    #[test]
    fn app_paths_are_empty_off_windows() {
        assert_eq!(read_app_paths("chrome.exe"), [None, None, None]);
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
