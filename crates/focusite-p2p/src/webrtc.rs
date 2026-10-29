//! WebRTC session models, room signaling specifications, and binary DataChannel framing.

use serde::{Deserialize, Serialize};
use crate::P2pError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum FrameType {
    Data = 0x01,
    Ping = 0x02,
    Pong = 0x03,
    Close = 0x04,
}

impl TryFrom<u8> for FrameType {
    type Error = P2pError;

    fn try_from(val: u8) -> Result<Self, Self::Error> {
        match val {
            0x01 => Ok(FrameType::Data),
            0x02 => Ok(FrameType::Ping),
            0x03 => Ok(FrameType::Pong),
            0x04 => Ok(FrameType::Close),
            other => Err(P2pError::FramingError(format!("未知幀類型: 0x{:02X}", other))),
        }
    }
}

/// Binary framing protocol for WebRTC DataChannels:
/// [Channel ID: 2B] [Frame Type: 1B] [Sequence: 4B] [Payload Len: 4B] [Payload: N B]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DataChannelFrame {
    pub channel_id: u16,
    pub frame_type: FrameType,
    pub seq: u32,
    pub payload: Vec<u8>,
}

impl DataChannelFrame {
    pub const HEADER_SIZE: usize = 2 + 1 + 4 + 4; // 11 bytes

    pub fn new(channel_id: u16, frame_type: FrameType, seq: u32, payload: Vec<u8>) -> Self {
        Self {
            channel_id,
            frame_type,
            seq,
            payload,
        }
    }

    /// Serializes the frame into raw bytes.
    pub fn encode(&self) -> Vec<u8> {
        let payload_len = self.payload.len() as u32;
        let mut buf = Vec::with_capacity(Self::HEADER_SIZE + self.payload.len());
        buf.extend_from_slice(&self.channel_id.to_be_bytes());
        buf.push(self.frame_type as u8);
        buf.extend_from_slice(&self.seq.to_be_bytes());
        buf.extend_from_slice(&payload_len.to_be_bytes());
        buf.extend_from_slice(&self.payload);
        buf
    }

    /// Deserializes a frame from raw bytes with strict boundary checks.
    pub fn decode(bytes: &[u8]) -> Result<Self, P2pError> {
        if bytes.len() < Self::HEADER_SIZE {
            return Err(P2pError::FramingError(format!(
                "資料長度過短 ({} 位元組)，至少需要 {} 位元組首部長度",
                bytes.len(),
                Self::HEADER_SIZE
            )));
        }

        let channel_id = u16::from_be_bytes([bytes[0], bytes[1]]);
        let frame_type = FrameType::try_from(bytes[2])?;
        let seq = u32::from_be_bytes([bytes[3], bytes[4], bytes[5], bytes[6]]);
        let payload_len = u32::from_be_bytes([bytes[7], bytes[8], bytes[9], bytes[10]]) as usize;

        if bytes.len() < Self::HEADER_SIZE + payload_len {
            return Err(P2pError::FramingError(format!(
                "封包 Payload 截斷：宣告長度為 {} 位元組，但剩餘僅 {} 位元組",
                payload_len,
                bytes.len() - Self::HEADER_SIZE
            )));
        }

        let payload = bytes[Self::HEADER_SIZE..Self::HEADER_SIZE + payload_len].to_vec();

        Ok(Self {
            channel_id,
            frame_type,
            seq,
            payload,
        })
    }
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_data_channel_frame_roundtrip() {
        let frame = DataChannelFrame::new(
            1001,
            FrameType::Data,
            42,
            b"Minecraft Handshake Packet".to_vec(),
        );

        let encoded = frame.encode();
        assert_eq!(encoded.len(), DataChannelFrame::HEADER_SIZE + 26);

        let decoded = DataChannelFrame::decode(&encoded).expect("解碼失敗");
        assert_eq!(decoded.channel_id, 1001);
        assert_eq!(decoded.frame_type, FrameType::Data);
        assert_eq!(decoded.seq, 42);
        assert_eq!(decoded.payload, b"Minecraft Handshake Packet");
    }

    #[test]
    fn test_data_channel_frame_truncated() {
        let mut encoded = DataChannelFrame::new(
            1,
            FrameType::Ping,
            1,
            vec![1, 2, 3, 4, 5],
        ).encode();

        encoded.pop(); // 故意截斷 1 個 byte
        let res = DataChannelFrame::decode(&encoded);
        assert!(res.is_err());
    }

    #[test]
    fn test_invalid_frame_type() {
        let mut raw = vec![0u8; 11];
        raw[2] = 0xFF; // 無效 frame type
        let res = DataChannelFrame::decode(&raw);
        assert!(res.is_err());
    }
}
