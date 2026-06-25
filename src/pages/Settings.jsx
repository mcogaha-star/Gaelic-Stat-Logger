const db = globalThis.__B44_DB__ || {
  auth: { isAuthenticated: async () => false, me: async () => null },
  entities: new Proxy({}, { get: () => ({ filter: async () => [], get: async () => null, create: async () => ({}), update: async () => ({}), delete: async () => ({}) }) }),
  integrations: { Core: { UploadFile: async () => ({ file_url: '' }) } },
};

import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { createPageUrl } from '@/utils';
import { DEFAULT_CUSTOM_FIELDS, DEFAULT_DEFAULTS } from '@/components/statDefaults';
import { DEFAULT_LIVE_MODE_SETTINGS, parseLiveModeSettings } from '@/lib/liveModeSettings';
import { hydrateServerAccountData } from '@/lib/accountSync';
import { useAuth } from '@/lib/AuthContext';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

import { ArrowLeft, RefreshCw, Save } from 'lucide-react';
import { clearConsent } from '@/components/ConsentGate';
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient';
import { DEFAULT_SHORTCUTS, mergeShortcutConfig, normalizeShortcutText, prettyShortcut } from '@/lib/shortcuts';

const VIDEO_SETTINGS_INFO = [
  ['Video Review', 'Video mode supports event queues, possession queues, reels, notes, and map-driven clip launching across the report and players workflows.'],
  ['Picture-in-Picture', 'Use PiP when supported to keep video visible while tagging or reviewing events in the main app.'],
  ['Half Start Sync', 'Set half start times from video in the logger to keep timing aligned across stats, report views, and clip jumps.'],
];

const STATS_DEFINITIONS = [
  ['Possession', 'A possession is one spell of the ball for a team. It usually ends with a score, a turnover, a lost shot, or the half ending.'],
  ['Attack', 'A possession becomes an attack once it enters the opposition 45. One possession can only count as one attack.'],
  ['Set Defence', 'Set defence shows whether the opposition defence was already organised when the action happened.'],
  ['Field Tilt', 'Field tilt compares how much of each team’s passing and carrying finishes in the opposition 45.'],
  ['Scoring Zone', 'The scoring zone is the central high-value shooting area in front of goal used by the shot maps and player outputs.'],
  ['Scoring Zone Entry', 'A scoring zone entry is a pass or carry that starts outside the scoring zone and ends inside it.'],
  ['Progressive Meters', 'Progressive meters measure how much closer to goal an action moves the ball. Backward or sideways actions do not add progressive meters.'],
  ['Progressive Action', 'A progressive pass or carry is one that moves the ball meaningfully closer to goal based on the app’s pass and carry thresholds.'],
  ['Successful Progressive Passes / Carries', 'These are the completed progressive passes and completed progressive carries, shown as counts rather than percentages.'],
  ['Switch', 'A switch is a completed pass that moves the ball more than 30 metres across the pitch.'],
  ['Defensive Action', 'At team level this includes turnovers forced plus high-pressure opposition carries, passes, and shots. At player level it includes turnovers forced or recovered, without double-counting the same turnover, plus high-pressure carry-defender actions.'],
  ['Average DA Height', 'Average defensive-action height is the average pitch position of a team’s defensive actions.'],
  ['Passes / Possession Minute', 'This shows how many passes a team plays per minute of live possession time, with dead-ball gaps removed.'],
  ['Build-Up Speed', 'Build-up speed is the average time it takes an attack to move from the live possession start to its first action inside the opposition 45.'],
  ['Shot Assist / Shots Created', 'Both currently mean the final completed pass before a shot.'],
  ['Possession Start Zone', 'This shows whether a possession began in the defensive third, middle third, or attacking third.'],
  ['Own Kickout Win %', 'Own kickout win percentage is own kickouts won divided by own kickouts taken.'],
  ['Kickouts Won', 'In player views, kickouts won combines clean won and break won by that player. In defending allowed it is shown as won / total with a win percentage.'],
  ['TO Lost / 10 Poss', 'Turnovers lost per 10 possessions adjusts ball losses for how many possessions the team or player had.'],
  ['PPDA', 'PPDA is opponent completed passes divided by your team’s defensive actions.'],
  ['Turnover Forced / Recovered', 'Player defense outputs split turnover work into turnovers forced and turnovers recovered rather than using one combined TO Won number.'],
  ['Matchup Stints', 'Matchup stints are defender-versus-attacker time windows used for Defending Allowed in the Players tab.'],
  ['Defending Allowed', 'Defending Allowed totals what a marked attacker produced during their assigned matchup windows. Per 70 uses matchup minutes, not total minutes played.'],
  ['Touches', 'Touches count the moments when a player clearly gains or controls the ball, including qualifying wins, recoveries, and certain restart actions.'],
  ['Touch Map', 'Touch maps plot those touch events. In Defending Allowed, the touch map shows touches by the marked attacker during matchup windows.'],
  ['Pass Sonar', 'The pass sonar shows where passes started, which direction they went, and the mix of handpasses and kickpasses.'],
  ['Carry Rate / Pass Rate / Shoot Rate', 'These rates compare how often a player carries, passes, or shoots relative to their touches.'],
  ['No-Carry Pass Rate', 'This is the rate of passes played before a player has carried the ball in that possession.'],
  ['Game Share', 'A game share code lets another signed-in user import a full private copy of the match, including names, matchups, reels, and public video notes.'],
  ['Stat Share', 'A stat share code opens a read-only version of the match report and player analysis without importing a local copy.'],
  ['Private Sync', 'Private sync keeps your teams, players, matches, matchup stints, and stat rows aligned across devices on your account.'],
  ['Brought Back Advantage', 'Rows marked Brought Back - Adv. stay visible where useful but are excluded from core stat totals.'],
];

const LOGGING_DEFINITIONS = [
  ['Pressure', 'Use High when there is contact or tackle pressure. Use Medium when a defender is within 3m but there is no contact. Use Low when the nearest defender is more than 3m away.'],
  ['Carry Pressure', 'On carries, High pressure should include the defender and that defender should be from the opposition team.'],
  ['Shot Pressure', 'Use the same low / medium / high scale for shots based on defender proximity and contact at release.'],
  ['Pass Accuracy ++', 'Perfectly weighted or in stride. The receiver does not need to adjust.'],
  ['Pass Accuracy +', 'Standard completed pass. The receiver may make only a minor adjustment. This is the default for newly logged passes.'],
  ['Pass Accuracy -', 'Potentially winnable, but the receiver needs a major adjustment. This can still be a completed pass if the receiver wins it.'],
  ['Pass Accuracy --', 'Very poor or effectively unwinnable pass. Use this when pass quality, not situation difficulty, is the main problem.'],
  ['Broken - Retained Passes', 'Use Broken - Retained when the pass is disrupted or broken but the passer team regains possession.'],
  ['Dispossessed - Retained Carries', 'Use Dispossessed - Retained when the carrier is disrupted but the same team recovers the ball.'],
  ['Restart Takers And Touches', 'Deadball pass or carry restarts, solo-plus-go carries, and placed-ball shots count as touches for the restart taker. Own kickout takers are not counted as touches unless they also win the kickout.'],
  ['Set Defence In Logging', 'Yes means the opposition defence was set on that action. No means the action happened before the defence was set.'],
  ['Brought Back Advantage', 'Use Brought Back - Adv. only when play is brought back and that row should not create a new possession outcome in calculations.'],
  ['Team-Level Fouls', 'For breach, technical, and other team-level fouls, set Foul By to Home Team or Away Team and set Foul On to the opposite team.'],
];

const LOGGING_GUIDE = [
  ['Pressure', 'Apply the same pressure scale consistently across passes, carries, and shots so report outputs remain comparable.'],
  ['Accuracy vs Difficulty', 'Do not increase or decrease pass accuracy just because the pass was difficult. Rate whether the pass itself gave the receiver a fair chance.'],
  ['Defensive Actions In Logging', 'Team defensive actions come from turnovers forced, high-pressure opposition carries, and high-pressure opposition passes or shots. Individual defensive actions come from turnover force/recovery involvement and high-pressure carry defender actions.'],
  ['Kickout And Throw-In Outcomes', 'Use clean, break, foul, sideline_for, and sideline_against carefully because they feed restart tables, player restart cards, and defending allowed stats.'],
  ['Substitutions', 'Use substitutions consistently with correct teams and clock times because minutes, player on-field logic, matchup defaults, and player rates all depend on them.'],
];

function SectionCards({ items, columns = 'md:grid-cols-2' }) {
  return (
    <div className={`grid gap-3 ${columns}`}>
      {items.map(([title, body]) => (
        <div key={title} className="rounded-xl border border-slate-200 p-4">
          <div className="font-semibold text-slate-900">{title}</div>
          <div className="mt-1 text-sm text-slate-600">{body}</div>
        </div>
      ))}
    </div>
  );
}

function SectionRows({ items }) {
  return (
    <div className="space-y-4">
      {items.map(([title, body], index) => (
        <div key={title} className={index === items.length - 1 ? '' : 'border-b border-slate-200 pb-4'}>
          <div className="font-semibold text-slate-900">{title}</div>
          <div className="mt-1 text-sm leading-6 text-slate-600">{body}</div>
        </div>
      ))}
    </div>
  );
}

function ShortcutSection({ section, shortcuts, setShortcuts }) {
  return (
    <div className="space-y-4 rounded-xl border p-4">
      <div className="font-semibold text-slate-900">{section.title}</div>
      <div className="grid gap-4 sm:grid-cols-2">
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
  );
}

export default function Settings() {
  const queryClient = useQueryClient();
  const { isAuthenticated, user, linkGoogleIdentity, isSupabaseConfigured: authConfigured } = useAuth();
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [isLinkingGoogle, setIsLinkingGoogle] = useState(false);

  const { data: settingsRecords = [] } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => db.entities.AppSettings.list(),
  });
  const { data: matches = [] } = useQuery({
    queryKey: ['matches'],
    queryFn: () => db.entities.Match.list('-created_date'),
  });
  const { data: teams = [] } = useQuery({
    queryKey: ['teams'],
    queryFn: () => db.entities.Team.list('name'),
  });
  const { data: players = [] } = useQuery({
    queryKey: ['players'],
    queryFn: () => db.entities.Player.list('number'),
  });
  const { data: allStats = [] } = useQuery({
    queryKey: ['all-stats'],
    queryFn: () => db.entities.StatEntry.list('-timestamp'),
  });

  const settingsRecord = settingsRecords[0];
  const [defaults, setDefaults] = useState(DEFAULT_DEFAULTS);
  const [customFields, setCustomFields] = useState(DEFAULT_CUSTOM_FIELDS);
  const [shortcuts, setShortcuts] = useState(DEFAULT_SHORTCUTS);
  const [liveModeSettings, setLiveModeSettings] = useState(DEFAULT_LIVE_MODE_SETTINGS);

  useEffect(() => {
    if (!settingsRecord?.defaults_config) return;
    try {
      const parsed = JSON.parse(settingsRecord.defaults_config);
      setDefaults({ ...DEFAULT_DEFAULTS, ...((parsed && typeof parsed === 'object') ? parsed : {}) });
    } catch {
      setDefaults(DEFAULT_DEFAULTS);
    }
  }, [settingsRecord?.defaults_config]);

  useEffect(() => {
    if (!settingsRecord) return;
    setLiveModeSettings(parseLiveModeSettings(settingsRecord.live_mode_settings_config));
  }, [settingsRecord?.live_mode_settings_config, settingsRecord?.id]);

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
  }, [settingsRecord?.keyboard_shortcuts_config, settingsRecord?.id]);

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
  }, [settingsRecord?.custom_fields_config, settingsRecord?.id]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const data = {
        defaults_config: JSON.stringify(defaults),
        custom_fields_config: JSON.stringify(customFields),
        keyboard_shortcuts_config: JSON.stringify(shortcuts),
        live_mode_settings_config: JSON.stringify(liveModeSettings),
      };
      if (settingsRecord?.id) return db.entities.AppSettings.update(settingsRecord.id, data);
      return db.entities.AppSettings.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['app-settings'] });
      toast.success('Settings saved');
    },
    onError: (error) => toast.error(error?.message || 'Failed to save settings'),
  });

  const accountSyncMutation = useMutation({
    mutationFn: () => hydrateServerAccountData(db, {
      localMatches: matches,
      localStats: allStats,
      localTeams: teams,
      localPlayers: players,
    }),
    onSuccess: ({ importedMatches, importedStats, importedTeams, importedPlayers, skipped }) => {
      if (skipped) return;
      queryClient.invalidateQueries({ queryKey: ['matches'] });
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      queryClient.invalidateQueries({ queryKey: ['players'] });
      queryClient.invalidateQueries({ queryKey: ['all-stats'] });
      toast.success(`Synced ${importedMatches || 0} match${importedMatches === 1 ? '' : 'es'}, ${importedStats || 0} stat row${importedStats === 1 ? '' : 's'}, ${importedTeams || 0} team${importedTeams === 1 ? '' : 's'}, and ${importedPlayers || 0} player${importedPlayers === 1 ? '' : 's'}`);
    },
    onError: (error) => toast.error(error?.message || 'Failed to sync account data'),
  });

  const identities = Array.isArray(user?.identities) ? user.identities : [];
  const hasGoogleIdentity = identities.some((identity) => identity?.provider === 'google');
  const accountLabel = isAuthenticated
    ? (user?.email || user?.phone || user?.id || 'Signed in')
    : 'Not signed in';
  const enabledCustomFieldCount = useMemo(
    () => ['custom_1', 'custom_2', 'custom_3'].filter((key) => customFields?.[key]?.enabled).length,
    [customFields]
  );

  const handleLinkGoogle = async () => {
    if (!authConfigured) {
      toast.error('Account linking is not configured for this deployment.');
      return;
    }
    setIsLinkingGoogle(true);
    try {
      await linkGoogleIdentity();
      toast.message('Opening Google linking...');
    } catch (error) {
      toast.error(error?.message || 'Failed to start Google linking');
      setIsLinkingGoogle(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <Link to={createPageUrl('Home')}>
              <Button variant="outline" size="icon" aria-label="Back">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
            </div>
          </div>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            <Save className="mr-2 h-4 w-4" />
            {saveMutation.isPending ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <Tabs defaultValue="stats" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="stats">Stats</TabsTrigger>
            <TabsTrigger value="logging">Logging</TabsTrigger>
            <TabsTrigger value="account">Account</TabsTrigger>
            <TabsTrigger value="info">Info</TabsTrigger>
          </TabsList>

          <TabsContent value="stats">
            <Card>
              <CardContent className="space-y-6 p-6">
                <SectionCards items={VIDEO_SETTINGS_INFO} />
                <ShortcutSection
                  section={{
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
                  }}
                  shortcuts={shortcuts}
                  setShortcuts={setShortcuts}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="logging">
            <Tabs defaultValue="general" className="space-y-6">
              <TabsList className="flex h-auto flex-wrap justify-start gap-2 bg-slate-100 p-2">
                <TabsTrigger value="general">General</TabsTrigger>
                <TabsTrigger value="live">Live Mode</TabsTrigger>
                <TabsTrigger value="shortcuts">Shortcuts</TabsTrigger>
                <TabsTrigger value="custom">Custom Fields</TabsTrigger>
              </TabsList>

              <TabsContent value="general">
                <Card>
                  <CardContent className="space-y-6 p-6">
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-4">
                      <div>
                        <Label>Quick Log</Label>
                        <p className="mt-1 text-xs text-slate-500">When enabled, the player picker defaults to the most recent receiver.</p>
                      </div>
                      <Switch
                        checked={defaults.quick_log_enabled !== false}
                        onCheckedChange={(value) => setDefaults({ ...defaults, quick_log_enabled: !!value })}
                      />
                    </div>
                    <div className="rounded-xl border border-slate-200 p-4 text-sm text-slate-600">
                      Logging settings affect the match-day logger, live mode fields, keyboard shortcuts, and optional custom stat-entry fields.
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="live">
                <Card>
                  <CardContent className="space-y-6 p-6">
                    {[
                      ['showShotMethod', 'Show shot method'],
                      ['showShotPressure', 'Show shot pressure'],
                      ['showShotBlockedSavedBy', 'Show shot blocked or saved by'],
                      ['showShotBroughtBackAdv', 'Show shot brought back advantage'],
                      ['showKickoutPress', 'Show kickout press'],
                      ['showKickoutLostBy', 'Show kickout lost by'],
                      ['showTurnoverType', 'Show turnover type'],
                      ['showTurnoverBroughtBackAdv', 'Show turnover brought back advantage'],
                      ['showFoulCard', 'Show foul card'],
                      ['showThrowInLostBy', 'Show throw-in lost by'],
                      ['showTemporarySub', 'Show temporary sub toggle'],
                    ].map(([key, label]) => (
                      <div key={key} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2">
                        <Label>{label}</Label>
                        <Switch
                          checked={liveModeSettings?.[key] !== false}
                          onCheckedChange={(value) => setLiveModeSettings((prev) => ({ ...DEFAULT_LIVE_MODE_SETTINGS, ...(prev || {}), [key]: !!value }))}
                        />
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="shortcuts">
                <Card>
                  <CardContent className="space-y-6 p-6">
                    <ShortcutSection
                      section={{
                        key: 'stat_click',
                        title: 'Click Stats',
                        rows: [
                          ['shot', 'Shot'],
                          ['kickout', 'Kickout'],
                          ['turnover', 'Turnover'],
                          ['foul', 'Foul'],
                          ['throw_in', 'Throw In'],
                        ],
                      }}
                      shortcuts={shortcuts}
                      setShortcuts={setShortcuts}
                    />
                    <ShortcutSection
                      section={{
                        key: 'stat_drag',
                        title: 'Drag Stats',
                        rows: [
                          ['pass', 'Pass'],
                          ['carry', 'Carry'],
                        ],
                      }}
                      shortcuts={shortcuts}
                      setShortcuts={setShortcuts}
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="custom">
                <Card>
                  <CardContent className="space-y-6 p-6">
                    <div className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700 w-fit">
                      {enabledCustomFieldCount} enabled
                    </div>
                    {['custom_1', 'custom_2', 'custom_3'].map((key) => {
                      const field = customFields?.[key] || {};
                      const options = Array.isArray(field.options) ? field.options : [];
                      const setField = (patch) => {
                        setCustomFields((prev) => ({
                          ...(prev || DEFAULT_CUSTOM_FIELDS),
                          [key]: { ...(prev?.[key] || DEFAULT_CUSTOM_FIELDS[key]), ...patch },
                        }));
                      };

                      return (
                        <div key={key} className="space-y-4 rounded-xl border p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="space-y-1">
                              <Label className="text-base">
                                {field.label?.trim()
                                  ? field.label
                                  : (key === 'custom_1' ? 'Custom 1' : key === 'custom_2' ? 'Custom 2' : 'Custom 3')}
                              </Label>
                              <p className="text-xs text-slate-500">Enable to show this field on the stat logging screen.</p>
                            </div>
                            <Switch checked={!!field.enabled} onCheckedChange={(value) => setField({ enabled: !!value })} />
                          </div>

                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                              <Label>Field Name (CSV Header)</Label>
                              <Input
                                value={field.label || ''}
                                onChange={(e) => setField({ label: e.target.value })}
                                placeholder="e.g. Weather"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Option Count</Label>
                              <div className="text-sm text-slate-700">{options.length}</div>
                            </div>
                          </div>

                          <div className="space-y-3">
                            <Label>Options</Label>
                            <div className="space-y-2">
                              {options.map((option, index) => (
                                <div key={`${key}-${index}`} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                  <Input
                                    value={option.label || ''}
                                    onChange={(e) => {
                                      const next = [...options];
                                      next[index] = { ...(next[index] || {}), label: e.target.value };
                                      setField({ options: next });
                                    }}
                                    placeholder="Label"
                                  />
                                  <div className="flex gap-2">
                                    <Input
                                      value={option.value || ''}
                                      onChange={(e) => {
                                        const next = [...options];
                                        next[index] = { ...(next[index] || {}), value: e.target.value };
                                        setField({ options: next });
                                      }}
                                      placeholder="Stored value"
                                      className="font-mono"
                                    />
                                    <Button
                                      type="button"
                                      variant="outline"
                                      onClick={() => setField({ options: options.filter((_, optionIndex) => optionIndex !== index) })}
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
                              onClick={() => setField({ options: [...options, { label: '', value: '' }] })}
                            >
                              Add Option
                            </Button>
                            <p className="text-xs text-slate-500">
                              If a field has 4 or fewer options it appears as buttons in the stat modal; otherwise it appears as a dropdown.
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="account" className="space-y-6">
            <Card>
              <CardContent className="space-y-6 p-6">
                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Logged In As</div>
                  <div className="mt-1 break-all text-sm font-medium text-slate-900">{accountLabel}</div>
                  {isAuthenticated ? (
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        variant={hasGoogleIdentity ? 'outline' : 'default'}
                        disabled={hasGoogleIdentity || isLinkingGoogle}
                        onClick={handleLinkGoogle}
                      >
                        {hasGoogleIdentity ? 'Google Linked' : 'Link Google Account'}
                      </Button>
                      <div className="max-w-md text-xs text-slate-500">
                        Link Google to this signed-in account so using Google later opens the same account instead of creating a separate one.
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 text-sm text-slate-500">Sign in to enable account sync and share workflows.</div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-4">
                  <div>
                    <Label>Account Sync</Label>
                    <p className="mt-1 text-xs text-slate-500">Pull missing private teams, players, matches, matchup stints, and stat rows onto this device.</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2"
                    onClick={() => accountSyncMutation.mutate()}
                    disabled={!isAuthenticated || accountSyncMutation.isPending}
                    title={isAuthenticated ? 'Pull missing account data onto this device' : 'Sign in to sync account data'}
                  >
                    <RefreshCw className={`h-4 w-4 ${accountSyncMutation.isPending ? 'animate-spin' : ''}`} />
                    Sync
                  </Button>
                </div>

                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="font-semibold text-slate-900">Privacy</div>
                  <div className="mt-1 text-sm text-slate-600">
                    Review privacy details, revoke consent, and manage how this device participates in sharing and uploads.
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link to={createPageUrl('Privacy')}>
                      <Button variant="outline">View Privacy Details</Button>
                    </Link>
                    <Button variant="destructive" onClick={() => setRevokeOpen(true)}>
                      Revoke Consent
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

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
                          const authUser = data?.user;
                          if (authUser) {
                            await supabase.from('user_consents').upsert({
                              user_id: authUser.id,
                              consent_version: '2026-03-13',
                              revoked_at: new Date().toISOString(),
                              updated_at: new Date().toISOString(),
                            });
                          }
                          await supabase.auth.signOut();
                        }
                        toast.success('Consent revoked');
                        window.location.reload();
                      } catch (error) {
                        toast.error(error?.message || 'Failed to revoke');
                      }
                    }}
                  >
                    Revoke
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </TabsContent>

          <TabsContent value="info">
            <Tabs defaultValue="stats-defs" className="space-y-6">
              <TabsList className="flex h-auto flex-wrap justify-start gap-2 bg-slate-100 p-2">
                <TabsTrigger value="stats-defs">Stats Definitions</TabsTrigger>
                <TabsTrigger value="logging-defs">Logging Definitions</TabsTrigger>
                <TabsTrigger value="logging-guide">Logging Guide</TabsTrigger>
              </TabsList>

              <TabsContent value="stats-defs">
                <Card>
                  <CardContent className="p-6">
                    <SectionRows items={STATS_DEFINITIONS} />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="logging-defs">
                <Card>
                  <CardContent className="p-6">
                    <SectionRows items={LOGGING_DEFINITIONS} />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="logging-guide">
                <Card>
                  <CardContent className="p-6">
                    <SectionRows items={LOGGING_GUIDE} />
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
