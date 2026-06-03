import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BarChart3, Copy, Share2, SlidersHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
import useFilteredReportStats from '@/features/report/hooks/useFilteredReportStats';
import usePossessionVisualiser from '@/features/report/hooks/usePossessionVisualiser';
import useReportFilterState from '@/features/report/hooks/useReportFilterState';
import { softDeleteServerStat, updateServerStat } from '@/lib/serverSync';
import { createSharedMatchSnapshot } from '@/lib/sharedMatchCopies';
import { useAuth } from '@/lib/AuthContext';
import {
  applyXpImportToShots,
  buildThirdPartyShotExportRows,
  buildThirdPartyShotRecords,
  formatThirdPartyXpImportSummary,
  parseThirdPartyXpCsv,
  serializeThirdPartyRowsToCsv,
  writeThirdPartyXpIssues,
} from '@/lib/thirdPartyXp';

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

function getSectionBoundaryLabel(half) {
  if (half === 'first') return 'HT';
  if (half === 'second') return 'FT';
  if (half === 'et_first') return 'ET HT';
  return '';
}

function safeShotArcFilePart(value, fallback = 'team') {
  const text = String(value || fallback).trim().toLowerCase();
  return (text.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || fallback).slice(0, 80);
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
    const boundaryTime = periodEndTimes.length ? Math.max(...periodEndTimes) : lastLiveOrLoggedTime;
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
  const homeTeam = teams.find((team) => team?.id === match?.home_team_id) || teams[0] || null;
  const awayTeam = teams.find((team) => team?.id === match?.away_team_id) || teams[1] || null;
  const homePlayers = players.filter((player) => player?.team_id === homeTeam?.id);
  const awayPlayers = players.filter((player) => player?.team_id === awayTeam?.id);
  return { match, homeTeam, awayTeam, homePlayers, awayPlayers, rawStats };
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
  const rawStatsForPlayerProfile = isSharedView ? (sharedData.rawStats || []) : rawStats;
  const selectedPlayerProfileOption = useMemo(() => {
    if (!selectedPlayerProfile?.id || !selectedPlayerProfile?.team) return null;
    return playerOptions.find((player) => (
      String(player.id) === String(selectedPlayerProfile.id)
      && String(player.team_side) === String(selectedPlayerProfile.team)
    )) || null;
  }, [playerOptions, selectedPlayerProfile]);
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

      writeThirdPartyXpIssues(matchId, summary.issues);
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
      const result = await createSharedMatchSnapshot({
        match,
        homeTeam,
        awayTeam,
        players: allPlayersForShare,
        stats,
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

  const [restartTargetFilter, setRestartTargetFilter] = useState([]);
  const [restartWonByFilter, setRestartWonByFilter] = useState([]);
  const [restartLengthFilter, setRestartLengthFilter] = useState([]);
  const [restartSideFilter, setRestartSideFilter] = useState([]);

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
    preRollSeconds: SHARED_VIZ_PRE_ROLL_S,
  } = usePossessionVisualiser({ matchId });

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

    const rows = Array.from({ length: lastMinute + 1 }, (_, minuteIndex) => {
      const minuteMark = minuteIndex * 60;
      const windowStart = Math.max(displayLayout.getSectionStartForDisplayTime(minuteMark), minuteMark - 5 * 60);
      const windowStats = withTime.filter((entry) => entry.displayTime > windowStart && entry.displayTime <= minuteMark);
      const statsBySide = {
        home: { pts: 0, shots: 0, possSeconds: 0, toWon: 0, kickoutsWon: 0 },
        away: { pts: 0, shots: 0, possSeconds: 0, toWon: 0, kickoutsWon: 0 },
      };

      for (const interval of liveIntervals) {
        const overlap = Math.max(0, Math.min(interval.end, minuteMark) - Math.max(interval.start, windowStart));
        if (overlap > 0 && (interval.side === 'home' || interval.side === 'away')) {
          statsBySide[interval.side].possSeconds += overlap;
        }
      }

      for (const { stat } of windowStats) {
        if (stat.stat_type === 'shot' && !shouldExcludeFromTotals(stat)) {
          const ex = safeParseJSON(stat.extra_data || '{}', {});
          const o = ex?.shot?.outcome;
          const add = shotPointsForOutcome(o);
          if (stat.team_side === 'home') {
            statsBySide.home.shots += 1;
            statsBySide.home.pts += add;
          }
          if (stat.team_side === 'away') {
            statsBySide.away.shots += 1;
            statsBySide.away.pts += add;
          }
        }

        if (!shouldExcludeFromTotals(stat) && (stat.stat_type === 'turnover' || safeParseJSON(stat?.extra_data || '{}', {})?.turnover)) {
          const wonSide = turnoverWonSide(stat);
          if (wonSide === 'home' || wonSide === 'away') statsBySide[wonSide].toWon += 1;
        }

        if (stat.stat_type === 'kickout') {
          const wonSide = inferRestartWinnerSide(stat, nextStatById.get(stat?.id));
          if (wonSide === 'home' || wonSide === 'away') statsBySide[wonSide].kickoutsWon += 1;
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

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link to={createPageUrl(`MatchStats?id=${matchId}`)}>
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="w-4 h-4" /> Back
              </Button>
            </Link>
            <div className="min-w-0">
              <div className="font-semibold text-slate-900 truncate">
                {homeTeam?.name || 'Home'} vs {awayTeam?.name || 'Away'}
              </div>
              <div className="text-xs text-slate-500 truncate">
                {match?.date || ''}{match?.venue ? ` - ${match.venue}` : ''}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  ShotArc
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-2">
                <div className="flex flex-col gap-1">
                  <Button type="button" variant="ghost" className="justify-start" onClick={handleShotArcExport}>Export</Button>
                  <Button type="button" variant="ghost" className="justify-start" onClick={handleShotArcImportClick}>Import</Button>
                  <Button type="button" variant="ghost" className="justify-start" onClick={toggleShotArcInfo}>Game Info</Button>
                </div>
                {shotArcInfoOpen && (
                  <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3">
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
                )}
              </PopoverContent>
            </Popover>
            <input
              ref={shotArcImportInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleShotArcImportChange}
            />
            <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => setDataOpen(true)}>
              <BarChart3 className="w-4 h-4" /> Data
            </Button>
            {!readOnly && (
              <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => setShareOpen(true)}>
                <Share2 className="w-4 h-4" /> Share
              </Button>
            )}
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 py-5">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <TabsList>
              <TabsTrigger value="summary">Overview</TabsTrigger>
              <TabsTrigger value="scoring">Shooting</TabsTrigger>
              <TabsTrigger value="possessions">Possessions</TabsTrigger>
              <TabsTrigger value="build_up">Build-Up</TabsTrigger>
              <TabsTrigger value="kickouts">Restarts</TabsTrigger>
              <TabsTrigger value="defense">Defense</TabsTrigger>
              <TabsTrigger value="players_ana">Players</TabsTrigger>
              <TabsTrigger value="video">Video</TabsTrigger>
            </TabsList>
            {activeTab === 'summary' && (
              <div className="w-[150px] ml-auto">
                <Select value={overviewHalf} onValueChange={setOverviewHalf}>
                  <SelectTrigger className="h-9 border-slate-200 bg-white/90 text-xs font-semibold text-slate-900 shadow-sm">
                    <SelectValue placeholder="All Halves" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Halves</SelectItem>
                    <SelectItem value="first">1st Half</SelectItem>
                    <SelectItem value="second">2nd Half</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {showTopFiltersButton && activeTab !== 'summary' && activeTab !== 'video' && (
              <Popover open={topFiltersOpen} onOpenChange={setTopFiltersOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="ml-auto gap-2">
                    <SlidersHorizontal className="h-4 w-4" />
                    Filters
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[320px] max-w-[90vw] max-h-[80vh] overflow-y-auto p-4">
                  <div className="space-y-4">
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
                            <div className="space-y-1">
                              <Label className="text-xs text-slate-600">Attack Type</Label>
                              <Select value={scoringAttackType} onValueChange={setScoringAttackType}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="any">Any</SelectItem>
                                  <SelectItem value="attack_type_set">Set</SelectItem>
                                  <SelectItem value="attack_type_transition">Transition</SelectItem>
                                  <SelectItem value="attack_type_transition_to_set">Transition-&gt;Set</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </details>
                      </>
                    )}
                    {activeTab === 'possessions' && (
                      <>
                        <div className="font-semibold text-slate-900">Possessions Filters</div>
                        <div className="space-y-1">
                          <Label className="text-xs text-slate-600">Team</Label>
                          <Select value={reportFilters.team} onValueChange={reportFilters.setTeam}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="both">Both</SelectItem>
                              <SelectItem value="home">{homeTeam?.name || 'Home'}</SelectItem>
                              <SelectItem value="away">{awayTeam?.name || 'Away'}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
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
                        <div className="space-y-1">
                          <Label className="text-xs text-slate-600">Attack Type</Label>
                          <Select value={possessionsAttackTypeFilter} onValueChange={setPossessionsAttackTypeFilter}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="any">Any</SelectItem>
                              <SelectItem value="attack_type_set">Set</SelectItem>
                              <SelectItem value="attack_type_transition">Transition</SelectItem>
                              <SelectItem value="attack_type_transition_to_set">Transition-&gt;Set</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
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
                        <div className="space-y-1">
                          <Label className="text-xs text-slate-600">Turnover Result</Label>
                          <Select value={defenseTurnoverResult} onValueChange={setDefenseTurnoverResult}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="both">Both</SelectItem>
                              <SelectItem value="won">Won</SelectItem>
                              <SelectItem value="lost">Lost</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </>
                    )}
                    {activeTab === 'players_ana' && (
                      <>
                        <div className="font-semibold text-slate-900">Players Filters</div>
                        <ReportFiltersFields reportFilters={{ ...reportFilters, allowedActionTypes: ['shot', 'pass', 'carry', 'turnover', 'foul', 'kickout', 'throw_in'] }} playerOptions={playerOptions} homeTeam={homeTeam} awayTeam={awayTeam} showPlayer={false} showAction={false} showOutcome={false} timeBeforeAction />
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
            )}
          </div>

          <TabsContent value="summary">
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

          <TabsContent value="scoring">
            <ScoringTab
              stats={filteredForScoring}
              simStats={filteredForScoringWp}
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

          <TabsContent value="possessions">
            <PossessionsTab
              stats={stats}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              playerOptions={playerOptions}
              reportFilters={reportFilters}
              onOpenVideoAt={openSharedVideoAt}
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

          <TabsContent value="build_up">
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

          <TabsContent value="kickouts">
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

          <TabsContent value="defense">
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

          <TabsContent value="players_ana">
            <PlayersAnalyticsTab
              stats={stats}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              playerOptions={playerOptions}
              reportFilters={reportFilters}
              onPlayerSelect={openPlayerProfile}
              focusPlayerId={playersFocusPlayerId}
              setFocusPlayerId={setPlayersFocusPlayerId}
            />
          </TabsContent>

          <TabsContent value="video">
            <DataTab
              matchId={matchId}
              match={match}
              stats={stats}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              homePlayers={effectiveHomePlayers}
              awayPlayers={effectiveAwayPlayers}
              readOnly={readOnly}
              mode="video"
            />
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={dataOpen} onOpenChange={setDataOpen}>
        <DialogContent className="max-w-7xl w-[96vw] max-h-[92vh] p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-0">
            <DialogTitle>Data</DialogTitle>
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
              readOnly={readOnly}
              mode="data"
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={playerProfileOpen} onOpenChange={setPlayerProfileOpen}>
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
              selectedPlayer={selectedPlayerProfileOption}
              readOnly={readOnly}
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
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

      <Dialog open={sharedVizOpen} onOpenChange={setSharedVizOpen}>
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

