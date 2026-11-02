/*
 * Card renderer: Markdown + LaTeX (KaTeX) + images.
 *
 * Pipeline:
 *   1. Protect code (``` blocks and `inline`) so nothing inside is touched.
 *   2. Pull out math ($…$, $$…$$, \(…\), \[…\], \begin{align}…) and images
 *      (![alt](ref)) and leave private-use placeholders, so Markdown can't
 *      mangle backslashes/underscores and file names may contain spaces.
 *   3. Markdown → HTML (marked), sanitize (DOMPurify).
 *   4. Swap placeholders for KaTeX output and <img> tags.
 *
 * extract() is pure and runs in Node for tests; renderHTML() needs the
 * browser globals katex, marked and DOMPurify.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.FC = root.FC || {}).render = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const MATH_OPEN = '';
  const MATH_CLOSE = '';
  const IMG_OPEN = '';
  const IMG_CLOSE = '';
  const CODE_OPEN = '';
  const CODE_CLOSE = '';

  const MATH_ENVS = [
    'equation', 'equation*', 'align', 'align*', 'aligned', 'gather', 'gather*', 'gathered',
    'alignat', 'alignat*', 'multline', 'multline*', 'split', 'cases', 'matrix', 'pmatrix',
    'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix', 'array', 'CD', 'eqnarray', 'eqnarray*',
  ];

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function isEscaped(src, i) {
    let n = 0;
    while (i - 1 - n >= 0 && src[i - 1 - n] === '\\') n++;
    return n % 2 === 1;
  }

  // Find `close` starting at `from`, skipping backslash-escaped occurrences.
  function findClose(src, close, from) {
    let j = from;
    for (;;) {
      j = src.indexOf(close, j);
      if (j < 0) return -1;
      if (!isEscaped(src, j)) return j;
      j += 1;
    }
  }

  function protectCode(src, codes) {
    // Fenced blocks first (line based), then inline code spans.
    const lines = src.split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const open = /^\s*(`{3,}|~{3,})/.exec(lines[i]);
      if (!open) {
        out.push(lines[i]);
        continue;
      }
      const fence = open[1];
      const closeRe = new RegExp('^\\s*' + (fence[0] === '`' ? '`' : '~') + '{' + fence.length + ',}\\s*$');
      let j = i + 1;
      while (j < lines.length && !closeRe.test(lines[j])) j++;
      const block = lines.slice(i, Math.min(j + 1, lines.length)).join('\n');
      codes.push(block);
      out.push(CODE_OPEN + (codes.length - 1) + CODE_CLOSE);
      i = j;
    }
    return out.join('\n').replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (m) => {
      codes.push(m);
      return CODE_OPEN + (codes.length - 1) + CODE_CLOSE;
    });
  }

  /**
   * Replace math and image syntax with placeholders.
   * Returns { text, math: [{tex, display}], images: [{alt, ref}] }.
   */
  function extract(src) {
    const codes = [];
    const math = [];
    const images = [];
    let s = protectCode(String(src || '').replace(/\r\n?/g, '\n'), codes);

    let out = '';
    let i = 0;
    const pushMath = (tex, display) => {
      math.push({ tex: tex.trim(), display });
      out += MATH_OPEN + (math.length - 1) + MATH_CLOSE;
    };
    while (i < s.length) {
      const c = s[i];
      if (c === '\\' && s[i + 1] === '$') {
        out += '\\$';
        i += 2;
        continue;
      }
      if (c === '$' && s[i + 1] === '$') {
        const j = findClose(s, '$$', i + 2);
        if (j > i + 2) {
          pushMath(s.slice(i + 2, j), true);
          i = j + 2;
          continue;
        }
        out += '$$';
        i += 2;
        continue;
      }
      if (c === '\\' && (s[i + 1] === '[' || s[i + 1] === '(') && !isEscaped(s, i)) {
        const display = s[i + 1] === '[';
        const j = findClose(s, display ? '\\]' : '\\)', i + 2);
        if (j > i + 2) {
          pushMath(s.slice(i + 2, j), display);
          i = j + 2;
          continue;
        }
      }
      if (c === '\\' && s.startsWith('\\begin{', i)) {
        const m = /^\\begin\{([A-Za-z]+\*?)\}/.exec(s.slice(i));
        if (m && MATH_ENVS.includes(m[1])) {
          const endTag = '\\end{' + m[1] + '}';
          const j = s.indexOf(endTag, i + m[0].length);
          if (j > 0) {
            pushMath(s.slice(i, j + endTag.length), true);
            i = j + endTag.length;
            continue;
          }
        }
      }
      if (c === '$') {
        // Inline $…$: no space right after the opening $, none right before the
        // closing $, closing $ not followed by a digit, and no blank line inside.
        // This keeps "costs $5 and $10" from turning into math.
        const next = s[i + 1];
        if (next && !/\s/.test(next)) {
          let j = i + 1;
          let found = -1;
          while ((j = s.indexOf('$', j)) >= 0) {
            if (isEscaped(s, j)) {
              j++;
              continue;
            }
            const between = s.slice(i + 1, j);
            if (/\n\s*\n/.test(between)) break;
            if (!/\s/.test(s[j - 1]) && !/[0-9]/.test(s[j + 1] || '') && s[j + 1] !== '$') {
              found = j;
              break;
            }
            j++;
          }
          if (found > i + 1) {
            pushMath(s.slice(i + 1, found), false);
            i = found + 1;
            continue;
          }
        }
        out += '\\$'; // literal dollar for Markdown
        i++;
        continue;
      }
      if (c === '!' && s[i + 1] === '[') {
        const m = /^!\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|([^)\n]+?))\s*(?:"([^"\n]*)")?\s*\)/.exec(s.slice(i));
        if (m) {
          images.push({ alt: m[1].trim(), ref: (m[2] || m[3] || '').trim(), title: m[4] || '' });
          out += IMG_OPEN + (images.length - 1) + IMG_CLOSE;
          i += m[0].length;
          continue;
        }
      }
      out += c;
      i++;
    }
    out = out.replace(new RegExp(CODE_OPEN + '(\\d+)' + CODE_CLOSE, 'g'), (_, n) => codes[+n]);
    return { text: out, math, images };
  }

  // ---------- browser-only rendering ----------

  function katexOptions(display, throwOnError) {
    return {
      displayMode: display,
      throwOnError,
      strict: 'ignore',
      trust: false,
      output: 'htmlAndMathml',
    };
  }

  function renderMath(m) {
    try {
      return root.katex.renderToString(m.tex, katexOptions(m.display, false));
    } catch (e) {
      return '<span class="math-error" title="' + escapeHTML(e.message) + '">' + escapeHTML(m.tex) + '</span>';
    }
  }

  function renderImage(img, resolve) {
    const r = resolve ? resolve(img.ref) : { src: /^(https?:|data:image\/)/i.test(img.ref) ? img.ref : null };
    const alt = img.alt || img.ref;
    if (r && r.src) {
      return (
        '<img class="card-img" src="' + escapeHTML(r.src) + '" alt="' + escapeHTML(alt) + '"' +
        (img.title ? ' title="' + escapeHTML(img.title) + '"' : '') + ' loading="lazy" data-zoom>'
      );
    }
    const note = r && r.note ? r.note : 'Image not added yet';
    return (
      '<span class="img-missing" data-ref="' + escapeHTML(img.ref) + '">' +
      (root.FC && root.FC.icon ? root.FC.icon('image') : '') +
      '<span><strong>' + escapeHTML(note) + ':</strong> <code>' + escapeHTML(img.ref) + '</code>' +
      (img.alt ? '<br><em>' + escapeHTML(img.alt) + '</em>' : '') + '</span></span>'
    );
  }

  let purifyHooked = false;
  function sanitize(html) {
    const DOMPurify = root.DOMPurify;
    if (!purifyHooked) {
      DOMPurify.addHook('afterSanitizeAttributes', (node) => {
        if (node.tagName === 'A' && node.getAttribute('href')) {
          node.setAttribute('target', '_blank');
          node.setAttribute('rel', 'noopener noreferrer');
        }
      });
      purifyHooked = true;
    }
    return DOMPurify.sanitize(html, { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'form', 'input', 'button'] });
  }

  /**
   * Render card text to safe HTML.
   * @param {string} src card text
   * @param {(ref: string) => {src?: string, note?: string}} [resolveImage]
   */
  function renderHTML(src, resolveImage) {
    const ex = extract(src);
    let html = root.marked.parse(ex.text, { gfm: true, breaks: true, async: false });
    html = sanitize(html);
    // Display math is a block: drop the line breaks around it so it doesn't get extra blank lines.
    html = html.replace(
      new RegExp('(<br\\s*/?>\\s*)?' + MATH_OPEN + '(\\d+)' + MATH_CLOSE + '(\\s*<br\\s*/?>)?', 'g'),
      (m, before, n, after) => {
        const math = ex.math[+n];
        return math.display ? renderMath(math) : (before || '') + renderMath(math) + (after || '');
      }
    );
    html = html.replace(new RegExp(IMG_OPEN + '(\\d+)' + IMG_CLOSE, 'g'), (_, n) =>
      renderImage(ex.images[+n], resolveImage)
    );
    return html;
  }

  /** Problems worth showing before import: LaTeX errors and missing images. */
  function check(src, resolveImage) {
    const ex = extract(src);
    const problems = [];
    for (const m of ex.math) {
      try {
        root.katex.renderToString(m.tex, katexOptions(m.display, true));
      } catch (e) {
        problems.push({ type: 'latex', message: String(e.message || e).replace(/^KaTeX parse error:\s*/, ''), tex: m.tex });
      }
    }
    for (const img of ex.images) {
      const r = resolveImage ? resolveImage(img.ref) : null;
      if (!r || !r.src) problems.push({ type: 'image', ref: img.ref, pending: !!(r && r.pending) });
    }
    return problems;
  }

  function imageRefs(src) {
    return extract(src).images.map((i) => i.ref);
  }

  return { extract, renderHTML, check, imageRefs, escapeHTML };
});
