# Ant Codespace 本地测试环境说明

本文记录在本仓库的 Ant Codespace 环境里跑测试时的环境要求、已知兼容性问题，以及验证过的命令。目标读者是在 Ant Codespace 中执行本地回归测试的开发者。

## 结论

- **前端测试在宿主直接跑**，不需要额外环境。
- **`tngui-core` 单测在宿主直接跑**，不需要 chroot。
- **`tngui-app`（Tauri 外壳）在宿主跑不起来，要用 Ubuntu 22.04 chroot**：宿主是 Alibaba Cloud Linux 3，glib 只有 2.68.4，且只装了 `webkit2gtk-4.0`；Tauri 2 要求 glib ≥ 2.70 且 `webkit2gtk-4.1`。
- **chroot 里以 root 跑 cargo 会把 `target/` 写成 root 所有**，之后宿主再跑就报 `Permission denied`。用 `chroot --userspec` 以当前用户进 chroot 可以避免。
- **全量 Rust 测试单线程跑**：`tngui-core` 里有绑定 loopback 的用例，并行会偶发 `Address already in use (os error 98)`。
- **chroot 产物不能拿回宿主直接执行**：宿主 glibc 2.32 低于 chroot 的 2.35，测试二进制会在启动时报 `GLIBC_2.33 not found`。这也是不要混着跑的原因。

## 当前环境快照

以下版本取自本仓库已验证的 Ant Codespace 环境：

| 环境 | 系统 | glibc | glib | webkit2gtk | Rust |
|---|---|---:|---:|---|---|
| 宿主 | Alibaba Cloud Linux 3 | 2.32 | 2.68.4 | 4.0（2.52.5） | `rustc 1.99.1` |
| `/tmp/tngui-ubuntu` | Ubuntu 22.04.5 LTS | 2.35 | 2.72.1 | 4.1（2.50.4） | `rustc 1.99.1` |

## 跑 Rust 测试

### 宿主：只跑 `tngui-core`

```bash
source ~/.cargo/env
cargo test -p tngui-core -- --test-threads=1
```

约 1 秒，116 个用例。在宿主跑 `cargo test --workspace` 或 `cargo test -p tngui-app` 会在**构建阶段**就失败：

```text
Package 'webkit2gtk-4.1', required by 'virtual:world', not found
```

即宿主没有 `webkit2gtk-4.1`（只有 4.0），glib 也停在 2.68.4。

### chroot：全量 workspace

先确认 chroot 还在：

```bash
test -d /tmp/tngui-ubuntu && echo ok
```

然后执行：

```bash
sudo chroot --userspec="$(id -u):$(id -g)" /tmp/tngui-ubuntu /bin/bash -c '
  set -e
  export HOME=/home/admin
  export PATH=/home/admin/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
  # 把构建产物放到 chroot 的 /tmp（overlay，空间充足），避免撑满只有 20G 的 /home。
  export CARGO_TARGET_DIR=/tmp/cargo-target
  cd /home/admin/yangderui.ydr/yangderui.ydr/trust-inference/tngui
  cargo test --workspace -- --test-threads=1
'
```

当前该命令会运行：

- `tngui-app` 主 crate：19 个测试
- `tngui-core`：116 个测试
- `tngui-chat`：20 个测试
- `tngui-agent`：10 个测试
- 各 crate 的 doc-tests（当前均为 0 个）

> `tngui-agent` 的用例会改动 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量，必须单线程跑（命令里已带 `--test-threads=1`）。

几个容易踩的点：

- **用 `bash -c`，别用 `bash -l`**。chroot 里 uid 500 没有 passwd 记录，登录 shell 会去读 `/root/.bash_profile` 并报 `Permission denied`；`PATH` 上面已经显式设好，不需要 `-l`。
- **`chroot` 一定要带 `--userspec`**。否则 cargo 以 root 写进 bind mount 的仓库，`target/`、`gen/` 会变成 root 所有，宿主再跑就是 `failed to write ... Permission denied`。已经踩过就修一次：

  ```bash
  sudo find . -not -user "$(id -un)" -exec chown "$(id -un):$(id -gn)" {} +
  ```

- **磁盘很紧**：`/home` 只有 20G，而 `target/` 动辄 10G（`tngui-app` 的 staticlib 单个就 700M+）。用上面的 `CARGO_TARGET_DIR=/tmp/cargo-target` 把构建产物挪到 chroot 的 `/tmp`（overlay 文件系统，空间充足），既省 `/home` 又保留编译缓存。空间还是不够时，`cargo clean` 是安全的（本来就要重编一大批），但代价是下一次全量重编。
- **`target/` 不要由宿主和 chroot 混用**（宿主 glibc 2.32 编不出 Tauri 所需的产物）。挪到 `CARGO_TARGET_DIR` 后天然隔离；仍在仓库里共用 `target/` 时，混用过环境、遇到奇怪的链接或运行错误，就在 chroot 里 `cargo clean` 后重跑。
- 仓库根目录的 `cargo test` 只跑当前 package（`tngui-app`），全量回归用 `cargo test --workspace`。

### chroot 不存在时怎么重建

`/tmp` 会被清理，需要重建时按下面走。这几步都要 sudo 权限。

```bash
ROOT=/tmp/tngui-ubuntu

# 宿主需要 debootstrap、xz、zstd。
sudo dnf install -y debootstrap xz zstd
sudo mkdir -p "$ROOT"

# jammy 的 deb 用 zstd 压 control.tar，宿主自带的 dpkg-deb 1.20.9 读不了，
# 用 --extractor=ar 绕开。
sudo debootstrap --variant=minbase --extractor=ar jammy "$ROOT" http://mirrors.aliyun.com/ubuntu

# 共用同一个 /home/admin，复用仓库、~/.cargo 与 Cargo 缓存。
sudo mkdir -p "$ROOT/home/admin"
sudo mount --bind /home/admin "$ROOT/home/admin"

# 基础虚拟文件系统与 DNS。
sudo mkdir -p "$ROOT/dev/pts"
sudo mount --bind /dev "$ROOT/dev"
sudo mount -t devpts devpts "$ROOT/dev/pts"
sudo mount --bind /proc "$ROOT/proc"
sudo mount --bind /sys "$ROOT/sys"
sudo install -Dm644 /etc/resolv.conf "$ROOT/etc/resolv.conf"

# sources.list 必须有 jammy-updates 和 jammy-security：只写 jammy 的话
# libwebkit2gtk-4.1 会停在 2.36，装 Tauri 依赖时报
# javascriptcoregtk-4.1 >= 2.38 不满足。
sudo tee "$ROOT/etc/apt/sources.list" >/dev/null <<'EOF'
deb http://mirrors.aliyun.com/ubuntu jammy main universe multiverse restricted
deb http://mirrors.aliyun.com/ubuntu jammy-updates main universe multiverse restricted
deb http://mirrors.aliyun.com/ubuntu jammy-security main universe multiverse restricted
EOF

sudo chroot "$ROOT" /bin/bash -c '
  set -e
  apt-get update
  apt-get install -y \
    build-essential pkg-config curl ca-certificates git \
    libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
    patchelf libxslt1.1 libssl-dev
'
```

装完对一下版本：

```bash
sudo chroot "$ROOT" /bin/bash -c \
  'pkg-config --modversion webkit2gtk-4.1 javascriptcoregtk-4.1 glib-2.0'
```

本次重建后是 `2.50.4` / `2.50.4` / `2.72.1`，三个都满足 Tauri 2 的要求。之后执行上文 chroot 的测试命令即可。

> 以上 bootstrap 需要改系统 mount 与装软件包，通常应由 Codespace 平台管理员或拥有 sudo 权限的开发者执行。没有 root 权限时，请使用平台预置环境或依赖 CI。

## 跑前端测试

前端 Node/npm 工具链在宿主直接用，不需要 chroot：

```bash
cd frontend
npm ci
npm test
npm run typecheck
```

只改文档可以跳过；动过前端代码后建议三条都跑一遍（`npm test` 当前 20 个文件、207 个用例）。

## Lockfile 依赖来源检查结果

本仓库有两个 lockfile：`Cargo.lock` 与 `frontend/package-lock.json`。

大小写不敏感检查：

```bash
grep -Rin --include='Cargo.lock' --include='package-lock.json' 'antgroup' .
```

结果：**没有匹配**。

当前 registry 来源为：

- `Cargo.lock`：`registry+https://github.com/rust-lang/crates.io-index`
- `frontend/package-lock.json`：`https://registry.npmjs.org/...`

换 registry 或更新依赖后可重复执行上面这条 `grep` 做快速检查。
