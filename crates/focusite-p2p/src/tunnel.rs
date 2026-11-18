//! Real WebRTC tunnel: one DataChannel carries many Minecraft TCP connections.
//!
//! Signaling is manual (copy/paste of offer and answer codes), so no server is needed.
//! Host side: DataChannel <-> `127.0.0.1:<game port>`. Guest side: `127.0.0.1:<local port>` <-> DataChannel.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use bytes::Bytes;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, Notify};
use webrtc::api::setting_engine::SettingEngine;
use webrtc::api::APIBuilder;
use webrtc::ice::udp_network::{EphemeralUDP, UDPNetwork};
use webrtc::data_channel::data_channel_message::DataChannelMessage;
use webrtc::data_channel::RTCDataChannel;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::RTCPeerConnection;

use crate::webrtc::{
    decode_offline_signal, encode_offline_signal, DataChannelFrame, FrameType, SignalEnvelope,
    StunTurnConfig,
};
use crate::P2pError;

/// Payload size per DataChannel message; well below the SCTP message limit.
const CHUNK: usize = 16 * 1024;
const PING_INTERVAL: Duration = Duration::from_secs(2);
/// UDP ports the tunnel binds. Fixed so one firewall rule (or router rule) covers every session.
pub const UDP_PORT_RANGE: (u16, u16) = (47400, 47499);
const SETUP_TIMEOUT: Duration = Duration::from_secs(15);
/// Most simultaneous TCP connections one tunnel carries; a peer cannot open more.
const MAX_CONNS: usize = 32;
/// Reading from a local socket pauses while this many bytes wait in the DataChannel send buffer.
const SEND_HIGH_WATER: usize = 1024 * 1024;

fn rtc_err(context: &str, e: impl std::fmt::Display) -> P2pError {
    P2pError::WebRtcError(format!("{context}: {e}"))
}

/// What a registered connection hands back: its queue sender, queue receiver and cancel signal.
type ConnParts = (mpsc::Sender<Vec<u8>>, mpsc::Receiver<Vec<u8>>, Arc<Notify>);

struct Conn {
    tx: mpsc::Sender<Vec<u8>>,
    /// Wakes the TCP reader when the peer closed this connection.
    cancel: Arc<Notify>,
}

struct Shared {
    dc: Mutex<Option<Arc<RTCDataChannel>>>,
    conns: Mutex<HashMap<u16, Conn>>,
    next_id: AtomicU16,
    /// Host only: the local game port that new tunnel connections are forwarded to.
    target_port: Option<u16>,
    status: Mutex<String>,
    latency_ms: AtomicU32,
    sent: AtomicU64,
    received: AtomicU64,
    closed: AtomicBool,
    epoch: Instant,
}

impl Shared {
    fn new(target_port: Option<u16>) -> Arc<Self> {
        Arc::new(Self {
            dc: Mutex::new(None),
            conns: Mutex::new(HashMap::new()),
            next_id: AtomicU16::new(1),
            target_port,
            status: Mutex::new("connecting".into()),
            latency_ms: AtomicU32::new(0),
            sent: AtomicU64::new(0),
            received: AtomicU64::new(0),
            closed: AtomicBool::new(false),
            epoch: Instant::now(),
        })
    }

    fn set_status(&self, s: &str) {
        *self.status.lock().unwrap() = s.to_string();
    }

    fn is_connected(&self) -> bool {
        *self.status.lock().unwrap() == "connected"
    }

    fn channel(&self) -> Option<Arc<RTCDataChannel>> {
        self.dc.lock().unwrap().clone()
    }

    async fn send(&self, frame: DataChannelFrame) {
        if let Some(dc) = self.channel() {
            let len = frame.payload.len() as u64;
            if dc.send(&Bytes::from(frame.encode())).await.is_ok() && frame.frame_type == FrameType::Data {
                self.sent.fetch_add(len, Ordering::Relaxed);
            }
        }
    }

    fn drop_conn(&self, id: u16) -> Option<Conn> {
        self.conns.lock().unwrap().remove(&id)
    }

    /// Registers a connection, or returns None when the tunnel already carries `MAX_CONNS`.
    fn register(self: &Arc<Self>, id: u16) -> Option<ConnParts> {
        let mut conns = self.conns.lock().unwrap();
        if conns.len() >= MAX_CONNS {
            return None;
        }
        let (tx, rx) = mpsc::channel(256);
        let cancel = Arc::new(Notify::new());
        conns.insert(id, Conn { tx: tx.clone(), cancel: cancel.clone() });
        Some((tx, rx, cancel))
    }

    /// Waits while the DataChannel still holds too much unsent data, so a fast local socket
    /// cannot pile up memory behind a slow network.
    async fn wait_for_send_room(&self) {
        let Some(dc) = self.channel() else { return };
        while dc.buffered_amount().await > SEND_HIGH_WATER && !self.closed.load(Ordering::Relaxed) {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    fn alloc_id(&self) -> Option<u16> {
        let conns = self.conns.lock().unwrap();
        (0..u16::MAX).find_map(|_| {
            let id = self.next_id.fetch_add(1, Ordering::Relaxed).max(1);
            (!conns.contains_key(&id)).then_some(id)
        })
    }
}

/// Pumps one TCP connection through the DataChannel until either side closes.
async fn run_conn(
    shared: Arc<Shared>,
    id: u16,
    mut rx: mpsc::Receiver<Vec<u8>>,
    cancel: Arc<Notify>,
    stream: std::io::Result<TcpStream>,
) {
    let stream = match stream {
        Ok(s) => s,
        Err(_) => {
            shared.drop_conn(id);
            shared.send(DataChannelFrame::new(id, FrameType::Close, 0, Vec::new())).await;
            return;
        }
    };
    let _ = stream.set_nodelay(true);
    let (mut rd, mut wr) = stream.into_split();
    // Ends when the connection is dropped from `conns`, after flushing what is queued.
    tokio::spawn(async move {
        while let Some(bytes) = rx.recv().await {
            if wr.write_all(&bytes).await.is_err() {
                break;
            }
        }
        let _ = wr.shutdown().await;
    });

    let mut buf = vec![0u8; CHUNK];
    let mut seq = 0u32;
    let mut closed_by_peer = false;
    loop {
        tokio::select! {
            read = rd.read(&mut buf) => match read {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    shared.wait_for_send_room().await;
                    shared.send(DataChannelFrame::new(id, FrameType::Data, seq, buf[..n].to_vec())).await;
                    seq = seq.wrapping_add(1);
                }
            },
            _ = cancel.notified() => { closed_by_peer = true; break; }
        }
    }
    shared.drop_conn(id);
    if !closed_by_peer {
        shared.send(DataChannelFrame::new(id, FrameType::Close, seq, Vec::new())).await;
    }
}

async fn handle_message(shared: &Arc<Shared>, bytes: &[u8]) {
    let Ok(frame) = DataChannelFrame::decode(bytes) else { return };
    match frame.frame_type {
        FrameType::Data => {
            shared.received.fetch_add(frame.payload.len() as u64, Ordering::Relaxed);
            let id = frame.channel_id;
            let existing = shared.conns.lock().unwrap().get(&id).map(|c| c.tx.clone());
            let tx = match (existing, shared.target_port) {
                (Some(tx), _) => Some(tx),
                // Host: the first frame (seq 0) of a new id opens a connection to the local game. A later
                // frame for an unknown id is a leftover of a connection already closed: it must not reopen it.
                (None, Some(port)) if frame.seq == 0 => match shared.register(id) {
                    Some((tx, rx, cancel)) => {
                        let shared2 = shared.clone();
                        tokio::spawn(async move {
                            let stream = TcpStream::connect(("127.0.0.1", port)).await;
                            run_conn(shared2, id, rx, cancel, stream).await;
                        });
                        Some(tx)
                    }
                    None => {
                        shared.send(DataChannelFrame::new(id, FrameType::Close, 0, Vec::new())).await;
                        None
                    }
                },
                (None, _) => None,
            };
            if let Some(tx) = tx {
                // A full queue means the local socket cannot keep up: end that connection instead of
                // stalling every other connection behind it.
                if tx.try_send(frame.payload).is_err() {
                    if let Some(conn) = shared.drop_conn(id) {
                        conn.cancel.notify_one();
                    }
                    shared.send(DataChannelFrame::new(id, FrameType::Close, 0, Vec::new())).await;
                }
            }
        }
        FrameType::Close => {
            if let Some(conn) = shared.drop_conn(frame.channel_id) {
                conn.cancel.notify_one();
            }
        }
        FrameType::Ping => {
            shared.send(DataChannelFrame::new(0, FrameType::Pong, frame.seq, frame.payload)).await;
        }
        FrameType::Pong => {
            if let Ok(raw) = <[u8; 8]>::try_from(frame.payload.as_slice()) {
                let sent_at = u64::from_be_bytes(raw);
                let now = shared.epoch.elapsed().as_micros() as u64;
                let rtt_ms = (now.saturating_sub(sent_at) / 1000).max(1);
                shared.latency_ms.store(rtt_ms as u32, Ordering::Relaxed);
            }
        }
    }
}

/// Wires message handling and the latency ping onto a DataChannel.
fn attach_channel(shared: &Arc<Shared>, dc: Arc<RTCDataChannel>) {
    *shared.dc.lock().unwrap() = Some(dc.clone());

    let on_msg = shared.clone();
    dc.on_message(Box::new(move |msg: DataChannelMessage| {
        let shared = on_msg.clone();
        Box::pin(async move { handle_message(&shared, &msg.data).await })
    }));

    let on_open = shared.clone();
    dc.on_open(Box::new(move || {
        let shared = on_open.clone();
        Box::pin(async move {
            tokio::spawn(async move {
                let mut seq = 0u32;
                while !shared.closed.load(Ordering::Relaxed) {
                    let now = shared.epoch.elapsed().as_micros() as u64;
                    shared
                        .send(DataChannelFrame::new(0, FrameType::Ping, seq, now.to_be_bytes().to_vec()))
                        .await;
                    seq = seq.wrapping_add(1);
                    tokio::time::sleep(PING_INTERVAL).await;
                }
            });
        })
    }));
}

async fn new_peer(shared: &Arc<Shared>, stun: &StunTurnConfig) -> Result<Arc<RTCPeerConnection>, P2pError> {
    let mut ice_servers = Vec::new();
    if !stun.stun_servers.is_empty() {
        ice_servers.push(RTCIceServer { urls: stun.stun_servers.clone(), ..Default::default() });
    }
    for turn in &stun.turn_servers {
        ice_servers.push(RTCIceServer {
            urls: vec![turn.url.clone()],
            username: turn.username.clone().unwrap_or_default(),
            credential: turn.credential.clone().unwrap_or_default(),
        });
    }
    let config = RTCConfiguration { ice_servers, ..Default::default() };
    let mut engine = SettingEngine::default();
    let udp = EphemeralUDP::new(UDP_PORT_RANGE.0, UDP_PORT_RANGE.1).map_err(|e| rtc_err("UDP 連接埠範圍無效", e))?;
    engine.set_udp_network(UDPNetwork::Ephemeral(udp));
    let pc = Arc::new(
        APIBuilder::new()
            .with_setting_engine(engine)
            .build()
            .new_peer_connection(config)
            .await
            .map_err(|e| rtc_err("建立 PeerConnection 失敗", e))?,
    );

    let state = shared.clone();
    pc.on_peer_connection_state_change(Box::new(move |s: RTCPeerConnectionState| {
        state.set_status(match s {
            RTCPeerConnectionState::Connected => "connected",
            RTCPeerConnectionState::Disconnected => "disconnected",
            RTCPeerConnectionState::Failed => "failed",
            RTCPeerConnectionState::Closed => "closed",
            _ => "connecting",
        });
        Box::pin(async {})
    }));
    Ok(pc)
}

/// Waits for ICE gathering and returns the full local description (candidates included).
async fn gathered_sdp(pc: &RTCPeerConnection, desc: RTCSessionDescription) -> Result<String, P2pError> {
    let mut gather_done = pc.gathering_complete_promise().await;
    pc.set_local_description(desc).await.map_err(|e| rtc_err("設定本機描述失敗", e))?;
    // A timeout still leaves usable host/srflx candidates gathered so far.
    let _ = tokio::time::timeout(SETUP_TIMEOUT, gather_done.recv()).await;
    pc.local_description()
        .await
        .map(|d| d.sdp)
        .ok_or_else(|| P2pError::WebRtcError("無法取得本機 SDP".into()))
}

/// Point-in-time numbers of a running tunnel.
#[derive(Debug, Clone)]
pub struct TunnelStats {
    pub status: String,
    pub latency_ms: u32,
    pub bytes_sent: u64,
    pub bytes_received: u64,
}

pub struct Tunnel {
    pc: Arc<RTCPeerConnection>,
    shared: Arc<Shared>,
    accept_task: Option<tokio::task::JoinHandle<()>>,
    /// Guest only: the loopback port Minecraft connects to.
    pub local_port: Option<u16>,
    /// Guest only: data taken from the host's offer.
    pub peer_alias: Option<String>,
    pub peer_game_port: Option<u16>,
}

pub struct HostOffer {
    pub tunnel: Tunnel,
    pub offer_code: String,
}

pub struct GuestAnswer {
    pub tunnel: Tunnel,
    pub answer_code: String,
}

impl Tunnel {
    /// Host: creates the offer code to send to the friend.
    pub async fn create_host_offer(
        game_port: u16,
        alias: String,
        stun: &StunTurnConfig,
    ) -> Result<HostOffer, P2pError> {
        let shared = Shared::new(Some(game_port));
        let pc = new_peer(&shared, stun).await?;
        let dc = pc
            .create_data_channel("focusite", None)
            .await
            .map_err(|e| rtc_err("建立 DataChannel 失敗", e))?;
        attach_channel(&shared, dc);

        let offer = pc.create_offer(None).await.map_err(|e| rtc_err("建立 Offer 失敗", e))?;
        let sdp = gathered_sdp(&pc, offer).await?;
        let offer_code = encode_offline_signal(&SignalEnvelope {
            version: 1,
            sdp_type: "offer".into(),
            sdp,
            alias: Some(alias),
            host_port: Some(game_port),
        })?;
        Ok(HostOffer {
            tunnel: Tunnel { pc, shared, accept_task: None, local_port: None, peer_alias: None, peer_game_port: None },
            offer_code,
        })
    }

    /// Host: applies the friend's answer code. Connection state follows from ICE.
    pub async fn apply_answer(&self, answer_code: &str) -> Result<(), P2pError> {
        let env = decode_offline_signal(answer_code)?;
        if env.sdp_type != "answer" {
            return Err(P2pError::SignalingFailed("傳入的代碼不是有效的 Answer 代碼".into()));
        }
        let desc = RTCSessionDescription::answer(env.sdp).map_err(|e| rtc_err("Answer 格式錯誤", e))?;
        self.pc.set_remote_description(desc).await.map_err(|e| rtc_err("套用 Answer 失敗", e))
    }

    /// Guest: takes the host's offer code, opens a loopback listener and returns the answer code.
    pub async fn accept_offer(
        offer_code: &str,
        local_port: u16,
        stun: &StunTurnConfig,
    ) -> Result<GuestAnswer, P2pError> {
        let env = decode_offline_signal(offer_code)?;
        if env.sdp_type != "offer" {
            return Err(P2pError::SignalingFailed("傳入的代碼不是有效的 Offer 代碼".into()));
        }
        let offer = RTCSessionDescription::offer(env.sdp).map_err(|e| rtc_err("Offer 格式錯誤", e))?;

        let shared = Shared::new(None);
        let pc = new_peer(&shared, stun).await?;
        let on_dc = shared.clone();
        pc.on_data_channel(Box::new(move |dc| {
            attach_channel(&on_dc, dc);
            Box::pin(async {})
        }));

        pc.set_remote_description(offer).await.map_err(|e| rtc_err("套用 Offer 失敗", e))?;
        let answer = pc.create_answer(None).await.map_err(|e| rtc_err("建立 Answer 失敗", e))?;
        let sdp = gathered_sdp(&pc, answer).await?;
        let answer_code = encode_offline_signal(&SignalEnvelope {
            version: 1,
            sdp_type: "answer".into(),
            sdp,
            alias: None,
            host_port: None,
        })?;

        let (listener, addr) = crate::tcp_proxy::LocalTcpProxy::new(local_port).bind().await?;
        let accept_task = tokio::spawn(accept_loop(listener, shared.clone()));

        Ok(GuestAnswer {
            tunnel: Tunnel {
                pc,
                shared,
                accept_task: Some(accept_task),
                local_port: Some(addr.port()),
                peer_alias: env.alias,
                peer_game_port: env.host_port,
            },
            answer_code,
        })
    }

    pub fn stats(&self) -> TunnelStats {
        TunnelStats {
            status: self.shared.status.lock().unwrap().clone(),
            latency_ms: self.shared.latency_ms.load(Ordering::Relaxed),
            bytes_sent: self.shared.sent.load(Ordering::Relaxed),
            bytes_received: self.shared.received.load(Ordering::Relaxed),
        }
    }

    pub async fn close(&mut self) {
        self.shared.closed.store(true, Ordering::Relaxed);
        if let Some(task) = self.accept_task.take() {
            task.abort();
        }
        let conns: Vec<Conn> = self.shared.conns.lock().unwrap().drain().map(|(_, c)| c).collect();
        for conn in conns {
            conn.cancel.notify_one();
        }
        let _ = self.pc.close().await;
        self.shared.set_status("closed");
    }
}

async fn accept_loop(listener: TcpListener, shared: Arc<Shared>) {
    while let Ok((stream, _)) = listener.accept().await {
        // Nothing to forward to until the peer connection is up: refuse so Minecraft shows an error at once.
        if !shared.is_connected() {
            continue;
        }
        let Some(id) = shared.alloc_id() else { continue };
        let Some((_tx, rx, cancel)) = shared.register(id) else { continue };
        tokio::spawn(run_conn(shared.clone(), id, rx, cancel, Ok(stream)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Two peers in one process: a fake game server on the host, a client going through the tunnel.
    #[tokio::test(flavor = "multi_thread")]
    async fn test_bytes_cross_the_tunnel_both_ways() {
        let game = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let game_port = game.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((mut s, _)) = game.accept().await {
                tokio::spawn(async move {
                    let mut buf = [0u8; 64];
                    while let Ok(n) = s.read(&mut buf).await {
                        if n == 0 || s.write_all(&buf[..n]).await.is_err() {
                            break;
                        }
                    }
                });
            }
        });

        // No STUN: both peers are on this machine, host candidates are enough.
        let no_stun = StunTurnConfig { stun_servers: Vec::new(), turn_servers: Vec::new() };
        let host = Tunnel::create_host_offer(game_port, "Host".into(), &no_stun).await.unwrap();
        let guest = Tunnel::accept_offer(&host.offer_code, 0, &no_stun).await.unwrap();
        host.tunnel.apply_answer(&guest.answer_code).await.unwrap();

        for _ in 0..100 {
            if host.tunnel.stats().status == "connected" && guest.tunnel.stats().status == "connected" {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        assert_eq!(guest.tunnel.stats().status, "connected");
        assert_eq!(guest.tunnel.peer_game_port, Some(game_port));

        // Two parallel Minecraft-like connections must not mix up.
        let port = guest.tunnel.local_port.unwrap();
        for msg in [&b"hello through webrtc"[..], &b"second connection"[..]] {
            let mut client = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            client.write_all(msg).await.unwrap();
            let mut got = vec![0u8; msg.len()];
            tokio::time::timeout(Duration::from_secs(5), client.read_exact(&mut got)).await.unwrap().unwrap();
            assert_eq!(got, msg);
        }
        assert!(guest.tunnel.stats().bytes_sent > 0 && host.tunnel.stats().bytes_received > 0);

        // The tunnel carries at most MAX_CONNS connections; the next one is refused.
        let mut open = Vec::new();
        for _ in 0..MAX_CONNS {
            let mut c = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            c.write_all(b"x").await.unwrap();
            let mut one = [0u8; 1];
            tokio::time::timeout(Duration::from_secs(5), c.read_exact(&mut one)).await.unwrap().unwrap();
            open.push(c);
        }
        let mut extra = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let _ = extra.write_all(b"x").await;
        let mut one = [0u8; 1];
        let refused = tokio::time::timeout(Duration::from_secs(5), extra.read(&mut one)).await.unwrap();
        assert!(matches!(refused, Ok(0) | Err(_)), "connection beyond the cap must be closed");
        drop(open);

        let (mut h, mut g) = (host.tunnel, guest.tunnel);
        g.close().await;
        h.close().await;
    }

    #[tokio::test]
    async fn test_wrong_code_kind_is_rejected() {
        let no_stun = StunTurnConfig { stun_servers: Vec::new(), turn_servers: Vec::new() };
        let host = Tunnel::create_host_offer(25565, "H".into(), &no_stun).await.unwrap();
        // An offer is not an answer.
        assert!(host.tunnel.apply_answer(&host.offer_code).await.is_err());
        // And an answer is not an offer.
        assert!(Tunnel::accept_offer("not-a-code", 0, &no_stun).await.is_err());
    }
}
