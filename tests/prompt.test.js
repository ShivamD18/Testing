const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PROMPT } = require('../js/prompt.js');
const { parse } = require('../js/parser.js');

test('CLAUDE_PROMPT.md contains exactly the prompt used in the app', () => {
  const md = fs.readFileSync(path.join(__dirname, '..', 'CLAUDE_PROMPT.md'), 'utf8');
  const m = /<!-- prompt:start -->\n`{5}text\n([\s\S]*?)\n`{5}\n<!-- prompt:end -->/.exec(md);
  assert.ok(m, 'prompt markers not found');
  assert.equal(m[1], PROMPT);
});

test('the example in the prompt parses into the expected cards', () => {
  const example = /````text\n([\s\S]*?)\n````/.exec(PROMPT)[1];
  const r = parse(example);
  assert.equal(r.name, 'Example – Calculus Review');
  assert.equal(r.cards.length, 3);
  assert.deepEqual(r.warnings, []);
  assert.match(r.cards[2].front, /!\[.*\]\(lecture2\.pdf#page=7\)/);
});
