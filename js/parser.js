/*
 * Flashcard text parser.
 *
 * Turns pasted text into { name, format, cards: [{front, back}], warnings }.
 * Supported formats (auto-detected unless one is forced):
 *   - "qa"     Q:/A: blocks (recommended; multi-line, LaTeX- and comma-safe)
 *   - "csv"    front,back  (RFC 4180 quoting: wrap fields containing commas in "...")
 *   - "tsv"    front<TAB>back, one card per line
 *   - "custom" front<delimiter>back, one card per line (delimiter chosen by user)
 *   - "json"   [{"front": "...", "back": "..."}] or {"name": "...", "cards": [...]}
 *
 * Works in the browser (window.FC.parser) and in Node (module.exports) for tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.FC = root.FC || {}).parser = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Label sets for Q/A blocks. The first label found in the text "locks" the set,
  // so a stray "Answer:" line inside a Q:/A: deck is treated as normal text.
  const LABEL_SETS = [
    { q: 'Q', a: 'A' },
    { q: 'Question', a: 'Answer' },
    { q: 'Front', a: 'Back' },
  ];

  // Matches e.g. "Q: text", "Q1: text", "**Q:** text", "  question : text".
  function labelRegex(word) {
    return new RegExp('^\\s*(?:\\*\\*|__)?' + word + '\\s*\\d*\\s*(?:\\*\\*|__)?\\s*:(?:\\*\\*|__)?[ \\t]?', 'i');
  }
  const LABEL_RES = LABEL_SETS.map((s) => ({ q: labelRegex(s.q), a: labelRegex(s.a) }));

  function normalizeNewlines(text) {
    return String(text || '').replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
  }

  // If the whole input is wrapped in a single ``` / ~~~ fence (copied straight
  // out of a chat code block), remove the fence.
  function stripOuterFence(text) {
    const t = text.trim();
    const open = /^(`{3,}|~{3,})[^\n`]*\n/.exec(t);
    if (!open) return text;
    const fence = open[1];
    const closeRe = new RegExp('\\n' + fence[0] + '{' + fence.length + ',}\\s*$');
    const close = closeRe.exec(t);
    if (!close) return text;
    return t.slice(open[0].length, close.index);
  }

  function trimBlock(s) {
    // Drop leading/trailing blank lines and a trailing "---" separator line; keep inner indentation.
    const lines = s.split('\n');
    while (lines.length && /^\s*$/.test(lines[0])) lines.shift();
    while (lines.length && /^\s*(-{3,}|\*{3,}|_{3,})?\s*$/.test(lines[lines.length - 1])) lines.pop();
    return lines.map((l) => l.replace(/\s+$/, '')).join('\n');
  }

  function detectFormat(text) {
    const t = stripOuterFence(normalizeNewlines(text)).trim();
    if (!t) return 'qa';
    if (/^[[{]/.test(t)) {
      try {
        JSON.parse(t);
        return 'json';
      } catch (e) {
        /* not JSON */
      }
    }
    const lines = t.split('\n');
    for (const re of LABEL_RES) {
      if (lines.some((l) => re.q.test(l)) && lines.some((l) => re.a.test(l))) return 'qa';
    }
    const nonEmpty = lines.filter((l) => l.trim());
    const withTabs = nonEmpty.filter((l) => l.includes('\t')).length;
    if (withTabs > 0 && withTabs >= nonEmpty.length / 2) return 'tsv';
    return 'csv';
  }

  // ---------- Q:/A: blocks ----------
  function parseQA(text) {
    const lines = text.split('\n');
    const warnings = [];
    const cards = [];
    let name = '';

    // Pick the label set used by the first question line.
    let set = null;
    for (const l of lines) {
      set = LABEL_RES.find((re) => re.q.test(l));
      if (set) break;
    }
    if (!set) return { name, cards, warnings: ['No lines starting with "Q:" were found.'] };

    let cur = null; // { front: [], back: [], side: 'front'|'back', line }
    const preamble = [];

    function finish() {
      if (!cur) return;
      const front = trimBlock(cur.front.join('\n'));
      const back = trimBlock(cur.back.join('\n'));
      if (!cur.sawA) {
        warnings.push(`Line ${cur.line}: card has no "A:" line — skipped.`);
      } else if (!front) {
        warnings.push(`Line ${cur.line}: card has an empty question — skipped.`);
      } else {
        if (!back) warnings.push(`Line ${cur.line}: card has an empty answer.`);
        cards.push({ front, back });
      }
      cur = null;
    }

    lines.forEach((line, i) => {
      const qm = set.q.exec(line);
      if (qm) {
        finish();
        cur = { front: [line.slice(qm[0].length)], back: [], sawA: false, line: i + 1 };
        return;
      }
      if (!cur) {
        preamble.push({ line, n: i + 1 });
        return;
      }
      const am = !cur.sawA && set.a.exec(line);
      if (am) {
        cur.sawA = true;
        cur.back.push(line.slice(am[0].length));
        return;
      }
      (cur.sawA ? cur.back : cur.front).push(line);
    });
    finish();

    for (const p of preamble) {
      const h = /^\s*#{1,6}\s+(.+?)\s*#*\s*$/.exec(p.line);
      if (h && !name) {
        name = h[1].replace(/^deck\s*:\s*/i, '').trim();
      } else if (p.line.trim() && !/^\s*(-{3,}|\*{3,})\s*$/.test(p.line)) {
        warnings.push(`Line ${p.n}: text before the first "Q:" was ignored.`);
      }
    }
    return { name, cards, warnings };
  }

  // ---------- CSV (RFC 4180, lenient) ----------
  function parseDelimitedRecords(text, delim) {
    const rows = [];
    let row = [];
    let field = '';
    let i = 0;
    let inQuotes = false;
    let fieldStart = true;
    let line = 1;
    let rowLine = 1;
    while (i < text.length) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        if (c === '\n') line++;
        field += c;
        i++;
        continue;
      }
      if (fieldStart && c === '"') {
        inQuotes = true;
        fieldStart = false;
        i++;
        continue;
      }
      if (text.startsWith(delim, i)) {
        row.push(field);
        field = '';
        fieldStart = true;
        i += delim.length;
        continue;
      }
      if (c === '\n') {
        row.push(field);
        rows.push({ fields: row, line: rowLine });
        row = [];
        field = '';
        fieldStart = true;
        line++;
        rowLine = line;
        i++;
        continue;
      }
      // Allow spaces before an opening quote:  front, "back, with comma"
      if (fieldStart && c === ' ') {
        let j = i;
        while (text[j] === ' ') j++;
        if (text[j] === '"') {
          i = j;
          continue;
        }
      }
      fieldStart = false;
      field += c;
      i++;
    }
    if (field !== '' || row.length) {
      row.push(field);
      rows.push({ fields: row, line: rowLine });
    }
    return rows;
  }

  const HEADER_NAMES = /^(front|back|question|answer|q|a|term|definition|prompt|response)$/i;

  function recordsToCards(rows, delimLabel) {
    const cards = [];
    const warnings = [];
    rows.forEach((r, idx) => {
      const fields = r.fields.map((f) => f.trim());
      if (fields.every((f) => !f)) return;
      if (idx === 0 && fields.length >= 2 && HEADER_NAMES.test(fields[0]) && HEADER_NAMES.test(fields[1])) return;
      if (fields.length < 2 || !fields[0]) {
        warnings.push(`Line ${r.line}: no ${delimLabel} separating question and answer — skipped.`);
        return;
      }
      let back = fields[1];
      if (fields.length > 2) {
        back = fields.slice(1).join(delimLabel === 'comma' ? ', ' : ' ');
        warnings.push(
          `Line ${r.line}: found ${fields.length} fields; extra fields were added to the answer. ` +
            (delimLabel === 'comma' ? 'Wrap text containing commas in "double quotes".' : '')
        );
      }
      cards.push({ front: fields[0], back });
    });
    return { cards, warnings };
  }

  function parseCSV(text) {
    const r = recordsToCards(parseDelimitedRecords(text, ','), 'comma');
    return { name: '', cards: r.cards, warnings: r.warnings };
  }

  // TSV / custom delimiter: one card per line, split on the first delimiter. No quoting.
  function parseLines(text, delim, label) {
    const cards = [];
    const warnings = [];
    text.split('\n').forEach((line, i) => {
      if (!line.trim()) return;
      const at = line.indexOf(delim);
      if (at < 0) {
        warnings.push(`Line ${i + 1}: no ${label} found — skipped.`);
        return;
      }
      let front = line.slice(0, at).trim();
      let back = line.slice(at + delim.length).trim();
      if (i === 0 && HEADER_NAMES.test(front) && HEADER_NAMES.test(back)) return;
      // Strip one level of surrounding quotes (common in spreadsheet exports).
      const unq = (s) => (/^"[\s\S]*"$/.test(s) && s.length > 1 ? s.slice(1, -1).replace(/""/g, '"') : s);
      front = unq(front);
      back = unq(back);
      if (!front) {
        warnings.push(`Line ${i + 1}: empty question — skipped.`);
        return;
      }
      cards.push({ front, back });
    });
    return { name: '', cards, warnings };
  }

  // ---------- JSON ----------
  function pick(obj, keys) {
    for (const k of Object.keys(obj)) {
      if (keys.includes(k.toLowerCase())) return obj[k];
    }
    return undefined;
  }

  function parseJSON(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { name: '', cards: [], warnings: ['Invalid JSON: ' + e.message] };
    }
    const warnings = [];
    let name = '';
    let list = data;
    if (data && !Array.isArray(data) && typeof data === 'object') {
      if (Array.isArray(data.decks)) {
        return {
          name: '',
          cards: [],
          warnings: ['This looks like a full backup file. Use "Restore backup" on the home screen instead.'],
        };
      }
      name = String(pick(data, ['name', 'title', 'deck']) || '');
      list = pick(data, ['cards', 'flashcards', 'items']);
    }
    if (!Array.isArray(list)) {
      return { name, cards: [], warnings: ['JSON must be an array of cards or an object with a "cards" array.'] };
    }
    const cards = [];
    list.forEach((item, i) => {
      let front;
      let back;
      if (Array.isArray(item)) {
        [front, back] = item;
      } else if (item && typeof item === 'object') {
        front = pick(item, ['front', 'question', 'q', 'term', 'prompt']);
        back = pick(item, ['back', 'answer', 'a', 'definition', 'response']);
      }
      if (typeof front !== 'string' || !front.trim()) {
        warnings.push(`Card ${i + 1}: missing question — skipped.`);
        return;
      }
      cards.push({ front: front.trim(), back: typeof back === 'string' ? back.trim() : String(back ?? '') });
    });
    return { name, cards, warnings };
  }

  /**
   * Parse pasted flashcard text.
   * @param {string} text
   * @param {{format?: 'auto'|'qa'|'csv'|'tsv'|'json'|'custom', delimiter?: string}} [opts]
   */
  function parse(text, opts) {
    opts = opts || {};
    const clean = stripOuterFence(normalizeNewlines(text));
    let format = opts.format && opts.format !== 'auto' ? opts.format : detectFormat(clean);
    let result;
    switch (format) {
      case 'json':
        result = parseJSON(clean.trim());
        break;
      case 'csv':
        result = parseCSV(clean);
        break;
      case 'tsv':
        result = parseLines(clean, '\t', 'tab');
        break;
      case 'custom': {
        const d = opts.delimiter || '';
        if (!d) {
          result = { name: '', cards: [], warnings: ['Enter a separator.'] };
        } else {
          result = parseLines(clean, d, `"${d}" separator`);
        }
        break;
      }
      default:
        format = 'qa';
        result = parseQA(clean);
    }
    return { format, name: result.name || '', cards: result.cards, warnings: result.warnings };
  }

  /** Serialize cards back into the Q:/A: block format. */
  function toQA(name, cards) {
    const out = [];
    if (name) out.push('# ' + name, '');
    for (const c of cards) {
      out.push('Q: ' + c.front, 'A: ' + c.back, '');
    }
    return out.join('\n');
  }

  return { parse, detectFormat, toQA, stripOuterFence, FORMATS: ['auto', 'qa', 'csv', 'tsv', 'json', 'custom'] };
});
