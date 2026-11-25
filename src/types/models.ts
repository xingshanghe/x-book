/**
 * 轻阅 · 领域模型
 * 本文件只允许类型定义，不得包含运行时逻辑。
 */

export type BookEncoding = 'utf-8' | 'gb18030' | 'big5' | 'utf-16le' | 'utf-16be';

export type BookStatus = 'indexing' | 'ready' | 'error';

export type ReadState = 'reading' | 'unread' | 'finished';

/** txt = 纯文本；pdf = 扫描版/连环画（按页渲染） */
export type BookKind = 'txt' | 'pdf';

/** 连环画适屏：宽 / 高 / 整页 */
export type ComicFitMode = 'fitWidth' | 'fitHeight' | 'fitPage';

export interface Book {
  id: string;
  title: string;
  author?: string;

  /** 缺省按 txt（兼容旧库） */
  kind?: BookKind;
  /** PDF 总页数；txt 为 0 */
  pageCount?: number;
  /** 是否已生成首页封面缩略图 */
  hasCover?: boolean;

  size: number; // 归一化后字节数（txt 为正文；pdf 为原文件）
  encoding: BookEncoding;
  fingerprint: string; // 去重：size + 前 64KB 哈希

  /** 每本书独立的清理规则快照（导入生效），null 表示不清洗 */
  cleanRuleId?: string;

  blockSize: number;
  blockCount: number;
  charCount: number;
  lineCount: number;
  chapterCount: number;

  cleanedLines: number; // 广告清洗命中行数
  footnoteCount: number; // 脚注对数

  status: BookStatus;
  indexProgress: number; // 0–1
  errorMessage?: string;

  group?: string;
  finished: boolean;

  createdAt: number;
  lastOpenedAt?: number;
  finishedAt?: number;

  coverHue: number; // 自动封面色相，由 fingerprint 派生，跨主题稳定
}

export interface Chapter {
  bookId: string;
  index: number;
  title: string;
  /** 书名页/目录引发的简化名，渲染层用 */
  shortTitle?: string;
  blockIndex: number;
  /** 标题行在该块内的行号 */
  lineInBlock: number;
  charOffset: number;
  /** 本章覆盖的字符区间（右开），用于进度与搜索定位 */
  charEnd?: number;
  level: number;
}

/** 打包的块索引（typed array 直存 IndexedDB，100MB 约 77KB） */
export interface BlockIndex {
  bookId: string;
  blockSize: number;
  count: number;
  /** 每块起始字节偏移，长度 count+1（末元素为文件总长） */
  starts: Uint32Array;
  /** 每块字符数（码点数，非字节） */
  charCounts: Uint32Array;
  /** 每块累计字符偏移前缀和，长度 count，用于 percent 换算 */
  charOffsets: Uint32Array;
  /** 每块物理行数 */
  lineCounts: Uint32Array;
}

export interface Progress {
  bookId: string;
  chapterIndex: number;
  /**
   * txt：块下标；pdf：0-based 页码（pageIndex）。
   * 不另开字段，避免旧进度记录失效。
   */
  blockIndex: number;
  lineInBlock: number;
  /** txt：全书字符偏移；pdf：与 blockIndex 相同的页码 */
  charOffset: number;
  /** 0–1 */
  percent: number;
  updatedAt: number;
  deviceId: string;
}

export type BookmarkKind = 'bookmark' | 'extract';

export interface Bookmark {
  id: string;
  bookId: string;
  kind: BookmarkKind;
  chapterIndex: number;
  blockIndex: number;
  lineInBlock: number;
  charOffset: number;
  /** 摘录文本；书签为光标处前后各 24 字 */
  text: string;
  note?: string;
  color?: 'seal' | 'jade' | 'indigo';
  createdAt: number;
}

export interface FootnoteEntry {
  marker: string;
  blockIndex: number;
  lineInBlock: number;
  text: string;
}

/* ============================ 设置 ============================ */

export type ThemeName = 'day' | 'night' | 'sepia';
export type ThemeMode = 'system' | 'day' | 'night' | 'sepia';

export type BodyFont = 'kai' | 'serif' | 'sans' | string; // string 为用户自备字体族名

export interface Typography {
  fontSize: number; // px
  lineHeight: number; // 倍数
  paragraphSpacing: number; // em
  letterSpacing: number; // em
  textIndent: number; // em
  maxWidth: number; // ch
  textAlign: 'start' | 'justify';
}

export interface AppSettings {
  key: 'default';
  schemaVersion: number;

  themeMode: ThemeMode;
  bodyFont: BodyFont;
  headingFont: BodyFont | 'auto';
  typography: Typography;

  pageMode: 'scroll' | 'page';
  /** TXT 目录 / PDF 缩略图常驻左侧（不遮罩正文），可随时收起 */
  tocDocked: boolean;
  flipAnimation: boolean;
  showTitlePage: boolean;
  showProgressHints: boolean;
  keepScreenAwake: boolean;

  detectChapters: boolean;
  customChapterPattern?: string;
  cleanAds: boolean;
  cleanRules: CleanRule[];
  detectFootnotes: boolean;

  sortMode: ShelfSort;
  shelfDensity: 'comfortable' | 'compact';
  /** 书架自定义分组目录（有序；可含尚无书的空组） */
  shelfGroups: string[];

  enableShortcuts: boolean;
  tapToTurn: boolean;
  volumeToTurn: boolean;
  /** 双击正文开启自动滚动时的速度（行/分钟） */
  autoScrollLpm: number;

  /** 连环画默认适屏模式 */
  comicFitMode: ComicFitMode;

  storagePersisted: boolean;
  deviceId: string;
}

export type ShelfSort = 'recent' | 'title' | 'added' | 'progress' | 'author';

export interface CleanRule {
  id: string;
  name: string;
  enabled: boolean;
  /** 行级正则（全局忽略大小写），命中则该行被剔除或替换 */
  pattern: string;
  flags?: string;
  replaceTo?: string;
  builtin?: boolean;
}

/* ============================ 同步（可选能力） ============================ */

export type SyncState = 'disabled' | 'probing' | 'online' | 'degraded' | 'error';

export interface SyncOp {
  id: string;
  entity: 'progress' | 'bookmark' | 'settings' | 'book';
  entityId: string;
  op: 'put' | 'delete';
  payload?: unknown;
  updatedAt: number;
}

export interface SyncPayload {
  serverTime: number;
  ops: SyncOp[];
}

export interface SyncStatus {
  state: SyncState;
  adapterId: string;
  lastOkAt?: number;
  lastError?: string;
  pendingOps: number;
}
