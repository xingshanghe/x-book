/** 设置页：外观 / 阅读 / 识别与清洗 / 字体 / 朗读 / 数据 / 同步 / 关于 */

import { type ComponentType, useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useSettings } from '@/app/store';
import { BUILTIN_RULES, validatePattern } from '@/core/parser/cleaner';
import { formatBytes } from '@/lib/format';
import { estimateQuota, isStandalone } from '@/lib/platform';
import { usageEstimate, wipeAll } from '@/storage/db';
import {
  ACCEPTED_FONT_TYPES,
  addFont,
  listFonts,
  removeFont,
  type StoredFont,
} from '@/storage/fontStore';
import {
  FONT_SIZE_RANGE,
  INDENT_RANGE,
  LINE_HEIGHT_RANGE,
  SPACING_RANGE,
  WIDTH_RANGE,
} from '@/storage/repositories/defaults';
import type { CleanRule } from '@/types/models';
import { Button, Segmented, Slider, Switch, useToast } from '@/ui';
import { IconChevronLeft, LogoMark } from '@/ui/icons';
import './settings.css';

const SECTIONS = [
  { id: 'appearance', label: '外观' },
  { id: 'reading', label: '阅读' },
  { id: 'recognition', label: '识别与清洗' },
  { id: 'fonts', label: '字体' },
  { id: 'aloud', label: '朗读' },
  { id: 'data', label: '数据' },
  { id: 'sync', label: '同步' },
  { id: 'about', label: '关于' },
] as const;

type ToastFn = ReturnType<typeof useToast>['push'];

export function SettingsPage() {
  const [, navigate] = useLocation();
  const { settings, update, updateTypography, userRules, setRules } = useSettings();
  const toast = useToast().push;
  const [Aloud, setAloud] = useState<ComponentType<{ toast: (text: string) => void }> | null>(null);
  const openAloud = () => {
    if (Aloud) return;
    void import('./ReadingAloudSection').then((mod) => setAloud(() => mod.ReadingAloudSection));
  };

  return (
    <div className="settings">
      <header className="settings-top" data-tauri-drag-region="">
        <button
          type="button"
          className="qy-icon-btn"
          onClick={() => navigate('/')}
          aria-label="返回书架"
        >
          <IconChevronLeft />
        </button>
        <h1 data-tauri-drag-region="">设置</h1>
      </header>

      <div className="settings-body">
        <nav className="settings-nav">
          {SECTIONS.map((s) => (
            <Button
              key={s.id}
              size="sm"
              onClick={() => {
                if (s.id === 'aloud') openAloud();
                document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              {s.label}
            </Button>
          ))}
        </nav>

        {/* ── 外观 ── */}
        <section id="appearance" className="settings-section">
          <h2>外观</h2>
          <div className="qy-row">
            <span className="qy-row-label">主题</span>
            <Segmented
              value={settings.themeMode}
              options={[
                { value: 'system', label: '跟随系统' },
                { value: 'day', label: '纸黄' },
                { value: 'sepia', label: '宣纸' },
                { value: 'night', label: '黛蓝' },
              ]}
              onChange={(v) => update({ themeMode: v })}
            />
          </div>
          <Switch
            label="书架紧凑视图"
            hint="一屏显示更多书"
            checked={settings.shelfDensity === 'compact'}
            onChange={(v) => update({ shelfDensity: v ? 'compact' : 'comfortable' })}
          />
        </section>

        {/* ── 阅读 ── */}
        <section id="reading" className="settings-section">
          <h2>阅读</h2>
          <div className="qy-row">
            <span className="qy-row-label">默认阅读模式</span>
            <Segmented
              value={settings.pageMode}
              options={[
                { value: 'scroll', label: '滚动' },
                { value: 'page', label: '翻页' },
              ]}
              onChange={(v) => update({ pageMode: v })}
            />
          </div>
          <Slider
            label="默认字号"
            min={FONT_SIZE_RANGE.min}
            max={FONT_SIZE_RANGE.max}
            value={settings.typography.fontSize}
            onChange={(v) => updateTypography({ fontSize: v })}
            format={(v) => `${v}px`}
          />
          <Slider
            label="默认行距"
            min={LINE_HEIGHT_RANGE.min}
            max={LINE_HEIGHT_RANGE.max}
            step={LINE_HEIGHT_RANGE.step}
            value={settings.typography.lineHeight}
            onChange={(v) => updateTypography({ lineHeight: v })}
            format={(v) => v.toFixed(2)}
          />
          <Slider
            label="默认段距"
            min={SPACING_RANGE.min}
            max={SPACING_RANGE.max}
            step={SPACING_RANGE.step}
            value={settings.typography.paragraphSpacing}
            onChange={(v) => updateTypography({ paragraphSpacing: v })}
            format={(v) => `${v.toFixed(2)}em`}
          />
          <Slider
            label="默认缩进"
            min={INDENT_RANGE.min}
            max={INDENT_RANGE.max}
            step={INDENT_RANGE.step}
            value={settings.typography.textIndent}
            onChange={(v) => updateTypography({ textIndent: v })}
            format={(v) => `${v}em`}
          />
          <Slider
            label="版心宽度"
            min={WIDTH_RANGE.min}
            max={WIDTH_RANGE.max}
            value={settings.typography.maxWidth}
            onChange={(v) => updateTypography({ maxWidth: v })}
            format={(v) => `${v} 字`}
          />
          <Switch
            label="点按翻页"
            hint="翻页模式下点按屏幕左右侧翻页"
            checked={settings.tapToTurn}
            onChange={(v) => update({ tapToTurn: v })}
          />
          <Switch
            label="键盘快捷键"
            hint={
              <>
                <span className="kbd">←</span> <span className="kbd">→</span> 翻页 ·{' '}
                <span className="kbd">T</span> 目录
              </>
            }
            checked={settings.enableShortcuts}
            onChange={(v) => update({ enableShortcuts: v })}
          />
          <Switch
            label="「快读完」提示"
            checked={settings.showProgressHints}
            onChange={(v) => update({ showProgressHints: v })}
          />
          <Switch
            label="显示扉页"
            checked={settings.showTitlePage}
            onChange={(v) => update({ showTitlePage: v })}
          />
        </section>

        {/* ── 识别与清洗 ── */}
        <RecognitionSection
          userRules={userRules}
          setRules={setRules}
          detectChapters={settings.detectChapters}
          cleanAds={settings.cleanAds}
          detectFootnotes={settings.detectFootnotes}
          update={update}
          toast={toast}
        />

        {/* ── 字体 ── */}
        <FontsSection toast={toast} />

        <section id="aloud" className="settings-section">
          {Aloud ? (
            <Aloud toast={toast} />
          ) : (
            <>
              <h2>朗读</h2>
              <p className="desc">朗读引擎在你确认后才下载，不会随安装包附带。</p>
              <Button size="sm" onClick={openAloud}>
                打开朗读设置
              </Button>
            </>
          )}
        </section>

        {/* ── 数据 ── */}
        <DataSection toast={toast} />

        {/* ── 同步 ── */}
        <section id="sync" className="settings-section">
          <h2>同步</h2>
          <div className="qy-row">
            <span className="qy-row-label">状态</span>
            <span className="qy-row-hint">单机模式 · 未配置服务</span>
          </div>
        </section>

        {/* ── 关于 ── */}
        <section id="about" className="settings-section">
          <h2>
            <LogoMark size={15} /> 关于轻阅
          </h2>
          <p className="desc">轻阅 QINGYUE v1.0 · 本地优先的纯离线 txt 阅读器</p>
          <div className="qy-row">
            <span className="qy-row-label">安装形态</span>
            <span className="qy-row-hint">
              {isStandalone() ? '已安装（独立窗口）' : '浏览器内运行'}
            </span>
          </div>
          <div className="qy-row">
            <span className="qy-row-label">设备标识</span>
            <span className="qy-row-hint mono">{settings.deviceId}</span>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ────────────── 识别与清洗 ────────────── */

function RecognitionSection({
  userRules,
  setRules,
  detectChapters,
  cleanAds,
  detectFootnotes,
  update,
  toast,
}: {
  userRules: CleanRule[];
  setRules: (r: CleanRule[]) => void;
  detectChapters: boolean;
  cleanAds: boolean;
  detectFootnotes: boolean;
  update: ReturnType<typeof useSettings.getState>['update'];
  toast: ToastFn;
}) {
  const [draft, setDraft] = useState('');

  const addRule = () => {
    const p = draft.trim();
    if (!p) return;
    const v = validatePattern(p);
    if (!v.ok) {
      toast(`正则有误：${v.error}`, 'warn');
      return;
    }
    setRules([
      ...userRules,
      {
        id: `user-${Date.now().toString(36)}`,
        name: `自定义 ${userRules.length + 1}`,
        pattern: p,
        enabled: true,
      },
    ]);
    setDraft('');
    toast('规则已添加，重新导入书籍后生效', 'ok');
  };

  return (
    <section id="recognition" className="settings-section">
      <h2>识别与清洗</h2>
      <Switch
        label="自动识别章节"
        checked={detectChapters}
        onChange={(v) => update({ detectChapters: v })}
      />
      <Switch
        label="脚注识别"
        hint="①–㊿ 引用与行首注释"
        checked={detectFootnotes}
        onChange={(v) => update({ detectFootnotes: v })}
      />
      <Switch label="广告清洗" checked={cleanAds} onChange={(v) => update({ cleanAds: v })} />
      {cleanAds && (
        <>
          <div className="rule-item">
            <b style={{ fontSize: 12 }}>内置规则</b>
            {BUILTIN_RULES.map((r) => (
              <code key={r.id} title={r.pattern}>
                {r.name}
              </code>
            ))}
          </div>
          {userRules.map((r) => (
            <div className="rule-item" key={r.id}>
              <input
                type="text"
                defaultValue={r.pattern}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (!v || v === r.pattern) return;
                  const check = validatePattern(v);
                  if (!check.ok) {
                    toast(`正则有误：${check.error}`, 'warn');
                    e.target.value = r.pattern;
                    return;
                  }
                  setRules(userRules.map((x) => (x.id === r.id ? { ...x, pattern: v } : x)));
                  toast('规则已更新，重新导入书籍后生效', 'ok');
                }}
              />
              <Switch
                checked={r.enabled}
                onChange={(v) =>
                  setRules(userRules.map((x) => (x.id === r.id ? { ...x, enabled: v } : x)))
                }
                label=""
              />
              <button
                type="button"
                className="qy-icon-btn"
                style={{ width: 30, height: 30 }}
                aria-label="删除规则"
                onClick={() => setRules(userRules.filter((x) => x.id !== r.id))}
              >
                ×
              </button>
            </div>
          ))}
          <div className="rule-item">
            <input
              type="text"
              placeholder="添加行级正则，如 ^本章说.*$"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addRule()}
            />
            <Button size="sm" variant="primary" onClick={addRule}>
              添加
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

/* ────────────── 字体 ────────────── */

function FontsSection({ toast }: { toast: ToastFn }) {
  const [fonts, setFonts] = useState<StoredFont[]>([]);
  const bodyFont = useSettings((s) => s.settings.bodyFont);
  const update = useSettings((s) => s.update);

  const reload = () => void listFonts().then(setFonts);
  useEffect(reload, []);

  return (
    <section id="fonts" className="settings-section">
      <h2>自备字体</h2>
      <p className="desc">
        拖入或选择 TTF / OTF / WOFF2 字体文件，完全存放在本机（IndexedDB），最多 12
        个。适合加载方正楷体、霞鹜文楷等商用或开源字体。
      </p>
      <div className="rule-item">
        <label style={{ cursor: 'pointer' }}>
          <input
            type="file"
            accept={ACCEPTED_FONT_TYPES}
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                const rec = await addFont(f);
                toast(`已加载「${rec.name}」`, 'ok');
                reload();
                update({ bodyFont: rec.family });
              } catch (err) {
                toast(err instanceof Error ? err.message : '字体加载失败', 'warn');
              }
            }}
          />
          <Button size="sm">选择字体文件</Button>
        </label>
      </div>
      {fonts.map((f) => (
        <div className="rule-item" key={f.id}>
          <b style={{ fontSize: 13 }}>{f.name}</b>
          <code>{formatBytes(f.blob.size)}</code>
          <Button
            size="sm"
            aria-pressed={bodyFont === f.family}
            variant={bodyFont === f.family ? 'primary' : 'soft'}
            onClick={() => update({ bodyFont: f.family })}
          >
            {bodyFont === f.family ? '使用中' : '使用'}
          </Button>
          <button
            type="button"
            className="qy-icon-btn"
            style={{ width: 30, height: 30 }}
            aria-label={`删除 ${f.name}`}
            onClick={async () => {
              await removeFont(f.id);
              reload();
            }}
          >
            ×
          </button>
        </div>
      ))}
      {fonts.length === 0 && (
        <p style={{ color: 'var(--ink-3)', fontSize: 12 }}>尚未导入自备字体。</p>
      )}
    </section>
  );
}

/* ────────────── 数据 ────────────── */

function DataSection({ toast }: { toast: ToastFn }) {
  const [usage, setUsage] = useState<{ usage: number; quota: number; persisted: boolean } | null>(
    null,
  );

  useEffect(() => {
    void (async () => {
      const e = await estimateQuota();
      const u = await usageEstimate();
      setUsage({ usage: e?.usage ?? u.usage, quota: e?.quota ?? u.quota, persisted: u.persisted });
    })();
  }, []);

  return (
    <section id="data" className="settings-section">
      <h2>数据</h2>
      <div className="stat-row">
        <div className="stat">
          <b>{usage ? formatBytes(usage.usage) : '—'}</b>
          <span>已用空间</span>
        </div>
        <div className="stat">
          <b>{usage ? formatBytes(usage.quota) : '—'}</b>
          <span>可用配额</span>
        </div>
        <div className="stat">
          <b>{usage ? (usage.persisted ? '已保护' : '未保护') : '—'}</b>
          <span>持久化状态</span>
        </div>
      </div>
      <p className="desc">
        书籍文件、进度、书签全部存放在浏览器
        IndexedDB。开启持久化后，系统不会因空间不足自动清除你的书。
      </p>
      <div
        className="rule-item"
        style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 14 }}
      >
        <b style={{ color: 'var(--seal)', fontSize: 13 }}>危险区</b>
        <Button
          variant="danger"
          size="sm"
          onClick={async () => {
            if (!window.confirm('确定清空全部书籍、音色包与朗读引擎？\n此操作不可撤销！')) return;
            if (!window.confirm('再次确认：真的要删除这些本机数据吗？')) return;
            await wipeAll();
            const engine = await import('@/tts/engine');
            await engine.deleteInstalledEngine();
            toast('已清空全部数据', 'ok');
          }}
        >
          清空全部书籍与数据
        </Button>
      </div>
    </section>
  );
}
