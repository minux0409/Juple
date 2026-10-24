import assert from 'node:assert/strict';
import { it } from 'node:test';
import { noticeBlocks, safeNoticeUrl } from '../lib/noticeContent.ts';
it('supports paragraphs, bullets, numbered lists and HTTPS links while preserving HTML as inert text', () => {
  const blocks = noticeBlocks(
    'Paragraph\n- Bullet\n2. Second\n[Help](https://juple.co.kr/help)\n<script>alert(1)</script>',
  );
  assert.equal(blocks[1].kind, 'bullet');
  assert.equal(blocks[2].kind, 'number');
  assert.equal(blocks[2].marker, '2');
  assert.equal(blocks[3].runs[0].href, 'https://juple.co.kr/help');
  assert.equal(blocks[4].runs[0].text, '<script>alert(1)</script>');
});
it('rejects dangerous schemes and embedded credentials', () => {
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,hello',
    'http://juple.co.kr',
    'https://user:pass@juple.co.kr',
  ])
    assert.equal(safeNoticeUrl(url), null);
});
