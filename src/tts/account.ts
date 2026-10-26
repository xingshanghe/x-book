/**
 * 建档账号。模块加载和构造客户端都不会发请求。
 * 只有 register / login / refresh / logout / me / changePassword / enroll / listVoices / sponsor 会。
 */

import { isTauri } from '@/lib/platform';
import { accountFetch } from './accountTransport';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  accessExpiresIn: number;
  refreshExpiresIn: number;
}

export interface AccountProfile {
  id: string;
  username: string;
  enrollCredits: number;
  /** 旧服务仍可能带回这个字段。音色管理已改为赞助一次开通。 */
  chargeCredits?: boolean;
  sponsored?: boolean;
  sponsorChannel?: string;
  voiceCount?: number;
  voiceLimit?: number;
}

export type SponsorChannel = 'wechat' | 'alipay';

export interface SponsorQr {
  channel: SponsorChannel;
  label: string;
  qrPath: string;
}

export interface SponsorOffer {
  title: string;
  body: string;
  amountNote: string;
  note: string;
  qrs: SponsorQr[];
  voiceLimit: number;
}

export const VOICE_KEEP_LIMIT = 3;

export const SPONSOR_OFFER: SponsorOffer = {
  title: '赞助一杯咖啡',
  body: '添加音色时，声音样本要在服务器上处理。机器和流量是我自己在维护，需要赞助一杯咖啡来维持这项基础服务。每人最多保留 3 个音色，删掉一个就可以再加一个。',
  amountNote: '',
  note: '付完后点一下你用的那一种。',
  qrs: [
    { channel: 'wechat', label: '微信', qrPath: '/v1/sponsor/qrcode/wechat' },
    { channel: 'alipay', label: '支付宝', qrPath: '/v1/sponsor/qrcode/alipay' },
  ],
  voiceLimit: VOICE_KEEP_LIMIT,
};

export interface AccountResult<T> {
  ok: boolean;
  status: number;
  message: string;
  data: T | null;
}

export interface AccountClient {
  register(username: string, password: string): Promise<AccountResult<AuthTokens>>;
  login(username: string, password: string): Promise<AccountResult<AuthTokens>>;
  refresh(): Promise<AccountResult<AuthTokens>>;
  logout(): Promise<AccountResult<{ success: boolean }>>;
  changePassword(oldPassword: string, newPassword: string): Promise<AccountResult<AuthTokens>>;
  clearLocal(): void;
  me(): Promise<AccountResult<AccountProfile>>;
  sponsorOffer(): Promise<AccountResult<SponsorOffer>>;
  sponsor(channel: SponsorChannel): Promise<AccountResult<{ sponsored: boolean; channel: string }>>;
  deleteVoice(id: string): Promise<AccountResult<{ success: boolean }>>;
  enroll(
    file: Blob,
    transcript: string,
  ): Promise<AccountResult<{ id: string; refText: string; quality: number }>>;
  listVoices(): Promise<
    AccountResult<Array<{ id: string; refText: string; quality: number; wavBase64: string }>>
  >;
  accessToken(): string | null;
  readonly requestCount: number;
}

export function createAccountClient(opts: {
  endpoint: string;
  fetchImpl?: typeof fetch;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}): AccountClient {
  const fetchImpl = opts.fetchImpl ?? desktopOrWebFetch;
  const storage = opts.storage;
  let access: string | null = null;
  let requests = 0;

  const refreshKey = 'qingyue.tts.refresh';

  const call = async <T>(
    path: string,
    init: RequestInit,
    auth: boolean,
  ): Promise<AccountResult<T>> => {
    requests += 1;
    const headers = new Headers(init.headers);
    if (auth && access) headers.set('Authorization', `Bearer ${access}`);
    if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    let response: Response;
    try {
      response = await fetchImpl(`${opts.endpoint.replace(/\/$/, '')}${path}`, {
        ...init,
        headers,
      });
    } catch (error) {
      return { ok: false, status: 0, message: failureText(error), data: null };
    }
    let body: { success?: boolean; message?: string; data?: T };
    try {
      body = (await response.json()) as { success?: boolean; message?: string; data?: T };
    } catch {
      return { ok: false, status: response.status, message: '账号服务没有返回结果', data: null };
    }
    return {
      ok: response.ok && body.success !== false,
      status: response.status,
      message: body.message ?? '',
      data: body.data ?? null,
    };
  };

  const keep = (data: AuthTokens | null) => {
    if (!data) return;
    access = data.accessToken;
    storage?.setItem(refreshKey, data.refreshToken);
  };

  return {
    get requestCount() {
      return requests;
    },
    accessToken: () => access,
    async register(username, password) {
      const result = await call<AuthTokens>(
        '/v1/auth/register',
        {
          method: 'POST',
          body: JSON.stringify({ username, password }),
        },
        false,
      );
      if (result.ok) keep(result.data);
      return result;
    },
    async login(username, password) {
      const result = await call<AuthTokens>(
        '/v1/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({ username, password }),
        },
        false,
      );
      if (result.ok) keep(result.data);
      return result;
    },
    async refresh() {
      const refreshToken = storage?.getItem(refreshKey) ?? '';
      const result = await call<AuthTokens>(
        '/v1/auth/refresh',
        {
          method: 'POST',
          body: JSON.stringify({ refreshToken }),
        },
        false,
      );
      if (result.ok) keep(result.data);
      return result;
    },
    async logout() {
      const refreshToken = storage?.getItem(refreshKey) ?? '';
      const result = await call<{ success: boolean }>(
        '/v1/auth/logout',
        {
          method: 'POST',
          body: JSON.stringify({ refreshToken }),
        },
        false,
      );
      access = null;
      storage?.removeItem(refreshKey);
      return result;
    },
    async changePassword(oldPassword, newPassword) {
      const result = await call<AuthTokens>(
        '/v1/auth/password',
        {
          method: 'POST',
          body: JSON.stringify({ oldPassword, newPassword }),
        },
        true,
      );
      if (result.ok) keep(result.data);
      return result;
    },
    clearLocal() {
      access = null;
      storage?.removeItem(refreshKey);
    },
    me() {
      return call<AccountProfile>('/v1/auth/me', { method: 'GET' }, true);
    },
    sponsorOffer() {
      return call<SponsorOffer>('/v1/sponsor', { method: 'GET' }, false);
    },
    sponsor(channel) {
      return call<{ sponsored: boolean; channel: string }>(
        '/v1/account/sponsor',
        { method: 'POST', body: JSON.stringify({ channel }) },
        true,
      );
    },
    deleteVoice(id) {
      return call<{ success: boolean }>(
        `/v1/voices/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
        true,
      );
    },
    enroll(file, transcript) {
      const body = new FormData();
      body.set('audio', file, 'sample.wav');
      body.set('transcript', transcript);
      body.set('consent', 'true');
      return call<{ id: string; refText: string; quality: number }>(
        '/v1/voices/enroll',
        {
          method: 'POST',
          body,
        },
        true,
      );
    },
    listVoices() {
      return call<Array<{ id: string; refText: string; quality: number; wavBase64: string }>>(
        '/v1/voices',
        { method: 'GET' },
        true,
      );
    },
  };
}

function desktopOrWebFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (isTauri()) return accountFetch(input, init);
  return fetch(input, init);
}

function failureText(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return '连不上账号服务';
}
