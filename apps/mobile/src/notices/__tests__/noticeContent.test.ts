import { noticeBlocks, safeNoticeUrl } from '../noticeContent';
it('formats lists and HTTPS links without HTML execution or unsafe links', () => {
  const blocks = noticeBlocks(
    'Body\n- List\n2. Second\n[Help](https://juple.co.kr/help)\n<script>alert(1)</script>',
  );
  expect(blocks[1].kind).toBe('bullet');
  expect(blocks[2].marker).toBe('2');
  expect(blocks[3].runs[0].href).toBe('https://juple.co.kr/help');
  expect(blocks[4].runs[0].text).toBe('<script>alert(1)</script>');
  for (const value of [
    'javascript:alert(1)',
    'data:hello',
    'http://juple.co.kr',
    'https://u:p@juple.co.kr',
  ])
    expect(safeNoticeUrl(value)).toBeNull();
});
