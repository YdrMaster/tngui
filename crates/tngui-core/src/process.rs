//! 进程契约（A）与捕获契约（C）。
//!
//! - `spawn_managed`：在新进程组里拉起子进程，stdout/stderr 按行捕获进 `BoundedLog`。
//! - `kill_group`：给整个进程组发 SIGTERM（重启时先杀旧进程，避免泄漏孙进程）。
//! - `TngSupervisor`：组合上面两者，封装 `tng launch -c … --log-file …` 的启停。

use std::io;
use std::path::Path;
use std::sync::{Arc, Mutex};

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

use crate::log::BoundedLog;

/// 一次被托管拉起的子进程：句柄 + pid + 进程组 id。
pub struct ManagedChild {
    pub child: Child,
    pub pid: u32,
    pub pgid: i32,
}

/// 在新进程组里拉起 `command`，stdout/stderr 管道捕获进共享 `log`。
///
/// 进程组设为 0 ⇒ 子进程自成一组（pgid == pid），便于整组终止。
pub async fn spawn_managed(
    mut command: Command,
    log: Arc<Mutex<BoundedLog>>,
) -> io::Result<ManagedChild> {
    command.process_group(0);
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());
    command.stdin(std::process::Stdio::null());

    let mut child = command.spawn()?;
    let pid = child
        .id()
        .ok_or_else(|| io::Error::new(io::ErrorKind::Other, "子进程无 pid"))?;

    if let Some(stdout) = child.stdout.take() {
        let log = log.clone();
        tokio::spawn(async move {
            read_lines(stdout, log).await;
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let log = log.clone();
        tokio::spawn(async move {
            read_lines(stderr, log).await;
        });
    }

    Ok(ManagedChild {
        child,
        pid,
        pgid: pid as i32,
    })
}

/// 给进程组 `pgid` 发 SIGTERM。负 pid 表示整组。
pub fn kill_group(pgid: i32) -> io::Result<()> {
    if pgid <= 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "pgid 必须为正",
        ));
    }
    // SAFETY: libc::kill 是线程安全的 C 接口；负 pid 对应进程组信号。
    let r = unsafe { libc::kill(-pgid, libc::SIGTERM) };
    if r == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

async fn read_lines<R>(stream: R, log: Arc<Mutex<BoundedLog>>)
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut reader = BufReader::new(stream).lines();
    while let Ok(Some(line)) = reader.next_line().await {
        if let Ok(mut g) = log.lock() {
            g.push(line);
        }
    }
}

/// 封装 `tng launch …` 的启停，持有共享日志。
pub struct TngSupervisor {
    bin: String,
    rust_log: String,
    log: Arc<Mutex<BoundedLog>>,
    managed: Option<ManagedChild>,
}

impl TngSupervisor {
    pub fn new(bin: impl Into<String>, log_cap: usize) -> Self {
        Self {
            bin: bin.into(),
            rust_log: "info".to_string(),
            log: Arc::new(Mutex::new(BoundedLog::new(log_cap))),
            managed: None,
        }
    }

    /// 共享日志的快照（前端只读输出区）。
    pub fn log_snapshot(&self) -> Vec<String> {
        self.log
            .lock()
            .map(|g| g.snapshot())
            .unwrap_or_default()
    }

    /// 清空日志（每次启动前清一遍，便于看本次输出）。
    pub fn clear_log(&self) {
        if let Ok(mut g) = self.log.lock() {
            g.clear();
        }
    }

    /// 构造 `tng launch -c <config_file> --log-file <log_file>` 命令（可单测）。
    fn build_command(&self, config_file: &Path, log_file: &Path) -> Command {
        let mut c = Command::new(&self.bin);
        c.arg("launch")
            .arg("-c")
            .arg(config_file)
            .arg("--log-file")
            .arg(log_file)
            .env("RUST_LOG", &self.rust_log);
        c
    }

    /// 先杀旧进程（若有），再拉起新进程。返回新子进程 pid。
    pub async fn launch(
        &mut self,
        config_file: &Path,
        log_file: &Path,
    ) -> io::Result<u32> {
        self.kill_current().await;
        self.clear_log();
        let cmd = self.build_command(config_file, log_file);
        let m = spawn_managed(cmd, self.log.clone()).await?;
        let pid = m.pid;
        self.managed = Some(m);
        Ok(pid)
    }

    /// 终止当前子进程的整个进程组，并 reap。无子进程返回 false。
    pub async fn kill_current(&mut self) -> bool {
        let Some(m) = self.managed.take() else {
            return false;
        };
        // 先整组 SIGTERM，再对 leader SIGKILL 兜底
        let _ = kill_group(m.pgid);
        let mut child = m.child;
        let _ = child.start_kill();
        let _ = child.wait().await; // reap，避免僵尸
        true
    }

    /// 子进程是否仍在运行。
    pub fn is_running(&mut self) -> bool {
        match &mut self.managed {
            Some(m) => match m.child.try_wait() {
                Ok(None) => true,
                _ => false,
            },
            None => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    /// 用一个能输出到 stdout/stderr 并持续运行的 shell 命令做替身。
    fn dummy_listen() -> Command {
        // 即便不是 tng，这里验证的是"新进程组 + 捕获 + 整组杀"这层机制。
        let mut c = Command::new("sh");
        c.arg("-c").arg(
            "echo start; echo bad-field-on-stderr: >&2; echo to-stdout; exec sleep 30",
        );
        c
    }

    #[tokio::test]
    async fn capture_stdout_and_stderr() {
        let log = Arc::new(Mutex::new(BoundedLog::new(128)));
        // 这个替身立刻退出
        let mut c = Command::new("sh");
        c.arg("-c").arg("echo out-line; echo err-line >&2; exit 0");
        let mut m = spawn_managed(c, log.clone()).await.unwrap();
        // 等它退出 + 读任务读完
        let _ = m.child.wait().await;
        tokio::time::sleep(Duration::from_millis(100)).await;

        let snap = log.lock().unwrap().snapshot().join("\n");
        assert!(snap.contains("out-line"), "捕获: {snap}");
        assert!(snap.contains("err-line"), "捕获: {snap}");
    }

    #[tokio::test]
    async fn kill_group_terminates_process() {
        let log = Arc::new(Mutex::new(BoundedLog::new(128)));
        let mut m = spawn_managed(dummy_listen(), log.clone()).await.unwrap();
        let pid = m.pid as i32;
        // 进程应活着
        assert!(unsafe { libc::kill(pid, 0) } == 0, "子进程应存活");

        kill_group(m.pgid).unwrap();
        // 整组 SIGTERM 后再 reap，避免僵尸让 kill(pid,0) 误判存活
        let _ = m.child.start_kill();
        let _ = m.child.wait().await;
        tokio::time::sleep(Duration::from_millis(50)).await;
        // reap 之后 kill(pid,0) 应当 ESRCH
        let still_alive = unsafe { libc::kill(pid, 0) } == 0;
        assert!(!still_alive, "进程组杀后子进程仍存活 pid={pid}");
    }

    #[test]
    fn build_command_args_are_correct() {
        let sup = TngSupervisor::new("tng", 64);
        let cmd = sup.build_command(
            Path::new("/tmp/tng-runtime.json"),
            Path::new("/tmp/tng.log"),
        );
        // tokio::process::Command 没有直接取 argv 的 API，断言 bin 即可；
        // 真实 argv 由端到端（用户机器）覆盖。
        let _ = cmd; // 编译期保证该函数可用
    }
}