# 轻阅 · 多端打包与发布手册

> 一句话原则：**先有 Web，再有壳。** dist/ 本身就是一个可安装的 PWA，
> 所有原生壳只是把它装进不同系统的窗口里，因此任何一端都可以单独放弃而不影响其他端。

> 所有命令都已写进仓库根目录的 `Makefile`，先跑 `make help` 看全貌。
> 本文是「为什么」，Makefile 是「怎么跑」。

---

## 0. 前置

| 平台 | 依赖 |
|---|---|
| Web / PWA | Node 22+、pnpm |
| macOS | Xcode 命令行工具（已含）；签名需要 Apple 开发者证书 |
| Windows | 有 GitHub Actions 即可，无需本机 |
| Linux | 有 GitHub Actions 即可；本地需要 webkit2gtk-4.1、librsvg2、patchelf |
| Android | JDK 17 + Android SDK（platform 34、NDK 26.3、build-tools 34） |
| iOS | macOS + Xcode；真机/上架需要开发者证书与描述文件 |
| HarmonyOS | DevEco Studio（仅 macOS/Windows 版）+ HarmonyOS SDK |

国内网络提示：npm 请走镜像（仓库内 `.npmrc` 已配置）；Cargo 可配置
`~/.cargo/config.toml`：

```toml
[source.crates-io]
replace-with = 'rsproxy'
[source.rsproxy]
registry = "https://rsproxy.cn/crates.io-index"
```

---

## 1. Web / PWA

```bash
pnpm build        # → dist/
pnpm preview      # 本地验证（含 SW）
```

离线验收：Chrome DevTools → Network → 勾 Offline → 刷新，导入、阅读、书签、进度应全部可用。

---

## 2. macOS

```bash
pnpm tauri build                      # 当前平台：.app + .dmg
pnpm tauri build --bundles app        # 只要 .app
```

产物：`src-tauri/target/release/bundle/dmg/*.dmg`、`.../macos/轻阅.app`

公证（可选）：

```bash
xcrun notarytool submit *.dmg --apple-id "<ID>" --team-id "<TEAM>" --password "<APP专用密码>" --wait
xcrun stapler staple *.dmg
```

---

## 3. Windows / Linux（GitHub Actions）

推送 tag 即可：

```bash
git tag v1.0.0 && git push origin v1.0.0
```

`.github/workflows/release.yml` 会在三个 runner 上并行构建并上传到同一个 Release：

- Windows：`轻阅_1.0.0_x64-setup.exe`(NSIS) + `.msi`
- Linux：`qingyue_1.0.0_amd64.deb` + `qingyue_1.0.0_amd64.AppImage`
- macOS：`轻阅_1.0.0_universal.dmg`（同时含 arm64 与 x86_64）

也可以在 Actions 页面手动触发，并选择是否上传到 Release。

---

## 4. Android

```bash
pnpm exec tauri android init      # 首次：生成 src-tauri/gen/android
pnpm exec tauri android dev       # 真机/模拟器调试
pnpm tauri:android                # APK + AAB
```

签名：把 keystore 配置写进 `src-tauri/gen/android/keystore.properties`，或在 CI 里配置
`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`
四个 Secrets；未配置时 CI 自动退化为**调试签名 APK**（可直接安装自测）。

产物路径：`src-tauri/gen/android/app/build/outputs/apk/**/*.apk`。

---

## 5. iOS

```bash
pnpm exec tauri ios init          # 首次：生成 Xcode 工程
pnpm exec tauri ios dev
pnpm tauri:ios                    # 导出 ipa
```

签名需要 `APPLE_ID` / `APPLE_PASSWORD`（App 专用密码）/ `APPLE_TEAM_ID` 三个 Secrets。
未配置时 CI 会输出**未签名 .app**并在日志中告警，流程不中断。

---

## 6. HarmonyOS（NEXT / OpenHarmony）

```bash
pnpm build
pnpm sync:harmony                 # 同步 dist 到 harmony/.../rawfile/qy
```

然后用 **DevEco Studio** 打开 `harmony/`：

1. File > Open → 选择 `harmony/` 目录；
2. 等待 `oh_modules` 自动安装（或 `hvigorw sync`）；
3. 连接真机 / 启动模拟器；
4. Build > Build Hap(s)/APP(s) > Build Hap(s)，得到 `entry-default-signed.hap`；
5. 需要上架时 Build APP(s) 得到 `.app`。

实现要点（已内置在 `harmony/entry/src/main/ets/`）：

- `Load.ets` 首次启动把 `rawfile/qy/**` 复制到应用沙箱 `files/qy`，
  再用 `file://` 加载，保证 IndexedDB / localStorage 的 origin 稳定；
- 版本标记 `.version` 与 `string.json` 的 `web_version` 对比，避免每次启动全量复制；
- `module.json5` **不申请任何权限**（尤其不申请 INTERNET），从机制上保证离线；
- `onBackPress` 优先回退 Web 内部历史，行为与其他端一致；
- Web 端已内置 Worker 降级：ArkWeb 若不允许 Worker，自动改用主线程解析。

注意事项：

- dist 必须保持相对路径（Vite `base: './'`，已配置），否则 `file://` 下资源 404；
- 鸿蒙的 Web 组件对 `input[type=file]` 的支持依赖系统版本，导入建议在设置页走"选择文件"入口；
- 上架应用市场的软件著作权与隐私声明：本应用不采集任何数据，隐私声明可写"仅本地存储"。

---

## 7. 发布到 GitHub Release

不想手工敲多条命令时：

```bash
make publish V=1.0.0     # = git push main + 打/推 tag + gh release create + 上传 release/*
```

脚本在 `scripts/publish-release.sh`，先 `gh auth login` 一次即可。

Actions 会自动：

1. 构建 Web zip + 桌面三端 + Android + iOS；
2. desktop 作业创建 Release `轻阅 v1.0.0` 并上传 dmg / app / exe / msi / deb / AppImage；
3. `android` / `ios` / `web` 作业（依赖 desktop）追加上传 apk / aab / ipa / web zip。

> 本项目未引入 `tauri-plugin-updater`，因此 `includeUpdaterJson` 关闭、不产 `latest.json`——
> 增量更新属于「可选增强」，等真正需要时再打开，避免给离线优先的产品引入额外的网络面。

**HarmonyOS** 无法在 GitHub runner 上编译（无 HarmonyOS SDK），本地构建后手动挂上去：

```bash
pnpm build && pnpm sync:harmony
# DevEco Studio：Build > Build Hap(s)/APP(s) > Build APP(s)
gh release upload v1.0.0 harmony/entry/build/default/outputs/default/*.app
```
