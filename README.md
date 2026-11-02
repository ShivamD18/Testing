# Flashcards

A study app for flashcards with **LaTeX formulas** and **pictures**, built to work with Claude:

1. Give Claude your lecture notes or slides together with [the prompt](CLAUDE_PROMPT.md).
2. Paste Claude's output into the app.
3. Study with spaced repetition (or cram with practice mode).

It is a static web page with no server, account or build step. Your decks are stored in your browser (IndexedDB).

## Running it

| How | Notes |
|---|---|
| **GitHub Pages** (recommended) | In the repo's *Settings → Pages*, choose *Deploy from a branch*, then pick the branch and `/ (root)`. You get a URL you can open on your laptop and phone. |
| **Local server** | `python3 -m http.server 8000` in this folder, then open http://localhost:8000. |
| **Open `index.html` directly** | Everything works except turning PDFs into images (browsers block the PDF reader on `file://` pages). |

Decks are saved per browser. To move them to another device, use **Download backup** on the home page, then **Restore backup** on the other device.

## The flashcard format

The recommended format is **Q:/A: blocks**. This is what the Claude prompt asks for:

```text
# Lecture 5 – Fourier Series

Q: What is the Fourier series of a $2\pi$-periodic function $f$?
A: $$f(x) = \frac{a_0}{2} + \sum_{n=1}^{\infty} \left(a_n \cos nx + b_n \sin nx\right)$$

Q: Which wave is shown here, and which harmonics does it contain?
![Square wave plot](lecture5.pdf#page=7)
A: A **square wave**. It contains only the odd harmonics.
```

- `# Name` on the first line becomes the deck name.
- A card is a `Q:` line followed by an `A:` line. Both sides can span several lines, including blank lines; a card ends where the next `Q:` begins.
- **Markdown** works: bold, italics, lists, tables, code blocks.
- **Math** uses KaTeX: `$…$` inline, `$$…$$` or `\[…\]` for display, `\(…\)` inline. Environments such as `align`, `pmatrix` and `cases` work, and so does `\ce{…}` for chemistry. Write a literal dollar sign as `\$`. Currency such as "$5 and $10" is left alone.
- **Images**: `![description](name)`, where *name* is one of:
  - `slides.pdf#page=4`: page 4 of a PDF you add to the deck. The app renders every page of the PDF to an image.
  - `diagram.png`: an image file you add to the deck.
  - `https://…`: an image on the web.

  Matching is forgiving: case and folders are ignored, `a.jpg` finds `a.png`, and if the deck has only one PDF, page references work even if the PDF was renamed.

The importer also reads these formats (auto-detected):

| Format | Example |
|---|---|
| CSV | `"What is $f(x,y)$?","A function of two variables"`. Quote any text that contains commas. |
| Tab-separated | `question<TAB>answer`, one card per line (Anki/Quizlet export style). |
| Custom separator | e.g. `question ;; answer`, choosing the separator in the import screen. |
| JSON | `[{"front": "…", "back": "…"}]` or `{"name": "…", "cards": [...]}` |

## Features

- **Import preview**: shows each card rendered as you paste, with LaTeX errors and missing images flagged before you create the deck.
- **PDF → images**: drop the lecture PDF once, and cards can show any page. Click an image to zoom in.
- **Spaced repetition** (simplified SM‑2, like Anki): Again / Hard / Good / Easy, with the next interval shown on each button and a daily limit for new cards (20 by default, set per deck).
- **Practice mode**: goes through every card, shuffled, without changing your schedule. Useful the night before an exam.
- **Editing**: browse, search and filter cards (due, new, often forgotten), and edit them with a live preview. Paste a screenshot into the editor to add it as an image. While studying, press `E` to fix the current card.
- **Add cards** to an existing deck. Exact duplicates are skipped.
- **Export**: copy or download a deck in Q:/A: format, or download a full backup that includes images and progress.
- Light and dark themes, and layouts for phone and desktop.

### Keyboard shortcuts (study)

| Key | Action |
|---|---|
| `Space` / `Enter` | Show answer, then **Good** |
| `1` `2` `3` `4` | Again / Hard / Good / Easy |
| `U` | Undo last answer |
| `E` | Edit current card |
| `Esc` | End session |

## Development

There is no build step. The libraries are vendored in `vendor/`: KaTeX 0.18.11, marked 18.0.14, DOMPurify 3.4.16 and pdf.js 6.4.299.

```
index.html        app shell
css/styles.css    styles (light/dark tokens at the top)
js/parser.js      paste formats → cards
js/render.js      Markdown + LaTeX + image rendering
js/images.js      image matching, PDF → page images
js/srs.js         spaced-repetition scheduling
js/db.js          IndexedDB storage
js/prompt.js      the Claude prompt (kept in sync with CLAUDE_PROMPT.md)
js/app.js         views and routing
```

```sh
npm test            # unit tests (Node 18+, no dependencies)
npm run test:e2e    # browser test with Playwright + Chromium
```
