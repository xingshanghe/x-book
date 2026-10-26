<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
  <img src="docs/assets/logo.svg" alt="轻阅 QINGYUE" width="340">
</picture>

**免费、开源的本地 txt 阅读器。**

翻开就读。书在你自己的设备上，断网也能从头读到尾。

[![Release](https://img.shields.io/github/v/release/xingshanghe/x-book?label=release&color=B44326)](https://github.com/xingshanghe/x-book/releases/latest)
[![Platforms](https://img.shields.io/badge/platform-Web%20%7C%20macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20Android%20%7C%20iOS%20%7C%20HarmonyOS-3E5C97)](https://github.com/xingshanghe/x-book/releases)
[![License](https://img.shields.io/badge/license-MIT-746851)](./LICENSE)

[下载](#下载) · [开始使用](#开始使用) · [功能](#功能) · [常见问题](#常见问题)

</div>

---

轻阅用来读纯文本小说和文稿。导入之后，书架、目录、进度、书签和排版都留在这台设备上，不需要注册，也不需要一直连着网。

手机、平板和电脑都能用。界面按纸页来排：封面、扉页、目录和页码都在，字号、行距和主题可以按自己的习惯调。

## 功能

**书架**

- 拖入 txt，或从文件里选择导入
- 常见中文编码可以直接打开
- 按书名、作者搜索
- 按最近在读、加入时间、书名、作者或进度排序
- 首页留着「继续阅读」，打开就是上次停下的地方
- 可以标记读完，也可以从书架删除

**阅读**

- 翻页或上下滚动
- 自动分章，目录可以一直留在左侧
- 全书搜索
- 书签，以及把当前这段收成摘录
- 可选的扉页
- 文中注释可以点开
- 导入时可以去掉网文里常见的广告行，也可以自己加规则

**排版**

- 纸黄、宣纸、黛蓝三种主题，也可以跟随系统
- 字号、行距、段距、缩进和版心宽度
- 楷体、衬线、黑体，或装入自己的字体
- 手机、平板、电脑各自有合适的版面

**朗读**

macOS 桌面版可以在设置里单独下载朗读引擎，安装包本身不附带它。

- 从当前这一屏往下读，停下之后可以从那一句继续
- 语速、句间和段间停顿可以调
- 可以导入已有音色；登录账号后，也可以用自己的声音建档
- 已经保存在本机的音色，不登录也能继续用来朗读

## 下载

到 [最新发布](https://github.com/xingshanghe/x-book/releases/latest) 选择对应系统的安装包。

| 系统 | 文件 | 安装 |
|---|---|---|
| macOS | `qingyue-<版本>-macos-universal.dmg` | Intel 与 Apple 芯片通用。打开后拖进「应用程序」 |
| Windows | `qingyue-<版本>-windows-x86_64-setup.exe` | 运行安装程序 |
| Linux | `qingyue-<版本>-linux-x86_64.deb` | Debian、Ubuntu 等系统直接安装 |
| Linux | `qingyue-<版本>-linux-x86_64.AppImage` | 赋予执行权限后即可打开，不必安装 |
| Android | `qingyue-<版本>-android-universal.apk` | 下载后安装。若系统拦截未知来源，按提示允许 |
| iOS | `qingyue-<版本>-ios-unsigned.zip` | 目前未签名，需要自行签名后安装 |
| 鸿蒙 | `qingyue-<版本>-harmony-unsigned.app` | 需要在本机用 DevEco Studio 打包 |
| 网页 | `qingyue-web-<版本>.zip` | 解压后放到网站上用浏览器打开，也可以安装到桌面或主屏幕 |

个人使用，直接下载对应系统的安装包即可。

## 开始使用

1. 安装并打开轻阅。
2. 把 txt 拖进窗口，或点右下角的 **+** 导入。
3. 点开一本书。下次再来，书架上的「继续阅读」会回到上次的位置。

阅读时，左侧是目录。底部可以翻页、搜索、加书签、调排版、切换昼夜，以及开始朗读。点屏幕中间，显示或隐藏顶栏和底栏；点左右两侧翻页。

设置从书架右上角的齿轮进入，可以改主题、阅读习惯、字体和朗读。

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

## 常见问题

**需要联网吗？**

读书不需要。导入完成后，断网和有网是一样的。朗读引擎和声音建档是另外两件事：引擎在你确认后才会下载；用自己的声音建档时，录音会提交到账号服务，用来生成音色。直接导入的音色文件保存在本机。

**书存在哪里？**

书籍、阅读进度、书签和摘录都在当前这台设备上。换一台设备，需要重新导入。在「设置 → 数据」里可以查看占用，也可以清空全部本机数据。

**打开是乱码怎么办？**

多数 txt 会在导入时自动识别编码。如果仍不对，可以在阅读页或设置里改成正确的编码，不必重新选文件。

**支持 EPUB 或 PDF 吗？**

目前只读 txt。

**哪些系统可以朗读？**

目前是 macOS 桌面版。其他系统上会看到「朗读即将支持」。

**一定要注册账号吗？**

读书不用。账号只用于声音建档，以及修改口令。

## 参与

欢迎 [反馈问题](https://github.com/xingshanghe/x-book/issues) 或提交修改。

想在本机运行开发版：

```bash
git clone https://github.com/xingshanghe/x-book.git
cd x-book
pnpm install
pnpm dev
```

浏览器打开 <http://localhost:5173>。各系统打包步骤见 [docs/build.md](./docs/build.md)。

## 致谢

阅读形态参考了 [易笺（SimpleTextReader）](https://github.com/henryxrl/SimpleTextReader)（@henryxrl，GPL-3.0）的公开资料。轻阅是独立实现，没有使用其代码。

## 许可证

[MIT](./LICENSE) © 2026 CRAFTDEMAND
