import { useState } from 'react';
import { accountSession } from '@/account/session';
import { SPONSOR_OFFER, type SponsorChannel } from '@/tts/account';
import { Button } from '@/ui';
import alipayQr from '../../../services/voice-enroll/app/static/sponsor-alipay.png';
import wechatQr from '../../../services/voice-enroll/app/static/sponsor-wechat.png';

const QR_SRC: Record<SponsorChannel, string> = {
  wechat: wechatQr,
  alipay: alipayQr,
};

/** 添加音色前的赞助说明。收款码打进客户端，不依赖服务端图片地址。 */
export function VoiceSponsor({
  toast,
  onSponsored,
}: {
  toast: (text: string) => void;
  onSponsored: () => void;
}) {
  const [pending, setPending] = useState<SponsorChannel | null>(null);

  const confirm = (channel: SponsorChannel) => {
    setPending(channel);
    void accountSession
      .client()
      .sponsor(channel)
      .then(async (result) => {
        if (!result.ok) {
          toast(result.message || '没能记下这笔赞助');
          return;
        }
        const me = await accountSession.client().me();
        if (me.data) accountSession.remember(me.data);
        onSponsored();
        toast('已记下，可以继续添加音色');
      })
      .finally(() => setPending(null));
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
            <Button size="sm" disabled={pending != null} onClick={() => confirm(item.channel)}>
              {pending === item.channel ? '正在记下' : `我已用${item.label}赞助`}
            </Button>
          </figure>
        ))}
      </div>
      <p className="desc">{SPONSOR_OFFER.note}</p>
    </div>
  );
}
