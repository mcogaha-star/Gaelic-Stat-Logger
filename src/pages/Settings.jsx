const db = globalThis.__B44_DB__ || {
  auth: { isAuthenticated: async () => false, me: async () => null },
  entities: new Proxy({}, { get: () => ({ filter: async () => [], get: async () => null, create: async () => ({}), update: async () => ({}), delete: async () => ({}) }) }),
  integrations: { Core: { UploadFile: async () => ({ file_url: '' }) } },
};

import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';
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
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

import { ArrowLeft, RefreshCw, Save } from 'lucide-react';
import { clearConsent } from '@/components/ConsentGate';
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient';
import { DEFAULT_SHORTCUTS, mergeShortcutConfig, normalizeShortcutText, prettyShortcut } from '@/lib/shortcuts';

const VIDEO_SETTINGS_INFO = [
  ['Video Review', 'Use video mode after logging when you want event queues, possession queues, reels, notes, or fast clip launching.'],
  ['Picture-in-Picture', 'Use PiP if your browser supports it and you want the video to stay visible while you work elsewhere in the app.'],
  ['Half Start Sync', 'Set half start from video in the logger so timings line up later in reports, players, and clip jumps.'],
];

const STATS_REFERENCE_GROUPS = [
  {
    id: 'stats-flow',
    title: 'Possession and attack flow',
    summary: 'Use these when reading possessions, tempo, and build-up outputs.',
    items: [
      { term: 'Possession', meaning: 'One spell of the ball for a team. It usually ends with a score, a turnover, a lost shot, or the half ending.', where: 'Used across possessions, turnover rates, and pace metrics.' },
      { term: 'Attack', meaning: 'A possession becomes an attack once it enters the opposition 45. One possession can only count as one attack.', where: 'Shows how often a team turns possession into a proper attacking phase.' },
      { term: 'Possession Start Zone', meaning: 'Shows whether the possession began in the defensive third, middle third, or attacking third.', where: 'Useful for understanding where a team starts its ball-winning or restart work.' },
      { term: 'Passes / Possession Minute', meaning: 'How many passes a team plays per minute of live possession time, with dead-ball gaps removed.', where: 'A quick tempo check rather than a quality score.' },
      { term: 'Build-Up Speed', meaning: 'Average time it takes an attack to reach its first action inside the opposition 45.', where: 'Helps compare direct attacks with slower build-up phases.' },
    ],
  },
  {
    id: 'stats-territory',
    title: 'Territory and progression',
    summary: 'These explain how the app measures movement, territory, and shot value.',
    items: [
      { term: 'Set Defence', meaning: 'Shows whether the opposition defence was already organised when the action happened.', where: 'Important when comparing transition attacks against settled attacks.' },
      { term: 'Field Tilt', meaning: 'Compares how much of each team\'s passing and carrying ends in the opposition 45.', where: 'A territory indicator, not a score on its own.' },
      { term: 'Scoring Zone', meaning: 'The central high-value shooting area in front of goal used by shot maps and player outputs.', where: 'Used in shooting charts, scoring-zone entries, and player shot review.' },
      { term: 'Scoring Zone Entry', meaning: 'A pass or carry that starts outside the scoring zone and ends inside it.', where: 'Tracks how teams create high-value entries, not just shots.' },
      { term: 'Progressive Meters', meaning: 'How much closer to goal an action moves the ball. Backward or sideways actions do not add progressive meters.', where: 'Useful for identifying players or teams that advance play rather than recycle it.' },
      { term: 'Progressive Action', meaning: 'A pass or carry that clears the app\'s forward-progress thresholds.', where: 'The count tells you who regularly moves play on in a meaningful way.' },
      { term: 'Successful Progressive Passes / Carries', meaning: 'Completed progressive passes and completed progressive carries, shown as counts.', where: 'Use these for volume rather than completion percentage.' },
      { term: 'Switch', meaning: 'A completed pass that moves the ball more than 30 metres across the pitch.', where: 'Useful when reviewing width and shape manipulation.' },
    ],
  },
  {
    id: 'stats-defence',
    title: 'Defence and pressure outputs',
    summary: 'These terms sit behind the defence tab and several team-level pressure metrics.',
    items: [
      { term: 'Defensive Action', meaning: 'At team level this includes turnovers forced plus high-pressure opposition carries, passes, and shots. At player level it includes turnovers forced or recovered, without double-counting the same turnover, plus high-pressure carry-defender actions.', where: 'Use this as a pressure-and-disruption output, not only a tackling count.' },
      { term: 'Average DA Height', meaning: 'The average pitch height of a team\'s defensive actions.', where: 'Shows where a team usually applies defensive pressure.' },
      { term: 'PPDA', meaning: 'Opponent completed passes divided by your team\'s defensive actions.', where: 'Lower values usually mean more active pressure.' },
      { term: 'Turnover Forced / Recovered', meaning: 'Player defence outputs split turnover work into forced and recovered rather than one combined number.', where: 'Useful when you want to separate pressure from loose-ball recovery.' },
      { term: 'Brought Back Advantage', meaning: 'Rows marked Brought Back - Adv. stay visible where useful but are excluded from core totals.', where: 'Important when checking why an event appears in data but not in the main output totals.' },
    ],
  },
  {
    id: 'stats-players',
    title: 'Players, matchups, and role outputs',
    summary: 'These terms matter most in the Players tab and defending-allowed views.',
    items: [
      { term: 'Shot Assist / Shots Created', meaning: 'Currently both mean the final completed pass before a shot.', where: 'Use them as the same measure for now.' },
      { term: 'Kickouts Won', meaning: 'In player views, this combines clean won and break won by that player.', where: 'In defending-allowed views it may appear as won / total with a win rate.' },
      { term: 'TO Lost / 10 Poss', meaning: 'Turnovers lost adjusted for how many possessions the team or player had.', where: 'Useful for comparing players with very different usage levels.' },
      { term: 'Matchup Stints', meaning: 'Defender-versus-attacker time windows used for Defending Allowed.', where: 'Only matters if you have assigned matchups.' },
      { term: 'Defending Allowed', meaning: 'What a marked attacker produced during their assigned matchup windows. Per 70 uses matchup minutes, not total minutes played.', where: 'Do not read it as a normal minutes-played stat.' },
      { term: 'Touches', meaning: 'Moments when a player clearly gains or controls the ball, including qualifying wins, recoveries, and some restart actions.', where: 'Used heavily in player cards, rates, and touch maps.' },
      { term: 'Touch Map', meaning: 'A map of those touch events. In Defending Allowed it shows touches by the marked attacker during matchup windows.', where: 'Helpful for role shape and matchup location review.' },
      { term: 'Pass Sonar', meaning: 'Shows where passes started, the direction they went, and the mix of handpasses and kickpasses.', where: 'Best used for distribution style rather than raw volume.' },
      { term: 'Carry Rate / Pass Rate / Shoot Rate', meaning: 'How often a player carries, passes, or shoots relative to their touches.', where: 'Useful for understanding role and decision profile.' },
      { term: 'No-Carry Pass Rate', meaning: 'The rate of passes played before a player has carried the ball in that possession.', where: 'Useful when distinguishing quick release players from carriers.' },
    ],
  },
  {
    id: 'stats-sharing',
    title: 'Restarts, sharing, and account context',
    summary: 'These explain restart outputs and how data moves between users and devices.',
    items: [
      { term: 'Own Kickout Win %', meaning: 'Own kickouts won divided by own kickouts taken.', where: 'A restart retention metric rather than a full restart picture.' },
      { term: 'Game Share', meaning: 'A share code that lets another signed-in user import a full private copy of the match, including names and matchups.', where: 'Best when another analyst needs their own working copy.' },
      { term: 'Stat Share', meaning: 'A share code that opens a read-only report and player-analysis view without importing a local copy.', where: 'Best for review, not logging.' },
      { term: 'Private Sync', meaning: 'Keeps your teams, players, matches, matchup stints, and stat rows aligned across devices on your account.', where: 'Use this when you work on more than one machine.' },
    ],
  },
];

const LOGGING_REFERENCE_GROUPS = [
  {
    id: 'logging-pressure',
    title: 'Pressure and quality fields',
    summary: 'These are the main judgment calls that shape report quality later.',
    items: [
      { term: 'Pressure', meaning: 'Use High for contact or tackle pressure, Medium for a nearby defender without contact, and Low when the nearest defender is comfortably away.', where: 'Stay consistent across matches so comparisons still mean something.' },
      { term: 'Carry Pressure', meaning: 'On carries, a High pressure row should include the defender and that defender should be from the opposition team.', where: 'This matters because carry defence feeds player and team defensive-action outputs.' },
      { term: 'Shot Pressure', meaning: 'Use the same low / medium / high logic for shots based on defender proximity and contact at release.', where: 'Do not change the scale match to match.' },
      { term: 'Pass Accuracy ++', meaning: 'Perfectly weighted or in stride. The receiver does not need to adjust.', where: 'Use when the pass quality itself is excellent.' },
      { term: 'Pass Accuracy +', meaning: 'A standard completed pass with only a minor adjustment needed by the receiver.', where: 'This is the normal default for completed passes.' },
      { term: 'Pass Accuracy -', meaning: 'Potentially winnable, but the receiver needs a major adjustment.', where: 'It can still be completed, but the pass quality was poor.' },
      { term: 'Pass Accuracy --', meaning: 'Very poor or effectively unwinnable.', where: 'Use when the pass quality, not the situation difficulty, is the main issue.' },
    ],
  },
  {
    id: 'logging-outcomes',
    title: 'Outcome labels that affect reports',
    summary: 'These labels change downstream calculations, not just the wording on the row.',
    items: [
      { term: 'Broken - Retained Passes', meaning: 'A pass is disrupted or broken, but the passer team regains possession.', where: 'This protects the possession logic while still recording the disruption.' },
      { term: 'Dispossessed - Retained Carries', meaning: 'The carrier is disrupted, but the same team recovers the ball.', where: 'Use this when the carry fails cleanly but possession does not change teams.' },
      { term: 'Brought Back Advantage', meaning: 'Use only when play is brought back and the row should not create a fresh possession outcome.', where: 'It keeps the event visible without polluting the main totals.' },
    ],
  },
  {
    id: 'logging-setup',
    title: 'Setup and edge-case rules',
    summary: 'These keep player outputs, restart tables, and defensive logic stable.',
    items: [
      { term: 'Restart Takers And Touches', meaning: 'Deadball pass or carry restarts, solo-plus-go carries, and placed-ball shots count as touches for the restart taker. Own kickout takers do not count as touches unless they also win the kickout.', where: 'Important when player touch totals look higher or lower than expected.' },
      { term: 'Set Defence In Logging', meaning: 'Yes means the opposition defence was set. No means the action happened before the defence was organised.', where: 'This directly affects transition versus settled-attack interpretation.' },
      { term: 'Team-Level Fouls', meaning: 'For breach, technical, and other team-level fouls, set Foul By to Home Team or Away Team and set Foul On to the opposite team.', where: 'This prevents player-level foul data from being distorted by team infractions.' },
    ],
  },
];

const LOGGING_GUIDE_STEPS = [
  {
    title: 'Keep the pressure scale stable',
    body: 'Apply the same low / medium / high logic across passes, carries, and shots so report outputs remain comparable from game to game.',
  },
  {
    title: 'Separate pass quality from pass difficulty',
    body: 'Do not lower or raise pass accuracy just because the pass was risky. Rate the quality of the pass itself.',
  },
  {
    title: 'Protect restart outcomes',
    body: 'Use clean, break, foul, sideline_for, and sideline_against carefully because restart tables and player restart outputs depend on them.',
  },
  {
    title: 'Log substitutions every time',
    body: 'Minutes, on-field logic, matchup defaults, and player rates all depend on correct sub timing.',
  },
  {
    title: 'Remember what feeds defensive actions',
    body: 'Team defensive actions come from turnovers forced plus high-pressure opposition carries, passes, and shots. Player-level defensive actions also use turnover force or recovery involvement and high-pressure carry defender rows.',
  },
];

const ACCOUNT_REFERENCE_GROUPS = [
  {
    id: 'account-sharing',
    title: 'Sync and sharing',
    summary: 'Use these when deciding how to move work between users or devices.',
    items: [
      { term: 'Account Sync', meaning: 'Pulls your private teams, players, matches, matchup stints, and stat rows onto the current device.', where: 'Use when you work on more than one machine.' },
      { term: 'Game Share', meaning: 'Lets another signed-in user import a full private working copy of the match.', where: 'Best when another analyst needs their own editable version.' },
      { term: 'Stat Share', meaning: 'Opens a read-only report and players view without importing a local match copy.', where: 'Best for review or sign-off, not for logging.' },
      { term: 'Imported And Synced Matches', meaning: 'Imported or synced matches can behave differently from locally created editable matches.', where: 'Check the card badge before expecting the logger to be available.' },
    ],
  },
  {
    id: 'account-privacy',
    title: 'Privacy and identity',
    summary: 'Use these when managing consent, account identity, and login behavior.',
    items: [
      { term: 'Privacy And Consent', meaning: 'Controls whether this device participates in uploads, sync, and sharing. Revoking consent signs you out and stops further uploads from this device.', where: 'A device-level safety setting, not a match-level setting.' },
      { term: 'Google Linking', meaning: 'Links Google to the same account so future Google sign-ins do not create a separate login path.', where: 'Useful when one person signs in in more than one way.' },
    ],
  },
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

function LearnMoreCard({ title, body, label = 'Reference note' }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="space-y-1">
        <div className="font-semibold text-slate-900">{title}</div>
        <div className="text-sm text-slate-600">{body}</div>
      </div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

function ReferenceGroupPreview({ groups }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {groups.map((group) => (
        <div key={group.id} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="font-semibold text-slate-900">{group.title}</div>
            <div className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
              {group.items.length} terms
            </div>
          </div>
          <div className="mt-1 text-sm text-slate-600">{group.summary}</div>
        </div>
      ))}
    </div>
  );
}

function ReferenceAccordion({ groups }) {
  return (
    <Accordion type="multiple" className="space-y-3">
      {groups.map((group) => (
        <AccordionItem key={group.id} value={group.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white px-4">
          <AccordionTrigger className="py-4 text-left hover:no-underline">
            <div className="space-y-1">
              <div className="font-semibold text-slate-900">{group.title}</div>
              <div className="pr-6 text-sm font-normal text-slate-500">{group.summary}</div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            <div className="grid gap-3 md:grid-cols-2">
              {group.items.map((item) => (
                <div key={item.term} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="font-semibold text-slate-900">{item.term}</div>
                  <div className="mt-1 text-sm leading-6 text-slate-600">{item.meaning}</div>
                  <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Why it matters</div>
                  <div className="mt-1 text-sm leading-6 text-slate-500">{item.where}</div>
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

function GuideChecklist({ items }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {items.map((item, index) => (
        <div key={item.title} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
              {index + 1}
            </div>
            <div className="font-semibold text-slate-900">{item.title}</div>
          </div>
          <div className="mt-3 text-sm leading-6 text-slate-600">{item.body}</div>
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
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, user, linkGoogleIdentity, isSupabaseConfigured: authConfigured } = useAuth();
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [isLinkingGoogle, setIsLinkingGoogle] = useState(false);
  const liveDemoIntentHandledRef = React.useRef(false);

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

  const openLiveDemoMutation = useMutation({
    mutationFn: async () => {
      const { openDemoMatch } = await import('@/lib/demoData');
      return openDemoMatch(db, { mode: 'live' });
    },
    onSuccess: (match) => {
      queryClient.invalidateQueries({ queryKey: ['matches'] });
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      queryClient.invalidateQueries({ queryKey: ['players'] });
      queryClient.invalidateQueries({ queryKey: ['all-stats'] });
      if (match?.id) queryClient.invalidateQueries({ queryKey: ['stats', match.id] });
      toast.success('Live demo match ready');
      if (match?.id) navigate(createPageUrl(`MatchStats?id=${match.id}`));
    },
    onError: (error) => toast.error(error?.message || 'Failed to open live demo match'),
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
  const settingsTab = useMemo(() => {
    const params = new URLSearchParams(location?.search || '');
    const value = String(params.get('tab') || 'stats');
    return ['stats', 'logging', 'account', 'info'].includes(value) ? value : 'stats';
  }, [location?.search]);

  useEffect(() => {
    const params = new URLSearchParams(location?.search || '');
    if (params.get('intent') !== 'live-demo') return;
    if (liveDemoIntentHandledRef.current || openLiveDemoMutation.isPending) return;
    liveDemoIntentHandledRef.current = true;
    openLiveDemoMutation.mutate();
  }, [location?.search, openLiveDemoMutation.isPending]);

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
          <div className="flex items-center gap-2">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              <Save className="mr-2 h-4 w-4" />
              {saveMutation.isPending ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <Tabs key={settingsTab} defaultValue={settingsTab} className="space-y-6">
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
                <LearnMoreCard
                  title="This tab changes review behavior, not the logging flow"
                  body="Use these settings when you want to fine-tune video review and hotkeys after the match has already been logged. For the hands-on walkthrough, start from Home or open a logger and use its Help button."
                  label="Video reference"
                />
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
                <div className="rounded-xl border border-slate-200 p-4 text-sm text-slate-600">
                  These video settings affect post-logging review behavior. They do not replace clean half timing, substitutions, or accurate event tagging in the logger.
                </div>
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
                      Logging settings affect the match-day logger, live mode fields, keyboard shortcuts, and optional custom stat-entry fields. Use them to simplify the workflow for your analysts, not to work around missing core steps like substitutions or half timing.
                    </div>
                    <LearnMoreCard
                      title="Use logger Help for the step-by-step tutorial"
                      body="This page is the control panel for logging defaults. The interactive walkthrough lives inside an actual match logger so users can see the real buttons, pitch, and stat modal."
                      label="Logging reference"
                    />
                    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1">
                        <Label>Live Demo Match</Label>
                        <p className="text-xs text-slate-500">
                          Open the demo fixture in live mode to test live logging and the trimmed live report without changing the analysis demo.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="sm:self-start"
                        onClick={() => openLiveDemoMutation.mutate()}
                        disabled={openLiveDemoMutation.isPending}
                      >
                        {openLiveDemoMutation.isPending ? 'Opening...' : 'Open Live Demo Match'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="live">
                <Card>
                  <CardContent className="space-y-6 p-6">
                    {[
                      ['showShotSituation', 'Show shot situation'],
                      ['showShotMethod', 'Show shot method'],
                      ['showShotPressure', 'Show shot pressure'],
                      ['showShotBlockedSavedBy', 'Show shot blocked or saved by'],
                      ['showKickoutBrokenBy', 'Show kickout broken by'],
                      ['showKickoutPress', 'Show kickout press'],
                      ['showKickoutLostBy', 'Show kickout lost by'],
                      ['showTurnoverType', 'Show turnover type'],
                      ['showTurnoverBroughtBackAdv', 'Show turnover brought back advantage'],
                      ['showFoulCard', 'Show foul card'],
                      ['showThrowInBrokenBy', 'Show throw-in broken by'],
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
                    <p className="mt-1 text-xs text-slate-500">Pull missing private teams, players, matches, matchup stints, and stat rows onto this device so the same account can keep working across machines.</p>
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
                <LearnMoreCard
                  title="Account is a reference surface first"
                  body="Use this area to understand sync, sharing, consent, and linking. New users should still begin with the Home tutorial before they rely on shared or synced workflows."
                  label="Account reference"
                />
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
                  <CardContent className="space-y-6 p-6">
                    <LearnMoreCard
                      title="Use this tab when a stat label is unclear"
                      body="Start with the category summary, then open only the section you need. The aim here is to explain what the number means and where it matters, without sending users into a wall of text."
                      label="Stats reference"
                    />
                    <ReferenceGroupPreview groups={STATS_REFERENCE_GROUPS} />
                    <ReferenceAccordion groups={STATS_REFERENCE_GROUPS} />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="logging-defs">
                <Card>
                  <CardContent className="space-y-6 p-6">
                    <LearnMoreCard
                      title="Use this tab when a logging field is unclear"
                      body="These definitions are grouped by the judgment calls that usually cause confusion in the logger: pressure, accuracy, outcomes, and setup rules."
                      label="Logging terms"
                    />
                    <ReferenceGroupPreview groups={LOGGING_REFERENCE_GROUPS} />
                    <ReferenceAccordion groups={LOGGING_REFERENCE_GROUPS} />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="logging-guide">
                <Card>
                  <CardContent className="space-y-6 p-6">
                    <LearnMoreCard
                      title="Use this tab as the quick quality-control checklist"
                      body="This is the short version of the logging habits that most often protect minutes, rates, restart outputs, and downstream reports."
                      label="Best-practice notes"
                    />
                    <GuideChecklist items={LOGGING_GUIDE_STEPS} />
                    <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div>
                        <div className="font-semibold text-slate-900">Account, sharing, and privacy reference</div>
                        <div className="mt-1 text-sm text-slate-600">
                          Keep this section for sync and sharing questions. It is written as reference, not onboarding.
                        </div>
                      </div>
                      <ReferenceGroupPreview groups={ACCOUNT_REFERENCE_GROUPS} />
                      <ReferenceAccordion groups={ACCOUNT_REFERENCE_GROUPS} />
                    </div>
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
