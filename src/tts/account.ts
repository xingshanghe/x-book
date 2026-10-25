/**
 * 建档账号。模块加载和构造客户端都不会发请求。
 * 只有 register / login / refresh / logout / me / changePassword / enroll / listVoices 会。
 */

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
}

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
  const fetchImpl = opts.fetchImpl ?? fetch;
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
    const response = await fetchImpl(`${opts.endpoint.replace(/\/$/, '')}${path}`, {
      ...init,
      headers,
    });
    const body = (await response.json()) as { success?: boolean; message?: string; data?: T };
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
