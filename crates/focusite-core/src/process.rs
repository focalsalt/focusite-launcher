//! Minecraft subprocess execution, stream piping, and process lifecycle management.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// Builder for launching Minecraft child processes.
#[derive(Debug, Clone)]
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

    /// Spawns the child process with structured arguments and piped stdio.
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

    /// Spawns a child process with a flat list of arguments (pre-built from build_launch_arguments).
    pub fn spawn_direct(
        java_path: &Path,
        working_dir: &Path,
        arguments: &[String],
    ) -> Result<tokio::process::Child, std::io::Error> {
        let mut cmd = Command::new(java_path);
        cmd.current_dir(working_dir);
        cmd.args(arguments);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        cmd.spawn()
    }
}

/// Helper to read output lines asynchronously from a process stream.
pub async fn read_stream_lines<R: tokio::io::AsyncRead + Unpin, F: Fn(String) + Send + 'static>(
    stream: R,
    callback: F,
) -> Result<(), std::io::Error> {
    let mut reader = BufReader::new(stream).lines();
    while let Some(line) = reader.next_line().await? {
        callback(line);
    }
    Ok(())
}

/// Terminates a process tree cleanly given its process ID.
pub async fn terminate_process_tree(pid: u32) -> Result<(), std::io::Error> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new("taskkill");
        cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        let _ = cmd.status();
        Ok(())
    }

    #[cfg(not(windows))]
    {
        let mut cmd = Command::new("kill");
        cmd.arg("-9");
        cmd.arg(pid.to_string());
        let _ = cmd.status().await;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_process_launcher_construction() {
        let launcher = ProcessLauncher::new(
            PathBuf::from("javaw.exe"),
            PathBuf::from("C:/game"),
            "net.minecraft.client.main.Main".into(),
        );
        assert_eq!(launcher.main_class, "net.minecraft.client.main.Main");
        assert_eq!(launcher.working_dir, PathBuf::from("C:/game"));
    }
}
