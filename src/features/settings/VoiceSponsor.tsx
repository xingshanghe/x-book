import { useEffect, useState } from 'react';
import { accountSession } from '@/account/session';
import { SPONSOR_OFFER, type SponsorChannel, type SponsorOffer } from '@/tts/account';
import { Button } from '@/ui';

/** 添加音色前的赞助说明。收款码来自账号服务，文案在服务没连上时用本地这份。 */
export function VoiceSponsor({
  toast,
  onSponsored,
}: {
  toast: (text: string) => void;
  onSponsored: () => void;
}) {
  const [offer, setOffer] = useState<SponsorOffer>(SPONSOR_OFFER);
  const [pending, setPending] = useState<SponsorChannel | null>(null);
  const endpoint = accountSession.readEndpoint();

  useEffect(() => {
    void accountSession
      .client()
      .sponsorOffer()
      .then((result) => {
        if (result.data?.qrs?.length) setOffer(result.data);
      });
  }, []);

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
        toast('已开通音色管理，可以一直使用');
      })
      .finally(() => setPending(null));
  };

  return (
    <div className="sponsor-card">
      <h3>{offer.title}</h3>
      <p className="desc">{offer.body}</p>
      <p className="desc">{offer.amountNote}</p>
      <div className="sponsor-qrs">
        {offer.qrs.map((item) => (
          <figure className="sponsor-qr" key={item.channel}>
            <img src={`${endpoint}${item.qrPath}`} alt={`${item.label}收款码`} />
            <figcaption>{item.label}</figcaption>
            <Button size="sm" disabled={pending != null} onClick={() => confirm(item.channel)}>
              {pending === item.channel ? '正在记下' : `我已用${item.label}赞助`}
            </Button>
          </figure>
        ))}
      </div>
      <p className="desc">{offer.note}</p>
    </div>
  );
}
