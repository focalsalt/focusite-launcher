//! Minecraft framing and packet decoding utilities for user-space P2P proxies.

use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum McProtocolError {
    #[error("Incomplete VarInt data")]
    IncompleteVarInt,

    #[error("VarInt exceeds 5 bytes limit")]
    VarIntTooLarge,

    #[error("Invalid packet length: {0}")]
    InvalidPacketLength(usize),

    #[error("Unexpected packet ID: 0x{0:02X}, expected 0x{1:02X}")]
    UnexpectedPacketId(u8, u8),

    #[error("Malformed string payload")]
    MalformedString,

    #[error("Incomplete packet payload")]
    IncompletePayload,
}

/// Reads a VarInt from the buffer.
/// Returns `Ok((value, bytes_read))` on success.
pub fn read_varint(buf: &[u8]) -> Result<(i32, usize), McProtocolError> {
    let mut num_read = 0;
    let mut result = 0i32;

    for &byte in buf {
        let value = (byte & 0b0111_1111) as i32;
        result |= value << (7 * num_read);

        num_read += 1;
        if num_read > 5 {
            return Err(McProtocolError::VarIntTooLarge);
        }

        if (byte & 0b1000_0000) == 0 {
            return Ok((result, num_read));
        }
    }

    Err(McProtocolError::IncompleteVarInt)
}

/// Writes an i32 value as a Minecraft VarInt into `out`.
pub fn write_varint(mut value: i32, out: &mut Vec<u8>) {
    loop {
        let mut temp = (value & 0b0111_1111) as u8;
        // Logical shift right
        value = ((value as u32) >> 7) as i32;
        if value != 0 {
            temp |= 0b1000_0000;
        }
        out.push(temp);
        if value == 0 {
            break;
        }
    }
}

/// Minecraft Handshake packet structure (Packet ID = 0x00).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McHandshake {
    pub protocol_version: i32,
    pub server_address: String,
    pub server_port: u16,
    pub next_state: i32, // 1 for Status (Server List Ping), 2 for Login
}

/// Parses a Minecraft Handshake packet from raw bytes.
pub fn parse_handshake_packet(buf: &[u8]) -> Result<McHandshake, McProtocolError> {
    let mut cursor = 0;

    let (packet_length, len_bytes) = read_varint(&buf[cursor..])?;
    cursor += len_bytes;

    if buf.len() < cursor + packet_length as usize {
        return Err(McProtocolError::IncompletePayload);
    }

    let (packet_id, id_bytes) = read_varint(&buf[cursor..])?;
    cursor += id_bytes;

    if packet_id != 0x00 {
        return Err(McProtocolError::UnexpectedPacketId(packet_id as u8, 0x00));
    }

    let (protocol_version, proto_bytes) = read_varint(&buf[cursor..])?;
    cursor += proto_bytes;

    let (str_len, str_len_bytes) = read_varint(&buf[cursor..])?;
    cursor += str_len_bytes;

    let str_len = str_len as usize;
    if buf.len() < cursor + str_len {
        return Err(McProtocolError::IncompletePayload);
    }

    let server_address = std::str::from_utf8(&buf[cursor..cursor + str_len])
        .map_err(|_| McProtocolError::MalformedString)?
        .to_string();
    cursor += str_len;

    if buf.len() < cursor + 2 {
        return Err(McProtocolError::IncompletePayload);
    }
    let server_port = u16::from_be_bytes([buf[cursor], buf[cursor + 1]]);
    cursor += 2;

    let (next_state, _) = read_varint(&buf[cursor..])?;

    Ok(McHandshake {
        protocol_version,
        server_address,
        server_port,
        next_state,
    })
}

/// Creates a raw Minecraft Handshake packet.
pub fn create_handshake_packet(
    protocol_version: i32,
    server_address: &str,
    server_port: u16,
    next_state: i32,
) -> Vec<u8> {
    let mut payload = Vec::new();
    write_varint(0x00, &mut payload); // Packet ID
    write_varint(protocol_version, &mut payload);

    let addr_bytes = server_address.as_bytes();
    write_varint(addr_bytes.len() as i32, &mut payload);
    payload.extend_from_slice(addr_bytes);

    payload.extend_from_slice(&server_port.to_be_bytes());
    write_varint(next_state, &mut payload);

    let mut packet = Vec::new();
    write_varint(payload.len() as i32, &mut packet);
    packet.extend(payload);
    packet
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ServerStatusVersion {
    pub name: String,
    pub protocol: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ServerStatusPlayers {
    pub max: i32,
    pub online: i32,
    #[serde(default)]
    pub sample: Vec<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ServerStatusDescription {
    pub text: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ServerStatusResponse {
    pub version: ServerStatusVersion,
    pub players: ServerStatusPlayers,
    pub description: ServerStatusDescription,
}

/// Builds a Server List Ping status JSON response packet.
pub fn build_status_response_packet(
    protocol_version: i32,
    version_name: &str,
    motd: &str,
    online_players: i32,
    max_players: i32,
) -> Vec<u8> {
    let status = ServerStatusResponse {
        version: ServerStatusVersion {
            name: version_name.to_string(),
            protocol: protocol_version,
        },
        players: ServerStatusPlayers {
            max: max_players,
            online: online_players,
            sample: Vec::new(),
        },
        description: ServerStatusDescription {
            text: motd.to_string(),
        },
    };

    let json_bytes = serde_json::to_vec(&status).unwrap_or_default();
    let mut payload = Vec::new();
    write_varint(0x00, &mut payload); // Packet ID 0x00 (Status Response)
    write_varint(json_bytes.len() as i32, &mut payload);
    payload.extend_from_slice(&json_bytes);

    let mut packet = Vec::new();
    write_varint(payload.len() as i32, &mut packet);
    packet.extend(payload);
    packet
}

/// Builds a Pong response packet for status ping.
pub fn build_pong_response_packet(payload: i64) -> Vec<u8> {
    let mut body = Vec::new();
    write_varint(0x01, &mut body); // Packet ID 0x01 (Pong Response)
    body.extend_from_slice(&payload.to_be_bytes());

    let mut packet = Vec::new();
    write_varint(body.len() as i32, &mut packet);
    packet.extend(body);
    packet
}

/// Creates a raw Minecraft Status Request packet (Packet Length = 1, Packet ID = 0x00).
pub fn create_status_request_packet() -> Vec<u8> {
    vec![0x01, 0x00]
}

/// Parses a Minecraft Status Response packet into ServerStatusResponse.
pub fn parse_status_response_packet(buf: &[u8]) -> Result<ServerStatusResponse, McProtocolError> {
    let mut cursor = 0;
    let (packet_len, len_bytes) = read_varint(&buf[cursor..])?;
    cursor += len_bytes;

    if buf.len() < cursor + packet_len as usize {
        return Err(McProtocolError::IncompletePayload);
    }

    let (packet_id, id_bytes) = read_varint(&buf[cursor..])?;
    cursor += id_bytes;

    if packet_id != 0x00 {
        return Err(McProtocolError::UnexpectedPacketId(packet_id as u8, 0x00));
    }

    let (json_len, json_len_bytes) = read_varint(&buf[cursor..])?;
    cursor += json_len_bytes;

    let json_len = json_len as usize;
    if buf.len() < cursor + json_len {
        return Err(McProtocolError::IncompletePayload);
    }

    let json_str = std::str::from_utf8(&buf[cursor..cursor + json_len])
        .map_err(|_| McProtocolError::MalformedString)?;

    serde_json::from_str(json_str).map_err(|_| McProtocolError::MalformedString)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_varint_roundtrip() {
        let test_cases = [0, 1, 2, 127, 128, 255, 25565, 2097151, -1, -2147483648];
        for &val in &test_cases {
            let mut out = Vec::new();
            write_varint(val, &mut out);
            let (decoded, bytes_read) = read_varint(&out).expect("failed to decode varint");
            assert_eq!(decoded, val);
            assert_eq!(bytes_read, out.len());
        }
    }

    #[test]
    fn test_handshake_packet_roundtrip() {
        let raw = create_handshake_packet(765, "127.0.0.1", 25565, 1);
        let parsed = parse_handshake_packet(&raw).expect("failed to parse handshake");

        assert_eq!(parsed.protocol_version, 765);
        assert_eq!(parsed.server_address, "127.0.0.1");
        assert_eq!(parsed.server_port, 25565);
        assert_eq!(parsed.next_state, 1);
    }

    #[test]
    fn test_status_response_packet() {
        let packet = build_status_response_packet(
            765,
            "Focusite 1.20.4",
            "[Focusite · Alice] MyWorld",
            1,
            10,
        );
        assert!(!packet.is_empty());

        let (len, len_bytes) = read_varint(&packet).unwrap();
        assert_eq!(packet.len(), len as usize + len_bytes);

        let parsed = parse_status_response_packet(&packet).expect("解析 status response 失敗");
        assert_eq!(parsed.version.name, "Focusite 1.20.4");
        assert_eq!(parsed.description.text, "[Focusite · Alice] MyWorld");
        assert_eq!(parsed.players.online, 1);
        assert_eq!(parsed.players.max, 10);
    }

    #[test]
    fn test_pong_packet() {
        let ping_time = 1234567890123456789i64;
        let packet = build_pong_response_packet(ping_time);
        assert_eq!(packet.len(), 1 + 1 + 8); // length varint (9) + id varint (0x01) + 8 bytes payload
    }
}
