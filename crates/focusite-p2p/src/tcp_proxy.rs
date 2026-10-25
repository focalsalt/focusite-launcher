//! Local user-space TCP loopback listener proxy.

use std::net::SocketAddr;
use tokio::net::TcpListener;
use crate::P2pError;

pub struct LocalTcpProxy {
    bind_port: u16,
}

impl LocalTcpProxy {
    pub fn new(bind_port: u16) -> Self {
        Self { bind_port }
    }

    /// Binds to 127.0.0.1 on the specified port.
    pub async fn bind(&self) -> Result<(TcpListener, SocketAddr), P2pError> {
        let addr: SocketAddr = format!("127.0.0.1:{}", self.bind_port)
            .parse()
            .map_err(|e: std::net::AddrParseError| P2pError::WebRtcError(e.to_string()))?;

        let listener = TcpListener::bind(addr).await?;
        let local_addr = listener.local_addr()?;
        Ok((listener, local_addr))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_bind_ephemeral_port() {
        let proxy = LocalTcpProxy::new(0); // 0 binds to any available ephemeral port
        let res = proxy.bind().await;
        assert!(res.is_ok());
        let (_listener, addr) = res.unwrap();
        assert_eq!(addr.ip(), std::net::Ipv4Addr::new(127, 0, 0, 1));
        assert!(addr.port() > 0);
    }
}
