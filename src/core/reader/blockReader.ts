/**
 * 块读取器：按块 slice + 解码 + LRU 缓存。
 * 内存上限 = LRU 容量 × 单块字符数（16KB 块 ≈ 5,300 字），与书的大小无关。
 */

export interface BlockSource {
  /** 归一化 UTF-8 文件体 */
  blob: Blob;
  blockSize: number;
  blockCount: number;
  starts: Uint32Array;
  hidden?: Map<number, number[]>;
}

interface Entry {
  text: string[];
  /** 已剔除清洗行后的可见行 */
  bytes: number;
  tick: number;
}

export class BlockReader {
  private cache = new Map<number, Entry>();
  private tick = 0;
  private readonly capacity: number;
  private decoding = new Map<number, Promise<string[]>>();

  constructor(private source: BlockSource, capacity = 24) {
    this.capacity = capacity;
  }

  get blockCount(): number {
    return this.source.blockCount;
  }

  blockEnd(i: number): number {
    const { starts } = this.source;
    return i + 1 < starts.length ? starts[i + 1] : this.source.blob.size;
  }

  /** 读取并解码一块，返回可见行数组（空行保留为 ''，清洗行已剔除） */
  async readLines(blockIndex: number): Promise<string[]> {
    const hit = this.cache.get(blockIndex);
    if (hit) {
      hit.tick = ++this.tick;
      return hit.text;
    }

    const inflight = this.decoding.get(blockIndex);
    if (inflight) return inflight;

    const p = this.decode(blockIndex).finally(() => this.decoding.delete(blockIndex));
    this.decoding.set(blockIndex, p);
    return p;
  }

  private async decode(blockIndex: number): Promise<string[]> {
    const { blob, starts } = this.source;
    if (blockIndex < 0 || blockIndex >= this.source.blockCount) return [];

    const start = starts[blockIndex];
    const end = this.blockEnd(blockIndex);
    const buf = await blob.slice(start, end).arrayBuffer();
    const text = new TextDecoder('utf-8').decode(buf);

    let lines = text.split('\n');
    // 文件末尾若以 \n 结尾会多出一个空行
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    lines = lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));

    const hidden = this.source.hidden?.get(blockIndex);
    if (hidden && hidden.length) {
      const drop = new Set(hidden);
      lines = lines.filter((_, i) => !drop.has(i));
    }

    this.put(blockIndex, { text: lines, bytes: end - start, tick: ++this.tick });
    return lines;
  }

  private put(k: number, v: Entry): void {
    if (this.cache.size >= this.capacity) {
      // O(n) 驱逐即可：容量只有 24
      let oldestKey = -1;
      let oldestTick = Infinity;
      for (const [key, e] of this.cache) {
        if (e.tick < oldestTick) {
          oldestTick = e.tick;
          oldestKey = key;
        }
      }
      if (oldestKey >= 0) this.cache.delete(oldestKey);
    }
    this.cache.set(k, v);
  }

  clear(): void {
    this.cache.clear();
    this.decoding.clear();
  }

  get memoryEstimate(): number {
    let chars = 0;
    for (const e of this.cache.values()) chars += e.bytes;
    return chars;
  }
}
