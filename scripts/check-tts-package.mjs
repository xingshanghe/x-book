import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

const root = process.cwd()
const dist = path.join(root, 'dist')
const banned = ['encoder.int8.onnx', 'vocos_24khz.onnx', 'espeak-ng-data']

async function walk(dir, found) {
  let entries = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (banned.some((name) => full.includes(name))) found.push(full)
    if (entry.isDirectory()) await walk(full, found)
  }
}

const found = []
await walk(dist, found)
if (found.length > 0) {
  console.error(found.join('\n'))
  process.exit(1)
}

const html = await readFile(path.join(dist, 'index.html'), 'utf8').catch(() => '')
const entry = html.match(/src="\.\/assets\/(index-[^"]+\.js)"/)
if (!entry) {
  console.error('没有找到 dist/index.html 里的入口脚本，请先 pnpm build')
  process.exit(1)
}
const entryPath = path.join(dist, 'assets', entry[1])
const info = await stat(entryPath)
const entryGzip = info.size === 0 ? Number.MAX_SAFE_INTEGER : gzipSync(await readFile(entryPath)).length
const limit = 180 * 1024
if (entryGzip > limit) {
  console.error(`入口 JS gzip ${entryGzip} 超过 180KB`)
  process.exit(1)
}
console.log(`朗读包体检查通过，入口 JS gzip ${entryGzip} 字节`)
