import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

// v0.4+ schema marker. This gate was intentionally changed to be non-blocking:
// users should never be forced into destructive wipes on load.
const SCHEMA_VERSION = 4;

const db = globalThis.__B44_DB__ || {
  entities: new Proxy({}, {
    get: () => ({
      list: async () => [],
      filter: async () => [],
      get: async () => null,
      create: async () => ({}),
      update: async () => ({}),
    }),
  }),
};

async function getSettingsRecord() {
  const list = await db.entities.AppSettings.list('-created_date');
  return (list && list[0]) ? list[0] : null;
}

async function upsertSettings(patch) {
  const current = await getSettingsRecord();
  if (current?.id) return await db.entities.AppSettings.update(current.id, patch);
  return await db.entities.AppSettings.create(patch);
}

export default function SchemaGate({ children }) {
  const location = useLocation();
  const path = location?.pathname || '/';
  const allowWithoutGate = path === '/Login' || path === '/Privacy';

  const [settings, setSettings] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rec = await getSettingsRecord();
        if (!alive) return;
        setSettings(rec);

        if (allowWithoutGate) return;
        const v = rec?.schema_version;
        const n = typeof v === 'number' ? v : (typeof v === 'string' ? Number(v) : NaN);
        const ok = Number.isFinite(n) && n >= SCHEMA_VERSION;
        if (ok) return;

        await upsertSettings({ schema_version: SCHEMA_VERSION });
        if (!alive) return;
        setSettings((prev) => ({ ...(prev || {}), schema_version: SCHEMA_VERSION }));
      } catch {
        // Ignore: do not block the app if settings can't be read/written.
      }
    })();
    return () => { alive = false; };
  }, [allowWithoutGate]);

  // Always allow app usage.
  return children;
}
