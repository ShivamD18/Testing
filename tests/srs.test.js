const test = require('node:test');
const assert = require('node:assert/strict');
const srs = require('../js/srs.js');

const NOW = new Date(2026, 10, 2, 15, 0, 0).getTime();
const day = (n) => {
  const d = new Date(NOW);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d.getTime();
};

test('new card intervals are increasing: Again < Hard <= Good < Easy', () => {
  const iv = srs.nextIntervals(null);
  assert.deepEqual(iv, { 1: 0, 2: 1, 3: 2, 4: 4 });
});

test('Good on a new card schedules for the start of the day 2 days later', () => {
  const s = srs.schedule(null, 3, NOW);
  assert.equal(s.reps, 1);
  assert.equal(s.interval, 2);
  assert.equal(s.due, day(2));
  assert.equal(s.ease, 2.5);
});

test('intervals grow with ease and stay strictly ordered', () => {
  let s = srs.schedule(null, 3, NOW);
  s = srs.schedule(s, 3, NOW);
  assert.equal(s.interval, 5); // 2 * 2.5
  const iv = srs.nextIntervals(s);
  assert.ok(iv[2] < iv[3] && iv[3] < iv[4], JSON.stringify(iv));
  assert.equal(iv[3], 13); // round(5 * 2.5)
});

test('Again resets reps, counts a lapse, lowers ease and is due within minutes', () => {
  let s = srs.schedule(null, 3, NOW);
  s = srs.schedule(s, 3, NOW);
  const lapsed = srs.schedule(s, 1, NOW);
  assert.equal(lapsed.reps, 0);
  assert.equal(lapsed.lapses, 1);
  assert.equal(lapsed.interval, 0);
  assert.ok(Math.abs(lapsed.ease - 2.3) < 1e-9);
  assert.ok(lapsed.due > NOW && lapsed.due < NOW + 5 * 60 * 1000);
  // relearned card comes back after 1 day on Good
  assert.equal(srs.schedule(lapsed, 3, NOW).interval, 1);
});

test('ease never drops below 1.3 and intervals cap at a year', () => {
  let s = null;
  for (let i = 0; i < 20; i++) s = srs.schedule(s, i % 2 ? 1 : 2, NOW);
  assert.ok(s.ease >= 1.3);
  let t = null;
  for (let i = 0; i < 30; i++) t = srs.schedule(t, 4, NOW);
  assert.equal(t.interval, 365);
});

test('buildQueue: due reviews first (oldest first), then limited new cards in deck order', () => {
  const cards = [
    { id: 'n1', srs: null },
    { id: 'r-late', srs: { due: NOW - 1000, interval: 3 } },
    { id: 'n2', srs: null },
    { id: 'future', srs: { due: NOW + 1e9, interval: 9 } },
    { id: 'r-early', srs: { due: NOW - 5000, interval: 3 } },
    { id: 'n3', srs: null },
  ];
  assert.deepEqual(srs.buildQueue(cards, 2, NOW), ['r-early', 'r-late', 'n1', 'n2']);
  const st = srs.deckStats(cards, NOW);
  assert.deepEqual({ ...st, nextDue: !!st.nextDue }, { total: 6, new: 3, due: 2, learned: 3, nextDue: true });
});

test('formatting helpers', () => {
  assert.equal(srs.formatInterval(0), '<1m');
  assert.equal(srs.formatInterval(3), '3d');
  assert.equal(srs.formatInterval(45), '1.5mo');
  assert.equal(srs.formatInterval(365), '1y');
  assert.equal(srs.formatDue(day(1) + 1000, NOW), 'due tomorrow');
  assert.equal(srs.formatDue(NOW - 1, NOW), 'due now');
});
