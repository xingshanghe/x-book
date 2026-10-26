import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VoiceSponsor } from '@/features/settings/VoiceSponsor';

describe('赞助收款码', () => {
  it('页面上是微信和支付宝按钮，收款码留在弹窗里', () => {
    const html = renderToStaticMarkup(
      <VoiceSponsor loggedIn={false} username="" toast={() => undefined} />,
    );
    expect(html).toContain('微信');
    expect(html).toContain('支付宝');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('role="dialog"');
  });
});
