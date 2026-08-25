//! macOS profile-activity probe.
//!
//! Chromium's macOS `ProcessSingleton` holds a BSD advisory exclusive lock on
//! `<user-data>/SingletonLock` for as long as the profile is running. See
//! `chrome/browser/process_singleton_mac.cc` upstream. Afflow reads that lock
//! and nothing else: it never creates, truncates, writes, renames, removes, or
//! repairs the file, and it never signals or inspects a browser process.
//!
//! The file's *presence* is not activity. A profile that crashed leaves the
//! file behind unlocked, and Chromium reuses it on the next launch, so only a
//! lock that is actually held means `Busy`.

#![cfg(target_os = "macos")]

use std::path::Path;

use super::platform::LockProbe;

/// Probes `path` for a held exclusive advisory lock.
///
/// `O_NOFOLLOW` is deliberate. On other Unix platforms Chromium makes this
/// path a symlink, and a symlink here, planted or otherwise, would either
/// redirect the probe outside the managed profile or, when dangling, report a
/// running profile as idle. Refusing to follow it turns both cases into
/// `Unknown`, which is the fail-closed answer.
pub fn probe_lock(path: &Path) -> LockProbe {
    use std::os::unix::ffi::OsStrExt;

    let Ok(c_path) = std::ffi::CString::new(path.as_os_str().as_bytes()) else {
        // An interior NUL cannot name a real file, but it is also not proof
        // that nothing is running.
        return LockProbe::Unknown;
    };

    // O_RDWR because flock on some filesystems requires an writable
    // description; O_CLOEXEC so a spawned browser never inherits the probe.
    // Never O_CREAT and never O_TRUNC: the probe must not bring the file into
    // existence or disturb Chromium's contents.
    let fd = unsafe {
        libc::open(
            c_path.as_ptr(),
            libc::O_RDWR | libc::O_CLOEXEC | libc::O_NOFOLLOW,
        )
    };

    if fd < 0 {
        let err = std::io::Error::last_os_error();
        return match err.raw_os_error() {
            // A missing lock file, or a profile directory that was never
            // created, means nothing is holding this profile. Chromium creates
            // the file at launch.
            Some(libc::ENOENT) => LockProbe::Free,
            // ENOTDIR and EISDIR are invalid entry types, ELOOP is the
            // O_NOFOLLOW refusal, EACCES is a permission denial. None of them
            // prove the profile is idle.
            _ => LockProbe::Unknown,
        };
    }

    let probe = unsafe { libc::flock(fd, libc::LOCK_EX | libc::LOCK_NB) };
    let outcome = if probe == 0 {
        // We took the lock, so nobody else held it. Release it immediately:
        // holding it would itself block the next Chromium launch.
        let released = unsafe { libc::flock(fd, libc::LOCK_UN) };
        if released == 0 {
            LockProbe::Free
        } else {
            LockProbe::Unknown
        }
    } else {
        let err = std::io::Error::last_os_error();
        match err.raw_os_error() {
            // The profile is running. EWOULDBLOCK and EAGAIN are the same
            // value on macOS, so this is a guard rather than two arms.
            Some(code) if code == libc::EWOULDBLOCK || code == libc::EAGAIN => LockProbe::Busy,
            // EOPNOTSUPP on a filesystem without advisory locking, EINTR,
            // anything else: we cannot prove the profile is idle.
            _ => LockProbe::Unknown,
        }
    };

    // A failed close leaves the lock state ambiguous, and on the success path
    // it would also mean we may still be holding the lock we just released.
    if unsafe { libc::close(fd) } != 0 {
        return LockProbe::Unknown;
    }
    outcome
}

#[cfg(test)]
mod tests {
    use super::probe_lock;
    use crate::modules::browser::platform::LockProbe;
    use std::fs::File;
    use std::os::fd::AsRawFd;
    use std::path::Path;

    /// Takes a real exclusive advisory lock and holds it for as long as the
    /// returned handle lives.
    ///
    /// BSD `flock` locks an open file description, not a process, so a second
    /// `open` in this same process genuinely conflicts with this one. That is
    /// what lets the busy case be proven without spawning a browser.
    fn hold_exclusive(path: &Path) -> File {
        let file = File::options()
            .read(true)
            .write(true)
            .open(path)
            .expect("open the lock file");
        let taken = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
        assert_eq!(
            taken, 0,
            "the test could not take the lock it needs to hold"
        );
        file
    }

    fn write_lock(dir: &Path) -> std::path::PathBuf {
        let path = dir.join("SingletonLock");
        std::fs::write(&path, b"afflow-host-4321").expect("write the lock file");
        path
    }

    #[test]
    fn a_missing_singleton_lock_probes_free_and_is_never_created() {
        let tmp = tempfile::tempdir().unwrap();
        let missing = tmp.path().join("SingletonLock");

        assert_eq!(probe_lock(&missing), LockProbe::Free);
        assert!(
            !missing.exists(),
            "the probe created Chromium's lock file; it must never do that"
        );
    }

    #[test]
    fn a_missing_user_data_directory_probes_free() {
        let tmp = tempfile::tempdir().unwrap();
        let nested = tmp.path().join("user-data").join("SingletonLock");

        assert_eq!(probe_lock(&nested), LockProbe::Free);
        assert!(!nested.parent().unwrap().exists());
    }

    #[test]
    fn an_unlocked_singleton_lock_probes_free_and_is_left_byte_for_byte_intact() {
        let tmp = tempfile::tempdir().unwrap();
        let lock = write_lock(tmp.path());

        assert_eq!(probe_lock(&lock), LockProbe::Free);

        // A crashed Chromium leaves this file behind and reuses it on the next
        // launch, so the probe must not truncate, rewrite, or remove it.
        assert!(lock.exists());
        assert_eq!(std::fs::read(&lock).unwrap(), b"afflow-host-4321");
    }

    #[test]
    fn a_held_singleton_lock_probes_busy_and_frees_again_on_release() {
        let tmp = tempfile::tempdir().unwrap();
        let lock = write_lock(tmp.path());

        let held = hold_exclusive(&lock);
        assert_eq!(probe_lock(&lock), LockProbe::Busy);

        drop(held);
        assert_eq!(probe_lock(&lock), LockProbe::Free);
    }

    #[test]
    fn the_probe_releases_the_lock_it_briefly_takes() {
        let tmp = tempfile::tempdir().unwrap();
        let lock = write_lock(tmp.path());

        assert_eq!(probe_lock(&lock), LockProbe::Free);

        // If the probe still held the lock, Chromium's next launch would be
        // blocked by Afflow. Proving another exclusive lock can be taken is
        // exactly the check that catches that.
        let after = hold_exclusive(&lock);
        drop(after);
    }

    #[test]
    fn repeated_probes_stay_consistent_and_do_not_disturb_the_file() {
        let tmp = tempfile::tempdir().unwrap();
        let lock = write_lock(tmp.path());

        for _ in 0..5 {
            assert_eq!(probe_lock(&lock), LockProbe::Free);
        }

        let held = hold_exclusive(&lock);
        for _ in 0..5 {
            assert_eq!(probe_lock(&lock), LockProbe::Busy);
        }
        drop(held);

        assert_eq!(std::fs::read(&lock).unwrap(), b"afflow-host-4321");
    }

    #[test]
    fn a_symlinked_singleton_lock_is_unknown_and_its_target_is_untouched() {
        let tmp = tempfile::tempdir().unwrap();
        let outside = tmp.path().join("outside");
        std::fs::write(&outside, b"do not touch").unwrap();

        let lock = tmp.path().join("SingletonLock");
        std::os::unix::fs::symlink(&outside, &lock).unwrap();

        // O_NOFOLLOW refuses with ELOOP. Following it would probe a file
        // outside the managed profile.
        assert_eq!(probe_lock(&lock), LockProbe::Unknown);
        assert_eq!(std::fs::read(&outside).unwrap(), b"do not touch");
    }

    #[test]
    fn a_dangling_symlink_is_unknown_rather_than_free() {
        // This is exactly the shape Chromium uses on Linux. Reporting it as
        // Free would let a reset run while a browser is live.
        let tmp = tempfile::tempdir().unwrap();
        let lock = tmp.path().join("SingletonLock");
        std::os::unix::fs::symlink(tmp.path().join("afflow-host-4321"), &lock).unwrap();

        assert_eq!(probe_lock(&lock), LockProbe::Unknown);
        assert!(!tmp.path().join("afflow-host-4321").exists());
    }

    #[test]
    fn an_unexpected_entry_type_fails_closed_as_unknown() {
        let tmp = tempfile::tempdir().unwrap();
        let lock = tmp.path().join("SingletonLock");
        std::fs::create_dir(&lock).unwrap();

        assert_eq!(probe_lock(&lock), LockProbe::Unknown);
        assert!(lock.is_dir(), "the probe disturbed the entry");
    }
}
