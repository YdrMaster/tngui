//! 反代缓存盐策略：模式（忽略/添加/覆盖）、定时刷新与定量刷新参数。
//!
//! 反代按当前策略决定如何向推理请求体顶层写入 `cache_salt`。盐值在进程内生成并按请求
//! 惰性轮换：定时到点、定量到数或用户直接改值，三条渠道任一触发就换一个新随机盐，并把
//! 定时基线与定量计数一起重置。盐随反代会话存在，不落盘、不对外展示。

use std::sync::RwLock;
use std::time::{Duration, Instant};

/// 定时刷新的默认周期（分钟）。
pub const DEFAULT_REFRESH_MINUTES: u32 = 30;
/// 刷新周期下界（分钟）。
pub const MIN_REFRESH_MINUTES: i64 = 1;
/// 刷新周期上界（分钟）。
pub const MAX_REFRESH_MINUTES: i64 = 1440;
/// 定量刷新的默认阈值（请求数）。
pub const DEFAULT_COUNT_THRESHOLD: u32 = 50;
/// 定量刷新阈值下界。
pub const MIN_COUNT_THRESHOLD: i64 = 1;
/// 定量刷新阈值上界。
pub const MAX_COUNT_THRESHOLD: i64 = 100_000;
/// 随机盐的字节数，编码为十六进制字符串。
pub const SALT_BYTES: usize = 16;

/// 盐模式。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CacheSaltMode {
    /// 完全不管盐：既不读请求已有的盐，也不往请求里加盐。
    Ignore,
    /// 请求缺盐才补：已有 `cache_salt` 时原样保留。
    Add,
    /// 无论请求是否已有盐，都换成当前盐。
    Overwrite,
}

impl CacheSaltMode {
    /// 解析模式字符串；无法识别时回落添加模式（默认姿态是加盐）。
    pub fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "ignore" => CacheSaltMode::Ignore,
            "overwrite" => CacheSaltMode::Overwrite,
            _ => CacheSaltMode::Add,
        }
    }
}

/// 规整定时刷新周期：无法解析、非正数或超出上限时回落默认值。
pub fn normalize_refresh_minutes(raw: &str) -> u32 {
    match raw.trim().parse::<i64>() {
        Ok(v) if (MIN_REFRESH_MINUTES..=MAX_REFRESH_MINUTES).contains(&v) => v as u32,
        _ => DEFAULT_REFRESH_MINUTES,
    }
}

/// 规整定量刷新阈值：无法解析、非正数或超出上限时回落默认值。
pub fn normalize_count_threshold(raw: &str) -> u32 {
    match raw.trim().parse::<i64>() {
        Ok(v) if (MIN_COUNT_THRESHOLD..=MAX_COUNT_THRESHOLD).contains(&v) => v as u32,
        _ => DEFAULT_COUNT_THRESHOLD,
    }
}

/// 盐策略：模式、定时刷新开关与周期、定量刷新开关与阈值。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CacheSaltPolicy {
    pub mode: CacheSaltMode,
    pub timer_enabled: bool,
    pub refresh_minutes: u32,
    pub count_enabled: bool,
    pub count_threshold: u32,
}

impl Default for CacheSaltPolicy {
    fn default() -> Self {
        Self {
            mode: CacheSaltMode::Add,
            timer_enabled: true,
            refresh_minutes: DEFAULT_REFRESH_MINUTES,
            count_enabled: false,
            count_threshold: DEFAULT_COUNT_THRESHOLD,
        }
    }
}

impl CacheSaltPolicy {
    /// 忽略盐：测试与显式不介入用。
    pub fn ignore() -> Self {
        Self {
            mode: CacheSaltMode::Ignore,
            ..Self::default()
        }
    }

    /// 从外部输入规整出策略。两个数值按字符串接收，非法输入在核心侧回落默认值。
    pub fn from_inputs(
        mode: CacheSaltMode,
        timer_enabled: bool,
        refresh_minutes: &str,
        count_enabled: bool,
        count_threshold: &str,
    ) -> Self {
        Self {
            mode,
            timer_enabled,
            refresh_minutes: normalize_refresh_minutes(refresh_minutes),
            count_enabled,
            count_threshold: normalize_count_threshold(count_threshold),
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
    /// 自上次刷新起已计数的请求数。
    requests_since_reset: u32,
}

impl SaltInner {
    /// 定时到点或定量到数就换新盐，并同时重置两条记录。返回是否发生了轮换。
    fn rotate_if_due(&mut self, now: Instant) -> bool {
        let timer_due = self.policy.timer_enabled
            && now.duration_since(self.generated_at)
                >= Duration::from_secs(u64::from(self.policy.refresh_minutes) * 60);
        let count_due =
            self.policy.count_enabled && self.requests_since_reset >= self.policy.count_threshold;
        if !timer_due && !count_due {
            return false;
        }
        self.current = random_salt();
        self.reset_baseline(now);
        true
    }

    /// 把定时基线与定量计数一起归零。
    fn reset_baseline(&mut self, now: Instant) {
        self.generated_at = now;
        self.requests_since_reset = 0;
    }
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
                requests_since_reset: 0,
                policy,
            }),
        }
    }

    /// 更新策略。改参数或换模式都不算一次刷新：当前盐保持不变，只把定时基线与定量计数重置。
    pub fn update(&self, policy: CacheSaltPolicy) {
        let mut inner = self.inner.write().unwrap();
        inner.policy = policy;
        inner.reset_baseline(Instant::now());
    }

    /// 直接改盐值：换成给定值，并重置定时基线与定量计数。
    pub fn set_value(&self, value: String) {
        let mut inner = self.inner.write().unwrap();
        inner.current = value;
        inner.reset_baseline(Instant::now());
    }

    /// 只读当前实际使用的盐：不轮换、不计数。忽略模式返回 `None`。
    pub fn peek_current(&self) -> Option<String> {
        let inner = self.inner.read().unwrap();
        match inner.policy.mode {
            CacheSaltMode::Ignore => None,
            _ => Some(inner.current.clone()),
        }
    }

    /// 供一次转发使用取盐并计数；忽略模式返回 `None`，调用方据此跳过整个加盐步骤。
    pub fn current(&self) -> Option<SaltDecision> {
        self.current_at(Instant::now())
    }

    /// 取盐、按需轮换并计入本次请求。`now` 由调用方给出，便于测试推进时间。
    fn current_at(&self, now: Instant) -> Option<SaltDecision> {
        let mut inner = self.inner.write().unwrap();
        let overwrite = match inner.policy.mode {
            CacheSaltMode::Ignore => return None,
            CacheSaltMode::Add => false,
            CacheSaltMode::Overwrite => true,
        };
        inner.rotate_if_due(now);
        inner.requests_since_reset += 1;
        Some(SaltDecision {
            value: inner.current.clone(),
            overwrite,
        })
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

    fn add_policy(
        timer_enabled: bool,
        count_enabled: bool,
        count_threshold: u32,
    ) -> CacheSaltPolicy {
        CacheSaltPolicy {
            mode: CacheSaltMode::Add,
            timer_enabled,
            count_enabled,
            count_threshold,
            ..CacheSaltPolicy::default()
        }
    }

    #[test]
    fn ignore_mode_returns_no_salt() {
        let handle = CacheSaltHandle::new(CacheSaltPolicy::ignore());
        assert_eq!(handle.current(), None);
        assert_eq!(handle.peek_current(), None);
    }

    #[test]
    fn add_mode_does_not_overwrite() {
        let handle = CacheSaltHandle::new(CacheSaltPolicy::default());
        let decision = handle.current().expect("添加模式注入盐");
        assert!(!decision.overwrite);
        assert_eq!(decision.value.len(), SALT_BYTES * 2);
    }

    #[test]
    fn overwrite_mode_sets_overwrite_flag() {
        let handle = CacheSaltHandle::new(CacheSaltPolicy {
            mode: CacheSaltMode::Overwrite,
            ..CacheSaltPolicy::default()
        });
        let decision = handle.current().expect("覆盖模式注入盐");
        assert!(decision.overwrite);
    }

    #[test]
    fn timer_keeps_salt_within_period_and_rotates_after() {
        let handle = CacheSaltHandle::new(add_policy(true, false, DEFAULT_COUNT_THRESHOLD));
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
    fn count_rotates_on_the_request_after_the_threshold() {
        let handle = CacheSaltHandle::new(add_policy(false, true, 50));
        let base = Instant::now();
        let first = handle.current_at(base).unwrap().value;
        for _ in 0..49 {
            assert_eq!(
                handle.current_at(base).unwrap().value,
                first,
                "前 50 个请求同盐"
            );
        }
        assert_ne!(
            handle.current_at(base).unwrap().value,
            first,
            "第 51 个请求触发刷新"
        );
        let after = handle.peek_current().unwrap();
        assert_ne!(after, first);
        assert_eq!(
            handle.current_at(base).unwrap().value,
            after,
            "刷新后重新计数，盐保持"
        );
    }

    #[test]
    fn first_channel_wins_and_resets_the_other_record() {
        // 规格里的例子：30 分钟定时 + 50 个请求定量，请求先攒满。
        let mut policy = add_policy(true, true, 50);
        policy.refresh_minutes = 30;
        let handle = CacheSaltHandle::new(policy);
        let base = Instant::now();
        let first = handle.current_at(base).unwrap().value;
        for _ in 0..49 {
            assert_eq!(handle.current_at(base).unwrap().value, first);
        }
        let rotated = handle.current_at(base).unwrap().value;
        assert_ne!(rotated, first, "第 51 个请求先刷新");

        // 计数已被重置：再发 48 个请求只累计到 49，不会触发。
        for _ in 0..48 {
            assert_eq!(handle.current_at(base).unwrap().value, rotated);
        }
        // 定时也已被重置：第 50 个请求落在 20 分钟处，仍不到 30 分钟，不换。
        assert_eq!(
            handle
                .current_at(base + Duration::from_secs(20 * 60))
                .unwrap()
                .value,
            rotated
        );
        // 跨过 30 分钟才按定时换。
        assert_ne!(
            handle
                .current_at(base + Duration::from_secs(31 * 60))
                .unwrap()
                .value,
            rotated
        );
    }

    #[test]
    fn update_resets_baselines_without_changing_the_salt() {
        let handle = CacheSaltHandle::new(add_policy(false, true, 2));
        let base = Instant::now();
        let first = handle.current_at(base).unwrap().value;

        // 只改参数：计数被重置，当前盐不变。
        handle.update(add_policy(false, true, 2));
        assert_eq!(handle.peek_current().unwrap(), first);
        assert_eq!(
            handle.current_at(base).unwrap().value,
            first,
            "重置后重新计数"
        );
        assert_eq!(handle.current_at(base).unwrap().value, first);
        assert_ne!(
            handle.current_at(base).unwrap().value,
            first,
            "重新攒满 2 个请求后才刷新"
        );
    }

    #[test]
    fn set_value_replaces_salt_and_resets_records() {
        let handle = CacheSaltHandle::new(add_policy(true, true, 2));
        let base = Instant::now();
        let _ = handle.current_at(base);
        let _ = handle.current_at(base);

        handle.set_value("user-salt".to_string());
        assert_eq!(handle.peek_current().unwrap(), "user-salt");
        // 记录已重置：还要再发满 2 个请求才轮到定量刷新。
        assert_eq!(handle.current_at(base).unwrap().value, "user-salt");
        assert_eq!(handle.current_at(base).unwrap().value, "user-salt");
        assert_ne!(handle.current_at(base).unwrap().value, "user-salt");
    }

    #[test]
    fn peek_current_does_not_rotate_or_count() {
        let handle = CacheSaltHandle::new(add_policy(false, true, 2));
        let base = Instant::now();
        let first = handle.peek_current().unwrap();
        for _ in 0..10 {
            assert_eq!(handle.peek_current().unwrap(), first);
        }
        // 读数不推计数：仍然要两个请求才满，第三个才刷新。
        assert_eq!(handle.current_at(base).unwrap().value, first);
        assert_eq!(handle.current_at(base).unwrap().value, first);
        assert_ne!(handle.current_at(base).unwrap().value, first);
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
    fn normalize_count_threshold_falls_back_on_invalid_input() {
        assert_eq!(normalize_count_threshold("1"), 1);
        assert_eq!(normalize_count_threshold("250"), 250);
        assert_eq!(normalize_count_threshold("100000"), 100_000);
        for invalid in ["", "0", "-3", "abc", "100001"] {
            assert_eq!(
                normalize_count_threshold(invalid),
                DEFAULT_COUNT_THRESHOLD,
                "input={invalid:?}"
            );
        }
    }

    #[test]
    fn mode_parse_maps_new_names_and_falls_back_to_add() {
        assert_eq!(CacheSaltMode::parse("ignore"), CacheSaltMode::Ignore);
        assert_eq!(CacheSaltMode::parse("Add"), CacheSaltMode::Add);
        assert_eq!(CacheSaltMode::parse("overwrite"), CacheSaltMode::Overwrite);
        for legacy in ["off", "fixed", "auto", "nonsense", ""] {
            assert_eq!(CacheSaltMode::parse(legacy), CacheSaltMode::Add, "{legacy}");
        }
    }
}
