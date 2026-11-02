/*
 * Spaced repetition scheduling (a simplified SM-2, the algorithm family Anki uses).
 *
 * Card state (card.srs) is null for new cards, otherwise:
 *   { due, interval, ease, reps, lapses, last }
 *   due       epoch ms when the card should be reviewed next
 *   interval  days until next review (0 = relearning, shown again this session)
 *   ease      growth factor for the interval (starts at 2.5, min 1.3)
 *   reps      successful reviews in a row
 *   lapses    times the card was forgotten after being learned
 *
 * Ratings: 1 = Again, 2 = Hard, 3 = Good, 4 = Easy.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.FC = root.FC || {}).srs = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MIN = 60 * 1000;
  const DAY = 24 * 60 * MIN;
  const MIN_EASE = 1.3;
  const MAX_INTERVAL = 365;
  const RELEARN_DELAY = 1 * MIN;

  function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function addDays(ts, days) {
    const d = new Date(startOfDay(ts));
    d.setDate(d.getDate() + days);
    return d.getTime();
  }

  function dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** Interval in days each rating would give, without changing the state. */
  function nextIntervals(state) {
    const s = state || { reps: 0, ease: 2.5, interval: 0 };
    const ease = s.ease || 2.5;
    let hard;
    let good;
    let easy;
    if (!s.reps) {
      // New card, or one that was just forgotten and relearned.
      hard = 1;
      good = s.lapses ? 1 : 2;
      easy = 4;
    } else {
      const iv = Math.max(1, s.interval || 1);
      hard = Math.max(iv + 1, Math.round(iv * 1.2));
      good = Math.max(hard + 1, Math.round(iv * ease));
      easy = Math.max(good + 1, Math.round(iv * ease * 1.3));
    }
    return {
      1: 0,
      2: Math.min(hard, MAX_INTERVAL),
      3: Math.min(good, MAX_INTERVAL),
      4: Math.min(easy, MAX_INTERVAL),
    };
  }

  /** Returns the new state after answering with `rating` at time `now`. */
  function schedule(state, rating, now) {
    now = now || Date.now();
    const prev = state || { reps: 0, lapses: 0, ease: 2.5, interval: 0, due: now };
    const s = { ...prev, last: now };
    const iv = nextIntervals(prev);
    switch (rating) {
      case 1:
        if (prev.reps > 0) s.lapses = (prev.lapses || 0) + 1;
        s.reps = 0;
        s.ease = Math.max(MIN_EASE, (prev.ease || 2.5) - 0.2);
        s.interval = 0;
        s.due = now + RELEARN_DELAY;
        return s;
      case 2:
        s.ease = Math.max(MIN_EASE, (prev.ease || 2.5) - 0.15);
        break;
      case 4:
        s.ease = (prev.ease || 2.5) + 0.15;
        break;
      default:
        rating = 3;
    }
    s.reps = (prev.reps || 0) + 1;
    s.interval = iv[rating];
    s.due = addDays(now, s.interval);
    return s;
  }

  function isNew(card) {
    return !card.srs;
  }

  function isDue(card, now) {
    return !!card.srs && card.srs.due <= (now || Date.now());
  }

  /** Human label for an interval in days (0 = again this session). */
  function formatInterval(days) {
    if (days <= 0) return '<1m';
    if (days < 1) return Math.round(days * 24) + 'h';
    if (days < 30) return Math.round(days) + 'd';
    if (days < 365) {
      const m = days / 30;
      return (m < 10 ? Math.round(m * 10) / 10 : Math.round(m)) + 'mo';
    }
    return Math.round((days / 365) * 10) / 10 + 'y';
  }

  /** "in 3 days" / "today" style label for a due timestamp. */
  function formatDue(due, now) {
    now = now || Date.now();
    if (due <= now) return 'due now';
    const days = Math.round((startOfDay(due) - startOfDay(now)) / DAY);
    if (days <= 0) return 'due later today';
    if (days === 1) return 'due tomorrow';
    return 'due in ' + formatInterval(days);
  }

  /**
   * Cards to study now: everything due (oldest first) followed by up to
   * `newLimit` new cards in deck order (the order Claude wrote them in,
   * which usually follows the lecture).
   */
  function buildQueue(cards, newLimit, now) {
    now = now || Date.now();
    const due = cards.filter((c) => isDue(c, now)).sort((a, b) => a.srs.due - b.srs.due);
    const fresh = cards.filter(isNew).slice(0, Math.max(0, newLimit));
    return due.map((c) => c.id).concat(fresh.map((c) => c.id));
  }

  function deckStats(cards, now) {
    now = now || Date.now();
    let n = 0;
    let due = 0;
    let learned = 0;
    let nextDue = Infinity;
    for (const c of cards) {
      if (!c.srs) n++;
      else {
        learned++;
        if (c.srs.due <= now) due++;
        else nextDue = Math.min(nextDue, c.srs.due);
      }
    }
    return { total: cards.length, new: n, due, learned, nextDue: nextDue === Infinity ? null : nextDue };
  }

  return { schedule, nextIntervals, isNew, isDue, formatInterval, formatDue, buildQueue, deckStats, dayKey, DAY };
});
