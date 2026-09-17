# frontend-build Specification

## Purpose

约束前端构建与 CI 的依赖交付：npm lockfile 必须固定指向公共 npm registry，避免本地内网镜像 URL 进入仓库并导致公开 CI 安装失败或行为不一致。

## Requirements

### Requirement: lockfile 统一使用公共 npm registry

仓库在提交任何改动前，须（SHALL）确保 `frontend/package-lock.json` 中所有 `resolved` 字段都指向 `https://registry.npmjs.org/...`，并确保其中不包含内网或本地镜像 registry URL。生成、更新或重新解析该 lockfile 时，若本地环境配置了非公共 npm registry 的 `npm_config_registry`/`NPM_CONFIG_REGISTRY`，提交者仍须（SHALL）使用 `https://registry.npmjs.org/` 生成或规范化最终 lockfile。

#### Scenario: 本地使用内网镜像生成 lockfile

- **WHEN** 开发者在 `NPM_CONFIG_REGISTRY=https://registry.antgroup-inc.cn` 环境中更新 `frontend/package-lock.json`
- **THEN** 提交前该 lockfile 中所有 `resolved` URL 均为 `https://registry.npmjs.org/...`，不存在 `registry.antgroup-inc.cn` 或其他镜像 URL

#### Scenario: 提交前检查 lockfile

- **WHEN** 变更包含 `frontend/package-lock.json`
- **THEN** 提交前检查所有 `resolved` 字段，并在发现任何非 `https://registry.npmjs.org/` URL 时拒绝提交或先规范化该 lockfile

#### Scenario: CI 依据公共 lockfile 安装依赖

- **WHEN** CI 在干净环境中基于提交的 lockfile 运行 `npm ci`
- **THEN** 依赖解析 URL 来自 `https://registry.npmjs.org/`，且开发依赖（如 `vue-tsc`）与对应 bin link 正确安装
