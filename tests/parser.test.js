const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, detectFormat, toQA } = require('../js/parser.js');

test('Q/A blocks: multi-line sides, LaTeX and deck name', () => {
  const text = [
    '# Lecture 3 – Eigenvalues',
    '',
    'Q: What is the characteristic polynomial of $A$?',
    'A: $$p(\\lambda) = \\det(A - \\lambda I)$$',
    'Its roots are the eigenvalues.',
    '',
    'Q: Which matrix is shown?',
    '![matrix](lec3.pdf#page=4)',
    'A: A rotation matrix,',
    'with $\\det = 1$.',
    '',
  ].join('\n');
  const r = parse(text);
  assert.equal(r.format, 'qa');
  assert.equal(r.name, 'Lecture 3 – Eigenvalues');
  assert.equal(r.cards.length, 2);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.cards[0].back, '$$p(\\lambda) = \\det(A - \\lambda I)$$\nIts roots are the eigenvalues.');
  assert.equal(r.cards[1].front, 'Which matrix is shown?\n![matrix](lec3.pdf#page=4)');
  assert.equal(r.cards[1].back, 'A rotation matrix,\nwith $\\det = 1$.');
});

test('Q/A: blank lines inside an answer are kept, commas are fine', () => {
  const r = parse('Q: f(x, y)?\nA: first paragraph\n\nsecond, paragraph\n\nQ: next\nA: yes');
  assert.equal(r.cards.length, 2);
  assert.equal(r.cards[0].front, 'f(x, y)?');
  assert.equal(r.cards[0].back, 'first paragraph\n\nsecond, paragraph');
});

test('Q/A: tolerates bold labels, numbering, CRLF, and code fences around everything', () => {
  const text = '````text\r\n**Q1:** One?\r\n**A1:** Uno\r\n\r\nq: Two?\r\na: Dos\r\n````';
  const r = parse(text);
  assert.equal(r.format, 'qa');
  assert.deepEqual(r.cards, [
    { front: 'One?', back: 'Uno' },
    { front: 'Two?', back: 'Dos' },
  ]);
});

test('Q/A: only the first A: switches sides; later "A:" lines stay in the answer', () => {
  const r = parse('Q: Options?\nA: The answer\nA: is still part of it');
  assert.equal(r.cards[0].back, 'The answer\nA: is still part of it');
});

test('Q/A: label set is locked by the first card', () => {
  const r = parse('Question: What?\nAnswer: This\nQ: not a new card\n');
  assert.equal(r.cards.length, 1);
  assert.equal(r.cards[0].back, 'This\nQ: not a new card');
});

test('Q/A: trailing --- separators are dropped and missing answers warn', () => {
  const r = parse('Q: one\nA: 1\n---\nQ: two\n\nQ: three\nA: 3');
  assert.equal(r.cards.length, 2);
  assert.equal(r.cards[0].back, '1');
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /Line 4: card has no "A:" line/);
});

test('Q/A: stray text before first card warns', () => {
  const r = parse('Here are your cards:\n\nQ: a\nA: b');
  assert.equal(r.cards.length, 1);
  assert.match(r.warnings[0], /before the first "Q:"/);
});

test('CSV with quotes, embedded commas, escaped quotes, newlines and a header', () => {
  const text = 'front,back\n"What is f(x,y)?","A function, of two variables"\nSay ""hi"",x\n"multi\nline", "spaced quote, ok"\n';
  const r = parse(text);
  assert.equal(r.format, 'csv');
  assert.deepEqual(r.cards, [
    { front: 'What is f(x,y)?', back: 'A function, of two variables' },
    { front: 'Say ""hi""', back: 'x' },
    { front: 'multi\nline', back: 'spaced quote, ok' },
  ]);
});

test('CSV: extra unquoted commas are joined into the answer with a warning', () => {
  const r = parse('Capital of France,Paris, the city of light');
  assert.equal(r.cards[0].back, 'Paris, the city of light');
  assert.match(r.warnings[0], /double quotes/);
});

test('TSV is detected; commas and LaTeX survive', () => {
  const r = parse('What is $f(a,b)$?\t$a+b$\nSecond\tTwo, really');
  assert.equal(r.format, 'tsv');
  assert.deepEqual(r.cards, [
    { front: 'What is $f(a,b)$?', back: '$a+b$' },
    { front: 'Second', back: 'Two, really' },
  ]);
});

test('custom separator splits on the first occurrence only', () => {
  const r = parse('a :: b :: c\nno sep here', { format: 'custom', delimiter: '::' });
  assert.deepEqual(r.cards, [{ front: 'a', back: 'b :: c' }]);
  assert.equal(r.warnings.length, 1);
});

test('JSON: arrays, objects with name, alternate keys', () => {
  assert.equal(detectFormat('[{"front":"a","back":"b"}]'), 'json');
  const r = parse('{"name":"Deck","cards":[{"Question":"q1","Answer":"a1"},["q2","a2"],{"x":1}]}');
  assert.equal(r.name, 'Deck');
  assert.deepEqual(r.cards, [
    { front: 'q1', back: 'a1' },
    { front: 'q2', back: 'a2' },
  ]);
  assert.equal(r.warnings.length, 1);
});

test('JSON backup files are pointed at Restore', () => {
  const r = parse('{"app":"flashcards","decks":[]}');
  assert.equal(r.cards.length, 0);
  assert.match(r.warnings[0], /Restore backup/);
});

test('toQA round-trips', () => {
  const cards = [
    { front: 'Line 1\nLine 2', back: '$$x^2$$\n\nmore' },
    { front: 'b', back: 'c' },
  ];
  const r = parse(toQA('My deck', cards));
  assert.equal(r.name, 'My deck');
  assert.deepEqual(r.cards, cards);
});
