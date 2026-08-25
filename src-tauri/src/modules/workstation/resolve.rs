//! Secure resolution of a workstation-relative file reference to a canonical
//! absolute path. Deliberately independent of any particular prompt or output
//! directory so one command serves both known prompt paths and explicit
//! referenced output paths.
//!
//! This is a read path. It does not reuse the Phase 1 creation policy in
//! `scaffold::validate_root`, which additionally refuses drive roots and the
//! home directory: refusing to read from an already-created workstation on
//! those grounds would be wrong.

use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::modules::fs::to_canon;
use crate::modules::workspace::WorkspaceRegistry;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkstationFileRequest {
    pub root_path: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkstationFileResolution {
    pub root: String,
    pub relative_path: String,
    pub absolute_path: String,
}

/// Splits a workstation-relative path into plain name components.
///
/// Backslashes are treated as separators on every platform. Rust only does
/// this on Windows, so without it a `..\..\escape` payload would pass as a
/// single filename on Unix. The cost is that a Unix filename genuinely
/// containing a backslash cannot be referenced; containment is worth more.
pub fn relative_components(raw: &str) -> Result<Vec<String>, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("relative path is empty".into());
    }
    let normalized = trimmed.replace('\\', "/");
    if normalized.starts_with('/') {
        return Err(format!("relative path must not be absolute: {trimmed}"));
    }
    if has_drive_prefix(&normalized) {
        return Err(format!("relative path must not be absolute: {trimmed}"));
    }

    let mut parts = Vec::new();
    for segment in normalized.split('/') {
        match segment {
            "" => return Err(format!("relative path has an empty component: {trimmed}")),
            "." => {
                return Err(format!(
                    "relative path must not contain a . component: {trimmed}"
                ))
            }
            ".." => {
                return Err(format!(
                    "relative path must not contain a .. component: {trimmed}"
                ))
            }
            other => parts.push(other.to_string()),
        }
    }
    Ok(parts)
}

/// Catches `C:/x` and `C:x` on every platform, since `Path::is_absolute` only
/// recognizes a drive prefix when compiled for Windows.
fn has_drive_prefix(s: &str) -> bool {
    let mut chars = s.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic()) && chars.next() == Some(':')
}

fn require_absolute_root(raw: &str) -> Result<PathBuf, String> {
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
    Ok(path)
}

/// Resolves `relative_path` under `root_path`, proving at every step that the
/// result is a regular file inside the canonical, authorized workstation root.
/// Never opens or reads the file.
pub fn resolve_file(
    registry: &WorkspaceRegistry,
    root_path: &str,
    relative_path: &str,
) -> Result<WorkstationFileResolution, String> {
    let requested_root = require_absolute_root(root_path)?;
    let parts = relative_components(relative_path)?;

    let root = std::fs::canonicalize(&requested_root).map_err(|e| {
        log::debug!(
            "workstation root canonicalize failed ({}): {e}",
            requested_root.display()
        );
        format!("workstation root not found: {}", to_canon(&requested_root))
    })?;
    if !root.is_dir() {
        return Err(format!(
            "workstation root is not a directory: {}",
            to_canon(&root)
        ));
    }
    require_authorized(registry, &root, "workstation root")?;

    let mut candidate = root.clone();
    for part in &parts {
        candidate.push(part);
    }

    // Canonicalizing the target is what collapses symlinks and junctions, so
    // the containment check below sees where the path really lands.
    let target = std::fs::canonicalize(&candidate).map_err(|e| {
        log::debug!(
            "workstation file canonicalize failed ({}): {e}",
            candidate.display()
        );
        format!("file not found in workstation: {}", parts.join("/"))
    })?;

    if !target.starts_with(&root) {
        return Err(format!(
            "file resolves outside the workstation root: {}",
            parts.join("/")
        ));
    }

    let metadata =
        std::fs::metadata(&target).map_err(|e| format!("cannot stat file in workstation: {e}"))?;
    if !metadata.is_file() {
        return Err(format!("path is not a regular file: {}", to_canon(&target)));
    }

    require_authorized(registry, &target, "file")?;

    // Derived from the canonical pair, so Windows casing and separator
    // differences come back normalized instead of echoing the caller.
    let relative = target
        .strip_prefix(&root)
        .map_err(|_| "file resolves outside the workstation root".to_string())?;

    Ok(WorkstationFileResolution {
        root: to_canon(&root),
        relative_path: to_canon(relative),
        absolute_path: to_canon(&target),
    })
}

fn require_authorized(
    registry: &WorkspaceRegistry,
    canonical: &Path,
    label: &str,
) -> Result<(), String> {
    if !registry.is_authorized(canonical) {
        return Err(format!(
            "{label} is outside the authorized workspace: {}",
            to_canon(canonical)
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn workstation_resolve_file(
    request: WorkstationFileRequest,
    registry: tauri::State<'_, WorkspaceRegistry>,
) -> Result<WorkstationFileResolution, String> {
    resolve_file(&registry, &request.root_path, &request.relative_path)
}

#[cfg(test)]
mod tests {
    use super::{relative_components, resolve_file};
    use crate::modules::workspace::WorkspaceRegistry;
    use std::path::{Path, PathBuf};

    struct Fixture {
        _tmp: tempfile::TempDir,
        registry: WorkspaceRegistry,
        root: PathBuf,
    }

    /// A workstation root with a prompt and an output file, authorized the way
    /// the frontend authorizes an active workstation root.
    fn fixture() -> Fixture {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path().join("workstation");
        std::fs::create_dir_all(root.join("agents/script-generator")).unwrap();
        std::fs::create_dir_all(root.join("outputs")).unwrap();
        std::fs::write(root.join("agents/script-generator/prompt.md"), "# Role\n").unwrap();
        std::fs::write(root.join("outputs/video-prompt.md"), "# Prompt\n").unwrap();

        let registry = WorkspaceRegistry::default();
        registry.authorize(&root).expect("authorize root");
        Fixture {
            _tmp: tmp,
            registry,
            root,
        }
    }

    fn resolve(f: &Fixture, rel: &str) -> Result<super::WorkstationFileResolution, String> {
        resolve_file(&f.registry, &f.root.to_string_lossy(), rel)
    }

    #[test]
    fn resolves_a_prompt_file() {
        let f = fixture();
        let out = resolve(&f, "agents/script-generator/prompt.md").expect("resolve");

        assert_eq!(out.relative_path, "agents/script-generator/prompt.md");
        assert!(out
            .absolute_path
            .ends_with("agents/script-generator/prompt.md"));
        assert!(out.absolute_path.starts_with(&out.root));
    }

    #[test]
    fn resolves_an_output_file() {
        let f = fixture();
        let out = resolve(&f, "outputs/video-prompt.md").expect("resolve");
        assert_eq!(out.relative_path, "outputs/video-prompt.md");
    }

    #[test]
    fn returns_forward_slashed_paths_everywhere() {
        let f = fixture();
        let out = resolve(&f, "outputs/video-prompt.md").expect("resolve");

        for value in [&out.root, &out.relative_path, &out.absolute_path] {
            assert!(!value.contains('\\'), "not forward-slashed: {value}");
        }
        assert!(
            !out.root.contains("?"),
            "verbatim prefix leaked: {}",
            out.root
        );
    }

    #[test]
    fn accepts_windows_separators_in_the_request() {
        let f = fixture();
        let out = resolve(&f, "outputs\\video-prompt.md").expect("resolve");
        assert_eq!(out.relative_path, "outputs/video-prompt.md");
    }

    #[test]
    fn rejects_empty_root_and_relative_path() {
        let f = fixture();
        assert!(resolve(&f, "").is_err());
        assert!(resolve(&f, "   ").is_err());
        assert!(resolve_file(&f.registry, "", "outputs/video-prompt.md").is_err());
        assert!(resolve_file(&f.registry, "   ", "outputs/video-prompt.md").is_err());
    }

    #[test]
    fn rejects_a_relative_root() {
        let f = fixture();
        let err = resolve_file(&f.registry, "workstation", "outputs/video-prompt.md").unwrap_err();
        assert!(err.contains("absolute"), "unexpected error: {err}");
    }

    #[test]
    fn rejects_an_absolute_target() {
        let f = fixture();
        let absolute = f.root.join("outputs/video-prompt.md");
        let err = resolve(&f, &absolute.to_string_lossy()).unwrap_err();
        assert!(
            err.contains("must not be absolute"),
            "unexpected error: {err}"
        );

        assert!(relative_components("/etc/passwd").is_err());
        assert!(relative_components("C:/Windows/system32/cmd.exe").is_err());
        assert!(relative_components("C:outputs/x.md").is_err());
    }

    #[test]
    fn rejects_traversal_current_dir_and_empty_components() {
        for bad in [
            "../secrets.md",
            "outputs/../../secrets.md",
            "./outputs/video-prompt.md",
            "outputs/./video-prompt.md",
            "outputs//video-prompt.md",
            "outputs/",
        ] {
            assert!(relative_components(bad).is_err(), "should reject {bad}");
        }
    }

    #[test]
    fn rejects_traversal_written_with_backslashes_on_every_platform() {
        assert!(relative_components("..\\secrets.md").is_err());
        assert!(relative_components("outputs\\..\\..\\secrets.md").is_err());
    }

    #[test]
    fn accepts_a_plain_nested_relative_path() {
        let parts = relative_components("agents/script-reviewer/prompt.md").expect("parts");
        assert_eq!(parts, vec!["agents", "script-reviewer", "prompt.md"]);
    }

    #[test]
    fn rejects_a_missing_target() {
        let f = fixture();
        let err = resolve(&f, "outputs/nope.md").unwrap_err();
        assert!(err.contains("not found"), "unexpected error: {err}");
    }

    #[test]
    fn rejects_a_directory_target() {
        let f = fixture();
        let err = resolve(&f, "outputs").unwrap_err();
        assert!(
            err.contains("not a regular file"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn rejects_a_root_that_is_a_file() {
        let f = fixture();
        let root_file = f.root.join("outputs/video-prompt.md");
        let err = resolve_file(&f.registry, &root_file.to_string_lossy(), "x.md").unwrap_err();
        assert!(
            err.contains("not a directory") || err.contains("not found"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn rejects_a_target_outside_the_root() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("workstation");
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("secrets.md"), "secret").unwrap();

        let registry = WorkspaceRegistry::default();
        registry.authorize(&root).unwrap();

        let err =
            resolve_file(&registry, &root.to_string_lossy(), "../outside/secrets.md").unwrap_err();
        assert!(err.contains(".."), "unexpected error: {err}");
    }

    #[test]
    fn rejects_an_unauthorized_root() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("workstation");
        std::fs::create_dir_all(root.join("outputs")).unwrap();
        std::fs::write(root.join("outputs/a.md"), "x").unwrap();

        let registry = WorkspaceRegistry::default();
        let err = resolve_file(&registry, &root.to_string_lossy(), "outputs/a.md").unwrap_err();
        assert!(
            err.contains("outside the authorized workspace"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn rejects_a_root_authorized_only_as_a_sibling() {
        let tmp = tempfile::tempdir().unwrap();
        let allowed = tmp.path().join("allowed");
        let other = tmp.path().join("other");
        std::fs::create_dir_all(&allowed).unwrap();
        std::fs::create_dir_all(other.join("outputs")).unwrap();
        std::fs::write(other.join("outputs/a.md"), "x").unwrap();

        let registry = WorkspaceRegistry::default();
        registry.authorize(&allowed).unwrap();

        let err = resolve_file(&registry, &other.to_string_lossy(), "outputs/a.md").unwrap_err();
        assert!(
            err.contains("outside the authorized workspace"),
            "unexpected error: {err}"
        );
    }

    #[cfg(windows)]
    #[test]
    fn drive_letter_case_does_not_bypass_containment() {
        let f = fixture();
        let shouted = f.root.to_string_lossy().to_uppercase();

        let out = resolve_file(&f.registry, &shouted, "outputs/video-prompt.md")
            .expect("resolve through upper-cased root");
        assert_eq!(out.relative_path, "outputs/video-prompt.md");
        assert!(out.absolute_path.starts_with(&out.root));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlink_that_escapes_the_root() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("workstation");
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(root.join("outputs")).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("secrets.md"), "secret").unwrap();
        std::os::unix::fs::symlink(outside.join("secrets.md"), root.join("outputs/link.md"))
            .unwrap();

        let registry = WorkspaceRegistry::default();
        registry.authorize(&root).unwrap();

        let err = resolve_file(&registry, &root.to_string_lossy(), "outputs/link.md").unwrap_err();
        assert!(
            err.contains("outside the workstation root")
                || err.contains("outside the authorized workspace"),
            "unexpected error: {err}"
        );
    }

    #[cfg(windows)]
    #[test]
    fn rejects_a_directory_junction_that_escapes_the_root() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("workstation");
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("secrets.md"), "secret").unwrap();

        let link = root.join("escape");
        let made = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&outside)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !made {
            return; // junction creation unavailable in this environment
        }

        let registry = WorkspaceRegistry::default();
        registry.authorize(&root).unwrap();

        let err =
            resolve_file(&registry, &root.to_string_lossy(), "escape/secrets.md").unwrap_err();
        assert!(
            err.contains("outside the workstation root")
                || err.contains("outside the authorized workspace"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn never_falls_back_to_home_or_searches_by_basename() {
        let f = fixture();
        // The file exists deeper in the tree; a bare basename must not find it.
        assert!(resolve(&f, "prompt.md").is_err());
        assert!(resolve(&f, "video-prompt.md").is_err());
    }

    #[test]
    fn does_not_return_file_contents() {
        let f = fixture();
        let out = resolve(&f, "agents/script-generator/prompt.md").expect("resolve");
        let json = serde_json::to_string(&out).unwrap();

        assert!(!json.contains("# Role"), "file contents leaked: {json}");
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        let keys: Vec<&String> = value.as_object().unwrap().keys().collect();
        assert_eq!(keys.len(), 3, "unexpected response keys: {keys:?}");
    }

    #[test]
    fn containment_holds_for_a_path_that_only_looks_contained() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("ws");
        let sneaky = tmp.path().join("ws-extra");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&sneaky).unwrap();
        std::fs::write(sneaky.join("a.md"), "x").unwrap();

        let registry = WorkspaceRegistry::default();
        registry.authorize(&root).unwrap();
        registry.authorize(&sneaky).unwrap();

        // "ws-extra" shares a string prefix with "ws" but is not inside it.
        let err = resolve_file(&registry, &root.to_string_lossy(), "../ws-extra/a.md").unwrap_err();
        assert!(err.contains(".."), "unexpected error: {err}");
    }

    #[test]
    fn resolution_is_independent_of_prompt_and_output_directories() {
        let f = fixture();
        std::fs::create_dir_all(f.root.join("research/deep")).unwrap();
        std::fs::write(f.root.join("research/deep/notes.md"), "notes").unwrap();

        let out = resolve(&f, "research/deep/notes.md").expect("resolve");
        assert_eq!(out.relative_path, "research/deep/notes.md");
    }

    #[test]
    fn root_is_reported_canonically_not_as_supplied() {
        let f = fixture();
        let with_trailing = format!("{}/", f.root.to_string_lossy());
        let out =
            resolve_file(&f.registry, &with_trailing, "outputs/video-prompt.md").expect("resolve");

        assert!(
            !out.root.ends_with('/'),
            "root must be canonical: {}",
            out.root
        );
        assert!(Path::new(&out.absolute_path).is_absolute());
    }
}
