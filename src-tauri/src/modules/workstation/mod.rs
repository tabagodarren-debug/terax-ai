pub mod iso_time;
pub mod resolve;
pub mod scaffold;
pub mod template;

use serde::Deserialize;

use crate::modules::workstation::scaffold::ScaffoldReport;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScaffoldRequest {
    pub root_path: String,
    pub workstation_id: String,
    pub name: String,
}

/// Creates the Afflow workstation folder skeleton, the three starter agent
/// prompts, and `workstation.json`. Safe to re-run: existing files are
/// preserved and reported, never overwritten.
#[tauri::command]
pub fn workstation_scaffold(request: ScaffoldRequest) -> Result<ScaffoldReport, String> {
    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default();
    scaffold::scaffold(
        &request.root_path,
        &request.workstation_id,
        &request.name,
        now_secs,
        dirs::home_dir().as_deref(),
    )
}
