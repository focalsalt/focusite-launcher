//! Prism Launcher / PolyMC instance configuration models.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrismInstanceCfg {
    pub name: String,
    pub icon_key: Option<String>,
    pub notes: Option<String>,
    pub total_time_played: Option<u64>,
}
