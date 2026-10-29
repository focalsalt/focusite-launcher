//! Focusite P2P: User-space driverless WebRTC TCP proxy tunnel for zero-configuration Minecraft multiplayer.

pub mod lan_broadcast;
pub mod mc_protocol;
pub mod session;
pub mod tcp_proxy;
pub mod webrtc;

pub use lan_broadcast::{format_lan_packet, parse_lan_packet, LanBroadcaster};
pub use mc_protocol::{
    build_pong_response_packet, build_status_response_packet, create_handshake_packet,
    create_status_request_packet, parse_handshake_packet, parse_status_response_packet,
    read_varint, write_varint, McHandshake, McProtocolError,
};
pub use session::{
    P2pHandshakeResult, P2pRole, P2pSessionHandle, P2pSessionInfo, P2pSessionRegistry,
};
pub use tcp_proxy::LocalTcpProxy;
pub use webrtc::{DataChannelFrame, FrameType, RoomSession, SignalPayload};

#[derive(Debug, thiserror::Error)]
pub enum P2pError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Signaling failed: {0}")]
    SignalingFailed(String),

    #[error("WebRTC connection error: {0}")]
    WebRtcError(String),

    #[error("Framing error: {0}")]
    FramingError(String),
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
