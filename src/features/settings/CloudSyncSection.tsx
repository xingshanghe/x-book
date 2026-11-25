/** 个人中心 · 云书架：登录账号即可手动上传/下载，不再填写 MinIO 密钥 */

import { useEffect, useState } from 'react';
import { accountSession } from '@/account/session';
import { useAccountProfile } from './useAccountProfile';
import {
  DEFAULT_CLOUD_API_BASE,
  probeCloud,
  readCloudConfig,
  writeCloudConfig,
} from '@/sync/cloudBooks';
import { Button, Switch } from '@/ui';

type ToastFn = (text: string, kind?: 'info' | 'ok' | 'warn') => void;

export function CloudSyncSection({ toast }: { toast: ToastFn }) {
  const profile = useAccountProfile();
  const initial = readCloudConfig();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [apiBase, setApiBase] = useState(initial.apiBase);
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    if (accountSession.hasStoredSession()) void accountSession.restore();
  }, []);

  const persist = (patch: Parameters<typeof writeCloudConfig>[0]) => {
    writeCloudConfig(patch);
  };

  const saveAll = () => {
    persist({ enabled, apiBase: apiBase.trim() });
  };

  return (
    <section id="sync" className="settings-section">
      <h2>同步</h2>
      <p className="desc">
        用「账号」里的用户名和口令登录后，即可在书架上手动上传 / 下载书籍。多台设备登录同一账号即可互通。不会自动同步进度或书签。
      </p>
      <Switch
        label="启用云书架"
        hint="开启后书架会显示上传 / 下载小图标"
        checked={enabled}
        onChange={(v) => {
          setEnabled(v);
          persist({ enabled: v, apiBase });
        }}
      />
      <div className="qy-row">
        <span className="qy-row-label">账号</span>
        <span className="qy-row-hint">
          {profile ? `已登录 · ${profile.username}` : '未登录 · 请到上方「账号」注册或登录'}
        </span>
      </div>
      <details className="sponsor-advanced">
        <summary>服务地址</summary>
        <label className="qy-row">
          <span className="qy-row-label">云书架</span>
          <input
            value={apiBase}
            placeholder={DEFAULT_CLOUD_API_BASE}
            autoComplete="off"
            onChange={(e) => setApiBase(e.target.value)}
            onBlur={saveAll}
          />
        </label>
      </details>
      <div className="tts-actions">
        <Button
          size="sm"
          disabled={probing || !enabled}
          onClick={() => {
            saveAll();
            if (!profile) {
              toast('请先登录账号', 'warn');
              return;
            }
            setProbing(true);
            void probeCloud().then((r) => {
              setProbing(false);
              if (r.ok) toast('连接成功', 'ok');
              else toast(r.reason ? `连接失败：${r.reason}` : '连接失败', 'warn');
            });
          }}
        >
          {probing ? '测试中…' : '测试连接'}
        </Button>
      </div>
      <div className="qy-row">
        <span className="qy-row-label">状态</span>
        <span className="qy-row-hint">
          {!enabled
            ? '单机模式 · 未启用'
            : profile
              ? '已登录 · 仅手动上传下载'
              : '已启用 · 请先登录账号'}
        </span>
      </div>
    </section>
  );
}
