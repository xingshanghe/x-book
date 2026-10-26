<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
  <img src="docs/assets/logo.svg" alt="轻阅 QINGYUE" width="340">
</picture>

**免费、开源的本地 txt 阅读器。**

书籍保存在本机，离线可用。

[![Release](https://img.shields.io/github/v/release/xingshanghe/x-book?label=release&color=B44326)](https://github.com/xingshanghe/x-book/releases/latest)
[![Platforms](https://img.shields.io/badge/platform-Web%20%7C%20macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20Android%20%7C%20iOS%20%7C%20HarmonyOS-3E5C97)](https://github.com/xingshanghe/x-book/releases)
[![License](https://img.shields.io/badge/license-MIT-746851)](./LICENSE)

[下载](#下载) · [开始使用](#开始使用) · [功能](#功能) · [赞助](#赞助) · [常见问题](#常见问题)

</div>

---

轻阅面向纯文本小说与文稿。导入后，书架、目录、阅读进度、书签与排版均存储于本机，无需注册，无需持续联网。

支持手机、平板与桌面端。界面采用纸书版式，包含封面、扉页、目录与页码；字号、行距与主题可按阅读习惯配置。

## 功能

**书架**

- 支持拖入 txt，或从本地文件导入
- 可直接打开常见中文编码
- 支持按书名、作者检索
- 支持按最近阅读、加入时间、书名、作者或进度排序
- 首页提供「继续阅读」，定位至上次阅读位置
- 支持标记已读，以及从书架移除

**阅读**

- 支持翻页与滚动
- 自动分章，目录可固定在左侧
- 支持全书检索
- 支持书签，以及将当前段落保存为摘录
- 扉页可选
- 文中注释可展开
- 导入时可去除网文常见广告行，也可自定义规则

**排版**

- 提供纸黄、宣纸、黛蓝三种主题，也可跟随系统
- 可调字号、行距、段距、缩进与版心宽度
- 内置楷体、衬线、黑体，也可装入自有字体
- 针对手机、平板与桌面提供相应版面

**朗读**

macOS 桌面版可在设置中单独下载朗读引擎。安装包不包含该引擎。

- 从当前页面继续朗读，中断后可从该句续读
- 可调节语速，以及句间、段间停顿
- 引擎附带示例音色（雷军）。下载引擎后即可朗读，无需另行导入
- 可在设置中录制自有音色：按提示朗读指定文本，时长 5–15 秒，不足 5 秒不可保存。应用将录音编码为 16-bit PCM，无需另行设置格式。录音仅保存在本机
- 已有 wav 时，可将一个文件夹导入。文件夹内放置 `voice.wav` 与 `voice.txt`：wav 须为 16-bit、单声道或双声道、时长 5–15 秒、体积不超过 3 MB；txt 为 UTF-8 编码的对应文本。音色名称取文件夹名
- 已保存在本机的音色，未登录也可用于朗读

## 下载

请在 [最新发布](https://github.com/xingshanghe/x-book/releases/latest) 下载对应平台的安装包。

| 系统 | 文件 | 安装 |
|---|---|---|
| macOS | `qingyue-<版本>-macos-universal.dmg` | Intel 与 Apple 芯片通用。打开后拖入「应用程序」 |
| Windows | `qingyue-<版本>-windows-x86_64-setup.exe` | 运行安装程序 |
| Linux | `qingyue-<版本>-linux-x86_64.deb` | 适用于 Debian、Ubuntu 等系统 |
| Linux | `qingyue-<版本>-linux-x86_64.AppImage` | 赋予执行权限后直接运行，无需安装 |
| Android | `qingyue-<版本>-android-universal.apk` | 下载后安装。若系统拦截未知来源，按提示允许 |
| iOS | `qingyue-<版本>-ios-unsigned.zip` | 目前未签名，需自行签名后安装 |
| 鸿蒙 | `qingyue-<版本>-harmony-unsigned.app` | 需在本机使用 DevEco Studio 打包 |
| 网页 | `qingyue-web-<版本>.zip` | 解压后部署到网站，通过浏览器访问，也可安装到桌面或主屏幕 |

## 开始使用

1. 安装并打开轻阅。
2. 将 txt 拖入窗口，或点击右下角 **+** 导入。
3. 打开一本书。再次进入时，书架上的「继续阅读」会回到上次位置。

阅读时，左侧为目录。底部提供翻页、检索、书签、排版、昼夜切换与朗读。点击屏幕中央可显示或隐藏顶栏与底栏；点击左右两侧翻页。

设置入口位于书架右上角。可配置主题、阅读习惯、字体与朗读。

### 快捷键与手势

| 操作 | 作用 |
|---|---|
| `←` / `PageUp` | 上一页 |
| `→` / `PageDown` / `空格` | 下一页 |
| `T` | 展开或收起目录 |
| `Esc` | 关闭当前浮层 |
| 左右滑动 | 触屏翻页 |
| 点按左右侧 | 翻页（可在设置中关闭） |
| 点按中间 | 显示或隐藏顶栏和底栏 |

## 赞助

轻阅按 MIT 许可证免费提供。可以请我喝杯咖啡。

<p align="center">
  <img src="services/voice-enroll/app/static/sponsor-wechat.png" alt="微信收款码" width="220"><br>
  微信
</p>

<p align="center">
  <img src="services/voice-enroll/app/static/sponsor-alipay.png" alt="支付宝收款码" width="220"><br>
  支付宝
</p>

### 赞助名单

公开名单与应用内「设置 → 鸣谢」一致，由维护方单独更新。提交赞助记录不会自动列入。

目前暂无。

## 常见问题

**是否需要联网？**

阅读无需联网。导入完成后，离线与在线的阅读能力一致。朗读引擎仅在确认后下载。使用麦克风录制音色或导入已有 wav 时，数据仅保存在本机，不会上传。登录后使用自有声音建档时，录音将提交至账号服务以生成音色。

**书籍存储在哪里？**

书籍、阅读进度、书签与摘录均存储于当前设备。更换设备后需重新导入。可在「设置 → 数据」查看占用，也可清空全部本机数据。

**打开后出现乱码怎么办？**

多数 txt 会在导入时自动识别编码。若仍不正确，可在阅读页或设置中改为对应编码，无需重新选择文件。

**是否支持 EPUB 或 PDF？**

目前仅支持 txt。

**哪些系统支持朗读？**

目前为 macOS 桌面版。其他系统显示「朗读即将支持」。

**是否必须注册账号？**

阅读、本机录音与音色导入均无需账号。账号用于声音建档、提交赞助记录与修改口令。

## 参与

欢迎 [反馈问题](https://github.com/xingshanghe/x-book/issues) 或提交修改。

在本机运行开发版：

```bash
git clone https://github.com/xingshanghe/x-book.git
cd x-book
pnpm install
pnpm dev
```

浏览器访问 <http://localhost:5173>。各平台打包步骤见 [docs/build.md](./docs/build.md)。

## 致谢

阅读形态参考了 [易笺（SimpleTextReader）](https://github.com/henryxrl/SimpleTextReader)（@henryxrl，GPL-3.0）的公开资料。轻阅为独立实现，未使用其代码。

## 许可证

[MIT](./LICENSE) © 2026 CRAFTDEMAND
