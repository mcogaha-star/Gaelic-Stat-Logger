const db = globalThis.__B44_DB__ || {
  auth: { isAuthenticated: async () => false, me: async () => null },
  entities: new Proxy({}, { get: () => ({ filter: async () => [], get: async () => null, create: async () => ({}), update: async () => ({}), delete: async () => ({}) }) }),
  integrations: { Core: { UploadFile: async () => ({ file_url: '' }) } }
};

import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { createPageUrl } from '@/utils';
import { DEFAULT_DEFAULTS } from '@/components/statDefaults';

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

import { ArrowLeft, Save } from 'lucide-react';
import { clearConsent } from '@/components/ConsentGate';
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient';

export default function Settings() {
  const queryClient = useQueryClient();
  const [revokeOpen, setRevokeOpen] = useState(false);

  const { data: settingsRecords = [] } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => db.entities.AppSettings.list()
  });

  const settingsRecord = settingsRecords[0];
  const [defaults, setDefaults] = useState(DEFAULT_DEFAULTS);

  useEffect(() => {
    if (!settingsRecord) return;
    if (!settingsRecord.defaults_config) return;
    try {
      const parsed = JSON.parse(settingsRecord.defaults_config);
      const d = (parsed && typeof parsed === 'object') ? parsed : {};
      setDefaults({ ...DEFAULT_DEFAULTS, ...d });
    } catch {
      setDefaults(DEFAULT_DEFAULTS);
    }
  }, [settingsRecord?.id]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const data = { defaults_config: JSON.stringify(defaults) };
      if (settingsRecord?.id) return await db.entities.AppSettings.update(settingsRecord.id, data);
      return await db.entities.AppSettings.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['app-settings'] });
      toast.success('Settings saved');
    },
    onError: (e) => toast.error(e?.message || 'Failed to save settings'),
  });

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to={createPageUrl('Home')}>
              <Button variant="outline" size="icon" aria-label="Back">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
          </div>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            <Save className="w-4 h-4 mr-2" />
            {saveMutation.isPending ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <Tabs defaultValue="general" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="privacy">Privacy</TabsTrigger>
          </TabsList>

          <TabsContent value="general">
            <div className="bg-white border rounded-xl p-6 space-y-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label>Quick Log</Label>
                  <p className="text-xs text-slate-500 mt-1">
                    When enabled, the player picker defaults to the most recent receiver.
                  </p>
                </div>
                <Switch
                  checked={defaults.quick_log_enabled !== false}
                  onCheckedChange={(v) => setDefaults({ ...defaults, quick_log_enabled: !!v })}
                />
              </div>

              <div className="text-sm text-slate-600">
                <div className="flex items-center justify-between">
                  <span>Schema Version</span>
                  <span className="font-mono text-slate-900">{settingsRecord?.schema_version ?? 'Unknown'}</span>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="privacy">
            <div className="bg-white border rounded-xl p-6 space-y-4">
              <p className="text-sm text-slate-600">
                You can review privacy details and revoke consent. Revoking consent stops further uploads.
              </p>
              <div className="flex gap-2">
                <Link to={createPageUrl('Privacy')}>
                  <Button variant="outline">View Privacy Details</Button>
                </Link>
                <Button variant="destructive" onClick={() => setRevokeOpen(true)}>
                  Revoke Consent
                </Button>
              </div>
            </div>

            <AlertDialog open={revokeOpen} onOpenChange={(open) => setRevokeOpen(open)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Revoke consent?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will stop any further uploads from this device and sign you out. Existing server data is not deleted automatically.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel onClick={() => setRevokeOpen(false)}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-red-600 hover:bg-red-700"
                    onClick={async () => {
                      try {
                        clearConsent();
                        if (isSupabaseConfigured && supabase) {
                          const { data } = await supabase.auth.getUser();
                          const user = data?.user;
                          if (user) {
                            await supabase.from('user_consents').upsert({
                              user_id: user.id,
                              consent_version: '2026-03-13',
                              revoked_at: new Date().toISOString(),
                              updated_at: new Date().toISOString(),
                            });
                          }
                          await supabase.auth.signOut();
                        }
                        toast.success('Consent revoked');
                        window.location.reload();
                      } catch (e) {
                        toast.error(e?.message || 'Failed to revoke');
                      }
                    }}
                  >
                    Revoke
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

