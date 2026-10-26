import { useLocation } from 'wouter';

/** 书架右上角的账号入口，打开个人中心里的账号。 */
export function ShelfAccount() {
  const [, navigate] = useLocation();

  return (
    <div className="shelf-account">
      <button
        type="button"
        className="shelf-account-btn"
        aria-label="账号"
        onClick={() => {
          navigate('/settings');
          window.location.hash = 'account';
        }}
      >
        账号
      </button>
    </div>
  );
}
