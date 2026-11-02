/* Flashcards app: routing and views. */
(function () {
  'use strict';
  const { parser, render, srs, images: Img, db, prompt, sample, icon, scene } = window.FC;
  const h = render.escapeHTML;
  const $app = document.getElementById('app');
  const DEFAULT_NEW_PER_DAY = 20;
  const PREVIEW_MAX = 150;
  const PAGE_SIZE = 100;

  // ---------------------------------------------------------------- helpers
  const qs = (sel, el = document) => el.querySelector(sel);
  const qsa = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const plural = (n, word, many) => `${n} ${n === 1 ? word : many || word + 's'}`;

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  const local = {
    get(k, d) {
      try {
        const v = localStorage.getItem(k);
        return v === null ? d : JSON.parse(v);
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch (e) {
        /* storage unavailable */
      }
    },
    del(k) {
      try {
        localStorage.removeItem(k);
      } catch (e) {
        /* storage unavailable */
      }
    },
  };

  let toastTimer;
  function toast(msg, kind) {
    const el = document.getElementById('toast');
    el.innerHTML = (kind === 'ok' ? icon('check') : kind === 'error' ? icon('x') : '') + `<span>${h(msg)}</span>`;
    el.className = 'toast show' + (kind ? ' toast-' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = 'toast'), kind === 'error' ? 6000 : 3000);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (e2) {
        ok = false;
      }
      ta.remove();
      return ok;
    }
  }

  function download(filename, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function fileSlug(name) {
    return (name || 'deck').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'deck';
  }

  function timeAgo(ts) {
    if (!ts) return '';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return plural(Math.round(s / 60), 'minute') + ' ago';
    if (s < 86400) return plural(Math.round(s / 3600), 'hour') + ' ago';
    return plural(Math.round(s / 86400), 'day') + ' ago';
  }

  function formatBytes(n) {
    if (!n) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function newLimitFor(deck, now) {
    const today = srs.dayKey(now || Date.now());
    const used = deck.newLog && deck.newLog.day === today ? deck.newLog.count : 0;
    const perDay = Number.isFinite(deck.newPerDay) ? deck.newPerDay : DEFAULT_NEW_PER_DAY;
    return Math.max(0, perDay - used);
  }

  // Let `extra` more new cards be studied today, on top of what was already studied.
  function allowMoreNew(deck, extra) {
    const perDay = Number.isFinite(deck.newPerDay) ? deck.newPerDay : DEFAULT_NEW_PER_DAY;
    deck.newLog = { day: srs.dayKey(Date.now()), count: perDay - extra };
  }

  function isTextFile(f) {
    return /\.(txt|md|markdown|csv|tsv|tab|json)$/i.test(f.name) || /^text\//.test(f.type) || f.type === 'application/json';
  }

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  function dataURLToBlob(url) {
    const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url || '');
    if (!m) throw new Error('Bad image data in backup');
    const type = m[1] || 'application/octet-stream';
    if (!m[2]) return new Blob([decodeURIComponent(m[3])], { type });
    const bin = atob(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  }

  // ------------------------------------------------- per-deck image cache
  let imgCache = { deckId: null, list: [] };

  async function deckImages(deckId, force) {
    if (imgCache.deckId === deckId && !force) return imgCache.list;
    const recs = await db.getImages(deckId);
    releaseImages();
    imgCache = { deckId, list: recs.map((r) => ({ ...r, url: URL.createObjectURL(r.blob) })) };
    return imgCache.list;
  }

  function releaseImages() {
    imgCache.list.forEach((i) => URL.revokeObjectURL(i.url));
    imgCache = { deckId: null, list: [] };
  }

  function missingRefs(cards, resolve) {
    const missing = new Map();
    for (const c of cards) {
      for (const ref of render.imageRefs(c.front + '\n' + c.back)) {
        const r = resolve(ref);
        if (!r.src && !r.pending) missing.set(ref, (missing.get(ref) || 0) + 1);
      }
    }
    return missing;
  }

  // ------------------------------------------------------------ modal/lightbox
  let modalCleanup = null;

  function openModal(html, opts) {
    closeModal();
    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="modal-backdrop"><div class="modal ${opts && opts.wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true">${html}</div></div>`;
    const backdrop = root.firstElementChild;
    let downOnBackdrop = false;
    backdrop.addEventListener('mousedown', (e) => (downOnBackdrop = e.target === backdrop));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop && downOnBackdrop && !(opts && opts.sticky)) closeModal();
    });
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeModal();
      }
    };
    document.addEventListener('keydown', onKey, true);
    modalCleanup = () => document.removeEventListener('keydown', onKey, true);
    document.body.classList.add('modal-open');
    return backdrop.firstElementChild;
  }

  function closeModal() {
    const root = document.getElementById('modal-root');
    if (modalCleanup) modalCleanup();
    modalCleanup = null;
    if (root) root.innerHTML = '';
    document.body.classList.remove('modal-open');
  }

  const isModalOpen = () => !!document.getElementById('modal-root').firstElementChild;

  document.addEventListener('click', (e) => {
    const img = e.target.closest && e.target.closest('img[data-zoom]');
    if (!img || e.target.closest('.modal')) return;
    e.preventDefault();
    e.stopPropagation();
    const m = openModal(`<img src="${h(img.src)}" alt="${h(img.alt)}"><p class="lightbox-caption">${h(img.alt)}</p>`, {});
    m.classList.add('modal-lightbox');
    m.addEventListener('click', closeModal);
  });

  // ------------------------------------------------------------- appearance
  const SEASON_INFO = {
    spring: { label: 'Spring', icon: 'flower-2', note: 'Cherry blossom' },
    summer: { label: 'Summer', icon: 'sun', note: 'Long bright days' },
    autumn: { label: 'Autumn', icon: 'leaf', note: 'Golden hour' },
    winter: { label: 'Winter', icon: 'snowflake', note: 'Fresh snow' },
  };
  const prefs = {
    season: local.get('fc-season', 'auto'), // auto | cycle | spring | summer | autumn | winter
    theme: local.get('fc-theme', 'auto'), // auto | light | dark
    motion: local.get('fc-motion', true),
  };
  const darkQuery = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : { matches: false, addEventListener() {} };
  const reducedQuery = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  let cycleSeason = null;
  let cycleTimer = null;

  function currentSeason() {
    if (SEASON_INFO[prefs.season]) return prefs.season;
    if (prefs.season === 'cycle' && cycleSeason) return cycleSeason;
    return scene.seasonFor(new Date());
  }

  function isNight() {
    return prefs.theme === 'dark' || (prefs.theme !== 'light' && darkQuery.matches);
  }

  function applyAppearance() {
    const season = currentSeason();
    const night = isNight();
    const root = document.documentElement;
    root.dataset.season = season;
    root.dataset.mode = night ? 'dark' : 'light';
    scene.set({ season, night, motion: prefs.motion });
    const info = SEASON_INFO[season];
    const btn = qs('#season-btn');
    btn.innerHTML = icon(info.icon) + `<span class="season-label">${info.label}</span>` + icon('chevron-down');
    btn.setAttribute('aria-label', `Appearance: ${info.label}, ${night ? 'night' : 'day'}`);
    if (popover) renderPopover();
  }

  function restartCycle() {
    clearInterval(cycleTimer);
    cycleTimer = null;
    if (prefs.season !== 'cycle') return;
    cycleSeason = cycleSeason || scene.seasonFor(new Date());
    cycleTimer = setInterval(() => {
      // Hold the season still while studying.
      if (document.hidden || document.body.dataset.view === 'study') return;
      const all = scene.SEASONS;
      cycleSeason = all[(all.indexOf(cycleSeason) + 1) % all.length];
      applyAppearance();
    }, 12000);
  }

  function setPrefs(patch) {
    Object.assign(prefs, patch);
    local.set('fc-season', prefs.season);
    local.set('fc-theme', prefs.theme);
    local.set('fc-motion', prefs.motion);
    if ('season' in patch && patch.season === 'cycle') cycleSeason = currentSeason();
    restartCycle();
    applyAppearance();
  }

  let popover = null;
  function renderPopover() {
    const pressed = (on) => `aria-pressed="${on ? 'true' : 'false'}"`;
    popover.innerHTML = `
      <h2>Season</h2>
      <div>
        <div class="season-grid">${scene.SEASONS.map(
          (k) => `<button class="season-opt" data-s="${k}" ${pressed(prefs.season === k)}>${icon(SEASON_INFO[k].icon)}<span>${SEASON_INFO[k].label}<br><small>${SEASON_INFO[k].note}</small></span></button>`
        ).join('')}</div>
        <div class="season-auto">
          <button data-s="auto" ${pressed(prefs.season === 'auto')}>${icon('calendar-days')} Match today</button>
          <button data-s="cycle" ${pressed(prefs.season === 'cycle')}>${icon('repeat')} Cycle seasons</button>
        </div>
      </div>
      <h2>Time of day</h2>
      <div class="segmented" role="group" aria-label="Time of day">
        <button data-t="light" ${pressed(prefs.theme === 'light')}>${icon('sun')} Day</button>
        <button data-t="dark" ${pressed(prefs.theme === 'dark')}>${icon('moon')} Night</button>
        <button data-t="auto" ${pressed(prefs.theme === 'auto')}>${icon('monitor')} System</button>
      </div>
      <label class="switch-row">Animated scenery<input type="checkbox" class="switch" id="motion-toggle" ${prefs.motion ? 'checked' : ''}></label>
      ${reducedQuery.matches ? '<p class="muted small">Your device asks for reduced motion, so the scenery stays still.</p>' : ''}`;
  }

  function closePopover() {
    if (!popover) return;
    popover.remove();
    popover = null;
    qs('#season-btn').setAttribute('aria-expanded', 'false');
  }

  function openPopover() {
    popover = document.createElement('div');
    popover.className = 'popover glass';
    popover.id = 'appearance';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', 'Appearance');
    document.body.appendChild(popover);
    renderPopover();
    qs('#season-btn').setAttribute('aria-expanded', 'true');
    popover.addEventListener('click', (e) => {
      // Clicks inside re-render the picker; don't let the "click outside" handler see a detached target.
      e.stopPropagation();
      const s = e.target.closest('[data-s]');
      const t = e.target.closest('[data-t]');
      if (s) setPrefs({ season: s.dataset.s });
      if (t) setPrefs({ theme: t.dataset.t });
    });
    popover.addEventListener('change', (e) => {
      if (e.target.id === 'motion-toggle') setPrefs({ motion: e.target.checked });
    });
    const first = popover.querySelector('[aria-pressed="true"]');
    if (first) first.focus();
  }

  scene.init();
  restartCycle();
  applyAppearance();
  // Enable the season cross-fade only after the first paint, so loading doesn't animate.
  requestAnimationFrame(() => requestAnimationFrame(() => (document.documentElement.dataset.ready = '')));
  darkQuery.addEventListener && darkQuery.addEventListener('change', applyAppearance);
  qs('#season-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    popover ? closePopover() : openPopover();
  });
  document.addEventListener('click', (e) => {
    if (popover && !popover.contains(e.target)) closePopover();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popover) {
      closePopover();
      qs('#season-btn').focus();
    }
  });

  // ------------------------------------------------------- colours & streaks
  const DECK_COLORS = [
    ['#f7567c', '#ff8a4c'], ['#7b61ff', '#c063d6'], ['#0b8fd8', '#14a38b'], ['#f08a0b', '#e5484d'],
    ['#0f9f6e', '#0b8fd8'], ['#5b5bd6', '#0aa2c0'], ['#e0458f', '#8b5cf6'], ['#e2591a', '#c9832a'],
    ['#0e8f86', '#5b9a1a'], ['#3b6ff0', '#8b5cf6'],
  ];
  const GLYPHS = ['∑', '∫', 'π', 'λ', 'Δ', '∞', '√', 'θ', 'Ω', 'μ', 'φ', '∂', 'α', 'β', 'σ', 'ψ'];

  function hashStr(str) {
    let n = 7;
    for (const c of String(str)) n = (n * 31 + c.codePointAt(0)) | 0;
    return Math.abs(n);
  }

  function deckLook(deck) {
    const n = hashStr(deck.id);
    const [c1, c2] = DECK_COLORS[n % DECK_COLORS.length];
    return { style: `--c1:${c1};--c2:${c2}`, glyph: GLYPHS[Math.floor(n / DECK_COLORS.length) % GLYPHS.length] };
  }

  function learnedPct(s) {
    return s.total ? Math.round((s.learned / s.total) * 100) : 0;
  }

  function recordActivity() {
    const today = srs.dayKey(Date.now());
    const days = local.get('fc-activity', []);
    if (days[days.length - 1] !== today) {
      days.push(today);
      local.set('fc-activity', days.slice(-400));
    }
  }

  function streakDays() {
    const days = new Set(local.get('fc-activity', []));
    const d = new Date();
    if (!days.has(srs.dayKey(d))) d.setDate(d.getDate() - 1);
    let n = 0;
    while (days.has(srs.dayKey(d))) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  function greeting() {
    const hr = new Date().getHours();
    if (hr < 5) return 'Studying late?';
    if (hr < 12) return 'Good morning';
    if (hr < 18) return 'Good afternoon';
    return 'Good evening';
  }

  function backLink(href, label) {
    return `<a class="back" href="${href}">${icon('arrow-left')}<span>${h(label)}</span></a>`;
  }

  // ----------------------------------------------------------------- router
  let viewToken = 0;
  let viewCleanup = null;
  // Saves still in flight (study progress is written in the background). Views wait for
  // these before reading, so leaving a session never shows or overwrites stale data.
  let pendingWrites = Promise.resolve();

  const routes = [
    [/^\/?$/, 'home', viewHome],
    [/^\/import$/, 'import', () => viewImport(null)],
    [/^\/import\/([\w-]+)$/, 'import', viewImport],
    [/^\/prompt$/, 'prompt', viewPrompt],
    [/^\/deck\/([\w-]+)$/, 'deck', viewDeck],
    [/^\/deck\/([\w-]+)\/cards$/, 'cards', viewCards],
    [/^\/deck\/([\w-]+)\/images$/, 'images', viewImages],
    [/^\/study\/([\w-]+)$/, 'study', (id) => viewStudy(id, 'srs')],
    [/^\/practice\/([\w-]+)$/, 'study', (id) => viewStudy(id, 'practice')],
  ];

  function onCleanup(fn) {
    const prev = viewCleanup;
    viewCleanup = () => {
      if (prev) prev();
      fn();
    };
  }

  async function route() {
    if (viewCleanup) viewCleanup();
    viewCleanup = null;
    closeModal();
    const token = ++viewToken;
    await pendingWrites;
    if (token !== viewToken) return;
    const path = location.hash.replace(/^#/, '').split('?')[0] || '/';
    let match = null;
    for (const [re, name, fn] of routes) {
      const m = re.exec(path);
      if (m) {
        match = { name, fn, args: m.slice(1) };
        break;
      }
    }
    if (!match) match = { name: 'home', fn: viewHome, args: [] };
    document.body.dataset.view = match.name;
    qsa('.topnav a').forEach((a) => {
      const target = a.getAttribute('href').replace(/^#/, '');
      const active = target === '/' ? ['home', 'deck', 'cards', 'images'].includes(match.name) : path.startsWith(target);
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    try {
      await match.fn(...match.args);
      if (token === viewToken) window.scrollTo(0, 0);
    } catch (err) {
      console.error(err);
      if (token === viewToken) {
        $app.innerHTML = `<section class="page narrow"><div class="glass panel"><h1>Something went wrong</h1><p class="muted">${h(err.message || err)}</p><p><a class="btn btn-primary" href="#/">${icon('arrow-left')} Back to decks</a></p></div></section>`;
      }
    }
  }

  function stale(token) {
    return token !== viewToken;
  }

  function notFound() {
    $app.innerHTML = `<section class="page narrow"><div class="glass panel"><h1>Deck not found</h1><p class="muted">It may have been deleted.</p><p><a class="btn btn-primary" href="#/">${icon('arrow-left')} Back to decks</a></p></div></section>`;
  }

  // ------------------------------------------------------------------- home
  async function viewHome() {
    const token = viewToken;
    const decks = (await db.getDecks()).sort((a, b) => (b.lastStudied || b.updatedAt || 0) - (a.lastStudied || a.updatedAt || 0));
    if (stale(token)) return;
    const now = Date.now();
    const season = SEASON_INFO[currentSeason()];
    const dateStr = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    const eyebrow = `<p class="eyebrow">${icon(season.icon)} ${season.label} · ${h(dateStr)}</p>`;

    const infos = decks.map((d) => {
      const s = srs.deckStats(d.cards, now);
      const fresh = Math.min(s.new, newLimitFor(d, now));
      return { d, s, fresh, ready: s.due + fresh > 0 };
    });
    const totalDue = infos.reduce((n, i) => n + i.s.due, 0);
    const totalNew = infos.reduce((n, i) => n + i.fresh, 0);
    const totalLearned = infos.reduce((n, i) => n + i.s.learned, 0);
    const readyDecks = infos.filter((i) => i.ready);
    const next = readyDecks.slice().sort((a, b) => b.s.due - a.s.due || b.fresh - a.fresh)[0];
    const streak = streakDays();
    const shortName = (n) => (n.length > 26 ? n.slice(0, 25) + '…' : n);

    const deckItems = infos
      .map(({ d, s, fresh, ready }) => {
        const look = deckLook(d);
        const pct = learnedPct(s);
        return `<li class="deck-card">
          <a class="deck-cover" href="#/deck/${d.id}" style="${look.style}" tabindex="-1" aria-hidden="true">
            <span class="deck-glyph">${look.glyph}</span>
            <span class="ring" style="--p:${pct}" title="${pct}% learned"><span>${pct}%</span></span>
          </a>
          <div class="deck-body">
            <a class="deck-link" href="#/deck/${d.id}"><h3>${h(d.name)}</h3></a>
            <p class="muted">${plural(s.total, 'card')}${d.lastStudied ? ' · studied ' + timeAgo(d.lastStudied) : ''}</p>
            <div class="deck-card-foot">
              <span class="chips">
                ${s.due ? `<span class="chip chip-due">${icon('flame')}${s.due} due</span>` : ''}
                ${fresh ? `<span class="chip chip-new">${icon('sparkles')}${fresh} new</span>` : ''}
                ${!ready ? `<span class="chip chip-done">${icon('check')}Done for now</span>` : ''}
              </span>
              <a class="btn btn-sm ${ready ? 'btn-primary' : ''}" href="#/${ready ? 'study' : 'practice'}/${d.id}">${icon(ready ? 'play' : 'shuffle')}${ready ? 'Study' : 'Practice'}</a>
            </div>
          </div>
        </li>`;
      })
      .join('');

    const hero = decks.length
      ? `<div class="hero glass">
          <div class="hero-text">
            ${eyebrow}
            <h1>${greeting()}</h1>
            <p class="hero-sub">${
              totalDue + totalNew
                ? `You have <strong>${plural(totalDue + totalNew, 'card')}</strong> to study today${readyDecks.length > 1 ? ` across ${plural(readyDecks.length, 'deck')}` : ''}.`
                : 'You’re all caught up. Practise a deck, or import new cards from Claude.'
            }</p>
            <div class="hero-stats">
              <div class="hero-stat"><b>${totalDue}</b><span>due</span></div>
              <div class="hero-stat"><b>${totalNew}</b><span>new today</span></div>
              <div class="hero-stat"><b>${totalLearned}</b><span>learned</span></div>
            </div>
          </div>
          <div class="hero-side">
            ${streak ? `<span class="streak">${icon('flame')}<b>${streak}</b> day streak</span>` : ''}
            ${
              next
                ? `<a class="btn btn-primary btn-lg" href="#/study/${next.d.id}">${icon('play')} Study ${h(shortName(next.d.name))}</a>`
                : `<a class="btn btn-primary btn-lg" href="#/import">${icon('wand-sparkles')} Import cards</a>`
            }
          </div>
        </div>`
      : `<div class="hero glass hero-empty">
          ${eyebrow}
          <h1>Turn your lectures into flashcards</h1>
          <p class="hero-sub">Claude writes the cards from your notes and slides, with LaTeX and pictures. You study them here with spaced repetition.</p>
          <ol class="step-cards">
            <li><span class="step-num">1</span><b>Copy the prompt</b><span>It tells Claude exactly how to write cards for this app.</span><button class="btn btn-sm copy-prompt">${icon('copy')} Copy prompt</button></li>
            <li><span class="step-num">2</span><b>Ask Claude</b><span>Attach your lecture PDF or notes, paste the prompt and send.</span></li>
            <li><span class="step-num">3</span><b>Paste &amp; study</b><span>Paste Claude's cards into Import, and add the PDF for slide pictures.</span><a class="btn btn-sm" href="#/import">${icon('clipboard-paste')} Import</a></li>
          </ol>
          <div class="row wrap">
            <a class="btn btn-primary btn-lg" href="#/import">${icon('wand-sparkles')} Import flashcards</a>
            <button class="btn btn-lg" id="sample-btn">${icon('sparkles')} Try a sample deck</button>
          </div>
        </div>`;

    $app.innerHTML = `<section class="page">
      ${hero}
      ${
        decks.length
          ? `<div class="section-head"><h2>Your decks</h2><a class="btn btn-sm" href="#/import">${icon('plus')} New deck</a></div>
             <ul class="deck-grid">${deckItems}<li><a class="new-deck-card" href="#/import">${icon('plus')}<span>New deck from Claude</span></a></li></ul>`
          : ''
      }
      <footer class="page-foot glass-soft">
        <div class="row wrap">
          ${decks.length ? `<button class="btn btn-sm" id="backup-btn">${icon('archive')} Download backup</button>` : ''}
          <label class="btn btn-sm">${icon('archive-restore')} Restore backup<input type="file" id="restore-input" accept=".json,application/json" hidden></label>
          ${decks.length ? `<button class="btn btn-sm btn-ghost" id="sample-btn">${icon('sparkles')} Add sample deck</button>` : ''}
        </div>
        <p class="muted small">Your decks are stored only in this browser. Download a backup to move them to another device.<span id="usage"></span></p>
      </footer>
    </section>`;

    bindCopyPrompt($app);
    const sampleBtn = qs('#sample-btn');
    if (sampleBtn) sampleBtn.addEventListener('click', addSampleDeck);
    const backupBtn = qs('#backup-btn');
    if (backupBtn) backupBtn.addEventListener('click', () => backupDecks(decks.map((d) => d.id)));
    qs('#restore-input').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const n = await restoreBackup(f);
        toast(`Restored ${plural(n, 'deck')}`, 'ok');
        route();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    db.estimate().then((est) => {
      if (est && est.usage && !stale(token)) qs('#usage').textContent = ` Using ${formatBytes(est.usage)}.`;
    });
  }

  async function addSampleDeck() {
    const parsed = parser.parse(sample.TEXT);
    const now = Date.now();
    const deck = {
      id: uid(),
      name: parsed.name,
      createdAt: now,
      newPerDay: DEFAULT_NEW_PER_DAY,
      newLog: null,
      cards: parsed.cards.map((c) => ({ id: uid(), front: c.front, back: c.back, srs: null, createdAt: now })),
    };
    await db.putDeck(deck);
    await db.putImages(deck.id, sample.images());
    location.hash = '#/deck/' + deck.id;
  }

  // ----------------------------------------------------------------- backup
  async function backupDecks(ids, filename) {
    const out = { app: 'flashcards', version: 1, exportedAt: new Date().toISOString(), decks: [] };
    for (const id of ids) {
      const d = await db.getDeck(id);
      if (!d) continue;
      const imgs = await db.getImages(id);
      const images = [];
      for (const i of imgs) {
        images.push({ key: i.key, name: i.name, pdf: i.pdf, page: i.page, width: i.width, height: i.height, data: await blobToDataURL(i.blob) });
      }
      out.decks.push({ ...d, images });
    }
    const date = new Date().toISOString().slice(0, 10);
    download(filename || `flashcards-backup-${date}.json`, JSON.stringify(out), 'application/json');
  }

  function cleanDeck(d) {
    const num = (v, def) => (Number.isFinite(v) ? v : def);
    const okId = (v) => (typeof v === 'string' && /^[\w-]{1,64}$/.test(v) ? v : uid());
    return {
      id: okId(d.id),
      name: String(d.name || 'Restored deck').slice(0, 200),
      createdAt: num(d.createdAt, Date.now()),
      lastStudied: num(d.lastStudied, undefined),
      newPerDay: num(d.newPerDay, DEFAULT_NEW_PER_DAY),
      newLog: d.newLog && typeof d.newLog.day === 'string' ? { day: d.newLog.day, count: num(d.newLog.count, 0) } : null,
      cards: (Array.isArray(d.cards) ? d.cards : [])
        .filter((c) => c && typeof c.front === 'string')
        .map((c) => ({
          id: okId(c.id),
          front: c.front,
          back: typeof c.back === 'string' ? c.back : '',
          createdAt: num(c.createdAt, Date.now()),
          srs:
            c.srs && typeof c.srs === 'object'
              ? {
                  due: num(c.srs.due, Date.now()),
                  interval: num(c.srs.interval, 0),
                  ease: num(c.srs.ease, 2.5),
                  reps: num(c.srs.reps, 0),
                  lapses: num(c.srs.lapses, 0),
                  last: num(c.srs.last, undefined),
                }
              : null,
        })),
    };
  }

  async function restoreBackup(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (e) {
      throw new Error('That file is not valid JSON.');
    }
    if (!data || !Array.isArray(data.decks)) throw new Error('That file is not a flashcards backup.');
    const existing = new Set((await db.getDecks()).map((d) => d.id));
    const clashes = data.decks.filter((d) => existing.has(d.id)).length;
    const replace =
      !clashes ||
      confirm(`${plural(clashes, 'deck')} in this backup already exist${clashes === 1 ? 's' : ''} here.\n\nOK: replace with the backup version\nCancel: keep both (import as copies)`);
    for (const raw of data.decks) {
      const deck = cleanDeck(raw);
      if (existing.has(deck.id)) {
        if (replace) await db.deleteDeck(deck.id);
        else {
          deck.id = uid();
          deck.name += ' (restored)';
        }
      }
      await db.putDeck(deck);
      const imgs = (Array.isArray(raw.images) ? raw.images : [])
        .filter((i) => i && typeof i.data === 'string' && i.key)
        .map((i) => ({ key: Img.normalizeKey(i.key), name: String(i.name || i.key), pdf: i.pdf, page: i.page, width: i.width, height: i.height, blob: dataURLToBlob(i.data) }));
      if (imgs.length) await db.putImages(deck.id, imgs);
    }
    releaseImages();
    db.requestPersistence();
    return data.decks.length;
  }

  // ----------------------------------------------------------------- prompt
  function promptStepsHTML() {
    return `<ol class="steps">
      <li><button class="btn btn-sm btn-primary copy-prompt">${icon('copy')} Copy the prompt</button></li>
      <li>In Claude, attach your lecture slides (export PowerPoint/Keynote as <strong>PDF</strong>) or notes, paste the prompt, and send. You can add a line such as "about 40 cards" or "focus on the proofs".</li>
      <li>Copy Claude's output (the copy button on the code block), or download the .txt file it makes.</li>
      <li><a href="#/import">Import it</a>: paste the text or open the file. If the cards show slide pictures, add the <strong>same PDF</strong> on the import page so the app can use its pages.</li>
    </ol>`;
  }

  function bindCopyPrompt(root) {
    qsa('.copy-prompt', root).forEach((b) =>
      b.addEventListener('click', async () => {
        const ok = await copyText(prompt.PROMPT);
        toast(ok ? 'Prompt copied. Paste it into Claude with your lecture material.' : 'Could not copy. Select the text and copy it manually.', ok ? 'ok' : 'error');
      })
    );
  }

  function viewPrompt() {
    $app.innerHTML = `<section class="page narrow">
      <div class="page-head"><h1>Make flashcards with Claude</h1></div>
      <div class="glass panel">
        <p class="eyebrow">${icon('wand-sparkles')} How it works</p>
        ${promptStepsHTML()}
      </div>
      <div class="prompt-box glass">
        <div class="prompt-box-head"><strong>The prompt</strong><button class="btn btn-sm btn-primary copy-prompt">${icon('copy')} Copy</button></div>
        <pre id="prompt-text">${h(prompt.PROMPT)}</pre>
      </div>
      <div class="glass panel">
        <h2>Tips</h2>
        <ul class="tips">
          <li><strong>Long lectures:</strong> ask for cards one section at a time, then use <em>Add cards</em> on the deck page to add each batch to the same deck. Exact duplicates are skipped.</li>
          <li><strong>Pictures:</strong> Claude can reference any page of a PDF you give it. Add the same PDF when importing, and each reference shows that page. You can also add your own image files and refer to them by file name.</li>
          <li><strong>Fixing a card:</strong> while studying, press <kbd>E</kbd> to edit the current card.</li>
          <li><strong>Other formats:</strong> the importer also reads CSV (<code>question,answer</code>; wrap text containing commas in "quotes"), tab-separated text, and JSON.</li>
        </ul>
      </div>
    </section>`;
    bindCopyPrompt($app);
  }

  // ----------------------------------------------------------------- import
  async function viewImport(deckId) {
    const token = viewToken;
    const decks = await db.getDecks();
    const target = deckId ? decks.find((d) => d.id === deckId) : null;
    if (deckId && !target) return notFound();
    const existingImgs = target ? await deckImages(target.id) : [];
    if (stale(token)) return;

    const added = []; // images added on this page: {name,key,blob,url,pdf?,page?,width,height}
    const processing = new Map(); // pdf name -> progress text
    const draftKey = 'fc-import-draft';
    let parsed = { cards: [], warnings: [], format: 'qa', name: '' };
    let toAdd = [];
    let nameTouched = false;

    onCleanup(() => added.forEach((i) => URL.revokeObjectURL(i.url)));

    $app.innerHTML = `<section class="page import">
      ${target ? backLink('#/deck/' + target.id, target.name) : ''}
      <div class="page-head"><h1>${target ? 'Add cards' : 'Import flashcards'}</h1></div>
      <details class="howto glass" ${decks.length ? '' : 'open'}>
        <summary>${icon('wand-sparkles')} How to get flashcards from Claude ${icon('chevron-down')}</summary>
        ${promptStepsHTML()}
      </details>
      <div class="import-grid">
        <div class="import-input glass">
          <div class="field">
            <div class="label-row">
              <label for="src">Flashcard text</label>
              <span class="row gap-sm">
                <label class="btn btn-sm">${icon('folder-open')} Open file…<input type="file" id="text-file" accept=".txt,.md,.csv,.tsv,.json,text/plain,text/csv,application/json" hidden></label>
              </span>
            </div>
            <textarea id="src" spellcheck="false" placeholder="# Deck name&#10;&#10;Q: What is $e^{i\\pi}$?&#10;A: $-1$&#10;&#10;Q: Next question…&#10;A: Its answer…"></textarea>
          </div>
          <div class="row wrap">
            <label class="inline-field">Format
              <select id="fmt">
                <option value="auto">Auto-detect</option>
                <option value="qa">Q: / A: blocks</option>
                <option value="csv">CSV (question,answer)</option>
                <option value="tsv">Tab-separated</option>
                <option value="custom">Custom separator</option>
                <option value="json">JSON</option>
              </select>
            </label>
            <label class="inline-field" id="delim-wrap" hidden>Separator <input id="delim" size="4" value=";" spellcheck="false"></label>
            <span class="muted small" id="detected"></span>
          </div>
          ${
            target
              ? ''
              : `<div class="field"><label for="deck-name">Deck name</label><input id="deck-name" placeholder="e.g. Lecture 3 – Eigenvalues"></div>`
          }
          <div class="field">
            <span class="label">Images for this deck <span class="muted">(optional)</span></span>
            <div class="dropzone" id="drop" tabindex="0">
              <span class="dropzone-icon">${icon('upload')}</span>
              <p>Drop the lecture <strong>PDF</strong> or image files here, or <label class="link">choose files<input type="file" id="img-files" accept="image/*,.pdf,application/pdf" multiple hidden></label></p>
              <p class="muted small">Cards refer to them as <code>![](slides.pdf#page=4)</code> or <code>![](diagram.png)</code>.${
                existingImgs.length ? ` This deck already has ${plural(existingImgs.length, 'image')}.` : ''
              }</p>
              <ul class="file-list" id="file-list"></ul>
            </div>
          </div>
          <div class="row">
            <button class="btn btn-primary btn-lg" id="create" disabled>${target ? 'Add cards' : 'Create deck'}</button>
            <button class="btn btn-ghost" id="clear">${icon('rotate-ccw')} Clear</button>
          </div>
        </div>
        <div class="import-preview glass" aria-live="polite">
          <div class="preview-summary" id="summary"><div class="empty-preview">${icon('eye')}<strong>Live preview</strong><span>Paste flashcards to see them rendered here, with LaTeX and images.</span></div></div>
          <ul class="warnings" id="warnings"></ul>
          <ol class="preview-list" id="preview"></ol>
        </div>
      </div>
    </section>`;
    bindCopyPrompt($app);

    const ta = qs('#src');
    const fmt = qs('#fmt');
    const delim = qs('#delim');
    const nameIn = qs('#deck-name');
    const createBtn = qs('#create');

    ta.value = local.get(draftKey, '');

    function resolver() {
      return Img.makeResolver(existingImgs.concat(added), { pendingPdfs: [...processing.keys()] });
    }

    function update() {
      local.set(draftKey, ta.value);
      qs('#delim-wrap').hidden = fmt.value !== 'custom';
      parsed = parser.parse(ta.value, { format: fmt.value, delimiter: delim.value });
      if (nameIn && !nameTouched) nameIn.value = parsed.name || '';
      const names = { qa: 'Q:/A: blocks', csv: 'CSV', tsv: 'tab-separated', json: 'JSON', custom: 'custom separator' };
      qs('#detected').textContent = fmt.value === 'auto' && ta.value.trim() ? `Detected: ${names[parsed.format]}` : '';

      // Skip cards already in the target deck (and repeats within the paste).
      const seen = new Set((target ? target.cards : []).map((c) => c.front.trim() + '\u0001' + c.back.trim()));
      let dupes = 0;
      toAdd = parsed.cards.filter((c) => {
        const k = c.front.trim() + '\u0001' + c.back.trim();
        if (seen.has(k)) {
          dupes++;
          return false;
        }
        seen.add(k);
        return true;
      });

      const resolve = resolver();
      let latexErrors = 0;
      const missing = new Set();
      const problemsByCard = toAdd.map((c) => {
        const probs = render.check(c.front, resolve).concat(render.check(c.back, resolve));
        for (const p of probs) {
          if (p.type === 'latex') latexErrors++;
          else if (!p.pending) missing.add(p.ref);
        }
        return probs;
      });

      const summary = qs('#summary');
      if (!ta.value.trim()) {
        summary.innerHTML = `<div class="empty-preview">${icon('eye')}<strong>Live preview</strong><span>Paste flashcards to see them rendered here, with LaTeX and images.</span></div>`;
      } else {
        const bits = [`<strong>${plural(toAdd.length, 'card')}</strong> ${target ? 'to add' : 'found'}`];
        if (dupes) bits.push(`${plural(dupes, 'duplicate')} skipped`);
        if (latexErrors) bits.push(`<span class="bad">${plural(latexErrors, 'LaTeX error')}</span>`);
        if (missing.size) bits.push(`<span class="warn">${plural(missing.size, 'image')} not added yet</span>`);
        if (processing.size) bits.push(`<span class="muted">${h([...processing.values()].join(' · '))}</span>`);
        summary.innerHTML = `<p>${bits.join(' · ')}</p>` + (missing.size ? `<p class="muted small">Missing: ${[...missing].slice(0, 8).map((r) => `<code>${h(r)}</code>`).join(', ')}${missing.size > 8 ? '…' : ''}. Add them in the images box, or later from the deck page.</p>` : '');
      }
      qs('#warnings').innerHTML = parsed.warnings.slice(0, 20).map((w) => `<li>${h(w)}</li>`).join('') + (parsed.warnings.length > 20 ? `<li>…and ${parsed.warnings.length - 20} more</li>` : '');

      qs('#preview').innerHTML =
        toAdd
          .slice(0, PREVIEW_MAX)
          .map((c, i) => {
            const probs = problemsByCard[i]
              .filter((p) => p.type === 'latex')
              .map((p) => `<li>LaTeX: ${h(p.message)}</li>`)
              .join('');
            return `<li class="pv-card${probs ? ' has-problem' : ''}">
              <div class="pv-side md">${render.renderHTML(c.front, resolve)}</div>
              <div class="pv-side pv-back md">${render.renderHTML(c.back, resolve)}</div>
              ${probs ? `<ul class="pv-problems">${probs}</ul>` : ''}
            </li>`;
          })
          .join('') + (toAdd.length > PREVIEW_MAX ? `<li class="muted pv-more">…and ${toAdd.length - PREVIEW_MAX} more cards</li>` : '');

      createBtn.disabled = !toAdd.length || processing.size > 0;
      createBtn.textContent = processing.size
        ? 'Preparing images…'
        : target
          ? `Add ${plural(toAdd.length, 'card')}`
          : toAdd.length
            ? `Create deck with ${plural(toAdd.length, 'card')}`
            : 'Create deck';
    }
    const updateSoon = debounce(update, 250);

    function renderFileList() {
      const groups = new Map();
      for (const img of added) {
        const k = img.pdf || img.name;
        if (!groups.has(k)) groups.set(k, { name: k, count: 0, pdf: !!img.pdf });
        groups.get(k).count++;
      }
      const rows = [...groups.values()].map(
        (g) => `<li><span>${icon(g.pdf ? 'file-text' : 'image')} ${h(g.name)}${g.pdf ? ` <span class="muted">(${plural(g.count, 'page')})</span>` : ''}</span>
          <button class="icon-btn" data-remove="${h(g.name)}" aria-label="Remove ${h(g.name)}" title="Remove">${icon('x')}</button></li>`
      );
      for (const [name, text] of processing) rows.push(`<li><span>${icon('file-text')} ${h(name)} <span class="muted">${h(text)}</span></span><span class="spinner" aria-hidden="true"></span></li>`);
      qs('#file-list').innerHTML = rows.join('');
    }

    async function addFiles(fileList) {
      for (const f of Array.from(fileList)) {
        if (Img.isPdf(f)) {
          processing.set(f.name, 'loading…');
          renderFileList();
          update();
          try {
            const pages = await Img.pdfToImages(f, (d, t) => {
              processing.set(f.name, `page ${d} of ${t}`);
              renderFileList();
            });
            removeAdded(f.name);
            for (const p of pages) added.push({ ...p, url: URL.createObjectURL(p.blob) });
          } catch (e) {
            console.error(e);
            toast(`Couldn't read ${f.name}: ${e.message}`, 'error');
          } finally {
            processing.delete(f.name);
          }
        } else if (Img.isImage(f)) {
          const { images } = await Img.filesToImages([f]);
          removeAdded(f.name);
          for (const i of images) added.push({ ...i, url: URL.createObjectURL(i.blob) });
        } else if (isTextFile(f)) {
          ta.value = await f.text();
        } else {
          toast(`Skipped ${f.name}: not an image, PDF or text file`, 'error');
        }
        if (stale(token)) return;
        renderFileList();
        update();
      }
    }

    function removeAdded(name) {
      for (let i = added.length - 1; i >= 0; i--) {
        if ((added[i].pdf || added[i].name) === name) {
          URL.revokeObjectURL(added[i].url);
          added.splice(i, 1);
        }
      }
    }

    ta.addEventListener('input', updateSoon);
    fmt.addEventListener('change', update);
    delim.addEventListener('input', updateSoon);
    if (nameIn) nameIn.addEventListener('input', () => (nameTouched = !!nameIn.value.trim()));
    qs('#text-file').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (f) {
        ta.value = await f.text();
        update();
      }
      e.target.value = '';
    });
    qs('#img-files').addEventListener('change', (e) => {
      addFiles(e.target.files);
      e.target.value = '';
    });
    qs('#file-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-remove]');
      if (!b) return;
      removeAdded(b.dataset.remove);
      renderFileList();
      update();
    });
    qs('#clear').addEventListener('click', () => {
      ta.value = '';
      nameTouched = false;
      update();
      ta.focus();
    });

    const drop = qs('#drop');
    setupDropTarget(drop, addFiles);
    setupDropTarget(ta, async (files) => {
      const text = Array.from(files).find(isTextFile);
      const rest = Array.from(files).filter((f) => f !== text);
      if (text) {
        ta.value = await text.text();
        update();
      }
      if (rest.length) addFiles(rest);
    });

    createBtn.addEventListener('click', async () => {
      if (!toAdd.length || processing.size) return;
      createBtn.disabled = true;
      try {
        const now = Date.now();
        const deck = target
          ? await db.getDeck(target.id)
          : {
              id: uid(),
              name: (nameIn && nameIn.value.trim()) || parsed.name || 'Untitled deck',
              createdAt: now,
              newPerDay: DEFAULT_NEW_PER_DAY,
              newLog: null,
              cards: [],
            };
        deck.cards.push(...toAdd.map((c) => ({ id: uid(), front: c.front, back: c.back, srs: null, createdAt: now })));
        await db.putDeck(deck);
        if (added.length) {
          await db.putImages(
            deck.id,
            added.map(({ url, ...rest }) => rest)
          );
        }
        if (target) releaseImages();
        db.requestPersistence();
        local.del(draftKey);
        toast(target ? `Added ${plural(toAdd.length, 'card')} to “${deck.name}”` : `Created “${deck.name}” with ${plural(toAdd.length, 'card')}`, 'ok');
        location.hash = '#/deck/' + deck.id;
      } catch (e) {
        console.error(e);
        toast('Could not save: ' + e.message, 'error');
        createBtn.disabled = false;
      }
    });

    update();
    if (!ta.value) ta.focus();
  }

  function setupDropTarget(el, onFiles) {
    let depth = 0;
    el.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
      e.preventDefault();
      depth++;
      el.classList.add('dragging');
    });
    el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
      e.preventDefault();
    });
    el.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) el.classList.remove('dragging');
    });
    el.addEventListener('drop', (e) => {
      if (!e.dataTransfer || !e.dataTransfer.files.length) return;
      e.preventDefault();
      depth = 0;
      el.classList.remove('dragging');
      onFiles(e.dataTransfer.files);
    });
  }

  // ------------------------------------------------------------------- deck
  async function viewDeck(id) {
    const token = viewToken;
    const deck = await db.getDeck(id);
    if (!deck) return notFound();
    const imgs = await deckImages(id);
    if (stale(token)) return;

    const now = Date.now();
    const s = srs.deckStats(deck.cards, now);
    const fresh = Math.min(s.new, newLimitFor(deck, now));
    const resolve = Img.makeResolver(imgs);
    const missing = missingRefs(deck.cards, resolve);
    const ready = s.due + fresh > 0;
    const studyLabel = ready
      ? `<span class="btn-title">${icon('play')} Study now</span><small>${[s.due ? plural(s.due, 'review') : '', fresh ? fresh + ' new' : ''].filter(Boolean).join(' · ')}</small>`
      : `<span class="btn-title">${icon('check')} All caught up</span><small>${s.nextDue ? 'next review ' + srs.formatDue(s.nextDue, now).replace('due ', '') : s.new ? "today's new cards are done" : 'nothing scheduled'}</small>`;

    const look = deckLook(deck);
    const pct = learnedPct(s);
    const tile = (tag, attrs, ic, tone, title, sub) =>
      `<${tag} class="tile" ${attrs} style="--tone:${tone}"><span class="stat-icon">${icon(ic)}</span><b>${title}</b><span>${sub}</span></${tag}>`;

    $app.innerHTML = `<section class="page">
      ${backLink('#/', 'Decks')}
      <div class="deck-hero" style="${look.style}">
        <span class="glyph-bg" aria-hidden="true">${look.glyph}</span>
        <div>
          <p class="eyebrow">${icon('layers')} Deck</p>
          <h1 id="deck-title">${h(deck.name)}</h1>
          <p>${plural(s.total, 'card')}${deck.lastStudied ? ' · studied ' + timeAgo(deck.lastStudied) : ''}</p>
        </div>
        <div class="hero-tools">
          <span class="ring ring-lg" style="--p:${pct}"><span><b>${pct}%</b><small>learned</small></span></span>
          <button class="icon-btn on-cover" id="rename" title="Rename deck" aria-label="Rename deck">${icon('pencil')}</button>
        </div>
      </div>
      <div class="stats">
        <div class="stat glass-soft" style="--tone:var(--due)"><span class="stat-icon">${icon('flame')}</span><div><b>${s.due}</b><span>due</span></div></div>
        <div class="stat glass-soft" style="--tone:var(--new)"><span class="stat-icon">${icon('sparkles')}</span><div><b>${s.new}</b><span>new</span></div></div>
        <div class="stat glass-soft" style="--tone:var(--good)"><span class="stat-icon">${icon('brain')}</span><div><b>${s.learned}</b><span>learned</span></div></div>
        <div class="stat glass-soft" style="--tone:var(--accent-text)"><span class="stat-icon">${icon('layers')}</span><div><b>${s.total}</b><span>total</span></div></div>
      </div>
      <div class="actions-main">
        <a class="btn btn-primary btn-xl ${ready ? '' : 'disabled'}" ${ready ? `href="#/study/${deck.id}"` : 'aria-disabled="true"'} id="study-btn">${studyLabel}</a>
        <a class="btn btn-xl" href="#/practice/${deck.id}" ${s.total ? '' : 'aria-disabled="true"'}><span class="btn-title">${icon('shuffle')} Practice all</span><small>shuffled · doesn't change your schedule</small></a>
      </div>
      ${
        !ready && s.new
          ? `<p class="center"><button class="btn btn-sm" id="more-new">${icon('sparkles')} Study ${Math.min(s.new, deck.newPerDay || DEFAULT_NEW_PER_DAY)} more new cards today</button></p>`
          : ''
      }
      ${
        missing.size
          ? `<div class="banner banner-warn">${icon('image')}<strong>${plural(missing.size, 'image')} used in cards ${missing.size === 1 ? "hasn't" : "haven't"} been added:</strong>
              ${[...missing.keys()].slice(0, 6).map((r) => `<code>${h(r)}</code>`).join(', ')}${missing.size > 6 ? '…' : ''}
              <a class="btn btn-sm" href="#/deck/${deck.id}/images">${icon('upload')} Add images</a></div>`
          : ''
      }
      <div class="actions-grid">
        ${tile('a', `href="#/deck/${deck.id}/cards"`, 'book-open', 'var(--accent-text)', 'Browse &amp; edit', plural(s.total, 'card'))}
        ${tile('a', `href="#/import/${deck.id}"`, 'plus', 'var(--good)', 'Add cards', 'paste more from Claude')}
        ${tile('a', `href="#/deck/${deck.id}/images"`, 'images', 'var(--easy)', 'Images', plural(imgs.length, 'image'))}
        ${tile('button', 'id="copy-text"', 'copy', 'var(--hard)', 'Copy as text', 'Q:/A: format')}
        ${tile('button', 'id="download-txt"', 'file-text', '#8b5cf6', 'Download .txt', 'cards only')}
        ${tile('button', 'id="backup"', 'archive', 'var(--again)', 'Download backup', 'cards, images &amp; progress')}
      </div>
      <details class="settings glass-soft">
        <summary>${icon('settings-2')} Deck settings</summary>
        <div class="settings-body">
          <label class="inline-field">New cards per day <input type="number" id="new-per-day" min="0" max="9999" value="${Number.isFinite(deck.newPerDay) ? deck.newPerDay : DEFAULT_NEW_PER_DAY}"></label>
          <div class="row wrap">
            <button class="btn btn-sm" id="reset">${icon('rotate-ccw')} Reset progress</button>
            <button class="btn btn-sm btn-danger" id="delete">${icon('trash-2')} Delete deck</button>
          </div>
        </div>
      </details>
    </section>`;

    qs('#rename').addEventListener('click', async () => {
      const name = window.prompt('Deck name', deck.name);
      if (name && name.trim()) {
        deck.name = name.trim();
        await db.putDeck(deck);
        qs('#deck-title').textContent = deck.name;
      }
    });
    const more = qs('#more-new');
    if (more) {
      more.addEventListener('click', async () => {
        allowMoreNew(deck, Math.min(s.new, deck.newPerDay || DEFAULT_NEW_PER_DAY));
        await db.putDeck(deck);
        location.hash = '#/study/' + deck.id;
      });
    }
    qs('#copy-text').addEventListener('click', async () => {
      const ok = await copyText(parser.toQA(deck.name, deck.cards));
      toast(ok ? 'Copied the deck as text' : 'Copy failed', ok ? 'ok' : 'error');
    });
    qs('#download-txt').addEventListener('click', () => download(fileSlug(deck.name) + '.txt', parser.toQA(deck.name, deck.cards)));
    qs('#backup').addEventListener('click', () => backupDecks([deck.id], `${fileSlug(deck.name)}-backup.json`));
    qs('#new-per-day').addEventListener('change', async (e) => {
      const v = Math.max(0, Math.min(9999, parseInt(e.target.value, 10) || 0));
      deck.newPerDay = v;
      await db.putDeck(deck);
      route();
    });
    qs('#reset').addEventListener('click', async () => {
      if (!confirm('Reset progress for every card in this deck? All cards become new again.')) return;
      deck.cards.forEach((c) => (c.srs = null));
      deck.newLog = null;
      await db.putDeck(deck);
      toast('Progress reset');
      route();
    });
    qs('#delete').addEventListener('click', async () => {
      if (!confirm(`Delete “${deck.name}” and its ${plural(s.total, 'card')} and images? This can't be undone.`)) return;
      await db.deleteDeck(deck.id);
      releaseImages();
      toast('Deck deleted');
      location.hash = '#/';
    });
  }

  // -------------------------------------------------------------- card editor
  /**
   * Opens the editor for an existing card (or a new one when card is null).
   * onDone(card|null, action) is called after save ('save') or delete ('delete').
   */
  function openCardEditor(deck, card, onDone) {
    const isNew = !card;
    const m = openModal(
      `<h2>${icon(isNew ? 'plus' : 'pencil')} ${isNew ? 'New card' : 'Edit card'}</h2>
      <div class="editor-grid">
        <div class="field"><label for="ed-front">Question</label><textarea id="ed-front" spellcheck="true"></textarea></div>
        <div class="md preview" id="pv-front" aria-label="Question preview"></div>
        <div class="field"><label for="ed-back">Answer</label><textarea id="ed-back" spellcheck="true"></textarea></div>
        <div class="md preview" id="pv-back" aria-label="Answer preview"></div>
      </div>
      <p class="muted small">Markdown and LaTeX (<code>$…$</code>, <code>$$…$$</code>) work. Paste an image (Ctrl/⌘+V) into a field to add it to the deck.</p>
      <div class="modal-actions">
        ${isNew ? '' : `<button class="btn btn-danger" id="ed-delete">${icon('trash-2')} Delete</button>`}
        <span class="spacer"></span>
        <button class="btn" id="ed-cancel">Cancel</button>
        <button class="btn btn-primary" id="ed-save">${icon('check')} Save <kbd>Ctrl</kbd>+<kbd>Enter</kbd></button>
      </div>`,
      { wide: true, sticky: true }
    );
    const front = qs('#ed-front', m);
    const back = qs('#ed-back', m);
    front.value = card ? card.front : '';
    back.value = card ? card.back : '';

    let resolve = Img.makeResolver(imgCache.deckId === deck.id ? imgCache.list : []);
    const preview = () => {
      qs('#pv-front', m).innerHTML = render.renderHTML(front.value, resolve) || '<span class="muted">Preview</span>';
      qs('#pv-back', m).innerHTML = render.renderHTML(back.value, resolve) || '<span class="muted">Preview</span>';
    };
    const previewSoon = debounce(preview, 150);
    deckImages(deck.id).then((list) => {
      resolve = Img.makeResolver(list);
      preview();
    });
    preview();

    async function onPaste(e) {
      const file = Array.from((e.clipboardData && e.clipboardData.files) || []).find((f) => /^image\//.test(f.type));
      if (!file) return;
      e.preventDefault();
      const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/\+.*/, '');
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      const name = `pasted-${stamp}-${Math.random().toString(36).slice(2, 5)}.${ext}`;
      const ta = e.target;
      const [img] = (await Img.filesToImages([new File([file], name, { type: file.type })])).images;
      await db.putImages(deck.id, [img]);
      const list = await deckImages(deck.id, true);
      resolve = Img.makeResolver(list);
      const insert = `![](${name})`;
      const { selectionStart: a, selectionEnd: b, value } = ta;
      const pre = a > 0 && value[a - 1] !== '\n' ? '\n' : '';
      ta.value = value.slice(0, a) + pre + insert + '\n' + value.slice(b);
      ta.selectionStart = ta.selectionEnd = a + pre.length + insert.length + 1;
      preview();
      toast('Image added to the deck');
    }

    async function save() {
      if (!front.value.trim()) {
        toast('The question is empty', 'error');
        front.focus();
        return;
      }
      let saved;
      if (isNew) {
        saved = { id: uid(), front: front.value.trim(), back: back.value.trim(), srs: null, createdAt: Date.now() };
        deck.cards.push(saved);
      } else {
        saved = deck.cards.find((c) => c.id === card.id);
        if (!saved) {
          toast('This card no longer exists', 'error');
          closeModal();
          return;
        }
        saved.front = front.value.trim();
        saved.back = back.value.trim();
      }
      await db.putDeck(deck);
      closeModal();
      toast('Card saved', 'ok');
      onDone && onDone(saved, 'save');
    }

    [front, back].forEach((ta) => {
      ta.addEventListener('input', previewSoon);
      ta.addEventListener('paste', onPaste);
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          save();
        }
      });
    });
    qs('#ed-save', m).addEventListener('click', save);
    qs('#ed-cancel', m).addEventListener('click', closeModal);
    const del = qs('#ed-delete', m);
    if (del) {
      del.addEventListener('click', async () => {
        if (!confirm('Delete this card?')) return;
        deck.cards = deck.cards.filter((c) => c.id !== card.id);
        await db.putDeck(deck);
        closeModal();
        toast('Card deleted');
        onDone && onDone(card, 'delete');
      });
    }
    front.focus();
  }

  // ------------------------------------------------------------------ cards
  async function viewCards(id) {
    const token = viewToken;
    const deck = await db.getDeck(id);
    if (!deck) return notFound();
    const imgs = await deckImages(id);
    if (stale(token)) return;
    const resolve = Img.makeResolver(imgs);
    let shown = PAGE_SIZE;

    $app.innerHTML = `<section class="page">
      ${backLink('#/deck/' + deck.id, deck.name)}
      <div class="page-head">
        <h1>Cards</h1>
        <button class="btn btn-primary" id="add-card">${icon('plus')} Add card</button>
      </div>
      <div class="toolbar glass">
        <label class="search-field grow">${icon('search')}<input type="search" id="search" placeholder="Search cards…" aria-label="Search cards"></label>
        <select id="filter" aria-label="Filter cards">
          <option value="all">All cards</option>
          <option value="due">Due now</option>
          <option value="new">New</option>
          <option value="learned">Learned</option>
          <option value="hard">Often forgotten</option>
        </select>
      </div>
      <p class="small count-line" id="count"></p>
      <ol class="card-list" id="list"></ol>
      <p class="center"><button class="btn" id="more" hidden>Show more</button></p>
    </section>`;

    const now = Date.now();
    function status(c) {
      if (!c.srs) return '<span class="chip chip-new">new</span>';
      if (c.srs.due <= now) return '<span class="chip chip-due">due</span>';
      return `<span class="chip">${h(srs.formatDue(c.srs.due, now))}</span>`;
    }

    function draw() {
      const q = qs('#search').value.trim().toLowerCase();
      const f = qs('#filter').value;
      const list = deck.cards.filter((c) => {
        if (q && !(c.front + '\n' + c.back).toLowerCase().includes(q)) return false;
        if (f === 'due') return c.srs && c.srs.due <= now;
        if (f === 'new') return !c.srs;
        if (f === 'learned') return !!c.srs;
        if (f === 'hard') return c.srs && (c.srs.lapses >= 2 || c.srs.ease < 2.0);
        return true;
      });
      qs('#count').textContent = list.length === deck.cards.length ? plural(list.length, 'card') : `${list.length} of ${plural(deck.cards.length, 'card')}`;
      qs('#list').innerHTML = list
        .slice(0, shown)
        .map(
          (c) => `<li class="card-row" data-id="${c.id}">
            <div class="cr-side md">${render.renderHTML(c.front, resolve)}</div>
            <div class="cr-side cr-back md">${render.renderHTML(c.back, resolve)}</div>
            <div class="cr-meta">${status(c)}<button class="btn btn-sm btn-ghost" data-edit="${c.id}">${icon('pencil')} Edit</button></div>
          </li>`
        )
        .join('');
      qs('#more').hidden = list.length <= shown;
    }

    const drawSoon = debounce(draw, 150);
    qs('#search').addEventListener('input', drawSoon);
    qs('#filter').addEventListener('change', draw);
    qs('#more').addEventListener('click', () => {
      shown += PAGE_SIZE;
      draw();
    });
    qs('#list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-edit]');
      if (!b) return;
      const card = deck.cards.find((c) => c.id === b.dataset.edit);
      if (card) openCardEditor(deck, card, draw);
    });
    qs('#add-card').addEventListener('click', () => openCardEditor(deck, null, draw));
    draw();
  }

  // ----------------------------------------------------------------- images
  async function viewImages(id) {
    const token = viewToken;
    const deck = await db.getDeck(id);
    if (!deck) return notFound();
    await deckImages(id, true);
    if (stale(token)) return;

    $app.innerHTML = `<section class="page">
      ${backLink('#/deck/' + deck.id, deck.name)}
      <div class="page-head"><h1>Images</h1></div>
      <div class="glass panel">
      <div class="dropzone" id="drop" tabindex="0">
        <span class="dropzone-icon">${icon('upload')}</span>
        <p>Drop a lecture <strong>PDF</strong> or image files here, or <label class="link">choose files<input type="file" id="img-files" accept="image/*,.pdf,application/pdf" multiple hidden></label></p>
        <p class="muted small">Every page of a PDF becomes an image named like <code>slides.pdf#page=4</code>. Adding a file with the same name replaces the old one.</p>
        <p class="small" id="progress"></p>
      </div>
      </div>
      <div id="missing"></div>
      <div id="groups"></div>
    </section>`;

    function draw() {
      const list = imgCache.list;
      const resolve = Img.makeResolver(list);
      const missing = missingRefs(deck.cards, resolve);
      const uses = new Map();
      for (const c of deck.cards) {
        for (const ref of render.imageRefs(c.front + '\n' + c.back)) {
          const r = resolve(ref);
          const img = r.src && list.find((i) => i.url === r.src);
          if (img) uses.set(img.id, (uses.get(img.id) || 0) + 1);
        }
      }
      qs('#missing').innerHTML = missing.size
        ? `<div class="banner banner-warn">${icon('image')}<strong>Used in cards but not added yet:</strong>
            <ul class="missing-list">${[...missing].map(([ref, n]) => `<li><code>${h(ref)}</code> <span class="muted">(${plural(n, 'card')})</span></li>`).join('')}</ul></div>`
        : '';

      const groups = new Map();
      for (const img of list) {
        const g = img.pdf || '';
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(img);
      }
      const sections = [...groups.entries()]
        .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
        .map(([pdf, imgs]) => {
          imgs.sort((a, b) => (a.page || 0) - (b.page || 0) || a.name.localeCompare(b.name));
          return `<section class="img-group glass">
            <div class="img-group-head">
              <h2>${icon(pdf ? 'file-text' : 'images')} ${pdf ? h(pdf) : 'Image files'} <span class="muted">(${imgs.length})</span></h2>
              ${pdf ? `<button class="btn btn-sm btn-danger" data-del-pdf="${h(pdf)}">${icon('trash-2')} Delete all pages</button>` : ''}
            </div>
            <ul class="img-grid">${imgs
              .map(
                (i) => `<li class="img-tile">
                  <img src="${h(i.url)}" alt="${h(i.name)}" loading="lazy" data-zoom>
                  <div class="img-tile-name" title="${h(i.name)}">${h(i.page ? 'Page ' + i.page : i.name)}</div>
                  <div class="img-tile-meta">${uses.get(i.id) ? `<span class="chip chip-new">${plural(uses.get(i.id), 'card')}</span>` : '<span class="muted small">unused</span>'}
                    <span class="row gap-sm">
                      <button class="icon-btn" data-copy="${h(i.name)}" title="Copy reference" aria-label="Copy reference to ${h(i.name)}">${icon('copy')}</button>
                      <button class="icon-btn" data-del="${h(i.id)}" title="Delete" aria-label="Delete ${h(i.name)}">${icon('trash-2')}</button>
                    </span>
                  </div>
                </li>`
              )
              .join('')}</ul>
          </section>`;
        });
      qs('#groups').innerHTML = sections.length ? sections.join('') : `<div class="glass panel empty-preview">${icon('images')}<strong>No images yet</strong><span>Add the lecture PDF so cards can show its pages.</span></div>`;
    }

    async function addFiles(files) {
      const progress = qs('#progress');
      try {
        const { images, skipped } = await Img.filesToImages(Array.from(files), (msg) => (progress.textContent = msg));
        if (images.length) await db.putImages(deck.id, images);
        if (skipped.length) toast(`Skipped (not images or PDFs): ${skipped.join(', ')}`, 'error');
        else if (images.length) toast(`Added ${plural(images.length, 'image')}`, 'ok');
      } catch (e) {
        console.error(e);
        toast(e.message, 'error');
      }
      progress.textContent = '';
      if (stale(token)) return;
      await deckImages(deck.id, true);
      draw();
    }

    setupDropTarget(qs('#drop'), addFiles);
    qs('#img-files').addEventListener('change', (e) => {
      addFiles(e.target.files);
      e.target.value = '';
    });
    qs('#groups').addEventListener('click', async (e) => {
      const copy = e.target.closest('[data-copy]');
      const del = e.target.closest('[data-del]');
      const delPdf = e.target.closest('[data-del-pdf]');
      if (copy) {
        const ok = await copyText(`![](${copy.dataset.copy})`);
        toast(ok ? 'Copied ' + `![](${copy.dataset.copy})` : 'Copy failed', ok ? 'ok' : 'error');
      } else if (del) {
        await db.deleteImages([del.dataset.del]);
        await deckImages(deck.id, true);
        draw();
      } else if (delPdf) {
        const pdf = delPdf.dataset.delPdf;
        if (!confirm(`Delete all pages of ${pdf}?`)) return;
        await db.deleteImages(imgCache.list.filter((i) => i.pdf === pdf).map((i) => i.id));
        await deckImages(deck.id, true);
        draw();
      }
    });
    draw();
  }

  // ------------------------------------------------------------------ study
  async function viewStudy(id, mode) {
    const token = viewToken;
    const deck = await db.getDeck(id);
    if (!deck) return notFound();
    const imgs = await deckImages(id);
    if (stale(token)) return;
    let resolve = Img.makeResolver(imgs);
    const practice = mode === 'practice';
    const byId = () => new Map(deck.cards.map((c) => [c.id, c]));
    let cardsById = byId();

    let queue = practice ? shuffle(deck.cards.map((c) => c.id)) : srs.buildQueue(deck.cards, newLimitFor(deck), Date.now());
    const total = queue.length;
    const done = new Set();
    const tally = { 1: 0, 2: 0, 3: 0, 4: 0 };
    const history = [];
    let flipped = false;
    const started = Date.now();

    $app.innerHTML = `<section class="study">
      <div class="study-top glass">
        <a class="icon-btn" href="#/deck/${deck.id}" aria-label="End session" title="End session (Esc)">${icon('x')}</a>
        <div class="study-title" title="${h(deck.name)}"><span>${h(deck.name)}</span>${practice ? ` <span class="chip chip-accent">${icon('shuffle')}practice</span>` : ''}</div>
        <div class="study-count" id="count"></div>
        <button class="icon-btn" id="edit" title="Edit card (E)" aria-label="Edit card">${icon('pencil')}</button>
      </div>
      <div class="progress" aria-hidden="true"><div class="progress-bar" id="bar"></div></div>
      <div class="card-stage" id="stage">
        <article class="flashcard" id="card" tabindex="-1" aria-live="polite">
          <div class="card-inner">
            <div class="face face-front md" id="front"></div>
            <div class="face face-back md" id="back" hidden></div>
          </div>
        </article>
      </div>
      <div class="study-controls" id="controls"></div>
      <div class="study-foot muted small" id="foot"></div>
    </section>`;

    const $count = qs('#count');
    const $front = qs('#front');
    const $back = qs('#back');
    const $controls = qs('#controls');
    const $card = qs('#card');

    function current() {
      return cardsById.get(queue[0]);
    }

    function counts() {
      if (practice) return `<span class="c-done" title="Cards done">${done.size} / ${total}</span>`;
      let n = 0;
      let l = 0;
      let r = 0;
      for (const cid of new Set(queue)) {
        const c = cardsById.get(cid);
        if (!c) continue;
        if (!c.srs) n++;
        else if (c.srs.interval === 0) l++;
        else r++;
      }
      return `<span class="c-new" title="New cards left">${n}<small> new</small></span><span class="c-learn" title="Cards to see again this session">${l}<small> again</small></span><span class="c-due" title="Reviews left">${r}<small> review</small></span>`;
    }

    function show() {
      while (queue.length && !current()) queue.shift(); // card deleted mid-session
      $count.innerHTML = counts();
      qs('#bar').style.width = (total ? Math.round(((total - new Set(queue).size) / total) * 100) : 100) + '%';
      if (!queue.length) return finish();
      const c = current();
      flipped = false;
      $front.innerHTML = render.renderHTML(c.front, resolve);
      $back.innerHTML = render.renderHTML(c.back, resolve);
      $back.hidden = true;
      $card.classList.remove('flipped', 'card-in');
      void $card.offsetWidth; // restart the entrance animation
      $card.classList.add('card-in');
      $controls.innerHTML = `<button class="btn btn-primary btn-xl" id="flip"><span class="btn-title">${icon('eye')} Show answer <kbd>Space</kbd></span></button>`;
      qs('#flip').addEventListener('click', flip);
      qs('#foot').innerHTML =
        (history.length ? `<button class="btn btn-sm btn-ghost" id="undo">${icon('undo-2')} Undo <kbd>U</kbd></button>` : '') +
        `<span class="shortcut-hint">${icon('keyboard')} Space flip · 1–4 rate · E edit</span>`;
      const undoBtn = qs('#undo');
      if (undoBtn) undoBtn.addEventListener('click', undo);
      $card.focus({ preventScroll: true });
      qs('#stage').scrollTop = 0;
    }

    function flip() {
      if (flipped || !queue.length) return;
      flipped = true;
      $back.hidden = false;
      $card.classList.add('flipped');
      const c = current();
      if (practice) {
        $controls.innerHTML = `<div class="ratings ratings-2">
          <button class="rate r-again" data-r="1">Again<small>see it later <kbd>1</kbd></small></button>
          <button class="rate r-good" data-r="3">Got it<small><kbd>Space</kbd></small></button>
        </div>`;
      } else {
        const iv = srs.nextIntervals(c.srs);
        const lbl = (r) => srs.formatInterval(iv[r]);
        $controls.innerHTML = `<div class="ratings">
          <button class="rate r-again" data-r="1">Again<small>${lbl(1)} <kbd>1</kbd></small></button>
          <button class="rate r-hard" data-r="2">Hard<small>${lbl(2)} <kbd>2</kbd></small></button>
          <button class="rate r-good" data-r="3">Good<small>${lbl(3)} <kbd>3</kbd></small></button>
          <button class="rate r-easy" data-r="4">Easy<small>${lbl(4)} <kbd>4</kbd></small></button>
        </div>`;
      }
      qsa('[data-r]', $controls).forEach((b) => b.addEventListener('click', () => answer(+b.dataset.r)));
    }

    async function answer(r) {
      if (!flipped || !queue.length) return;
      const c = current();
      history.push({ id: c.id, srs: c.srs ? { ...c.srs } : null, queue: queue.slice(), done: new Set(done), newLog: deck.newLog ? { ...deck.newLog } : null, r });
      if (history.length > 50) history.shift();
      tally[r]++;
      queue.shift();
      recordActivity();
      if (practice) {
        if (r === 1) queue.splice(Math.min(queue.length, 4), 0, c.id);
        else done.add(c.id);
      } else {
        const wasNew = !c.srs;
        c.srs = srs.schedule(c.srs, r, Date.now());
        if (wasNew) {
          const today = srs.dayKey(Date.now());
          deck.newLog = { day: today, count: (deck.newLog && deck.newLog.day === today ? deck.newLog.count : 0) + 1 };
        }
        if (r === 1) queue.splice(Math.min(queue.length, 4), 0, c.id);
        else done.add(c.id);
        deck.lastStudied = Date.now();
        persist();
      }
      show();
    }

    let saving = Promise.resolve();
    function persist() {
      // Save the latest state; chain so writes stay in order.
      saving = saving.then(() => db.putDeck(deck)).catch((e) => toast('Could not save progress: ' + e.message, 'error'));
      pendingWrites = saving;
    }

    function undo() {
      const last = history.pop();
      if (!last) return;
      const c = cardsById.get(last.id);
      if (c) c.srs = last.srs;
      queue = last.queue;
      done.clear();
      last.done.forEach((x) => done.add(x));
      deck.newLog = last.newLog;
      tally[last.r]--;
      if (!practice) persist();
      show();
      flip();
    }

    function finish() {
      const reviewed = tally[1] + tally[2] + tally[3] + tally[4];
      const mins = Math.max(1, Math.round((Date.now() - started) / 60000));
      const s = srs.deckStats(deck.cards, Date.now());
      const moreNew = !practice && s.new > 0;
      $count.innerHTML = '';
      $card.classList.add('flipped');
      const tallyChip = (n, label, tone) => `<span style="--tone:${tone}">${label} ${n}</span>`;
      $front.innerHTML = total
        ? `<div class="done"><div class="done-mark" aria-hidden="true">${icon('party-popper')}</div><h2>${practice ? 'Practice complete' : 'Session complete'}</h2>
            <p>${plural(total, 'card')} in about ${plural(mins, 'minute')}${reviewed !== total ? ` (${reviewed} answers)` : ''}.</p>
            <div class="done-tally">${
              practice
                ? tallyChip(tally[1], 'Again', 'var(--again)') + tallyChip(tally[3], 'Got it', 'var(--good)')
                : tallyChip(tally[1], 'Again', 'var(--again)') + tallyChip(tally[2], 'Hard', 'var(--hard)') + tallyChip(tally[3], 'Good', 'var(--good)') + tallyChip(tally[4], 'Easy', 'var(--easy)')
            }</div>
            ${!practice && s.nextDue ? `<p class="muted">Next review ${srs.formatDue(s.nextDue).replace('due ', '')}.</p>` : ''}
            ${streakDays() > 1 ? `<p class="streak center">${icon('flame')}<b>${streakDays()}</b> day streak</p>` : ''}</div>`
        : `<div class="done"><div class="done-mark" aria-hidden="true">${icon('check')}</div><h2>Nothing to study right now</h2><p class="muted">${s.nextDue ? 'Next review ' + srs.formatDue(s.nextDue).replace('due ', '') + '.' : ''}</p></div>`;
      if (total) {
        const rect = $card.getBoundingClientRect();
        scene.celebrate(rect.left + rect.width / 2, rect.top + rect.height * 0.3);
      }
      $back.hidden = true;
      $controls.innerHTML = `<div class="row wrap center">
        <a class="btn btn-primary btn-lg" href="#/deck/${deck.id}">${icon('arrow-left')} Back to deck</a>
        ${moreNew ? `<button class="btn btn-lg" id="more-new">${icon('sparkles')} More new cards</button>` : ''}
        <a class="btn btn-lg" href="#/practice/${deck.id}" id="practice-link">${icon('shuffle')} ${practice ? 'Practice again' : 'Practice all'}</a>
      </div>`;
      qs('#foot').innerHTML = '';
      const more = qs('#more-new');
      if (more) {
        more.addEventListener('click', async () => {
          await saving;
          allowMoreNew(deck, Math.min(s.new, deck.newPerDay || DEFAULT_NEW_PER_DAY));
          await db.putDeck(deck);
          route();
        });
      }
      const pl = qs('#practice-link');
      if (practice && pl) pl.addEventListener('click', (e) => {
        e.preventDefault();
        route();
      });
    }

    function edit() {
      const c = current();
      if (!c) return;
      openCardEditor(deck, c, async (saved, action) => {
        cardsById = byId();
        resolve = Img.makeResolver(await deckImages(deck.id));
        if (action === 'delete') queue = queue.filter((x) => x !== saved.id);
        const wasFlipped = flipped;
        show();
        if (wasFlipped && action !== 'delete') flip();
      });
    }

    function onKey(e) {
      if (isModalOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      const k = e.key;
      if (k === 'Escape') {
        location.hash = '#/deck/' + deck.id;
      } else if (!queue.length) {
        return;
      } else if (k === ' ' || k === 'Enter') {
        if (e.target.closest && e.target.closest('button, a') && e.target !== $card) return; // let buttons handle it
        e.preventDefault();
        if (!flipped) flip();
        else answer(3);
      } else if (flipped && /^[1-4]$/.test(k)) {
        e.preventDefault();
        const r = +k;
        answer(practice ? (r === 1 ? 1 : 3) : r);
      } else if (k === 'e' || k === 'E') {
        e.preventDefault();
        edit();
      } else if (k === 'u' || k === 'U') {
        e.preventDefault();
        undo();
      } else if (k === 'ArrowRight' && practice && flipped) {
        answer(3);
      } else if (k === 'ArrowLeft' && practice && flipped) {
        answer(1);
      }
    }
    document.addEventListener('keydown', onKey);
    onCleanup(() => document.removeEventListener('keydown', onKey));

    $card.addEventListener('click', (e) => {
      if (e.target.closest('a, img[data-zoom], button')) return;
      if (window.getSelection && String(window.getSelection()).length) return;
      if (!flipped) flip();
    });
    qs('#edit').addEventListener('click', edit);

    show();
  }

  // ------------------------------------------------------------------- boot
  window.addEventListener('hashchange', route);
  route();
})();
