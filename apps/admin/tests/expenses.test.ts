import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAdminApi, AdminForbiddenError } from '../lib/adminApi.ts';
import {
  blankExpense,
  categories,
  expenseQuery,
  initialFilters,
  money,
  validateExpense,
} from '../lib/expenses.ts';

describe('expense operator workflows', () => {
  it('year and exact filter values round trip without query injection or a lost cursor', () => {
    const filters = {
      ...initialFilters('2026-10-20'),
      provider: 'A&B=company',
      category: 'Software',
      currency: 'USD',
      status: 'Paid',
      paymentMethod: 'card',
      environment: 'DEV',
      serviceName: 'SQL Database',
    };
    const query = new URLSearchParams(expenseQuery(filters, 120));
    assert.equal(query.get('from'), '2026-01-01');
    assert.equal(query.get('through'), '2026-12-31');
    assert.equal(query.get('provider'), 'A&B=company');
    assert.equal(query.get('cursor'), '120');
    assert.equal(query.get('status'), 'Paid');
    assert.equal(Object.keys(categories).length, 8);
  });
  it('forms require payment and currency details, keep decimals as text, distinguish unknown tax and support refunds', () => {
    const values = {
      ...blankExpense('2026-10-20'),
      name: 'Tool',
      provider: 'Company',
      paymentMethod: 'card',
      grossAmount: '123456.123456123456',
    };
    assert.equal(validateExpense(values), null);
    assert.equal(values.taxAmount, null);
    assert.ok(validateExpense({ ...values, status: 'Paid' }));
    assert.ok(validateExpense({ ...values, currency: 'usd' }));
    assert.ok(validateExpense({ ...values, netAmount: '100' }));
    assert.ok(
      validateExpense({ ...values, kind: 'Refund', grossAmount: '-10' }),
    );
    assert.equal(
      validateExpense({
        ...values,
        kind: 'Refund',
        grossAmount: '-10',
        originalExpenseId: 1,
      }),
      null,
    );
    assert.ok(validateExpense({ ...values, convertedCurrency: 'USD' }));
  });
  it('submits stable mutation IDs with exact decimal strings and a fresh token after one 401', async () => {
    const bodies: string[] = [];
    const methods: string[] = [];
    let attempts = 0;
    const api = createAdminApi({
      apiBaseUrl: 'https://test.invalid',
      getAccessToken: async () => 'test',
      fetchImpl: async (_input, init) => {
        bodies.push(String(init?.body));
        methods.push(String(init?.method));
        return ++attempts === 1
          ? new Response(null, { status: 401 })
          : Response.json({ ok: true });
      },
    });
    await api({
      path: '/api/v1/admin/expenses',
      method: 'POST',
      body: {
        requestId: 'stable-request',
        values: { grossAmount: '123456.123456123456' },
      },
    });
    assert.equal(bodies[0], bodies[1]);
    assert.match(bodies[0], /"123456.123456123456"/);
    assert.deepEqual(methods, ['POST', 'POST']);
  });
  it('downloads original CSV/XLSX/receipt bytes with bearer auth, no query token and no cookies', async () => {
    const payload = new Uint8Array([80, 75, 3, 4, 12]);
    const api = createAdminApi({
      apiBaseUrl: 'https://test.invalid',
      getAccessToken: async () => 'memory-only',
      fetchImpl: async (input, init) => {
        assert.equal(
          String(input),
          'https://test.invalid/api/v1/admin/expenses/export?format=xlsx',
        );
        assert.equal(init?.credentials, 'omit');
        assert.equal(init?.cache, 'no-store');
        assert.equal(
          (init?.headers as Record<string, string>).Authorization,
          'Bearer memory-only',
        );
        return new Response(payload);
      },
    });
    const blob = await api<Blob>({
      path: '/api/v1/admin/expenses/export?format=xlsx',
      responseType: 'blob',
    });
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), payload);
  });
  it('uploads multipart evidence without corrupting its boundary and treats revoked grant as forbidden', async () => {
    const body = new FormData();
    body.set('requestId', 'upload-id');
    body.set('file', new Blob(['%PDF-1.7']), 'receipt.pdf');
    const api = createAdminApi({
      apiBaseUrl: 'https://test.invalid',
      getAccessToken: async () => 'memory-only',
      fetchImpl: async (_input, init) => {
        assert.equal(init?.body, body);
        assert.equal(
          (init?.headers as Record<string, string>)['Content-Type'],
          undefined,
        );
        return new Response(null, { status: 403 });
      },
    });
    await assert.rejects(
      api({
        path: '/api/v1/admin/expenses/1/attachments',
        method: 'POST',
        body,
      }),
      AdminForbiddenError,
    );
  });
  it('formats each ledger currency independently without inventing a converted price', () => {
    assert.match(money('1.99', 'USD'), /1\.99/);
    assert.equal(money(null, 'KRW'), '미확인');
  });
});
