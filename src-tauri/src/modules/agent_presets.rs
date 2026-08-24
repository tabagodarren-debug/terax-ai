//! Phase 2 agent-preset support: detection of the supported default CLI
//! executables. Workflow roles are a frontend concept; this module only
//! reports which CLI brands are installed.

use std::path::PathBuf;

use serde::Serialize;

use crate::modules::fs::to_canon;

/// Stable detection order. `id` matches the existing frontend launcher ids;
/// `command` is the executable name looked up on PATH.
const AGENT_CLIS: &[(&str, &str)] = &[
    ("claude", "claude"),
    ("codex", "codex"),
    ("gemini", "gemini"),
    ("opencode", "opencode"),
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCliDetection {
    pub id: String,
    pub command: String,
    pub available: bool,
    pub resolved_path: Option<String>,
}

/// Pure over the resolver so tests never depend on which CLIs the host has
/// installed. `available` is defined as `resolved_path.is_some()`, never
/// inferred separately.
pub fn detect_with<F>(resolve: F) -> Vec<AgentCliDetection>
where
    F: Fn(&str) -> Option<PathBuf>,
{
    AGENT_CLIS
        .iter()
        .map(|(id, command)| {
            let resolved_path = resolve(command).map(to_canon);
            AgentCliDetection {
                id: (*id).to_string(),
                command: (*command).to_string(),
                available: resolved_path.is_some(),
                resolved_path,
            }
        })
        .collect()
}

/// Reports which supported agent CLIs are installed. Looks up executables
/// only: it never launches a CLI, reads its version, or inspects its
/// authentication state.
#[tauri::command]
pub async fn agent_cli_detect() -> Result<Vec<AgentCliDetection>, String> {
    tauri::async_runtime::spawn_blocking(|| detect_with(crate::modules::lsp::env::resolve_binary))
        .await
        .map_err(|e| format!("agent CLI detection failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::{detect_with, AGENT_CLIS};
    use std::path::PathBuf;

    #[test]
    fn reports_the_supported_clis_in_a_stable_order() {
        let found = detect_with(|_| None);
        let ids: Vec<&str> = found.iter().map(|d| d.id.as_str()).collect();
        assert_eq!(ids, vec!["claude", "codex", "gemini", "opencode"]);

        let commands: Vec<&str> = found.iter().map(|d| d.command.as_str()).collect();
        assert_eq!(commands, vec!["claude", "codex", "gemini", "opencode"]);
    }

    #[test]
    fn ids_and_commands_are_lowercase_and_non_empty() {
        for (id, command) in AGENT_CLIS {
            assert!(!id.is_empty() && *id == id.to_lowercase(), "bad id {id}");
            assert!(
                !command.is_empty() && *command == command.to_lowercase(),
                "bad command {command}"
            );
        }
    }

    #[test]
    fn a_missing_command_is_unavailable_with_a_null_path() {
        for entry in detect_with(|_| None) {
            assert!(!entry.available, "{} should be unavailable", entry.id);
            assert_eq!(entry.resolved_path, None);
        }
    }

    #[test]
    fn a_found_command_is_available_with_a_forward_slashed_path() {
        let found = detect_with(|command| {
            if command == "codex" {
                Some(PathBuf::from(if cfg!(windows) {
                    r"C:\Program Files\codex\codex.exe"
                } else {
                    "/usr/local/bin/codex"
                }))
            } else {
                None
            }
        });

        let codex = found.iter().find(|d| d.id == "codex").expect("codex entry");
        assert!(codex.available);
        let path = codex.resolved_path.as_deref().expect("resolved path");
        assert!(!path.contains('\\'), "path must be forward-slashed: {path}");
        assert!(path.ends_with("codex.exe") || path.ends_with("codex"));

        for other in found.iter().filter(|d| d.id != "codex") {
            assert!(!other.available);
            assert_eq!(other.resolved_path, None);
        }
    }

    #[test]
    fn available_always_tracks_the_resolved_path() {
        let found = detect_with(|command| match command {
            "claude" | "gemini" => Some(PathBuf::from("/opt/bin").join(command)),
            _ => None,
        });

        for entry in &found {
            assert_eq!(entry.available, entry.resolved_path.is_some());
        }
        assert_eq!(found.iter().filter(|d| d.available).count(), 2);
    }

    #[test]
    fn custom_commands_are_not_detected() {
        let found = detect_with(|_| Some(PathBuf::from("/opt/bin/anything")));
        assert_eq!(found.len(), AGENT_CLIS.len());
        assert!(!found.iter().any(|d| d.id == "custom"));
    }
}
