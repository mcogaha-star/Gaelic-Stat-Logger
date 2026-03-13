// Local/offline persistence layer for Base44 exports.
// Implements a small subset of the Base44 entity API using IndexedDB:
//   - list(orderBy?: string)
//   - filter(where: object)
//   - get(id: string)
//   - create(data: object)
//   - update(id: string, data: object)
//   - delete(id: string)

const DB_NAME = 'base44-local-db';
const DB_VERSION = 1;

const DEFAULT_STORES = ['Match', 'Team', 'Player', 'StatEntry', 'AppSettings'];

function nowIso() {
  return new Date().toISOString();
}

function genId() {
  // crypto.randomUUID is widely available in modern browsers.
  try {
    return globalThis.crypto?.randomUUID?.() ?? `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  } catch {
    return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

function sortByField(items, orderBy) {
  if (!orderBy) return items;
  const desc = orderBy.startsWith('-');
  const field = desc ? orderBy.slice(1) : orderBy;

  const sorted = [...items].sort((a, b) => {
    const av = a?.[field];
    const bv = b?.[field];

    // Put undefined/null last.
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;

    // Compare numbers, then strings/dates by string compare.
    if (typeof av === 'number' && typeof bv === 'number') return av - bv;
    return String(av).localeCompare(String(bv));
  });

  return desc ? sorted.reverse() : sorted;
}

function matchesWhere(rec, where) {
  if (!where || typeof where !== 'object') return true;
  return Object.entries(where).every(([k, v]) => rec?.[k] === v);
}

let openPromise = null;

function openDb() {
  if (openPromise) return openPromise;

  openPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('IndexedDB not available in this environment'));
      return;
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const storeName of DEFAULT_STORES) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: 'id' });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
  });

  return openPromise;
}

async function withStore(storeName, mode, fn) {
  const db = await openDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try {
      result = fn(store);
    } catch (e) {
      reject(e);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

async function getAll(storeName) {
  return await withStore(storeName, 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB getAll failed'));
    });
  });
}

function makeEntityApi(storeName) {
  return {
    async list(orderBy) {
      const items = await getAll(storeName);
      return sortByField(items, orderBy);
    },

    async filter(where) {
      const items = await getAll(storeName);
      return items.filter((rec) => matchesWhere(rec, where));
    },

    async get(id) {
      if (!id) return null;
      return await withStore(storeName, 'readonly', (store) => {
        return new Promise((resolve, reject) => {
          const req = store.get(id);
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed'));
        });
      });
    },

    async create(data) {
      const created_date = nowIso();
      const record = {
        ...(data ?? {}),
        id: data?.id ?? genId(),
        created_date,
        updated_date: created_date,
      };

      // Use put() (upsert) to avoid transaction aborts on rare ID collisions.
      await withStore(storeName, 'readwrite', (store) => store.put(record));

      return record;
    },

    async update(id, data) {
      if (!id) throw new Error('update(id, data) requires an id');

      const updated_date = nowIso();
      const record = await this.get(id);
      const next = {
        ...(record ?? { id, created_date: updated_date }),
        ...(data ?? {}),
        id,
        updated_date,
      };

      await withStore(storeName, 'readwrite', (store) => store.put(next));
      return next;
    },

    async delete(id) {
      if (!id) return { id };
      await withStore(storeName, 'readwrite', (store) => store.delete(id));
      return { id };
    },
  };
}

function safeJsonParse(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function makeLocalStorageEntityApi(storeName) {
  const key = `base44_store_${storeName}`;

  const readAll = () => {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage?.getItem(key);
    return safeJsonParse(raw, []) ?? [];
  };

  const writeAll = (items) => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem(key, JSON.stringify(items ?? []));
  };

  return {
    async list(orderBy) {
      return sortByField(readAll(), orderBy);
    },
    async filter(where) {
      return readAll().filter((rec) => matchesWhere(rec, where));
    },
    async get(id) {
      return readAll().find((r) => r?.id === id) ?? null;
    },
    async create(data) {
      const created_date = nowIso();
      const record = { ...(data ?? {}), id: data?.id ?? genId(), created_date, updated_date: created_date };
      const items = readAll();
      items.push(record);
      writeAll(items);
      return record;
    },
    async update(id, data) {
      const items = readAll();
      const idx = items.findIndex((r) => r?.id === id);
      const updated_date = nowIso();
      const next = { ...(items[idx] ?? { id, created_date: updated_date }), ...(data ?? {}), id, updated_date };
      if (idx >= 0) items[idx] = next;
      else items.push(next);
      writeAll(items);
      return next;
    },
    async delete(id) {
      writeAll(readAll().filter((r) => r?.id !== id));
      return { id };
    },
  };
}

function createLocalDb() {
  const entities = new Proxy(
    {},
    {
      get(_target, prop) {
        // Support symbol access without blowing up.
        if (typeof prop !== 'string') return undefined;

        if (DEFAULT_STORES.includes(prop)) return makeEntityApi(prop);

        // Resilient fallback for any unexpected entity access.
        return makeLocalStorageEntityApi(prop);
      },
    },
  );

  // Pre-warm known stores by touching them once (and ensuring DB upgrade creates them).
  for (const s of DEFAULT_STORES) {
    void entities[s];
  }

  const auth = {
    isAuthenticated: async () => false,
    me: async () => null,
    logout: async () => {},
    redirectToLogin: async () => {},
  };

  const integrations = {
    Core: {
      UploadFile: async () => ({ file_url: '' }),
    },
  };

  // Base44 scaffolds sometimes call this; keep it as a harmless no-op.
  const appLogs = {
    logUserInApp: async () => {},
  };

  return { auth, entities, integrations, appLogs };
}

// Initialize global DB once (so Base44-exported pages that do `globalThis.__B44_DB__ || stub` will pick it up).
if (!globalThis.__B44_DB__) {
  globalThis.__B44_DB__ = createLocalDb();
}
globalThis.__B44_IS_LOCAL__ = true;
