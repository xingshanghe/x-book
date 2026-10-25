# 轻阅 · 音色包朗读：设计与实现计划

> 配套：[`tech-design.md`](./tech-design.md)（主技术选型与工程结构）、[`brand-vi.html`](./brand-vi.html)（品牌与界面规范）
> 状态：**设计稿 Rev 2，未开工**。本文只定方案和实现顺序，不含代码改动。
> 日期：2026-10-24

上一稿把每一句合成放在云端。本稿改为：建档在服务端做一次，朗读在本机完成；ZipVoice 模型不进安装包，用户确认要朗读时才下载。

---

## 0. 目标

用户可以用内置音色离线朗读一本 txt；也可以付费做一次音色加工，得到音色包之后，用同一次本机引擎离线朗读。朗读过程不再请求合成服务。

未使用朗读的人，安装包体积和今天一致，启动时也不为朗读发出任何请求。

---

## 1. 验收线

| 编号 | 约束 | 验收 |
|---|---|---|
| V1 | 不用朗读就零网络 | 从未点过「朗读」：断网冷启动，导入 / 书架 / 阅读 / 排版 / 书签 / 进度可用，且无朗读相关请求 |
| V2 | 朗读失败不伤阅读 | 模型没下完、下载中断、建档服务挂了、证书过期：无阻断弹窗，正文仍可翻页、加书签 |
| V3 | 朗读不抢阅读 | 合成和下载进行时，翻页、书签、排版仍可操作 |
| V4 | 音色与引擎留在本机 | 建档或下载成功后杀掉进程再打开，音色包还在；引擎在则断网仍能读 |
| V5 | 授权可追溯 | 上传前有明确授权；音色包记下授权时间；提供删除 |
| V6 | 安装包不含模型 | 桌面包、apk / aab、ipa、鸿蒙 hap、`dist/`、PWA 预缓存里都没有 ZipVoice 的 onnx、词表、espeak 数据、声码器 |

V6 是本稿新增的硬约束。发布包 `sherpa-onnx-zipvoice-distill-int8-zh-en-emilia` 压缩后 **104.1 MB**（sherpa-onnx `tts-models` 发布页，2026-10-24 核对）。这份权重，以及文档要求另附的 `vocos_24khz.onnx`，只在用户要使用朗读时下载。

---

## 2. 范围

**要做**

- 本机分句、句级高亮、预读下一句、播放 / 暂停 / 语速。
- 一份版本化的「引擎包」，按需下载到应用数据目录。内置音色和用户音色共用这一份引擎。
- 音色包：短参考音频 + 与之对齐的文本 + 名称 + 授权时间。内置包随引擎包一起下来，不打进安装包。
- 付费只发生在建档：上传一次短音频，服务端做成音色包后返回。服务端不提供按句合成。

**不做**

- `POST /v1/tts/stream` 或任何「把正文送到服务器换音频」。
- 把 104 MB 模型打进 Tauri `bundle.resources`、`public/`、`dist/`、鸿蒙 `rawfile/qy`。
- 启动、打开书、或后台静默预下载引擎。
- 逐字放大（卡拉 OK）。第一版只做句级高亮。
- 用加密把音色包锁在一台设备上。换机靠账号把已购的包再下载一次。
- 高保真微调档。等有人愿意为「更像」另付费再加，产物仍是客户端音色包。

---

## 3. 架构

```
安装包（保持精简）
  阅读器 + 懒加载的朗读壳
  不含 onnx / 词表 / 声码器

用户点「朗读」并确认下载
        │
        ▼
对象存储 / CDN ──► 引擎包（约 104 MB + 声码器）
                    落到应用数据目录，不进安装包
        │
        ▼
本机引擎 ── 内置音色包 ──► 扬声器 + 句级高亮
         └─ 用户音色包 ──► 同上，断网可用

付费建档（与朗读分开，用过一次就结束）
  试读或上传 ──► 服务端质检、对齐文本 ──► 音色包
  不做逐句合成；交付后删除原始录音
```

朗读时的数据流停在本机：`当前句文本 + 音色包 → 本机引擎 → 音频`。服务器不在这条路上。

内置音色和克隆音色使用同一个 ZipVoice 引擎。ZipVoice 要的是参考音频和逐字对齐的文本，不是一段不能发声的向量。内置「声纹」就是事先授权好的小音色包；用户买的是同一种包。这样只需下载一次引擎。

若阶段 0 测出手机上 ZipVoice 实时率明显差于 1、预读一句仍接不上，手机第一版只开放内置音色，克隆留在桌面。引擎文件仍然按需下载，不改 V6。

---

## 4. 引擎包：用时才下

### 4.1 什么时候下

只有用户在阅读页点「朗读」，或在设置里点「启用朗读」，并在说明里确认之后，才开始下载。说明写明大约体积和「只需一次，完成后可离线朗读」。

以下时机都不下载：安装、首次启动、打开一本书、设置页仅仅滚到朗读区、同步探测。

取消下载不标记为已安装。失败可重试。已完成的引擎在应用升级后继续用，直到清单里的版本号变了，才提示再下一次。

### 4.2 下到哪里

| 端 | 位置 | 禁止 |
|---|---|---|
| 桌面 / Android / iOS（Tauri） | 应用数据目录 `tts/engine/<version>/` | 不放进 `src-tauri/tauri.conf.json` 的 `bundle.resources`，不链进安装包 |
| 浏览器 / PWA | Origin Private File System：`tts/engine/<version>/` | 不放进 `public/`，不匹配 `vite.config.ts` 里 Workbox 的 `globPatterns` |
| 鸿蒙 | 沙箱 `filesDir/tts/engine/<version>/`，单独下载 | 不放进 `rawfile/qy`。`Load.ets` 会把 rawfile 整份复制进沙箱，放进去会把 hap 和首次拷贝都撑大 |

元数据（版本、字节数、sha256、安装时间）记在 IndexedDB。权重本身不进 `fonts` 那种 IndexedDB Blob：104 MB 放进 IDB，在 Safari 上容易顶满配额。

下载走 HTTP Range，未完成的部分存为 `.part`。整包 sha256 相符才把状态改成已安装，然后删掉 `.part`。不符则删除并允许重试。

下载域名和建档域名分开。模型是静态文件，用对象存储或 CDN，不经过建档进程。

### 4.3 安装包怎么保持精简

- 朗读的 JS 单独懒加载，不进主包。主包 gzip 预算仍是 `tech-design.md` 的 180 KB。
- `vite.config.ts` 的 `globPatterns` 保持现在的 `js,css,html,svg,png,woff2,json`。即使有人把 onnx 放进 `dist/`，预缓存也不应收录；实现时再加一条排除，避免以后改 glob 时误收。
- 仓库不提交模型文件，不加 Git LFS 来「顺便带上」。
- 推理运行时同样不进「从不朗读」的安装包。桌面和手机优先随引擎包下载 sherpa 的库或 wasm。阶段 0 若证明某端必须静态链接，先量出体积；链进去超过 8 MB 就改回随引擎包下载。
- 现在 `src-tauri/Cargo.toml` 只有 Tauri 本身。不要为了朗读把 sherpa 写进默认依赖，除非阶段 0 的体积测量允许。

### 4.4 下完之后

引擎在本地，内置音色就能断网朗读。删除引擎的入口放在设置里，删的是权重，不删书籍。用户音色包很小，删引擎时保留，下次下载引擎后还能读。

`wipeAll()`（`src/storage/db.ts`）今天清的是书籍和字体，没有 `settings`。实现时把音色包和引擎元数据纳入「清除本机数据」的确认文案；引擎文件在应用数据目录里一并删掉。

---

## 5. 音色包

```ts
type VoiceOrigin = 'builtin' | 'enrolled';

interface VoicePack {
  id: string;
  name: string;
  origin: VoiceOrigin;
  /** 24 kHz 单声道 16-bit PCM wav，约 5–15 秒 */
  refAudio: Blob;
  /** 与 refAudio 逐字对应。ZipVoice 对不齐时相似度会明显下降 */
  refText: string;
  lang: 'zh' | 'en';
  quality?: number;
  consentAt?: number;
  createdAt: number;
  remoteId?: string;
}
```

内置包没有 `consentAt` 和 `remoteId`，授权在我们发布引擎包之前完成。用户包在上传前记录 `consentAt`。

本机播放接口：

```ts
interface LocalTts {
  speak(text: string, pack: VoicePack, speed: number, signal: AbortSignal): Promise<ArrayBuffer>;
}
```

没有引擎时 `speak` 不可用，调用方显示下载说明，不发网络合成请求。

---

## 6. 客户端落点

分层仍按 `tech-design.md`：`core/` 不碰 React 和 DOM；`features/` 不直接摸 IndexedDB。

```
src/core/text/sentences.ts          # 分句纯函数，可单测
src/tts/                            # 懒加载
  types.ts
  manifest.ts                       # 版本、URL、字节数、sha256；本文件不发请求
  download.ts                       # 用户确认后才 Range 下载
  engineStore.ts                    # 应用数据目录 / OPFS 的安装状态
  player.ts                         # Web Audio 队列，预读 1 句
  runtime.ts                        # 引擎就绪后才加载
src/storage/voiceStore.ts           # 音色包，镜像 fontStore 的 Blob 存法
src/features/reader/ReadAloud.tsx   # 阅读页播放条，动态 import
src/features/settings/              # 「朗读」区：启用、下载、音色、删除
```

数据库：`DB_VERSION` 从 1 升到 2，新增 `voices`。`upgrade()` 用 `objectStoreNames.contains` 判断，保留现有的 `blocked` / `blocking`。`voices` 加入清除列表。

阅读页今天的工具条在 `ReaderPage.tsx` 的 `reader-bar`。朗读按钮放在这里，点击后才 `import()` 朗读模块。

播放：`sentences.ts` 按标点切句；播第 N 句时预合成第 N+1 句；第 N 句开始就把该句标为当前句并滚进视野。高亮不依赖字级时间戳。

桌面端 CSP 今天是 `connect-src 'self' blob: data: ipc: http://ipc.localhost`（`src-tauri/tauri.conf.json`）。用户确认下载或建档之后，才需要放行模型 CDN 和建档域名。未确认前不探测这些域名。播放本地音频需要 `media-src 'self' blob:`，否则会落到 `default-src 'self'`。

鸿蒙 `module.json5` 今天不申请 `INTERNET`，这是离线保证。朗读下载和建档上传都需要网络，只能在用户点下确认之后再申请，不能为了这个功能把权限改成默认持有。内置阅读在引擎还没下载时保持无网络、无麦克风。

麦克风只给试读采样：iOS `NSMicrophoneUsageDescription`，Android `RECORD_AUDIO`，桌面 WebView 的 capability 按需加。内置音色朗读不申请麦克风。

---

## 7. 建档服务

只在阶段 3 做。在那之前，用手工做好的音色包把本机播放跑通。

职责：

1. 接收试读录音或上传的音频。
2. 去静音、去噪、重采样到 24 kHz 单声道、单人检测、切出最干净的约 5–15 秒。
3. 语音识别写出与这段音频对齐的文本，并打质量分。
4. 返回音色包。不合成正文。
5. 返回成功后删除原始上传。保留音色包供同一账号换机下载，直到用户删除。

试读是主路径：客户端给出固定引导文，录 20–60 秒，不足时长不能提交，可回放、可重录。上传是备路径，质检失败要说明是太短、太吵，还是像多人。

接口草案：

```
GET    /v1/health

POST   /v1/auth/register          # { username, password } → 令牌对
POST   /v1/auth/login             # { username, password } → 令牌对
POST   /v1/auth/refresh           # { refreshToken } → 新的令牌对，旧刷新令牌作废
POST   /v1/auth/logout            # { refreshToken } → 作废该刷新令牌
GET    /v1/auth/me                # Authorization: Bearer → { id, username, enrollCredits }

POST   /v1/voices/enroll          # 需登录。multipart 音频 + 可选引导文
                                  # → 音色包（wav + refText + quality）
GET    /v1/voices                 # 需登录。当前账号的包，用于换机
DELETE /v1/voices/:id             # 需登录。只能删自己的；客户端同时删本地
```

没有 `/v1/tts/stream`，也没有 `/v1/tts/synth`。

响应包一层，沿用 nebulasforce 的 HTTP 信封：`success`、`code`、`message`、`data`。成功时 `code` 为 0。失败时 `data` 为空，`message` 给调用方能展示的一句说明。

### 7.1 账号（极简）

轻阅客户端今天只有 `deviceId`，`src/sync/` 仍是 `NoopAdapter`。建档服务自带一套账号，不接到同步上，也不把正文送进账号系统。

做法对照 nebulasforce 的 `auth_service` 和 `utils/password`，只留朗读用得上的部分：

| 保留 | 不带 |
|---|---|
| 用户名 + 口令 | 邮箱、手机号、短信和邮件验证码 |
| 服务端生成 6 位数字盐，和口令拼在一起再 bcrypt；盐不由客户端传入 | 角色、组织、部门、资料、头像 |
| 访问令牌 1 小时，刷新令牌 7 天；刷新时轮换，退出时作废 | 企业微信、钉钉、OIDC |
| 连续 5 次失败后锁定 15 分钟 | gRPC、Redis。刷新令牌记在 SQLite |
| 用户不存在和口令错误返回同一句「用户名或口令不正确」 | 支付渠道 |

账号表只留这些列：`id`、`username`（唯一，存小写）、`password_hash`、`salt`、`status`（0 正常 / 1 禁用）、`failure_count`、`updated_at`、`last_login`、`login_ip`、`enroll_credits`。

`enroll_credits` 是剩余建档次数。注册时为 0。建档成功才减 1；质检失败不减。次数用尽时建档返回明确说明，不接收音频。第一版不加支付：用一把只放在服务端环境变量里的管理口令调用 `POST /v1/admin/credits` 给指定用户名加次数。管理口令缺失时这个接口不注册。

令牌签名密钥来自环境变量，进程启动时没有密钥就拒绝启动。口令、盐、哈希不进日志，也不出现在 `data` 里。

客户端把刷新令牌放在本机（IndexedDB），访问令牌放在内存。设置里提供注册、登录、退出。未打开账号区时不请求 `/v1/auth/*`。未登录时，内置音色和已经在本机的音色包照常朗读；只有建档、拉取云端列表和删除云端副本需要登录。登录失败不影响翻页和已安装的引擎。

另一台设备登录同一账号后，`GET /v1/voices` 只能看到这个账号的包。用别人的 id 删除，返回找不到，不透露那个包是否存在。

---

## 8. 合规

声音是生物特征。上传前说明音频会送到服务器做一次加工、加工后删除原始录音。勾选本人或已获授权，时间写入 `consentAt`。设置里可以删除本地包；已登录则同时删云端。

内置音色必须是已获授权的录音，不使用未授权的真人声音。收费上线前核对 ZipVoice 权重和 Emilia 数据的许可；运行时开源不等于权重可以商用。许可不过关，就不按这个引擎收费。

---

## 9. 实现计划

任务拆分、依赖和每周顺序见 [`voice-tts-dev-plan.md`](./voice-tts-dev-plan.md)。下面是阶段出口。一个人做。每一段结束都做一次断网阅读验收（V1 / V2）。未写「开始实现」之前不动代码。

### 阶段 0 · 实测（约 3–5 天）

在一台 Mac 和一部目标安卓机上跑 ZipVoice int8，`num-steps=4`，读小说正文。记录实时率、内存、首包时间。听内置参考音频是否能当免费音色。核对权重许可。确认 OPFS 或应用数据目录在 Tauri WebView 和鸿蒙 ArkWeb 上能放下 100 MB 以上的文件。

完成线：写明三件事。目标手机预读一句能否接上；引擎包的 sha256 和确切文件列表（含声码器）；许可能否商用。手机接不上时，计划改成手机第一版只有内置音色。

### 阶段 1 · 按需下载 + 内置音色朗读（约 1–2 周）

不做服务器，不收费。

1. `sentences.ts` 与单测：中英文句号、问号、叹号、省略号、引号。
2. 下载器：确认后才请求；进度、取消、断点、sha256；写入应用数据目录或 OPFS。
3. 引擎就绪后，用包内的内置音色朗读。阅读页懒加载播放条：播放、暂停、语速、当前句高亮。
4. 构建产物检查：`dist/`、桌面包、apk 里搜不到 `encoder.int8.onnx`。主包 gzip 仍小于 180 KB。

完成线：从未点朗读时零请求（V1）。点朗读会先看到体积说明，确认后才下载。下完后断网，内置音色能连续读 10 分钟，翻页仍可用（V3 / V4 / V6）。

### 阶段 2 · 用户音色包在本机播放（约 1 周）

规定音色包格式并存进 `voices`。用一份手工包（wav + 对齐文本）走和内置音色同一条 `speak`。设置里可改名、删除。`DB_VERSION` 迁到 2。

完成线：导入包、杀掉进程、断网，仍用该包朗读，且没有合成请求。

### 阶段 3 · 账号与付费建档（约 2–3 周）

前提：阶段 0 的许可结论允许商用。账号按第 7.1 节做，不再单独立项选型。

先做注册、登录、刷新、退出，再做建档。客户端：试读录音、上传、授权勾选、失败原因、把返回的包写入 `voices`。同一账号在第二台设备能把包重新下载下来，然后离线读。未登录时阅读和已有音色不受影响。

完成线：一段合格的 10 秒录音变成音色包，本机立刻用它朗读。质检失败有具体原因。建档服务域名无法解析时，阅读和已装好的引擎不受影响（V2 / V5）。

### 阶段 4 · 各端权限与慢设备（约 1 周）

麦克风权限、CSP 放行、鸿蒙仅在确认后申请网络。慢设备预读跟不上时，句与句之间允许停顿，设置里写明原因。不改走云端合成。

### 阶段 5 · 以后再说

高保真加工档。产物仍是音色包，朗读路径不变。

---

## 10. 验收标准

### AC-001: 未使用朗读时不产生朗读流量

- **Scenario:** 新安装，用户没有点过「朗读」或「启用朗读」
- **Action:** 断网冷启动，导入一本 txt，打开、翻页、加书签
- **Expected:** 这些动作完成；网络面板里没有引擎 CDN 或建档域名的请求
- **Must not:** 启动时探测朗读服务，或开始下载引擎
- **Verification:** Playwright `context.setOffline(true)`，加上桌面端请求日志
- **Priority:** Required

### AC-002: 安装包不含 ZipVoice 权重

- **Scenario:** 干净构建出 `dist/`、桌面包和 apk
- **Action:** 在产物中搜索 `encoder.int8.onnx`、`vocos_24khz.onnx`、`espeak-ng-data`
- **Expected:** 零命中。主包 JS gzip < 180 KB。安装包相对加入朗读壳之前的增加量小于 1 MB（朗读壳的懒加载代码）
- **Must not:** 模型出现在 `bundle.resources`、`public/`、`dist/`、鸿蒙 `rawfile/qy`
- **Verification:** 构建脚本后的文件名检查；`vite build` 体积
- **Priority:** Required

### AC-003: 确认后才下载引擎

- **Scenario:** 引擎未安装
- **Action:** 阅读页点「朗读」
- **Expected:** 先显示大约体积和「只需下载一次」；用户确认后才出现进度；取消后状态不是已安装，不保留可被当成完整引擎的文件
- **Must not:** 点按钮的瞬间就开始下载
- **Verification:** 手动走一遍，并用测试替身拦截下载函数，断言确认前调用次数为 0
- **Priority:** Required

### AC-004: 引擎下完后内置音色可离线朗读

- **Scenario:** 引擎已安装，设备改为断网
- **Action:** 用内置音色从小说正文连续朗读
- **Expected:** 10 分钟内有声音；当前句有高亮并进入视野；期间可以翻页和加书签
- **Must not:** 朗读期间请求建档或合成接口
- **Verification:** 阶段 1 手工验收，桌面断网；自动化覆盖分句和高亮状态机
- **Priority:** Required

### AC-005: 损坏的下载不会变成已安装

- **Scenario:** 下载中断，或 sha256 不符
- **Action:** 重启应用再点朗读
- **Expected:** 仍提示下载；可续传或重新下。不符的文件被删掉
- **Must not:** 用半截 onnx 调用推理
- **Verification:** 下载器单测，喂入截断字节和错误校验和
- **Priority:** Required

### AC-006: 用户音色包只在本机播放

- **Scenario:** 本地已有音色包（手工导入或建档返回）并且引擎已安装
- **Action:** 选该音色朗读，然后断网再朗读
- **Expected:** 两次都出声；重启后包还在
- **Must not:** 把正文发到服务器
- **Verification:** `voices` 读写单测；播放路径断言只调用 `LocalTts.speak`
- **Priority:** Required

### AC-007: 建档失败时阅读仍在

- **Scenario:** 已有书籍和已安装引擎；建档地址不可达
- **Action:** 尝试建档，然后返回阅读页翻页
- **Expected:** 建档区有一行失败说明和重试；阅读页无阻断弹窗，翻页可用
- **Must not:** 清空书籍、进度、已有音色或引擎
- **Verification:** 手工，把建档域名指到无法解析的地址
- **Environment/safety:** 只对测试服务，不碰生产账号
- **Priority:** Required

### AC-008: 未授权不能上传

- **Scenario:** 试读录音已完成，授权勾选未选
- **Action:** 点提交
- **Expected:** 不发上传请求
- **Must not:** 在没有 `consentAt` 的情况下写入可同步的用户音色包
- **Verification:** 界面测试或提交函数单测
- **Priority:** Required

### AC-009: 分句稳定

- **Scenario:** 含「……」「——」、中英文引号、小数点和英文缩写的段落
- **Action:** 调用 `sentences.ts`
- **Expected:** 与测试夹具中的句子数组一致
- **Verification:** `pnpm test`，`tests/unit`
- **Priority:** Required

---

## 11. 尚未拍板

这些选择会影响能不能收费，或手机第一版有没有克隆。阶段 1、2 可以先做，阶段 3 开始前要定。

- [x] ZipVoice 的 Emilia 权重按发布方说明为 CC-BY-NC，不能按这个引擎对外收费。账号和建档接口可以先给自用；换可商用权重之前不要卖次数。
- [x] 没有目标安卓机的实测。手机克隆不进第一版，非 macOS 桌面只显示「朗读即将支持」，不下载引擎。

已定：朗读不走服务器；104 MB 模型用时才下；安装包保持精简；内置音色免费；建档按次，次数记在账号的 `enroll_credits` 上。换机找回用第 7.1 节的用户名账号，不接支付渠道。
