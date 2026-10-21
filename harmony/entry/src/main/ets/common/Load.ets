/**
 * 资产装载：rawfile → 应用沙箱缓存目录。
 *
 * 为什么要复制一份：
 *   ArkWeb 直接加载 resource://rawfile 时，页面 origin 不稳定，
 *   IndexedDB / localStorage 可能被限制；复制到 filesDir 后用 file:// 加载，
 *   origin 固定，书籍与阅读进度才能正常持久化。
 *
 * 为什么需要 .dir.json：
 *   ArkWeb 的 resourceManager 无法枚举 rawfile 的子目录，
 *   因此构建脚本（scripts/build-harmony-assets.mjs）为每个目录生成一份清单，
 *   原生端据此逐个拷出；version 变化时才重新复制。
 */

import fs from '@ohos.file.fs';
import { common } from '@kit.AbilityKit';
import { resourceManager } from '@kit.LocalizationKit';

const RAW_ROOT = 'qy'; // rawfile/qy/**
const CACHE_DIR = 'qy'; // filesDir/qy/**

export class Load {
  /** 返回可直接加载的入口地址（file://沙箱路径） */
  static async prepare(context: common.UIAbilityContext): Promise<string> {
    const target = `${context.filesDir}/${CACHE_DIR}`;
    if (!(await Load.isUpToDate(context, target))) {
      await Load.copyAll(context, target);
    }
    return `file://${target}/index.html`;
  }

  private static async isUpToDate(context: common.UIAbilityContext, target: string): Promise<boolean> {
    try {
      if (!fs.accessSync(`${target}/index.html`)) return false;
      const marker = `${target}/.version`;
      if (!fs.accessSync(marker)) return false;
      const fd = fs.openSync(marker, fs.OpenMode.READ_ONLY);
      const buf = new ArrayBuffer(64);
      fs.readSync(fd, buf);
      fs.closeSync(fd);
      const prev = Load.utf8(new Uint8Array(buf)).trim();
      const current = Load.version(context);
      return prev === current;
    } catch (e) {
      return false;
    }
  }

  private static async copyAll(context: common.UIAbilityContext, target: string): Promise<void> {
    try {
      fs.rmdirSync(target);
    } catch (e) {
      // 目录不存在，忽略
    }
    fs.mkdirSync(target, true);

    const rm = context.resourceManager;
    const root = Load.readManifest(rm, `${RAW_ROOT}/.dir.json`);
    for (const name of root) {
      if (name.endsWith('/.dir.json')) {
        const dirName = name.slice(0, name.length - '/.dir.json'.length);
        const dir = `${target}/${dirName}`;
        fs.mkdirSync(dir, true);
        for (const child of Load.readManifest(rm, `${RAW_ROOT}/${name}`)) {
          Load.write(`${dir}/${child}`, rm.getRawFileContentSync(`${RAW_ROOT}/${dirName}/${child}`));
        }
      } else {
        Load.write(`${target}/${name}`, rm.getRawFileContentSync(`${RAW_ROOT}/${name}`));
      }
    }

    Load.write(`${target}/.version`, Load.utf8Bytes(Load.version(context)));
  }

  private static readManifest(rm: resourceManager.ResourceManager, rawPath: string): string[] {
    try {
      const raw = rm.getRawFileContentSync(rawPath);
      return JSON.parse(Load.utf8(new Uint8Array(raw))) as string[];
    } catch (e) {
      console.error(`[qingyue] 读取清单失败 ${rawPath}`);
      return [];
    }
  }

  private static write(path: string, buf: ArrayBuffer | Uint8Array): void {
    const fd = fs.openSync(path, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
    fs.writeSync(fd, buf instanceof Uint8Array ? buf.buffer : buf);
    fs.closeSync(fd);
  }

  private static version(context: common.UIAbilityContext): string {
    try {
      return context.resourceManager.getStringByNameSync('web_version');
    } catch (e) {
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
    for (const b of bytes) s += String.fromCharCode(b);
    try {
      return decodeURIComponent(escape(s));
    } catch (e) {
      return s.replace(/\0/g, '');
    }
  }
}
