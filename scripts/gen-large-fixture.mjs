/** 生成大体积测试文件：node scripts/gen-large-fixture.mjs [MB] [out] */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mb = Number(process.argv[2] ?? 100);
const out = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../tests/fixtures/large-100mb.txt',
).replace('large-100mb.txt', `large-${mb}mb.txt`);

const chapterTmpl = (i) => `第${i}章 夜行人\n`;
const paraTmpl = (i, j) =>
  `　　风把巷口的灯笼吹得摇晃，第${i}章里的人物第${j}次走过青石板。他数着自己的脚步，像数着那些年欠下的债。远处传来打更的声音，一声，又一声，仿佛要把这长夜敲出裂缝来。\n`;

mkdirSync(dirname(out), { recursive: true });

const TARGET = mb * 1024 * 1024;
let buf = '';
let written = 0;
let i = 1;
const start = Date.now();

// 分批写入，避免一次性构造巨大字符串
const fs = await import('node:fs');
const stream = fs.createWriteStream(out, { encoding: 'utf-8' });

function nextChunk() {
  buf = '';
  while (buf.length < 1024 * 1024) {
    buf += chapterTmpl(i);
    for (let j = 0; j < 40; j++) buf += paraTmpl(i, j);
    i++;
  }
  return buf;
}

let bytes = 0;
while (bytes < TARGET) {
  const chunk = nextChunk();
  bytes += Buffer.byteLength(chunk);
  if (!stream.write(chunk)) {
    await new Promise((r) => stream.once('drain', r));
  }
}
stream.end();
await new Promise((r) => stream.end(r));

console.log(`生成 ${out} · ${mb}MB · ${i - 1} 章 · ${((Date.now() - start) / 1000).toFixed(1)}s`);
