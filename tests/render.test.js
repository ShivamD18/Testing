const test = require('node:test');
const assert = require('node:assert/strict');
const { extract } = require('../js/render.js');

const P = (n) => '' + n + '';
const I = (n) => '' + n + '';

test('inline and display math are extracted', () => {
  const r = extract('Euler: $e^{i\\pi}+1=0$ and $$\\int_0^1 x\\,dx$$');
  assert.equal(r.text, `Euler: ${P(0)} and ${P(1)}`);
  assert.deepEqual(r.math, [
    { tex: 'e^{i\\pi}+1=0', display: false },
    { tex: '\\int_0^1 x\\,dx', display: true },
  ]);
});

test('\\( \\) and \\[ \\] delimiters and multi-line display math', () => {
  const r = extract('a \\(x_1\\) b\n\\[\n\\sum_{k=1}^n k\n\\]');
  assert.deepEqual(r.math, [
    { tex: 'x_1', display: false },
    { tex: '\\sum_{k=1}^n k', display: true },
  ]);
});

test('bare math environments become display math', () => {
  const r = extract('\\begin{align*} a &= b \\\\ c &= d \\end{align*}');
  assert.equal(r.math.length, 1);
  assert.equal(r.math[0].display, true);
  assert.match(r.math[0].tex, /^\\begin\{align\*\}.*\\end\{align\*\}$/s);
});

test('currency is not math; escaped dollars stay literal', () => {
  const r = extract('It costs $5 and $10, or \\$3.');
  assert.equal(r.math.length, 0);
  assert.equal(r.text, 'It costs \\$5 and \\$10, or \\$3.');
});

test('math inside code is left alone', () => {
  const r = extract('Use `$x$` in code\n```\n$$not math$$\n```\nbut $y$ is');
  assert.equal(r.math.length, 1);
  assert.equal(r.math[0].tex, 'y');
  assert.match(r.text, /`\$x\$`/);
  assert.match(r.text, /\$\$not math\$\$/);
});

test('underscores and pipes in math cannot break Markdown', () => {
  const r = extract('| a | $|x|_1$ |');
  assert.equal(r.text, `| a | ${P(0)} |`);
  assert.equal(r.math[0].tex, '|x|_1');
});

test('images: plain, with spaces, angle brackets, PDF pages and titles', () => {
  const r = extract('![Fig 1](my slides.pdf#page=3)\n![](<a b.png>) ![x](https://e.com/i.png "T")');
  assert.equal(r.text, `${I(0)}\n${I(1)} ${I(2)}`);
  assert.deepEqual(r.images, [
    { alt: 'Fig 1', ref: 'my slides.pdf#page=3', title: '' },
    { alt: '', ref: 'a b.png', title: '' },
    { alt: 'x', ref: 'https://e.com/i.png', title: 'T' },
  ]);
});

test('an unclosed $ is literal', () => {
  const r = extract('price: $ 4 and $x');
  assert.equal(r.math.length, 0);
});
