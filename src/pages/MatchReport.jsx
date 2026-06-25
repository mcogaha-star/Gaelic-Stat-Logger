import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BarChart3, ChevronDown, Copy, Menu, Share2, SlidersHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { createPageUrl } from '@/utils';
import { toast } from 'sonner';
import {
  formatHalfClock,
  getNormalizedTimeS,
  getMatchTimeS,
  getNextBallActionStat,
  shotPointsForOutcome,
  extractFoulFromStat,
  oppositeTeamSide,
  buildLegacyPossessionRepairs,
  buildLegacyDefenceSetRepairs,
  buildLegacyDefensiveContactDeletes,
  buildStatModelRepairs,
  buildPlayerTimeAndPossessionStats,
  deriveMatchLengthMinutes,
  inferRestartWinnerSide,
  isDeadBallGapStart,
  normalizeDefenceSetRows,
  normalizeStatModelRows,
  rebuildPossessionRows,
  shouldExcludeFromTotals,
  POSSESSION_REBUILD_VERSION,
  DEFENCE_SET_MIGRATION_VERSION,
  STAT_MODEL_MIGRATION_VERSION,
} from '@/lib/reportAnalytics';
import {
  safeParseJSON,
  formatMMSS,
  computeImputedNormalizedTimes,
  groupByPossession,
  possessionHasOpp45Entry,
  derivePossessionOutcome,
  ReportFiltersFields,
  MatchTimeRangeSlider,
  PitchViz,
  MultiSelect,
  TeamMultiSelect,
  toTitleCase,
  formatExtraValue,
  normalizePlayerRef,
} from '@/features/report/shared';
import ScoringTab from '@/features/report/tabs/ScoringTab';
import PossessionsTab from '@/features/report/tabs/PossessionsTab';
import BuildUpTab from '@/features/report/tabs/BuildUpTab';
import RestartsTab from '@/features/report/tabs/RestartsTab';
import DefenseTab from '@/features/report/tabs/DefenseTab';
import OverviewTab from '@/features/report/tabs/OverviewTab';
import PlayersAnalyticsTab from '@/features/report/tabs/PlayersAnalyticsTab';
import DataTab from '@/features/report/tabs/DataTab';
import PlayerProfilePanel from '@/features/report/components/PlayerProfilePanel';
import MatchupEditorDialog from '@/features/report/components/MatchupEditorDialog';
import useFilteredReportStats from '@/features/report/hooks/useFilteredReportStats';
import usePossessionVisualiser from '@/features/report/hooks/usePossessionVisualiser';
import useReportFilterState from '@/features/report/hooks/useReportFilterState';
import {
  ensureServerMatch,
  softDeletePrivateMatchupStint,
  softDeleteServerStat,
  updateServerStat,
  upsertPrivateMatchupStintFromLocal,
  upsertPrivatePlayerFromLocal,
  upsertPrivateTeamFromLocal,
} from '@/lib/serverSync';
import { createSharedMatchSnapshot } from '@/lib/sharedMatchCopies';
import { buildEffectiveMatchupStints, buildMatchupPeriodMaxSeconds } from '@/lib/defendingAllowed';
import { useAuth } from '@/lib/AuthContext';
import { setPostLoginRedirect } from '@/lib/postLoginRedirect';
import {
  applyXpImportToShots,
  buildThirdPartyShotExportRows,
  buildThirdPartyShotRecords,
  formatThirdPartyXpImportSummary,
  parseThirdPartyXpCsv,
  serializeThirdPartyRowsToCsv,
  writeThirdPartyXpIssues,
} from '@/lib/thirdPartyXp';
import { createSeededRng, hashSimulationSeed, simulateFullMatchFromShots } from '@/lib/winProbability';

const db = globalThis.__B44_DB__ || {
  entities: new Proxy({}, {
    get: () => ({
      filter: async () => [],
      get: async () => null,
      update: async () => ({}),
      delete: async () => ({}),
    }),
  }),
};

const MATCH_SECTION_ORDER = ['first', 'second', 'et_first', 'et_second'];
const REPORT_TAB_OPTIONS = [
  { value: 'summary', label: 'Overview' },
  { value: 'scoring', label: 'Shooting' },
  { value: 'possessions', label: 'Possessions' },
  { value: 'build_up', label: 'Build-Up' },
  { value: 'kickouts', label: 'Restarts' },
  { value: 'defense', label: 'Defense' },
  { value: 'players_ana', label: 'Players' },
  { value: 'video', label: 'Video' },
];

function getSectionBoundaryLabel(half) {
  if (half === 'first') return 'HT';
  if (half === 'second') return 'FT';
  if (half === 'et_first') return 'ET HT';
  return '';
}

function countMeaningfulSelect(value, ignored = ['all', 'any', 'both']) {
  if (value == null) return 0;
  return ignored.includes(String(value)) ? 0 : 1;
}

function countMeaningfulArray(values = []) {
  return Array.isArray(values) ? values.length : 0;
}

function buildFilterButtonLabel(count) {
  return count > 0 ? `Filters (${count})` : 'Filters';
}

function safeShotArcFilePart(value, fallback = 'team') {
  const text = String(value || fallback).trim().toLowerCase();
  return (text.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || fallback).slice(0, 80);
}

function clampColorChannel(value) {
  return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
}

function parseHexColor(value) {
  const text = String(value || '').trim().replace('#', '');
  if (!text) return null;
  const normalized = text.length === 3
    ? text.split('').map((char) => `${char}${char}`).join('')
    : text;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  const parsed = Number.parseInt(normalized, 16);
  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255,
  };
}

function mixRgb(a, b, ratio = 0.5) {
  const t = Math.max(0, Math.min(1, Number(ratio) || 0));
  return {
    r: clampColorChannel((a?.r || 0) + (((b?.r || 0) - (a?.r || 0)) * t)),
    g: clampColorChannel((a?.g || 0) + (((b?.g || 0) - (a?.g || 0)) * t)),
    b: clampColorChannel((a?.b || 0) + (((b?.b || 0) - (a?.b || 0)) * t)),
  };
}

function getRgbLuminance(rgb) {
  if (!rgb) return 0;
  const linear = [rgb.r, rgb.g, rgb.b].map((channel) => {
    const scaled = channel / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
}

function rgbaString(rgb, alpha = 1) {
  const safeAlpha = Math.max(0, Math.min(1, Number(alpha) || 0));
  return `rgba(${clampColorChannel(rgb?.r)}, ${clampColorChannel(rgb?.g)}, ${clampColorChannel(rgb?.b)}, ${safeAlpha})`;
}

function createAmbientTeamColor(input, fallbackHex) {
  const fallback = parseHexColor(fallbackHex) || { r: 100, g: 116, b: 139 };
  let base = parseHexColor(input) || fallback;
  base = mixRgb(base, { r: 226, g: 232, b: 240 }, 0.16);
  const luminance = getRgbLuminance(base);
  if (luminance > 0.76) {
    base = mixRgb(base, { r: 71, g: 85, b: 105 }, 0.26);
  } else if (luminance < 0.14) {
    base = mixRgb(base, { r: 241, g: 245, b: 249 }, 0.24);
  }
  return base;
}

function getImportedShotXpValue(stat, overrideValue = NaN) {
  if (Number.isFinite(Number(overrideValue))) return Number(overrideValue);
  const extra = safeParseJSON(stat?.extra_data || '{}', {});
  const xp = Number(extra?.shot?.xp?.value ?? extra?.shot?.xp ?? NaN);
  return Number.isFinite(xp) ? xp : NaN;
}

function buildStoredShotWinProbabilitySim(shotRecords = [], xpOverrides = new Map()) {
  const simulationShots = (Array.isArray(shotRecords) ? shotRecords : [])
    .map((record) => {
      const stat = record?.stat || null;
      const xp = getImportedShotXpValue(stat, xpOverrides.get(record?.id));
      if (!Number.isFinite(xp)) return null;
      return {
        key: record?.id || `${record?.teamSide || 'home'}-${record?.shotTypeKey || 'point'}-${xp}`,
        team_side: record?.teamSide === 'away' ? 'away' : 'home',
        shotType: record?.shotTypeKey || 'point',
        xp,
      };
    })
    .filter(Boolean);

  if (!simulationShots.length) return null;

  const seed = hashSimulationSeed({
    source: 'third_party_import',
    shots: simulationShots.map((shot) => [shot.key, shot.team_side, shot.shotType, Number(shot.xp).toFixed(4)]),
  });
  return {
    ...simulateFullMatchFromShots(simulationShots, 10000, createSeededRng(seed)),
    shotCount: simulationShots.length,
    seed,
    source: 'third_party_import',
    generatedAt: new Date().toISOString(),
  };
}

function buildSectionDisplayLayout(stats, match, imputedTimeById) {
  const sectionStats = MATCH_SECTION_ORDER.map((half) => {
    const rows = (Array.isArray(stats) ? stats : []).filter((stat) => stat?.half === half);
    const times = rows
      .map((stat) => getNormalizedTimeS(stat, imputedTimeById))
      .filter(Number.isFinite);
    const periodEndTimes = rows
      .filter((stat) => stat?.stat_type === 'period_end')
      .map((stat) => getNormalizedTimeS(stat, imputedTimeById))
      .filter(Number.isFinite);
    const lastLiveOrLoggedTime = times.length ? Math.max(...times) : 0;
    const boundaryTime = periodEndTimes.length
      ? Math.max(Math.max(...periodEndTimes), lastLiveOrLoggedTime)
      : lastLiveOrLoggedTime;
    return {
      half,
      rows,
      hasData: times.length > 0,
      extent: lastLiveOrLoggedTime,
      boundaryTime,
    };
  }).filter((section) => section.hasData);

  if (!sectionStats.length) {
    return {
      axisMax: 5 * 60,
      ticks: [0, 5 * 60],
      boundaryMarkers: [],
      formatTick: () => '00:00',
      getDisplayTimeForStat: () => null,
    };
  }

  let runningOffset = 0;
  const sections = sectionStats.map((section) => {
    const next = {
      ...section,
      offset: runningOffset,
    };
    runningOffset += section.boundaryTime;
    return next;
  });

  const axisMax = Math.max(5 * 60, sections[sections.length - 1].offset + sections[sections.length - 1].boundaryTime);
  const ticks = Array.from(new Set(sections.flatMap((section) => {
    const values = [section.offset];
    for (let local = 10 * 60; local < section.boundaryTime; local += 10 * 60) {
      values.push(section.offset + local);
    }
    values.push(section.offset + section.boundaryTime);
    return values;
  })))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= axisMax)
    .sort((a, b) => a - b);

  const boundaryMarkers = sections
    .map((section, index) => {
      const label = getSectionBoundaryLabel(section.half);
      if (!label) return null;
      const hasNextSection = index < sections.length - 1;
      if (!hasNextSection && section.boundaryTime <= 0) return null;
      return {
        key: `${section.half}-boundary`,
        label,
        x: section.offset + section.boundaryTime,
      };
    })
    .filter(Boolean);

  const findSectionForDisplayTime = (displayTimeS) => {
    const value = Math.max(0, Number(displayTimeS) || 0);
    for (const section of sections) {
      const start = section.offset;
      const end = section.offset + section.boundaryTime;
      if (value >= start && value <= end) return section;
    }
    return sections[sections.length - 1];
  };

  return {
    axisMax,
    ticks,
    boundaryMarkers,
    getSectionStartForDisplayTime: (displayTimeS) => {
      const section = findSectionForDisplayTime(displayTimeS);
      return Number(section?.offset || 0);
    },
    formatTick: (displayTimeS) => {
      const section = findSectionForDisplayTime(displayTimeS);
      const exactBoundary = sections.find((entry) => Math.abs(Number(displayTimeS) - (entry.offset + entry.boundaryTime)) < 0.5);
      const boundaryLabel = getSectionBoundaryLabel(exactBoundary?.half);
      if (boundaryLabel) return boundaryLabel;
      const localTime = Math.max(0, Number(displayTimeS) - Number(section?.offset || 0));
      return formatHalfClock(localTime, section?.half, match);
    },
    getDisplayTimeForStat: (stat) => {
      const normalized = getNormalizedTimeS(stat, imputedTimeById);
      if (!Number.isFinite(normalized)) return null;
      const section = sections.find((entry) => entry.half === stat?.half);
      if (!section) return normalized;
      return section.offset + normalized;
    },
  };
}
function getSharedPayloadData(sharedPayload) {
  const payload = sharedPayload || {};
  const match = payload?.match || null;
  const teams = Array.isArray(payload?.teams) ? payload.teams : [];
  const players = Array.isArray(payload?.players) ? payload.players : [];
  const rawStats = Array.isArray(payload?.stats) ? payload.stats : [];
  const matchupStints = Array.isArray(payload?.matchup_stints) ? payload.matchup_stints : [];
  const highlightReels = Array.isArray(payload?.highlight_reels) ? payload.highlight_reels : [];
  const highlightReelClips = Array.isArray(payload?.highlight_reel_clips) ? payload.highlight_reel_clips : [];
  const videoNotes = Array.isArray(payload?.video_notes) ? payload.video_notes : [];
  const homeTeam = teams.find((team) => team?.id === match?.home_team_id) || teams[0] || null;
  const awayTeam = teams.find((team) => team?.id === match?.away_team_id) || teams[1] || null;
  const homePlayers = players.filter((player) => player?.team_id === homeTeam?.id);
  const awayPlayers = players.filter((player) => player?.team_id === awayTeam?.id);
  return { match, homeTeam, awayTeam, homePlayers, awayPlayers, rawStats, matchupStints, highlightReels, highlightReelClips, videoNotes };
}

function formatRestartFilterPlayerLabel(player) {
  const normalized = normalizePlayerRef(player);
  if (!normalized) return 'Unknown';
  const prefix = normalized.team_side === 'away' ? 'Away' : 'Home';
  const bits = [];
  if (normalized.number != null && String(normalized.number) !== '') bits.push(`#${normalized.number}`);
  if (normalized.name) bits.push(normalized.name);
  return `${prefix}: ${bits.join(' ').trim() || 'Player'}`;
}

function sortRestartFilterOptions(options) {
  const sideOrder = { home: 0, away: 1 };
  return (Array.isArray(options) ? options.slice() : []).sort((a, b) => {
    const sideCmp = (sideOrder[a.team_side] ?? 99) - (sideOrder[b.team_side] ?? 99);
    if (sideCmp !== 0) return sideCmp;
    const aNum = Number(a.number);
    const bNum = Number(b.number);
    const aHas = Number.isFinite(aNum);
    const bHas = Number.isFinite(bNum);
    if (aHas && bHas && aNum !== bNum) return aNum - bNum;
    if (aHas !== bHas) return aHas ? -1 : 1;
    return String(a.label || '').localeCompare(String(b.label || ''), undefined, { numeric: true, sensitivity: 'base' });
  });
}

export default function MatchReport({ sharedPayload = null, statShareCode = '', readOnly = false }) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const urlParams = new URLSearchParams(location?.search || '');
  const isSharedView = !!sharedPayload;
  const sharedData = useMemo(() => getSharedPayloadData(sharedPayload), [sharedPayload]);
  const matchId = isSharedView ? (sharedData?.match?.id || `shared:${statShareCode || 'snapshot'}`) : urlParams.get('id');
  const [shareOpen, setShareOpen] = useState(false);
  const [gameShareCode, setGameShareCode] = useState('');
  const [statViewShareCode, setStatViewShareCode] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [playerProfileOpen, setPlayerProfileOpen] = useState(false);
  const [selectedPlayerProfile, setSelectedPlayerProfile] = useState(null);
  const [matchupEditorState, setMatchupEditorState] = useState({ open: false, defenderKey: null });
  const [shotArcInfoOpen, setShotArcInfoOpen] = useState(false);
  const shotArcImportInputRef = useRef(null);

  const { data: matchArr = [] } = useQuery({
    queryKey: ['match', matchId],
    queryFn: () => db.entities.Match.filter({ id: matchId }),
    enabled: !!matchId && !isSharedView,
  });

  const match = isSharedView ? sharedData.match : (matchArr?.[0] || null);
  const { data: homeTeamArr = [] } = useQuery({
    queryKey: ['team', match?.home_team_id],
    queryFn: () => db.entities.Team.filter({ id: match?.home_team_id }),
    enabled: !!match?.home_team_id && !isSharedView,
  });

  const { data: awayTeamArr = [] } = useQuery({
    queryKey: ['team', match?.away_team_id],
    queryFn: () => db.entities.Team.filter({ id: match?.away_team_id }),
    enabled: !!match?.away_team_id && !isSharedView,
  });

  const homeTeam = isSharedView ? sharedData.homeTeam : (homeTeamArr?.[0] || null);
  const awayTeam = isSharedView ? sharedData.awayTeam : (awayTeamArr?.[0] || null);

  const { data: homePlayers = [] } = useQuery({
    queryKey: ['players', 'home', match?.home_team_id],
    queryFn: () => db.entities.Player.filter({ team_id: match?.home_team_id }),
    enabled: !!match?.home_team_id && !isSharedView,
  });

  const { data: awayPlayers = [] } = useQuery({
    queryKey: ['players', 'away', match?.away_team_id],
    queryFn: () => db.entities.Player.filter({ team_id: match?.away_team_id }),
    enabled: !!match?.away_team_id && !isSharedView,
  });

  const { data: rawStats = [] } = useQuery({
    queryKey: ['stats', matchId],
    queryFn: () => db.entities.StatEntry.filter({ match_id: matchId }),
    enabled: !!matchId && !isSharedView,
  });
  const { data: matchupStintRows = [] } = useQuery({
    queryKey: ['matchup-stints', matchId],
    queryFn: () => db.entities.MatchupStint.filter({ match_id: matchId }),
    enabled: !!matchId && !isSharedView,
  });
  useEffect(() => {
    setGameShareCode(match?.latest_game_share_code || match?.latest_share_code || '');
    setStatViewShareCode(match?.latest_stat_share_code || '');
  }, [match?.latest_game_share_code, match?.latest_share_code, match?.latest_stat_share_code]);

  const effectiveHomePlayers = isSharedView ? (sharedData.homePlayers || []) : homePlayers;
  const effectiveAwayPlayers = isSharedView ? (sharedData.awayPlayers || []) : awayPlayers;

  const defenceSetMigrationKey = matchId ? `gstl-defence-set:${DEFENCE_SET_MIGRATION_VERSION}:${matchId}` : null;
  const readDefenceSetMigrationDone = (key) => {
    try {
      return !!key && localStorage.getItem(key) === 'done';
    } catch {
      return false;
    }
  };
  const [defenceSetMigrationDone, setDefenceSetMigrationDone] = useState(() => readDefenceSetMigrationDone(defenceSetMigrationKey));
  const statModelMigrationKey = matchId ? `gstl-stat-model:${STAT_MODEL_MIGRATION_VERSION}:${matchId}` : null;
  const readStatModelMigrationDone = (key) => {
    try {
      return !!key && localStorage.getItem(key) === 'done';
    } catch {
      return false;
    }
  };
  const [statModelMigrationDone, setStatModelMigrationDone] = useState(() => readStatModelMigrationDone(statModelMigrationKey));

  useEffect(() => {
    if (isSharedView || !match?.id) return;
    const stored = Number(match.match_length_minutes);
    if (Number.isFinite(stored) && stored > 0) return;
    const expected = deriveMatchLengthMinutes(match);
    db.entities.Match.update(match.id, { match_length_minutes: expected })
      .then(() => queryClient.invalidateQueries({ queryKey: ['match', matchId] }))
      .catch(() => {});
  }, [isSharedView, match?.id, match?.code, match?.level, match?.match_length_minutes, matchId, queryClient]);

  useEffect(() => {
    setDefenceSetMigrationDone(readDefenceSetMigrationDone(defenceSetMigrationKey));
  }, [defenceSetMigrationKey]);

  useEffect(() => {
    setStatModelMigrationDone(readStatModelMigrationDone(statModelMigrationKey));
  }, [statModelMigrationKey]);

  const effectiveRawStats = isSharedView ? sharedData.rawStats : rawStats;
  const stats = useMemo(
    () => rebuildPossessionRows(normalizeStatModelRows(normalizeDefenceSetRows((effectiveRawStats || []).filter((s) => s?.stat_type !== 'defensive_contact'), defenceSetMigrationDone), statModelMigrationDone)),
    [effectiveRawStats, defenceSetMigrationDone, statModelMigrationDone]
  );

  const [repairingLegacyPossessions, setRepairingLegacyPossessions] = useState(false);
  const [migratingDefenceSet, setMigratingDefenceSet] = useState(false);
  const [migratingStatModel, setMigratingStatModel] = useState(false);
  const [deletingLegacyDefContact, setDeletingLegacyDefContact] = useState(false);

  useEffect(() => {
    if (isSharedView || !matchId || !Array.isArray(rawStats) || !rawStats.length || deletingLegacyDefContact) return;
    const deletes = buildLegacyDefensiveContactDeletes(rawStats).filter((row) => row?.id);
    if (!deletes.length) return;
    let cancelled = false;
    (async () => {
      try {
        setDeletingLegacyDefContact(true);
        for (const row of deletes) {
          if (cancelled) return;
          await db.entities.StatEntry.delete(row.id);
          if (row.server_stat_id) {
            try { await softDeleteServerStat(row.server_stat_id); } catch {}
          }
        }
        if (!cancelled) {
          await queryClient.invalidateQueries({ queryKey: ['stats', matchId] });
          await queryClient.refetchQueries({ queryKey: ['stats', matchId], type: 'active' });
        }
      } finally {
        if (!cancelled) setDeletingLegacyDefContact(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isSharedView, matchId, rawStats, deletingLegacyDefContact, queryClient]);

  useEffect(() => {
    if (isSharedView || !matchId || !Array.isArray(rawStats) || !rawStats.length || migratingStatModel) return;
    if (!statModelMigrationKey) return;
    const repairs = buildStatModelRepairs(rawStats);
    if (!repairs.length) {
      try { localStorage.setItem(statModelMigrationKey, 'done'); } catch {}
      setStatModelMigrationDone(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setMigratingStatModel(true);
        for (const repair of repairs) {
          if (cancelled) return;
          const current = rawStats.find((s) => s.id === repair.id);
          await db.entities.StatEntry.update(repair.id, repair.data);
          if (current?.server_stat_id) {
            try { await updateServerStat(current.server_stat_id, repair.data); } catch {}
          }
        }
        if (!cancelled) {
          await queryClient.invalidateQueries({ queryKey: ['stats', matchId] });
          await queryClient.refetchQueries({ queryKey: ['stats', matchId], type: 'active' });
          try { localStorage.setItem(statModelMigrationKey, 'done'); } catch {}
          setStatModelMigrationDone(true);
        }
      } finally {
        if (!cancelled) setMigratingStatModel(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isSharedView, matchId, rawStats, migratingStatModel, queryClient, statModelMigrationKey]);

  useEffect(() => {
    if (isSharedView || !matchId || !Array.isArray(rawStats) || !rawStats.length || migratingDefenceSet) return;
    if (!defenceSetMigrationKey) return;
    const repairs = buildLegacyDefenceSetRepairs(rawStats);
    if (!repairs.length) {
      try { localStorage.setItem(defenceSetMigrationKey, 'done'); } catch {}
      setDefenceSetMigrationDone(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setMigratingDefenceSet(true);
        for (const repair of repairs) {
          if (cancelled) return;
          const current = rawStats.find((s) => s.id === repair.id);
          await db.entities.StatEntry.update(repair.id, repair.data);
          if (current?.server_stat_id) {
            try { await updateServerStat(current.server_stat_id, repair.data); } catch {}
          }
        }
        if (!cancelled) {
          await queryClient.invalidateQueries({ queryKey: ['stats', matchId] });
          await queryClient.refetchQueries({ queryKey: ['stats', matchId], type: 'active' });
          try { localStorage.setItem(defenceSetMigrationKey, 'done'); } catch {}
          setDefenceSetMigrationDone(true);
        }
      } finally {
        if (!cancelled) setMigratingDefenceSet(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isSharedView, matchId, rawStats, migratingDefenceSet, queryClient, defenceSetMigrationKey]);

  useEffect(() => {
    if (isSharedView || !matchId || !Array.isArray(rawStats) || !rawStats.length || repairingLegacyPossessions) return;
    const rebuildKey = `gstl-possession-rebuild:${POSSESSION_REBUILD_VERSION}:${matchId}`;
    const repairs = buildLegacyPossessionRepairs(rawStats);
    if (!repairs.length) {
      try { localStorage.setItem(rebuildKey, 'done'); } catch {}
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        setRepairingLegacyPossessions(true);
        for (const repair of repairs) {
          if (cancelled) return;
          const current = rawStats.find((s) => s.id === repair.id);
          await db.entities.StatEntry.update(repair.id, repair.data);
          if (current?.server_stat_id) {
            try { await updateServerStat(current.server_stat_id, repair.data); } catch {}
          }
        }
        if (!cancelled) {
          await queryClient.invalidateQueries({ queryKey: ['stats', matchId] });
          await queryClient.refetchQueries({ queryKey: ['stats', matchId], type: 'active' });
          try { localStorage.setItem(rebuildKey, 'done'); } catch {}
        }
      } finally {
        if (!cancelled) setRepairingLegacyPossessions(false);
      }
    })();

    return () => { cancelled = true; };
  }, [isSharedView, matchId, rawStats, repairingLegacyPossessions, queryClient]);

  const imputedTimeById = useMemo(() => computeImputedNormalizedTimes(stats), [stats]);
  const nextStatById = useMemo(() => {
    const ordered = (Array.isArray(stats) ? stats.slice() : []).sort((a, b) => {
      const pa = Number(a?.play_id);
      const pb = Number(b?.play_id);
      if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa - pb;
      const ta = getMatchTimeS(a, match, imputedTimeById);
      const tb = getMatchTimeS(b, match, imputedTimeById);
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
    const out = new Map();
    for (let i = 0; i < ordered.length; i += 1) out.set(ordered[i]?.id, getNextBallActionStat(ordered, i));
    return out;
  }, [stats, match, imputedTimeById]);

  const playerOptions = useMemo(() => {
    const all = [
      ...(effectiveHomePlayers || []).map((p) => ({ ...p, team_side: 'home' })),
      ...(effectiveAwayPlayers || []).map((p) => ({ ...p, team_side: 'away' })),
    ];
    const label = (p) => `#${p.number || ''} ${p.name || ''}`.trim();
    return all
      .slice()
      .sort((a, b) => (a.team_side === b.team_side ? (a.number || 0) - (b.number || 0) : (a.team_side === 'home' ? -1 : 1)))
      .map((p) => ({
        id: p.id,
        team_side: p.team_side,
        label: label(p) || p.id,
        name: p.name || '',
        number: p.number ?? null,
        position: p.position || '',
      }));
  }, [effectiveHomePlayers, effectiveAwayPlayers]);
  const allPlayersForShare = useMemo(() => [...(effectiveHomePlayers || []), ...(effectiveAwayPlayers || [])], [effectiveHomePlayers, effectiveAwayPlayers]);
  const thirdPartyShotTeams = useMemo(() => ({ homeTeam, awayTeam }), [homeTeam, awayTeam]);
  const playerTimeAndPossessionStats = useMemo(
    () => buildPlayerTimeAndPossessionStats({ match, stats, playerOptions, homeTeam, awayTeam }),
    [awayTeam, homeTeam, match, playerOptions, stats],
  );
  const matchupPeriodMaxSecondsByKey = useMemo(
    () => buildMatchupPeriodMaxSeconds({ stats, match, imputedTimeById }),
    [imputedTimeById, match, stats],
  );
  const effectiveMatchupStints = useMemo(() => {
    if (isSharedView) return sharedData.matchupStints || [];
    return buildEffectiveMatchupStints({
      match,
      stats,
      matchupStints: matchupStintRows,
      playerOptions,
      playerTimeAndPossessionStats,
      imputedTimeById,
    });
  }, [imputedTimeById, isSharedView, match, matchupStintRows, playerOptions, playerTimeAndPossessionStats, sharedData.matchupStints, stats]);
  const rawStatsForPlayerProfile = isSharedView ? (sharedData.rawStats || []) : rawStats;
  const matchupStintsForPlayerProfile = effectiveMatchupStints;
  const selectedPlayerProfileOption = useMemo(() => {
    if (!selectedPlayerProfile?.id || !selectedPlayerProfile?.team) return null;
    return playerOptions.find((player) => (
      String(player.id) === String(selectedPlayerProfile.id)
      && String(player.team_side) === String(selectedPlayerProfile.team)
    )) || null;
  }, [playerOptions, selectedPlayerProfile]);
  const openMatchupEditor = (defenderKey = null) => {
    if (readOnly) return;
    setMatchupEditorState({ open: true, defenderKey: defenderKey || null });
  };
  const closeMatchupEditor = (open) => {
    if (open) return;
    setMatchupEditorState({ open: false, defenderKey: null });
  };

  const ensureMatchupSyncIdentity = async () => {
    if (!match || readOnly || !isAuthenticated) return { serverMatchId: match?.server_match_id || null, playerRefByLocalId: {} };
    const currentHomeTeam = homeTeam?.id ? (await db.entities.Team.get(homeTeam.id)) || homeTeam : homeTeam;
    const currentAwayTeam = awayTeam?.id ? (await db.entities.Team.get(awayTeam.id)) || awayTeam : awayTeam;
    const homeSync = currentHomeTeam ? await upsertPrivateTeamFromLocal(currentHomeTeam) : null;
    const awaySync = currentAwayTeam ? await upsertPrivateTeamFromLocal(currentAwayTeam) : null;
    if (currentHomeTeam?.id && homeSync?.ok && homeSync?.id && currentHomeTeam?.server_team_id !== homeSync.id) {
      await db.entities.Team.update(currentHomeTeam.id, { server_team_id: homeSync.id });
    }
    if (currentAwayTeam?.id && awaySync?.ok && awaySync?.id && currentAwayTeam?.server_team_id !== awaySync.id) {
      await db.entities.Team.update(currentAwayTeam.id, { server_team_id: awaySync.id });
    }

    const playerRefByLocalId = {};
    for (const player of allPlayersForShare) {
      const localPlayer = player?.id ? (await db.entities.Player.get(player.id)) || player : player;
      const teamServerId = String(localPlayer?.team_id || '') === String(currentHomeTeam?.id || '')
        ? (homeSync?.id || currentHomeTeam?.server_team_id || null)
        : (awaySync?.id || currentAwayTeam?.server_team_id || null);
      const synced = await upsertPrivatePlayerFromLocal(localPlayer, { teamServerId });
      if (synced?.ok && synced?.id && localPlayer?.id) {
        playerRefByLocalId[localPlayer.id] = synced.id;
        if (localPlayer.server_player_id !== synced.id || localPlayer.server_team_id !== teamServerId) {
          await db.entities.Player.update(localPlayer.id, {
            server_player_id: synced.id,
            server_team_id: teamServerId,
          });
        }
      }
    }

    const currentMatch = match?.id ? (await db.entities.Match.get(match.id)) || match : match;
    const ensured = await ensureServerMatch({
      publicMatchId: currentMatch.public_match_id,
      matchDate: currentMatch.date,
      code: currentMatch.code || 'GAA',
      level: currentMatch.level || 'Other',
      windSpeed: currentMatch.wind_speed === '' ? null : currentMatch.wind_speed,
      windDirection: currentMatch.wind_direction === '' ? null : currentMatch.wind_direction,
      mode: currentMatch.mode || 'analysis',
      matchLengthMinutes: currentMatch.match_length_minutes,
      homeTeamRef: homeSync?.id || currentHomeTeam?.server_team_id || null,
      awayTeamRef: awaySync?.id || currentAwayTeam?.server_team_id || null,
    });
    const serverMatchId = ensured?.ok ? ensured.id : currentMatch?.server_match_id || null;
    if (serverMatchId && currentMatch?.id && currentMatch.server_match_id !== serverMatchId) {
      await db.entities.Match.update(currentMatch.id, { server_match_id: serverMatchId });
    }
    return { serverMatchId, playerRefByLocalId };
  };

  const handleCreateMatchupStint = async (payload) => {
    if (!match?.id || readOnly) return;
    const created = await db.entities.MatchupStint.create({
      ...payload,
      match_id: match.id,
      server_match_id: match.server_match_id || null,
      server_matchup_stint_id: null,
    });
    try {
      if (isAuthenticated) {
        const { serverMatchId, playerRefByLocalId } = await ensureMatchupSyncIdentity();
        const synced = await upsertPrivateMatchupStintFromLocal(created, { serverMatchId, playerRefByLocalId });
        if (synced?.ok && synced?.id) {
          await db.entities.MatchupStint.update(created.id, {
            server_match_id: serverMatchId,
            server_matchup_stint_id: synced.id,
          });
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['matchup-stints', matchId] });
    } catch (error) {
      toast.error(error?.message || 'Failed to save matchup stint');
    }
  };

  const handleUpdateMatchupStint = async (stintId, payload) => {
    if (!stintId || readOnly) return;
    const current = await db.entities.MatchupStint.get(stintId);
    if (!current?.id) return;
    await db.entities.MatchupStint.update(stintId, {
      ...payload,
      server_match_id: current.server_match_id || match?.server_match_id || null,
    });
    try {
      if (isAuthenticated) {
        const refreshed = (await db.entities.MatchupStint.get(stintId)) || { ...current, ...payload };
        const { serverMatchId, playerRefByLocalId } = await ensureMatchupSyncIdentity();
        const synced = await upsertPrivateMatchupStintFromLocal(refreshed, { serverMatchId, playerRefByLocalId });
        if (synced?.ok && synced?.id) {
          await db.entities.MatchupStint.update(stintId, {
            server_match_id: serverMatchId,
            server_matchup_stint_id: synced.id,
          });
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['matchup-stints', matchId] });
    } catch (error) {
      toast.error(error?.message || 'Failed to update matchup stint');
    }
  };

  const handleDeleteMatchupStint = async (stintId) => {
    if (!stintId || readOnly) return;
    const current = await db.entities.MatchupStint.get(stintId);
    if (!current?.id) return;
    await db.entities.MatchupStint.delete(stintId);
    try {
      if (isAuthenticated && current.server_matchup_stint_id) {
        await softDeletePrivateMatchupStint(current.server_matchup_stint_id);
      }
      await queryClient.invalidateQueries({ queryKey: ['matchup-stints', matchId] });
    } catch (error) {
      toast.error(error?.message || 'Failed to delete matchup stint');
    }
  };
  const handleShotArcExport = () => {
    if (!match) {
      toast.error('Match data is not ready yet');
      return;
    }
    const rows = buildThirdPartyShotExportRows(stats, match, thirdPartyShotTeams, playerOptions, imputedTimeById);
    if (!rows.length) {
      toast.error('No shot rows available to export');
      return;
    }

    const csv = serializeThirdPartyRowsToCsv(rows);
    const firstLine = String(csv || '').split(/\r?\n/, 1)[0] || '';
    if (!firstLine.startsWith('"Team"')) {
      toast.error('ShotArc export header validation failed');
      return;
    }
    const homePart = safeShotArcFilePart(homeTeam?.name, 'home');
    const awayPart = safeShotArcFilePart(awayTeam?.name, 'away');
    const fileName = `${homePart}_${awayPart}_gaeliq.csv`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast.success(`ShotArc export ready (${rows.length} shot${rows.length === 1 ? '' : 's'})`);
  };

  const handleShotArcImportClick = () => {
    if (readOnly || isSharedView) {
      toast.error('xP import is only available on your editable private match copy');
      return;
    }
    shotArcImportInputRef.current?.click();
  };

  const toggleShotArcInfo = () => {
    setShotArcInfoOpen((current) => !current);
  };

  const handleShotArcImportChange = async (event) => {
    const file = event?.target?.files?.[0];
    if (!file) return;

    try {
      if (!match) throw new Error('Match data is not ready yet');
      const text = await file.text();
      const parsed = parseThirdPartyXpCsv(text);
      if (!parsed.rows.length) throw new Error('No xP rows found in the selected CSV');

      const shotRecords = buildThirdPartyShotRecords(stats, match, thirdPartyShotTeams, playerOptions, imputedTimeById)
        .filter((record) => !record.broughtBackAdv);
      if (!shotRecords.length) throw new Error('No shot rows available to match against');

      const rawStatsById = new Map((Array.isArray(rawStats) ? rawStats : []).map((stat) => [stat?.id, stat]));
      const summary = await applyXpImportToShots(parsed.rows, shotRecords, rawStatsById, {
        uploadedAt: new Date().toISOString(),
        updateLocalShot: (id, patch) => db.entities.StatEntry.update(id, patch),
        updateServerShot: (serverStatId, patch) => updateServerStat(serverStatId, patch),
      });
      const xpOverrides = new Map(
        (summary.updates || []).map((update) => {
          const extra = safeParseJSON(update?.patch?.extra_data || '{}', {});
          return [update?.id, Number(extra?.shot?.xp?.value ?? NaN)];
        }),
      );
      const storedShotWinProbabilitySim = buildStoredShotWinProbabilitySim(shotRecords, xpOverrides);
      if (storedShotWinProbabilitySim) {
        await db.entities.Match.update(match.id, {
          shot_win_probability_sim: JSON.stringify(storedShotWinProbabilitySim),
        });
      }

      writeThirdPartyXpIssues(matchId, summary.issues);
      await queryClient.invalidateQueries({ queryKey: ['match', matchId] });
      await queryClient.invalidateQueries({ queryKey: ['stats', matchId] });
      await queryClient.refetchQueries({ queryKey: ['stats', matchId], type: 'active' });
      toast.success(`xP import complete: ${formatThirdPartyXpImportSummary(summary)}`);
    } catch (error) {
      toast.error(error?.message || 'Failed to import xP CSV');
    } finally {
      if (event?.target) event.target.value = '';
    }
  };
  const openPlayerProfile = (row) => {
    if (!row?.id || !row?.team) return;
    setSelectedPlayerProfile(row);
    setPlayerProfileOpen(true);
  };
  const handleCreateShareCode = async (shareType) => {
    if (!isAuthenticated) {
      toast.error('Sign in to create a share code');
      return;
    }
    if (!match || !homeTeam || !awayTeam) {
      toast.error('Match data is not ready yet');
      return;
    }
    try {
      setShareBusy(true);
      const [highlightReels, highlightReelClips, publicVideoNotes] = await Promise.all([
        db.entities.HighlightReel.filter({ match_id: match.id }),
        db.entities.HighlightReelClip.filter({ match_id: match.id }),
        db.entities.VideoNote.filter({ match_id: match.id, visibility: 'public' }),
      ]);
      const result = await createSharedMatchSnapshot({
        match,
        homeTeam,
        awayTeam,
        players: allPlayersForShare,
        stats,
        matchupStints: effectiveMatchupStints,
        highlightReels,
        highlightReelClips,
        publicVideoNotes,
        shareType,
      });
      if (!result?.ok) throw new Error(result?.reason || 'Failed to create share code');
      if (shareType === 'stat_view') setStatViewShareCode(result.shareCode || '');
      else setGameShareCode(result.shareCode || '');
      await db.entities.Match.update(match.id, {
        ...(shareType === 'stat_view'
          ? { latest_stat_share_code: result.shareCode || '', latest_stat_shared_snapshot_id: result.snapshotId || null }
          : {
              latest_game_share_code: result.shareCode || '',
              latest_shared_snapshot_id: result.snapshotId || null,
              latest_share_code: result.shareCode || '',
            }),
      });
      toast.success(
        shareType === 'stat_view'
          ? (result?.reused ? 'Stat share refreshed' : 'Stat share code created')
          : (result?.reused ? 'Game share refreshed' : 'Game share code created'),
      );
    } catch (error) {
      toast.error(error?.message || 'Failed to create share code');
    } finally {
      setShareBusy(false);
    }
  };
  const handleCopyShareCode = async (value) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Share code copied');
    } catch {
      toast.error('Could not copy share code');
    }
  };

  const reportState = useReportFilterState({ stats, match, imputedTimeById });
  const {
    activeTab,
    setActiveTab,
    topFiltersOpen,
    setTopFiltersOpen,
    overviewHalf,
    setOverviewHalf,
    reportFilters,
    scoringShotType,
    setScoringShotType,
    scoringSituation,
    setScoringSituation,
    scoringPressure,
    setScoringPressure,
    scoringMethod,
    setScoringMethod,
    scoringAttackType,
    setScoringAttackType,
    possessionsAttackTypeFilter,
    setPossessionsAttackTypeFilter,
    possessionsOutcomeFilter,
    setPossessionsOutcomeFilter,
    possessionsOriginFilter,
    setPossessionsOriginFilter,
    possessionsStartZoneFilter,
    setPossessionsStartZoneFilter,
    buildEventTypes,
    setBuildEventTypes,
    buildPressure,
    setBuildPressure,
    buildOutcome,
    setBuildOutcome,
    buildProgressiveOnly,
    setBuildProgressiveOnly,
    buildPnSide,
    setBuildPnSide,
    buildPnMin,
    setBuildPnMin,
    buildPnHalf,
    setBuildPnHalf,
    defenseEventCategory,
    setDefenseEventCategory,
    defenseTurnoverResult,
    setDefenseTurnoverResult,
    defenseTurnoverTypes,
    setDefenseTurnoverTypes,
    defenseDefTypes,
    setDefenseDefTypes,
    playersFocusPlayerId,
    setPlayersFocusPlayerId,
    showTopFiltersButton,
    resetAllFilters,
  } = reportState;

  const [mobileTabsOpen, setMobileTabsOpen] = useState(false);
  const [restartTargetFilter, setRestartTargetFilter] = useState([]);
  const [restartWonByFilter, setRestartWonByFilter] = useState([]);
  const [restartLengthFilter, setRestartLengthFilter] = useState([]);
  const [restartSideFilter, setRestartSideFilter] = useState([]);
  const showStickyFiltersButton = showTopFiltersButton && activeTab !== 'summary' && activeTab !== 'video';
  const activeTopFilterCount = useMemo(() => {
    const baseCount =
      countMeaningfulSelect(reportFilters.team)
      + countMeaningfulArray(reportFilters.halves)
      + countMeaningfulArray(reportFilters.playerIds)
      + countMeaningfulArray(reportFilters.actionTypes)
      + countMeaningfulArray(reportFilters.outcomes)
      + countMeaningfulSelect(reportFilters.timeMin, [''])
      + countMeaningfulSelect(reportFilters.timeMax, ['']);

    if (activeTab === 'scoring') {
      return baseCount
        + countMeaningfulArray(scoringShotType)
        + countMeaningfulArray(scoringSituation)
        + countMeaningfulArray(scoringPressure)
        + countMeaningfulArray(scoringMethod)
        + countMeaningfulSelect(scoringAttackType);
    }
    if (activeTab === 'possessions') {
      return baseCount
        + countMeaningfulArray(possessionsOutcomeFilter)
        + countMeaningfulArray(possessionsOriginFilter)
        + countMeaningfulArray(possessionsStartZoneFilter)
        + countMeaningfulSelect(possessionsAttackTypeFilter);
    }
    if (activeTab === 'build_up') {
      return baseCount
        + countMeaningfulArray(buildEventTypes)
        + countMeaningfulArray(buildPressure)
        + countMeaningfulArray(buildOutcome)
        + (buildProgressiveOnly ? 1 : 0);
    }
    if (activeTab === 'kickouts') {
      return baseCount
        + countMeaningfulArray(restartTargetFilter)
        + countMeaningfulArray(restartWonByFilter)
        + countMeaningfulArray(restartLengthFilter)
        + countMeaningfulArray(restartSideFilter);
    }
    if (activeTab === 'defense') {
      return baseCount
        + countMeaningfulSelect(defenseTurnoverResult)
        + countMeaningfulArray(defenseTurnoverTypes)
        + countMeaningfulArray(defenseDefTypes)
        + countMeaningfulSelect(defenseEventCategory);
    }
    if (activeTab === 'players_ana') {
      return baseCount + countMeaningfulSelect(playersFocusPlayerId);
    }
    return baseCount;
  }, [
    activeTab,
    reportFilters.team,
    reportFilters.halves,
    reportFilters.playerIds,
    reportFilters.actionTypes,
    reportFilters.outcomes,
    reportFilters.timeMin,
    reportFilters.timeMax,
    scoringShotType,
    scoringSituation,
    scoringPressure,
    scoringMethod,
    scoringAttackType,
    possessionsOutcomeFilter,
    possessionsOriginFilter,
    possessionsStartZoneFilter,
    possessionsAttackTypeFilter,
    buildEventTypes,
    buildPressure,
    buildOutcome,
    buildProgressiveOnly,
    restartTargetFilter,
    restartWonByFilter,
    restartLengthFilter,
    restartSideFilter,
    defenseTurnoverResult,
    defenseTurnoverTypes,
    defenseDefTypes,
    defenseEventCategory,
    playersFocusPlayerId,
  ]);

  useEffect(() => {
    if (activeTab === 'data') setActiveTab('video');
    if (activeTab === 'visualiser') setActiveTab('video');
  }, [activeTab, setActiveTab]);

  const { overviewStats, filteredForReport } = useFilteredReportStats({
    stats,
    overviewHalf,
    reportFilters,
    match,
    imputedTimeById,
  });

  const { filteredForReport: filteredForScoring } = useFilteredReportStats({
    stats,
    overviewHalf,
    reportFilters: { ...reportFilters, playerIds: [] },
    match,
    imputedTimeById,
  });

  const { filteredForReport: filteredForScoringWp } = useFilteredReportStats({
    stats,
    overviewHalf,
    reportFilters: { ...reportFilters, team: 'both', playerIds: [] },
    match,
    imputedTimeById,
  });

  const restartTargetOptions = useMemo(() => {
    const rows = new Map();
    (Array.isArray(stats) ? stats : []).forEach((stat) => {
      if (stat?.stat_type !== 'kickout') return;
      const extra = safeParseJSON(stat.extra_data || '{}', {});
      const target = extra?.kickout?.intended_recipient;
      const normalized = normalizePlayerRef(target);
      const key = normalized?.id ? String(normalized.id) : String(target?.kind || 'unknown');
      if (!key || rows.has(key)) return;
      if (normalized?.id) {
        rows.set(key, {
          value: key,
          label: formatRestartFilterPlayerLabel(normalized),
          team_side: normalized.team_side,
          number: normalized.number,
        });
      } else {
        rows.set(key, {
          value: key,
          label: formatExtraValue(target) || 'Unknown',
          team_side: 'zz_other',
          number: null,
        });
      }
    });
    return sortRestartFilterOptions(Array.from(rows.values()));
  }, [stats]);

  const restartWonByOptions = useMemo(() => {
    const rows = new Map();
    (Array.isArray(stats) ? stats : []).forEach((stat) => {
      if (stat?.stat_type !== 'kickout') return;
      const extra = safeParseJSON(stat.extra_data || '{}', {});
      const wonBy = normalizePlayerRef(extra?.kickout?.won_by);
      if (!wonBy?.id) return;
      const key = String(wonBy.id);
      if (rows.has(key)) return;
      rows.set(key, {
        value: key,
        label: formatRestartFilterPlayerLabel(wonBy),
        team_side: wonBy.team_side,
        number: wonBy.number,
      });
    });
    return [
      { value: 'team:home', label: homeTeam?.name || 'Home', team_side: 'home', number: -2 },
      { value: 'team:away', label: awayTeam?.name || 'Away', team_side: 'away', number: -1 },
      ...sortRestartFilterOptions(Array.from(rows.values())),
    ];
  }, [stats, homeTeam, awayTeam]);

  const {
    sharedVizOpen,
    setSharedVizOpen,
    sharedVizTitle,
    sharedVizStats,
    openPossessionVisualiser,
    openSharedVideoAt,
    openSharedVideoSelection,
    openSharedVideoPossession,
    preRollSeconds: SHARED_VIZ_PRE_ROLL_S,
  } = usePossessionVisualiser({ match, matchId, homeTeam, awayTeam });

  const summary = useMemo(() => {
    const empty = {
      shots: 0,
      goals: 0,
      points1: 0,
      points2: 0,
      totalPoints: 0,
      passes: 0,
      turnovers: 0, // lost
      turnoversWon: 0,
      kickoutsTaken: 0,
      kickoutsWon: 0,
      ownKickoutsTaken: 0,
      ownKickoutsWon: 0,
      carries: 0,
      takeOnsAttempted: 0,
      takeOnsCompleted: 0,
      defensiveActions: 0,
      possessions: 0,
      attacks: 0,
    };
    const out = { home: { ...empty }, away: { ...empty } };
    const list = Array.isArray(overviewStats) ? overviewStats : [];

    const groupedPossessions = [];
    const groups = groupByPossession(list);
    for (const [key, evs] of groups.entries()) {
      const [teamSide, pidStr] = String(key).split('-');
      const pid = Number(pidStr);
      if ((teamSide !== 'home' && teamSide !== 'away') || !Number.isFinite(pid)) continue;
      const acting = (Array.isArray(evs) ? evs : []).filter((e) => e && e.team_side === teamSide);
      if (!acting.length) continue;
      groupedPossessions.push({
        teamSide,
        possessionId: pid,
        isAttack: possessionHasOpp45Entry(acting),
      });
    }

    for (const s of list) {
      if (!s) continue;
      const side = s.team_side === 'away' ? 'away' : 'home';
      const extra = safeParseJSON(s.extra_data || '{}', {});

      if (s.stat_type === 'shot' && !shouldExcludeFromTotals(s)) {
        out[side].shots += 1;
        const o = extra?.shot?.outcome;
        if (o === 'goal') out[side].goals += 1;
        if (o === 'point') out[side].points1 += 1;
        if (o === '2_point') out[side].points2 += 1;
      }

      if (s.stat_type === 'pass') out[side].passes += 1;
      if (s.stat_type === 'carry') out[side].carries += 1;

      if (s.stat_type === 'carry') {
        const takeOn = String(extra?.carry?.take_on || '');
        if (takeOn === 'completed' || takeOn === 'failed') out[side].takeOnsAttempted += 1;
        if (takeOn === 'completed') out[side].takeOnsCompleted += 1;
      }


      if (s.stat_type === 'kickout') {
        out[side].kickoutsTaken += 1;
        const o = extra?.kickout?.outcome;
        const wonSide = inferRestartWinnerSide(s, nextStatById.get(s.id));
        if ((wonSide === 'home' || wonSide === 'away')) {
          out[wonSide].kickoutsWon += 1;
        }

        // "Own" kickouts: taken by the team that is restarting (extra.kickout.team_side).
        const koTeam = extra?.kickout?.team_side;
        if (koTeam === 'home' || koTeam === 'away') {
          out[koTeam].ownKickoutsTaken += 1;
          if (wonSide === koTeam) out[koTeam].ownKickoutsWon += 1;
        }
      }

      // Turnovers: count as "lost" by the lost_by selection when present.
      const turnover = extra?.turnover;
      if (!shouldExcludeFromTotals(s) && (s.stat_type === 'turnover' || (turnover && typeof turnover === 'object'))) {
        const foul = extractFoulFromStat(s);
        const lostSide =
          turnover?.lost_by?.team_side ||
          foul?.foul_by?.team_side ||
          (side === 'home' || side === 'away' ? side : null);
        const recoveredSide =
          turnover?.recovered_by?.team_side ||
          turnover?.forced_by?.team_side ||
          foul?.foul_on_or_forced_by?.team_side ||
          foul?.foul_on?.team_side ||
          oppositeTeamSide(lostSide);
        if (lostSide === 'home' || lostSide === 'away') {
          out[lostSide].turnovers += 1;
        } else {
          // Fallback: attribute to acting team.
          out[side].turnovers += 1;
        }
        if (recoveredSide === 'home' || recoveredSide === 'away') {
          out[recoveredSide].turnoversWon += 1;
        }
      }
    }

    out.home.totalPoints = out.home.goals * 3 + out.home.points1 + out.home.points2 * 2;
    out.away.totalPoints = out.away.goals * 3 + out.away.points1 + out.away.points2 * 2;

    out.home.possessions = groupedPossessions.filter((p) => p.teamSide === 'home').length;
    out.away.possessions = groupedPossessions.filter((p) => p.teamSide === 'away').length;

    out.home.attacks = groupedPossessions.filter((p) => p.teamSide === 'home' && p.isAttack).length;
    out.away.attacks = groupedPossessions.filter((p) => p.teamSide === 'away' && p.isAttack).length;

    return out;
  }, [overviewStats, nextStatById]);

  const scoreTimeline = useMemo(() => {
    const list = Array.isArray(overviewStats) ? overviewStats : [];
    const displayLayout = buildSectionDisplayLayout(list, match, imputedTimeById);
    const scoring = [];

    for (const s of list) {
      if (!s || s.stat_type !== 'shot') continue;
      if (shouldExcludeFromTotals(s)) continue;
      const extra = safeParseJSON(s.extra_data || '{}', {});
      const o = extra?.shot?.outcome;
      if (!['point', '2_point', 'goal'].includes(o)) continue;
      scoring.push({ s, extra, outcome: o });
    }

    if (!scoring.length) {
      return { mode: 'none', points: [] };
    }

    const allHaveTime = scoring.every((e) => Number.isFinite(displayLayout.getDisplayTimeForStat(e.s)));
    const mode = allHaveTime ? 'time' : 'play';

    const getX = (e) => {
      if (mode === 'time') return Math.max(0, displayLayout.getDisplayTimeForStat(e.s));
      return Number.isFinite(Number(e.s.play_id)) ? Number(e.s.play_id) : 0;
    };

    scoring.sort((a, b) => getX(a) - getX(b));

    let homeTotal = 0, awayTotal = 0;
    let homeGoals = 0, awayGoals = 0;
    let homePts = 0, awayPts = 0; // points (1p + 2p*2), excludes goals

    const points = [];
    points.push({
        x: 0,
      home_total: 0,
      away_total: 0,
      home_goals: 0,
      away_goals: 0,
      home_points: 0,
      away_points: 0,
        label: mode === 'time' ? displayLayout.formatTick(0) : '0',
      });

    for (const e of scoring) {
      const side = e.s.team_side === 'away' ? 'away' : 'home';
      const add = e.outcome === 'goal' ? 3 : (e.outcome === '2_point' ? 2 : 1);
      if (side === 'home') {
        homeTotal += add;
        if (e.outcome === 'goal') homeGoals += 1;
        else homePts += add;
      } else {
        awayTotal += add;
        if (e.outcome === 'goal') awayGoals += 1;
        else awayPts += add;
      }

      const x = getX(e);
      points.push({
        x,
        home_total: homeTotal,
        away_total: awayTotal,
        home_goals: homeGoals,
        away_goals: awayGoals,
        home_points: homePts,
        away_points: awayPts,
        label: mode === 'time' ? displayLayout.formatTick(x) : String(x),
        eventLabel: (() => {
          const player = e.extra?.shot?.player;
          const number = String(player?.number || '').trim();
          const name = String(player?.name || '').trim();
          const playerLabel = [number ? `#${number}` : '', name].filter(Boolean).join(' ');
          const outcomeLabel = e.outcome === 'goal' ? 'Goal' : e.outcome === '2_point' ? '2 Point' : 'Point';
          return [playerLabel, outcomeLabel].filter(Boolean).join(' • ');
        })(),
      });
    }

    return {
      mode,
      points,
      axisMax: mode === 'time' ? displayLayout.axisMax : Math.max(1, ...points.map((p) => Number(p?.x) || 0)),
      tickValues: mode === 'time' ? displayLayout.ticks : undefined,
      tickFormatter: mode === 'time' ? displayLayout.formatTick : undefined,
      boundaryMarkers: mode === 'time' ? displayLayout.boundaryMarkers.filter((marker) => marker.x <= displayLayout.axisMax) : null,
    };
  }, [overviewStats, match, imputedTimeById]);

  const overviewPossessionOutcome = useMemo(() => {
    const groups = groupByPossession(overviewStats);
    const init = () => ({ Score: 0, 'Missed Shot': 0, Turnover: 0, 'Half End': 0 });
    const outcomes = { home: init(), away: init() };
    const breakdownInit = () => ({
      Score: { Goal: 0, '2 Point': 0, '1 Point': 0 },
      'Missed Shot': { Wide: 0, Short: 0, Blocked: 0, Saved: 0, Post: 0 },
      Turnover: {},
      'Half End': { 'Half End': 0 },
    });
    const breakdowns = { home: breakdownInit(), away: breakdownInit() };

    for (const [key, evs] of groups.entries()) {
      const [teamSide] = String(key).split('-');
      if (teamSide !== 'home' && teamSide !== 'away') continue;
      const acting = (Array.isArray(evs) ? evs : []).filter((e) => e && e.team_side === teamSide);
      if (!acting.length) continue;

      const rawOutcome = derivePossessionOutcome(evs, teamSide);
      const outcome = ['Wide', 'Short', 'Blocked', 'Saved', 'Post'].includes(rawOutcome) ? 'Missed Shot' : rawOutcome;

      if (outcomes[teamSide][outcome] == null) outcomes[teamSide][outcome] = 0;
      outcomes[teamSide][outcome] += 1;

      if (outcome === 'Score') {
        let scoreType = '1 Point';
        for (const shot of acting.filter((e) => e?.stat_type === 'shot' && !shouldExcludeFromTotals(e))) {
          const ex = safeParseJSON(shot?.extra_data || '{}', {});
          const shotOutcome = String(ex?.shot?.outcome || '');
          if (shotOutcome === 'goal') { scoreType = 'Goal'; break; }
          if (shotOutcome === '2_point') scoreType = '2 Point';
        }
        breakdowns[teamSide].Score[scoreType] = Number(breakdowns[teamSide].Score[scoreType] || 0) + 1;
      } else if (outcome === 'Missed Shot') {
        const labelMap = { Wide: 'Wide', Short: 'Short', Blocked: 'Blocked', Saved: 'Saved', Post: 'Post' };
        const keyLabel = labelMap[rawOutcome] || 'Wide';
        breakdowns[teamSide]['Missed Shot'][keyLabel] = Number(breakdowns[teamSide]['Missed Shot'][keyLabel] || 0) + 1;
      } else if (outcome === 'Turnover') {
        const ordered = acting.slice().sort((a, b) => {
          const pa = Number(a?.play_id);
          const pb = Number(b?.play_id);
          if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa - pb;
          const ta = Number(a?.normalized_time_s);
          const tb = Number(b?.normalized_time_s);
          if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
          return String(a?.id || '').localeCompare(String(b?.id || ''));
        });
        let turnoverLabel = 'Other';
        for (let idx = ordered.length - 1; idx >= 0; idx -= 1) {
          const stat = ordered[idx];
          const ex = safeParseJSON(stat?.extra_data || '{}', {});
          const passOutcome = String(ex?.pass?.outcome || '');
          const carryOutcome = String(ex?.carry?.outcome || '');
          const turnoverType = String(ex?.turnover?.turnover_type || ex?.turnover?.type || '');
          if (stat?.stat_type === 'turnover' || turnoverType || passOutcome === 'turnover' || carryOutcome === 'turnover') {
            turnoverLabel = toTitleCase(turnoverType || 'turnover');
            break;
          }
          if (['sideline_against', '45_against', 'goal_kick_against'].includes(passOutcome) || ['sideline_against', '45_against', 'goal_kick_against'].includes(carryOutcome)) {
            turnoverLabel = toTitleCase(passOutcome || carryOutcome);
            break;
          }
          if (passOutcome === 'foul' || carryOutcome === 'foul') {
            const foul = extractFoulFromStat(stat);
            turnoverLabel = toTitleCase(foul?.foul_type || 'foul');
            break;
          }
        }
        breakdowns[teamSide].Turnover[turnoverLabel] = Number(breakdowns[teamSide].Turnover[turnoverLabel] || 0) + 1;
      } else if (outcome === 'Half End') {
        breakdowns[teamSide]['Half End']['Half End'] = Number(breakdowns[teamSide]['Half End']['Half End'] || 0) + 1;
      }
    }

    const rows = [
      { team: homeTeam?.name || 'Home', side: 'home', ...outcomes.home },
      { team: awayTeam?.name || 'Away', side: 'away', ...outcomes.away },
    ];
    const breakdownRows = Object.fromEntries(
      ['Score', 'Missed Shot', 'Turnover', 'Half End'].map((category) => {
        const keys = Array.from(new Set([
          ...Object.keys(breakdowns.home[category] || {}),
          ...Object.keys(breakdowns.away[category] || {}),
        ]));
        return [category, [
          { team: homeTeam?.name || 'Home', side: 'home', ...Object.fromEntries(keys.map((key) => [key, Number(breakdowns.home[category]?.[key] || 0)])) },
          { team: awayTeam?.name || 'Away', side: 'away', ...Object.fromEntries(keys.map((key) => [key, Number(breakdowns.away[category]?.[key] || 0)])) },
        ]];
      })
    );

    return { rows, breakdownRows };
  }, [overviewStats, homeTeam, awayTeam]);

  const overviewMomentum = useMemo(() => {
    const list = Array.isArray(overviewStats) ? overviewStats : [];
    const displayLayout = buildSectionDisplayLayout(list, match, imputedTimeById);
    const withTime = list
      .map((s) => ({
        stat: s,
        matchTime: getMatchTimeS(s, match, imputedTimeById),
        displayTime: displayLayout.getDisplayTimeForStat(s),
      }))
      .filter((entry) => Number.isFinite(entry.matchTime))
      .sort((a, b) => a.matchTime - b.matchTime);
    if (!withTime.length) return { mode: 'none', rows: [] };

    const share = (a, b) => {
      const d = a + b;
      if (!Number.isFinite(d) || d <= 0) return 0.5;
      return a / d;
    };

    const turnoverLostSide = (s) => {
      const ex = safeParseJSON(s?.extra_data || '{}', {});
      const lost = ex?.turnover?.lost_by?.team_side;
      if (lost === 'home' || lost === 'away') return lost;
      return null;
    };
    const turnoverWonSide = (s) => {
      const ex = safeParseJSON(s?.extra_data || '{}', {});
      const recovered = ex?.turnover?.recovered_by?.team_side;
      const forced = ex?.turnover?.forced_by?.team_side;
      if (recovered === 'home' || recovered === 'away') return recovered;
      if (forced === 'home' || forced === 'away') return forced;
      const foul = extractFoulFromStat(s);
      const foulOn = foul?.foul_on_or_forced_by?.team_side || foul?.foul_on?.team_side;
      if (foulOn === 'home' || foulOn === 'away') return foulOn;
      const lost = turnoverLostSide(s);
      return oppositeTeamSide(lost);
    };
    const liveIntervals = [];
    for (let idx = 0; idx < withTime.length - 1; idx += 1) {
      const current = withTime[idx];
      const next = withTime[idx + 1];
      if (!current?.stat || !next?.stat) continue;
      const start = Number(current.displayTime);
      const end = Number(next.displayTime);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      if (isDeadBallGapStart(current.stat)) continue;
      const side = current.stat?.possession_team_side;
      if (side !== 'home' && side !== 'away') continue;
      liveIntervals.push({ side, start, end });
    }

    const axisMax = Math.max(5 * 60, displayLayout.axisMax);
    const lastMinute = Math.max(1, Math.ceil(axisMax / 60));
    const momentumDecayBins = [
      { startOffset: 0, endOffset: 60, weight: 0.30 },
      { startOffset: 60, endOffset: 120, weight: 0.25 },
      { startOffset: 120, endOffset: 180, weight: 0.20 },
      { startOffset: 180, endOffset: 240, weight: 0.15 },
      { startOffset: 240, endOffset: 300, weight: 0.10 },
    ];

    const minuteRows = Array.from({ length: lastMinute + 1 }, (_, minuteIndex) => {
      const minuteMark = minuteIndex * 60;
      const statsBySide = {
        home: { pts: 0, shots: 0, possSeconds: 0, toWon: 0, kickoutsWon: 0 },
        away: { pts: 0, shots: 0, possSeconds: 0, toWon: 0, kickoutsWon: 0 },
      };

      for (const bin of momentumDecayBins) {
        const rawBinStart = minuteMark - bin.endOffset;
        const rawBinEnd = minuteMark - bin.startOffset;
        const binStart = Math.max(displayLayout.getSectionStartForDisplayTime(minuteMark), rawBinStart);
        const binEnd = Math.min(minuteMark, rawBinEnd);
        if (!(binEnd > binStart)) continue;

        for (const interval of liveIntervals) {
          const overlap = Math.max(0, Math.min(interval.end, binEnd) - Math.max(interval.start, binStart));
          if (overlap > 0 && (interval.side === 'home' || interval.side === 'away')) {
            statsBySide[interval.side].possSeconds += overlap * bin.weight;
          }
        }

        const binStats = withTime.filter((entry) => entry.displayTime > binStart && entry.displayTime <= binEnd);
        for (const { stat } of binStats) {
          if (stat.stat_type === 'shot' && !shouldExcludeFromTotals(stat)) {
            const ex = safeParseJSON(stat.extra_data || '{}', {});
            const o = ex?.shot?.outcome;
            const add = shotPointsForOutcome(o);
            if (stat.team_side === 'home') {
              statsBySide.home.shots += bin.weight;
              statsBySide.home.pts += add * bin.weight;
            }
            if (stat.team_side === 'away') {
              statsBySide.away.shots += bin.weight;
              statsBySide.away.pts += add * bin.weight;
            }
          }

          if (!shouldExcludeFromTotals(stat) && (stat.stat_type === 'turnover' || safeParseJSON(stat?.extra_data || '{}', {})?.turnover)) {
            const wonSide = turnoverWonSide(stat);
            if (wonSide === 'home' || wonSide === 'away') statsBySide[wonSide].toWon += bin.weight;
          }

          if (stat.stat_type === 'kickout') {
            const wonSide = inferRestartWinnerSide(stat, nextStatById.get(stat?.id));
            if (wonSide === 'home' || wonSide === 'away') statsBySide[wonSide].kickoutsWon += bin.weight;
          }
        }
      }

      const kickoutShareHome = share(statsBySide.home.kickoutsWon, statsBySide.away.kickoutsWon);
      const turnoverShareHome = share(statsBySide.home.toWon, statsBySide.away.toWon);
      const shotShareHome = share(statsBySide.home.shots, statsBySide.away.shots);
      const possessionTimeShareHome = share(statsBySide.home.possSeconds, statsBySide.away.possSeconds);
      const pointShareHome = share(statsBySide.home.pts, statsBySide.away.pts);

      const mHome = 100 * (
        0.25 * kickoutShareHome
        + 0.20 * turnoverShareHome
        + 0.10 * shotShareHome
        + 0.25 * possessionTimeShareHome
        + 0.20 * pointShareHome
      );
      const mAway = 100 - mHome;

      return {
        x: minuteMark,
        minute: minuteMark / 60,
        label: displayLayout.formatTick(minuteMark),
        home: Number.isFinite(mHome) ? mHome : 50,
        away: Number.isFinite(mAway) ? mAway : 50,
        home_pts: statsBySide.home.pts,
        away_pts: statsBySide.away.pts,
        home_poss_time: statsBySide.home.possSeconds,
        away_poss_time: statsBySide.away.possSeconds,
        home_to_won: statsBySide.home.toWon,
        away_to_won: statsBySide.away.toWon,
        home_ko_won: statsBySide.home.kickoutsWon,
        away_ko_won: statsBySide.away.kickoutsWon,
        home_shots: statsBySide.home.shots,
        away_shots: statsBySide.away.shots,
      };
    });

    const boundaryRows = (displayLayout.boundaryMarkers || []).map((marker) => ({
      x: Number(marker.x),
      minute: Number(marker.x) / 60,
      label: displayLayout.formatTick(Number(marker.x)),
      home: 50,
      away: 50,
      home_pts: 0,
      away_pts: 0,
      home_poss_time: 0,
      away_poss_time: 0,
      home_to_won: 0,
      away_to_won: 0,
      home_ko_won: 0,
      away_ko_won: 0,
      home_shots: 0,
      away_shots: 0,
      isBoundaryReset: true,
    }));

    const rows = [...minuteRows, ...boundaryRows]
      .sort((a, b) => Number(a.x) - Number(b.x))
      .filter((row, index, list) => {
        if (index === 0) return true;
        const prev = list[index - 1];
        if (Math.abs(Number(prev.x) - Number(row.x)) > 0.001) return true;
        return !!row.isBoundaryReset;
      });

    return {
      mode: 'rolling',
      rows,
      axisMaxSeconds: axisMax,
      axisMaxMinutes: Math.ceil(axisMax / 60),
      tickValues: displayLayout.ticks,
      tickFormatter: displayLayout.formatTick,
      boundaryMarks: displayLayout.boundaryMarkers.filter((marker) => marker.x <= axisMax),
    };
  }, [overviewStats, match, imputedTimeById]);

  const reportAmbient = useMemo(() => {
    const homeAmbient = createAmbientTeamColor(homeTeam?.color, '#3b82f6');
    const awayAmbient = createAmbientTeamColor(awayTeam?.color, '#ef4444');
    const blendAmbient = mixRgb(homeAmbient, awayAmbient, 0.5);
    return {
      shell: { backgroundColor: '#eef2f8' },
      baseWash: {
        background: 'linear-gradient(180deg, rgba(255,255,255,0.42) 0%, rgba(243,246,251,0.58) 42%, rgba(236,241,247,0.76) 100%)',
      },
      homeField: {
        background: `radial-gradient(ellipse at 18% 26%, ${rgbaString(homeAmbient, 0.38)} 0%, ${rgbaString(homeAmbient, 0.26)} 26%, ${rgbaString(homeAmbient, 0.16)} 48%, transparent 72%)`,
      },
      awayField: {
        background: `radial-gradient(ellipse at 82% 24%, ${rgbaString(awayAmbient, 0.34)} 0%, ${rgbaString(awayAmbient, 0.24)} 28%, ${rgbaString(awayAmbient, 0.14)} 50%, transparent 74%)`,
      },
      verticalPresence: {
        background: `linear-gradient(90deg, ${rgbaString(homeAmbient, 0.1)} 0%, ${rgbaString(homeAmbient, 0.06)} 26%, ${rgbaString(blendAmbient, 0.04)} 50%, ${rgbaString(awayAmbient, 0.06)} 74%, ${rgbaString(awayAmbient, 0.1)} 100%)`,
      },
      centerBlend: {
        background: `radial-gradient(ellipse at center, ${rgbaString(blendAmbient, 0.26)} 0%, ${rgbaString(blendAmbient, 0.16)} 34%, ${rgbaString(blendAmbient, 0.08)} 56%, transparent 78%)`,
      },
      veil: {
        background: 'linear-gradient(90deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.04) 100%)',
      },
    };
  }, [homeTeam?.color, awayTeam?.color]);

  if (!matchId) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-slate-900 rounded-xl flex items-center justify-center mx-auto">
              <BarChart3 className="w-6 h-6 text-white" />
            </div>
            <div className="text-slate-900 font-semibold">No match selected</div>
            <Link to={createPageUrl('Home')}>
              <Button>Go to Dashboard</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const canManageReport = !readOnly;
  const filterButtonLabel = buildFilterButtonLabel(activeTopFilterCount);
  const formattedHeaderDate = match?.date ? String(match.date) : '';
  const navControlClassName = 'h-8 rounded-full border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50';
  const isPlayersAnalyticsTab = activeTab === 'players_ana';

  return (
    <div className="relative min-h-screen" style={reportAmbient.shell}>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0" style={reportAmbient.baseWash} />
        <div className="absolute inset-y-0 -left-[12%] w-[72%] blur-3xl" style={reportAmbient.homeField} />
        <div className="absolute inset-y-0 -right-[12%] w-[72%] blur-3xl" style={reportAmbient.awayField} />
        <div className="absolute inset-0" style={reportAmbient.verticalPresence} />
        <div className="absolute inset-y-0 left-1/2 w-[82%] -translate-x-1/2 blur-3xl" style={reportAmbient.centerBlend} />
        <div className="absolute inset-0" style={reportAmbient.veil} />
      </div>

      <div className="relative z-10">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="border-b border-slate-200/90 bg-white shadow-sm">
          <div className="max-w-7xl mx-auto px-4">
            <div className="flex items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <Link to={createPageUrl('Home')}>
                  <Button variant="outline" size="sm" className={`gap-2 ${navControlClassName}`}>
                    <ArrowLeft className="w-4 h-4" /> Back
                  </Button>
                </Link>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900 sm:text-base">
                    {homeTeam?.name || 'Home'} vs {awayTeam?.name || 'Away'}
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {formattedHeaderDate}{match?.venue ? ` - ${match.venue}` : ''}
                  </div>
                </div>
              </div>
              {canManageReport ? (
                <div className="flex items-center gap-2">
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="outline" size="sm" className={`gap-2 ${navControlClassName}`} aria-label="Open report management menu">
                        Manage
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem onSelect={() => setDataOpen(true)}>
                        <BarChart3 className="h-4 w-4" />
                        Manage Data
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => openMatchupEditor()}>
                        <BarChart3 className="h-4 w-4" />
                        Assign Matchups
                      </DropdownMenuItem>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>ShotArc</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-44">
                          <DropdownMenuItem onSelect={handleShotArcExport}>Export</DropdownMenuItem>
                          <DropdownMenuItem onSelect={handleShotArcImportClick}>Import</DropdownMenuItem>
                          <DropdownMenuItem onSelect={toggleShotArcInfo}>Game Info</DropdownMenuItem>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      {!readOnly ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => setShareOpen(true)}>
                            <Share2 className="h-4 w-4" />
                            Share
                          </DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ) : readOnly && !isAuthenticated && statShareCode ? (
                <div className="flex items-center gap-2">
                  <Link
                    to={`${createPageUrl('Login')}?next=${encodeURIComponent(createPageUrl(`StatShare?code=${encodeURIComponent(statShareCode)}`))}`}
                    onClick={() => {
                      setPostLoginRedirect(createPageUrl(`StatShare?code=${encodeURIComponent(statShareCode)}`));
                    }}
                  >
                    <Button type="button" variant="outline" size="sm" className={`gap-2 ${navControlClassName}`}>
                      Log in
                    </Button>
                  </Link>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="sticky top-0 z-[70] isolate border-b-2 border-slate-300 bg-white shadow-[0_2px_8px_rgba(15,23,42,0.08)]">
          <div className="max-w-7xl mx-auto px-4 py-1.5">
            <div className="flex min-h-10 items-center justify-between gap-3">
              <div className="hidden min-w-0 flex-1 xl:block">
                <TabsList className="min-h-10 flex-nowrap items-center justify-start rounded-xl border border-slate-200/80 bg-slate-100 p-0.5 shadow-sm">
                  {REPORT_TAB_OPTIONS.map((option) => (
                    <TabsTrigger
                      key={option.value}
                      value={option.value}
                      className="h-8 rounded-lg px-3.5 text-sm font-semibold text-slate-600 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm"
                    >
                      {option.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
              <div className="min-w-0 flex-1 xl:hidden">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-full border-slate-200 bg-white px-3 shadow-sm"
                  aria-label="Open report tabs"
                  onClick={() => setMobileTabsOpen(true)}
                >
                  <Menu className="h-4 w-4" />
                </Button>
              </div>
              <div className={`ml-auto flex max-w-full items-center justify-end gap-2 ${activeTab === 'summary' ? 'w-[120px] sm:w-auto sm:min-w-[124px]' : 'w-auto'}`}>
                {activeTab === 'summary' ? (
                  <MultiSelect
                    label="Overview Half"
                    labelClassName="sr-only"
                    className="space-y-0"
                    triggerClassName={navControlClassName}
                    placeholder="All Halves"
                    values={overviewHalf === 'all' ? [] : [overviewHalf]}
                    onChange={(nextValues) => setOverviewHalf(nextValues[0] || 'all')}
                    options={[
                      { value: 'first', label: '1st Half' },
                      { value: 'second', label: '2nd Half' },
                    ]}
                    singleSelect
                    clearActionLabel="All Halves"
                  />
                ) : null}
                {activeTab === 'video' ? (
                  <div
                    id="report-video-nav-controls"
                    className="flex max-w-full flex-wrap items-center justify-end gap-2"
                    aria-label="Video tab controls"
                  />
                ) : null}
                  {activeTab === 'players_ana' ? (
                    <div
                      id="report-players-nav-controls"
                      className="flex max-w-full flex-nowrap items-center justify-end gap-1.5"
                      aria-label="Players tab controls"
                    />
                  ) : null}
                {showStickyFiltersButton ? (
                  <Popover open={topFiltersOpen} onOpenChange={setTopFiltersOpen}>
                    <PopoverTrigger asChild>
                      {isPlayersAnalyticsTab ? (
                        <Button type="button" variant="outline" size="sm" className={`w-full gap-1 sm:w-auto sm:px-3 ${navControlClassName}`} aria-label={filterButtonLabel}>
                          <span className="truncate">{activeTopFilterCount > 0 ? `Filters (${activeTopFilterCount})` : 'Filters'}</span>
                        </Button>
                      ) : (
                        <Button type="button" variant="outline" size="sm" className={`w-full gap-1.5 sm:w-[116px] sm:justify-between ${navControlClassName}`} aria-label={filterButtonLabel}>
                          <span className="flex min-w-0 items-center gap-2">
                            <SlidersHorizontal className="h-4 w-4 shrink-0" />
                            <span className="truncate">Filters</span>
                          </span>
                          <span className={`inline-flex min-w-[2rem] justify-end tabular-nums ${activeTopFilterCount > 0 ? 'text-current' : 'invisible'}`}>
                            ({activeTopFilterCount || 0})
                          </span>
                        </Button>
                      )}
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-[320px] max-w-[90vw] overflow-hidden border-slate-200/90 bg-white p-4 shadow-lg">
                      <div className="max-h-[calc(80vh-2rem)] space-y-3 overflow-y-auto pr-1">
                        {activeTab === 'scoring' && (
                          <>
                            <ReportFiltersFields reportFilters={{ ...reportFilters, allowedActionTypes: ['shot'] }} playerOptions={playerOptions} homeTeam={homeTeam} awayTeam={awayTeam} showAction={false} />
                            <details className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                              <summary className="cursor-pointer list-none text-xs font-semibold text-slate-700">
                                Advanced Filters
                              </summary>
                              <div className="mt-3 space-y-3">
                                <MultiSelect label="Shot Type" placeholder="All" values={scoringShotType} onChange={setScoringShotType} options={[{ value: 'point', label: '1 Point' }, { value: '2_point', label: '2 Point' }, { value: 'goal', label: 'Goal' }]} />
                                <MultiSelect
                                  label="Situation"
                                  placeholder="All"
                                  values={scoringSituation}
                                  onChange={setScoringSituation}
                                  options={[
                                    { value: 'play', label: 'Play' },
                                    { value: 'free_ground', label: 'Free From Ground' },
                                    { value: 'free_hands', label: 'Free From Hands' },
                                    { value: '45', label: '45' },
                                    { value: 'penalty', label: 'Penalty' },
                                    { value: 'mark', label: 'Mark' },
                                  ]}
                                />
                                <MultiSelect label="Pressure" placeholder="All" values={scoringPressure} onChange={setScoringPressure} options={['low', 'medium', 'high'].map((v) => ({ value: v, label: toTitleCase(v) }))} />
                                <MultiSelect label="Method" placeholder="All" values={scoringMethod} onChange={setScoringMethod} options={['left', 'right', 'hand'].map((v) => ({ value: v, label: toTitleCase(v) }))} />
                                <MultiSelect
                                  label="Attack Type"
                                  placeholder="Any"
                                  values={scoringAttackType === 'any' ? [] : [scoringAttackType]}
                                  onChange={(nextValues) => setScoringAttackType(nextValues[0] || 'any')}
                                  options={[
                                    { value: 'attack_type_set', label: 'Set' },
                                    { value: 'attack_type_transition', label: 'Transition' },
                                    { value: 'attack_type_transition_to_set', label: 'Transition->Set' },
                                  ]}
                                  singleSelect
                                  clearActionLabel="Any"
                                  triggerClassName="h-8 text-xs"
                                />
                              </div>
                            </details>
                          </>
                        )}
                        {activeTab === 'possessions' && (
                          <>
                            <div className="font-semibold text-slate-900">Possessions Filters</div>
                            <TeamMultiSelect
                              value={reportFilters.team}
                              onValueChange={reportFilters.setTeam}
                              homeTeam={homeTeam}
                              awayTeam={awayTeam}
                            />
                            <MultiSelect
                              label="Half"
                              placeholder="All"
                              values={reportFilters.halves}
                              onChange={reportFilters.setHalves}
                              options={[
                                { value: 'first', label: 'First' },
                                { value: 'second', label: 'Second' },
                                { value: 'et_first', label: 'ET1' },
                                { value: 'et_second', label: 'ET2' },
                              ]}
                            />
                            <MatchTimeRangeSlider
                              timeMin={reportFilters.timeMin}
                              timeMax={reportFilters.timeMax}
                              match={reportFilters.match}
                              stats={reportFilters.allStats}
                              imputedTimeById={reportFilters.imputedTimeById}
                              onChange={({ timeMin, timeMax }) => {
                                reportFilters.setTimeMin(timeMin);
                                reportFilters.setTimeMax(timeMax);
                              }}
                            />
                            <MultiSelect
                              label="Outcome"
                              placeholder="All"
                              values={possessionsOutcomeFilter}
                              onChange={setPossessionsOutcomeFilter}
                              options={[
                                { value: 'Score', label: 'Score' },
                                { value: 'Missed Shot', label: 'Missed Shot' },
                                { value: 'Turnover', label: 'Turnover' },
                                { value: 'Half End', label: 'Half End' },
                              ]}
                            />
                            <MultiSelect
                              label="Origin"
                              placeholder="All"
                              values={possessionsOriginFilter}
                              onChange={setPossessionsOriginFilter}
                              options={[
                                { value: 'Turnover Won', label: 'Turnover Won' },
                                { value: 'Own KO Won', label: 'Own KO Won' },
                                { value: 'Opp KO Won', label: 'Opp KO Won' },
                                { value: 'Throw In Won', label: 'Throw In Won' },
                                { value: 'Shot Missed (Live Ball)', label: 'Shot Missed (Live Ball)' },
                              ]}
                            />
                            <MultiSelect
                              label="Start Zone"
                              placeholder="All"
                              values={possessionsStartZoneFilter}
                              onChange={setPossessionsStartZoneFilter}
                              options={[
                                { value: 'Defensive Third', label: 'Defensive Third' },
                                { value: 'Middle Third', label: 'Middle Third' },
                                { value: 'Attacking Third', label: 'Attacking Third' },
                              ]}
                            />
                            <MultiSelect
                              label="Attack Type"
                              placeholder="Any"
                              values={possessionsAttackTypeFilter === 'any' ? [] : [possessionsAttackTypeFilter]}
                              onChange={(nextValues) => setPossessionsAttackTypeFilter(nextValues[0] || 'any')}
                              options={[
                                { value: 'attack_type_set', label: 'Set' },
                                { value: 'attack_type_transition', label: 'Transition' },
                                { value: 'attack_type_transition_to_set', label: 'Transition->Set' },
                              ]}
                              singleSelect
                              clearActionLabel="Any"
                              triggerClassName="h-8 text-xs"
                            />
                          </>
                        )}
                        {activeTab === 'build_up' && (
                          <>
                            <div className="font-semibold text-slate-900">Build-Up Filters</div>
                            <ReportFiltersFields
                              reportFilters={{ ...reportFilters, allowedActionTypes: ['pass', 'carry'] }}
                              playerOptions={playerOptions}
                              homeTeam={homeTeam}
                              awayTeam={awayTeam}
                              showPlayer={false}
                              showOutcome={false}
                              actionLabel="Pass / Carry"
                              timeBeforeAction
                            />
                          </>
                        )}
                        {activeTab === 'kickouts' && (
                          <>
                            <div className="font-semibold text-slate-900">Restarts Filters</div>
                            <ReportFiltersFields
                              reportFilters={{ ...reportFilters, allowedActionTypes: ['kickout', 'throw_in'] }}
                              playerOptions={playerOptions}
                              homeTeam={homeTeam}
                              awayTeam={awayTeam}
                              showPlayer={false}
                              showAction={false}
                              showOutcome={false}
                              timeBeforeAction
                            />
                            <MultiSelect
                              label="Target"
                              placeholder="All"
                              values={restartTargetFilter}
                              onChange={setRestartTargetFilter}
                              options={restartTargetOptions}
                            />
                            <MultiSelect
                              label="Won By"
                              placeholder="All"
                              values={restartWonByFilter}
                              onChange={setRestartWonByFilter}
                              options={restartWonByOptions}
                            />
                            <MultiSelect
                              label="Distance"
                              placeholder="All"
                              values={restartLengthFilter}
                              onChange={setRestartLengthFilter}
                              options={[
                                { value: 'short', label: 'Short' },
                                { value: 'long', label: 'Long' },
                              ]}
                            />
                            <MultiSelect
                              label="Direction"
                              placeholder="All"
                              values={restartSideFilter}
                              onChange={setRestartSideFilter}
                              options={[
                                { value: 'left', label: 'Left' },
                                { value: 'centre', label: 'Centre' },
                                { value: 'right', label: 'Right' },
                              ]}
                            />
                          </>
                        )}
                        {activeTab === 'defense' && (
                          <>
                            <div className="font-semibold text-slate-900">Defense Filters</div>
                            <ReportFiltersFields reportFilters={{ ...reportFilters, allowedActionTypes: ['turnover', 'def_pressure', 'foul'] }} playerOptions={playerOptions} homeTeam={homeTeam} awayTeam={awayTeam} showOutcome={false} timeBeforeAction />
                            <MultiSelect
                              label="Turnover Result"
                              placeholder="Both"
                              values={defenseTurnoverResult === 'both' ? [] : [defenseTurnoverResult]}
                              onChange={(nextValues) => setDefenseTurnoverResult(nextValues[0] || 'both')}
                              options={[
                                { value: 'won', label: 'Won' },
                                { value: 'lost', label: 'Lost' },
                              ]}
                              singleSelect
                              clearActionLabel="Both"
                              triggerClassName="h-8 text-xs"
                            />
                          </>
                        )}
                        {activeTab === 'players_ana' && (
                          <>
                            <div className="font-semibold text-slate-900">Players Filters</div>
                            <ReportFiltersFields reportFilters={{ ...reportFilters, allowedActionTypes: ['shot', 'pass', 'carry', 'turnover', 'foul', 'kickout', 'throw_in'] }} playerOptions={playerOptions} homeTeam={homeTeam} awayTeam={awayTeam} showPlayer={false} showAction={false} showOutcome={false} timeBeforeAction />
                          </>
                        )}
                        {activeTab === 'video' && (
                          <>
                            <div className="font-semibold text-slate-900">Video Filters</div>
                            <ReportFiltersFields
                              reportFilters={{ ...reportFilters, allowedActionTypes: ['shot', 'pass', 'carry', 'turnover', 'foul', 'kickout', 'throw_in'] }}
                              playerOptions={playerOptions}
                              homeTeam={homeTeam}
                              awayTeam={awayTeam}
                              showAction={false}
                              showOutcome={false}
                              timeBeforeAction
                            />
                          </>
                        )}
                        <div className="border-t pt-3">
                          <Button type="button" variant="outline" className="w-full" onClick={resetAllFilters}>
                            Reset All Filters
                          </Button>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <Sheet open={mobileTabsOpen} onOpenChange={setMobileTabsOpen} modal={false}>
          <SheetContent side="left" className="w-[280px] border-slate-200 bg-white px-4 py-5 sm:max-w-[280px]">
            <SheetHeader className="mb-4 pr-8">
              <SheetTitle>Report Tabs</SheetTitle>
            </SheetHeader>
            <div className="space-y-2">
              {REPORT_TAB_OPTIONS.map((option) => {
                const isActive = option.value === activeTab;
                return (
                  <Button
                    key={option.value}
                    type="button"
                    variant={isActive ? 'default' : 'ghost'}
                    className="w-full justify-start rounded-xl px-3 text-sm"
                    onClick={() => {
                      setActiveTab(option.value);
                      setMobileTabsOpen(false);
                    }}
                  >
                    {option.label}
                  </Button>
                );
              })}
            </div>
          </SheetContent>
        </Sheet>

        <input
          ref={shotArcImportInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleShotArcImportChange}
        />

        <main className="max-w-7xl mx-auto px-4 py-3">
          <TabsContent value="summary" className="mt-2">
            <OverviewTab
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              match={match}
              scoreTimeline={scoreTimeline}
              summary={summary}
              overviewMomentum={overviewMomentum}
              overviewPossessionOutcome={overviewPossessionOutcome}
              overviewHalf={overviewHalf}
              setOverviewHalf={setOverviewHalf}
            />
          </TabsContent>

          <TabsContent value="scoring" className="mt-2">
            <ScoringTab
              stats={filteredForScoring}
              simStats={filteredForScoringWp}
              match={match}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              playerOptions={playerOptions}
              reportFilters={reportFilters}
              shotType={scoringShotType}
              setShotType={setScoringShotType}
              situation={scoringSituation}
              setSituation={setScoringSituation}
              pressure={scoringPressure}
              setPressure={setScoringPressure}
              method={scoringMethod}
              setMethod={setScoringMethod}
              attackType={scoringAttackType}
              onOpenVideoAt={openSharedVideoAt}
            />
          </TabsContent>

          <TabsContent value="possessions" className="mt-2">
            <PossessionsTab
              stats={stats}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              playerOptions={playerOptions}
              reportFilters={reportFilters}
              onOpenVideoAt={openSharedVideoAt}
              onOpenVideoPossession={openSharedVideoPossession}
              outcomeFilter={possessionsOutcomeFilter}
              originFilter={possessionsOriginFilter}
              startZoneFilter={possessionsStartZoneFilter}
	              attackTypeFilter={possessionsAttackTypeFilter}
	              setAttackTypeFilter={setPossessionsAttackTypeFilter}
	              onVisualisePossession={(p) => {
	                const titleTeam = p?.teamSide === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home');
	                const possessionStats = (Array.isArray(p?.stats) ? p.stats : []).filter((s) => {
	                  if (!s) return false;
	                  if (s?.team_side === p?.teamSide) return true;
	                  return (s?.stat_type === 'kickout' || s?.stat_type === 'throw_in') && s?.possession_team_side === p?.teamSide;
	                });
	                openPossessionVisualiser({
	                  title: `Possession #${p?.possessionId ?? 'NA'} - ${titleTeam}`,
	                  stats: possessionStats,
	                });
	              }}
            />
          </TabsContent>

          <TabsContent value="build_up" className="mt-2">
            <BuildUpTab
              stats={filteredForReport}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              playerOptions={playerOptions}
              reportFilters={reportFilters}
              eventTypes={buildEventTypes}
              setEventTypes={setBuildEventTypes}
              pressure={buildPressure}
              setPressure={setBuildPressure}
              outcome={buildOutcome}
              setOutcome={setBuildOutcome}
              progressiveOnly={buildProgressiveOnly}
              setProgressiveOnly={setBuildProgressiveOnly}
              pnSide={buildPnSide}
              setPnSide={setBuildPnSide}
              pnMin={buildPnMin}
              setPnMin={setBuildPnMin}
              pnHalf={buildPnHalf}
              setPnHalf={setBuildPnHalf}
              onOpenVideoAt={openSharedVideoAt}
            />
          </TabsContent>

          <TabsContent value="kickouts" className="mt-2">
            <RestartsTab
              stats={stats}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              playerOptions={playerOptions}
              reportFilters={reportFilters}
              restartTargetFilter={restartTargetFilter}
              restartWonByFilter={restartWonByFilter}
              restartLengthFilter={restartLengthFilter}
              restartSideFilter={restartSideFilter}
              onOpenVideoAt={openSharedVideoAt}
            />
          </TabsContent>

          <TabsContent value="defense" className="mt-2">
            <DefenseTab
              stats={stats}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              reportFilters={reportFilters}
              eventCategory={defenseEventCategory}
              setEventCategory={setDefenseEventCategory}
              turnoverResult={defenseTurnoverResult}
              setTurnoverResult={setDefenseTurnoverResult}
              turnoverTypes={defenseTurnoverTypes}
              setTurnoverTypes={setDefenseTurnoverTypes}
              defTypes={defenseDefTypes}
              setDefTypes={setDefenseDefTypes}
              onOpenVideoAt={openSharedVideoAt}
            />
          </TabsContent>

          <TabsContent value="players_ana" className="mt-2">
            <PlayersAnalyticsTab
              stats={stats}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              playerOptions={playerOptions}
              reportFilters={reportFilters}
              match={match}
              matchupStints={effectiveMatchupStints}
              playerTimeAndPossessionStats={playerTimeAndPossessionStats}
              readOnly={readOnly}
              onPlayerSelect={openPlayerProfile}
              onOpenVideoAt={openSharedVideoAt}
              onOpenVideoSelection={openSharedVideoSelection}
              onOpenMatchupEditor={openMatchupEditor}
              focusPlayerId={playersFocusPlayerId}
              setFocusPlayerId={setPlayersFocusPlayerId}
              playersNavPortalTargetId="report-players-nav-controls"
            />
          </TabsContent>

          <TabsContent value="video" className="mt-2">
            <DataTab
              matchId={matchId}
              match={match}
              stats={stats}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              homePlayers={effectiveHomePlayers}
              awayPlayers={effectiveAwayPlayers}
              sharedHighlightReels={sharedData.highlightReels}
              sharedHighlightReelClips={sharedData.highlightReelClips}
              sharedVideoNotes={sharedData.videoNotes}
              readOnly={readOnly}
              mode="video"
              videoNavPortalTargetId="report-video-nav-controls"
            />
          </TabsContent>
        </main>
      </Tabs>
      </div>

      <Dialog open={dataOpen} onOpenChange={setDataOpen} modal={false}>
        <DialogContent className="max-w-7xl w-[96vw] max-h-[92vh] p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-0">
            <DialogTitle>Manage Data</DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-6 overflow-y-auto max-h-[calc(92vh-72px)]">
            <DataTab
              matchId={matchId}
              match={match}
              stats={stats}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              homePlayers={effectiveHomePlayers}
              awayPlayers={effectiveAwayPlayers}
              sharedHighlightReels={sharedData.highlightReels}
              sharedHighlightReelClips={sharedData.highlightReelClips}
              sharedVideoNotes={sharedData.videoNotes}
              readOnly={readOnly}
              mode="data"
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={shotArcInfoOpen} onOpenChange={setShotArcInfoOpen} modal={false}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>ShotArc Game Info</DialogTitle>
          </DialogHeader>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
              <div className="font-semibold text-slate-700">Code</div>
              <div className="text-slate-900">{match?.code || 'NA'}</div>
              <div className="font-semibold text-slate-700">Venue</div>
              <div className="text-slate-900">{match?.venue || 'NA'}</div>
              <div className="font-semibold text-slate-700">Teams</div>
              <div className="text-slate-900">{homeTeam?.name || 'Home'} vs {awayTeam?.name || 'Away'}</div>
              <div className="font-semibold text-slate-700">Date</div>
              <div className="text-slate-900">{match?.date || 'NA'}</div>
              <div className="font-semibold text-slate-700">Wind Dir</div>
              <div className="text-slate-900">{match?.wind_direction || 'NA'}</div>
              <div className="font-semibold text-slate-700">Wind Speed</div>
              <div className="text-slate-900">{match?.wind_speed || 'NA'}</div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={playerProfileOpen} onOpenChange={setPlayerProfileOpen} modal={false}>
        <DialogContent className="max-w-7xl w-[96vw] max-h-[92vh] p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-0">
            <DialogTitle>Player Match Profile</DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-6 overflow-y-auto max-h-[calc(92vh-72px)]">
            <PlayerProfilePanel
              match={match}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              homePlayers={effectiveHomePlayers}
              awayPlayers={effectiveAwayPlayers}
              rawStats={rawStatsForPlayerProfile}
              matchupStints={matchupStintsForPlayerProfile}
              selectedPlayer={selectedPlayerProfileOption}
              readOnly={readOnly}
            />
          </div>
        </DialogContent>
      </Dialog>

      <MatchupEditorDialog
        open={matchupEditorState.open}
        onOpenChange={closeMatchupEditor}
        match={match}
        playerOptions={playerOptions}
        matchupStints={effectiveMatchupStints}
        periodMaxSecondsByKey={matchupPeriodMaxSecondsByKey}
        defaultDefenderKey={matchupEditorState.defenderKey}
        onCreateMatchupStint={handleCreateMatchupStint}
        onUpdateMatchupStint={handleUpdateMatchupStint}
        onDeleteMatchupStint={handleDeleteMatchupStint}
      />

      <Dialog open={shareOpen} onOpenChange={setShareOpen} modal={false}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Share Match</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              <div className="font-medium text-slate-900">Game Share</div>
              <p className="text-sm text-slate-600">
                Signed-in users can import a full private copy of this match, including team and player names. Their imported copy is separate from yours.
              </p>
              <div className="flex items-center gap-2">
                <Input value={gameShareCode || ''} readOnly placeholder="Generate a game share code" />
                <Button type="button" variant="outline" size="icon" onClick={() => handleCopyShareCode(gameShareCode)} disabled={!gameShareCode}>
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
                <Button type="button" className="w-full bg-green-600 hover:bg-green-700" onClick={() => handleCreateShareCode('game_copy')} disabled={shareBusy}>
                  {shareBusy ? 'Saving...' : (gameShareCode ? 'Refresh Game Share' : 'Generate Game Share Code')}
                </Button>
            </div>
            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              <div className="font-medium text-slate-900">Stat Share</div>
              <p className="text-sm text-slate-600">
                Anyone with this code can open a read-only version of the stat pages for this match from the login screen, without importing a copy.
              </p>
              <div className="flex items-center gap-2">
                <Input value={statViewShareCode || ''} readOnly placeholder="Generate a stat share code" />
                <Button type="button" variant="outline" size="icon" onClick={() => handleCopyShareCode(statViewShareCode)} disabled={!statViewShareCode}>
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
                <Button type="button" className="w-full bg-slate-900 hover:bg-slate-800" onClick={() => handleCreateShareCode('stat_view')} disabled={shareBusy}>
                  {shareBusy ? 'Saving...' : (statViewShareCode ? 'Refresh Stat Share' : 'Generate Stat Share Code')}
                </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={sharedVizOpen} onOpenChange={setSharedVizOpen} modal={false}>
        <DialogContent className="sm:max-w-4xl p-4">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2">
              <DialogTitle className="text-base">{sharedVizTitle || 'Visualise'}</DialogTitle>
              {(() => {
                const times = (sharedVizStats || []).map((s) => Number(s?.time_s)).filter(Number.isFinite);
                if (String(match?.mode || 'analysis') === 'live' || !times.length) return null;
                const t = Math.min(...times);
                return (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-3 text-xs"
                    onClick={() => openSharedVideoAt(t)}
                    title="Open the video popout and jump to this timestamp"
                  >
                    Open Video @ {formatMMSS(Math.max(0, t - SHARED_VIZ_PRE_ROLL_S))}
                  </Button>
                );
              })()}
            </div>
          </DialogHeader>
          <div className="pt-2">
            <PitchViz
              stats={sharedVizStats}
              homeColor={homeTeam?.color}
              awayColor={awayTeam?.color}
              colorBy="team"
              showColorControls={false}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

