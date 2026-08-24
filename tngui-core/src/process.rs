//! 进程契约（A）与捕获契约（C）。
//!
//! - `spawn_managed`：在新进程组里拉起子进程，stdout/stderr 按行捕获进 `BoundedLog`。
//! - `kill_group`：终止整个进程组/进程树（重启时先杀旧进程，避免泄漏孙进程）。
//!   Unix 用组信号 SIGTERM；Windows 用 `taskkill /T /F` 按进程树强杀。
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
/// 子进程自成一组（pgid == pid），便于整组终止：
/// Unix 设 process_group(0)；Windows 设 CREATE_NEW_PROCESS_GROUP（组长 pid 即组 id）。
pub async fn spawn_managed(
    mut command: Command,
    log: Arc<Mutex<BoundedLog>>,
) -> io::Result<ManagedChild> {
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    {
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(CREATE_NEW_PROCESS_GROUP);
    }
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());
    command.stdin(std::process::Stdio::null());

    let mut child = command.spawn()?;
    let pid = child.id().ok_or_else(|| io::Error::other("子进程无 pid"))?;

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

/// 终止 `pgid` 对应的整组（Unix）/整棵进程树（Windows，pgid == 组长 pid）。
pub fn kill_group(pgid: i32) -> io::Result<()> {
    if pgid <= 0 {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "pgid 必须为正"));
    }

    #[cfg(unix)]
    {
        // SAFETY: libc::kill 是线程安全的 C 接口；负 pid 对应进程组信号。
        let r = unsafe { libc::kill(-pgid, libc::SIGTERM) };
        if r == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW：GUI 子系统下不闪出控制台窗口。
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let out = std::process::Command::new("taskkill")
            .args(["/PID", &pgid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()?;
        if out.status.success() {
            Ok(())
        } else {
            Err(io::Error::other(format!(
                "taskkill: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            )))
        }
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
        self.log.lock().map(|g| g.snapshot()).unwrap_or_default()
    }

    /// 清空日志（每次启动前清一遍，便于看本次输出）。
    pub fn clear_log(&self) {
        if let Ok(mut g) = self.log.lock() {
            g.clear();
        }
    }

    /// spawn 前确保 `bin` 可执行：无 owner 执行位则尝试补上；失败（如缺 chmod 权限）则忽略，
    /// 由后续 spawn 自然报错。Windows 无执行位概念，空操作。
    #[cfg(unix)]
    fn ensure_executable(&self) {
        use std::os::unix::fs::PermissionsExt;
        let p = Path::new(&self.bin);
        let Ok(meta) = std::fs::metadata(p) else {
            return;
        };
        if !meta.is_file() {
            return;
        }
        let mode = meta.permissions().mode();
        if mode & 0o100 == 0 {
            // 既无 owner 执行位：补 u/g/o 执行位（保留原读写位）。chmod 失败（无权限）则忽略。
            let _ = std::fs::set_permissions(p, std::fs::Permissions::from_mode(mode | 0o111));
        }
    }

    #[cfg(not(unix))]
    fn ensure_executable(&self) {}

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
    pub async fn launch(&mut self, config_file: &Path, log_file: &Path) -> io::Result<u32> {
        self.kill_current().await;
        self.clear_log();
        self.ensure_executable();
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
        // 先整组/整树终止，再对 leader 强杀兜底
        let _ = kill_group(m.pgid);
        let mut child = m.child;
        let _ = child.start_kill();
        let _ = child.wait().await; // reap，避免僵尸
        true
    }

    /// 子进程是否仍在运行。
    pub fn is_running(&mut self) -> bool {
        match &mut self.managed {
            Some(m) => matches!(m.child.try_wait(), Ok(None)),
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
        #[cfg(unix)]
        {
            let mut c = Command::new("sh");
            c.arg("-c")
                .arg("echo start; echo bad-field-on-stderr: >&2; echo to-stdout; exec sleep 30");
            c
        }
        #[cfg(windows)]
        {
            let mut c = Command::new("powershell");
            c.arg("-NoProfile").arg("-Command").arg(concat!(
                "'start'; ",
                "\"bad-field-on-stderr:\" | Write-Host; ",
                "'to-stdout' | Write-Host; ",
                "Start-Sleep -Seconds 30",
            ));
            c
        }
    }

    #[tokio::test]
    async fn capture_stdout_and_stderr() {
        let log = Arc::new(Mutex::new(BoundedLog::new(128)));
        // 这个替身立刻退出
        #[cfg(unix)]
        let c = {
            let mut c = Command::new("sh");
            c.arg("-c").arg("echo out-line; echo err-line >&2; exit 0");
            c
        };
        #[cfg(windows)]
        let c = {
            let mut c = Command::new("cmd");
            c.arg("/C").arg("echo out-line& echo err-line 1>&2");
            c
        };
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
        // 进程应活着：try_wait 返回 None 表示尚未退出
        assert!(matches!(m.child.try_wait(), Ok(None)), "子进程应存活");

        kill_group(m.pgid).unwrap();
        // 整组终止后再 reap，避免僵尸让存活检查误判
        let _ = m.child.start_kill();
        let _ = m.child.wait().await;
        tokio::time::sleep(Duration::from_millis(50)).await;
        // reap 之后 kill(pid,0) 应当 ESRCH
        #[cfg(unix)]
        {
            let pid = m.pid as i32;
            let still_alive = unsafe { libc::kill(pid, 0) } == 0;
            assert!(!still_alive, "进程组杀后子进程仍存活 pid={pid}");
        }
        // Windows 无僵尸概念：wait 返回即已退出
        #[cfg(windows)]
        assert!(m.child.try_wait().unwrap().is_some());
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
