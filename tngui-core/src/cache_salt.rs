//! 反代缓存盐策略：模式（关闭/固定/自动）、刷新周期、固定值与覆盖开关。
//!
//! 反代按当前策略决定是否向推理请求体顶层注入 `cache_salt`，以及注入什么值。自动模式
//! 在进程内生成随机盐并按周期惰性轮换：取盐时比较距上次生成的时间，超过周期就换新值。
//! 盐随反代会话存在，不落盘、不对外展示。

use std::sync::RwLock;
use std::time::{Duration, Instant};

/// 自动模式的默认刷新周期（分钟）。
pub const DEFAULT_REFRESH_MINUTES: u32 = 30;
/// 刷新周期下界（分钟）。
pub const MIN_REFRESH_MINUTES: i64 = 1;
/// 刷新周期上界（分钟）。
pub const MAX_REFRESH_MINUTES: i64 = 1440;
/// 随机盐的字节数，编码为十六进制字符串。
pub const SALT_BYTES: usize = 16;

/// 盐模式。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CacheSaltMode {
    /// 不注入盐。
    Off,
    /// 注入固定值。
    Fixed,
    /// 注入按周期轮换的随机盐。
    Auto,
}

impl CacheSaltMode {
    /// 解析模式字符串；无法识别时回落自动模式（默认姿态是加盐）。
    pub fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "off" => CacheSaltMode::Off,
            "fixed" => CacheSaltMode::Fixed,
            _ => CacheSaltMode::Auto,
        }
    }
}

/// 规整刷新周期：无法解析、非正数或超出上限时回落默认值。
pub fn normalize_refresh_minutes(raw: &str) -> u32 {
    match raw.trim().parse::<i64>() {
        Ok(v) if (MIN_REFRESH_MINUTES..=MAX_REFRESH_MINUTES).contains(&v) => v as u32,
        _ => DEFAULT_REFRESH_MINUTES,
    }
}

/// 盐策略：模式、刷新周期、固定值与覆盖开关。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CacheSaltPolicy {
    pub mode: CacheSaltMode,
    pub refresh_minutes: u32,
    pub fixed_value: String,
    pub overwrite: bool,
}

impl Default for CacheSaltPolicy {
    fn default() -> Self {
        Self {
            mode: CacheSaltMode::Auto,
            refresh_minutes: DEFAULT_REFRESH_MINUTES,
            fixed_value: String::new(),
            overwrite: false,
        }
    }
}

impl CacheSaltPolicy {
    /// 关闭盐：测试与显式关闭用。
    pub fn off() -> Self {
        Self {
            mode: CacheSaltMode::Off,
            ..Self::default()
        }
    }

    /// 从外部输入规整出策略。周期按 [`normalize_refresh_minutes`] 处理，固定值按字符串处理。
    pub fn from_inputs(
        mode: CacheSaltMode,
        refresh_minutes: &str,
        fixed_value: String,
        overwrite: bool,
    ) -> Self {
        Self {
            mode,
            refresh_minutes: normalize_refresh_minutes(refresh_minutes),
            fixed_value,
            overwrite,
        }
    }
}

/// 单次注入决定；`None` 表示不注入。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SaltDecision {
    pub value: String,
    pub overwrite: bool,
}

#[derive(Debug)]
struct SaltInner {
    policy: CacheSaltPolicy,
    current: String,
    generated_at: Instant,
}

/// 反代共享的盐句柄，策略改动即时可见。
#[derive(Debug)]
pub struct CacheSaltHandle {
    inner: RwLock<SaltInner>,
}

impl CacheSaltHandle {
    pub fn new(policy: CacheSaltPolicy) -> Self {
        Self {
            inner: RwLock::new(SaltInner {
                current: random_salt(),
                generated_at: Instant::now(),
                policy,
            }),
        }
    }

    /// 更新策略。切到自动模式（或改变自动模式的周期）时立即换一个新随机盐，
    /// 避免沿用旧会话的盐。
    pub fn update(&self, policy: CacheSaltPolicy) {
        let mut inner = self.inner.write().unwrap();
        let regenerate = policy.mode == CacheSaltMode::Auto
            && (inner.policy.mode != CacheSaltMode::Auto
                || inner.policy.refresh_minutes != policy.refresh_minutes);
        inner.policy = policy;
        if regenerate {
            inner.current = random_salt();
            inner.generated_at = Instant::now();
        }
    }

    /// 当前策略下的注入决定；关闭模式返回 `None`。
    pub fn current(&self) -> Option<SaltDecision> {
        self.current_at(Instant::now())
    }

    /// 取盐并做惰性轮换。`now` 由调用方给出，便于测试推进时间。
    fn current_at(&self, now: Instant) -> Option<SaltDecision> {
        let mut inner = self.inner.write().unwrap();
        match inner.policy.mode {
            CacheSaltMode::Off => None,
            CacheSaltMode::Fixed => Some(SaltDecision {
                value: inner.policy.fixed_value.clone(),
                overwrite: inner.policy.overwrite,
            }),
            CacheSaltMode::Auto => {
                let interval = Duration::from_secs(u64::from(inner.policy.refresh_minutes) * 60);
                if now.duration_since(inner.generated_at) >= interval {
                    inner.current = random_salt();
                    inner.generated_at = now;
                }
                Some(SaltDecision {
                    value: inner.current.clone(),
                    overwrite: inner.policy.overwrite,
                })
            }
        }
    }
}

/// 生成 128 位随机盐的十六进制字符串。
fn random_salt() -> String {
    let mut bytes = [0u8; SALT_BYTES];
    getrandom::fill(&mut bytes).expect("系统随机源不可用");
    let mut out = String::with_capacity(SALT_BYTES * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn off_mode_returns_no_salt() {
        let handle = CacheSaltHandle::new(CacheSaltPolicy::off());
        assert_eq!(handle.current(), None);
    }

    #[test]
    fn fixed_mode_returns_configured_value() {
        let policy = CacheSaltPolicy {
            mode: CacheSaltMode::Fixed,
            fixed_value: "my-salt".to_string(),
            overwrite: true,
            ..CacheSaltPolicy::default()
        };
        let handle = CacheSaltHandle::new(policy);
        assert_eq!(
            handle.current(),
            Some(SaltDecision {
                value: "my-salt".to_string(),
                overwrite: true,
            })
        );
    }

    #[test]
    fn auto_mode_returns_nonempty_hex_salt() {
        let handle = CacheSaltHandle::new(CacheSaltPolicy::default());
        let decision = handle.current().expect("auto mode injects a salt");
        assert_eq!(decision.value.len(), SALT_BYTES * 2);
        assert!(decision.value.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(!decision.overwrite);
    }

    #[test]
    fn auto_mode_keeps_salt_within_interval_and_rotates_after() {
        let handle = CacheSaltHandle::new(CacheSaltPolicy::default());
        let base = Instant::now();
        let first = handle.current_at(base + Duration::from_secs(60)).unwrap();
        let second = handle.current_at(base + Duration::from_secs(120)).unwrap();
        assert_eq!(first.value, second.value, "周期内保持不变");

        let rotated = handle
            .current_at(base + Duration::from_secs(31 * 60))
            .unwrap();
        assert_ne!(first.value, rotated.value, "跨过周期后换新盐");

        let stable = handle
            .current_at(base + Duration::from_secs(31 * 60 + 1))
            .unwrap();
        assert_eq!(rotated.value, stable.value, "新周期内保持新盐");
    }

    #[test]
    fn update_switches_policy_immediately() {
        let handle = CacheSaltHandle::new(CacheSaltPolicy::off());
        assert_eq!(handle.current(), None);

        handle.update(CacheSaltPolicy {
            mode: CacheSaltMode::Fixed,
            fixed_value: "fixed-1".to_string(),
            overwrite: false,
            ..CacheSaltPolicy::default()
        });
        assert_eq!(handle.current().unwrap().value, "fixed-1");
    }

    #[test]
    fn normalize_refresh_minutes_falls_back_on_invalid_input() {
        assert_eq!(normalize_refresh_minutes("15"), 15);
        assert_eq!(normalize_refresh_minutes("1"), 1);
        assert_eq!(normalize_refresh_minutes("1440"), 1440);
        for invalid in ["", "0", "-5", "abc", "1441", " 1.5 "] {
            assert_eq!(
                normalize_refresh_minutes(invalid),
                DEFAULT_REFRESH_MINUTES,
                "input={invalid:?}"
            );
        }
    }

    #[test]
    fn mode_parse_falls_back_to_auto() {
        assert_eq!(CacheSaltMode::parse("off"), CacheSaltMode::Off);
        assert_eq!(CacheSaltMode::parse("Fixed"), CacheSaltMode::Fixed);
        assert_eq!(CacheSaltMode::parse("auto"), CacheSaltMode::Auto);
        assert_eq!(CacheSaltMode::parse("nonsense"), CacheSaltMode::Auto);
    }
}
