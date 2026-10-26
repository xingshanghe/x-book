import { useEffect, useState } from 'react';
import { accountSession } from '@/account/session';
import { SPONSOR_OFFER, type SponsorChannel } from '@/tts/account';
import { Button } from '@/ui';
import { IconClose } from '@/ui/icons';
import alipayQr from '../../../services/voice-enroll/app/static/sponsor-alipay.png';
import wechatQr from '../../../services/voice-enroll/app/static/sponsor-wechat.png';

const QR_SRC: Record<SponsorChannel, string> = {
  wechat: wechatQr,
  alipay: alipayQr,
};

function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** 收款码打进客户端。付款结果感知不到，只留下一条可提交的记录。 */
export function VoiceSponsor({
  loggedIn,
  username,
  toast,
}: {
  loggedIn: boolean;
  username: string;
  toast: (text: string) => void;
}) {
  const [name, setName] = useState(username);
  const [phone, setPhone] = useState('');
  const [paidOn, setPaidOn] = useState(today);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);

  useEffect(() => {
    setName((current) => (current.trim() ? current : username));
  }, [username]);

  useEffect(() => {
    if (!recordOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRecordOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [recordOpen]);

  const submit = () => {
    if (!loggedIn) {
      toast('请先登录');
      return;
    }
    const sponsorName = name.trim();
    if (!sponsorName || sponsorName.length > 32) {
      toast('请填写赞助人');
      return;
    }
    if (!/^1\d{10}$/.test(phone.trim())) {
      toast('请填写手机号');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) {
      toast('请填写日期');
      return;
    }
    if (note.trim().length > 200) {
      toast('备注太长');
      return;
    }
    setPending(true);
    void accountSession
      .client()
      .submitSponsorRecord({
        name: sponsorName,
        phone: phone.trim(),
        paidOn,
        note: note.trim(),
      })
      .then((result) => {
        if (!result.ok) {
          toast(result.message || '没能记下这笔赞助');
          return;
        }
        setPhone('');
        setNote('');
        setRecordOpen(false);
        toast('已记下');
      })
      .finally(() => setPending(false));
  };

  return (
    <div className="sponsor-card">
      <h3>{SPONSOR_OFFER.title}</h3>
      <p className="desc">{SPONSOR_OFFER.body}</p>
      <div className="sponsor-qrs">
        {SPONSOR_OFFER.qrs.map((item) => (
          <figure className="sponsor-qr" key={item.channel}>
            <img src={QR_SRC[item.channel]} alt={`${item.label}收款码`} />
            <figcaption>{item.label}</figcaption>
          </figure>
        ))}
      </div>
      <Button size="sm" onClick={() => setRecordOpen(true)}>
        提交记录
      </Button>
      {recordOpen && (
        <div className="qy-overlay sponsor-modal">
          <button
            type="button"
            className="sponsor-dialog-backdrop"
            aria-label="关闭"
            onClick={() => setRecordOpen(false)}
          />
          <div
            className="sponsor-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sponsor-record-title"
          >
            <div className="sponsor-dialog-head">
              <h3 id="sponsor-record-title">提交记录</h3>
              <button
                type="button"
                className="qy-icon-btn"
                onClick={() => setRecordOpen(false)}
                aria-label="关闭"
              >
                <IconClose size={16} />
              </button>
            </div>
            <form
              className="sponsor-record"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <label>
                赞助人
                <input
                  value={name}
                  maxLength={32}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label>
                手机号
                <input
                  value={phone}
                  inputMode="numeric"
                  maxLength={11}
                  onChange={(event) => setPhone(event.target.value)}
                />
              </label>
              <label>
                日期
                <input
                  type="date"
                  value={paidOn}
                  onChange={(event) => setPaidOn(event.target.value)}
                />
              </label>
              <label>
                备注
                <textarea
                  value={note}
                  rows={2}
                  maxLength={200}
                  onChange={(event) => setNote(event.target.value)}
                />
              </label>
              <Button size="sm" type="submit" disabled={pending}>
                {pending ? '正在记下' : '提交记录'}
              </Button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
