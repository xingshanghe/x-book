/**
 * 把 Web 产物同步到 HarmonyOS 工程的 rawfile 目录。
 *
 * 原生端按 dir.json 清单拷贝（不以「.」开头，避免 HAP 打包丢掉）。
 * 同时去掉 file:// 下易触发 CORS 的 crossorigin，以及不需要的 Service Worker。
 *
 * 用法： node scripts/build-harmony-assets.mjs
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const target = join(root, 'harmony', 'entry', 'src', 'main', 'resources', 'rawfile', 'qy');

if (!existsSync(dist)) {
  console.error('找不到 dist/，请先执行 npm run build');
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(dist, target, { recursive: true });

/**
 * ArkWeb 对 file:// 下带 crossorigin 的 module 脚本常会拦 CORS；
 * 鸿蒙外壳不需要 Service Worker，去掉相关引用以免干扰首屏。
 */
const indexPath = join(target, 'index.html');
if (existsSync(indexPath)) {
  let html = readFileSync(indexPath, 'utf8');
  html = html.replace(/\s+crossorigin(="[^"]*")?/g, '');
  html = html.replace(/<link[^>]+rel="manifest"[^>]*>/i, '');
  // modulepreload 在部分 ArkWeb 上仍会触发跨域探测；保留主 script/css 即可
  html = html.replace(/<link[^>]+rel="modulepreload"[^>]*>/gi, '');
  // 启动探针 + 全局错误捕获，便于 hilog 定位白屏；
  // 同时在首帧前写死鸿蒙安全区（ArkWeb 的 env(safe-area-*) / calc(var()) 不可靠）
  if (!html.includes('[qingyue] boot')) {
    html = html.replace(
      '<script type="module"',
      `<style id="qy-harmony-safe">
html[data-arkweb="1"] .shelf-top{padding-top:72px!important}
html[data-arkweb="1"] .settings-top{padding-top:72px!important}
html[data-arkweb="1"] .reader-bar.top{padding-top:64px!important}
html[data-arkweb="1"]{--safe-t:56px;--safe-b:20px}
</style>
    <script>
      window.__qyErr = null;
      window.__QY_HARMONY__ = true;
      (function () {
        var el = document.documentElement;
        el.dataset.os = 'harmony';
        el.dataset.arkweb = '1';
        el.style.setProperty('--safe-t', '56px');
        el.style.setProperty('--safe-b', '20px');
      })();
      window.addEventListener('error', function (e) {
        window.__qyErr = String(e.message || e.error || e);
        console.log('[qy-err]', window.__qyErr, e.filename, e.lineno);
      });
      window.addEventListener('unhandledrejection', function (e) {
        window.__qyErr = String(e.reason && e.reason.message ? e.reason.message : e.reason);
        console.log('[qy-rej]', window.__qyErr);
      });
      console.log('[qingyue] boot');
    </script>
    <script type="module"`,
    );
  }
  writeFileSync(indexPath, html);
}
for (const name of ['sw.js', 'workbox-9c191d2f.js', 'manifest.webmanifest']) {
  const p = join(target, name);
  if (existsSync(p)) rmSync(p, { force: true });
}
// workbox 文件名会带 hash，按前缀清
for (const entry of readdirSync(target)) {
  if (entry.startsWith('workbox-') && entry.endsWith('.js')) {
    rmSync(join(target, entry), { force: true });
  }
  if (entry === 'sw.js' || entry.endsWith('.webmanifest')) {
    rmSync(join(target, entry), { force: true });
  }
}

/**
 * 为每个目录生成 dir.json：
 *   - 文件：直接记名字；
 *   - 目录：记成 `<目录名>/dir.json`，原生端据此递归展开。
 */
function manifest(dir) {
  const names = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'dir.json' || entry.name === '.dir.json') continue;
    if (entry.isDirectory()) {
      manifest(join(dir, entry.name));
      if (readdirSync(join(dir, entry.name)).length === 0) continue;
      names.push(`${entry.name}/dir.json`);
    } else {
      names.push(entry.name);
    }
  }
  writeFileSync(join(dir, 'dir.json'), JSON.stringify(names));
}
manifest(target);

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const stringJson = join(root, 'harmony', 'entry', 'src', 'main', 'resources', 'base', 'element', 'string.json');
const s = JSON.parse(readFileSync(stringJson, 'utf8'));
// 带修复后缀，强制已安装用户重新拷贝沙箱资产（修空白目录 / 旧 CORS 缓存）
const webVersion = `${pkg.version}-h10`;
s.string = s.string.map((x) => (x.name === 'web_version' ? { ...x, value: webVersion } : x));
writeFileSync(stringJson, `${JSON.stringify(s, null, 2)}\n`);

console.log(`已同步 ${relative(root, dist)} → ${relative(root, target)} （版本 ${webVersion}）`);
console.log('下一步：用 DevEco Studio 打开 harmony/ 目录，Build > Build Hap(s)/APP(s) > Build APP(s)');
