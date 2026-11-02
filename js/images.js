/*
 * Image handling: matching image references in cards to images stored with
 * a deck, importing image files, and turning PDF pages into images.
 *
 * A card refers to an image by name:
 *   ![diagram](slide-12.png)            an image file added to the deck
 *   ![diagram](lecture3.pdf#page=12)    page 12 of a PDF added to the deck
 *   ![diagram](https://…/figure.png)    a web image
 *
 * Matching is forgiving: case-insensitive, folders are ignored
 * ("images/a.png" → "a.png"), a different extension still matches
 * ("a.jpg" → "a.png") and if the deck has a single PDF, "x.pdf#page=3"
 * finds page 3 of it even if the PDF was renamed.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.FC = root.FC || {}).images = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const PDF_REF = /^(.*?\.pdf)\s*#\s*(?:page\s*=\s*|p\.?\s*)?(\d+)\s*$/i;

  function safeDecode(s) {
    try {
      return decodeURIComponent(s);
    } catch (e) {
      return s;
    }
  }

  /** Canonical lookup key for an image name or reference. */
  function normalizeKey(ref) {
    let s = safeDecode(String(ref || '').trim()).replace(/^<|>$/g, '').replace(/\\/g, '/');
    const pdf = PDF_REF.exec(s);
    let suffix = '';
    if (pdf) {
      s = pdf[1];
      suffix = '#page=' + parseInt(pdf[2], 10);
    }
    s = s.replace(/^\.\//, '');
    s = s.slice(s.lastIndexOf('/') + 1);
    return (s.trim().replace(/\s+/g, ' ') + suffix).toLowerCase();
  }

  function stem(key) {
    if (key.includes('#page=')) return key;
    return key.replace(/\.[a-z0-9]{2,5}$/, '');
  }

  function isExternal(ref) {
    return /^(https?:\/\/|data:image\/|blob:)/i.test(String(ref).trim());
  }

  /**
   * Build a resolver for a set of images.
   * @param {Array<{key: string, url: string, name: string, pdf?: string}>} list
   * @param {{pendingPdfs?: string[]}} [opts] names of PDFs that will be rendered on import
   * @returns {(ref: string) => {src?: string, note?: string, pending?: boolean}}
   */
  function makeResolver(list, opts) {
    opts = opts || {};
    const byKey = new Map();
    const byStem = new Map();
    const pdfs = new Set();
    for (const img of list) {
      byKey.set(img.key, img);
      const st = stem(img.key);
      byStem.set(st, byStem.has(st) ? null : img); // null = ambiguous
      if (img.pdf) pdfs.add(normalizeKey(img.pdf));
    }
    const pending = (opts.pendingPdfs || []).map(normalizeKey);

    return function resolve(ref) {
      if (isExternal(ref)) return { src: String(ref).trim() };
      const key = normalizeKey(ref);
      let hit = byKey.get(key) || byStem.get(stem(key));
      const pdfMatch = /^(.*\.pdf)#page=(\d+)$/.exec(key);
      if (!hit && pdfMatch) {
        const [, pdfName, page] = pdfMatch;
        if (pending.includes(pdfName) || (pending.length === 1 && !pdfs.size)) {
          return { pending: true, note: `Page ${page} of ${pending.includes(pdfName) ? pdfName : pending[0]} — added on import` };
        }
        if (pdfs.size === 1) {
          const only = [...pdfs][0];
          hit = byKey.get(only + '#page=' + page);
          if (!hit) return { note: `${only} has no page ${page}` };
        }
      }
      if (hit) return { src: hit.url, name: hit.name };
      return { note: 'Image not added yet' };
    };
  }

  // ---------- browser-only: reading files ----------

  function readImageSize(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        resolve({ width: 0, height: 0 });
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve) => {
      canvas.toBlob(
        (webp) => {
          if (webp && webp.type === 'image/webp') return resolve(webp);
          canvas.toBlob((jpg) => resolve(jpg), 'image/jpeg', 0.9);
        },
        'image/webp',
        0.9
      );
    });
  }

  let pdfjsPromise = null;
  function loadPdfJs() {
    if (!pdfjsPromise) {
      const base = new URL('vendor/pdfjs/', root.document.baseURI).href;
      pdfjsPromise = import(base + 'pdf.min.mjs').then((lib) => {
        lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
        return lib;
      });
      pdfjsPromise.catch(() => {
        pdfjsPromise = null;
      });
    }
    return pdfjsPromise;
  }

  /**
   * Render every page of a PDF to an image.
   * @param {File} file
   * @param {(done: number, total: number) => void} [onProgress]
   * @returns {Promise<Array<{name, key, blob, width, height, pdf, page}>>}
   */
  async function pdfToImages(file, onProgress) {
    let lib;
    try {
      lib = await loadPdfJs();
    } catch (e) {
      const err = new Error(
        location.protocol === 'file:'
          ? 'PDF import needs the app to be opened from a web address (e.g. GitHub Pages or a local server), not directly from a file. Image files still work.'
          : 'Could not load the PDF reader: ' + e.message
      );
      err.cause = e;
      throw err;
    }
    const data = new Uint8Array(await file.arrayBuffer());
    const task = lib.getDocument({ data });
    const doc = await task.promise;
    const out = [];
    const pdfName = file.name;
    try {
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const base = page.getViewport({ scale: 1 });
        // Aim for ~1600px wide images: sharp enough to zoom into, small enough to store.
        const scale = Math.min(3, Math.max(1, 1600 / base.width));
        const viewport = page.getViewport({ scale });
        const canvas = root.document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        await page.render({ canvas, viewport }).promise;
        const blob = await canvasToBlob(canvas);
        const name = `${pdfName}#page=${p}`;
        out.push({ name, key: normalizeKey(name), blob, width: canvas.width, height: canvas.height, pdf: pdfName, page: p });
        page.cleanup();
        canvas.width = canvas.height = 0;
        if (onProgress) onProgress(p, doc.numPages);
      }
    } finally {
      task.destroy();
    }
    return out;
  }

  async function fileToImage(file) {
    const size = await readImageSize(file);
    return { name: file.name, key: normalizeKey(file.name), blob: file, width: size.width, height: size.height };
  }

  function isPdf(file) {
    return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  }

  function isImage(file) {
    return /^image\//.test(file.type) || /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(file.name);
  }

  /**
   * Turn dropped/selected files into image records.
   * @param {File[]} files
   * @param {(msg: string) => void} [onProgress]
   */
  async function filesToImages(files, onProgress) {
    const out = [];
    const skipped = [];
    for (const f of files) {
      if (isPdf(f)) {
        const pages = await pdfToImages(f, (d, t) => onProgress && onProgress(`Rendering ${f.name}: page ${d} of ${t}`));
        out.push(...pages);
      } else if (isImage(f)) {
        out.push(await fileToImage(f));
      } else {
        skipped.push(f.name);
      }
    }
    return { images: out, skipped };
  }

  return { normalizeKey, makeResolver, isExternal, filesToImages, pdfToImages, isPdf, isImage, loadPdfJs, PDF_REF };
});
