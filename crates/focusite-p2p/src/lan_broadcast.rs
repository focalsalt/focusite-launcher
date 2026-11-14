//! Minecraft LAN discovery broadcaster over UDP 4445.
//! Broadcasts `[MOTD]{motd}[/MOTD][AD]{port}[/AD]` so local vanilla/modded
//! Minecraft clients automatically discover Focusite P2P rooms in "Multiplayer -> LAN Worlds".

use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr};
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
    stop_tx: Option<watch::Sender<bool>>,
    task_handle: Option<tokio::task::JoinHandle<()>>,
}

/// IPv4 address of every usable local adapter with its directed broadcast address.
fn local_adapters() -> Vec<(Ipv4Addr, Option<Ipv4Addr>)> {
    if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter(|iface| !iface.is_loopback())
        .filter_map(|iface| match iface.addr {
            if_addrs::IfAddr::V4(v4) if !v4.ip.is_link_local() && !v4.ip.is_unspecified() => Some((v4.ip, v4.broadcast)),
            _ => None,
        })
        .collect()
}

impl LanBroadcaster {
    /// Spawns a background task announcing the world every 1.5 seconds on every local adapter.
    ///
    /// One socket is bound per adapter address, so the announcement leaves through each network
    /// (Wi-Fi, Ethernet) instead of only the default route, which a VPN or virtual switch may own.
    pub async fn start(motd: String, port: u16) -> Result<Self, std::io::Error> {
        // Fail early when nothing can be bound at all.
        let fallback = UdpSocket::bind("0.0.0.0:0").await?;
        let _ = fallback.set_broadcast(true);

        let (stop_tx, mut stop_rx) = watch::channel(false);
        let task_handle = tokio::spawn(async move {
            info!("LAN Broadcaster started for port {}, motd: {}", port, motd);
            let payload = format_lan_packet(&motd, port).into_bytes();
            let multicast_addr: SocketAddr = MC_LAN_MULTICAST_ADDR.parse().expect("valid constant");
            let broadcast_addr: SocketAddr = MC_LAN_BROADCAST_ADDR.parse().expect("valid constant");
            let mut sockets: HashMap<Ipv4Addr, (UdpSocket, Option<Ipv4Addr>)> = HashMap::new();

            loop {
                // Follow adapters coming and going (VPN connects, Wi-Fi roams).
                let adapters = local_adapters();
                sockets.retain(|ip, _| adapters.iter().any(|(a, _)| a == ip));
                for (ip, broadcast) in &adapters {
                    if sockets.contains_key(ip) {
                        continue;
                    }
                    if let Ok(socket) = UdpSocket::bind((*ip, 0)).await {
                        let _ = socket.set_broadcast(true);
                        sockets.insert(*ip, (socket, *broadcast));
                    }
                }

                if sockets.is_empty() {
                    let _ = fallback.send_to(&payload, multicast_addr).await;
                    let _ = fallback.send_to(&payload, broadcast_addr).await;
                }
                for (socket, directed) in sockets.values() {
                    if let Err(e) = socket.send_to(&payload, multicast_addr).await {
                        debug!("LAN multicast send warning: {}", e);
                    }
                    let target = directed.map_or(broadcast_addr, |ip| SocketAddr::from((ip, 4445)));
                    if let Err(e) = socket.send_to(&payload, target).await {
                        debug!("LAN broadcast send warning: {}", e);
                    }
                }

                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_millis(1500)) => {},
                    _ = stop_rx.changed() => break,
                }
            }
            debug!("LAN Broadcaster stopped");
        });

        Ok(Self { stop_tx: Some(stop_tx), task_handle: Some(task_handle) })
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
