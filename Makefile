# 轻阅 QINGYUE · 多端构建 Makefile
#
#   原则：一条命令一件事，先 make help 看全貌。
#   所有需要本机工具链的命令都在这里列全环境变量，复制即跑。
#
# 常用：
#   make setup          # 装依赖
#   make dev            # 浏览器开发
#   make check          # 类型检查 + 单测
#   make pack-web       # Web / PWA 产物 dist/ + zip
#   make pack-macos     # macOS .app + .zip + .dmg（当前机器架构）
#   make pack-windows   # Windows 安装包（需本机 Rust MSVC 工具链，或改用 CI）
#   make pack-android   # Android APK / AAB
#   make pack-ios       # iOS
#   make sync-harmony   # 同步 dist 到鸿蒙工程（随后用 DevEco Studio 打包）

SHELL := /bin/bash
.DEFAULT_GOAL := help

# ── 基本参数 ────────────────────────────────────────────────
VERSION      ?= $(shell node -p "require('./package.json').version" 2>/dev/null || echo 1.0.0)
PNPM         ?= pnpm
NODE_BIN     := ./node_modules/.bin
RELEASE_DIR  := release

# Rust 相关：默认把 cargo 的家与产物目录收敛到仓库内，方便清理
CARGO_HOME   ?= $(CURDIR)/.cargo-home
CARGO_TARGET ?= $(CURDIR)/.cargo-target
export CARGO_HOME
export CARGO_TARGET

# macOS 架构：本机 Apple Silicon 产物 aarch64；Intel 传 ARCH=x86_64
ARCH         ?= $(shell uname -m)
ifeq ($(ARCH), arm64)
  APPLE_TARGET := aarch64-apple-darwin
  ARCH_LABEL   := aarch64
else
  APPLE_TARGET := x86_64-apple-darwin
  ARCH_LABEL   := $(ARCH)
endif

APP_NAME     := 轻阅
BUNDLE_MACOS := $(CARGO_TARGET)/release/bundle/macos

.PHONY: help setup check typecheck test lint dev build preview clean pack-web \
        rust-init pack-macos pack-macos-universal pack-windows pack-linux \
        pack-android pack-ios sync-harmony release-tag release-upload apk-perms

help: ## 显示帮助
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) \
		| sed 's/:.*## /\t/' \
		| awk -F'\t' '{ printf "  \033[36m%-24s\033[0m %s\n", $$1, $$2 }'

# ── 环境与校验 ─────────────────────────────────────────────
setup: ## 安装前端依赖
	$(PNPM) install --no-frozen-lockfile

check: typecheck test ## 类型检查 + 单测

typecheck: ## TypeScript 严格模式全量检查
	$(NODE_BIN)/tsc --noEmit

test: ## 运行单元测试
	$(NODE_BIN)/vitest run

lint: ## Biome 静态检查
	$(NODE_BIN)/biome check src tests scripts

dev: ## 浏览器开发模式
	$(PNPM) dev

build: ## 产出 dist/
	$(PNPM) build

preview: build ## 本地预览（含 Service Worker）
	$(PNPM) preview

clean: ## 清理构建产物（保留 node_modules）
	rm -rf dist $(RELEASE_DIR) .dmg-staging $(CARGO_TARGET)
	@echo "已清理；node_modules 保留，如需重置请 make distclean"

distclean: clean ## 连依赖一起清
	rm -rf node_modules
	@echo "如需彻底清 Rust 缓存：rm -rf $(CARGO_HOME)"

# ── Web / PWA ─────────────────────────────────────────────
pack-web: build ## 打出可直接托管的 zip
	@mkdir -p $(RELEASE_DIR)
	cd dist && zip -qr "../$(RELEASE_DIR)/qingyue-web-$(VERSION).zip" .
	@echo "✓ $(RELEASE_DIR)/qingyue-web-$(VERSION).zip"

# ── 桌面 / 移动：共用一步 Rust 初始化 ───────────────────────
rust-init: ## 拉取 Rust 依赖（国内建议先配 ~/.cargo/config.toml 镜像）
	cargo fetch --manifest-path src-tauri/Cargo.toml

# ── macOS ─────────────────────────────────────────────────
# 说明：不用 tauri build --bundles dmg —— 它内部要先 mount 到 /Volumes，
#       普通用户会撞上「hdiutil: create failed - 操作不被允许」。
#       这里改成先出 .app，再用 hdiutil -srcfolder 直接生成镜像。
pack-macos: rust-init pack-macos-app pack-macos-dmg ## macOS 全套：.app + .zip + .dmg

pack-macos-app: ## 只构建 .app（内含 Rust release 编译）
	$(PNPM) tauri build --bundles app --target $(APPLE_TARGET)

pack-macos-dmg: ## 由已产出的 .app 生成 .zip，并尽量生成 .dmg
	@test -d "$(BUNDLE_MACOS)" || { echo "找不到 $(BUNDLE_MACOS)，请先 make pack-macos-app"; exit 1; }
	@mkdir -p $(RELEASE_DIR)
	ditto -c -k --sequesterRsrc --keepParent "$(BUNDLE_MACOS)/$(APP_NAME).app" \
		"$(RELEASE_DIR)/qingyue-$(VERSION)-macos-$(ARCH_LABEL).zip"
	@echo "✓ $(RELEASE_DIR)/qingyue-$(VERSION)-macos-$(ARCH_LABEL).zip"
	@rm -rf .dmg-staging && mkdir -p .dmg-staging
	cp -R "$(BUNDLE_MACOS)/$(APP_NAME).app" .dmg-staging/
	ln -sfn /Applications .dmg-staging/Applications
	@if touch /Volumes/.qingyue_probe 2>/dev/null; then \
		rm -f /Volumes/.qingyue_probe; \
		hdiutil create -volname "$(APP_NAME)" -srcfolder "$(CURDIR)/.dmg-staging" \
			-ov -format UDZO "$(CURDIR)/$(RELEASE_DIR)/qingyue-$(VERSION)-macos-$(ARCH_LABEL).dmg" \
			&& echo "✓ $(RELEASE_DIR)/qingyue-$(VERSION)-macos-$(ARCH_LABEL).dmg" \
			|| echo "⚠ dmg 生成失败，已保留 .app 压缩包"; \
	else \
		echo "⚠ 当前终端没有 /Volumes 写权限，跳过 dmg"; \
		echo "  macOS 上把 .app 解压后拖进 Applications 即为安装，功能完全一致；"; \
		echo "  想要标准 dmg：给终端「完全磁盘访问权限」后重跑，或 make release-tag 让 CI 出。"; \
	fi
	@rm -rf .dmg-staging

# 通用包（Intel + Apple Silicon）：需要装两个 target
pack-macos-universal: ## macOS 通用二进制 dmg（需 rustup target add 两个目标）
	rustup target add aarch64-apple-darwin x86_64-apple-darwin
	$(PNPM) tauri build --bundles app --target universal-apple-darwin
	@$(MAKE) pack-macos-dmg ARCH_LABEL=universal

# ── Windows ───────────────────────────────────────────────
# 本机跨平台编译 Windows 需要 MSVC 工具链（Visual Studio Build Tools）。
# 没有的话推荐直接走 GitHub Actions：make release-tag
pack-windows: rust-init ## 本机构建 Windows exe + msi
	rustup target add x86_64-pc-windows-msvc
	$(PNPM) tauri build --target x86_64-pc-windows-msvc --bundles nsis,msi
	@mkdir -p $(RELEASE_DIR)
	cp $(CARGO_TARGET)/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe $(RELEASE_DIR)/ 2>/dev/null || true
	cp $(CARGO_TARGET)/x86_64-pc-windows-msvc/release/bundle/msi/*.msi $(RELEASE_DIR)/ 2>/dev/null || true
	@echo "✓ Windows 产物已输出到 $(RELEASE_DIR)/"

# ── Linux ─────────────────────────────────────────────────
pack-linux: rust-init ## 本机构建 deb + AppImage（需 webkit2gtk 等系统库）
	$(PNPM) tauri build --bundles deb,appimage
	@mkdir -p $(RELEASE_DIR)
	cp $(CARGO_TARGET)/release/bundle/deb/*.deb $(RELEASE_DIR)/ 2>/dev/null || true
	cp $(CARGO_TARGET)/release/bundle/appimage/*.AppImage $(RELEASE_DIR)/ 2>/dev/null || true
	@echo "✓ Linux 产物已输出到 $(RELEASE_DIR)/"

# ── Android ───────────────────────────────────────────────
# 前置：JDK 17、ANDROID_HOME/ANDROID_SDK_ROOT 已设置、NDK 26.3、build-tools 34
pack-android: rust-init ## Android APK + AAB
	$(PNPM) exec tauri android init || true
	rustup target add armv7-linux-androideabi aarch64-linux-android i686-linux-android x86_64-linux-android
	$(PNPM) exec tauri android build --apk --aab --split-per-abi
	@mkdir -p $(RELEASE_DIR)
	find src-tauri/gen/android/app/build/outputs -name "*.apk" -o -name "*.aab" \
		-exec cp {} $(RELEASE_DIR)/ \;
	@echo "✓ Android 产物已输出到 $(RELEASE_DIR)/"

# ── iOS ───────────────────────────────────────────────────
pack-ios: rust-init ## iOS（需 Xcode；导出 ipa 需要 Apple 开发者账号）
	$(PNPM) exec tauri ios init || true
	rustup target add aarch64-apple-ios aarch64-apple-ios-sim
	$(PNPM) exec tauri ios build
	@mkdir -p $(RELEASE_DIR)
	find src-tauri/gen/apple/build -maxdepth 6 \( -name "*.ipa" -o -name "*.app" \) \
		-exec cp -R {} $(RELEASE_DIR)/ \; 2>/dev/null || true
	@echo "✓ iOS 产物已输出到 $(RELEASE_DIR)/"

# ── HarmonyOS ─────────────────────────────────────────────
sync-harmony: build ## 同步 dist 到鸿蒙工程的 rawfile
	@node scripts/build-harmony-assets.mjs
	@echo ""
	@echo "下一步（必须在本机 DevEco Studio 里做，GitHub runner 没有 HarmonyOS SDK）："
	@echo "  1) File > Open 选择 harmony/ 目录"
	@echo "  2) Build > Build Hap(s)/APP(s) > Build APP(s)"
	@echo "  3) gh release upload v$(VERSION) harmony/entry/build/default/outputs/default/*.app"

# ── 发布 ──────────────────────────────────────────────────
release-tag: ## 打 tag 并推送，触发 GitHub Actions 五端构建 + Release
	@test -n "$(V)" || { echo "用法：make release-tag V=1.0.0"; exit 1; }
	git tag -a "v$(V)" -m "轻阅 v$(V)"
	git push origin "v$(V)"
	@echo "已推送 v$(V)，Actions 正在构建：https://github.com/xingshanghe/x-book/actions"

release-upload: ## 把 release/ 里的产物追加上传到指定 Release
	@test -n "$(V)" || { echo "用法：make release-upload V=1.0.0"; exit 1; }
	@test -d "$(RELEASE_DIR)" || { echo "没有 $(RELEASE_DIR)/，请先 make pack-macos 等"; exit 1; }
	gh release upload "v$(V)" $(RELEASE_DIR)/* --clobber
