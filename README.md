# 轻阅 QINGYUE

> 本地优先、**完全离线**的 txt 阅读器。参考易笺的阅读形态，但把它的网络依赖、体积上限、无书签等限制全部去掉。
> 一套代码 → Web / PWA / macOS / Windows / Linux / Android / iOS / HarmonyOS。

```bash
git clone https://github.com/xingshanghe/x-book.git
cd x-book
pnpm install     # 网络受限可切 npm，见 docs/build.md
pnpm dev         # 浏览器开发： http://localhost:5173
```

---

## 一、这次完成了什么

| 能力 | 状态 | 说明 |
|---|---|---|
| 大书秒开 | ✅ | 导入时归一化为 UTF-8 并建「字节级块索引」，任意时刻只渲染视口 ±2~3 块 |
| 离线优先 | ✅ | 导入、书架、阅读、排版、书签、进度、搜索、字体，全部零网络请求 |
| 渐进增强 | ✅ | 同步只保留 `SyncAdapter` 接口 + `NoopAdapter`，默认单机模式；Worker 不可用时退化为主线程解析 |
| 多端通用 | ✅ | 响应式三档（360 / 768 / 1440），PWA 可安装，Tauri 壳覆盖桌面与移动，ArkTS 壳覆盖鸿蒙 |
| 自定服务降级 | ✅ | 服务端不可用/证书过期时状态机静默降为 `degraded`，无弹窗、无功能缺失 |

**性能实测（本次构建）**：JS 产物 gzip 93 KB（预算 180 KB），PWA 预缓存 19 条 639 KB，Worker 单独分包 14.9 KB。

---

## 二、快速开始

```bash
pnpm dev                 # 开发
pnpm build               # 产出 dist/（可直接静态托管或离线运行）
pnpm test                # 单测（解析器 / 章节 / 编码 / 清洗 / 端到端流水线，19 例）
pnpm typecheck           # TS 严格模式全量检查

pnpm tauri dev           # 桌面开发模式（macOS / Linux / Windows）
pnpm tauri build         # 桌面安装包（当前平台）
pnpm tauri:android       # Android APK + AAB
pnpm tauri:ios           # iOS
pnpm sync:harmony        # 同步 dist 到鸿蒙工程，再用 DevEco 打包
```

Windows / Linux / Android / iOS 的正式包由 GitHub Actions 产出：
推送 tag 即自动构建五端并上传到 Release。

```bash
git tag v1.0.0 && git push origin v1.0.0
```

---

## 三、技术选型

| 层 | 选型 | 为什么 |
|---|---|---|
| 构建 | Vite | 冷启动快、原生 ESM、PWA 插件成熟 |
| 框架 | React + TypeScript | 阅读器需要细粒度控制，React 足够且团队熟悉 |
| 路由 | wouter | 三个页面用不上 React Router |
| 状态 | Zustand | 短生命周期的「设置 + 阅读会话」 |
| 样式 | 原生 CSS + 变量 + CSS Modules | 设计令牌即变量，阅读器要像素级控制 |
| 组件库 | **无**（自建 `src/ui`） | 见方案文档 2.2：覆写成本接近重写，且浮层行为需要定制 |
| 存储 | IndexedDB + idb | 结构化数据 + Blob 同库，1.2 KB |
| 解析 | 自研字节级扫描器 | 产品技术核心，见下节 |
| PWA | vite-plugin-pwa | 预缓存外壳，不配置任何 runtimeCaching 外部域名 |
| 桌面/移动壳 | Tauri 2 | 一套 Rust 壳覆盖 5 端，无自带服务器依赖 |
| 鸿蒙壳 | ArkTS + ArkWeb | 复用同一份 dist，见 `harmony/` |

详细的目录结构与分层规则见 [`docs/tech-design.md`](./docs/tech-design.md)，品牌与界面规范见 [`docs/brand-vi.html`](./docs/brand-vi.html)。

---

## 四、为什么能「秒开」

一条关键不变量：**导入时把文本归一化为 UTF-8，之后所有偏移都是 UTF-8 字节偏移。**

- UTF-8 里多字节序列的后续字节都 ≥ `0x80`，而 `\n` 是 `0x0A`，
  因此在**字节层**扫描换行永远不会切坏字符——不需要解码就能建索引，速度接近内存带宽；
- 任意块都能 `blob.slice(a, b)` 后独立解码，无需从头解码；
- 块大小 16 KB（≈5,300 汉字 / ≈170 行），100 MB 文件约 6,400 块，索引本身只有 ~77 KB；
- 虚拟渲染：只为视口附近的块生成 DOM，并用 `ResizeObserver` 把估算高度逐步收敛为实测高度。

编码处理顺序：BOM → 严格 UTF-8 → GB18030/Big5 打分 → UTF-16 NUL 分布 → 兜底；
非 UTF-8 在导入时转码一次（流式，峰值≈一份文件），之后永远走 UTF-8 快路径。
阅读器与设置页都可**手动改编码并重建索引**，不必重新选文件。

---

## 五、离线与渐进增强

**离线**不需要任何开关：没有网络分支，就没有降级分支。

- Service Worker 只预缓存本地外壳与静态资源，**不配任何跨域 runtimeCaching**；
- 首次导入即调用 `navigator.storage.persist()`，避免 Safari 7 天回收；
- 断网 + 清空 HTTP 缓存 + 卸载 SW 后重开，全部功能仍然可用。

**渐进增强**体现在三处，均在配置缺失/环境不支持时自动退化：

1. **同步**：`src/sync/` 提供 `SyncAdapter` 接口 + `NoopAdapter`，默认不发任何网络请求；
2. **Worker**：某些 WebView 禁止 Worker，自动退化为主线程解析（功能一致，仅慢一些）；
3. **自增能力**：PWA 安装、`showOpenFilePicker`、`exit Fullscreen` 等全部走能力探测。

---

## 六、多端打包

| 平台 | 产物 | 本地命令 | 产出方式 |
|---|---|---|---|
| Web / PWA | 静态站点 | `pnpm build` | 任意静态托管 |
| macOS | `.app` / `.dmg` | `pnpm tauri build` | 本机或 CI（macOS runner） |
| Windows | `.exe` (NSIS) / `.msi` | — | CI（windows-latest） |
| Linux | `.deb` / `.AppImage` | — | CI（ubuntu-22.04） |
| Android | `.apk` / `.aab` | `pnpm tauri android build` | CI（需 JDK17 + NDK26） |
| iOS | `.ipa` / `.app` | `pnpm tauri ios build` | CI（macOS runner + 签名密钥） |
| HarmonyOS | `.hap` / `.app` | `pnpm sync:harmony` 后用 DevEco 打包 | DevEco Studio 本地构建 |

签名相关的 Secrets 未配置时，CI 会自动退化为可安装的调试包，流程不会中断。
逐步流程见 [`docs/build.md`](./docs/build.md)。

---

## 七、快捷键

| 键 | 作用 |
|---|---|
| `←` / `PageUp` | 上一页 |
| `→` / `PageDown` / `Space` | 下一页 |
| `T` | 打开/关闭目录 |
| `Esc` | 关闭浮层 |
| `,` | 打开设置 |

触摸：翻页模式下左右滑动翻页；点按屏幕左/右侧翻页，中间区域切换顶底栏。

---

## 八、已知边界

- 单次导入的理论上限约为 4 GB（块索引用 `Uint32Array`）；
- 自备字体最多 12 个；
- 未实现类：朗读（TTS）、多端同步的服务端实现、EPUB/PDF 支持。

---

## 九、致谢

视觉语言与部分功能设计参考了易笺（SimpleTextReader, @henryxrl, GPL-3.0）的公开资料；
本项目为独立实现，配色与 UI 结构已重做，不复用其代码。
