/**
 * 账号会话。构造和导入都不发请求。
 * 只有 restore / register / login / logout / changePassword 会访问建档服务。
 */

import {
  type AccountClient,
  type AccountProfile,
  type AccountResult,
  type AuthTokens,
  createAccountClient,
} from '@/tts/account';

const ENDPOINT_KEY = 'qingyue.tts.endpoint';
const REFRESH_KEY = 'qingyue.tts.refresh';

/** 未单独填写服务地址时，账号和建档都走这台机器。 */
export const DEFAULT_ENROLL_ENDPOINT = 'http://118.25.79.136';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface AccountSession {
  readEndpoint(): string;
  writeEndpoint(value: string): void;
  hasStoredSession(): boolean;
  profile(): AccountProfile | null;
  subscribe(listener: (profile: AccountProfile | null) => void): () => void;
  client(): AccountClient;
  restore(): Promise<AccountProfile | null>;
  register(username: string, password: string): Promise<AccountResult<AccountProfile>>;
  login(username: string, password: string): Promise<AccountResult<AccountProfile>>;
  logout(): Promise<AccountResult<{ success: boolean }>>;
  changePassword(oldPassword: string, newPassword: string): Promise<AccountResult<AuthTokens>>;
  remember(profile: AccountProfile | null): void;
}

export function createAccountSession(opts: {
  storage: StorageLike;
  fetchImpl?: typeof fetch;
}): AccountSession {
  let profile: AccountProfile | null = null;
  let client: AccountClient | null = null;
  let clientHost = '';
  let restoring: Promise<AccountProfile | null> | null = null;
  const listeners = new Set<(profile: AccountProfile | null) => void>();

  const emit = () => {
    for (const listener of listeners) listener(profile);
  };

  const endpoint = () => {
    const stored = (opts.storage.getItem(ENDPOINT_KEY) ?? '').trim().replace(/\/$/, '');
    return stored || DEFAULT_ENROLL_ENDPOINT;
  };

  const currentClient = () => {
    const host = endpoint();
    if (!client || clientHost !== host) {
      clientHost = host;
      client = createAccountClient({
        endpoint: host,
        fetchImpl: opts.fetchImpl,
        storage: opts.storage,
      });
    }
    return client;
  };

  const adopt = async (
    result: AccountResult<AuthTokens>,
  ): Promise<AccountResult<AccountProfile>> => {
    if (!result.ok)
      return { ok: false, status: result.status, message: result.message, data: null };
    const me = await currentClient().me();
    profile = me.data;
    emit();
    return me;
  };

  return {
    readEndpoint: endpoint,
    writeEndpoint(value) {
      const next = value.trim().replace(/\/$/, '');
      if (next === endpoint()) return;
      opts.storage.setItem(ENDPOINT_KEY, next);
      currentClient().clearLocal();
      client = null;
      clientHost = '';
      profile = null;
      emit();
    },
    hasStoredSession() {
      return Boolean(opts.storage.getItem(REFRESH_KEY));
    },
    profile: () => profile,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    client: currentClient,
    restore() {
      if (profile) return Promise.resolve(profile);
      if (!opts.storage.getItem(REFRESH_KEY)) return Promise.resolve(null);
      if (restoring) return restoring;
      restoring = (async () => {
        const refreshed = await currentClient().refresh();
        if (!refreshed.ok) {
          currentClient().clearLocal();
          profile = null;
          emit();
          return null;
        }
        const me = await currentClient().me();
        profile = me.ok ? me.data : null;
        emit();
        return profile;
      })().finally(() => {
        restoring = null;
      });
      return restoring;
    },
    register: (username, password) => currentClient().register(username, password).then(adopt),
    login: (username, password) => currentClient().login(username, password).then(adopt),
    async logout() {
      const result = await currentClient().logout();
      profile = null;
      emit();
      return result;
    },
    changePassword: (oldPassword, newPassword) =>
      currentClient().changePassword(oldPassword, newPassword),
    remember(next) {
      profile = next;
      emit();
    },
  };
}

function browserStorage(): StorageLike {
  if (typeof localStorage === 'undefined') {
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
  return localStorage;
}

export const accountSession = createAccountSession({ storage: browserStorage() });
