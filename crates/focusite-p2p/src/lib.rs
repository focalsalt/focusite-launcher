//! Focusite P2P: User-space driverless WebRTC TCP proxy tunnel for zero-configuration Minecraft multiplayer.

pub mod tcp_proxy;
pub mod webrtc;

#[derive(Debug, thiserror::Error)]
pub enum P2pError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Signaling failed: {0}")]
    SignalingFailed(String),

    #[error("WebRTC connection error: {0}")]
    WebRtcError(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_p2p_error_display() {
        let err = P2pError::SignalingFailed("room timeout".into());
        assert_eq!(err.to_string(), "Signaling failed: room timeout");

        let webrtc_err = P2pError::WebRtcError("peer closed".into());
        assert_eq!(webrtc_err.to_string(), "WebRTC connection error: peer closed");
    }
}
