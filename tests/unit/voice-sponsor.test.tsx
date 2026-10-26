import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VoiceSponsor } from '@/features/settings/VoiceSponsor';

describe('赞助收款码', () => {
  it('页面上直接展示微信和支付宝收款码，记录表单留在弹窗里', () => {
    const html = renderToStaticMarkup(
      <VoiceSponsor loggedIn={false} username="" toast={() => undefined} />,
    );
    expect(html).toContain('微信');
    expect(html).toContain('支付宝');
    expect(html).toContain('<img');
    expect(html).toContain('提交记录');
    expect(html).not.toContain('赞助人');
    expect(html).not.toContain('role="dialog"');
  });
});
