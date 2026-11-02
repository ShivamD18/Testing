/*
 * Storage: everything lives in this browser's IndexedDB (nothing is uploaded).
 *   decks  : { id, name, createdAt, updatedAt, newPerDay, newLog, cards: [...] }
 *   images : { id: deckId + '/' + key, deckId, key, name, blob, width, height, pdf?, page? }
 */
(function (root) {
  'use strict';
  const DB_NAME = 'flashcards';
  const DB_VERSION = 1;
  let dbPromise = null;

  function req(r) {
    return new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        if (!root.indexedDB) {
          reject(new Error('This browser does not support IndexedDB storage.'));
          return;
        }
        const r = root.indexedDB.open(DB_NAME, DB_VERSION);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('decks')) db.createObjectStore('decks', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('images')) {
            const s = db.createObjectStore('images', { keyPath: 'id' });
            s.createIndex('deckId', 'deckId');
          }
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.onblocked = () => reject(new Error('Storage is blocked by another open tab of this app.'));
      });
    }
    return dbPromise;
  }

  async function tx(stores, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let result;
      Promise.resolve(fn(t)).then((r) => {
        result = r;
      }, reject);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Transaction aborted'));
    });
  }

  const api = {
    async getDecks() {
      return tx(['decks'], 'readonly', (t) => req(t.objectStore('decks').getAll()));
    },
    async getDeck(id) {
      return tx(['decks'], 'readonly', (t) => req(t.objectStore('decks').get(id)));
    },
    async putDeck(deck) {
      deck.updatedAt = Date.now();
      return tx(['decks'], 'readwrite', (t) => req(t.objectStore('decks').put(deck)));
    },
    async deleteDeck(id) {
      return tx(['decks', 'images'], 'readwrite', async (t) => {
        t.objectStore('decks').delete(id);
        const keys = await req(t.objectStore('images').index('deckId').getAllKeys(id));
        for (const k of keys) t.objectStore('images').delete(k);
      });
    },
    async getImages(deckId) {
      return tx(['images'], 'readonly', (t) => req(t.objectStore('images').index('deckId').getAll(deckId)));
    },
    async putImages(deckId, images) {
      return tx(['images'], 'readwrite', (t) => {
        const s = t.objectStore('images');
        for (const img of images) {
          s.put({ ...img, deckId, id: deckId + '/' + img.key, addedAt: Date.now() });
        }
      });
    },
    async deleteImages(ids) {
      return tx(['images'], 'readwrite', (t) => {
        for (const id of ids) t.objectStore('images').delete(id);
      });
    },
    async requestPersistence() {
      try {
        if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
          await navigator.storage.persist();
        }
      } catch (e) {
        /* best effort */
      }
    },
    async estimate() {
      try {
        return navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
      } catch (e) {
        return null;
      }
    },
  };

  (root.FC = root.FC || {}).db = api;
})(self);
