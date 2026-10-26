import { describe, expect, it } from 'vitest';
import { createAccountSession } from '@/account/session';
import thanksFile from '@/features/settings/thanks.json';
import { voiceDraftError } from '@/storage/voiceStore';
import { createAccountClient, voiceAccessLabel } from '@/tts/account';
import { canSubmitEnroll } from '@/tts/enroll';

describe('建档与账号', () => {
  it('未授权或未登录时不能提交', () => {
    expect(canSubmitEnroll({ loggedIn: false, consent: true, durationMs: 10_000 })).toBe(false);
    expect(canSubmitEnroll({ loggedIn: true, consent: false, durationMs: 10_000 })).toBe(false);
    expect(canSubmitEnroll({ loggedIn: true, consent: true, durationMs: 10_000 })).toBe(true);
    expect(canSubmitEnroll({ loggedIn: true, consent: true, durationMs: 30_000 })).toBe(false);
  });

  it('鸣谢名单来自客户端文件，赞助不会往里写', () => {
    expect(thanksFile.intro.length).toBeGreaterThan(0);
    expect(Array.isArray(thanksFile.entries)).toBe(true);
  });

  it('未赞助和已赞助的账号文案不同', () => {
    expect(
      voiceAccessLabel({ id: '1', username: 'reader', enrollCredits: 0, sponsored: false }),
    ).toBe('reader · 音色管理未开通');
    expect(
      voiceAccessLabel({
        id: '1',
        username: 'reader',
        enrollCredits: 0,
        sponsored: true,
        voiceCount: 1,
        voiceLimit: 3,
      }),
    ).toBe('reader · 音色 1/3');
  });

  it('对齐文本为空时拒绝写入音色包', () => {
    expect(voiceDraftError('妈妈', '')).toBe('对齐文本不能为空');
    expect(voiceDraftError('妈妈', '今天天气不错。')).toBeNull();
  });

  it('构造账号客户端时不发请求', async () => {
    let calls = 0;
    const client = createAccountClient({
      endpoint: 'https://enroll.example',
      fetchImpl: async () => {
        calls += 1;
        return Response.json({ success: true, code: 0, message: 'ok', data: null });
      },
      storage: memoryStorage(),
    });
    expect(calls).toBe(0);
    expect(client.requestCount).toBe(0);
    expect(client.accessToken()).toBeNull();
  });

  it('没有刷新令牌时恢复会话不发请求', async () => {
    let calls = 0;
    const session = createAccountSession({
      storage: memoryStorage(),
      fetchImpl: async () => {
        calls += 1;
        return Response.json({ success: true, code: 0, message: 'ok', data: null });
      },
    });
    expect(await session.restore()).toBeNull();
    expect(calls).toBe(0);
    expect(session.readEndpoint()).toBe('http://118.25.79.136');
    session.writeEndpoint('http://127.0.0.1:8787');
    expect(calls).toBe(0);
    expect(session.readEndpoint()).toBe('http://127.0.0.1:8787');
  });

  it('改口令才会请求', async () => {
    const paths: string[] = [];
    const client = createAccountClient({
      endpoint: 'https://enroll.example',
      fetchImpl: async (input) => {
        paths.push(String(input));
        return Response.json({
          success: true,
          code: 0,
          message: 'ok',
          data: {
            accessToken: 'a',
            refreshToken: 'b',
            tokenType: 'Bearer',
            accessExpiresIn: 1,
            refreshExpiresIn: 1,
          },
        });
      },
      storage: memoryStorage(),
    });
    expect(client.requestCount).toBe(0);
    await client.changePassword('old-password', 'new-password-1');
    expect(paths).toEqual(['https://enroll.example/v1/auth/password']);
  });
});

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}
