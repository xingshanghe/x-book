import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VoiceList } from '@/features/settings/VoiceList';

const noop = () => undefined;

describe('音色列表', () => {
  it('引擎示例和自己的音色在同一列表里，都可以删除', () => {
    const html = renderToStaticMarkup(
      <VoiceList
        voices={[{ id: 'a', name: '我的音色' }]}
        builtinHidden={false}
        onRename={noop}
        onRemove={noop}
        onHideBuiltin={noop}
        onRestoreBuiltin={noop}
      />,
    );
    expect(html).toContain('引擎示例（雷军）');
    expect(html).toContain('我的音色');
    expect(html).toContain('删除');
    expect(html).toContain('改名');
    expect(html).not.toContain('恢复引擎示例');
  });

  it('移除引擎示例后列表不再显示它，并可以恢复', () => {
    const html = renderToStaticMarkup(
      <VoiceList
        voices={[]}
        builtinHidden
        onRename={noop}
        onRemove={noop}
        onHideBuiltin={noop}
        onRestoreBuiltin={noop}
      />,
    );
    expect(html).not.toContain('引擎示例（雷军）');
    expect(html).toContain('恢复引擎示例');
    expect(html).toContain('列表里还没有音色');
  });
});
