/**
 * 资产装载：rawfile → 应用沙箱缓存目录。
 *
 * 为什么要复制一份：
 *   ArkWeb 直接加载 resource://rawfile 时，页面 origin 不稳定，
 *   IndexedDB / localStorage 可能被限制；复制到 filesDir 后用 file:// 加载，
 *   origin 固定，书籍与阅读进度才能正常持久化。
 *
 * 为什么用 dir.json（不以「.」开头）：
 *   HAP 打包会丢掉以「.」开头的文件（旧的 .dir.json），
 *   构建脚本为每个目录生成 dir.json 清单；原生端据此逐个拷出。
 *   getRawFileListSync 对「文件」路径会返回空数组而非抛错，
 *   不能用来判断目录，否则会把 index.html 建成空目录导致白屏。
 */

import fs from '@ohos.file.fs';
import { common } from '@kit.AbilityKit';
import { resourceManager } from '@kit.LocalizationKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

const TAG = 'QingYueLoad';
const RAW_ROOT = 'qy'; // rawfile/qy/**
const CACHE_DIR = 'qy'; // filesDir/qy/**
const MANIFEST = 'dir.json';

export class LoadResult {
  url: string = '';
  dir: string = '';
}

export class Load {
  /** 返回可直接加载的入口地址与沙箱目录（供 setPathAllowingUniversalAccess） */
  static async prepare(context: common.UIAbilityContext): Promise<LoadResult> {
    const target = `${context.filesDir}/${CACHE_DIR}`;
    if (!(await Load.isUpToDate(context, target))) {
      hilog.info(0x0000, TAG, '资产过期或不完整，开始复制 rawfile');
      await Load.copyAll(context, target);
    }
    const indexPath = `${target}/index.html`;
    if (!fs.accessSync(indexPath) || !Load.isRegularFile(indexPath)) {
      throw new Error('复制后仍缺少有效的 index.html');
    }
    const result = new LoadResult();
    result.url = `file://${indexPath}`;
    result.dir = target;
    return result;
  }

  private static async isUpToDate(context: common.UIAbilityContext, target: string): Promise<boolean> {
    try {
      const indexPath = `${target}/index.html`;
      if (!fs.accessSync(indexPath) || !Load.isRegularFile(indexPath)) return false;
      const marker = `${target}/web_version`;
      if (!fs.accessSync(marker) || !Load.isRegularFile(marker)) return false;
      const file = fs.openSync(marker, fs.OpenMode.READ_ONLY);
      const buf = new ArrayBuffer(64);
      const readLen = fs.readSync(file.fd, buf);
      fs.closeSync(file.fd);
      const prev = Load.utf8(new Uint8Array(buf, 0, readLen)).trim();
      const current = Load.version(context);
      return prev === current && prev.length > 0;
    } catch (_e) {
      return false;
    }
  }

  private static async copyAll(context: common.UIAbilityContext, target: string): Promise<void> {
    Load.removeTree(target);
    fs.mkdirSync(target, true);

    const rm = context.resourceManager;
    // 优先读 dir.json；若缺失再回退到 getRawFileList（并正确区分文件/目录）
    if (!Load.copyFromManifest(rm, RAW_ROOT, target)) {
      hilog.warn(0x0000, TAG, 'dir.json 不可用，回退 getRawFileList');
      Load.copyTree(rm, RAW_ROOT, target);
    }

    const indexPath = `${target}/index.html`;
    if (!fs.accessSync(indexPath) || !Load.isRegularFile(indexPath)) {
      throw new Error('资产复制不完整：缺少 index.html');
    }
    // 仅在入口文件就绪后落版本标记，避免半成品被当成“已同步”
    Load.write(`${target}/web_version`, Load.utf8Bytes(Load.version(context)));
    hilog.info(0x0000, TAG, `资产复制完成 → ${target}`);
  }

  /** 按 dir.json 清单拷贝；成功返回 true。 */
  private static copyFromManifest(
    rm: resourceManager.ResourceManager,
    rawPath: string,
    destPath: string
  ): boolean {
    const names = Load.readManifest(rm, `${rawPath}/${MANIFEST}`);
    if (names === null) return false;

    for (const name of names) {
      if (name === MANIFEST || name === '.dir.json' || name === 'web_version') continue;

      // 子目录记成 "assets/dir.json"
      if (name.endsWith(`/${MANIFEST}`)) {
        const dirName = name.slice(0, name.length - `/${MANIFEST}`.length);
        const childDest = `${destPath}/${dirName}`;
        fs.mkdirSync(childDest, true);
        if (!Load.copyFromManifest(rm, `${rawPath}/${dirName}`, childDest)) {
          hilog.error(0x0000, TAG, `子清单缺失 ${rawPath}/${dirName}/${MANIFEST}`);
        }
        continue;
      }

      // 兼容旧格式 "assets/.dir.json"
      if (name.endsWith('/.dir.json')) {
        const dirName = name.slice(0, name.length - '/.dir.json'.length);
        const childDest = `${destPath}/${dirName}`;
        fs.mkdirSync(childDest, true);
        if (!Load.copyFromManifest(rm, `${rawPath}/${dirName}`, childDest)) {
          hilog.error(0x0000, TAG, `子清单缺失 ${rawPath}/${dirName}`);
        }
        continue;
      }

      try {
        const content = rm.getRawFileContentSync(`${rawPath}/${name}`);
        Load.write(`${destPath}/${name}`, content);
      } catch (e) {
        hilog.error(0x0000, TAG, `复制失败 ${rawPath}/${name}: ${JSON.stringify(e)}`);
      }
    }
    return true;
  }

  /**
   * 回退路径：用 getRawFileList 枚举。
   * 注意：对文件调用 getRawFileListSync 会返回 []，必须再试 getRawFileContent。
   */
  private static copyTree(rm: resourceManager.ResourceManager, rawPath: string, destPath: string): void {
    let names: string[] = [];
    try {
      names = rm.getRawFileListSync(rawPath);
    } catch (e) {
      hilog.error(0x0000, TAG, `枚举 rawfile 失败 ${rawPath}: ${JSON.stringify(e)}`);
      return;
    }

    for (const name of names) {
      if (name === MANIFEST || name === '.dir.json' || name === 'web_version') continue;
      const childRaw = `${rawPath}/${name}`;
      const childDest = `${destPath}/${name}`;

      let listed = false;
      let subNames: string[] = [];
      try {
        subNames = rm.getRawFileListSync(childRaw);
        listed = true;
      } catch (_e) {
        listed = false;
      }

      if (listed && subNames.length > 0) {
        fs.mkdirSync(childDest, true);
        Load.copyTree(rm, childRaw, childDest);
        continue;
      }

      // listed && length===0：可能是空目录，也可能是文件 —— 先当文件读
      try {
        const content = rm.getRawFileContentSync(childRaw);
        Load.write(childDest, content);
      } catch (_fileErr) {
        if (listed) {
          fs.mkdirSync(childDest, true);
        } else {
          hilog.error(0x0000, TAG, `无法读取 ${childRaw}`);
        }
      }
    }
  }

  private static readManifest(rm: resourceManager.ResourceManager, rawPath: string): string[] | null {
    try {
      const raw = rm.getRawFileContentSync(rawPath);
      const parsed = JSON.parse(Load.utf8(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength))) as string[];
      return Array.isArray(parsed) ? parsed : null;
    } catch (_e) {
      return null;
    }
  }

  private static write(path: string, buf: ArrayBuffer | Uint8Array): void {
    const file = fs.openSync(path, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
    try {
      if (buf instanceof Uint8Array) {
        // 避免直接用 .buffer（可能是更大 ArrayBuffer 的视图）
        const slice = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        fs.writeSync(file.fd, slice);
      } else {
        fs.writeSync(file.fd, buf);
      }
    } finally {
      fs.closeSync(file.fd);
    }
  }

  private static removeTree(path: string): void {
    try {
      if (!fs.accessSync(path)) return;
    } catch (_e) {
      return;
    }
    try {
      const stat = fs.statSync(path);
      if (stat.isDirectory()) {
        const entries = fs.listFileSync(path);
        for (let i = 0; i < entries.length; i++) {
          Load.removeTree(`${path}/${entries[i]}`);
        }
        fs.rmdirSync(path);
      } else {
        fs.unlinkSync(path);
      }
    } catch (e) {
      hilog.warn(0x0000, TAG, `清理失败 ${path}: ${JSON.stringify(e)}`);
    }
  }

  private static isRegularFile(path: string): boolean {
    try {
      return fs.statSync(path).isFile();
    } catch (_e) {
      return false;
    }
  }

  private static version(context: common.UIAbilityContext): string {
    try {
      return context.resourceManager.getStringByNameSync('web_version');
    } catch (_e) {
      return '0';
    }
  }

  private static utf8Bytes(s: string): Uint8Array {
    const out: number[] = [];
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
    return new Uint8Array(out);
  }

  private static utf8(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i++) {
      s += String.fromCharCode(bytes[i]);
    }
    try {
      return decodeURIComponent(escape(s));
    } catch (_e) {
      return s.replace(/\0/g, '');
    }
  }
}
