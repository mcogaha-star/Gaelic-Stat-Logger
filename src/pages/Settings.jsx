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
import { DEFAULT_CUSTOM_FIELDS, DEFAULT_DEFAULTS } from '@/components/statDefaults';

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

import { ArrowLeft, Save } from 'lucide-react';
import { clearConsent } from '@/components/ConsentGate';
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient';
import { DEFAULT_SHORTCUTS, mergeShortcutConfig, normalizeShortcutText, prettyShortcut } from '@/lib/shortcuts';

export default function Settings() {
  const queryClient = useQueryClient();
  const [revokeOpen, setRevokeOpen] = useState(false);

  const { data: settingsRecords = [] } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => db.entities.AppSettings.list()
  });

  const settingsRecord = settingsRecords[0];
  const [defaults, setDefaults] = useState(DEFAULT_DEFAULTS);
  const [customFields, setCustomFields] = useState(DEFAULT_CUSTOM_FIELDS);
  const [shortcuts, setShortcuts] = useState(DEFAULT_SHORTCUTS);

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

  useEffect(() => {
    if (!settingsRecord) return;
    const raw = settingsRecord.keyboard_shortcuts_config;
    if (!raw) {
      setShortcuts(DEFAULT_SHORTCUTS);
      return;
    }
    try {
      setShortcuts(mergeShortcutConfig(JSON.parse(raw)));
    } catch {
      setShortcuts(DEFAULT_SHORTCUTS);
    }
  }, [settingsRecord?.id, settingsRecord?.keyboard_shortcuts_config]);

  useEffect(() => {
    if (!settingsRecord) return;
    if (!settingsRecord.custom_fields_config) {
      setCustomFields(DEFAULT_CUSTOM_FIELDS);
      return;
    }
    try {
      const parsed = JSON.parse(settingsRecord.custom_fields_config);
      const base = (parsed && typeof parsed === 'object') ? parsed : {};
      setCustomFields({
        ...DEFAULT_CUSTOM_FIELDS,
        ...base,
        custom_1: { ...DEFAULT_CUSTOM_FIELDS.custom_1, ...(base.custom_1 || {}) },
        custom_2: { ...DEFAULT_CUSTOM_FIELDS.custom_2, ...(base.custom_2 || {}) },
        custom_3: { ...DEFAULT_CUSTOM_FIELDS.custom_3, ...(base.custom_3 || {}) },
      });
    } catch {
      setCustomFields(DEFAULT_CUSTOM_FIELDS);
    }
  }, [settingsRecord?.id]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const data = {
        defaults_config: JSON.stringify(defaults),
        custom_fields_config: JSON.stringify(customFields),
        keyboard_shortcuts_config: JSON.stringify(shortcuts),
      };
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
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="shortcuts">Shortcuts</TabsTrigger>
            <TabsTrigger value="custom">Custom Fields</TabsTrigger>
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

          <TabsContent value="shortcuts">
            <div className="bg-white border rounded-xl p-6 space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Keyboard Shortcuts</h2>
                <p className="text-sm text-slate-600 mt-1">
                  These shortcuts work in the logger and can also control the video popup from the main match window, even while the video is on another screen or in Picture-in-Picture.
                </p>
              </div>

              {[
                {
                  key: 'stat_click',
                  title: 'Click Stats',
                  rows: [
                    ['shot', 'Shot'],
                    ['kickout', 'Kickout'],
                    ['turnover', 'Turnover'],
                    ['foul', 'Foul'],
                    ['throw_in', 'Throw In'],
                  ],
                },
                {
                  key: 'stat_drag',
                  title: 'Drag Stats',
                  rows: [
                    ['pass', 'Pass'],
                    ['carry', 'Carry'],
                  ],
                },
                {
                  key: 'video',
                  title: 'Video Hotkeys',
                  rows: [
                    ['toggle_play_pause', 'Play / Pause'],
                    ['back_3', 'Back 3s'],
                    ['forward_3', 'Forward 3s'],
                    ['back_10', 'Back 10s'],
                    ['forward_10', 'Forward 10s'],
                    ['back_20', 'Back 20s'],
                    ['forward_20', 'Forward 20s'],
                    ['slower', 'Slow Down'],
                    ['faster', 'Speed Up'],
                  ],
                },
              ].map((section) => (
                <div key={section.key} className="border rounded-xl p-4 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-900">{section.title}</div>
                      <div className="text-xs text-slate-500 mt-1">Use a single key like <span className="font-mono">P</span> or a combo like <span className="font-mono">Shift+P</span>.</div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShortcuts((prev) => ({ ...prev, [section.key]: { ...DEFAULT_SHORTCUTS[section.key] } }))}
                    >
                      Reset Section
                    </Button>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    {section.rows.map(([value, label]) => (
                      <div key={`${section.key}-${value}`} className="space-y-2">
                        <Label>{label}</Label>
                        <Input
                          value={shortcuts?.[section.key]?.[value] || ''}
                          onChange={(e) => {
                            const next = normalizeShortcutText(e.target.value);
                            setShortcuts((prev) => ({
                              ...prev,
                              [section.key]: {
                                ...(prev?.[section.key] || {}),
                                [value]: next,
                              },
                            }));
                          }}
                          placeholder={prettyShortcut(DEFAULT_SHORTCUTS[section.key]?.[value])}
                          className="font-mono"
                        />
                        <div className="text-xs text-slate-500">Current: {prettyShortcut(shortcuts?.[section.key]?.[value])}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="custom">
            <div className="bg-white border rounded-xl p-6 space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Custom Fields</h2>
                <p className="text-sm text-slate-600 mt-1">
                  Add up to 3 optional fields to every stat. These do not affect play or possession logic.
                </p>
              </div>

              {(['custom_1', 'custom_2', 'custom_3']).map((key) => {
                const f = customFields?.[key] || {};
                const setField = (patch) => {
                  setCustomFields((prev) => ({ ...(prev || DEFAULT_CUSTOM_FIELDS), [key]: { ...(prev?.[key] || DEFAULT_CUSTOM_FIELDS[key]), ...patch } }));
                };
                const opts = Array.isArray(f.options) ? f.options : [];

                return (
                  <div key={key} className="border rounded-xl p-4 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="space-y-1">
                        <Label className="text-base">{f.label?.trim() ? f.label : (key === 'custom_1' ? 'Custom 1' : key === 'custom_2' ? 'Custom 2' : 'Custom 3')}</Label>
                        <p className="text-xs text-slate-500">Enable to show this field on the stat logging screen.</p>
                      </div>
                      <Switch checked={!!f.enabled} onCheckedChange={(v) => setField({ enabled: !!v })} />
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Field Name (CSV Header)</Label>
                        <Input
                          value={f.label || ''}
                          onChange={(e) => setField({ label: e.target.value })}
                          placeholder="e.g. Weather"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Option Count</Label>
                        <div className="text-sm text-slate-700">{opts.length}</div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <Label>Options</Label>
                      <div className="space-y-2">
                        {opts.map((opt, idx) => (
                          <div key={`${key}-${idx}`} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <Input
                              value={opt.label || ''}
                              onChange={(e) => {
                                const next = [...opts];
                                next[idx] = { ...(next[idx] || {}), label: e.target.value };
                                setField({ options: next });
                              }}
                              placeholder="Label (shown to users)"
                            />
                            <div className="flex gap-2">
                              <Input
                                value={opt.value || ''}
                                onChange={(e) => {
                                  const next = [...opts];
                                  next[idx] = { ...(next[idx] || {}), value: e.target.value };
                                  setField({ options: next });
                                }}
                                placeholder="value (stored)"
                                className="font-mono"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                  const next = opts.filter((_, i) => i !== idx);
                                  setField({ options: next });
                                }}
                              >
                                Remove
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          const next = [...opts, { label: '', value: '' }];
                          setField({ options: next });
                        }}
                      >
                        Add Option
                      </Button>

                      <p className="text-xs text-slate-500">
                        Tip: If a field has 4 or fewer options, it will appear as buttons in the stat modal. Otherwise it will appear as a dropdown.
                      </p>
                    </div>
                  </div>
                );
              })}
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

