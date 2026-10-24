export interface NoticeRun {
  readonly text: string;
  readonly href?: string;
}
export interface NoticeBlock {
  readonly kind: 'paragraph' | 'bullet' | 'number';
  readonly marker?: string;
  readonly runs: readonly NoticeRun[];
}
export function safeNoticeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function noticeBlocks(body: string): readonly NoticeBlock[] {
  return body.split(/\r?\n/).map(line => {
    const bullet = /^\s*[-*]\s+/.test(line),
      numbered = /^\s*\d+\.\s+/.test(line);
    const text = line.replace(/^\s*(?:[-*]|\d+\.)\s+/, '');
    const runs: NoticeRun[] = [];
    let offset = 0;
    for (const match of text.matchAll(
      /\[([^\]\n]{1,200})\]\((https:\/\/[^\s)]{1,2048})\)/g,
    )) {
      if (match.index > offset)
        runs.push({ text: text.slice(offset, match.index) });
      const href = safeNoticeUrl(match[2]);
      runs.push(href ? { text: match[1], href } : { text: match[0] });
      offset = match.index + match[0].length;
    }
    if (offset < text.length || !runs.length)
      runs.push({ text: text.slice(offset) });
    return {
      kind: bullet ? 'bullet' : numbered ? 'number' : 'paragraph',
      marker: numbered ? line.match(/^\s*(\d+)\./)?.[1] : undefined,
      runs,
    };
  });
}
