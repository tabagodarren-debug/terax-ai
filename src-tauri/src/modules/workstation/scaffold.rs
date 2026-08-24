use std::path::{Component, Path, PathBuf};

use serde::Serialize;

use crate::modules::fs::to_canon;
use crate::modules::workstation::iso_time::iso8601_utc;
use crate::modules::workstation::template::{
    WorkstationManifest, MANIFEST_FILE, MANIFEST_SCHEMA_VERSION, SCAFFOLD_DIRS, SCAFFOLD_FILES,
};

/// Result of one scaffold run. Entry paths are root-relative and
/// forward-slashed; only `root` is absolute.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScaffoldReport {
    pub root: String,
    pub created_dirs: Vec<String>,
    pub created_files: Vec<String>,
    pub skipped_files: Vec<String>,
    pub manifest_written: bool,
}

pub struct ScaffoldPlan {
    pub root: PathBuf,
    pub dirs: Vec<(&'static str, PathBuf)>,
    pub files: Vec<(&'static str, PathBuf, &'static str)>,
    pub manifest: PathBuf,
}

/// Rejects roots that are unsafe to scaffold into before any filesystem work
/// happens. `home` is injected so the rule stays testable off the real HOME.
pub fn validate_root(raw: &str, home: Option<&Path>) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("workstation root is empty".into());
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err(format!("workstation root must be absolute: {trimmed}"));
    }
    if path.components().any(|c| c == Component::ParentDir) {
        return Err(format!("workstation root must not contain ..: {trimmed}"));
    }
    if !path.components().any(|c| matches!(c, Component::Normal(_))) {
        return Err(format!(
            "refusing to scaffold into a filesystem or drive root: {trimmed}"
        ));
    }
    reject_home_root(&path, home, trimmed)?;
    Ok(path)
}

fn reject_home_root(path: &Path, home: Option<&Path>, display: &str) -> Result<(), String> {
    let Some(home) = home else {
        return Ok(());
    };
    let resolved_home = std::fs::canonicalize(home).unwrap_or_else(|_| home.to_path_buf());
    if compare_key(path) == compare_key(&resolved_home) {
        return Err(format!(
            "refusing to scaffold into the home directory: {display}"
        ));
    }
    Ok(())
}

/// Case-insensitive on Windows, separator- and trailing-slash-insensitive
/// everywhere. Only ever used to compare two paths for identity.
fn compare_key(p: &Path) -> String {
    let canon = to_canon(p);
    let trimmed = canon.trim_end_matches('/');
    let base = if trimmed.is_empty() { &canon } else { trimmed };
    if cfg!(windows) {
        base.to_lowercase()
    } else {
        base.to_string()
    }
}

/// Pure: derives every path the scaffold will touch and proves each one stays
/// under `root`. The names are constants, so a failure here means the root
/// itself is malformed.
pub fn build_plan(root: &Path) -> Result<ScaffoldPlan, String> {
    let mut dirs = Vec::with_capacity(SCAFFOLD_DIRS.len());
    for rel in SCAFFOLD_DIRS {
        dirs.push((*rel, contained_join(root, rel)?));
    }
    let mut files = Vec::with_capacity(SCAFFOLD_FILES.len());
    for (rel, body) in SCAFFOLD_FILES {
        files.push((*rel, contained_join(root, rel)?, *body));
    }
    Ok(ScaffoldPlan {
        root: root.to_path_buf(),
        dirs,
        files,
        manifest: contained_join(root, MANIFEST_FILE)?,
    })
}

fn contained_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let joined = root.join(rel);
    if !joined.starts_with(root) {
        return Err(format!("scaffold path escapes the workstation root: {rel}"));
    }
    Ok(joined)
}

/// Idempotent. Creates only what is missing, never overwrites an existing
/// prompt or manifest, and never touches unrelated files. On failure it
/// returns an error and leaves whatever it already created in place: retrying
/// completes the tree, whereas rolling back would delete directories the user
/// may already be working in.
pub fn scaffold(
    root_path: &str,
    id: &str,
    name: &str,
    now_secs: u64,
    home: Option<&Path>,
) -> Result<ScaffoldReport, String> {
    let id = id.trim();
    if id.is_empty() {
        return Err("workstation id is empty".into());
    }
    let name = name.trim();
    if name.is_empty() {
        return Err("workstation name is empty".into());
    }

    let requested = validate_root(root_path, home)?;
    if requested.exists() && !requested.is_dir() {
        return Err(format!(
            "workstation root exists and is not a directory: {}",
            to_canon(&requested)
        ));
    }
    std::fs::create_dir_all(&requested).map_err(|e| {
        log::debug!(
            "workstation root create failed ({}): {e}",
            requested.display()
        );
        format!("could not create workstation root: {e}")
    })?;

    // Canonicalize only after creation so containment is checked against the
    // real path, symlinks and all.
    let root = std::fs::canonicalize(&requested).map_err(|e| {
        log::debug!(
            "workstation root canonicalize failed ({}): {e}",
            requested.display()
        );
        format!("could not resolve workstation root: {e}")
    })?;
    reject_home_root(&root, home, &to_canon(&root))?;
    let plan = build_plan(&root)?;

    let mut report = ScaffoldReport {
        root: to_canon(&root),
        created_dirs: Vec::new(),
        created_files: Vec::new(),
        skipped_files: Vec::new(),
        manifest_written: false,
    };

    for (rel, path) in &plan.dirs {
        if path.is_dir() {
            continue;
        }
        if path.exists() {
            return Err(format!("expected a directory but found a file: {rel}"));
        }
        std::fs::create_dir_all(path).map_err(|e| {
            log::debug!("workstation dir create failed ({}): {e}", path.display());
            format!("could not create {rel}: {e}")
        })?;
        report.created_dirs.push((*rel).to_string());
    }

    for (rel, path, body) in &plan.files {
        if path.exists() {
            report.skipped_files.push((*rel).to_string());
            continue;
        }
        write_new_file(path, body.as_bytes())?;
        report.created_files.push((*rel).to_string());
    }

    if plan.manifest.exists() {
        report.skipped_files.push(MANIFEST_FILE.to_string());
    } else {
        let manifest = WorkstationManifest {
            schema_version: MANIFEST_SCHEMA_VERSION,
            id: id.to_string(),
            name: name.to_string(),
            created_at: iso8601_utc(now_secs),
        };
        let json = serde_json::to_string_pretty(&manifest)
            .map_err(|e| format!("could not serialize {MANIFEST_FILE}: {e}"))?;
        write_new_file(&plan.manifest, format!("{json}\n").as_bytes())?;
        report.manifest_written = true;
    }

    Ok(report)
}

/// Writes through a sibling temp file so an interrupted run can never leave a
/// truncated prompt behind that later runs would then skip as "existing".
/// `persist_noclobber` also closes the check-then-write race.
fn write_new_file(path: &Path, body: &[u8]) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or_else(|| format!("no parent directory for {}", path.display()))?;
    let mut tmp = tempfile::NamedTempFile::new_in(dir).map_err(|e| {
        log::debug!("workstation temp file failed ({}): {e}", dir.display());
        format!("could not stage {}: {e}", path.display())
    })?;
    std::io::Write::write_all(&mut tmp, body)
        .map_err(|e| format!("could not write {}: {e}", path.display()))?;
    tmp.persist_noclobber(path).map_err(|e| {
        log::debug!("workstation persist failed ({}): {e}", path.display());
        format!("could not create {}: {e}", e.error)
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{build_plan, scaffold, validate_root, ScaffoldReport};
    use crate::modules::workstation::template::{
        WorkstationManifest, MANIFEST_FILE, SCAFFOLD_DIRS, SCAFFOLD_FILES,
    };
    use std::path::{Path, PathBuf};

    const NOW: u64 = 1_767_225_600; // 2026-01-01T00:00:00Z

    fn run(root: &Path) -> ScaffoldReport {
        scaffold(&root.to_string_lossy(), "ws-1", "Fit Check", NOW, None).expect("scaffold")
    }

    #[test]
    fn creates_the_full_tree_in_an_empty_root() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("Fit Check");
        let report = run(&root);

        for rel in SCAFFOLD_DIRS {
            assert!(root.join(rel).is_dir(), "missing dir {rel}");
        }
        for (rel, body) in SCAFFOLD_FILES {
            let got = std::fs::read_to_string(root.join(rel)).expect(rel);
            assert_eq!(&got, body, "prompt body mismatch for {rel}");
        }
        assert!(root.join(MANIFEST_FILE).is_file());
        assert!(report.manifest_written);
        assert_eq!(report.created_dirs.len(), SCAFFOLD_DIRS.len());
        assert_eq!(report.created_files.len(), SCAFFOLD_FILES.len());
        assert!(report.skipped_files.is_empty());
    }

    #[test]
    fn writes_a_manifest_that_round_trips_through_serde() {
        let tmp = tempfile::tempdir().unwrap();
        run(tmp.path());

        let raw = std::fs::read_to_string(tmp.path().join(MANIFEST_FILE)).unwrap();
        let manifest: WorkstationManifest = serde_json::from_str(&raw).expect("valid json");
        assert_eq!(manifest.schema_version, 1);
        assert_eq!(manifest.id, "ws-1");
        assert_eq!(manifest.name, "Fit Check");
        assert_eq!(manifest.created_at, "2026-01-01T00:00:00Z");
        assert!(raw.contains("schemaVersion"), "expected camelCase keys");
    }

    #[test]
    fn re_running_creates_nothing_and_preserves_everything() {
        let tmp = tempfile::tempdir().unwrap();
        run(tmp.path());
        let second = run(tmp.path());

        assert!(second.created_dirs.is_empty());
        assert!(second.created_files.is_empty());
        assert!(!second.manifest_written);
        assert_eq!(second.skipped_files.len(), SCAFFOLD_FILES.len() + 1);
    }

    #[test]
    fn never_overwrites_an_existing_prompt_or_manifest() {
        let tmp = tempfile::tempdir().unwrap();
        let rel = SCAFFOLD_FILES[0].0;
        std::fs::create_dir_all(tmp.path().join(rel).parent().unwrap()).unwrap();
        std::fs::write(tmp.path().join(rel), "MY EDITS").unwrap();
        std::fs::write(tmp.path().join(MANIFEST_FILE), "{}").unwrap();

        let report = run(tmp.path());

        assert_eq!(
            std::fs::read_to_string(tmp.path().join(rel)).unwrap(),
            "MY EDITS"
        );
        assert_eq!(
            std::fs::read_to_string(tmp.path().join(MANIFEST_FILE)).unwrap(),
            "{}"
        );
        assert!(!report.manifest_written);
        assert!(report.skipped_files.contains(&rel.to_string()));
        assert!(report.skipped_files.contains(&MANIFEST_FILE.to_string()));
    }

    #[test]
    fn preserves_unrelated_files_in_a_non_empty_root() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("notes.md"), "keep me").unwrap();
        std::fs::create_dir_all(tmp.path().join("products/lamp")).unwrap();
        std::fs::write(tmp.path().join("products/lamp/a.txt"), "keep me too").unwrap();

        let report = run(tmp.path());

        assert_eq!(
            std::fs::read_to_string(tmp.path().join("notes.md")).unwrap(),
            "keep me"
        );
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("products/lamp/a.txt")).unwrap(),
            "keep me too"
        );
        assert!(!report.created_dirs.contains(&"products".to_string()));
        assert!(report.created_dirs.contains(&"scripts".to_string()));
    }

    #[test]
    fn retry_completes_a_partially_created_tree() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("agents/script-generator")).unwrap();
        std::fs::create_dir_all(tmp.path().join("images")).unwrap();

        let report = run(tmp.path());

        assert!(!report.created_dirs.contains(&"images".to_string()));
        assert!(report.created_dirs.contains(&"outputs".to_string()));
        for rel in SCAFFOLD_DIRS {
            assert!(tmp.path().join(rel).is_dir(), "missing dir {rel}");
        }
        assert!(report.manifest_written);
    }

    #[test]
    fn fails_when_a_scaffold_directory_name_is_taken_by_a_file() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("scripts"), "not a directory").unwrap();

        let err = scaffold(&tmp.path().to_string_lossy(), "ws-1", "X", NOW, None).unwrap_err();
        assert!(err.contains("scripts"), "unexpected error: {err}");
    }

    #[test]
    fn fails_when_the_root_itself_is_a_file() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("root.txt");
        std::fs::write(&file, "x").unwrap();

        let err = scaffold(&file.to_string_lossy(), "ws-1", "X", NOW, None).unwrap_err();
        assert!(err.contains("not a directory"), "unexpected error: {err}");
    }

    #[test]
    fn rejects_a_blank_id_or_name_before_touching_the_disk() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("unborn");
        let path = root.to_string_lossy().to_string();

        assert!(scaffold(&path, "  ", "X", NOW, None).is_err());
        assert!(scaffold(&path, "ws-1", "  ", NOW, None).is_err());
        assert!(!root.exists(), "root must not be created on invalid input");
    }

    #[test]
    fn rejects_relative_empty_and_traversing_roots() {
        assert!(validate_root("", None).is_err());
        assert!(validate_root("   ", None).is_err());
        assert!(validate_root("relative/path", None).is_err());
        if cfg!(windows) {
            assert!(validate_root("C:/Users/Admin/../Admin/ws", None).is_err());
        } else {
            assert!(validate_root("/home/admin/../admin/ws", None).is_err());
        }
    }

    #[test]
    fn rejects_filesystem_and_drive_roots() {
        if cfg!(windows) {
            assert!(validate_root("C:/", None).is_err());
            assert!(validate_root("C:\\", None).is_err());
            assert!(validate_root("D:/", None).is_err());
            assert!(validate_root("C:/Workstations/Fit Check", None).is_ok());
        } else {
            assert!(validate_root("/", None).is_err());
            assert!(validate_root("/workstations/fit-check", None).is_ok());
        }
    }

    #[test]
    fn rejects_the_home_directory_but_allows_its_descendants() {
        let home = if cfg!(windows) {
            PathBuf::from("C:/Users/Admin")
        } else {
            PathBuf::from("/home/admin")
        };
        let home_ref = Some(home.as_path());

        assert!(validate_root(&home.to_string_lossy(), home_ref).is_err());
        assert!(validate_root(&format!("{}/", home.display()), home_ref).is_err());
        assert!(validate_root(
            &format!("{}/Afflow Workstations/Fit Check", home.display()),
            home_ref
        )
        .is_ok());
    }

    #[test]
    fn rejects_a_home_alias_after_canonicalization() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path().join("home");
        std::fs::create_dir(&home).unwrap();
        let alias = home.join(".");

        let err =
            scaffold(&alias.to_string_lossy(), "ws-1", "Unsafe", NOW, Some(&home)).unwrap_err();

        assert!(err.contains("home directory"), "unexpected error: {err}");
        assert!(!home.join("agents").exists());
    }

    #[cfg(windows)]
    #[test]
    fn treats_windows_separators_and_case_as_the_same_root() {
        let home = PathBuf::from("C:/Users/Admin");
        let home_ref = Some(home.as_path());

        assert!(validate_root("C:\\Users\\Admin", home_ref).is_err());
        assert!(validate_root("c:/users/admin", home_ref).is_err());
        assert!(validate_root("C:\\Users\\Admin\\ws", home_ref).is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn scaffolds_the_same_tree_through_backslash_and_forward_slash_roots() {
        let tmp = tempfile::tempdir().unwrap();
        let forward = tmp.path().to_string_lossy().replace('\\', "/");

        let first = scaffold(&forward, "ws-1", "Fit Check", NOW, None).unwrap();
        let second = scaffold(
            &tmp.path().to_string_lossy(),
            "ws-1",
            "Fit Check",
            NOW,
            None,
        )
        .unwrap();

        assert_eq!(first.root, second.root, "canonical roots must agree");
        assert!(!first.root.contains('\\'), "root must be forward-slashed");
        assert!(second.created_dirs.is_empty());
        assert!(second.created_files.is_empty());
    }

    #[test]
    fn every_planned_path_stays_under_the_root() {
        let root = if cfg!(windows) {
            PathBuf::from("C:/ws")
        } else {
            PathBuf::from("/ws")
        };
        let plan = build_plan(&root).expect("plan");

        for (_, path) in &plan.dirs {
            assert!(path.starts_with(&root));
        }
        for (_, path, _) in &plan.files {
            assert!(path.starts_with(&root));
        }
        assert!(plan.manifest.starts_with(&root));
    }

    #[test]
    fn manifest_carries_no_secret_bearing_fields() {
        let tmp = tempfile::tempdir().unwrap();
        run(tmp.path());
        let raw = std::fs::read_to_string(tmp.path().join(MANIFEST_FILE)).unwrap();

        let value: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let keys: Vec<&String> = value.as_object().unwrap().keys().collect();
        assert_eq!(keys.len(), 4, "unexpected manifest keys: {keys:?}");
    }
}
