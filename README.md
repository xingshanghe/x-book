<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
  <img src="docs/assets/logo.svg" alt="轻阅 QINGYUE" width="340">
</picture>

**本地优先、完全离线的 txt 阅读器。**

翻开就读，读到哪里算哪里 —— 大书秒开 · 离线优先 · 一套代码跑八端。

[![Release](https://img.shields.io/github/v/release/xingshanghe/x-book?label=release&color=B44326)](https://github.com/xingshanghe/x-book/releases/latest)
[![Build & Release](https://github.com/xingshanghe/x-book/actions/workflows/release.yml/badge.svg)](https://github.com/xingshanghe/x-book/actions/workflows/release.yml)
[![Platforms](https://img.shields.io/badge/platform-Web%20%7C%20macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20Android%20%7C%20iOS%20%7C%20HarmonyOS-3E5C97)](https://github.com/xingshanghe/x-book/releases)
[![Tests](https://img.shields.io/badge/tests-19%20passing-3E7A4E)](https://github.com/xingshanghe/x-book/tree/main/tests)
[![License](https://img.shields.io/badge/license-MIT-746851)](./LICENSE)

</div>

---

轻阅参考了易笺（SimpleTextReader）的阅读形态，但把它的网络依赖、体积上限、无书签等限制全部去掉：
导入、书架、阅读、排版、书签、进度、搜索、字体，**全部零网络请求**，断网与首次安装没有任何区别。

## 目录

- [特性一览](#特性一览)
- [下载安装](#下载安装)
- [快速开始](#快速开始)
- [构建与发布](#构建与发布)
- [技术架构](#技术架构)
- [为什么能「秒开」](#为什么能秒开)
- [离线与渐进增强](#离线与渐进增强)
- [快捷键与手势](#快捷键与手势)
- [设计规范（VI / UI）](#设计规范vi--ui)
- [文档索引](#文档索引)
- [已知边界与路线](#已知边界与路线)
- [致谢](#致谢)
- [许可证](#许可证)

## 特性一览

| 能力 | 说明 |
|---|---|
| 大书秒开 | 导入时归一化为 UTF-8 并建「字节级块索引」，任意时刻只渲染视口 ±2~3 块；100 MB 约 6,400 块，索引仅 ~77 KB |
| 完全离线 | 无任何网络分支，Service Worker 只预缓存本地外壳；`navigator.storage.persist()` 防止 Safari 回收 |
| 编码无忧 | BOM → 严格 UTF-8 → GB18030 / Big5 打分 → UTF-16 NUL 分布 → 兜底，导入时流式转码一次 |
| 广告清洗 | 站点类规则允许尾随正文、短语类保守守卫，不误删正文 |
| 阅读体验 | 扉页藏书章、左侧章节栏、底部页码条、统一封面 + 朱红丝带、书签与摘录 |
| 渐进增强 | 同步只留 `SyncAdapter` 接口（默认单机）；Worker 不可用退化主线程；能力探测走 feature detect |
| 多端通用 | 响应式三档（360 / 768 / 1440），PWA 可安装；Tauri 2 覆盖桌面与移动，ArkTS 覆盖鸿蒙 |

**体积预算**：JS 产物 gzip 约 93 KB（预算 180 KB），PWA 预缓存 19 条 639 KB，Worker 单独分包 14.9 KB。

## 下载安装

到 [Releases](https://github.com/xingshanghe/x-book/releases/latest) 下载对应平台的安装包：

| 平台 | 产物 | 说明 |
|---|---|---|
| Web / PWA | `qingyue-web-<tag>.zip` | 解压后任意静态服务器打开，离线运行 |
| macOS | `qingyue-<tag>-macos-universal.dmg` | Intel / Apple Silicon 通用 |
| Windows | `qingyue-<tag>-windows-x86_64-setup.exe` / `.msi` | NSIS 安装器 |
| Linux | `qingyue-<tag>-linux-x86_64.deb` / `.AppImage` | AppImage 免安装 |
| Android | `qingyue-<tag>-android-*.apk` | 未配置签名时为可安装的 debug 包 |
| iOS | `qingyue-<tag>-ios-unsigned.zip` | 未签名 `.app`，需自签或 TestFlight |
| HarmonyOS | `qingyue-<tag>-harmony-unsigned.app` | 需本地 DevEco Studio 产出 |

推送 `v*` tag 后 GitHub Actions 会自动构建以上全部产物并挂到 Release。

## 快速开始

```bash
git clone https://github.com/xingshanghe/x-book.git
cd x-book
pnpm install        # 网络受限可切 npm，见 docs/build.md
make dev            # 浏览器开发： http://localhost:5173
```

日常开发常用命令（`make help` 查看全部）：

```bash
make setup          # 安装依赖
make check          # 类型检查 + 单测
make build          # 产出 dist/（可直接静态托管或离线运行）
```

不用 make 也可以直接跑底层命令：

```bash
pnpm dev            # 开发
pnpm test           # 单测（解析器 / 章节 / 编码 / 清洗 / 端到端流水线）
pnpm typecheck      # TS 严格模式全量检查
pnpm tauri dev      # 桌面开发模式（macOS / Linux / Windows）
```

## 构建与发布

五端打包一条命令（产物统一输出到 `release/`）：

```bash
make pack-web          # Web / PWA zip
make pack-macos        # macOS：.app + .zip + .dmg（当前架构）
make pack-windows      # Windows：exe + msi（本机需 MSVC 工具链）
make pack-linux        # Linux：deb + AppImage
make pack-android      # Android：apk + aab
make pack-ios          # iOS
make sync-harmony      # 鸿蒙：同步 dist，再用 DevEco Studio 打包
make publish V=1.0.0   # 推代码 + 打 tag + 建 Release + 上传本地产物
```

不想在本机折腾工具链时，推送 tag 交给 GitHub Actions 跑五端：

```bash
git tag v1.0.0 && git push origin v1.0.0     # 或 make release-tag V=1.0.0
```

> macOS 上若终端没有 `/Volumes` 写权限（常见于受限终端/沙箱），`make pack-macos` 会跳过
> dmg、只出 `.app` 压缩包 —— 解压后拖进「应用程序」即可，功能完全一致；标准 dmg 由 CI 产出。
> 签名相关的 Secrets 未配置时，CI 自动退化为可安装的调试包，流程不会中断。

## 技术架构

| 层 | 选型 | 为什么 |
|---|---|---|
| 构建 | Vite | 冷启动快、原生 ESM、PWA 插件成熟 |
| 框架 | React 19 + TypeScript (strict) | 阅读器需要细粒度控制 |
| 路由 | wouter | 三个页面用不上 React Router |
| 状态 | Zustand | 短生命周期的「设置 + 阅读会话」 |
| 样式 | 原生 CSS 变量 + 自建 `src/ui` 组件 | 设计令牌即变量；组件库覆写成本接近重写 |
| 存储 | IndexedDB + idb | 结构化数据 + Blob 同库，1.2 KB |
| 解析 | 自研字节级扫描器 | 产品技术核心，见下节 |
| PWA | vite-plugin-pwa | 只预缓存外壳，不配任何跨域 runtimeCaching |
| 桌面/移动壳 | Tauri 2 | 一套 Rust 壳覆盖 5 端 |
| 鸿蒙壳 | ArkTS + ArkWeb | 复用同一份 dist，见 `harmony/` |

```
x-book/
├── src/
│   ├── core/           # 解析内核：detect / normalize / scanner / chapters / cleaner / indexer
│   ├── reader/         # blockReader（LRU 分块解码）/ progress / titlepage
│   ├── features/       # 页面：shelf（书架）/ reader（阅读器）/ settings（设置）
│   ├── storage/        # IndexedDB 仓库层（book / progress / bookmark / search / settings）
│   ├── sync/           # SyncAdapter 接口 + NoopAdapter + 降级状态机
│   ├── ui/             # 自建组件库（12 个）+ 设计令牌
│   └── app/            # 路由 / bootstrap / 全局 store
├── src-tauri/          # Tauri 2 壳（桌面 + 移动）
├── harmony/            # ArkTS + ArkWeb 壳（rawfile 外壳）
├── tests/unit/         # 解析器 / 流水线 / 清洗规则单测
├── docs/               # 品牌规范 / 技术设计 / 构建文档 / 设计资产
└── scripts/            # 构建辅助脚本（鸿蒙资产同步、发布）
```

## 为什么能「秒开」

一条关键不变量：**导入时把文本归一化为 UTF-8，之后所有偏移都是 UTF-8 字节偏移。**

- UTF-8 里多字节序列的后续字节都 ≥ `0x80`，而 `\n` 是 `0x0A`，
  因此在**字节层**扫描换行永远不会切坏字符 —— 不需要解码就能建索引，速度接近内存带宽；
- 任意块都能 `blob.slice(a, b)` 后独立解码，无需从头解码；
- 块大小 16 KB（≈5,300 汉字 / ≈170 行），100 MB 文件约 6,400 块，索引本身只有 ~77 KB；
- 虚拟渲染：只为视口附近的块生成 DOM，并用 `ResizeObserver` 把估算高度逐步收敛为实测高度。

编码处理顺序：BOM → 严格 UTF-8 → GB18030/Big5 打分 → UTF-16 NUL 分布 → 兜底；
非 UTF-8 在导入时转码一次（流式，峰值≈一份文件），之后永远走 UTF-8 快路径。
阅读器与设置页都可**手动改编码并重建索引**，不必重新选文件。

## 离线与渐进增强

**离线**不需要任何开关：没有网络分支，就没有降级分支。

- Service Worker 只预缓存本地外壳与静态资源，**不配任何跨域 runtimeCaching**；
- 首次导入即调用 `navigator.storage.persist()`，避免 Safari 7 天回收；
- 断网 + 清空 HTTP 缓存 + 卸载 SW 后重开，全部功能仍然可用。

**渐进增强**体现在三处，均在配置缺失/环境不支持时自动退化：

1. **同步**：`src/sync/` 提供 `SyncAdapter` 接口 + `NoopAdapter`，默认不发任何网络请求；
2. **Worker**：某些 WebView 禁止 Worker，自动退化为主线程解析（功能一致，仅慢一些）；
3. **平台能力**：PWA 安装、`showOpenFilePicker`、退出全屏等全部走能力探测。

## 快捷键与手势

| 键 / 手势 | 作用 |
|---|---|
| `←` / `PageUp` | 上一页 |
| `→` / `PageDown` / `Space` | 下一页 |
| `T` | 打开/关闭目录 |
| `Esc` | 关闭浮层 |
| `,` | 打开设置 |
| 左右滑动 / 点按左右侧 | 触屏翻页；点按中间区域切换顶底栏 |

## 设计规范（VI / UI）

完整的品牌与界面规范在 [`docs/brand-vi.html`](./docs/brand-vi.html)（单文件，浏览器直接打开），覆盖：

- 命名与定位：名字从「轻书」改为「轻阅」—— 书是物，阅是动作；
- 色彩：米黄纸底 / 靛蓝 / 朱砂三色系统，含夜间反白对照表（11 个设计令牌）；
- 字体与排版：楷体优先的标题体系、9 项排版默认值、三端断点；
- 标志：符号为「一页纸的折角」，折角填朱砂，含 Primary / Reverse / 构造网格与最小尺寸；
- 组件与页面：书架、扉页、阅读器、设置共 6 张页面稿，全部内联 SVG，可直接对照实现。

README 使用的标志资产（`docs/assets/`）即从该规范导出：

| 文件 | 用途 |
|---|---|
| `logo.svg` / `logo-dark.svg` | 横向主标（浅色 / 深色反白），README 顶部按系统主题自动切换 |
| `logo-icon.svg` / `logo-icon.png` | 纯符号方形图标 |
| `social-preview.png` | 仓库社交预览图（1280×640，可上传到仓库设置 → Social preview） |

## 文档索引

| 文档 | 内容 |
|---|---|
| [`docs/brand-vi.html`](./docs/brand-vi.html) | 品牌 VI 与 UI 设计规范（单文件，浏览器打开） |
| [`docs/tech-design.md`](./docs/tech-design.md) | 技术方案：分层规则、目录结构、解析内核设计 |
| [`docs/build.md`](./docs/build.md) | 构建细节：依赖安装、镜像配置、五端打包步骤 |
| [.github/workflows/release.yml](./.github/workflows/release.yml) | CI/CD：推 tag 自动构建八端产物并发布 Release |

## 已知边界与路线

**当前边界**

- 单次导入理论上限约 4 GB（块索引用 `Uint32Array`）；
- 自备字体最多 12 个；
- 未实现：朗读（TTS）、多端同步的服务端实现、EPUB / PDF 支持。

**路线**

- [ ] 摘录导出（Markdown / 纯文本）
- [ ] 阅读统计与热力图
- [ ] EPUB 支持（复用块索引思路）
- [ ] 可选的自建同步服务端（`SyncAdapter` 已就绪）

## 致谢

视觉语言与部分功能设计参考了[易笺（SimpleTextReader）](https://github.com/henryxrl/SimpleTextReader)（@henryxrl, GPL-3.0）的公开资料；
本项目为独立实现，配色与 UI 结构已重做，不复用其代码。

## 许可证

[MIT](./LICENSE) © 2026 CRAFTDEMAND
