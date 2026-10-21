/**
 * 把 Tauri 产出的 .app 打成可直接分发的 macOS 产物。
 *
 * 为什么不用 tauri build --bundles dmg：
 *   它内部的 bundle_dmg.sh 需要先 mount 到 /Volumes/<产品名>，
 *   在没有管理员权限的机器上会报「hdiutil: create failed - 操作不被允许」。
 *   而 `hdiutil create -srcfolder` 直接由目录生成镜像，不需要挂载，成功率更高。
 *   CI（GitHub macos runner）有完整权限，仍走官方 tauri-action 产出 dmg。
 *
 * 用法： node scripts/pack-macos.mjs
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundleDir = process.env.TAURI_BUNDLE_DIR ?? join(root, '.cargo-target', 'release', 'bundle');
const macosDir = join(bundleDir, 'macos');
const outDir = join(root, 'release');

if (!existsSync(macosDir)) {
  console.error(`找不到 macOS 产物：${macosDir}\n请先执行 npm run tauri build -- --bundles app`);
  process.exit(1);
}

const appName = readdirSync(macosDir).find((n) => n.endsWith('.app'));
if (!appName) {
  console.error('bundle/macos 下没有 .app');
  process.exit(1);
}
const appPath = join(macosDir, appName);
const base = appName.replace(/\.app$/, '');
const version = process.env.QY_VERSION ?? '1.0.0';

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// 1) zip：方便内网分发与 CI 直接下载
const zip = join(outDir, `${base}-${version}-macos-aarch64.zip`);
execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, zip]);
console.log(`✓ zip  ${zip}`);

// 2) dmg： staging 目录里放 .app + /Applications 快捷方式
const staging = join(root, '.dmg-staging');
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
cpSync(appPath, join(staging, appName), { recursive: true });
symlinkSync('/Applications', join(staging, 'Applications'));

const dmg = join(outDir, `${base}-${version}-aarch64.dmg`);
execFileSync('hdiutil', ['create', '-volname', base, '-srcfolder', staging, '-ov', '-format', 'UDZO', dmg], {
  stdio: ['ignore', 'ignore', 'pipe'],
});
rmSync(staging, { recursive: true, force: true });
console.log(`✓ dmg  ${dmg}`);
