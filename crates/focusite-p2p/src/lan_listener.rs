//! Detects a world the local game opened to LAN by listening for its UDP 4445 announcements.

use std::collections::HashSet;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::{Duration, Instant};

use socket2::{Domain, Protocol, Socket, Type};
use tokio::net::UdpSocket;
use tokio::sync::watch;

use crate::lan_broadcast::{local_adapters, parse_lan_packet};

const MULTICAST_GROUP: Ipv4Addr = Ipv4Addr::new(224, 0, 2, 60);
/// The game announces every 1.5 s; this long without a packet means the world is closed.
const WORLD_TIMEOUT: Duration = Duration::from_secs(10);

/// Our own announcements ([`crate::LanBroadcaster`]) share the port and must not be mistaken for a game.
pub fn is_own_motd(motd: &str) -> bool {
    motd.starts_with("[Focusite")
}

/// Watches for a world the game on this computer has opened to LAN.
pub struct LanWatcher {
    task: tokio::task::JoinHandle<()>,
}

impl LanWatcher {
    /// Starts listening; the receiver holds the game port while a world is open, `None` otherwise.
    pub fn start() -> std::io::Result<(Self, watch::Receiver<Option<u16>>)> {
        let socket = bind_socket()?;
        let (tx, rx) = watch::channel(None);
        let task = tokio::spawn(async move {
            let mut joined: HashSet<Ipv4Addr> = HashSet::new();
            let mut last_seen: Option<Instant> = None;
            let mut buf = [0u8; 1024];
            loop {
                // Adapters come and go (Wi-Fi roams, a VPN connects), so membership is refreshed each round.
                let adapters = local_adapters();
                for (ip, _) in &adapters {
                    if joined.insert(*ip) {
                        let _ = socket.join_multicast_v4(MULTICAST_GROUP, *ip);
                    }
                }
                let local: HashSet<IpAddr> = adapters.iter().map(|(ip, _)| IpAddr::V4(*ip)).collect();

                if let Ok(Ok((len, SocketAddr::V4(from)))) =
                    tokio::time::timeout(Duration::from_secs(2), socket.recv_from(&mut buf)).await
                {
                    let from_ip = IpAddr::V4(*from.ip());
                    if from_ip.is_loopback() || local.contains(&from_ip) {
                        let parsed = std::str::from_utf8(&buf[..len]).ok().and_then(parse_lan_packet);
                        if let Some((_, port)) = parsed.filter(|(motd, _)| !is_own_motd(motd)) {
                            last_seen = Some(Instant::now());
                            tx.send_if_modified(|cur| {
                                let changed = *cur != Some(port);
                                *cur = Some(port);
                                changed
                            });
                        }
                    }
                }
                if last_seen.is_some_and(|t| t.elapsed() > WORLD_TIMEOUT) {
                    last_seen = None;
                    tx.send_replace(None);
                }
            }
        });
        Ok((Self { task }, rx))
    }
}

impl Drop for LanWatcher {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// UDP 4445 with address reuse, because the game and other launchers listen on it as well.
fn bind_socket() -> std::io::Result<UdpSocket> {
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    socket.set_reuse_address(true)?;
    socket.set_nonblocking(true)?;
    socket.bind(&SocketAddr::from((Ipv4Addr::UNSPECIFIED, 4445)).into())?;
    UdpSocket::from_std(socket.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn own_announcements_are_ignored() {
        assert!(is_own_motd("[Focusite · Alice]"));
        assert!(!is_own_motd("A Minecraft Server"));
    }

    #[tokio::test]
    async fn detects_world_from_local_packet() {
        let Ok((_watcher, mut rx)) = LanWatcher::start() else { return };
        let sender = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let packet = crate::format_lan_packet("My World", 40123);
        for _ in 0..5 {
            let _ = sender.send_to(packet.as_bytes(), "127.0.0.1:4445").await;
            if tokio::time::timeout(Duration::from_millis(300), rx.changed()).await.is_ok() {
                break;
            }
        }
        assert_eq!(*rx.borrow(), Some(40123));
    }
}
