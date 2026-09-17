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
use tokio::process::{Child, Command as TokioCommand};

use crate::log::BoundedLog;

#[cfg(windows)]
use {
    std::os::windows::io::{AsRawHandle as _, FromRawHandle as _, OwnedHandle},
    windows_sys::Win32::{
        Foundation::HANDLE,
        System::{
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
                SetInformationJobObject,
            },
            Threading::{
                OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
            },
        },
    },
};

/// 一次被托管拉起的子进程：句柄 + pid + 进程组 id。
pub struct ManagedChild {
    pub child: Child,
    pub pid: u32,
    pub pgid: i32,
    /// Windows: tng 所在的 Job Object 句柄（KILL_ON_JOB_CLOSE）。句柄随 ManagedChild 存活，
    /// drop（重启替换 / 进程退出 / 崩溃）时关闭句柄 → 内核自动杀整组 tng。建失败则 None。
    #[cfg(windows)]
    pub job: Option<OwnedHandle>,
}

/// 在新进程组里拉起 `command`，stdout/stderr 管道捕获进共享 `log`。
///
/// 子进程自成一组（pgid == pid），便于整组终止：
/// Unix 设 process_group(0)；Windows 设 CREATE_NEW_PROCESS_GROUP（组长 pid 即组 id）。
pub async fn spawn_managed(
    mut command: TokioCommand,
    log: Arc<Mutex<BoundedLog>>,
) -> io::Result<ManagedChild> {
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    {
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000; // 不给子进程弹控制台黑窗
        command.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);
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

    // Windows: 把 tng 指派进 Job Object（KILL_ON_JOB_CLOSE），使其随 tngui 同步退出（含崩溃）。
    #[cfg(windows)]
    let job = create_and_assign_job(pid).ok();

    Ok(ManagedChild {
        child,
        pid,
        pgid: pid as i32,
        #[cfg(windows)]
        job,
    })
}

/// Windows：创建带 `KILL_ON_JOB_CLOSE` 的 Job Object 并把 `pid` 指派进去。
/// 返回的句柄存活期间进程在 job 内；句柄一关（drop / 进程退出）内核即杀整组。
#[cfg(windows)]
fn create_and_assign_job(pid: u32) -> io::Result<OwnedHandle> {
    unsafe {
        let raw_job: HANDLE = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if raw_job.is_null() {
            return Err(io::Error::last_os_error());
        }
        let job = OwnedHandle::from_raw_handle(raw_job);

        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let set_ok = SetInformationJobObject(
            job.as_raw_handle() as HANDLE,
            JobObjectExtendedLimitInformation,
            &mut info as *mut _ as *mut _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if set_ok == 0 {
            return Err(io::Error::last_os_error());
        }

        let raw_proc = OpenProcess(
            PROCESS_SET_QUOTA | PROCESS_TERMINATE | PROCESS_QUERY_INFORMATION,
            0,
            pid,
        );
        if raw_proc.is_null() {
            return Err(io::Error::last_os_error());
        }
        let proc = OwnedHandle::from_raw_handle(raw_proc);

        let assign_ok =
            AssignProcessToJobObject(job.as_raw_handle() as HANDLE, proc.as_raw_handle());
        if assign_ok == 0 {
            return Err(io::Error::last_os_error());
        }

        // 进程已指派，proc 句柄不再需要；关闭之。job 句柄随返回值存活。
        drop(proc);
        Ok(job)
    }
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

/// 封装 `tng launch …` 的启停，持有共享日志。持有双套 tng 二进制：
/// - `bin_nora`：普通版（全部 ingress 均关闭远程证明时使用，找不到由 PATH 兜底）
/// - `bin_ra`：远程证明版（任一 ingress 开 RA 时使用，`None` = 未随包提供，绝不回退）
pub struct TngSupervisor {
    bin_nora: String,
    bin_ra: Option<String>,
    rust_log: String,
    log: Arc<Mutex<BoundedLog>>,
    managed: Option<ManagedChild>,
}

impl TngSupervisor {
    pub fn new(bin_nora: impl Into<String>, bin_ra: Option<String>, log_cap: usize) -> Self {
        Self {
            bin_nora: bin_nora.into(),
            bin_ra,
            rust_log: "info".to_string(),
            log: Arc::new(Mutex::new(BoundedLog::new(log_cap))),
            managed: None,
        }
    }

    /// RA 版二进制路径；未随包提供（如 macOS x86_64）或资源缺失时为 `None`。
    /// 调用方（`launch_tng`）据此在停掉当前会话**之前**拒绝启动——绝不静默回退普通版。
    pub fn ra_bin(&self) -> Option<&str> {
        self.bin_ra.as_deref()
    }

    /// 本次应启动的 bin：RA 开须 RA 版（缺失报错不回退）；RA 关用普通版。
    /// 在 kill 旧进程前调用，保证缺 RA 版时不误杀现有会话。
    fn select_bin(&self, ra_required: bool) -> io::Result<&str> {
        if ra_required {
            self.bin_ra.as_deref().ok_or_else(|| {
                io::Error::other("当前平台未随包提供远程证明版 tng 二进制；开启远程证明需要该版本")
            })
        } else {
            Ok(&self.bin_nora)
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
    /// 由后续 spawn 自然报错。Windows 无执行位概念，空操作。RA 版二进制入库无执行位
    /// （git 亦不记录执行位），运行期由本函数对选定的 bin 自动补位。
    #[cfg(unix)]
    fn ensure_executable(&self, bin: &str) {
        use std::os::unix::fs::PermissionsExt;
        let p = Path::new(bin);
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
    fn ensure_executable(&self, _bin: &str) {}

    /// 构造 `tng launch -c <config_file>` 命令（不传 --log-file，使 tng 日志走 stdout →
    /// 被 get_output 捕获 → UI 可见；可单测）。RA 启动必须携带 RVS 地址；
    /// 非 RA 启动不得注入 `RATS_TEE_VERIFIER_URL`。
    fn build_command(
        &self,
        bin: &str,
        config_file: &Path,
        ra_required: bool,
        rvs_url: Option<&str>,
    ) -> std::process::Command {
        let mut c = std::process::Command::new(bin);
        c.arg("launch")
            .arg("-c")
            .arg(config_file)
            .env("RUST_LOG", &self.rust_log);
        if ra_required {
            let rvs_url = rvs_url.expect("launch 已保证 RA 启动携带 RVS 地址");
            c.env("RATS_TEE_VERIFIER_URL", rvs_url);
        }
        c
    }

    /// 先杀旧进程（若有），再拉起新进程。`ra_required` 决定用哪套 bin（远程证明
    /// 开 → RA 版；关 → 普通版）。RA 启动必须携带非空 RVS 地址；非 RA 启动忽略该值
    /// 且不注入 RVS 环境变量。返回新子进程 pid。
    pub async fn launch(
        &mut self,
        config_file: &Path,
        ra_required: bool,
        rvs_url: Option<&str>,
    ) -> io::Result<u32> {
        // 选定 bin 必须先于 kill：RA 开而 RA 版缺失时报错返回、不误杀现有会话。
        // `to_owned` 解除 self 借用，随后 `kill_current` 可取 &mut self。
        let bin = self.select_bin(ra_required)?.to_owned();
        if ra_required {
            let Some(rvs_url) = rvs_url else {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "开启远程证明时必须提供 RVS 地址",
                ));
            };
            if rvs_url.trim().is_empty() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "开启远程证明时 RVS 地址不能为空",
                ));
            }
        }
        self.kill_current().await;
        self.clear_log();
        self.ensure_executable(&bin);
        let command = self.build_command(&bin, config_file, ra_required, rvs_url);
        let cmd = TokioCommand::from(command);
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
    use std::ffi::OsStr;
    use std::time::Duration;

    /// 用一个能输出到 stdout/stderr 并持续运行的 shell 命令做替身。
    fn dummy_listen() -> TokioCommand {
        // 即便不是 tng，这里验证的是"新进程组 + 捕获 + 整组杀"这层机制。
        #[cfg(unix)]
        {
            let mut c = TokioCommand::new("sh");
            c.arg("-c")
                .arg("echo start; echo bad-field-on-stderr: >&2; echo to-stdout; exec sleep 30");
            c
        }
        #[cfg(windows)]
        {
            let mut c = TokioCommand::new("powershell");
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
            let mut c = TokioCommand::new("sh");
            c.arg("-c").arg("echo out-line; echo err-line >&2; exit 0");
            c
        };
        #[cfg(windows)]
        let c = {
            let mut c = TokioCommand::new("cmd");
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
        let sup = TngSupervisor::new("tng-nora", None, 64);
        let cmd = sup.build_command("tng-nora", Path::new("/tmp/tng-runtime.json"), false, None);
        assert_eq!(cmd.get_program(), OsStr::new("tng-nora"));
        assert_eq!(
            cmd.get_args().collect::<Vec<_>>(),
            vec![
                OsStr::new("launch"),
                OsStr::new("-c"),
                Path::new("/tmp/tng-runtime.json").as_os_str(),
            ]
        );
    }

    #[test]
    fn build_command_injects_exact_rvs_url_only_for_ra_launch() {
        let sup = TngSupervisor::new("tng-nora", Some("/rd/tng.exe".into()), 64);
        const RVS_URL: &str = "https://private-rvs.example.com:8443";
        const RVS_ENV: &str = "RATS_TEE_VERIFIER_URL";

        let ra_cmd = sup.build_command(
            "tng-ra",
            Path::new("/tmp/tng-runtime.json"),
            true,
            Some(RVS_URL),
        );
        let ra_value = ra_cmd
            .get_envs()
            .find(|(key, _)| *key == OsStr::new(RVS_ENV))
            .and_then(|(_, value)| value);
        assert_eq!(ra_value, Some(OsStr::new(RVS_URL)));

        let nora_cmd = sup.build_command(
            "tng-nora",
            Path::new("/tmp/tng-runtime.json"),
            false,
            Some(RVS_URL),
        );
        assert!(
            nora_cmd
                .get_envs()
                .all(|(key, _)| *key != *OsStr::new(RVS_ENV)),
            "非 RA 启动不得注入 RVS 地址"
        );
    }

    #[tokio::test]
    async fn launch_rejects_missing_or_empty_rvs_url_for_ra() {
        let mut sup = TngSupervisor::new("tng-nora", Some("true".into()), 64);
        let missing = sup
            .launch(Path::new("/tmp/tng-runtime.json"), true, None)
            .await
            .unwrap_err();
        assert!(missing.to_string().contains("RVS 地址"));

        let empty = sup
            .launch(Path::new("/tmp/tng-runtime.json"), true, Some("  "))
            .await
            .unwrap_err();
        assert!(empty.to_string().contains("不能为空"));
    }

    #[test]
    fn ra_bin_reflects_construction() {
        assert!(TngSupervisor::new("tng-nora", None, 64).ra_bin().is_none());
        let sup = TngSupervisor::new("tng-nora", Some("/rd/tng-linux-x86_64".into()), 64);
        assert_eq!(sup.ra_bin(), Some("/rd/tng-linux-x86_64"));
    }

    #[tokio::test]
    async fn launch_fails_fast_when_ra_required_without_ra_bin() {
        let mut sup = TngSupervisor::new("tng-nora", None, 64);
        let err = sup
            .launch(
                Path::new("/tmp/tng-runtime.json"),
                true,
                Some("https://rvs.tsk.com:9443"),
            )
            .await
            .unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("远程证明"), "错误应说明 RA 版缺失: {msg}");
        assert!(msg.contains("需要该版本"), "错误应给出明确动作指引: {msg}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn launch_selects_ra_bin_when_ra_required() {
        // nora bin 故意不存在：若 launch 误用普通版会 spawn 失败；成功即证明用的是 RA bin。
        let mut sup =
            TngSupervisor::new("definitely-missing-tng-nora", Some("true".to_string()), 64);
        sup.launch(
            Path::new("/tmp/tng-runtime.json"),
            true,
            Some("https://private-rvs.example.com:8443"),
        )
        .await
        .expect("ra_required 时应使用 RA 版二进制启动");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn launch_selects_nora_bin_when_ra_not_required() {
        // RA bin 缺失也不影响 RA 关时的启动：普通版仍可 launch。
        let mut sup = TngSupervisor::new("true", None, 64);
        sup.launch(Path::new("/tmp/tng-runtime.json"), false, None)
            .await
            .expect("RA 关时应使用普通版二进制启动");
        assert!(sup.is_running() || !sup.is_running()); // true 立即退出，仅确认无 panic
    }
}
