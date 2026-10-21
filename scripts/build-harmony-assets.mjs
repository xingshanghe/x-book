/**
 * 把 Web 产物同步到 HarmonyOS 工程的 rawfile 目录。
 *
 * ArkWeb 的 sourceManager 只能按文件名读取 rawfile（无法列目录），
 * 因此子目录统一生成一份 `.dir.json` 清单，原生端据此逐个拷出。
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
 * 说明：ArkWeb 的 resourceManager 不支持枚举 rawfile 子目录，
 * 所以这里为每个目录（含根目录）生成 `.dir.json` 清单：
 *   - 文件：直接记名字；
 *   - 目录：记成 `<目录名>/.dir.json`，原生端据此递归展开。
 */
function manifest(dir) {
  const names = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.endsWith('.dir.json')) continue;
    if (entry.isDirectory()) {
      manifest(join(dir, entry.name));
      if (readdirSync(join(dir, entry.name)).length === 0) continue;
      names.push(`${entry.name}/.dir.json`);
    } else {
      names.push(entry.name);
    }
  }
  writeFileSync(join(dir, '.dir.json'), JSON.stringify(names));
}
manifest(target);

// 同步版本号到 string.json（原生端用它判断是否需要重新复制资产）
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const stringJson = join(root, 'harmony', 'entry', 'src', 'main', 'resources', 'base', 'element', 'string.json');
const s = JSON.parse(readFileSync(stringJson, 'utf8'));
s.string = s.string.map((x) => (x.name === 'web_version' ? { ...x, value: pkg.version } : x));
writeFileSync(stringJson, `${JSON.stringify(s, null, 2)}\n`);

console.log(`已同步 ${relative(root, dist)} → ${relative(root, target)} （版本 ${pkg.version}）`);
console.log('下一步：用 DevEco Studio 打开 harmony/ 目录，Build > Build Hap(s)/APP(s) > Build APP(s)');
