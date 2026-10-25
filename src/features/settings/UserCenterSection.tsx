import { useEffect, useState } from 'react';
import { accountSession, DEFAULT_ENROLL_ENDPOINT } from '@/account/session';
import { enrollQuotaLabel } from '@/tts/account';
import { Button } from '@/ui';
import { useAccountProfile } from './useAccountProfile';

export function UserCenterSection({ toast }: { toast: (text: string) => void }) {
  const profile = useAccountProfile();
  const [endpoint, setEndpoint] = useState(() => accountSession.readEndpoint());
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');

  useEffect(() => {
    if (accountSession.hasStoredSession()) void accountSession.restore();
  }, []);

  const saveEndpoint = () => {
    accountSession.writeEndpoint(endpoint);
  };

  return (
    <>
      <h2>账号</h2>
      <label className="qy-row">
        <span className="qy-row-label">服务地址</span>
        <input
          value={endpoint}
          placeholder={DEFAULT_ENROLL_ENDPOINT}
          onChange={(event) => setEndpoint(event.target.value)}
          onBlur={saveEndpoint}
        />
      </label>
      {profile ? (
        <>
          <p className="desc">
            {enrollQuotaLabel(profile)}
          </p>
          <h3>修改口令</h3>
          <label className="qy-row">
            <span className="qy-row-label">原口令</span>
            <input
              type="password"
              value={oldPassword}
              autoComplete="current-password"
              onChange={(event) => setOldPassword(event.target.value)}
            />
          </label>
          <label className="qy-row">
            <span className="qy-row-label">新口令</span>
            <input
              type="password"
              value={nextPassword}
              autoComplete="new-password"
              onChange={(event) => setNextPassword(event.target.value)}
            />
          </label>
          <div className="tts-actions">
            <Button
              size="sm"
              onClick={() => {
                void accountSession.changePassword(oldPassword, nextPassword).then((result) => {
                  if (!result.ok) {
                    toast(result.message);
                    return;
                  }
                  setOldPassword('');
                  setNextPassword('');
                  toast('口令已更新');
                });
              }}
            >
              修改口令
            </Button>
            <Button
              size="sm"
              onClick={() => {
                void accountSession.logout().then(() => toast('已退出'));
              }}
            >
              退出
            </Button>
          </div>
        </>
      ) : (
        <>
          <label className="qy-row">
            <span className="qy-row-label">用户名</span>
            <input
              value={username}
              autoComplete="username"
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label className="qy-row">
            <span className="qy-row-label">口令</span>
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <div className="tts-actions">
            <Button
              size="sm"
              onClick={() => {
                saveEndpoint();
                if (!accountSession.readEndpoint()) {
                  toast('请先填写服务地址');
                  return;
                }
                void accountSession.register(username, password).then((result) => {
                  toast(result.ok ? '已注册并登录' : result.message);
                });
              }}
            >
              注册
            </Button>
            <Button
              size="sm"
              onClick={() => {
                saveEndpoint();
                if (!accountSession.readEndpoint()) {
                  toast('请先填写服务地址');
                  return;
                }
                void accountSession.login(username, password).then(async (result) => {
                  if (!result.ok) {
                    toast(result.message);
                    return;
                  }
                  const remote = await accountSession.client().listVoices();
                  if (remote.ok && remote.data) {
                    const { saveMissingRemoteVoices } = await import('@/storage/voiceStore');
                    await saveMissingRemoteVoices(remote.data);
                  }
                  toast(remote.ok ? '已登录' : '已登录，音色稍后再同步');
                });
              }}
            >
              登录
            </Button>
          </div>
        </>
      )}
    </>
  );
}
