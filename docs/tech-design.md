# 轻阅 QINGYUE · 技术选型与工程结构

> 配套文档：[`brand-vi.html`](./brand-vi.html)（品牌与界面规范 v1.0）
> 目标仓库：`https://github.com/xingshanghe/x-book`

---

## 1. 硬约束（先定验收线，再选技术）

| 编号 | 约束 | 验收方式 |
|---|---|---|
| C1 | 100 MB txt 首屏可读 | 冷启动导入后，首屏出现正文 < 1.5s（M1 MacBook / iPhone 12 基准） |
| C2 | 全程流式，不得整书入内存 | 阅读 100 MB 时 JS 堆峰值 < 120 MB |
| C3 | 核心功能零网络依赖 | 断网 + 清空 HTTP 缓存 + 卸载 Service Worker 后重开，导入/书架/阅读/排版/书签/进度全部可用 |
| C4 | 服务端不可用时静默降级 | 同步地址填一个不存在的域名 / 过期证书域名，产品无报错弹窗、无功能缺失 |
| C5 | 三档宽度适配 | 360px / 768px / 1440px 无横向滚动、无内容裁切 |
| C6 | 可安装为 PWA | Chrome/Edge/Safari 均可「添加到主屏幕」并离线启动 |

---

## 2. 技术选型

### 2.1 结论表

| 层 | 选型 | 版本 | 理由 |
|---|---|---|---|
| 构建 | **Vite** | 7.x | 冷启动快、原生 ESM、PWA 插件成熟 |
| 框架 | **React + TypeScript** | 19 / 5.9 | 生态与团队熟悉度；阅读器需要细粒度控制，React 足够 |
| 路由 | **wouter** | 3.x | 只有 3 个页面，1.5 KB，不上 React Router |
| 状态 | **Zustand** | 5.x | 无 Provider 嵌套，适合「设置 + 阅读会话」两类短生命周期状态 |
| 样式 | **原生 CSS + CSS 变量 + CSS Modules** | — | 设计令牌即 CSS 变量；阅读器需要像素级控制 |
| 组件库 | **无**（自建 `src/ui`，约 12 个组件） | — | 见 2.2 |
| 存储 | **IndexedDB + `idb`** | 8.x | 结构化数据 + Blob 同库；`idb` 仅 1.2 KB |
| 解析 | **自研字节级扫描器** | — | 见第 4 节，这是产品的技术核心 |
| 虚拟化 | **自研块级窗口** | — | 需要「块 → 行 → 字符」三级锚点，通用库做不到 |
| PWA | **vite-plugin-pwa**（Workbox） | 1.x | 预缓存应用外壳与字体，运行时零请求 |
| 字体子集 | **pyftsubset**（脚本化） | — | 三套正文各裁到 ~7000 常用字 |
| Lint/格式化 | **Biome** | 2.x | 一个工具替代 ESLint + Prettier，快一个数量级 |
| 单测 | **Vitest** + Testing Library | 3.x | 与 Vite 同源 |
| E2E | **Playwright** | 1.x | 可 `context.setOffline(true)`，直接验证 C3/C4 |

### 2.2 为什么不用组件库（含 Mantine）

阅读器的视觉是**排版**，不是「控件外观」。组件库带来三类成本：

1. **覆盖成本**：Mantine 的圆角、阴影、字号阶梯、focus ring 全部要按本方案逐项覆写，覆写量接近重写；
2. **体积与运行时**：即使 tree-shaking，按钮/弹层/滑块一套下来 ~60–90 KB gzip，而自建 12 个组件 < 8 KB；
3. **行为锁定**：`Modal`/`Drawer` 自带焦点陷阱与滚动锁，但阅读器需要「浮层不夺焦、正文仍可滚动」的特殊行为，改源码不如自写。

> 保留退路：所有通用控件集中在 `src/ui/`，接口是纯 props。若后续团队要求接入组件库，只需替换该目录，业务层零改动。

### 2.3 目录结构

```
x-book/
├─ docs/
│  ├─ brand-vi.html              # 品牌与界面规范（可交互，日/夜切换）
│  └─ tech-design.md             # 本文档
├─ public/
│  ├─ icons/                     # pwa-192/512、maskable-512
│  ├─ favicon.svg
│  └─ fonts/                     # 本地字体子集，禁止外链 CDN
│     ├─ qy-kai.woff2            # 霞鹜文楷子集 ~1.9 MB（正文默认）
│     ├─ qy-serif.woff2         # 思源宋体子集 ~1.6 MB
│     └─ qy-sans.woff2          # 思源黑体子集 ~1.1 MB
├─ src/
│  ├─ main.tsx
│  ├─ App.tsx
│  ├─ app/
│  │  ├─ routes.tsx              # /  /read/:id  /settings
│  │  ├─ bootstrap.ts            # 打开 DB → 载设置 → 注入主题 → 请求持久化存储
│  │  └─ providers.tsx
│  ├─ styles/
│  │  ├─ tokens.css              # 设计令牌：纸/墨/羊皮 三套
│  │  ├─ base.css                # reset + 全局排版
│  │  └─ motion.css
│  ├─ core/                      # 纯逻辑：不依赖 React / DOM，100% 可单测
│  │  ├─ encoding/
│  │  │  ├─ detect.ts            # BOM → 严格 UTF-8 → GB18030 → UTF-16 启发式
│  │  │  └─ normalize.ts         # 非 UTF-8 转码为 UTF-8 流
│  │  ├─ parser/
│  │  │  ├─ newline.ts           # TransformStream：\r\n / \r / 零宽字符 → 归一
│  │  │  ├─ scanner.ts           # 字节级扫描 0x0A，产出块索引
│  │  │  ├─ chapters.ts          # 章节正则 + 从本书学习标题规律 + [::] 手动标记
│  │  │  ├─ meta.ts              # 文件名识别书名/作者（《书名》作者：x / 书名.[作者] / Bookname by author）
│  │  │  ├─ footnotes.ts         # ①–㊿ 引用与行首注释配对
│  │  │  ├─ cleaner.ts           # 来源广告清洗规则（可编辑、可报告命中）
│  │  │  └─ indexer.ts           # 编排 detect → normalize → clean → scan → chapters → footnotes
│  │  ├─ reader/
│  │  │  ├─ blockReader.ts       # 按块 slice + decode + LRU(24)
│  │  │  ├─ paginator.ts         # 分页（按章优先，无章退化按屏；滚动模式块级虚拟化）
│  │  │  ├─ titlepage.ts         # 扉页与藏书章数据（书名/作者/简介摘录）
│  │  │  └─ progress.ts          # 进度换算（block/line/char/percent）
│  │  └─ text/
│  │     ├─ sanitize.ts          # 去段首全角空格、空行归一、超长段切分
│  │     └─ typography.ts        # 行首禁则、中西混排间距
│  ├─ storage/
│  │  ├─ db.ts                   # schema + 版本迁移
│  │  ├─ blobStore.ts            # 书籍文件 Blob 读写
│  │  ├─ fontStore.ts            # 自备字体（TTF/OTF/WOFF2 → FontFace，存 IDB）
│  │  └─ repositories/
│  │     ├─ bookRepo.ts
│  │     ├─ progressRepo.ts
│  │     ├─ bookmarkRepo.ts      # 书签 + 摘录
│  │     ├─ searchRepo.ts        # 全书搜索（块索引增量扫描）
│  │     └─ settingsRepo.ts
│  ├─ sync/                      # 可选能力，默认 Noop
│  │  ├─ types.ts                # SyncAdapter 接口
│  │  ├─ noopAdapter.ts          # 默认实现：永远返回 local-only
│  │  ├─ httpAdapter.ts          # 自建/第三方 REST，可替换
│  │  ├─ engine.ts               # 超时、重试、outbox、降级状态机
│  │  └─ index.ts                # createSync()：能力探测 + 选择适配器
│  ├─ features/
│  │  ├─ shelf/
│  │  │  ├─ ShelfPage.tsx
│  │  │  ├─ components/{ContinueCard,BookCard,BookMenu,ImportDropzone,ShelfToolbar}.tsx
│  │  │  └─ hooks/{useBooks,useImport}.ts
│  │  ├─ reader/
│  │  │  ├─ ReaderPage.tsx
│  │  │  ├─ components/{TitlePage,ReaderView,TocRail,ReaderPager,TocDrawer,BookmarkPanel,ExtractList,LayoutSheet,FootnotePopup}.tsx
│  │  │  ├─ hooks/{useReaderEngine,useJump,useKeyboard,useSwipe,useSelection}.ts
│  │  │  └─ reader.module.css
│  │  ├─ settings/
│  │  │  ├─ SettingsPage.tsx
│  │  │  ├─ sections/{Appearance,Reading,Behavior,Recognition,Fonts,Data,Sync,About}.tsx
│  │  │  └─ components/{SliderRow,SegmentedRow,ToggleRow,ColorRow,FontRow}.tsx
│  │  └─ import/
│  │     ├─ ImportDialog.tsx
│  │     └─ importQueue.ts        # 串行导入，可取消，进度上报
│  ├─ ui/                        # 设计系统（无业务）
│  │  ├─ {Button,Segmented,Sheet,Drawer,Toast,Progress,EmptyState,Icon,Slider,Switch}.tsx
│  │  └─ icons/*.tsx             # 手写 SVG，共 12 个
│  ├─ lib/
│  │  ├─ platform.ts             # isTouch / isStandalone / 支持 FileSystemAccess?
│  │  ├─ format.ts               # 字节、字数、时长
│  │  ├─ id.ts                   # nanoid 精简版
│  │  └─ throttle.ts
│  └─ types/
│     └─ models.ts               # Book / Chapter / Block / Progress / Bookmark
├─ tests/
│  ├─ fixtures/{utf8.txt,utf8-bom.txt,gbk.txt,crlf.txt,no-chapter.txt}
│  ├─ unit/{detect,scanner,chapters,progress,paginator}.test.ts
│  └─ e2e/{offline.spec.ts,import.spec.ts,reader.spec.ts,responsive.spec.ts}
├─ scripts/
│  ├─ subset-fonts.sh            # pyftsubset 生成 woff2
│  └─ gen-large-fixture.mjs      # 生成 100 MB 测试文件
├─ index.html
├─ vite.config.ts
├─ tsconfig.json
├─ biome.json
├─ package.json
└─ README.md
```

**分层规则（强制）**

1. `core/` 不得 import React、不得访问 `window`/`document`/`indexedDB`——只接收 `ArrayBuffer`/`string`/数字。这样解析器可以在 Node 里跑单测，也能将来复用到 CLI 或桌面壳。
2. `features/` 不得直接操作 `indexedDB`，只能走 `storage/repositories`。
3. `sync/` 不得被 `core/` 或 `storage/` 依赖，方向只能 `features → sync → storage`。
4. `ui/` 不得出现业务文案与业务状态。

---

## 3. 数据模型（IndexedDB）

库名 `qingyue`，版本 1。

| store | key | 内容 | 说明 |
|---|---|---|---|
| `books` | `id` | Book | 元数据 + 索引摘要 |
| `files` | `id` | `{ blob: Blob }` | 归一化后的 UTF-8 文件体 |
| `chapters` | `[bookId, i]` | Chapter | 一章一条，通常 < 5000 条 |
| `blockIndex` | `bookId` | `ArrayBuffer` | 打包的 `Uint32Array`（byteStart / charCount / lineCount） |
| `progress` | `bookId` | Progress | 每本一条，写入去抖 500ms |
| `bookmarks` | `id` | Bookmark | 书签 + 摘录，按 `bookId` 建索引 |
| `settings` | `key` | any | 全局设置 + 每本书的排版覆盖 |
| `fonts` | `id` | `{ name, blob, family }` | 用户导入的自备字体（≤ 12 个） |
| `outbox` | `id` | SyncOp | 可选同步队列，仅在启用同步后写入 |

```ts
type Book = {
  id: string;
  title: string; author?: string;   // 由文件名规则自动识别，可手动改
  size: number;                     // 归一化后字节数
  encoding: 'utf-8' | 'gb18030' | 'utf-16le' | 'utf-16be';
  fingerprint: string;              // size + 前 64KB 的 xxhash32，用于去重
  blockSize: 16384;
  blockCount: number;
  charCount: number;
  chapterCount: number;
  cleanedLines: number;             // 广告清洗命中行数（导入报告用）
  footnotes: number;                // 识别出的脚注对数
  status: 'indexing' | 'ready' | 'error';
  indexProgress: number;            // 0–1
  group?: string;
  finished: boolean;
  createdAt: number; lastOpenedAt?: number; finishedAt?: number;
  coverHue: number;                 // 由主题色派生，随主题变化
};

type Progress = {
  bookId: string;
  chapterIndex: number;
  blockIndex: number;
  lineInBlock: number;
  charOffset: number;           // 全书字符偏移，跨字号最稳
  percent: number;              // 0–1，用于进度条与排序
  pixelOffset?: number;         // 同字号下的行内像素锚点
  updatedAt: number;
  deviceId: string;
};
```

> `percent` 用 `charCount` 累计计算，不用字节、不用滚动像素——换字号/换设备都不会漂。

---

## 4. 核心技术方案：为什么能「秒开」

### 4.1 一条关键不变量

**导入时把文本归一化为 UTF-8，之后所有偏移都是 UTF-8 字节偏移。**

这条不变量带来三个直接收益：

- UTF-8 中**多字节序列的每个字节都 ≥ 0x80**，而 `\n` 是 0x0A。因此在字节层扫描换行**永远不会切坏字符**，不需要解码就能建索引，扫描速度接近内存带宽。
- 任意块都可以 `blob.slice(a, b)` 后独立解码，无需从头解码。
- 章节边界（必在换行处）天然是安全切片点。

非 UTF-8 文件（GBK/GB18030/UTF-16）只在**导入时**付一次转码成本：`TextDecoderStream(enc)` → `TextEncoderStream()` → 写入新 Blob。这一步同时顺手去掉 BOM、把 `\r\n`/`\r` 归一为 `\n`。

UTF-8 文件走**快路径**：不复制、不转码，直接对原 Blob 建索引。

### 4.2 导入流水线

```
File / Blob
  │  1. 采样检测编码（BOM → 严格 UTF-8 解码 → GB18030 → UTF-16 NUL 分布）
  ├─ utf-8 ──────────────────────────────┐
  └─ 其他 → TextDecoderStream → NewlineStream → TextEncoderStream
                                          │
                     2. 分块读取（1 MB）   ▼
                        字节扫描 0x0A ──► 行边界
                                          │
                     3. 每 16 KB 收口一个 block
                        （按换行对齐，记录 byteStart / charCount / lineCount）
                                          │
                     4. 命中章节正则的行 → 解码该行（≤ 200 字节）→ Chapter
                                          │
                     5. 每 8 MB 落一次盘，进度可恢复；用户可先读已索引部分
                                          ▼
                                books / files / chapters / blockIndex
```

- **块大小 16 KB**：约 5,300 汉字 ≈ 170 行（32 字/行），解码耗时 < 2 ms，单块足够铺满一屏半；100 MB 文件约 6,400 块，打包索引仅 ~77 KB。
- **章节识别**只在「行首 40 字节内命中正则」时解码整行，避免全文解码：

```ts
const CHAPTER_RE = /^\s*(?:第[零一二三四五六七八九十百千万0-9]{1,9}[章节回卷部篇]|卷[零一二三四五六七八九十百千万0-9]{1,6}|Chapter\s+\d+|序章?|楔子|前言|后记|尾声|番外)\b?.*$/;
```

- **可中断**：导入在 Web Worker 中执行，主线程只收进度消息；关闭阅读器不丢已完成的索引。

### 4.3 读取与渲染

- `blockReader` 持有 `LRU(24)` 的解码缓存（约 24 × 5,300 字 ≈ 12 MB 字符，实际更少）。
- **分页模式（默认）**：`paginator` 以「容器宽高 + 字号 + 行高 + 边距」算出每页可容纳的行数与每行字数，纯计算切分，不依赖 DOM 测量；跨块时自动衔接下一块。翻页 = 移动块内行游标，命中块边界时读下一块（异步，预取 ±1 块）。
- **滚动模式**：块级虚拟滚动。每个块的外层高度 = `lineCount × lineHeight`（导入时已知，**不是估算**），因此滚动条总高度一开始就是准的；块内渲染真实文本，`contain: content` 隔离布局。
- 首屏策略：先渲染当前块，再 `requestIdleCallback` 预取后一块与前一块；不做「加载完才显示」。

### 4.4 进度与定位

四重锚点，按精度从高到低：`charOffset` > `blockIndex + lineInBlock` > `percent` > `pixelOffset`。
恢复时逐级回退：先按 `charOffset` 定位（跨字号/跨设备可靠），若块索引失效（重新导入过）则用 `percent` 兜底。写入 `progress` 去抖 500 ms + `visibilitychange` 强制落盘。

### 4.5 编码检测顺序

1. BOM：`EF BB BF` → UTF-8；`FF FE` → UTF-16LE；`FE FF` → UTF-16BE（转码后 BOM 丢弃）
2. 前 64 KB 用 `TextDecoder('utf-8', { fatal: true })` 严格解码：成功且无异常 → UTF-8
3. 失败 → 用 `gb18030` 解码，统计「CJK 字符占比 ≥ 0.35 且 U+FFFD 为 0」→ GB18030
4. 仍不成立 → 检查 0x00 的奇偶分布判断 UTF-16，否则回落 `gb18030` 并在 UI 提示
5. 阅读器与书架都提供**手动改编码并重建索引**（保留原文件，仅重跑流水线）

---

## 5. 离线与渐进增强

### 5.1 离线

- `vite-plugin-pwa`：`registerType: 'autoUpdate'`，预缓存 `index.html` + JS/CSS + 三个字体子集 + 图标；**不配置任何 runtimeCaching 的外部域名**。
- 字体 `font-display: swap` 且本地加载，首屏不阻塞。
- 首次访问后即可全功能离线；`navigator.storage.persist()` 在首次导入时请求，避免 Safari 回收。
- 不做「离线可用但仅限 xxx」的降级矩阵——没有网络分支，就没有降级分支。

### 5.2 同步（可选，默认关闭）

```ts
export interface SyncAdapter {
  readonly id: string;
  probe(signal: AbortSignal): Promise<{ ok: boolean; reason?: string }>;
  pull(since: number, signal: AbortSignal): Promise<SyncPayload>;
  push(ops: SyncOp[], signal: AbortSignal): Promise<void>;
}
```

状态机：`disabled → probing → online ⇄ degraded → disabled`

- `createSync()` 在启动时读配置；没有配置 → 直接返回 `NoopAdapter`，**不发任何请求**，UI 显示「单机模式」。
- `probe` 带 4s `AbortController` 超时，`try/catch` 覆盖 DNS 失败、证书过期（`TypeError: Failed to fetch`）、5xx、CORS。
- 任何异常 → `degraded`：不弹窗、不阻塞、不清空本地数据，仅设置页留一行状态 + 手动重试；退避 30s → 2min → 10min。
- 冲突策略：进度按 `updatedAt` 取新（LWW）；书签按 `id` 并集合并，删除用墓碑。
- **默认只同步元数据**（进度、书签、设置、书目），不同步书籍文件本体；文件同步为独立开关，且仅在用户显式开启后上传。

---

## 6. 性能预算

| 指标 | 预算 | 测量点 |
|---|---|---|
| 100 MB UTF-8 导入建索引 | < 2.5 s | `performance.mark` 在 indexer 内 |
| 100 MB GBK 导入（含转码） | < 6 s | 同上 |
| 首屏可读 | < 1.2 s | 从点击书到首块文本上屏 |
| 单块解码 | < 4 ms | `blockReader` 内计时，超 8 ms 打点告警 |
| 翻页 | < 16 ms（不掉帧） | Playwright + `requestAnimationFrame` 采样 |
| 冷启动 → 书架可交互 | < 800 ms | Lighthouse TTI |
| JS 包体（gzip，不含字体） | < 180 KB | `vite build --report` |
| 阅读 100 MB 时 JS 堆 | < 120 MB | DevTools Memory 快照 |

---

## 7. 里程碑

| 阶段 | 内容 | 完成标志 |
|---|---|---|
| **M1 骨架** | Vite + TS + 令牌 CSS + 路由 + `ui/` 基础组件 | 三个空页面可跑，纸黄/黛蓝切换无闪烁 |
| **M2 解析** | encoding / scanner / chapters / meta / footnotes / cleaner / indexer + Worker | 单测通过；100 MB 文件索引 < 2.5s；书名作者识别 3 种命名全过；脚注配对用例通过 |
| **M3 书架** | 导入队列、扉页与自动封面（丝带/进度/状态）、三种排序、搜索、去重、重处理 | 断网可导入可管理；刷新后仍在；Alt+点击重建索引生效 |
| **M4 阅读器** | blockReader / paginator（按章分页+滚动）/ 左侧章节栏（简化名）/ 排版抽屉 / 脚注浮层 / 手势键盘 | 翻页流畅，目录跳转准确，排版实时生效，`[::]` 标记生效 |
| **M5 持久化** | progress / bookmarks / 摘录 / settings 落盘与恢复 | 关闭再打开定位误差 < 1 行；跨字号恢复误差 < 2 行 |
| **M6 PWA** | SW 预缓存（含字体）、安装引导、图标、存储配额与 persist() | 断网冷启动全功能可用（C3 达标） |
| **M7 自备字体与搜索** | fontStore + FontFace 注册、全书搜索（块索引增量） | 拖入 TTF 即可用且重启后仍在；50 MB 内搜索 < 3s |
| **M8 同步** | Noop + HTTP 适配器、降级状态机、设置页 | 填错地址/过期证书不影响任何本地功能（C4 达标） |

> 每一版结束都跑一次「断网验收脚本」，C3/C4 不允许事后补。

---

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| iOS Safari JS 堆限制（~1 GB 但碎片化严重） | 块级解码 + LRU 上限 + 及时释放；禁止在 state 里长期持有整章字符串 |
| IndexedDB 被系统回收（Safari 7 天未使用） | 首次导入即 `storage.persist()`；设置页显示「存储已被保护/未保护」 |
| 复制 Blob 导致磁盘翻倍 | 仅非 UTF-8 需转码复制；UTF-8 走快路径；Chromium 支持时保存 `FileSystemFileHandle` 引用原文件 |
| 编码误判 | 手动改编码 + 重建索引（不重选文件）；错误提示给出前后 200 字预览 |
| 章节正则漏识别（无章节的整本合集） | 章节为空时退化为「单段全文」，靠块索引与百分比导航，功能不受影响 |
| 超长单段（如整本无换行） | 渲染层按句号切视觉段，进度锚点仍指向原字符偏移 |
| 字体子集缺字（生僻字/异体字） | 字体栈末尾保留系统衬线回退；缺字不报错，只回退字形 |

---

## 9. 从易笺（SimpleTextReader v1.6.9.4）吸收的功能清单

详细取舍见 `brand-vi.html` 第 02 节。落在工程上的对应关系：

| 吸收点 | 工程落点 |
|---|---|
| 书名/作者文件名识别（3 种命名模式） | `core/parser/meta.ts`，导入时填充 `Book.title/author`，可手动改 |
| 章节正则 + 从文档学习标题规律 + `[::]` 手动标记 | `core/parser/chapters.ts`；学习结果存 `settings`（按 bookId） |
| 脚注 ①–㊿ 与行首注释配对 | `core/parser/footnotes.ts` → 渲染为上标 + `FootnotePopup`，汇总书末注释页 |
| 广告清洗（规则化，来源可扩展） | `core/parser/cleaner.ts`；规则 JSON 可编辑，命中数写 `Book.cleanedLines` |
| 自动扉页 + 藏书章 | `core/reader/titlepage.ts` + `TitlePage.tsx`，可在设置中关闭 |
| 自动封面（颜色随主题、丝带、进度） | 纯 CSS/SVG 生成，无图片资源；`coverHue` 由主题色派生 |
| 书架三种排序（在读/未读/读完） | `bookRepo` 查询排序；状态字段 `lastOpenedAt / finishedAt` |
| 目录简化章名（去「正文/第X卷」前缀） | `TocRail` 渲染层处理，不改原文 |
| 逐行进度 | 升级为块+行+字符三重锚点（`Progress` 类型） |
| 按章分页 / 无限滚动 | `paginator.ts` 分页主路径；滚动模式块级虚拟化 |
| 自定义字体拖入（TTF/OTF） | `storage/fontStore.ts` + `FontFace`，上限 12 个 |
| 标题/正文字体分离 | 设置两项独立，默认跟随正文族 |
| 快捷键体系与可开关 | `useKeyboard` + 设置开关，默认仅在阅读页生效 |
| Alt+点击封面重建索引 | `useImport` 支持 force 标志 |
| 「快读完」提示 | 阅读进度 > 90% 时显示剩余分钟 |
| 界面语言随书切换（中/英） | i18n 字典 + 检测书名/正文主语言 |
| 浏览器历史导航 | `history.pushState` 每次章节跳转入栈，返回键回上一章 |
| PWA / 多入口 | vite-plugin-pwa；后续可加「无界面版」思路（URL 以 .txt 结尾直接打开） |

易笺的限制（128 MB 上限、网络字体需联网、官网依赖、隐私模式禁书架、仅两家清洗规则、无书签/搜索）在 `brand-vi.html` 02 节「三」中有逐条对策。

---

## 10. 待确认项

1. 是否接受「无组件库、自建设计系统」的路线（推荐），还是希望沿用 Mantine。
2. 同步能力是否本期只留接口与 Noop（推荐，即 M1–M7 结束即可用），还是 M8 同步交付一个可用的自建 REST 适配器示例。
3. 广告清洗规则首发只带「塞班 / 知轩」两条（易笺同款），还是首发就开放用户自定义正则。
4. 是否需要「朗读（系统 TTS）」进入后续版本——完全离线，但交互复杂度明显增加。
