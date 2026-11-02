/*
 * End-to-end smoke test in a real browser (Playwright + Chromium).
 *   npm run test:e2e            (SCREENSHOTS=dir to save screenshots)
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = process.env.SCREENSHOTS || '';
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png',
};

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, url === '/' ? 'index.html' : url);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const DECK = String.raw`# E2E – Linear Algebra

Q: What is the determinant of $\begin{pmatrix} a & b \\ c & d \end{pmatrix}$?
A: $ad - bc$

Q: Which figure is on page 2?
![The page two figure](lecture.pdf#page=2)
A: The **eigenvector** diagram.

Q: State the spectral theorem.
A: Every real symmetric matrix $A$ can be written
$$A = Q \Lambda Q^{\mathsf T}$$
with $Q$ orthogonal.

Q: A card with broken LaTeX
A: $\frac{1}{$
`;

async function main() {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  page.on('dialog', (d) => d.accept());
  const shot = async (name, p = page) => SHOTS && p.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true });
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'fc-e2e-'));
  const steps = [];
  const step = (s) => {
    steps.push(s);
    console.log('✓', s);
  };

  try {
    // A 2-page PDF to import as slide images.
    const pdfPage = await context.newPage();
    await pdfPage.setContent(`<style>@page{size:800px 600px;margin:0}html,body{margin:0}div{overflow:hidden;height:600px;display:grid;place-items:center;font:48px sans-serif}</style>
      <div style="background:#fde">PAGE ONE</div><div style="background:#def;break-before:page">PAGE TWO FIGURE</div>`);
    const pdfPath = path.join(tmp, 'lecture.pdf');
    fs.writeFileSync(pdfPath, await pdfPage.pdf({ width: '800px', height: '600px', printBackground: true }));
    await pdfPage.close();

    // Home: empty state
    await page.goto(base);
    await page.getByRole('heading', { name: 'Make your first deck' }).waitFor();
    await shot('01-home-empty');
    step('home shows the empty state');

    // Prompt page copies the prompt
    await page.goto(base + '#/prompt');
    assert.match(await page.locator('#prompt-text').innerText(), /Q:.*\n.*A:/s);
    step('prompt page shows the Claude prompt');

    // Import
    await page.goto(base + '#/import');
    await page.locator('#src').fill(DECK);
    await page.waitForFunction(() => document.querySelectorAll('#preview .pv-card').length === 4);
    assert.equal(await page.locator('#deck-name').inputValue(), 'E2E – Linear Algebra');
    const summary = await page.locator('#summary').innerText();
    assert.match(summary, /4 cards found/);
    assert.match(summary, /1 LaTeX error/);
    assert.match(summary, /1 image not added yet/);
    assert.ok((await page.locator('#preview .katex').count()) >= 4, 'KaTeX rendered in preview');
    assert.equal(await page.locator('#preview .img-missing').count(), 1);
    step('import preview renders LaTeX and flags errors / missing images');

    await page.locator('#img-files').setInputFiles(pdfPath);
    await page.waitForFunction(() => document.querySelector('#preview img.card-img'), null, { timeout: 30000 });
    assert.match(await page.locator('#file-list').innerText(), /lecture\.pdf.*2 pages/s);
    assert.doesNotMatch(await page.locator('#summary').innerText(), /not added yet/);
    const natural = await page.locator('#preview img.card-img').evaluate((img) => img.decode().then(() => img.naturalWidth));
    assert.ok(natural >= 1000, 'PDF page rendered at high resolution: ' + natural);
    await shot('02-import-preview');
    step('PDF pages are rendered and resolve lecture.pdf#page=2');

    await page.getByRole('button', { name: /Create deck with 4 cards/ }).click();
    await page.waitForURL(/#\/deck\//);
    const deckUrl = page.url();
    const deckId = deckUrl.split('/').pop();
    await page.locator('.stats').waitFor();
    assert.match(await page.locator('.stats').innerText(), /4\s*new/);
    await shot('03-deck');
    step('deck created with 4 new cards');

    // Study: rate cards
    await page.getByRole('link', { name: /Study now/ }).click();
    await page.waitForURL(/#\/study\//);
    await page.locator('#front .katex').first().waitFor();
    await shot('04-study-front');
    await page.keyboard.press('Space');
    await page.locator('#back:not([hidden])').waitFor();
    assert.equal(await page.locator('.ratings .rate').count(), 4);
    assert.match(await page.locator('.ratings').innerText(), /Good\s*2d/);
    await shot('05-study-back');
    await page.keyboard.press('3'); // Good
    // Card 2 has the PDF image
    await page.locator('#front img.card-img').waitFor();
    await page.locator('#front img.card-img').click();
    await page.locator('.modal-lightbox img').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.modal-lightbox').waitFor({ state: 'detached' });
    assert.ok(page.url().includes('#/study/'), 'Escape closed only the lightbox');
    await page.locator('#card').click({ position: { x: 12, y: 12 } }); // tap card (not the image) to flip
    await page.getByRole('button', { name: /^Again/ }).click();
    await page.keyboard.press('Space');
    await page.keyboard.press('4'); // Easy
    // Undo the last answer and redo it
    await page.keyboard.press('u');
    await page.locator('#back:not([hidden])').waitFor();
    await page.keyboard.press('4');
    await page.keyboard.press('Space');
    await page.keyboard.press('3');
    // The "Again" card comes back
    await page.locator('#front img.card-img').waitFor();
    await page.keyboard.press('Space');
    await page.keyboard.press('3');
    await page.getByRole('heading', { name: 'Session complete' }).waitFor();
    await shot('06-study-done');
    step('study session: flip, rate, lightbox, again-requeue, undo, finish');

    await page.goto(deckUrl);
    await page.reload();
    await page.locator('.stats').waitFor();
    assert.match(await page.locator('.stats').innerText(), /0\s*due\s*0\s*new\s*4\s*learned/);
    step('progress persisted across reload');

    // Edit a card
    await page.goto(base + `#/deck/${deckId}/cards`);
    await page.locator('.card-row').first().waitFor();
    assert.equal(await page.locator('.card-row').count(), 4);
    await page.locator('.card-row').nth(3).getByRole('button', { name: 'Edit' }).click();
    await page.locator('#ed-back').fill('$\\frac{1}{2}$ fixed');
    await page.locator('#pv-back .katex').waitFor();
    await page.keyboard.press('Control+Enter');
    await page.locator('.modal').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.card-row .katex-error').count(), 0);
    await shot('07-cards');
    step('card editor saves with live LaTeX preview');

    // Images page
    await page.goto(base + `#/deck/${deckId}/images`);
    await page.locator('.img-tile').first().waitFor();
    assert.equal(await page.locator('.img-tile').count(), 2);
    assert.match(await page.locator('#groups').innerText(), /lecture\.pdf/);
    await shot('08-images');
    step('images page lists the PDF pages');

    // Practice mode
    await page.goto(base + `#/practice/${deckId}`);
    for (let i = 0; i < 4; i++) {
      await page.locator('#flip').waitFor();
      await page.keyboard.press('Space');
      await page.locator('.ratings-2').waitFor();
      await page.keyboard.press('Space');
    }
    await page.getByRole('heading', { name: 'Practice complete' }).waitFor();
    step('practice mode runs through all cards');

    // Add more cards to the same deck: duplicates are skipped
    await page.goto(base + `#/import/${deckId}`);
    await page.locator('#src').fill('Q: What is the determinant of $\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$?\nA: $ad - bc$\n\nQ: New one\nA: $x$');
    await page.waitForFunction(() => /1 card to add/.test(document.querySelector('#summary').innerText));
    assert.match(await page.locator('#summary').innerText(), /1 duplicate skipped/);
    await page.getByRole('button', { name: 'Add 1 card' }).click();
    await page.waitForURL(/#\/deck\//);
    assert.match(await page.locator('.stats').innerText(), /5\s*total/);
    step('adding cards to an existing deck skips duplicates');

    // Backup + restore round trip
    await page.goto(base);
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#backup-btn').click()]);
    const backupPath = path.join(tmp, 'backup.json');
    await download.saveAs(backupPath);
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    assert.equal(backup.decks.length, 1);
    assert.equal(backup.decks[0].images.length, 2);
    const page2 = await (await browser.newContext()).newPage();
    page2.on('dialog', (d) => d.accept());
    await page2.goto(base);
    await page2.locator('#restore-input').setInputFiles(backupPath);
    await page2.locator('.deck-card').waitFor();
    await page2.locator('.deck-link').click();
    assert.match(await page2.locator('.stats').innerText(), /5\s*total/);
    assert.doesNotMatch(await page2.locator('main').innerText(), /haven't been added|hasn't been added/);
    step('backup downloads and restores (cards, progress, images) in a fresh browser');

    // Sample deck with SVG image, mhchem and tables; phone-sized screenshots
    await page2.goto(base);
    await page2.locator('#sample-btn').click();
    await page2.waitForURL(/#\/deck\//);
    const sampleId = page2.url().split('/').pop();
    await page2.goto(base + `#/deck/${sampleId}/cards`);
    await page2.locator('.card-row img.card-img').waitFor();
    assert.equal(await page2.locator('.card-row .katex-error').count(), 0, 'sample deck has no LaTeX errors');
    assert.ok((await page2.locator('.card-row .cr-back table').count()) === 1, 'table renders');
    step('sample deck renders (SVG image, chemistry, table)');

    const phone = await (await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, colorScheme: 'dark' })).newPage();
    phone.on('pageerror', (e) => errors.push('phone pageerror: ' + e.message));
    await phone.goto(base);
    await phone.locator('#sample-btn').click();
    await phone.waitForURL(/#\/deck\//);
    await shot('09-phone-deck', phone);
    const pid = phone.url().split('/').pop();
    await phone.goto(base + `#/study/${pid}`);
    await phone.locator('#flip').waitFor();
    await phone.locator('#card').click({ position: { x: 12, y: 12 } });
    await phone.locator('.ratings').waitFor();
    await shot('10-phone-study', phone);
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflow, false, 'no horizontal scroll on phone');
    await phone.goto(base + '#/import');
    await phone.locator('#src').fill(DECK);
    await phone.waitForFunction(() => document.querySelectorAll('#preview .pv-card').length === 4);
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, 'import page fits phone');
    await shot('11-phone-import', phone);
    step('phone layout (dark mode) has no horizontal overflow');

    assert.deepEqual(errors, [], 'no console errors');
    step('no console errors');
    console.log(`\nAll ${steps.length} e2e checks passed.`);
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error('\nE2E FAILED:', e);
  process.exit(1);
});
