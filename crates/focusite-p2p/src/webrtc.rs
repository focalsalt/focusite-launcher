//! WebRTC session models and room signaling specifications.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomSession {
    pub room_code: String,
    pub host_port: u16,
    pub is_host: bool,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalPayload {
    pub room_code: String,
    pub sdp_type: String, // "offer" or "answer"
    pub sdp: String,
    pub candidate: Option<String>,
}
