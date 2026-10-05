import { getCollectionItems } from '../api/collectionsApi';

describe('getCollectionItems - calendar day', () => {
  it('sends the local calendar DATE as-is and no UTC bounds', async () => {
    const request = jest.fn().mockResolvedValue({ status: 200, body: { items: [], nextCursor: null } });

    await getCollectionItems(request as never, 7, { limit: 25, sort: 'dateDesc', date: '2026-10-05' });

    const path = request.mock.calls[0][0].path as string;
    const query = new URLSearchParams(path.split('?')[1]);
    expect(path.startsWith('/api/v1/collections/7/items?')).toBe(true);
    expect(query.get('date')).toBe('2026-10-05');
    expect(query.get('sort')).toBe('dateDesc');
    expect(query.has('fromUtc')).toBe(false);
    expect(query.has('toUtc')).toBe(false);
  });

  it('keeps the section window (fromUtc/toUtc) for the date-ordered list, without a date', async () => {
    const request = jest.fn().mockResolvedValue({ status: 200, body: { items: [], nextCursor: null } });

    await getCollectionItems(request as never, 7, { sort: 'dateDesc', fromUtc: '2026-10-01T00:00:00Z', toUtc: '2026-11-01T00:00:00Z' });

    const query = new URLSearchParams((request.mock.calls[0][0].path as string).split('?')[1]);
    expect(query.get('fromUtc')).toBe('2026-10-01T00:00:00Z');
    expect(query.has('date')).toBe(false);
  });
});
