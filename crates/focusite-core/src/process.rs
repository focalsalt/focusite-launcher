//! Minecraft subprocess execution and stream management.

use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

pub struct ProcessLauncher {
    pub java_path: PathBuf,
    pub jvm_args: Vec<String>,
    pub main_class: String,
    pub game_args: Vec<String>,
    pub working_dir: PathBuf,
}

impl ProcessLauncher {
    pub fn new(java_path: PathBuf, working_dir: PathBuf, main_class: String) -> Self {
        Self {
            java_path,
            jvm_args: Vec::new(),
            main_class,
            game_args: Vec::new(),
            working_dir,
        }
    }

    /// Spawns the child process and pipes stdout/stderr.
    pub fn spawn(&self) -> Result<tokio::process::Child, std::io::Error> {
        let mut cmd = Command::new(&self.java_path);
        cmd.current_dir(&self.working_dir);
        cmd.args(&self.jvm_args);
        cmd.arg(&self.main_class);
        cmd.args(&self.game_args);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        cmd.spawn()
    }
}

/// Helper to read output lines asynchronously from a process stream.
pub async fn read_stream_lines<R: tokio::io::AsyncRead + Unpin, F: Fn(String)>(
    stream: R,
    callback: F,
) -> Result<(), std::io::Error> {
    let mut reader = BufReader::new(stream).lines();
    while let Some(line) = reader.next_line().await? {
        callback(line);
    }
    Ok(())
}
