//! Tauri commands for Minecraft servers.dat management and async SLP pinging.

use std::path::PathBuf;
use std::time::Duration;
use tauri::command;
use focusite_core::server::{read_servers_dat, write_servers_dat, ServerEntry};
use focusite_core::slp::{ping_minecraft_server, ServerPingResult};
use super::instance::{get_instances_dir, validate_safe_id};

fn resolve_servers_dat_path(instance_id: &str) -> Result<PathBuf, String> {
    validate_safe_id(instance_id)?;
    let instance_dir = get_instances_dir().join(instance_id);
    let p1 = instance_dir.join("minecraft").join("servers.dat");
    if p1.parent().map(|p| p.is_dir()).unwrap_or(false) {
        return Ok(p1);
    }
    Ok(instance_dir.join("servers.dat"))
}

#[command]
pub fn read_instance_servers_cmd(instance_id: String) -> Result<Vec<ServerEntry>, String> {
    let path = resolve_servers_dat_path(&instance_id)?;
    read_servers_dat(&path).map_err(super::ctx("E_SERVERS_READ_FAILED"))
}

#[command]
pub fn save_instance_servers_cmd(
    instance_id: String,
    servers: Vec<ServerEntry>,
) -> Result<(), String> {
    validate_safe_id(&instance_id)?;
    if super::instance::is_instance_busy(&instance_id) {
        return Err("E_INSTANCE_BUSY".into());
    }
    let path = resolve_servers_dat_path(&instance_id)?;
    write_servers_dat(&path, &servers).map_err(super::ctx("E_SERVERS_SAVE_FAILED"))
}

#[command]
pub async fn ping_server_cmd(host: String, port: Option<u16>) -> Result<ServerPingResult, String> {
    let effective_port = port.unwrap_or(25565);
    ping_minecraft_server(&host, effective_port, Duration::from_millis(3000))
        .await
        .map_err(super::ctx("E_SERVER_PING_FAILED"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_server_commands_id_validation() {
        assert!(read_instance_servers_cmd("../unsafe_id".into()).is_err());
        assert!(save_instance_servers_cmd("../unsafe_id".into(), vec![]).is_err());
    }
}
