const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeKey, makeResolver } = require('../js/images.js');

test('normalizeKey: case, folders, URL encoding and PDF page variants', () => {
  assert.equal(normalizeKey('Images/Slide%201.PNG'), 'slide 1.png');
  assert.equal(normalizeKey('./Lecture 3.pdf#page=07'), 'lecture 3.pdf#page=7');
  assert.equal(normalizeKey('lecture3.pdf#12'), 'lecture3.pdf#page=12');
  assert.equal(normalizeKey('lecture3.pdf # p.12'), 'lecture3.pdf#page=12');
});

test('resolver: exact, extension-insensitive, single-PDF fallback, external, missing', () => {
  const list = [
    { key: 'diagram.png', name: 'diagram.png', url: 'blob:1' },
    { key: 'lec.pdf#page=1', name: 'lec.pdf#page=1', url: 'blob:p1', pdf: 'lec.pdf' },
    { key: 'lec.pdf#page=2', name: 'lec.pdf#page=2', url: 'blob:p2', pdf: 'lec.pdf' },
  ];
  const r = makeResolver(list);
  assert.equal(r('Diagram.PNG').src, 'blob:1');
  assert.equal(r('figures/diagram.jpg').src, 'blob:1');
  assert.equal(r('lec.pdf#page=2').src, 'blob:p2');
  assert.equal(r('renamed.pdf#page=1').src, 'blob:p1');
  assert.match(r('renamed.pdf#page=9').note, /no page 9/);
  assert.equal(r('https://x.org/a.png').src, 'https://x.org/a.png');
  assert.equal(r('nope.png').src, undefined);
});

test('resolver: PDFs still being rendered are reported as pending', () => {
  const r = makeResolver([], { pendingPdfs: ['Slides.pdf'] });
  const res = r('slides.pdf#page=3');
  assert.equal(res.pending, true);
  assert.match(res.note, /Page 3/);
});
