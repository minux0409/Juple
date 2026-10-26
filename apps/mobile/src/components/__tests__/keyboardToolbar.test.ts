import { orderedFields } from '../keyboardToolbar';

/** A mounted field at (x, y) - or not laid out / not editable. */
function field(name: string, x: number, y: number, options: { readonly editable?: boolean; readonly size?: number } = {}) {
  const size = options.size ?? 40;
  return {
    name,
    ref: { current: { measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => callback(x, y, size, size) } as never },
    isEditable: () => options.editable !== false,
  };
}

describe('keyboard toolbar - the order ↑ / ↓ move in', () => {
  it('reading order: top to bottom, and left to right within one row', async () => {
    const memo = field('memo', 16, 400);
    const title = field('title', 16, 120);
    const right = field('right', 200, 122);
    const order = await orderedFields(new Set([memo, right, title]));
    expect(order.map(entry => (entry as unknown as { name: string }).name)).toEqual(['title', 'right', 'memo']);
  });

  it('skips a field that is not editable or not laid out (hidden)', async () => {
    const shown = field('shown', 16, 100);
    const readOnly = field('readOnly', 16, 200, { editable: false });
    const hidden = field('hidden', 16, 300, { size: 0 });
    const order = await orderedFields(new Set([shown, readOnly, hidden]));
    expect(order.map(entry => (entry as unknown as { name: string }).name)).toEqual(['shown']);
  });
});
