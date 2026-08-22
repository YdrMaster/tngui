//! 子进程输出的有界环形缓冲。
//!
//! 子进程 stdout/stderr 按行读入此处，前端可随时取快照。容量上限避免无限增长。

use std::collections::VecDeque;

pub struct BoundedLog {
    lines: VecDeque<String>,
    cap: usize,
}

impl BoundedLog {
    pub fn new(cap: usize) -> Self {
        // 上限保护，避免传 0 导致永远丢弃
        let cap = cap.clamp(1, 65536);
        Self {
            lines: VecDeque::with_capacity(cap.min(2048)),
            cap,
        }
    }

    /// 追加一行；超容量时丢弃最旧的一行。
    pub fn push(&mut self, line: String) {
        if self.lines.len() >= self.cap {
            self.lines.pop_front();
        }
        self.lines.push_back(line);
    }

    /// 当前所有行的快照（旧→新）。
    pub fn snapshot(&self) -> Vec<String> {
        self.lines.iter().cloned().collect()
    }

    pub fn clear(&mut self) {
        self.lines.clear();
    }

    pub fn len(&self) -> usize {
        self.lines.len()
    }

    pub fn is_empty(&self) -> bool {
        self.lines.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_and_snapshot() {
        let mut log = BoundedLog::new(3);
        log.push("a".into());
        log.push("b".into());
        log.push("c".into());
        log.push("d".into()); // 丢弃 a
        assert_eq!(log.snapshot(), vec!["b", "c", "d"]);
    }

    #[test]
    fn clamps_zero_cap() {
        let mut log = BoundedLog::new(0);
        log.push("x".into());
        assert_eq!(log.snapshot(), vec!["x"]);
    }
}