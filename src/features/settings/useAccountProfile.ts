import { useEffect, useState } from 'react';
import { accountSession } from '@/account/session';
import type { AccountProfile } from '@/tts/account';

/** 订阅当前会话。不会自己发请求。 */
export function useAccountProfile(): AccountProfile | null {
  const [profile, setProfile] = useState<AccountProfile | null>(() => accountSession.profile());
  useEffect(() => accountSession.subscribe(setProfile), []);
  return profile;
}
