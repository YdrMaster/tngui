# Ant Codespace 本地测试环境说明

本文记录在 Ant Codespace 中运行本仓库测试时的环境要求、已知兼容性问题，以及经过验证的命令。目标读者是在 Ant Codespace 中执行本地回归测试的开发者。

## 结论

- **前端测试不需要特殊环境配置**：在 Ant Codespace 宿主环境执行即可。
- **Rust 测试在当前 Ant Codespace 中需要使用 Ubuntu chroot**：宿主系统是 Alibaba Cloud Linux 3 / glibc 2.32，而当前 workspace 的 Rust 测试产物要求 `GLIBC_2.33` / `GLIBC_2.34`。直接在宿主执行 `cargo test` 会在启动测试二进制时失败。
- **推荐使用 `/tmp/tngui-ubuntu`**：这是 Ubuntu 22.04 / glibc 2.35 环境，已经通过 `/home/admin` bind mount 共享仓库、Rust toolchain 与 Cargo 缓存。
- **Rust 全量测试建议单线程运行**：`tngui-core` 中有绑定 loopback 地址的测试，在当前环境中并行运行偶发 `Address already in use`；`--test-threads=1` 可稳定避免端口竞争。

## 当前环境快照

以下版本来自本仓库已验证的 Ant Codespace 环境：

| 环境 | 系统 | glibc | Rust |
|---|---|---:|---|
| 宿主环境 | Alibaba Cloud Linux 3 | 2.32 | `rustc 1.98.1` |
| `/tmp/tngui-ubuntu` | Ubuntu 22.04.5 LTS | 2.35 | `rustc 1.98.1` |

宿主环境直接运行 Rust 测试时可能看到类似错误：

```text
/lib64/libc.so.6: version `GLIBC_2.33' not found
/lib64/libc.so.6: version `GLIBC_2.34' not found
error: test failed, to rerun pass `--lib`
```

这不是代码断言失败，而是宿主 glibc 版本低于测试二进制所需版本。

## 运行 Rust 测试

### 使用已配置的 Ubuntu chroot

先确认 chroot 已存在：

```bash
test -d /tmp/tngui-ubuntu && echo ok
```

然后执行：

```bash
sudo chroot /tmp/tngui-ubuntu /bin/bash -lc '
  set -euo pipefail
  export HOME=/home/admin
  export PATH=/home/admin/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
  cd /home/admin/yangderui.ydr/YdrMaster/tngui
  cargo test --workspace -- --test-threads=1
'
```

当前该命令会运行：

- `tngui-app` 主 crate：9 个测试
- `tngui-core`：75 个测试
- 两个 crate 的 doc-tests（当前均为 0 个）

如需分步执行：

```bash
sudo chroot /tmp/tngui-ubuntu /bin/bash -lc '
  export HOME=/home/admin
  export PATH=/home/admin/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
  cd /home/admin/yangderui.ydr/YdrMaster/tngui

  cargo test
  cargo test -p tngui-core -- --test-threads=1
'
```

注意：

- 仓库根目录的 `cargo test` 只运行当前 package（`tngui-app`）及依赖构建，不会运行 `tngui-core` 的 unit tests。全量回归应使用 `cargo test --workspace`。
- `target/` 由宿主和 chroot 共享。请在同一环境内保持一致的运行方式；如果曾混用环境并遇到奇怪的链接或运行错误，可在 chroot 内执行 `cargo clean` 后重跑。
- 如果并行运行 `tngui-core` 时出现 `Address already in use (os error 98)`，按上面命令增加 `--test-threads=1` 后复跑。

### 如果 chroot 不存在

`/tmp` 在 Codespace 生命周期后可能被清理。如果平台没有预置 `/tmp/tngui-ubuntu`，需要管理员/root 权限重新创建。一种可行方式是使用 Ubuntu 22.04 rootfs：

```bash
set -euo pipefail

ROOT=/tmp/tngui-ubuntu
sudo mkdir -p "$ROOT"

# 前置条件：宿主有 debootstrap；如无，请由平台管理员安装。
sudo debootstrap --variant=minbase jammy "$ROOT" http://archive.ubuntu.com/ubuntu

# 共享同一个 /home/admin，从而复用仓库、~/.cargo、rustup 与 Cargo 缓存。
sudo mkdir -p "$ROOT/home/admin"
sudo mount --bind /home/admin "$ROOT/home/admin"

# 基础虚拟文件系统与 DNS。
sudo mount --bind /dev "$ROOT/dev"
sudo mount --bind /proc "$ROOT/proc"
sudo mount --bind /sys "$ROOT/sys"
sudo install -Dm644 /etc/resolv.conf "$ROOT/etc/resolv.conf"

# 安装 Rust/Tauri 测试所需构建依赖。
sudo chroot "$ROOT" /bin/bash -lc '
  set -euo pipefail
  apt-get update
  apt-get install -y \
    build-essential pkg-config curl ca-certificates git \
    libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
    patchelf libxslt1.1 libssl-dev
'
```

之后执行上文“使用已配置的 Ubuntu chroot”的测试命令。

> 以上 bootstrap 需要修改系统 mount 与安装软件包，通常应由 Codespace 平台管理员或拥有 sudo 权限的开发者执行。没有 root 权限时，请使用平台预置环境或依赖 CI。

## 运行前端测试

前端 Node/npm 工具链可在宿主环境直接使用，无需 chroot：

```bash
cd frontend
npm ci
npm test
npm run typecheck
```

如只修改文档，可跳过测试；修改前端代码后，建议完整执行以上三条命令。

## Lockfile 依赖来源检查结果

本仓库当前有两个 lockfile：

- `Cargo.lock`
- `frontend/package-lock.json`

已执行大小写不敏感检查：

```bash
grep -Rin --include='Cargo.lock' --include='package-lock.json' 'antgroup' .
```

结果：**没有匹配，lockfile 中不存在 `antgroup` 域名**。

当前 registry 来源为：

- `Cargo.lock`：`registry+https://github.com/rust-lang/crates.io-index`
- `frontend/package-lock.json`：`https://registry.npmjs.org/...`

后续如更换 registry 或更新依赖，可重复执行上述 `grep` 命令做快速检查。
