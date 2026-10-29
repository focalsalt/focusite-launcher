//! Minecraft LAN discovery broadcaster over UDP 4445.
//! Broadcasts `[MOTD]{motd}[/MOTD][AD]{port}[/AD]` so local vanilla/modded
//! Minecraft clients automatically discover Focusite P2P rooms in "Multiplayer -> LAN Worlds".

use std::net::SocketAddr;
use std::time::Duration;
use tokio::net::UdpSocket;
use tokio::sync::watch;
use tracing::{debug, info};

pub const MC_LAN_MULTICAST_ADDR: &str = "224.0.2.60:4445";
pub const MC_LAN_BROADCAST_ADDR: &str = "255.255.255.255:4445";

/// Formats a Minecraft LAN announcement payload.
pub fn format_lan_packet(motd: &str, port: u16) -> String {
    format!("[MOTD]{}[/MOTD][AD]{}[/AD]", motd, port)
}

/// Parses a Minecraft LAN announcement payload into `(motd, port)`.
pub fn parse_lan_packet(raw: &str) -> Option<(String, u16)> {
    let motd_start = raw.find("[MOTD]")? + 6;
    let motd_end = raw.find("[/MOTD]")?;
    let ad_start = raw.find("[AD]")? + 4;
    let ad_end = raw.find("[/AD]")?;

    if motd_end < motd_start || ad_end < ad_start {
        return None;
    }

    let motd = raw[motd_start..motd_end].to_string();
    let port_str = &raw[ad_start..ad_end];
    let port = port_str.trim().parse::<u16>().ok()?;

    Some((motd, port))
}

pub struct LanBroadcaster {
    motd_tx: watch::Sender<String>,
    stop_tx: Option<watch::Sender<bool>>,
    task_handle: Option<tokio::task::JoinHandle<()>>,
}

impl LanBroadcaster {
    /// Spawns a background task broadcasting LAN discovery packets every 1.5 seconds.
    pub async fn start(motd: String, port: u16) -> Result<Self, std::io::Error> {
        // Bind to any ephemeral local UDP port
        let socket = UdpSocket::bind("0.0.0.0:0").await?;
        let _ = socket.set_broadcast(true);

        let (stop_tx, mut stop_rx) = watch::channel(false);
        let (motd_tx, mut motd_rx) = watch::channel(motd.clone());

        let task_handle = tokio::spawn(async move {
            info!("LAN Broadcaster started for port {}, motd: {}", port, motd);
            let multicast_addr: SocketAddr = MC_LAN_MULTICAST_ADDR.parse().unwrap();
            let broadcast_addr: SocketAddr = MC_LAN_BROADCAST_ADDR.parse().unwrap();

            let mut current_payload_bytes = format_lan_packet(&motd, port).into_bytes();

            loop {
                // Check if stop requested
                if *stop_rx.borrow() {
                    debug!("LAN Broadcaster stop signal received");
                    break;
                }

                if motd_rx.has_changed().unwrap_or(false) {
                    let updated_motd = motd_rx.borrow_and_update().clone();
                    current_payload_bytes = format_lan_packet(&updated_motd, port).into_bytes();
                }

                // Send to both multicast and broadcast addresses for maximum compatibility
                if let Err(e) = socket.send_to(&current_payload_bytes, multicast_addr).await {
                    debug!("LAN multicast send warning: {}", e);
                }
                if let Err(e) = socket.send_to(&current_payload_bytes, broadcast_addr).await {
                    debug!("LAN broadcast send warning: {}", e);
                }

                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_millis(1500)) => {},
                    _ = stop_rx.changed() => {
                        if *stop_rx.borrow() {
                            break;
                        }
                    }
                    _ = motd_rx.changed() => {
                        let updated_motd = motd_rx.borrow_and_update().clone();
                        current_payload_bytes = format_lan_packet(&updated_motd, port).into_bytes();
                    }
                }
            }
            debug!("LAN Broadcaster stopped");
        });

        Ok(Self {
            motd_tx,
            stop_tx: Some(stop_tx),
            task_handle: Some(task_handle),
        })
    }

    /// Dynamically updates the MOTD announced in LAN packets.
    pub async fn update_motd(&self, new_motd: String) {
        let _ = self.motd_tx.send(new_motd);
    }

    /// Stops the broadcaster background task.
    pub async fn stop(&mut self) {
        if let Some(tx) = self.stop_tx.take() {
            let _ = tx.send(true);
        }
        if let Some(handle) = self.task_handle.take() {
            let _ = handle.await;
        }
    }
}

impl Drop for LanBroadcaster {
    fn drop(&mut self) {
        if let Some(tx) = self.stop_tx.take() {
            let _ = tx.send(true);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lan_packet_format_and_parse() {
        let motd = "[Focusite · Alice] MyWorld — 1.20.4";
        let port = 54321;
        let formatted = format_lan_packet(motd, port);
        assert_eq!(
            formatted,
            "[MOTD][Focusite · Alice] MyWorld — 1.20.4[/MOTD][AD]54321[/AD]"
        );

        let parsed = parse_lan_packet(&formatted).expect("failed to parse lan packet");
        assert_eq!(parsed.0, motd);
        assert_eq!(parsed.1, port);
    }

    #[tokio::test]
    async fn test_lan_broadcaster_lifecycle() {
        let mut broadcaster = LanBroadcaster::start(
            "[Focusite · Test] UnitWorld".into(),
            25565,
        )
        .await
        .expect("failed to start broadcaster");

        // Let it run for 100ms
        tokio::time::sleep(Duration::from_millis(100)).await;

        // Stop gracefully
        broadcaster.stop().await;
    }
}
