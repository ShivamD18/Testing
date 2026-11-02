/*
 * The animated seasonal landscape behind the app.
 *
 * Colours come from CSS custom properties set per season (data-season on
 * <html>) and per light/dark mode, so changing season smoothly blends the
 * whole scene. This file only builds the shapes and runs the particles
 * (petals, summer light/fireflies, leaves, snow) on a canvas.
 */
(function (root) {
  'use strict';
  const doc = root.document;
  const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
  const W = 1600;
  const H = 700;

  // ---------------------------------------------------------- landscape SVG
  const wave = (base, parts) => (x) => base + parts.reduce((s, [a, p, ph]) => s + a * Math.sin(x / p + ph), 0);
  const HILLS = [
    wave(470, [[24, 170, 0.4], [12, 70, 1.3]]),
    wave(530, [[32, 220, 2.1], [11, 90, 0.2]]),
    wave(598, [[36, 260, 4.2], [9, 115, 1.1]]),
    wave(660, [[26, 300, 1.2], [8, 140, 0.3]]),
  ];

  function hillPath(f) {
    let d = `M0 ${H} L0 ${f(0).toFixed(1)}`;
    for (let x = 16; x <= W; x += 16) d += ` L${x} ${f(x).toFixed(1)}`;
    return d + ` L${W} ${H} Z`;
  }

  const PEAKS = [
    [0, 420], [110, 330], [210, 385], [330, 270], [450, 360], [560, 300], [690, 390], [820, 255],
    [950, 365], [1070, 305], [1190, 380], [1320, 275], [1450, 360], [1540, 320], [1600, 350],
  ];

  function mountains() {
    const body = 'M0 ' + H + ' ' + PEAKS.map(([x, y]) => `L${x} ${y}`).join(' ') + ` L${W} ${H} Z`;
    // Snow caps: a jagged band hanging from every high peak.
    let caps = '';
    for (let i = 1; i < PEAKS.length - 1; i++) {
      const [x, y] = PEAKS[i];
      const [lx, ly] = PEAKS[i - 1];
      const [rx, ry] = PEAKS[i + 1];
      if (y > 340) continue;
      const t = 0.32;
      const L = [x + (lx - x) * t, y + (ly - y) * t];
      const R = [x + (rx - x) * t, y + (ry - y) * t];
      const mid = (a, b, k) => a + (b - a) * k;
      caps += `M${x} ${y} L${L[0].toFixed(1)} ${L[1].toFixed(1)} L${mid(L[0], x, 0.45).toFixed(1)} ${(mid(L[1], y, 0.45) + 9).toFixed(1)} ` +
        `L${x} ${y + 16} L${mid(R[0], x, 0.45).toFixed(1)} ${(mid(R[1], y, 0.45) + 9).toFixed(1)} L${R[0].toFixed(1)} ${R[1].toFixed(1)} Z `;
    }
    return `<path class="mtn" d="${body}"/><path class="mtn-snow" d="${caps}"/>`;
  }

  function roundTree(x, y, s) {
    return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s})">
      <path class="trunk" d="M-3.2 2 L-2 -30 L2 -30 L3.2 2 Z"/>
      <path class="branches" d="M0 -18 L-11 -31 M0 -24 L10 -38 M0 -29 L-3 -45 M-11 -31 L-16 -36 M10 -38 L15 -43 M-3 -45 L2 -50"/>
      <g class="canopy">
        <circle class="leaf-2" cx="-11" cy="-34" r="11"/>
        <circle class="leaf-2" cx="11" cy="-35" r="12"/>
        <circle class="leaf-1" cx="0" cy="-43" r="15"/>
        <circle class="leaf-hi" cx="-5" cy="-48" r="5"/>
      </g>
    </g>`;
  }

  function pineTree(x, y, s) {
    return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s})">
      <rect class="trunk" x="-2.5" y="-8" width="5" height="10"/>
      <path class="pine" d="M0 -64 L-13 -40 L-7 -40 L-17 -22 L-10 -22 L-21 -6 L21 -6 L10 -22 L17 -22 L7 -40 L13 -40 Z"/>
      <path class="pine-snow" d="M0 -64 L-8 -49 L-3 -51 L0 -47 L3 -51 L8 -49 Z M-9 -36 L-14 -27 L-8 -29 L-4 -26 L0 -30 L4 -26 L8 -29 L14 -27 L9 -36 L0 -33 Z M-11 -18 L-18 -9 L-11 -11 L-5 -8 L0 -12 L5 -8 L11 -11 L18 -9 L11 -18 L0 -15 Z"/>
    </g>`;
  }

  // [hill index, x, scale, kind]
  const TREES = [
    [0, 260, 0.38, 'p'], [0, 285, 0.32, 'p'], [0, 930, 0.36, 'r'], [0, 1240, 0.34, 'p'],
    [1, 120, 0.55, 'r'], [1, 160, 0.5, 'p'], [1, 640, 0.52, 'r'], [1, 1010, 0.56, 'p'], [1, 1045, 0.48, 'p'], [1, 1400, 0.55, 'r'],
    [2, 70, 0.85, 'p'], [2, 410, 0.8, 'r'], [2, 455, 0.7, 'r'], [2, 820, 0.78, 'p'], [2, 1180, 0.85, 'r'], [2, 1520, 0.8, 'p'],
    [3, 40, 1.35, 'r'], [3, 130, 1.1, 'p'], [3, 1460, 1.2, 'p'], [3, 1560, 1.4, 'r'],
  ];

  function flowers() {
    // Little dots on the front hill (blossoms in spring, buttercups in summer).
    let out = '';
    const f = HILLS[3];
    let seed = 7;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 70; i++) {
      const x = rnd() * W;
      const y = f(x) + 6 + rnd() * 30;
      out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(1.6 + rnd() * 2).toFixed(1)}"/>`;
    }
    return `<g class="flowers">${out}</g>`;
  }

  function landscapeSVG() {
    let svg = `<svg class="scene-land" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">`;
    svg += mountains();
    HILLS.forEach((f, i) => {
      svg += `<path class="hill hill-${i + 1}" d="${hillPath(f)}"/>`;
      if (i === 3) svg += flowers();
      svg += TREES.filter((t) => t[0] === i)
        .map(([, x, s, k]) => (k === 'p' ? pineTree : roundTree)(x, f(x) + 3, s))
        .join('');
    });
    return svg + '</svg>';
  }

  const CLOUD = '<svg viewBox="0 0 200 70" aria-hidden="true"><path d="M30 60 C8 60 4 38 24 33 C22 15 46 6 62 18 C70 2 104 0 114 20 C128 8 156 14 156 34 C178 32 192 46 182 58 C178 60 172 60 168 60 Z"/></svg>';

  function buildScene() {
    const scene = doc.createElement('div');
    scene.className = 'scene';
    scene.setAttribute('aria-hidden', 'true');
    let stars = '';
    let seed = 3;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 90; i++) {
      const size = rnd() < 0.85 ? 1.5 : 2.5;
      stars += `<i style="left:${(rnd() * 100).toFixed(2)}%;top:${(rnd() * 58).toFixed(2)}%;width:${size}px;height:${size}px;animation-delay:${(-rnd() * 6).toFixed(2)}s"></i>`;
    }
    scene.innerHTML = `
      <div class="scene-sky"></div>
      <div class="scene-stars">${stars}</div>
      <div class="scene-sun"></div>
      <div class="scene-clouds">
        <div class="cloud c1">${CLOUD}</div><div class="cloud c2">${CLOUD}</div>
        <div class="cloud c3">${CLOUD}</div><div class="cloud c4">${CLOUD}</div>
      </div>
      ${landscapeSVG()}
      <canvas class="scene-particles"></canvas>`;
    doc.body.prepend(scene);
    return scene;
  }

  // --------------------------------------------------------------- particles
  const PALETTE = {
    spring: { kind: 'petal', n: 28, colors: ['#ffb3c8', '#ff8fb0', '#ffd6e2', '#ffffff'] },
    summer: { kind: 'mote', n: 30, colors: ['#fff7b8', '#ffffff', '#c8ffef'] },
    autumn: { kind: 'leaf', n: 24, colors: ['#ff8a3d', '#e8483f', '#ffb938', '#c2410c'] },
    winter: { kind: 'snow', n: 70, colors: ['#ffffff', '#eef4ff'] },
  };
  const NIGHT = { summer: { kind: 'firefly', colors: ['#eaff8a', '#fff59a', '#b9ff9c'] } };

  let canvas;
  let ctx;
  let fx; // confetti canvas, in front of the content
  let fxCtx;
  let particles = [];
  let confetti = [];
  let running = false;
  let last = 0;
  let season = 'spring';
  let night = false;
  let motion = true;
  let dpr = 1;
  let vw = 0;
  let vh = 0;

  function style() {
    const base = PALETTE[season];
    return night && NIGHT[season] ? { ...base, ...NIGHT[season] } : base;
  }

  function targetCount() {
    const area = Math.min(1.1, Math.max(0.35, (vw * vh) / (1440 * 900)));
    return Math.round(style().n * area);
  }

  function spawn(initial) {
    const st = style();
    const kind = st.kind;
    const p = {
      kind,
      color: st.colors[Math.floor(Math.random() * st.colors.length)],
      x: Math.random() * vw,
      y: initial ? Math.random() * vh : kind === 'mote' || kind === 'firefly' ? vh + 10 : -20,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 1.6,
      phase: Math.random() * Math.PI * 2,
      age: 0,
    };
    if (kind === 'snow') {
      p.size = 1.2 + Math.random() * 2.6;
      p.vy = 18 + p.size * 9;
      p.sway = 10 + Math.random() * 18;
    } else if (kind === 'petal') {
      p.size = 4 + Math.random() * 4;
      p.vy = 22 + Math.random() * 22;
      p.sway = 30 + Math.random() * 30;
    } else if (kind === 'leaf') {
      p.size = 7 + Math.random() * 6;
      p.vy = 30 + Math.random() * 30;
      p.sway = 50 + Math.random() * 50;
      p.vr *= 1.6;
    } else {
      // floating light (summer day) or fireflies (summer night)
      p.size = kind === 'firefly' ? 1.6 + Math.random() * 1.6 : 1.5 + Math.random() * 2.5;
      p.vy = -(6 + Math.random() * 12);
      p.sway = 14 + Math.random() * 20;
      if (initial) p.y = vh * (0.3 + Math.random() * 0.7);
    }
    return p;
  }

  function drawParticle(p, t) {
    const sx = p.x + Math.sin(t * 0.6 + p.phase) * p.sway * 0.25;
    ctx.save();
    ctx.translate(sx, p.y);
    if (p.kind === 'snow') {
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(0, 0, p.size, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === 'petal') {
      ctx.rotate(p.rot);
      ctx.scale(1, 0.55 + 0.45 * Math.sin(t * 2 + p.phase));
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size, p.size * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === 'leaf') {
      ctx.rotate(p.rot);
      ctx.scale(1, 0.45 + 0.55 * Math.abs(Math.sin(t * 1.5 + p.phase)));
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = p.color;
      const s = p.size;
      ctx.beginPath();
      ctx.moveTo(-s, 0);
      ctx.quadraticCurveTo(-s * 0.2, -s * 0.75, s, 0);
      ctx.quadraticCurveTo(-s * 0.2, s * 0.75, -s, 0);
      ctx.fill();
      ctx.strokeStyle = 'rgba(80,30,10,.35)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(-s, 0);
      ctx.lineTo(s * 0.8, 0);
      ctx.stroke();
    } else {
      const glow = p.kind === 'firefly' ? 0.35 + 0.65 * Math.max(0, Math.sin(t * 2.2 + p.phase)) : 0.45 + 0.35 * Math.sin(t * 1.3 + p.phase);
      const r = p.size * (p.kind === 'firefly' ? 5 : 4);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, p.color);
      g.addColorStop(0.25, p.color);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalAlpha = glow;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawConfetti(c) {
    fxCtx.save();
    fxCtx.translate(c.x, c.y);
    fxCtx.rotate(c.rot);
    fxCtx.globalAlpha = Math.max(0, 1 - c.age / c.life);
    fxCtx.fillStyle = c.color;
    fxCtx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h * Math.abs(Math.cos(c.age * 6 + c.phase)));
    fxCtx.restore();
  }

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    // ~30 fps is plenty for drifting particles and kinder to laptops.
    if (now - last < 32) return;
    const dt = Math.min(0.1, (now - last) / 1000 || 0.016);
    last = now;
    const t = now / 1000;
    ctx.clearRect(0, 0, vw, vh);
    fxCtx.clearRect(0, 0, vw, vh);

    const want = motion ? targetCount() : 0;
    particles = particles.filter((p) => {
      p.age += dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.x += Math.sin(t * 0.4 + p.phase) * 6 * dt;
      if (p.vy > 0 ? p.y > vh + 30 : p.y < -30) return false; // left the screen
      drawParticle(p, t);
      return true;
    });
    // Top up a few at a time so new particles (possibly of a new season) drift in naturally.
    if (particles.length < want && Math.random() < 0.35) particles.push(spawn(false));

    confetti = confetti.filter((c) => {
      c.age += dt;
      c.vy += 520 * dt;
      c.vx *= 0.985;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.rot += c.vr * dt;
      if (c.age > c.life || c.y > vh + 40) return false;
      drawConfetti(c);
      return true;
    });

    if (!motion && !confetti.length && !particles.length) stop();
  }

  function resize() {
    if (!canvas) return;
    dpr = Math.min(2, root.devicePixelRatio || 1);
    vw = root.innerWidth;
    vh = root.innerHeight;
    for (const [c, cx] of [[canvas, ctx], [fx, fxCtx]]) {
      c.width = Math.round(vw * dpr);
      c.height = Math.round(vh * dpr);
      c.style.width = vw + 'px';
      c.style.height = vh + 'px';
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  function start() {
    if (running || doc.hidden) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (ctx) ctx.clearRect(0, 0, vw, vh);
    if (fxCtx) fxCtx.clearRect(0, 0, vw, vh);
  }

  // ------------------------------------------------------------------ api
  const reducedMotion = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  const api = {
    SEASONS,
    init() {
      const scene = buildScene();
      canvas = scene.querySelector('.scene-particles');
      ctx = canvas.getContext('2d');
      fx = doc.createElement('canvas');
      fx.className = 'fx-layer';
      fx.setAttribute('aria-hidden', 'true');
      doc.body.appendChild(fx);
      fxCtx = fx.getContext('2d');
      resize();
      root.addEventListener('resize', resize);
      doc.addEventListener('visibilitychange', () => (doc.hidden ? (running = false) : (motion || confetti.length) && start()));
    },
    /** Called whenever season, light/dark or motion preference changes. */
    set(opts) {
      const prevSeason = season;
      season = opts.season;
      night = !!opts.night;
      motion = !!opts.motion && !reducedMotion.matches;
      doc.documentElement.dataset.motion = motion ? 'on' : 'off';
      if (prevSeason !== season) {
        // Let the old season's particles fall away; new ones spawn as they leave.
        particles = particles.slice(0, Math.ceil(particles.length / 2));
      }
      if (motion) {
        if (!particles.length) for (let i = 0; i < targetCount(); i++) particles.push(spawn(true));
        start();
      } else {
        particles = [];
      }
    },
    /** A burst of confetti in the season's colours (e.g. a finished session). */
    celebrate(x, y) {
      if (reducedMotion.matches || !ctx) return;
      const cs = getComputedStyle(doc.documentElement);
      const colors = [cs.getPropertyValue('--accent'), cs.getPropertyValue('--accent-2'), '#ffd43b', '#ffffff', ...style().colors].map((c) => c.trim()).filter(Boolean);
      x = x ?? vw / 2;
      y = y ?? vh * 0.4;
      for (let i = 0; i < 110; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 220 + Math.random() * 420;
        confetti.push({
          x, y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v - 260,
          w: 5 + Math.random() * 6,
          h: 8 + Math.random() * 8,
          rot: Math.random() * 6,
          vr: (Math.random() - 0.5) * 12,
          phase: Math.random() * 6,
          color: colors[i % colors.length],
          age: 0,
          life: 1.8 + Math.random() * 1.2,
        });
      }
      start();
    },
    seasonFor(date) {
      const m = (date || new Date()).getMonth();
      return m >= 2 && m <= 4 ? 'spring' : m >= 5 && m <= 7 ? 'summer' : m >= 8 && m <= 10 ? 'autumn' : 'winter';
    },
  };

  (root.FC = root.FC || {}).scene = api;
})(self);
