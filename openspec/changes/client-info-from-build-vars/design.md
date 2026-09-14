## Context

见 `proposal.md - Why`。`frontend/src/views/SettingsView.vue` 客户端信息卡写死 `v0.2.1-dev`/`Desktop`（`:218`/`:219`）；`Cargo.toml` `workspace.package.version = "0.3.0"` 且 `tngui-app` `version.workspace = true`。需经编译期变量传出。

## Goals / Non-Goals

**Goals:**
- 客户端版本=`env!("CARGO_PKG_VERSION")`；操作系统=编译期平台常量友好名；经一个 Tauri 命令暴露并渲染。

**Non-Goals:**
- 不改"更新通道"等其它项；不改 gateway-state 卡的 "TNG v0.2.1"（那是 `tng` 二进制版本，不同源，后续）。
- 不引入 git commit/buildtime（留作 Open Questions）。

## Decisions

- **D1 — 取值来源。** 版本 `env!("CARGO_PKG_VERSION")`（`tngui-app` crate，workspace `0.3.0`）；OS `std::env::consts::OS` 映射友好名（windows/macOS/linux，其余回退原值）。备选：运行时 `sysinfo` 探测——否决，用户要"编译变量"，且运行时探测在跨容器/语言下不一致。
- **D2 — 暴露方式。** 新增 `#[tauri::command] fn app_info() -> AppInfo { version, os }` 并在 `generate_handler!` 注册；前端 `appInfo()` 包装，设置页 `onMounted` invoke。备选：Vite `define` 注入 `package.json` 版本——否决，`package.json`(`0.1.0`)≠Cargo 版本，且 OS 需 Rust `cfg`。
- **D3 — 获取时机/失败。** 设置页 `onMounted` 今取得；失败回落占位（如"未知"）而非崩。备选：预注入 Tauri config——可但复杂，命令更直接。

## Risks / Trade-offs

- [版本漂移] workspace.version 改动后客户端版本自动随之——正是目标，非风险。
- [跨架构] 可附带 ARCH（x86_64/aarch64）增强诊断；本变更 OS 为主、ARCH 可选展示。
- [GUI 系统依赖] `cargo build -p tngui-app` 需 atk/WebKitGTK，本机或不可建（环境限制）；实现方在目标平台构建验证。

## Migration Plan

纯展示取值来源替换，无数据迁移。回滚＝`git revert`。

## Open Questions

- 是否同时附 git commit / 构建时间（经 `build.rs` 注入）？当前客户端版本仅 semver；如需审计证据可后续补 build-script 注入 buildtime/commit。
