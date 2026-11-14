//! Minecraft Server List Ping (SLP) Async TCP Protocol Client.

use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;
use crate::CoreError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerPingResult {
    pub motd: String,
    pub online_players: u32,
    pub max_players: u32,
    pub version_name: String,
    pub protocol_version: i32,
    pub latency_ms: u64,
    pub favicon_base64: Option<String>,
}

#[derive(Deserialize)]
struct RawSlpResponse {
    version: Option<RawVersion>,
    players: Option<RawPlayers>,
    description: Option<serde_json::Value>,
    favicon: Option<String>,
}

#[derive(Deserialize)]
struct RawVersion {
    name: Option<String>,
    protocol: Option<i32>,
}

#[derive(Deserialize)]
struct RawPlayers {
    online: Option<u32>,
    max: Option<u32>,
}

/// Asynchronously pings a Minecraft server using the modern SLP TCP protocol.
pub async fn ping_minecraft_server(
    host: &str,
    port: u16,
    timeout_duration: Duration,
) -> Result<ServerPingResult, CoreError> {
    timeout(timeout_duration, async move {
        let addr = format!("{}:{}", host, port);
        let mut stream = TcpStream::connect(&addr).await?;

        let start_time = Instant::now();

        // 1. Send Handshake Packet (ID 0x00)
        // Handshake payload: protocol_version (-1/765), host, port, next_state (1 for status)
        let mut handshake_data = Vec::new();
        write_varint(0x00, &mut handshake_data); // packet ID
        write_varint(-1, &mut handshake_data); // protocol version (-1)
        write_string(host, &mut handshake_data);
        handshake_data.extend_from_slice(&port.to_be_bytes());
        write_varint(1, &mut handshake_data); // next state: status

        send_packet(&mut stream, &handshake_data).await?;

        // 2. Send Status Request Packet (ID 0x00, empty payload)
        let mut request_data = Vec::new();
        write_varint(0x00, &mut request_data);
        send_packet(&mut stream, &request_data).await?;

        // 3. Read Status Response
        let response_packet = read_packet(&mut stream).await?;
        let mut cursor = 0;
        let (_packet_id, id_len) = read_varint(&response_packet[cursor..])
            .map_err(|e| CoreError::InvalidManifest(format!("Malformed SLP response ID: {}", e)))?;
        cursor += id_len;

        let (json_str, _str_len) = read_string(&response_packet[cursor..])
            .map_err(|e| CoreError::InvalidManifest(format!("Malformed SLP json string: {}", e)))?;

        // 4. Send Ping Request (ID 0x01, 8-byte payload) to measure latency
        let ping_start = Instant::now();
        let mut ping_data = Vec::new();
        write_varint(0x01, &mut ping_data);
        let ping_time = start_time.elapsed().as_millis() as i64;
        ping_data.extend_from_slice(&ping_time.to_be_bytes());
        let _ = send_packet(&mut stream, &ping_data).await;

        let latency_ms = match timeout(Duration::from_millis(1500), read_packet(&mut stream)).await {
            Ok(Ok(_pong)) => ping_start.elapsed().as_millis() as u64,
            _ => start_time.elapsed().as_millis() as u64,
        };

        // Parse JSON response
        let raw: RawSlpResponse = serde_json::from_str(&json_str).unwrap_or(RawSlpResponse {
            version: None,
            players: None,
            description: Some(serde_json::Value::String(json_str.clone())),
            favicon: None,
        });

        let motd = match raw.description {
            Some(serde_json::Value::String(s)) => s,
            Some(serde_json::Value::Object(map)) => {
                map.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string()
            }
            _ => "A Minecraft Server".to_string(),
        };

        let online_players = raw.players.as_ref().and_then(|p| p.online).unwrap_or(0);
        let max_players = raw.players.as_ref().and_then(|p| p.max).unwrap_or(0);
        let version_name = raw
            .version
            .as_ref()
            .and_then(|v| v.name.clone())
            .unwrap_or_else(|| "Unknown".to_string());
        let protocol_version = raw.version.as_ref().and_then(|v| v.protocol).unwrap_or(0);

        Ok(ServerPingResult {
            motd,
            online_players,
            max_players,
            version_name,
            protocol_version,
            latency_ms,
            favicon_base64: raw.favicon,
        })
    })
    .await
    .map_err(|_| CoreError::Io(std::io::Error::new(std::io::ErrorKind::TimedOut, "Server ping timed out")))?
}

pub const MAX_SLP_PACKET_LEN: usize = 2 * 1024 * 1024; // 2 MiB

async fn send_packet(stream: &mut TcpStream, data: &[u8]) -> Result<(), CoreError> {
    let mut header = Vec::new();
    write_varint(data.len() as i32, &mut header);
    stream.write_all(&header).await?;
    stream.write_all(data).await?;
    stream.flush().await?;
    Ok(())
}

async fn read_packet(stream: &mut TcpStream) -> Result<Vec<u8>, CoreError> {
    let mut length_bytes = Vec::new();
    let packet_length = loop {
        let byte = stream.read_u8().await?;
        length_bytes.push(byte);
        if (byte & 0x80) == 0 {
            let (len, _) = read_varint(&length_bytes)
                .map_err(|e| CoreError::InvalidManifest(format!("VarInt error: {}", e)))?;
            if len <= 0 {
                return Err(CoreError::InvalidManifest("Packet length must be positive".into()));
            }
            let length = len as usize;
            if length > MAX_SLP_PACKET_LEN {
                return Err(CoreError::InvalidManifest("Packet length exceeds maximum allowed limit (2MB)".into()));
            }
            break length;
        }
        if length_bytes.len() >= 5 {
            return Err(CoreError::InvalidManifest("Packet VarInt length too large".into()));
        }
    };

    let mut buf = vec![0u8; packet_length];
    stream.read_exact(&mut buf).await?;
    Ok(buf)
}

fn write_varint(mut value: i32, out: &mut Vec<u8>) {
    loop {
        let mut temp = (value & 0b0111_1111) as u8;
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

fn read_varint(buf: &[u8]) -> Result<(i32, usize), &'static str> {
    let mut num_read = 0;
    let mut result = 0i32;

    for &byte in buf {
        if num_read >= 5 {
            return Err("VarInt exceeds 5 bytes limit");
        }
        let value = (byte & 0b0111_1111) as i32;
        if num_read == 4 && (byte & 0b1111_0000) != 0 {
            return Err("VarInt overflow in 5th byte");
        }
        result |= value << (7 * num_read);
        num_read += 1;
        if (byte & 0b1000_0000) == 0 {
            return Ok((result, num_read));
        }
    }
    Err("Incomplete VarInt")
}

fn write_string(val: &str, out: &mut Vec<u8>) {
    let bytes = val.as_bytes();
    write_varint(bytes.len() as i32, out);
    out.extend_from_slice(bytes);
}

fn read_string(buf: &[u8]) -> Result<(String, usize), &'static str> {
    let (len, len_bytes) = read_varint(buf)?;
    if len < 0 {
        return Err("Negative string length in VarInt");
    }
    let total_len = len as usize;
    let end_idx = len_bytes.checked_add(total_len).ok_or("Integer overflow in string length")?;
    if buf.len() < end_idx {
        return Err("Buffer too short for string");
    }
    let s = std::str::from_utf8(&buf[len_bytes..end_idx])
        .map_err(|_| "Invalid UTF-8")?
        .to_string();
    Ok((s, end_idx))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_varint_and_string_roundtrip() {
        let mut buf = Vec::new();
        write_varint(25565, &mut buf);
        write_string("mc.hypixel.net", &mut buf);

        let (val, len) = read_varint(&buf).unwrap();
        assert_eq!(val, 25565);

        let (str_val, _) = read_string(&buf[len..]).unwrap();
        assert_eq!(str_val, "mc.hypixel.net");
    }

    #[test]
    fn test_varint_overflow_and_corrupt_bounds() {
        // VarInt with overflow in 5th byte
        let overflow_bytes = [0x80, 0x80, 0x80, 0x80, 0x70];
        assert!(read_varint(&overflow_bytes).is_err());

        // VarInt exceeding 5 bytes
        let too_long = [0x80, 0x80, 0x80, 0x80, 0x80, 0x01];
        assert!(read_varint(&too_long).is_err());

        // Negative length in string
        let mut neg_buf = Vec::new();
        write_varint(-1, &mut neg_buf);
        assert!(read_string(&neg_buf).is_err());
    }
}
