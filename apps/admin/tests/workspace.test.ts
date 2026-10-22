import assert from 'node:assert/strict';
import { layoutBars } from '../lib/analytics.ts';
import { test } from 'node:test';
import { daysEnding, periodQuery, selectedPeriod, seoulToday, validatePeriod } from '../lib/workspace.ts';

test('KST boundary is independent of browser timezone and UTC midnight', () => {
  assert.equal(seoulToday(new Date('2026-10-20T14:59:59Z')), '2026-10-20');
  assert.equal(seoulToday(new Date('2026-10-20T15:00:00Z')), '2026-10-21');
  assert.deepEqual(daysEnding('2024-03-01', 7), { from: '2024-02-24', through: '2024-03-01' });
});
test('period validates impossible, reversed, future and oversized dates', () => {
  for (const p of [{ from: '2026-02-30', through: '2026-03-01' }, { from: '2026-10-21', through: '2026-10-20' }, { from: '2026-10-20', through: '2026-10-21' }, { from: '2025-01-01', through: '2026-10-20' }]) assert.ok(validatePeriod(p, '2026-10-20'));
  assert.equal(validatePeriod({ from: '2026-10-20', through: '2026-10-20' }, '2026-10-20'), null);
  assert.equal(validatePeriod({ from: '2024-01-01', through: '2024-12-31' }, '2026-10-20'), null);
});
test('default is seven days and explicit period survives navigation query strings', () => {
  assert.deepEqual(selectedPeriod(new URLSearchParams(), '2026-10-20'), { from: '2026-10-14', through: '2026-10-20' });
  const period = { from: '2026-10-01', through: '2026-10-20' };
  assert.deepEqual(selectedPeriod(new URLSearchParams(periodQuery(period)), '2026-10-20'), period);
});

test('shared charts render refunds below zero with valid bar geometry', () => {
  const chart=layoutBars([100,-50,0,null],['a','b','c','d'],600,160);
  assert.ok(chart.ticks.some(x=>x.value<0));
  assert.ok(chart.bars.every(x=>x.height>=0 && x.y>=0 && x.y+x.height<=160.000001));
  assert.equal(chart.bars[1].value,-50);assert.equal(chart.bars[3].height,0);
});
