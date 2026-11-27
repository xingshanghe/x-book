import { useLocation } from 'wouter';
import { useAccountProfile } from '@/features/settings/useAccountProfile';
import { IconUser } from '@/ui/icons';

/** 书架顶栏右侧账号入口：用户图标，打开个人中心。 */
export function ShelfAccount() {
  const [, navigate] = useLocation();
  const profile = useAccountProfile();

  const openAccount = () => {
    navigate('/settings');
    window.location.hash = 'account';
  };

  const label = profile ? `个人中心 · ${profile.username}` : '账号';

  return (
    <div className="shelf-account">
      <button
        type="button"
        className="shelf-account-icon"
        aria-label={label}
        title={profile?.username ?? '账号'}
        onClick={openAccount}
      >
        <IconUser size={20} />
      </button>
    </div>
  );
}
