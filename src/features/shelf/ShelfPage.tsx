/** 书架页：导入、网格、继续阅读、搜索、排序、自定义分组 */

import {
  type DragEvent as ReactDragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation } from 'wouter';
import { accountSession } from '@/account/session';
import { useSettings } from '@/app/store';
import { APP_VERSION } from '@/app/version';
import { useImportQueue } from '@/features/import/importQueue';
import { useAccountProfile } from '@/features/settings/useAccountProfile';
import { isPdfBook } from '@/lib/bookKind';
import {
  formatBytes,
  formatChars,
  formatPages,
  formatPercent,
  formatRelative,
  formatRemaining,
} from '@/lib/format';
import { coverHue } from '@/lib/id';
import { deleteBook, listBooks, touchBook } from '@/storage/repositories/bookRepo';
import { allProgress } from '@/storage/repositories/progressRepo';
import {
  type CloudBookMeta,
  cloudConfigReady,
  cloudOpsReady,
  deleteCloudBook,
  downloadByFingerprint,
  listRemoteBooks,
  readCloudConfig,
  uploadBook,
} from '@/sync/cloudBooks';
import type { Book, ShelfSort } from '@/types/models';
import { Button, EmptyState, Menu, Progress, Segmented, useToast } from '@/ui';
import {
  IconChevronRight,
  IconClose,
  IconCloudDown,
  IconCloudUp,
  IconGear,
  IconMore,
  IconPlus,
  IconSearch,
  LogoMark,
} from '@/ui/icons';
import { BookCover } from './BookCover';
import {
  addGroupToCatalog,
  BOOK_DRAG_MIME,
  encodeBookDragPayload,
  filterBooksByGroup,
  groupSectionTitle,
  listShelfGroups,
  normalizeGroupName,
  parseBookDragPayload,
  removeGroupFromCatalog,
  renameGroupInCatalog,
  resolveDragBookIds,
  type ShelfGroupFilter,
} from './groups';
import { ImportTray, useDropImport } from './ImportDropzone';
import { ShelfAccount } from './ShelfAccount';
import './shelf.css';

const SORTS: { value: ShelfSort; label: string }[] = [
  { value: 'recent', label: '最近在读' },
  { value: 'added', label: '加入时间' },
  { value: 'title', label: '书名' },
  { value: 'author', label: '作者' },
  { value: 'progress', label: '进度' },
];

export function ShelfPage() {
  const [, navigate] = useLocation();
  const toast = useToast().push;
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const profile = useAccountProfile();
  /** 启用云书架且已登录 → 才显示/允许上传下载 */
  const cloudOps = cloudOpsReady(readCloudConfig(), Boolean(profile));
  const [books, setBooks] = useState<Book[] | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Book | null>(null);
  /** 删除确认框：「从云端删除」勾选；默认不勾，只删本地 */
  const [deleteFromCloud, setDeleteFromCloud] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [groupMutating, setGroupMutating] = useState(false);
  const [percentMap, setPercentMap] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState<ShelfGroupFilter>('all');
  /** 移到分组对话框目标（支持多本） */
  const [moveTargets, setMoveTargets] = useState<Book[] | null>(null);
  const [pendingDeleteGroup, setPendingDeleteGroup] = useState<string | null>(null);
  /** Tauri / WKWebView 无 window.prompt，分组命名一律走应用内对话框 */
  const [nameDialog, setNameDialog] = useState<null | {
    mode: 'create' | 'rename' | 'moveCreate';
    value: string;
  }>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  /** 拖放到芯片时的高亮目标：'ungrouped' | 组名 */
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [draggingBook, setDraggingBook] = useState(false);
  const [dropProps, dropping] = useDropImport();
  const fileInput = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const tasks = useImportQueue((s) => s.tasks);
  /** fingerprint → 云端 meta；未启用或失败时为空 */
  const [remoteMap, setRemoteMap] = useState<Map<string, CloudBookMeta>>(() => new Map());
  const [cloudBusy, setCloudBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [list, prog] = await Promise.all([listBooks(), allProgress()]);
    const map: Record<string, number> = {};
    for (const p of prog) map[p.bookId] = p.percent;
    setPercentMap(map);
    setBooks(list);
  }, []);

  const refreshCloud = useCallback(async () => {
    if (!cloudConfigReady(readCloudConfig())) {
      setRemoteMap(new Map());
      return;
    }
    if (accountSession.hasStoredSession() && !accountSession.client().accessToken()) {
      await accountSession.restore();
    }
    if (!accountSession.client().accessToken()) {
      setRemoteMap(new Map());
      return;
    }
    const remote = await listRemoteBooks();
    setRemoteMap(remote);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 进入书架 / 登录态变化时拉云端清单（不轮询）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 登录切换需重拉，refreshCloud 闭包读的是 session 而非 profile
  useEffect(() => {
    void refreshCloud();
  }, [refreshCloud, profile?.id]);

  // 导入任务完成后刷新书架
  useEffect(() => {
    if (tasks.some((t) => t.status === 'done')) {
      void reload();
      void refreshCloud();
    }
  }, [tasks, reload, refreshCloud]);

  const localFingerprints = useMemo(() => {
    const set = new Set<string>();
    for (const b of books ?? []) set.add(b.fingerprint);
    return set;
  }, [books]);

  const cloudOnly = useMemo(() => {
    if (!cloudOps) return [] as CloudBookMeta[];
    // 仅在「全部」或搜索时展示仅云端书，避免打乱分组
    if (activeGroup !== 'all') return [] as CloudBookMeta[];
    const q = query.trim().toLowerCase();
    const list: CloudBookMeta[] = [];
    for (const [fp, meta] of remoteMap) {
      if (localFingerprints.has(fp)) continue;
      if (
        q &&
        !(meta.title ?? '').toLowerCase().includes(q) &&
        !(meta.author ?? '').toLowerCase().includes(q)
      ) {
        continue;
      }
      list.push(meta);
    }
    return list.sort((a, b) => (b.uploadedAt ?? 0) - (a.uploadedAt ?? 0));
  }, [cloudOps, remoteMap, localFingerprints, activeGroup, query]);

  const cloudGateToast = () => {
    if (!cloudConfigReady(readCloudConfig())) {
      toast('请先在「同步」里启用云书架', 'warn');
    } else {
      toast('请先登录账号', 'warn');
    }
  };

  const onUpload = async (book: Book) => {
    if (cloudBusy) return;
    if (!cloudOps) {
      cloudGateToast();
      return;
    }
    setCloudBusy(book.fingerprint);
    try {
      await uploadBook(book.id);
      toast('已上传到云端', 'ok');
      await refreshCloud();
    } catch (err) {
      toast(err instanceof Error ? err.message : '上传失败', 'warn');
    } finally {
      setCloudBusy(null);
    }
  };

  const onDownload = async (meta: CloudBookMeta) => {
    if (cloudBusy) return;
    if (!cloudOps) {
      cloudGateToast();
      return;
    }
    setCloudBusy(meta.fingerprint);
    try {
      await downloadByFingerprint(meta.fingerprint);
      toast('开始下载…');
    } catch (err) {
      toast(err instanceof Error ? err.message : '下载失败', 'warn');
    } finally {
      setCloudBusy(null);
    }
  };

  const groups = useMemo(
    () => listShelfGroups(settings.shelfGroups ?? [], books ?? []),
    [settings.shelfGroups, books],
  );

  // 当前筛选的组被删掉后回全部
  useEffect(() => {
    if (activeGroup === 'all' || activeGroup === 'ungrouped') return;
    if (!groups.includes(activeGroup)) setActiveGroup('all');
  }, [activeGroup, groups]);

  const openBook = useCallback(
    async (id: string) => {
      await touchBook(id, { lastOpenedAt: Date.now() });
      navigate(`/read/${id}`);
    },
    [navigate],
  );

  const filtered = useMemo(() => {
    if (!books) return null;
    const q = query.trim().toLowerCase();
    let list = filterBooksByGroup(books, activeGroup);
    if (q) {
      list = list.filter(
        (b) =>
          (b.title ?? '').toLowerCase().includes(q) || (b.author ?? '').toLowerCase().includes(q),
      );
    }
    return sortBooks(list, percentMap, settings.sortMode);
  }, [books, query, percentMap, settings.sortMode, activeGroup]);

  const visibleIds = useMemo(() => (filtered ?? []).map((b) => b.id), [filtered]);

  const continueBook = useMemo(() => {
    if (!books || activeGroup !== 'all' || query) return null;
    const reading = books
      .filter((b) => (percentMap[b.id] ?? 0) > 0.001 && (percentMap[b.id] ?? 0) < 0.995)
      .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0));
    return reading[0] ?? null;
  }, [books, percentMap, activeGroup, query]);

  const pickFiles = () => fileInput.current?.click();

  const onFiles = (files: FileList | null) => {
    if (!files?.length) return;
    useImportQueue.getState().add([...files]);
  };

  const saveCatalog = (next: string[]) => {
    update({ shelfGroups: next });
  };

  const freshCatalog = () => useSettings.getState().settings.shelfGroups ?? [];

  const openCreateGroup = () => {
    if (groupMutating) return;
    setNameDialog({ mode: 'create', value: '' });
  };

  const openRenameGroup = () => {
    if (groupMutating) return;
    if (activeGroup === 'all' || activeGroup === 'ungrouped') return;
    setNameDialog({ mode: 'rename', value: activeGroup });
  };

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const enterSelectMode = () => {
    setSelectMode(true);
    setSelectedIds(new Set());
  };

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const openMoveCreateGroup = () => {
    if (groupMutating || !moveTargets?.length) return;
    setNameDialog({ mode: 'moveCreate', value: '' });
  };

  const openMoveForBook = (book: Book) => {
    if (selectMode && selectedIds.has(book.id) && selectedIds.size > 0) {
      const targets = (books ?? []).filter((b) => selectedIds.has(b.id));
      setMoveTargets(targets.length > 0 ? targets : [book]);
      return;
    }
    setMoveTargets([book]);
  };

  const openMoveForSelection = () => {
    if (!books || selectedIds.size === 0) return;
    const targets = books.filter((b) => selectedIds.has(b.id));
    if (targets.length === 0) return;
    setMoveTargets(targets);
  };

  const applyCreateGroup = (raw: string) => {
    const name = normalizeGroupName(raw);
    if (!name) {
      toast('分组名无效（勿用「全部」「未分组」）', 'warn');
      return false;
    }
    const catalog = listShelfGroups(freshCatalog(), []);
    if (catalog.includes(name)) {
      toast('已有同名分组', 'warn');
      setActiveGroup(name);
      setNameDialog(null);
      return true;
    }
    saveCatalog(addGroupToCatalog(catalog, name));
    setActiveGroup(name);
    setNameDialog(null);
    toast(`已创建「${name}」`);
    return true;
  };

  const applyRenameGroup = (raw: string) => {
    if (activeGroup === 'all' || activeGroup === 'ungrouped') return false;
    const nextName = normalizeGroupName(raw);
    if (!nextName) {
      toast('分组名无效', 'warn');
      return false;
    }
    const catalog = freshCatalog();
    const nextCatalog = renameGroupInCatalog(catalog, activeGroup, nextName);
    if (!nextCatalog) {
      toast(
        listShelfGroups(catalog, []).includes(nextName) ? '已有同名分组' : '重命名失败',
        'warn',
      );
      return false;
    }
    const from = activeGroup;
    setNameDialog(null);
    setGroupMutating(true);
    void (async () => {
      try {
        const list = await listBooks();
        await Promise.all(
          list
            .filter((b) => normalizeGroupName(b.group ?? '') === from)
            .map((b) => touchBook(b.id, { group: nextName })),
        );
        saveCatalog(nextCatalog);
        setActiveGroup(nextName);
        await reload();
        toast(`已改名为「${nextName}」`);
      } catch (err) {
        toast(err instanceof Error ? err.message : '重命名失败', 'warn');
        await reload();
      } finally {
        setGroupMutating(false);
      }
    })();
    return true;
  };

  const applyMoveCreateGroup = (raw: string) => {
    if (!moveTargets?.length) return false;
    const name = normalizeGroupName(raw);
    if (!name) {
      toast('分组名无效', 'warn');
      return false;
    }
    setNameDialog(null);
    void assignGroups(
      moveTargets.map((b) => b.id),
      name,
    );
    return true;
  };

  const submitNameDialog = () => {
    if (!nameDialog || groupMutating) return;
    const raw = nameDialog.value;
    if (nameDialog.mode === 'create') applyCreateGroup(raw);
    else if (nameDialog.mode === 'rename') applyRenameGroup(raw);
    else applyMoveCreateGroup(raw);
  };

  const confirmDeleteGroup = async () => {
    const name = pendingDeleteGroup;
    if (!name || groupMutating) return;
    setGroupMutating(true);
    try {
      const list = await listBooks();
      await Promise.all(
        list
          .filter((b) => normalizeGroupName(b.group ?? '') === name)
          .map((b) => touchBook(b.id, { group: undefined })),
      );
      saveCatalog(removeGroupFromCatalog(freshCatalog(), name));
      if (activeGroup === name) setActiveGroup('all');
      setPendingDeleteGroup(null);
      await reload();
      toast(`已删除分组「${name}」`);
    } catch (err) {
      toast(err instanceof Error ? err.message : '删除分组失败', 'warn');
      await reload();
    } finally {
      setGroupMutating(false);
    }
  };

  const assignGroups = async (ids: readonly string[], group: string | undefined) => {
    if (groupMutating || ids.length === 0) return;
    setGroupMutating(true);
    try {
      const results = await Promise.all(ids.map((id) => touchBook(id, { group })));
      const updated = results.filter(Boolean).length;
      if (updated === 0) {
        toast('没有可移动的书', 'warn');
        setMoveTargets(null);
        await reload();
        return;
      }
      if (group) {
        const catalog = freshCatalog();
        if (!listShelfGroups(catalog, []).includes(group)) {
          saveCatalog(addGroupToCatalog(catalog, group));
        }
      }
      setMoveTargets(null);
      setSelectedIds((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      await reload();
      if (group) {
        toast(updated === 1 ? `已移到「${group}」` : `已将 ${updated} 本移到「${group}」`);
      } else {
        toast(updated === 1 ? '已移出分组' : `已将 ${updated} 本移出分组`);
      }
      if (updated < ids.length) {
        toast(`其中 ${ids.length - updated} 本未找到`, 'warn');
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : '移动失败', 'warn');
      await reload();
    } finally {
      setGroupMutating(false);
    }
  };

  const removeBook = (book: Book) => {
    setDeleteFromCloud(false);
    setPendingDelete(book);
  };

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    const book = pendingDelete;
    // 以勾选为准，不再二次依赖 remoteMap（对话框打开期间清单刷新可能把它清掉）
    const alsoCloud = deleteFromCloud;
    let cloudDeleted = false;
    try {
      // 勾了云端：先删云端，失败则中止，避免本地已删、云端还在
      if (alsoCloud) {
        await deleteCloudBook(book.fingerprint);
        cloudDeleted = true;
        // 立刻从本地清单拿掉，避免本机先刷新时短暂冒出「仅云端」卡片
        setRemoteMap((prev) => {
          if (!prev.has(book.fingerprint)) return prev;
          const next = new Map(prev);
          next.delete(book.fingerprint);
          return next;
        });
      }
      await deleteBook(book.id);
      toast(alsoCloud ? '已从本机与云端删除' : '已删除', 'ok');
      setPendingDelete(null);
      setDeleteFromCloud(false);
      await reload();
      if (alsoCloud) void refreshCloud();
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : '删除失败';
      toast(cloudDeleted ? `云端已删除，本机删除失败：${message}` : message, 'warn');
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    if (!pendingDelete && !pendingDeleteGroup && !moveTargets && !nameDialog && !selectMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || deleting || groupMutating) return;
      if (nameDialog) {
        setNameDialog(null);
        return;
      }
      if (pendingDelete || pendingDeleteGroup || moveTargets) {
        setPendingDelete(null);
        setDeleteFromCloud(false);
        setPendingDeleteGroup(null);
        setMoveTargets(null);
        return;
      }
      if (selectMode) exitSelectMode();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    pendingDelete,
    pendingDeleteGroup,
    moveTargets,
    nameDialog,
    selectMode,
    deleting,
    groupMutating,
    exitSelectMode,
  ]);

  // 只在打开/切换模式时聚焦；勿依赖 value，否则每个字都会抢焦点打断 IME
  const nameDialogMode = nameDialog?.mode ?? null;
  useEffect(() => {
    if (!nameDialogMode) return;
    const id = window.setTimeout(() => nameInputRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [nameDialogMode]);

  const markFinished = async (book: Book, finished: boolean) => {
    await touchBook(book.id, { finished, finishedAt: finished ? Date.now() : undefined });
    void reload();
  };

  const emptyShelf = books !== null && books.length === 0 && cloudOnly.length === 0 && !query;
  const sectionTitle = query ? '搜索结果' : groupSectionTitle(activeGroup);
  const gridEmpty = (filtered?.length ?? 0) === 0 && cloudOnly.length === 0;
  const selectedCount = selectedIds.size;
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  const onBookDragStart = (e: ReactDragEvent, book: Book) => {
    const ids = resolveDragBookIds(book.id, selectedIds);
    e.dataTransfer.setData(BOOK_DRAG_MIME, encodeBookDragPayload(ids));
    e.dataTransfer.effectAllowed = 'move';
    setDraggingBook(true);
  };

  const onBookDragEnd = () => {
    setDraggingBook(false);
    setDragOverGroup(null);
  };

  const allowBookDrop = (e: ReactDragEvent) => {
    // WKWebView/Safari 在 dragover 阶段常不暴露自定义 MIME，靠 draggingBook 放行
    const types = [...e.dataTransfer.types];
    if (!draggingBook && !types.includes(BOOK_DRAG_MIME)) return false;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    return true;
  };

  const onGroupChipDragOver = (e: ReactDragEvent, target: string) => {
    if (!allowBookDrop(e)) return;
    setDragOverGroup(target);
  };

  const onGroupChipDragLeave = (e: ReactDragEvent, target: string) => {
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    setDragOverGroup((cur) => (cur === target ? null : cur));
  };

  const onGroupChipDrop = (e: ReactDragEvent, target: 'ungrouped' | string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverGroup(null);
    setDraggingBook(false);
    const ids = parseBookDragPayload(e.dataTransfer.getData(BOOK_DRAG_MIME));
    if (ids.length === 0) return;
    void assignGroups(ids, target === 'ungrouped' ? undefined : target);
  };

  return (
    <div
      className={`shelf${selectMode ? ' shelf-selecting' : ''}${draggingBook ? ' shelf-dragging-book' : ''}`}
      {...dropProps}
    >
      <header className="shelf-top" data-tauri-drag-region="">
        <span className="brand" data-tauri-drag-region="">
          <LogoMark size={18} />
          <span className="brand-word">
            <span className="brand-title">
              轻阅
              <sup className="brand-ver" title={`版本 v${APP_VERSION}`}>
                v{APP_VERSION}
              </sup>
            </span>
            <small>QINGYUE</small>
          </span>
        </span>
        <div className="shelf-search">
          <IconSearch size={17} />
          <input
            placeholder="搜索书名或作者"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜索"
          />
          {query && (
            <button
              type="button"
              className="qy-icon-btn"
              style={{ width: 28, height: 28 }}
              onClick={() => setQuery('')}
            >
              <IconClose size={15} />
            </button>
          )}
        </div>
        <span className="spacer" data-tauri-drag-region="" />
        {!selectMode && (
          <Segmented
            size="sm"
            value={settings.sortMode}
            options={SORTS}
            onChange={(v) => update({ sortMode: v })}
          />
        )}
        {!emptyShelf && books !== null && (
          <button
            type="button"
            className={`shelf-select-toggle${selectMode ? ' active' : ''}`}
            onClick={() => (selectMode ? exitSelectMode() : enterSelectMode())}
            aria-pressed={selectMode}
          >
            {selectMode ? '完成' : '选择'}
          </button>
        )}
        <button
          type="button"
          className="qy-icon-btn"
          onClick={() => navigate('/settings')}
          aria-label="个人中心"
        >
          <IconGear />
        </button>
        <ShelfAccount />
      </header>

      <main className="shelf-body">
        {filtered === null ? (
          <EmptyState title="书页翻动中…" />
        ) : (
          <>
            {!query && (
              <div className="shelf-group-bar" role="toolbar" aria-label="书架分组">
                <button
                  type="button"
                  aria-pressed={activeGroup === 'all'}
                  className={`shelf-group-chip${activeGroup === 'all' ? ' active' : ''}`}
                  onClick={() => setActiveGroup('all')}
                >
                  全部
                </button>
                <button
                  type="button"
                  aria-pressed={activeGroup === 'ungrouped'}
                  className={`shelf-group-chip${activeGroup === 'ungrouped' ? ' active' : ''}${dragOverGroup === 'ungrouped' ? ' drop-target' : ''}`}
                  onClick={() => setActiveGroup('ungrouped')}
                  onDragOver={(e) => onGroupChipDragOver(e, 'ungrouped')}
                  onDragLeave={(e) => onGroupChipDragLeave(e, 'ungrouped')}
                  onDrop={(e) => onGroupChipDrop(e, 'ungrouped')}
                >
                  未分组
                </button>
                {groups.map((g) => (
                  <button
                    key={g}
                    type="button"
                    aria-pressed={activeGroup === g}
                    className={`shelf-group-chip${activeGroup === g ? ' active' : ''}${dragOverGroup === g ? ' drop-target' : ''}`}
                    onClick={() => setActiveGroup(g)}
                    onDragOver={(e) => onGroupChipDragOver(e, g)}
                    onDragLeave={(e) => onGroupChipDragLeave(e, g)}
                    onDrop={(e) => onGroupChipDrop(e, g)}
                  >
                    {g}
                  </button>
                ))}
                <button
                  type="button"
                  className="shelf-group-chip add"
                  onClick={openCreateGroup}
                  disabled={groupMutating}
                  aria-label="新建分组"
                >
                  <IconPlus size={14} />
                  新建
                </button>
              </div>
            )}

            {emptyShelf ? (
              <EmptyState
                title="书架还是空的"
                hint="把 txt 文件拖进来，或点击右下角的 + 导入。也可先「新建」分组，导入后再把书拖进去。"
                action={
                  <Button variant="primary" icon={<IconPlus />} onClick={pickFiles}>
                    导入书籍
                  </Button>
                }
              />
            ) : (
              <>
            {continueBook && (
              <>
                <h2 className="shelf-section-title">继续阅读</h2>
                <button
                  type="button"
                  className="continue-card"
                  onClick={() => void openBook(continueBook.id)}
                >
                  {/* 封面只留布面与丝带：书名由右侧正文承担，避免同一行里出现两遍 */}
                  <BookCover book={continueBook} variant="mark" width={76} />
                  <span className="continue-meta">
                    <span className="continue-kicker">
                      上次阅读 ·{' '}
                      {formatRelative(continueBook.lastOpenedAt ?? continueBook.createdAt)}
                    </span>
                    <span className="continue-title">{continueBook.title}</span>
                    <span className="continue-sub">
                      {continueBook.author ? `${continueBook.author} · ` : ''}共{' '}
                      {isPdfBook(continueBook)
                        ? formatPages(continueBook.pageCount ?? 0)
                        : formatChars(continueBook.charCount)}
                    </span>
                    <span className="continue-progress">
                      <Progress
                        value={percentMap[continueBook.id] ?? 0}
                        style={{ flex: '1 1 auto', maxWidth: 260 }}
                      />
                      <span className="continue-stat">
                        {isPdfBook(continueBook)
                          ? `${formatPercent(percentMap[continueBook.id] ?? 0)} 已读`
                          : `还剩 ${formatRemaining(
                              (1 - (percentMap[continueBook.id] ?? 0)) * continueBook.charCount,
                            )}`}
                      </span>
                    </span>
                  </span>
                  <span className="continue-pct">
                    <b>{formatPercent(percentMap[continueBook.id] ?? 0)}</b>
                    <i>已读</i>
                  </span>
                  <span className="continue-cta" aria-hidden>
                    <IconChevronRight size={18} />
                  </span>
                </button>
              </>
            )}

            <h2 className="shelf-section-title">
              {sectionTitle}
              <small>
                {filtered.length + cloudOnly.length} 本
                {cloudOnly.length > 0 ? ` · 云端 ${cloudOnly.length}` : ''}
                {query ? ` · “${query}”` : ''}
              </small>
              {!query && activeGroup !== 'all' && activeGroup !== 'ungrouped' && (
                <span className="shelf-group-actions">
                  <button
                    type="button"
                    className="shelf-group-link"
                    disabled={groupMutating}
                    onClick={openRenameGroup}
                  >
                    {groupMutating ? '处理中…' : '重命名'}
                  </button>
                  <button
                    type="button"
                    className="shelf-group-link danger"
                    disabled={groupMutating}
                    onClick={() => setPendingDeleteGroup(activeGroup)}
                  >
                    删除分组
                  </button>
                </span>
              )}
            </h2>

            {gridEmpty ? (
              <EmptyState
                title={query ? '没有匹配的书' : '这个分组还是空的'}
                hint={query ? '换个关键词试试' : '把书拖到上方分组，或点「选择」批量移入'}
              />
            ) : (
              <div className={`shelf-grid${settings.shelfDensity === 'compact' ? ' compact' : ''}`}>
                {filtered.map((book) => {
                  const canUpload = cloudOps && !remoteMap.has(book.fingerprint);
                  const busy = cloudBusy === book.fingerprint;
                  const selected = selectedIds.has(book.id);
                  return (
                    <div className={`shelf-cell${selected ? ' selected' : ''}`} key={book.id}>
                      {/* biome-ignore lint/a11y/noStaticElementInteractions: HTML5 拖放到分组，封面为拖拽源 */}
                      <div
                        className="cell-cover"
                        draggable
                        onDragStart={(e) => onBookDragStart(e, book)}
                        onDragEnd={onBookDragEnd}
                      >
                        <BookCover
                          book={book}
                          percent={percentMap[book.id]}
                          onClick={() =>
                            selectMode ? toggleSelect(book.id) : void openBook(book.id)
                          }
                        />
                        {selectMode && (
                          <span className={`cell-check${selected ? ' on' : ''}`} aria-hidden>
                            {selected ? '✓' : ''}
                          </span>
                        )}
                        {canUpload && !selectMode && (
                          <button
                            type="button"
                            className="cell-cloud cell-cloud-up"
                            disabled={busy}
                            aria-label={`上传《${book.title}》到云端`}
                            title="上传到云端"
                            onClick={(e) => {
                              e.stopPropagation();
                              void onUpload(book);
                            }}
                          >
                            <IconCloudUp size={15} />
                          </button>
                        )}
                        {/* 操作入口独立于封面，点封面只负责打开，不会把菜单一起点开 */}
                        {!selectMode && (
                          <Menu
                            align="end"
                            trigger={
                              <button
                                type="button"
                                className="cell-more"
                                aria-label={`《${book.title}》更多操作`}
                              >
                                <IconMore size={16} />
                              </button>
                            }
                            items={[
                              {
                                key: 'open',
                                label: '开始阅读',
                                onSelect: () => void openBook(book.id),
                              },
                              {
                                key: 'group',
                                label: '移到分组…',
                                onSelect: () => openMoveForBook(book),
                              },
                              {
                                key: 'finish',
                                label: book.finished ? '标记未读完' : '标记已读完',
                                onSelect: () => void markFinished(book, !book.finished),
                              },
                              {
                                key: 'del',
                                label: '删除本书',
                                danger: true,
                                onSelect: () => void removeBook(book),
                              },
                            ]}
                          />
                        )}
                      </div>
                      <span className="shelf-cell-title clamp-2">{book.title}</span>
                      <span className="shelf-cell-sub">
                        {(() => {
                          const sizeLabel = isPdfBook(book)
                            ? formatPages(book.pageCount ?? 0)
                            : formatChars(book.charCount);
                          return percentMap[book.id] != null && percentMap[book.id] > 0.001
                            ? `${formatPercent(percentMap[book.id])} · ${sizeLabel}`
                            : sizeLabel;
                        })()}
                      </span>
                    </div>
                  );
                })}
                {cloudOnly.map((meta) => {
                  const busy = cloudBusy === meta.fingerprint;
                  const ghost = cloudMetaAsBook(meta);
                  return (
                    <div className="shelf-cell shelf-cell-cloud" key={`cloud:${meta.fingerprint}`}>
                      <div className="cell-cover">
                        <BookCover book={ghost} />
                        <button
                          type="button"
                          className="cell-cloud cell-cloud-down"
                          disabled={busy}
                          aria-label={`下载《${meta.title}》`}
                          title="从云端下载"
                          onClick={() => void onDownload(meta)}
                        >
                          <IconCloudDown size={15} />
                        </button>
                      </div>
                      <span className="shelf-cell-title clamp-2">{meta.title}</span>
                      <span className="shelf-cell-sub">云端 · {formatBytes(meta.size)}</span>
                    </div>
                  );
                })}
              </div>
            )}
              </>
            )}
          </>
        )}
      </main>

      {selectMode && (
        <div className="shelf-select-bar" role="toolbar" aria-label="批量操作">
          <span className="shelf-select-count">
            {selectedCount > 0 ? `已选 ${selectedCount} 本` : '点选要移动的书'}
          </span>
          <button
            type="button"
            className="shelf-select-action"
            disabled={visibleIds.length === 0}
            onClick={() => {
              if (allVisibleSelected) {
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  for (const id of visibleIds) next.delete(id);
                  return next;
                });
              } else {
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  for (const id of visibleIds) next.add(id);
                  return next;
                });
              }
            }}
          >
            {allVisibleSelected ? '取消全选' : '全选'}
          </button>
          <Button
            variant="primary"
            size="sm"
            disabled={selectedCount === 0 || groupMutating}
            onClick={openMoveForSelection}
          >
            移到分组
          </Button>
          <Button variant="ghost" size="sm" onClick={exitSelectMode}>
            完成
          </Button>
        </div>
      )}

      {!selectMode && (
        <button type="button" className="fab" onClick={pickFiles} aria-label="导入书籍">
          <IconPlus size={24} />
        </button>
      )}
      <input
        ref={fileInput}
        type="file"
        accept=".txt,.text,.md,.log,.pdf,text/plain,application/pdf"
        multiple
        hidden
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <ImportTray />
      {dropping && <div className="dropzone-overlay">松手导入 · 完全离线可用</div>}

      {pendingDelete && (
        <div className="qy-overlay shelf-account-modal">
          <button
            type="button"
            className="shelf-confirm-backdrop"
            aria-label="取消删除"
            disabled={deleting}
            onClick={() => {
              setPendingDelete(null);
              setDeleteFromCloud(false);
            }}
          />
          <div
            className="shelf-account-dialog shelf-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shelf-confirm-title"
          >
            <h2 id="shelf-confirm-title">删除《{pendingDelete.title}》</h2>
            <p>阅读进度、书签与文件会一并移除，此操作不可撤销。</p>
            {cloudOps && remoteMap.has(pendingDelete.fingerprint) && (
              <label className="shelf-confirm-check">
                <input
                  type="checkbox"
                  checked={deleteFromCloud}
                  disabled={deleting}
                  onChange={(e) => setDeleteFromCloud(e.target.checked)}
                />
                <span>从云端删除</span>
              </label>
            )}
            <div className="shelf-confirm-actions">
              <Button
                variant="ghost"
                disabled={deleting}
                onClick={() => {
                  setPendingDelete(null);
                  setDeleteFromCloud(false);
                }}
              >
                取消
              </Button>
              <Button variant="danger" disabled={deleting} onClick={() => void confirmDelete()}>
                {deleting ? '正在删除…' : '删除'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {pendingDeleteGroup && (
        <div className="qy-overlay shelf-account-modal">
          <button
            type="button"
            className="shelf-confirm-backdrop"
            aria-label="取消"
            disabled={groupMutating}
            onClick={() => setPendingDeleteGroup(null)}
          />
          <div
            className="shelf-account-dialog shelf-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shelf-del-group-title"
          >
            <h2 id="shelf-del-group-title">删除分组「{pendingDeleteGroup}」</h2>
            <p>组内的书会回到「未分组」，不会删除书籍本身。</p>
            <div className="shelf-confirm-actions">
              <Button
                variant="ghost"
                disabled={groupMutating}
                onClick={() => setPendingDeleteGroup(null)}
              >
                取消
              </Button>
              <Button
                variant="danger"
                disabled={groupMutating}
                onClick={() => void confirmDeleteGroup()}
              >
                {groupMutating ? '正在删除…' : '删除分组'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {moveTargets && moveTargets.length > 0 && (
        <div className="qy-overlay shelf-account-modal">
          <button
            type="button"
            className="shelf-confirm-backdrop"
            aria-label="取消"
            disabled={groupMutating}
            onClick={() => setMoveTargets(null)}
          />
          <div
            className="shelf-account-dialog shelf-confirm shelf-move-group"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shelf-move-group-title"
          >
            <h2 id="shelf-move-group-title">移到分组</h2>
            <p>
              {moveTargets.length === 1
                ? `《${moveTargets[0].title}》`
                : `已选 ${moveTargets.length} 本`}
            </p>
            <div className="shelf-move-list">
              <button
                type="button"
                className={
                  moveTargets.length === 1 && !normalizeGroupName(moveTargets[0].group ?? '')
                    ? 'active'
                    : ''
                }
                disabled={groupMutating}
                onClick={() =>
                  void assignGroups(
                    moveTargets.map((b) => b.id),
                    undefined,
                  )
                }
              >
                未分组
              </button>
              {groups.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={
                    moveTargets.length === 1 && normalizeGroupName(moveTargets[0].group ?? '') === g
                      ? 'active'
                      : ''
                  }
                  disabled={groupMutating}
                  onClick={() =>
                    void assignGroups(
                      moveTargets.map((b) => b.id),
                      g,
                    )
                  }
                >
                  {g}
                </button>
              ))}
            </div>
            <div className="shelf-confirm-actions">
              <Button variant="ghost" disabled={groupMutating} onClick={openMoveCreateGroup}>
                新建并移入
              </Button>
              <Button variant="ghost" disabled={groupMutating} onClick={() => setMoveTargets(null)}>
                取消
              </Button>
            </div>
          </div>
        </div>
      )}

      {nameDialog && (
        <div className="qy-overlay shelf-account-modal">
          <button
            type="button"
            className="shelf-confirm-backdrop"
            aria-label="取消"
            disabled={groupMutating}
            onClick={() => setNameDialog(null)}
          />
          <div
            className="shelf-account-dialog shelf-confirm shelf-group-name"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shelf-group-name-title"
          >
            <h2 id="shelf-group-name-title">
              {nameDialog.mode === 'rename'
                ? '重命名分组'
                : nameDialog.mode === 'moveCreate'
                  ? '新建分组并移入'
                  : '新建分组'}
            </h2>
            <label className="shelf-group-name-field">
              <span>分组名称</span>
              <input
                ref={nameInputRef}
                value={nameDialog.value}
                maxLength={24}
                placeholder="例如：连环画"
                disabled={groupMutating}
                onChange={(e) =>
                  setNameDialog((prev) => (prev ? { ...prev, value: e.target.value } : prev))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submitNameDialog();
                  }
                }}
              />
            </label>
            <div className="shelf-confirm-actions">
              <Button variant="ghost" disabled={groupMutating} onClick={() => setNameDialog(null)}>
                取消
              </Button>
              <Button
                variant="primary"
                disabled={groupMutating || !nameDialog.value.trim()}
                onClick={submitNameDialog}
              >
                {nameDialog.mode === 'rename'
                  ? '保存'
                  : nameDialog.mode === 'moveCreate'
                    ? '创建并移入'
                    : '创建'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 仅云端条目：拼一个最小 Book 给封面组件画色相封面 */
function cloudMetaAsBook(meta: CloudBookMeta): Book {
  return {
    id: `cloud:${meta.fingerprint}`,
    title: meta.title || '未命名',
    author: meta.author,
    kind: meta.kind,
    pageCount: meta.pageCount ?? 0,
    size: meta.size,
    encoding: meta.encoding ?? 'utf-8',
    fingerprint: meta.fingerprint,
    blockSize: 0,
    blockCount: 0,
    charCount: meta.charCount ?? 0,
    lineCount: 0,
    chapterCount: 0,
    cleanedLines: 0,
    footnoteCount: 0,
    status: 'ready',
    indexProgress: 1,
    finished: false,
    createdAt: meta.uploadedAt ?? 0,
    coverHue: coverHue(meta.fingerprint),
  };
}

function sortBooks(list: Book[], percentMap: Record<string, number>, mode: ShelfSort): Book[] {
  const arr = [...list];
  switch (mode) {
    case 'recent':
      return arr.sort((a, b) => (b.lastOpenedAt ?? b.createdAt) - (a.lastOpenedAt ?? a.createdAt));
    case 'added':
      return arr.sort((a, b) => b.createdAt - a.createdAt);
    case 'title':
      return arr.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'));
    case 'author':
      return arr.sort((a, b) => (a.author ?? '~').localeCompare(b.author ?? '~', 'zh-Hans-CN'));
    case 'progress':
      return arr.sort((a, b) => (percentMap[b.id] ?? 0) - (percentMap[a.id] ?? 0));
  }
}
