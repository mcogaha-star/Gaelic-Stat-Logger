import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { softDeleteServerStat } from '@/lib/serverSync';

const SCHEMA_VERSION = 4;

const db = globalThis.__B44_DB__ || {
  auth: { isAuthenticated: async () => false, me: async () => null },
  entities: new Proxy({}, { get: () => ({ list: async () => [], filter: async () => [], get: async () => null, create: async () => ({}), update: async () => ({}), delete: async () => ({}) }) }),
  integrations: { Core: { UploadFile: async () => ({ file_url: '' }) } }
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
  const [isWiping, setIsWiping] = useState(false);

const schemaOk = useMemo(() => {
    const v = settings?.schema_version;
    // Base44 can sometimes round-trip numbers as strings.
    const n = typeof v === 'number' ? v : (typeof v === 'string' ? Number(v) : NaN);
    return Number.isFinite(n) && n >= SCHEMA_VERSION;
  }, [settings]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rec = await getSettingsRecord();
        if (!alive) return;
        setSettings(rec);
      } catch {
        if (!alive) return;
        setSettings(null);
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (schemaOk || allowWithoutGate) return;
        const all = await db.entities.StatEntry.list('-timestamp');
        if (!alive) return;
        if (!all || all.length === 0) {
          await upsertSettings({ schema_version: SCHEMA_VERSION });
          setSettings((prev) => ({ ...(prev || {}), schema_version: SCHEMA_VERSION }));
        }
      } catch {
        // Ignore: if we can't read stats, fall back to showing the gate.
      }
    })();
    return () => { alive = false; };
  }, [schemaOk, allowWithoutGate]);

  if (schemaOk || allowWithoutGate) return children;

  const wipe = async () => {
    setIsWiping(true);
    try {
      const all = await db.entities.StatEntry.list('-timestamp');

      // Best-effort server soft delete first (only for rows that were uploaded).
      for (const s of (all || [])) {
        if (!s?.server_stat_id) continue;
        try { await softDeleteServerStat(s.server_stat_id); } catch {}
      }

      // Delete locally.
      await Promise.all((all || []).map((s) => s?.id ? db.entities.StatEntry.delete(s.id) : Promise.resolve()));

      // Reset settings to v0.4 defaults and mark schema as upgraded.
      await upsertSettings({
        schema_version: SCHEMA_VERSION,
        click_stats_config: null,
        drag_stats_config: null,
        sub_menus_config: null,
      });

      setSettings({ ...(settings || {}), schema_version: SCHEMA_VERSION });
      toast.success('Upgraded to v0.4 schema (old stats wiped)');
    } catch (e) {
      toast.error(`Schema reset failed: ${e?.message || 'unknown error'}`);
    } finally {
      setIsWiping(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Update Required</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-slate-700">
            Gaelic Stats Logger has been upgraded to v0.4 with a new stats schema (play/possession IDs, team-aware actions).
            To avoid incorrect mappings, existing logged stats on this device must be deleted.
          </p>
          <p className="text-sm text-slate-600">
            This will delete local stats and will attempt to soft-delete any uploaded server stats linked to this device.
          </p>
          <Button
            className="w-full bg-red-600 hover:bg-red-700"
            onClick={wipe}
            disabled={isWiping}
          >
            {isWiping ? 'Wiping…' : 'Wipe Old Stats & Continue'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
