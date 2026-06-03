const db = globalThis.__B44_DB__ || {
  entities: new Proxy({}, { get: () => ({ filter: async () => [], get: async () => null, create: async () => ({}), update: async () => ({}), delete: async () => ({}) }) }),
};

import React, { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Download, FileJson } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { createPageUrl } from '@/utils';
import { DEFENCE_SET_MIGRATION_VERSION, buildDataHealthChecks, getAttackEntryChannelForPossession, getMatchTimeS, getSetDefenceValue, isAttackPossession, isProgressive as isProgressiveShared, oppositeTeamSide, shouldExcludeFromTotals } from '@/lib/reportAnalytics';
import { softDeleteServerStat, updateServerStat } from '@/lib/serverSync';
import {
  safeParseJSON,
  toTitleCase,
  formatMMSS,
  formatMatchClock,
  formatExtraValue,
  flattenExtra,
  presentablePathLabel,
  collectPlayerIds,
  PitchViz,
  MultiSelect,
  MatchTimeRangeSlider,
  RangeSliderField,
  statMatchesDisplayTimeRange,
  computeImputedNormalizedTimes,
  deriveOutcome,
  derivePossessionOutcome,
  inferPossessionStartSource,
  statMatchesActionType,
  teamRowTint,
  applyNonTeamReportFilters,
  groupByPossession,
  getPossessionStartZone,
  deriveAttackTypeState,
  SortableTableHead,
  sortRows,
} from '../shared';

const VIDEO_PLAY_ACTION_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'shot', label: 'Shot' },
  { value: 'pass', label: 'Pass' },
  { value: 'carry', label: 'Carry' },
  { value: 'kickout', label: 'Kickout' },
  { value: 'turnover', label: 'Turnover' },
  { value: 'foul', label: 'Foul' },
  { value: 'def_pressure', label: 'Def Pressure' },
  { value: 'substitution', label: 'Substitution' },
];

const VIDEO_PREVIEW_COUNT = 5;
const POSSESSION_OUTCOME_GROUPS = ['Score', 'Missed Shot', 'Turnover', 'Half End'];
const POSSESSION_ORIGIN_GROUPS = ['Own KO Won', 'Opp KO Won', 'Turnover Won', 'Shot Missed (Live Ball)', 'Throw In Won'];
const POSSESSION_START_ZONES = ['Defensive Third', 'Middle Third', 'Attacking Third'];
const VIDEO_FIELD_STACK_CLASS = 'flex min-h-[84px] flex-col justify-start gap-1.5';
const VIDEO_FIELD_LABEL_CLASS = 'flex min-h-[20px] items-center text-xs text-slate-600';
const VIDEO_CONTROL_CLASS = 'h-10 border-slate-200 bg-white text-xs shadow-sm';

function formatSelectionLabel(selection) {
  if (!selection || typeof selection !== 'object') return '';
  if (selection.kind === 'player') {
    const number = Number(selection?.number);
    const name = String(selection?.name || '').trim();
    return `${Number.isFinite(number) ? `#${number} ` : ''}${name}`.trim();
  }
  if (selection.kind === 'team') return selection.team_side === 'away' ? 'Away Team' : 'Home Team';
  return '';
}

function normalizeShotType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === '2 point' || raw === '2-point' || raw === '2point') return '2_point';
  return raw.replace(/\s+/g, '_');
}

function normalizeShotSituation(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'play') return 'play';
  if (raw === 'free from ground' || raw === 'free_ground') return 'free_ground';
  if (raw === 'free from hands' || raw === 'free_hands') return 'free_hands';
  if (raw === '45' || raw === '45m') return '45';
  if (raw === 'mark') return 'mark';
  if (raw === 'penalty') return 'penalty';
  return raw.replace(/\s+/g, '_');
}

function formatPossessionOriginLabel(possession, { grouped = true } = {}) {
  const startSource = String(possession?.startSource || '');
  if (['Shot Short', 'Shot Blocked', 'Shot Post', 'Shot Saved'].includes(startSource)) {
    return grouped ? 'Shot Missed (Live Ball)' : startSource;
  }
  if (startSource !== 'Kickout Won') return startSource;
  const firstStat = Array.isArray(possession?.stats) ? possession.stats[0] : null;
  const kickoutStat = firstStat?.stat_type === 'kickout'
    ? firstStat
    : (possession?.previousStat?.stat_type === 'kickout' ? possession.previousStat : null);
  const kickoutTeamSide = kickoutStat?.team_side;
  if (kickoutTeamSide === 'home' || kickoutTeamSide === 'away') {
    return kickoutTeamSide === possession?.teamSide ? 'Own KO Won' : 'Opp KO Won';
  }
  return 'Own KO Won';
}

function getPitchThirdLabel(x) {
  const value = Number(x);
  if (!Number.isFinite(value)) return 'Unknown';
  if (value < 48) return 'Defensive Third';
  if (value < 96) return 'Middle Third';
  return 'Attacking Third';
}

function getKickoutSideLabel(stat) {
  const y = Number(stat?.end_y_position ?? stat?.y_position);
  if (!Number.isFinite(y)) return 'Unknown';
  if (y < 48 / 3) return 'Left';
  if (y < (48 * 2) / 3) return 'Middle';
  return 'Right';
}

function getKickoutLengthLabel(stat) {
  const extra = safeParseJSON(stat?.extra_data || '{}', {});
  const value = String(extra?.kickout?.distance || extra?.kickout?.length || '').trim().toLowerCase();
  if (value === 'short' || value === 'long') return toTitleCase(value);
  const startX = Number(stat?.x_position);
  const startY = Number(stat?.y_position);
  const endX = Number(stat?.end_x_position);
  const endY = Number(stat?.end_y_position);
  if ([startX, startY, endX, endY].every(Number.isFinite)) {
    const distance = Math.hypot(endX - startX, endY - startY);
    return distance >= 45 ? 'Long' : 'Short';
  }
  return 'Unknown';
}

function getKickoutOutcomeLabel(stat) {
  const extra = safeParseJSON(stat?.extra_data || '{}', {});
  const outcome = String(extra?.kickout?.outcome || '').trim().toLowerCase();
  return outcome ? formatDisplayOutcome(outcome) : 'Unknown';
}

function getKickoutPressLabel(stat) {
  const extra = safeParseJSON(stat?.extra_data || '{}', {});
  const value = String(extra?.kickout?.press || '').trim().toLowerCase();
  if (!value) return 'Unknown';
  if (value === 'm2m') return 'M2M';
  return toTitleCase(value);
}

function getKickoutTargetLabel(stat) {
  const extra = safeParseJSON(stat?.extra_data || '{}', {});
  const target = extra?.kickout?.intended_recipient;
  if (target?.kind === 'player') {
    const n = Number(target?.number);
    return `${Number.isFinite(n) ? `#${n} ` : ''}${String(target?.name || '').trim()}`.trim() || 'Player';
  }
  if (target?.kind === 'team') return target.team_side === 'away' ? 'Away Team' : 'Home Team';
  return 'Unknown';
}

function getSelectionLabel(selection) {
  if (!selection || typeof selection !== 'object') return '';
  if (selection.kind === 'team') return selection.team_side === 'away' ? 'Away Team' : 'Home Team';
  if (selection.kind === 'player') {
    const number = Number(selection?.number);
    const name = String(selection?.name || '').trim();
    return `${Number.isFinite(number) ? `#${number} ` : ''}${name}`.trim() || 'Player';
  }
  return '';
}

function getTurnoverClassification(stat) {
  const extra = safeParseJSON(stat?.extra_data || '{}', {});
  const turnover = extra?.turnover || {};
  const lost = turnover?.lost_by?.team_side || null;
  const recovered = turnover?.recovered_by?.team_side || turnover?.forced_by?.team_side || null;
  const type = String(turnover?.type || turnover?.turnover_type || extra?.turnover_type || '').trim();
  return {
    result: recovered ? 'won' : lost ? 'lost' : '',
    type: type || 'unknown',
  };
}

function formatDisplayOutcome(value) {
  const text = String(value || '').trim();
  if (!text) return 'NA';
  return toTitleCase(text.replaceAll('_', ' '));
}

function getSecondaryPlayerForEvent(stat) {
  const extra = safeParseJSON(stat?.extra_data || '{}', {});
  const turnoverWinner = extra?.turnover?.recovered_by || extra?.turnover?.forced_by;

  const action = String(stat?.stat_type || '');
  if (action === 'pass') {
    return formatSelectionLabel(extra?.pass?.won_by) || formatSelectionLabel(extra?.pass?.intended_recipient);
  }
  if (action === 'carry') {
    return formatSelectionLabel(extra?.carry?.won_by) || formatSelectionLabel(extra?.carry?.carrier);
  }
  if (action === 'kickout') {
    return formatSelectionLabel(extra?.kickout?.lost_by) || formatSelectionLabel(extra?.kickout?.intended_recipient);
  }
  if (action === 'turnover') {
    return formatSelectionLabel(turnoverWinner);
  }
  if (action === 'foul') {
    return formatSelectionLabel(extra?.foul?.foul_on_or_forced_by) || formatSelectionLabel(extra?.foul?.foul_on) || formatSelectionLabel(extra?.foul?.foul_by);
  }
  if (action === 'throw_in') {
    return formatSelectionLabel(extra?.throw_in?.won_by);
  }
  return '';
}

function getPrimaryPlayerForEvent(stat) {
  const extra = safeParseJSON(stat?.extra_data || '{}', {});
  const action = String(stat?.stat_type || '');
  const defaultLabel = `${stat?.player_number ? `#${stat.player_number} ` : ''}${String(stat?.player_name || '').trim()}`.trim();
  if (action === 'kickout') {
    return formatSelectionLabel(extra?.kickout?.won_by) || formatSelectionLabel(extra?.kickout?.intended_recipient) || defaultLabel;
  }
  if (action === 'turnover') {
    return formatSelectionLabel(extra?.turnover?.lost_by) || defaultLabel || formatSelectionLabel(extra?.turnover?.recovered_by) || formatSelectionLabel(extra?.turnover?.forced_by);
  }
  return defaultLabel;
}

function getDefPressureContext(stat) {
  const extra = safeParseJSON(stat?.extra_data || '{}', {});
  const statType = String(stat?.stat_type || '').trim().toLowerCase();
  const carryDefender = extra?.carry?.defender;
  const foulBy = extra?.foul?.foul_by;
  const embeddedDefender = extra?.def_pressure?.defender;
  const turnoverForcedBy = extra?.turnover?.forced_by;
  const passRecipient = extra?.pass?.won_by || extra?.pass?.intended_recipient || null;
  const pressureLevel = String(
    extra?.def_pressure?.pressure
      || extra?.pass?.pressure_on_passer
      || extra?.carry?.pressure_on_carrier
      || ''
  ).trim().toLowerCase();
  const attackingAction = String(extra?.def_pressure?.action || stat?.stat_type || '').trim().toLowerCase();
  const attacker = formatSelectionLabel(extra?.def_pressure?.attacker)
    || formatSelectionLabel(extra?.carry?.carrier)
    || formatSelectionLabel(passRecipient)
    || formatSelectionLabel(extra?.foul?.foul_on)
    || `${stat?.player_number ? `#${stat.player_number} ` : ''}${String(stat?.player_name || '').trim()}`.trim();
  const attackerId = String(extra?.def_pressure?.attacker?.id || extra?.carry?.carrier?.id || passRecipient?.id || extra?.foul?.foul_on?.id || stat?.player_id || '');
  const defenderSelection = embeddedDefender || carryDefender || foulBy || turnoverForcedBy || null;
  const defender = formatSelectionLabel(defenderSelection);
  const defenderId = String(defenderSelection?.id || '');
  const defendingSide = defenderSelection?.team_side || oppositeTeamSide(stat?.team_side);
  const isHighPressure = pressureLevel === 'high' || String(extra?.def_pressure?.pressure || '').trim().toLowerCase() === 'high';
  return {
    hasPressure: statType !== 'shot' && (isHighPressure || statType === 'def_pressure'),
    pressureLevel,
    attackingAction,
    attacker,
    attackerId,
    defender,
    defenderId,
    defendingSide,
    outcome: String(deriveOutcome(stat, extra) || '').trim(),
    zone: getPitchThirdLabel(stat?.x_position),
  };
}

function sortStatsForEditing(list, match, imputedTimeById) {
  const timeKey = (s) => {
    const play = Number(s?.play_id);
    if (Number.isFinite(play)) return { kind: 0, v: play };
    const mt = getMatchTimeS(s, match, imputedTimeById);
    if (Number.isFinite(mt)) return { kind: 1, v: mt };
    const t = Number(s?.time_s);
    if (Number.isFinite(t)) return { kind: 2, v: t };
    const ts = Date.parse(String(s?.timestamp || ''));
    if (Number.isFinite(ts)) return { kind: 3, v: ts };
    return { kind: 9, v: 0 };
  };

  return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    const ka = timeKey(a);
    const kb = timeKey(b);
    if (ka.kind !== kb.kind) return ka.kind - kb.kind;
    if (ka.v !== kb.v) return ka.v - kb.v;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
}

function getPossessionKey(stat) {
  const pid = Number(stat?.possession_id);
  const side = stat?.possession_team_side;
  return Number.isFinite(pid) && (side === 'home' || side === 'away') ? `${side}-${pid}` : 'unknown';
}

function teamColor(side, homeTeam, awayTeam) {
  if (side === 'away') return awayTeam?.color || '#ef4444';
  if (side === 'home') return homeTeam?.color || '#22c55e';
  return '#cbd5e1';
}

function dataRowStyle(stat, homeTeam, awayTeam) {
  const possessionStyle = stat?.possession_team_side === 'home' || stat?.possession_team_side === 'away'
    ? teamRowTint(stat.possession_team_side, homeTeam?.color, awayTeam?.color, 0.075)
    : {};
  return {
    ...possessionStyle,
    borderLeft: `6px solid ${teamColor(stat?.team_side, homeTeam, awayTeam)}`,
  };
}

function possessionRowStyle(stat, homeTeam, awayTeam) {
  return stat?.possession_team_side === 'home' || stat?.possession_team_side === 'away'
    ? teamRowTint(stat.possession_team_side, homeTeam?.color, awayTeam?.color, 0.04)
    : {};
}

function getContiguousRange(ordered, index, mode) {
  if (!Array.isArray(ordered) || index < 0 || index >= ordered.length) return [];
  if (mode === 'row_only') return [index];
  const key = getPossessionKey(ordered[index]);
  if (mode === 'row_tail') {
    const indices = [];
    for (let i = index; i < ordered.length; i += 1) {
      if (i > index && getPossessionKey(ordered[i]) !== key) break;
      indices.push(i);
    }
    return indices;
  }
  if (mode === 'entire_possession') {
    let start = index;
    let end = index;
    while (start - 1 >= 0 && getPossessionKey(ordered[start - 1]) === key) start -= 1;
    while (end + 1 < ordered.length && getPossessionKey(ordered[end + 1]) === key) end += 1;
    return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
  }
  return [index];
}

function findAdjacentPossession(ordered, index, direction) {
  if (!Array.isArray(ordered) || index < 0 || index >= ordered.length) return null;
  const currentKey = getPossessionKey(ordered[index]);
  const step = direction === 'next' ? 1 : -1;
  for (let i = index + step; i >= 0 && i < ordered.length; i += step) {
    const key = getPossessionKey(ordered[i]);
    if (key !== currentKey) return ordered[i];
  }
  return null;
}

function formatTeamName(side, homeTeam, awayTeam) {
  if (side === 'away') return awayTeam?.name || 'Away';
  if (side === 'home') return homeTeam?.name || 'Home';
  return 'NA';
}

function safeFilePart(value, fallback = 'match') {
  const text = String(value || fallback).trim().toLowerCase();
  return (text.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback).slice(0, 80);
}

function downloadTextFile(content, fileName, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function normalizePassAccuracy(value) {
  const accuracy = String(value || '').trim();
  return ['++', '+', '-', '--'].includes(accuracy) ? accuracy : '+';
}

function summarizeRow(stat, match, imputedTimeById, homeTeam, awayTeam) {
  if (!stat) return 'NA';
  const mt = getMatchTimeS(stat, match, imputedTimeById);
  const timeLabel = Number.isFinite(mt) ? formatMatchClock(mt, match, stat.half) : 'NA';
  const playLabel = Number.isFinite(Number(stat?.play_id)) ? `Play ${Number(stat.play_id)}` : 'Play NA';
  return `${playLabel} - ${toTitleCase(stat?.stat_type)} - ${formatTeamName(stat?.team_side, homeTeam, awayTeam)} - ${timeLabel}`;
}

function resequenceOrderedStats(ordered) {
  return ordered.map((stat, index) => ({ ...stat, play_id: index + 1 }));
}

function DataTab({ matchId, match, stats, homeTeam, awayTeam, homePlayers, awayPlayers, readOnly = false, mode = 'data' }) {
  const isLiveMode = String(match?.mode || 'analysis') === 'live';
  const isVideoMode = mode === 'video';
  const allowEditing = !readOnly && !isVideoMode;
  const queryClient = useQueryClient();
  const [team, setTeam] = useState('both');
  const [actions, setActions] = useState([]);
  const [halves, setHalves] = useState([]);
  const [playerIds, setPlayerIds] = useState([]);
  const [timeMin, setTimeMin] = useState('');
  const [timeMax, setTimeMax] = useState('');
  const [rowLimit, setRowLimit] = useState('200');
  const [videoBrowseMode, setVideoBrowseMode] = useState('play');
  const [videoViewMode, setVideoViewMode] = useState('table');
  const [videoPlayAction, setVideoPlayAction] = useState('all');
  const [videoPlayExpanded, setVideoPlayExpanded] = useState(false);
  const [videoPossessionExpanded, setVideoPossessionExpanded] = useState(false);
  const [selectedVideoPlayId, setSelectedVideoPlayId] = useState(null);
  const [selectedVideoPossessionKey, setSelectedVideoPossessionKey] = useState(null);
  const [videoPlaySort, setVideoPlaySort] = useState({ key: 'play', dir: 'asc' });
  const [videoPossessionSort, setVideoPossessionSort] = useState({ key: 'startTime', dir: 'asc' });
  const [videoShotTypes, setVideoShotTypes] = useState([]);
  const [videoShotSituations, setVideoShotSituations] = useState([]);
  const [videoShotPressure, setVideoShotPressure] = useState([]);
  const [videoShotMethods, setVideoShotMethods] = useState([]);
  const [videoShotOutcomes, setVideoShotOutcomes] = useState([]);
  const [videoBuildOutcomes, setVideoBuildOutcomes] = useState([]);
  const [videoBuildOriginZones, setVideoBuildOriginZones] = useState([]);
  const [videoBuildEndZones, setVideoBuildEndZones] = useState([]);
  const [videoBuildPressure, setVideoBuildPressure] = useState([]);
  const [videoBuildAccuracy, setVideoBuildAccuracy] = useState([]);
  const [videoBuildProgressive, setVideoBuildProgressive] = useState([]);
  const [videoBuildRecipientIds, setVideoBuildRecipientIds] = useState([]);
  const [videoBuildDistanceMin, setVideoBuildDistanceMin] = useState('');
  const [videoBuildDistanceMax, setVideoBuildDistanceMax] = useState('');
  const [videoCarryTakeOns, setVideoCarryTakeOns] = useState([]);
  const [videoKickoutTargets, setVideoKickoutTargets] = useState([]);
  const [videoKickoutOutcomes, setVideoKickoutOutcomes] = useState([]);
  const [videoKickoutWonBy, setVideoKickoutWonBy] = useState([]);
  const [videoKickoutLostBy, setVideoKickoutLostBy] = useState([]);
  const [videoKickoutPress, setVideoKickoutPress] = useState([]);
  const [videoKickoutLengths, setVideoKickoutLengths] = useState([]);
  const [videoKickoutSides, setVideoKickoutSides] = useState([]);
  const [videoTurnoverTypes, setVideoTurnoverTypes] = useState([]);
  const [videoTurnoverWonBy, setVideoTurnoverWonBy] = useState([]);
  const [videoTurnoverLostBy, setVideoTurnoverLostBy] = useState([]);
  const [videoTurnoverRecoveredBy, setVideoTurnoverRecoveredBy] = useState([]);
  const [videoFoulTypes, setVideoFoulTypes] = useState([]);
  const [videoFoulOn, setVideoFoulOn] = useState([]);
  const [videoFoulBy, setVideoFoulBy] = useState([]);
  const [videoDefPressureOutcomes, setVideoDefPressureOutcomes] = useState([]);
  const [videoDefPressureActions, setVideoDefPressureActions] = useState([]);
  const [videoDefPressureZones, setVideoDefPressureZones] = useState([]);
  const [videoDefPressureAttackers, setVideoDefPressureAttackers] = useState([]);
  const [videoPossessionTeam, setVideoPossessionTeam] = useState('both');
  const [videoPossessionHalves, setVideoPossessionHalves] = useState([]);
  const [videoPossessionTimeMin, setVideoPossessionTimeMin] = useState('');
  const [videoPossessionTimeMax, setVideoPossessionTimeMax] = useState('');
  const [videoPossessionOutcomeFilter, setVideoPossessionOutcomeFilter] = useState([]);
  const [videoPossessionOriginFilter, setVideoPossessionOriginFilter] = useState([]);
  const [videoPossessionStartZoneFilter, setVideoPossessionStartZoneFilter] = useState([]);
  const groupBy = 'none';
  const [vizOpen, setVizOpen] = useState(false);
  const [vizTitle, setVizTitle] = useState('');
  const [vizStats, setVizStats] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [expandedRowId, setExpandedRowId] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editStatId, setEditStatId] = useState(null);
  const [editScope, setEditScope] = useState('row_tail');
  const [targetPossessionId, setTargetPossessionId] = useState('');
  const [targetPossessionTeam, setTargetPossessionTeam] = useState('home');
  const [newPossessionTeam, setNewPossessionTeam] = useState('home');
  const [moveTargetId, setMoveTargetId] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedPlayId, setAdvancedPlayId] = useState('');
  const [advancedPossessionId, setAdvancedPossessionId] = useState('');
  const [advancedPossessionTeam, setAdvancedPossessionTeam] = useState('home');
  const [rawEditOpen, setRawEditOpen] = useState(false);
  const [rawStatType, setRawStatType] = useState('');
  const [rawTeamSide, setRawTeamSide] = useState('home');
  const [rawHalf, setRawHalf] = useState('first');
  const [rawSetDefence, setRawSetDefence] = useState(false);
  const [rawTimeS, setRawTimeS] = useState('');
  const [rawNormalizedTimeS, setRawNormalizedTimeS] = useState('');
  const [rawPlayerName, setRawPlayerName] = useState('');
  const [rawPlayerNumber, setRawPlayerNumber] = useState('');
  const [rawRecipientName, setRawRecipientName] = useState('');
  const [rawRecipientNumber, setRawRecipientNumber] = useState('');
  const [rawExtraJson, setRawExtraJson] = useState('{}');
  const structuredExtra = useMemo(() => safeParseJSON(rawExtraJson || '{}', {}), [rawExtraJson]);
  const setStructuredExtraValue = (section, key, value) => {
    const next = safeParseJSON(rawExtraJson || '{}', {});
    next[section] = { ...(next[section] || {}), [key]: value };
    setRawExtraJson(JSON.stringify(next, null, 2));
  };

  const setStructuredRootValue = (key, value) => {
    const next = safeParseJSON(rawExtraJson || '{}', {});
    next[key] = value;
    setRawExtraJson(JSON.stringify(next, null, 2));
  };

  const VIDEO_PRE_ROLL_S = 5;

  const persistMutation = useMutation({
    mutationFn: async (updates) => {
      const touchedManualIds = updates.some((update) => {
        const data = update?.data || {};
        return Object.prototype.hasOwnProperty.call(data, 'play_id')
          || Object.prototype.hasOwnProperty.call(data, 'possession_id')
          || Object.prototype.hasOwnProperty.call(data, 'possession_team_side');
      });
      for (const update of updates) {
        const updated = await db.entities.StatEntry.update(update.id, update.data);
        if (updated?.server_stat_id) {
          try {
            await updateServerStat(updated.server_stat_id, update.data);
          } catch {
            // Local edits remain the source of truth if optional server sync is unavailable.
          }
        }
      }
      return { count: updates.length, touchedManualIds };
    },
    onSuccess: async ({ count, touchedManualIds }) => {
      if (touchedManualIds) {
        try { localStorage.setItem(`gstl-manual-possession-edits:${matchId}`, 'done'); } catch {}
      }
      await queryClient.invalidateQueries({ queryKey: ['stats', matchId] });
      await queryClient.refetchQueries({ queryKey: ['stats', matchId], type: 'active' });
      toast.success(count === 1 ? 'ID update saved' : `${count} rows updated`);
      setEditOpen(false);
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to update IDs');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (stat) => {
      if (!stat?.id) throw new Error('No row selected');
      await db.entities.StatEntry.delete(stat.id);
      if (stat.server_stat_id) {
        try {
          await softDeleteServerStat(stat.server_stat_id);
        } catch {
          // Local delete should still succeed if server sync is unavailable.
        }
      }
      return stat;
    },
    onSuccess: async (deletedStat) => {
      setDeleteTarget(null);
      setExpandedRowId((cur) => (cur === deletedStat?.id ? null : cur));
      if (editStatId === deletedStat?.id) {
        setEditOpen(false);
        setEditStatId(null);
      }
      await queryClient.invalidateQueries({ queryKey: ['stats', matchId] });
      await queryClient.refetchQueries({ queryKey: ['stats', matchId], type: 'active' });
      toast.success('Row deleted');
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to delete row');
    },
  });

  const openVideoAt = (timeS) => {
    const t = Number(timeS);
    if (!matchId || !Number.isFinite(t)) return;
    const seekTo = Math.max(0, Math.floor(t - VIDEO_PRE_ROLL_S));
    const url = `${window.location.origin}${window.location.pathname}#${createPageUrl(`Video?matchId=${matchId}`)}`;
    window.open(url, 'gstl_video', 'popup=yes,width=1100,height=650');
    try {
      const ch = new BroadcastChannel('gstl_video');
      const msg = { matchId, type: 'SEEK_TO', time_s: seekTo };
      ch.postMessage(msg);
      setTimeout(() => ch.postMessage(msg), 350);
      setTimeout(() => {
        ch.postMessage(msg);
        ch.close();
      }, 900);
    } catch {
      // ignore
    }
  };

  const playerOptions = useMemo(() => {
    const all = [
      ...(homePlayers || []).map((p) => ({ ...p, team_side: 'home' })),
      ...(awayPlayers || []).map((p) => ({ ...p, team_side: 'away' })),
    ];
    const label = (p) => `#${p.number || ''} ${p.name || ''}`.trim();
    return all
      .slice()
      .sort((a, b) => (a.team_side === b.team_side ? (a.number || 0) - (b.number || 0) : (a.team_side === 'home' ? -1 : 1)))
      .map((p) => ({ id: p.id, team_side: p.team_side, number: p.number ?? null, name: p.name || '', label: label(p) || p.id }));
  }, [homePlayers, awayPlayers]);

  const selectionOptions = useMemo(() => ([
    { value: 'none', label: 'None' },
    { value: 'team:home', label: `${homeTeam?.name || 'Home'} Team` },
    { value: 'team:away', label: `${awayTeam?.name || 'Away'} Team` },
    ...playerOptions.map((p) => ({ value: `player:${p.id}`, label: `${p.team_side === 'away' ? 'Away' : 'Home'}: ${p.label}` })),
  ]), [playerOptions, homeTeam, awayTeam]);

  const labelledPlayerOptions = useMemo(
    () => playerOptions.map((p) => ({ value: p.id, label: `${p.team_side === 'away' ? 'Away' : 'Home'}: ${p.label}` })),
    [playerOptions]
  );

  const kickoutWonByOptions = useMemo(() => {
    const baseOptions = [
      { value: 'home_team', label: homeTeam?.name || 'Home' },
      { value: 'away_team', label: awayTeam?.name || 'Away' },
    ];
    const playerItems = playerOptions.map((player) => ({
      value: player.id,
      label: `${player.team_side === 'away' ? 'Away' : 'Home'}: ${player.label}`,
      teamSort: player.team_side === 'home' ? 0 : 1,
      numberSort: Number(player.number) || 999,
    }));
    playerItems.sort((a, b) => (a.teamSort - b.teamSort) || (a.numberSort - b.numberSort) || a.label.localeCompare(b.label));
    return [...baseOptions, ...playerItems.map(({ value, label }) => ({ value, label }))];
  }, [playerOptions, homeTeam, awayTeam]);

  const selectionToEditValue = (sel) => {
    if (!sel || typeof sel !== 'object') return 'none';
    if (sel.kind === 'team') return `team:${sel.team_side || 'home'}`;
    if (sel.kind === 'player' && sel.id) return `player:${sel.id}`;
    return 'none';
  };

  const editValueToSelection = (value) => {
    const v = String(value || 'none');
    if (v.startsWith('team:')) return { kind: 'team', team_side: v.split(':')[1] || 'home' };
    if (v.startsWith('player:')) {
      const id = v.slice('player:'.length);
      const p = playerOptions.find((row) => row.id === id);
      return { kind: 'player', id, number: p?.number ?? null, name: p?.name || String(p?.label || '').replace(/^#\d+\s*/, ''), team_side: p?.team_side || 'unknown' };
    }
    return { kind: 'none' };
  };

  const setStructuredSelectionValue = (section, key, value) => {
    setStructuredExtraValue(section, key, editValueToSelection(value));
  };

  const FieldSelect = ({ label, value, onChange, options }) => (
    <div className="space-y-1">
      <Label className="text-xs text-slate-600">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  const FieldInput = ({ label, value, onChange, numeric = false }) => (
    <div className="space-y-1">
      <Label className="text-xs text-slate-600">{label}</Label>
      <Input className="h-8 text-xs" inputMode={numeric ? 'numeric' : undefined} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    </div>
  );

  const FieldBool = ({ label, value, onChange }) => (
    <FieldSelect
      label={label}
      value={value ? 'yes' : 'no'}
      onChange={(v) => onChange(v === 'yes')}
      options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]}
    />
  );

  const SelectionField = ({ label, section, field }) => (
    <FieldSelect
      label={label}
      value={selectionToEditValue(structuredExtra?.[section]?.[field])}
      onChange={(v) => setStructuredSelectionValue(section, field, v)}
      options={selectionOptions}
    />
  );

  const renderFoulFields = (title = 'Foul Details') => (
    <div className="rounded-lg border border-rose-200 bg-rose-50/40 p-3 space-y-2">
      <div className="text-xs font-semibold text-rose-900">{title}</div>
      <div className="grid md:grid-cols-4 gap-3">
        <SelectionField label="Foul By" section="foul" field="foul_by" />
        <SelectionField label="Foul On" section="foul" field="foul_on" />
        <FieldSelect
          label="Foul Type"
          value={structuredExtra?.foul?.foul_type || 'pull'}
          onChange={(v) => setStructuredExtraValue('foul', 'foul_type', v)}
          options={['pull', 'push', 'trip', 'block', 'charge', 'hold', 'bodycheck', 'throw', 'breach', 'other'].map((v) => ({ value: v, label: toTitleCase(v) }))}
        />
        <FieldSelect
          label="Card"
          value={structuredExtra?.foul?.card || 'none'}
          onChange={(v) => setStructuredExtraValue('foul', 'card', v)}
          options={['none', 'yellow', 'black', 'red'].map((v) => ({ value: v, label: v === 'none' ? 'NA' : toTitleCase(v) }))}
        />
      </div>
    </div>
  );

  const renderTurnoverFields = (title = 'Turnover Details') => (
    <div className="rounded-lg border border-orange-200 bg-orange-50/40 p-3 space-y-2">
      <div className="text-xs font-semibold text-orange-900">{title}</div>
      <div className="grid md:grid-cols-5 gap-3">
        <FieldSelect
          label="Turnover Type"
          value={structuredExtra?.turnover?.turnover_type || 'interception'}
          onChange={(v) => setStructuredExtraValue('turnover', 'turnover_type', v)}
          options={['interception', 'tackle', 'foul', 'handling_error', 'bad_pass', 'sideline_against', 'sideline_for', 'other'].map((v) => ({ value: v, label: toTitleCase(v) }))}
        />
        <SelectionField label="Lost By" section="turnover" field="lost_by" />
        <SelectionField label="Forced By" section="turnover" field="forced_by" />
        {structuredExtra?.turnover?.turnover_type !== 'foul' && <SelectionField label="Recovered By" section="turnover" field="recovered_by" />}
        <FieldBool label="Brought Back - Adv." value={!!structuredExtra?.turnover?.brought_back_adv} onChange={(v) => setStructuredExtraValue('turnover', 'brought_back_adv', v)} />
      </div>
      {structuredExtra?.turnover?.turnover_type === 'foul' && renderFoulFields('Foul Turnover Fields')}
    </div>
  );

  const imputedTimeById = useMemo(() => computeImputedNormalizedTimes(stats), [stats]);
  const healthChecks = useMemo(() => buildDataHealthChecks(stats), [stats]);
  const healthSummary = useMemo(() => ({
    errors: healthChecks.filter((c) => c.severity === 'error').length,
    warnings: healthChecks.filter((c) => c.severity !== 'error').length,
  }), [healthChecks]);
  const orderedAllStats = useMemo(() => sortStatsForEditing(stats, match, imputedTimeById), [stats, match, imputedTimeById]);
  const maxPossessionId = useMemo(() => orderedAllStats.reduce((max, stat) => {
    const pid = Number(stat?.possession_id);
    return Number.isFinite(pid) ? Math.max(max, pid) : max;
  }, 0), [orderedAllStats]);

  const filtered = useMemo(() => {
    const list = Array.isArray(stats) ? stats : [];
    return list.filter((s) => {
      if (!s) return false;
      if (team !== 'both' && s.team_side !== team) return false;
      if (actions.length && !actions.some((value) => statMatchesActionType(s, value))) return false;
      if (halves.length && !halves.includes(s.half)) return false;
      if (playerIds.length) {
        const extra = safeParseJSON(s.extra_data || '{}', {});
        const ids = collectPlayerIds(extra);
        const any = playerIds.some((id) => ids.has(String(id)));
        if (!any) return false;
      }
      if (!statMatchesDisplayTimeRange(s, {
        timeMin,
        timeMax,
        match,
        imputedTimeById,
        stats: list,
      })) return false;
      return true;
    });
  }, [stats, team, actions, halves, playerIds, timeMin, timeMax, imputedTimeById, match]);

  const videoGenericFiltered = useMemo(() => {
    const list = Array.isArray(stats) ? stats : [];
    return list.filter((s) => {
      if (!s) return false;
      const defPressureContext = videoPlayAction === 'def_pressure' ? getDefPressureContext(s) : null;
      if (team !== 'both') {
        if (videoPlayAction === 'def_pressure') {
          if (defPressureContext?.defendingSide !== team) return false;
        } else if (s.team_side !== team) return false;
      }
      if (halves.length && !halves.includes(s.half)) return false;
      if (playerIds.length) {
        let any = false;
        if (videoPlayAction === 'def_pressure') {
          const defenderId = String(defPressureContext?.defenderId || '');
          any = Boolean(defenderId) && playerIds.some((id) => String(id) === defenderId);
        } else {
          const extra = safeParseJSON(s.extra_data || '{}', {});
          const ids = collectPlayerIds(extra);
          any = playerIds.some((id) => ids.has(String(id)));
        }
        if (!any) return false;
      }
      if (!statMatchesDisplayTimeRange(s, {
        timeMin,
        timeMax,
        match,
        imputedTimeById,
        stats: list,
      })) return false;
      return true;
    });
  }, [stats, team, halves, playerIds, timeMin, timeMax, imputedTimeById, match, videoPlayAction]);

  const videoPlayRows = useMemo(() => {
    const list = videoGenericFiltered.filter((stat) => {
      const extra = safeParseJSON(stat?.extra_data || '{}', {});
      const statType = String(stat?.stat_type || '').trim().toLowerCase();
      const isSubstitution = statType === 'substitution';
      const defPressureContext = getDefPressureContext(stat);
      if (videoPlayAction === 'all') {
        if (isSubstitution || statType === 'def_pressure') return false;
      } else if (videoPlayAction === 'substitution') {
        if (!isSubstitution) return false;
      } else if (videoPlayAction === 'def_pressure') {
        if (!defPressureContext.hasPressure) return false;
      } else if (!statMatchesActionType(stat, videoPlayAction)) return false;
      if (videoPlayAction === 'shot') {
        const shot = extra?.shot || {};
        const shotType = normalizeShotType(shot?.type || shot?.shot_type || shot?.shotType || '');
        const situation = normalizeShotSituation(shot?.situation || '');
        const pressureValue = String(shot?.pressure || '').trim();
        const methodValue = String(shot?.method || '').trim();
        const outcomeValue = String(deriveOutcome(stat, extra) || '').trim();
        if (videoShotTypes.length && !videoShotTypes.includes(shotType || '')) return false;
        if (videoShotSituations.length && !videoShotSituations.includes(situation || '')) return false;
        if (videoShotPressure.length && !videoShotPressure.includes(pressureValue || '')) return false;
        if (videoShotMethods.length && !videoShotMethods.includes(methodValue || '')) return false;
        if (videoShotOutcomes.length && !videoShotOutcomes.includes(outcomeValue || '')) return false;
      }
      if (videoPlayAction === 'pass' || videoPlayAction === 'carry') {
        const outcomeValue = String(deriveOutcome(stat, extra) || '').trim();
        const pressureValue = String(videoPlayAction === 'pass' ? (extra?.pass?.pressure_on_passer || '') : (extra?.carry?.pressure_on_carrier || '')).trim();
        const startZone = getPitchThirdLabel(stat?.x_position);
        const endZone = getPitchThirdLabel(stat?.end_x_position);
        const accuracy = videoPlayAction === 'pass' ? String(extra?.pass?.accuracy || '').trim() : '';
        const recipientId = String(extra?.pass?.won_by?.id || extra?.pass?.intended_recipient?.id || '');
        const takeOnValue = String(extra?.carry?.take_on || 'no').trim().toLowerCase();
        const progressiveValue = isProgressiveShared(stat) ? 'yes' : 'no';
        const startX = Number(stat?.x_position);
        const startY = Number(stat?.y_position);
        const endX = Number(stat?.end_x_position);
        const endY = Number(stat?.end_y_position);
        const distance = [startX, startY, endX, endY].every(Number.isFinite) ? Math.hypot(endX - startX, endY - startY) : NaN;
        if (videoBuildOutcomes.length && !videoBuildOutcomes.includes(outcomeValue || '')) return false;
        if (videoBuildOriginZones.length && !videoBuildOriginZones.includes(startZone)) return false;
        if (videoBuildEndZones.length && !videoBuildEndZones.includes(endZone)) return false;
        if (videoBuildPressure.length && !videoBuildPressure.includes(pressureValue || '')) return false;
        if (videoBuildProgressive.length && !videoBuildProgressive.includes(progressiveValue)) return false;
        if (videoPlayAction === 'pass') {
          if (videoBuildAccuracy.length && !videoBuildAccuracy.includes(accuracy || '')) return false;
          if (videoBuildRecipientIds.length && !videoBuildRecipientIds.includes(recipientId)) return false;
        }
        if (videoPlayAction === 'carry' && videoCarryTakeOns.length && !videoCarryTakeOns.includes(takeOnValue || '')) return false;
        const minDistance = Number(videoBuildDistanceMin);
        const maxDistance = Number(videoBuildDistanceMax);
        if (videoBuildDistanceMin !== '' && Number.isFinite(distance) && distance < minDistance) return false;
        if (videoBuildDistanceMax !== '' && Number.isFinite(distance) && distance > maxDistance) return false;
      }
      if (videoPlayAction === 'kickout') {
        const targetLabel = getKickoutTargetLabel(stat);
        const outcomeLabel = getKickoutOutcomeLabel(stat);
        const pressLabel = getKickoutPressLabel(stat);
        const lengthLabel = getKickoutLengthLabel(stat);
        const sideLabel = getKickoutSideLabel(stat);
        const kickout = safeParseJSON(stat?.extra_data || '{}', {})?.kickout || {};
        const wonBy = kickout?.won_by;
        const lostBy = kickout?.lost_by;
        const wonById = String(wonBy?.id || '');
        const wonByTeamValue = wonBy?.team_side === 'home' ? 'home_team' : wonBy?.team_side === 'away' ? 'away_team' : '';
        const lostById = String(lostBy?.id || '');
        const lostByTeamValue = lostBy?.team_side === 'home' ? 'home_team' : lostBy?.team_side === 'away' ? 'away_team' : '';
        if (videoKickoutTargets.length && !videoKickoutTargets.includes(targetLabel)) return false;
        if (videoKickoutOutcomes.length && !videoKickoutOutcomes.includes(outcomeLabel)) return false;
        if (videoKickoutPress.length && !videoKickoutPress.includes(pressLabel)) return false;
        if (videoKickoutLengths.length && !videoKickoutLengths.includes(lengthLabel)) return false;
        if (videoKickoutSides.length && !videoKickoutSides.includes(sideLabel)) return false;
        if (videoKickoutWonBy.length && !videoKickoutWonBy.includes(wonById) && !videoKickoutWonBy.includes(wonByTeamValue)) return false;
        if (videoKickoutLostBy.length && !videoKickoutLostBy.includes(lostById) && !videoKickoutLostBy.includes(lostByTeamValue)) return false;
      }
      if (videoPlayAction === 'turnover') {
        const turnover = getTurnoverClassification(stat);
        if (videoTurnoverTypes.length && !videoTurnoverTypes.includes(turnover.type)) return false;
        const turnoverData = extra?.turnover || {};
        const wonBy = turnoverData?.recovered_by || turnoverData?.forced_by;
        const lostBy = turnoverData?.lost_by;
        const recoveredBy = turnoverData?.recovered_by;
        if (videoTurnoverWonBy.length && !videoTurnoverWonBy.includes(String(wonBy?.id || ''))) return false;
        if (videoTurnoverLostBy.length && !videoTurnoverLostBy.includes(String(lostBy?.id || ''))) return false;
        if (videoTurnoverRecoveredBy.length && !videoTurnoverRecoveredBy.includes(String(recoveredBy?.id || ''))) return false;
      }
      if (videoPlayAction === 'foul') {
        const foul = extra?.foul || extractFoulFromStat(stat) || {};
        const foulType = String(foul?.type || foul?.foul_type || '').trim().toLowerCase();
        const foulOnId = String(foul?.foul_on?.id || '');
        const foulById = String(foul?.foul_by?.id || '');
        if (videoFoulTypes.length && !videoFoulTypes.includes(foulType)) return false;
        if (videoFoulOn.length && !videoFoulOn.includes(foulOnId)) return false;
        if (videoFoulBy.length && !videoFoulBy.includes(foulById)) return false;
      }
      if (videoPlayAction === 'def_pressure') {
        if (videoDefPressureOutcomes.length && !videoDefPressureOutcomes.includes(defPressureContext.outcome || '')) return false;
        if (videoDefPressureActions.length && !videoDefPressureActions.includes(defPressureContext.attackingAction || '')) return false;
        if (videoDefPressureZones.length && !videoDefPressureZones.includes(defPressureContext.zone || '')) return false;
        if (videoDefPressureAttackers.length && !videoDefPressureAttackers.includes(defPressureContext.attackerId || '')) return false;
      }
      return true;
    });
    return sortStatsForEditing(list, match, imputedTimeById);
  }, [
    videoGenericFiltered,
    videoPlayAction,
    videoShotTypes,
    videoShotSituations,
    videoShotPressure,
    videoShotMethods,
    videoShotOutcomes,
    videoBuildOutcomes,
    videoBuildOriginZones,
    videoBuildEndZones,
    videoBuildPressure,
    videoBuildAccuracy,
    videoBuildProgressive,
    videoBuildRecipientIds,
    videoBuildDistanceMin,
    videoBuildDistanceMax,
    videoCarryTakeOns,
    videoKickoutTargets,
    videoKickoutOutcomes,
    videoKickoutWonBy,
    videoKickoutLostBy,
    videoKickoutPress,
    videoKickoutLengths,
    videoKickoutSides,
    videoTurnoverTypes,
    videoTurnoverWonBy,
    videoTurnoverLostBy,
    videoTurnoverRecoveredBy,
    videoFoulTypes,
    videoFoulOn,
    videoFoulBy,
    videoDefPressureOutcomes,
    videoDefPressureActions,
    videoDefPressureZones,
    videoDefPressureAttackers,
    match,
    imputedTimeById,
  ]);

  const videoPossessionBase = useMemo(() => applyNonTeamReportFilters(stats, {
    halves: videoPossessionHalves,
    playerIds: [],
    actionTypes: [],
    outcomes: [],
    timeMin: videoPossessionTimeMin,
    timeMax: videoPossessionTimeMax,
    match,
    imputedTimeById,
    allowedActionTypes: ['pass', 'carry', 'shot', 'turnover', 'kickout', 'throw_in', 'foul'],
  }), [stats, videoPossessionHalves, videoPossessionTimeMin, videoPossessionTimeMax, match, imputedTimeById]);

  const videoPossessions = useMemo(() => {
    const calcBase = videoPossessionBase.filter((s) => !shouldExcludeFromTotals(s));
    const groups = groupByPossession(calcBase);
    const orderedBase = calcBase.slice().sort((a, b) => {
      const pa = Number(a?.play_id);
      const pb = Number(b?.play_id);
      if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa - pb;
      const ta = getMatchTimeS(a, match, imputedTimeById);
      const tb = getMatchTimeS(b, match, imputedTimeById);
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
    const previousByPossessionKey = new Map();
    orderedBase.forEach((stat, index) => {
      const pid = Number(stat?.possession_id);
      const pside = stat?.possession_team_side;
      if (!Number.isFinite(pid) || (pside !== 'home' && pside !== 'away')) return;
      const key = `${pside}-${pid}`;
      if (!previousByPossessionKey.has(key)) {
        previousByPossessionKey.set(key, index > 0 ? orderedBase[index - 1] : null);
      }
    });

    return Array.from(groups.entries()).flatMap(([key, evs0]) => {
      const [teamSide, pidStr] = String(key).split('-');
      const pid = Number(pidStr);
      if ((teamSide !== 'home' && teamSide !== 'away') || !Number.isFinite(pid)) return [];
      const evs = Array.isArray(evs0) ? evs0.slice() : [];
      const acting = evs.filter((entry) => entry && entry.team_side === teamSide);
      if (!acting.length) return [];
      const times = evs.map((s) => getMatchTimeS(s, match, imputedTimeById)).filter(Number.isFinite);
      const startTime = times.length ? Math.min(...times) : NaN;
      const endTime = times.length ? Math.max(...times) : NaN;
      const videoStartTimes = evs.map((s) => Number(s?.time_s)).filter(Number.isFinite);
      const points = acting.reduce((sum, entry) => {
        if (entry?.stat_type !== 'shot' || shouldExcludeFromTotals(entry)) return sum;
        const shotOutcome = safeParseJSON(entry?.extra_data || '{}', {})?.shot?.outcome;
        if (shotOutcome === 'goal') return sum + 3;
        if (shotOutcome === '2_point') return sum + 2;
        if (shotOutcome === 'point') return sum + 1;
        return sum;
      }, 0);
      const passes = acting.filter((entry) => entry?.stat_type === 'pass' && deriveOutcome(entry, safeParseJSON(entry?.extra_data || '{}', {})) === 'completed').length;
      const shots = acting.filter((entry) => entry?.stat_type === 'shot' && !shouldExcludeFromTotals(entry)).length;
      const previousStat = previousByPossessionKey.get(key) || null;
      const startSource = inferPossessionStartSource(evs, teamSide, previousStat || []);
      const isAttack = isAttackPossession(evs, teamSide);
      return [{
        key,
        teamSide,
        possessionId: pid,
        previousStat,
        half: acting[0]?.half || '',
        startTime,
        endTime,
        duration: Number.isFinite(startTime) && Number.isFinite(endTime) ? Math.max(0, endTime - startTime) : NaN,
        videoStartTime: videoStartTimes.length ? Math.min(...videoStartTimes) : NaN,
        startSource,
        originLabel: formatPossessionOriginLabel({ teamSide, startSource, stats: evs, previousStat }),
        outcome: derivePossessionOutcome(evs, teamSide),
        groupedOutcome: ['Wide', 'Short', 'Blocked', 'Saved', 'Post'].includes(String(derivePossessionOutcome(evs, teamSide) || '')) ? 'Missed Shot' : String(derivePossessionOutcome(evs, teamSide) || ''),
        isAttack,
        attackType: deriveAttackTypeState(acting),
        attackEntryChannel: isAttack ? getAttackEntryChannelForPossession(evs, teamSide) : '',
        startZone: getPossessionStartZone(acting),
        passes,
        shots,
        points,
        stats: evs,
      }];
    }).sort((a, b) => {
      if (Number.isFinite(a.startTime) && Number.isFinite(b.startTime) && a.startTime !== b.startTime) return a.startTime - b.startTime;
      if (a.teamSide !== b.teamSide) return String(a.teamSide).localeCompare(String(b.teamSide));
      return Number(a.possessionId) - Number(b.possessionId);
    });
  }, [videoPossessionBase, match, imputedTimeById]);

  const videoPossessionRows = useMemo(() => videoPossessions.filter((p) => {
    if (videoPossessionTeam !== 'both' && p.teamSide !== videoPossessionTeam) return false;
    if (videoPossessionOutcomeFilter.length && !videoPossessionOutcomeFilter.includes(p.groupedOutcome)) return false;
    if (videoPossessionOriginFilter.length && !videoPossessionOriginFilter.includes(p.originLabel)) return false;
    if (videoPossessionStartZoneFilter.length && !videoPossessionStartZoneFilter.includes(String(p.startZone || ''))) return false;
    return true;
  }), [videoPossessions, videoPossessionTeam, videoPossessionOutcomeFilter, videoPossessionOriginFilter, videoPossessionStartZoneFilter]);

  const videoPlayTableRows = useMemo(() => videoPlayRows.map((stat) => {
    const extra = safeParseJSON(stat?.extra_data || '{}', {});
    const displayTime = getMatchTimeS(stat, match, imputedTimeById);
    const defPressureContext = getDefPressureContext(stat);
    const isDefPressureView = videoPlayAction === 'def_pressure';
    return {
      id: stat.id,
      stat,
      play: Number.isFinite(Number(stat?.play_id)) ? Number(stat.play_id) : null,
      poss: Number.isFinite(Number(stat?.possession_id)) ? Number(stat.possession_id) : null,
      half: toTitleCase(String(stat?.half || '')),
      halfRaw: String(stat?.half || ''),
      time: Number.isFinite(displayTime) ? formatMatchClock(displayTime, match, stat?.half) : 'NA',
      timeSort: Number.isFinite(displayTime) ? displayTime : Number.POSITIVE_INFINITY,
      team: isDefPressureView ? formatTeamName(defPressureContext.defendingSide, homeTeam, awayTeam) : formatTeamName(stat?.team_side, homeTeam, awayTeam),
      teamRaw: isDefPressureView ? String(defPressureContext.defendingSide || '') : String(stat?.team_side || ''),
      player: isDefPressureView ? (defPressureContext.defender || '—') : (getPrimaryPlayerForEvent(stat) || '—'),
      action: isDefPressureView ? 'Def Pressure' : toTitleCase(String(stat?.stat_type || '')),
      actionRaw: isDefPressureView ? 'def_pressure' : String(stat?.stat_type || ''),
      outcome: formatDisplayOutcome(deriveOutcome(stat, extra)),
      outcomeRaw: String(deriveOutcome(stat, extra) || ''),
      secondaryPlayer: isDefPressureView ? (defPressureContext.attacker || '—') : (getSecondaryPlayerForEvent(stat) || '—'),
    };
  }), [videoPlayRows, match, imputedTimeById, homeTeam, awayTeam, videoPlayAction]);

  const videoPlayColumns = useMemo(() => ([
    { key: 'play', label: 'Play', width: '56px', sortValue: (row) => row.play ?? Number.POSITIVE_INFINITY },
    { key: 'poss', label: 'Poss', width: '56px', sortValue: (row) => row.poss ?? Number.POSITIVE_INFINITY },
    { key: 'half', label: 'Half', width: '68px', sortValue: (row) => row.halfRaw || '' },
    { key: 'time', label: 'Time', width: '92px', sortValue: (row) => row.timeSort },
    { key: 'team', label: 'Team', width: '116px', sortValue: (row) => row.teamRaw || '' },
    { key: 'player', label: 'Player', width: '156px', sortValue: (row) => row.player || '' },
    { key: 'action', label: 'Action', width: '102px', sortValue: (row) => row.actionRaw || '' },
    { key: 'outcome', label: 'Outcome', width: '118px', sortValue: (row) => row.outcomeRaw || '' },
    { key: 'secondaryPlayer', label: 'Secondary Player', width: '200px', sortValue: (row) => row.secondaryPlayer === '—' ? '' : row.secondaryPlayer },
    { key: 'actions', label: 'Actions', width: '180px', sortable: false },
  ]), []);

  const sortedVideoPlayTableRows = useMemo(
    () => sortRows(videoPlayTableRows, videoPlaySort, videoPlayColumns, 'id'),
    [videoPlayTableRows, videoPlaySort, videoPlayColumns]
  );

  const videoPossessionColumns = useMemo(() => ([
    { key: 'possessionId', label: 'Poss', width: '64px', sortValue: (row) => row.possessionId ?? Number.POSITIVE_INFINITY },
    { key: 'team', label: 'Team', width: '116px', sortValue: (row) => row.teamSide || '' },
    { key: 'half', label: 'Half', width: '70px', sortValue: (row) => row.half || '' },
    { key: 'startTime', label: 'Start', width: '92px', sortValue: (row) => Number.isFinite(row.startTime) ? row.startTime : Number.POSITIVE_INFINITY },
    { key: 'endTime', label: 'End', width: '92px', sortValue: (row) => Number.isFinite(row.endTime) ? row.endTime : Number.POSITIVE_INFINITY },
    { key: 'duration', label: 'Duration', width: '86px', sortValue: (row) => Number.isFinite(row.duration) ? row.duration : Number.POSITIVE_INFINITY },
    { key: 'originLabel', label: 'Origin', width: '180px', sortValue: (row) => row.originLabel || '' },
    { key: 'groupedOutcome', label: 'Outcome', width: '130px', sortValue: (row) => row.groupedOutcome || '' },
    { key: 'actions', label: 'Actions', width: '180px', sortable: false },
  ]), []);
  const sortedVideoPossessionRows = useMemo(
    () => sortRows(videoPossessionRows, videoPossessionSort, videoPossessionColumns, 'key'),
    [videoPossessionRows, videoPossessionSort, videoPossessionColumns]
  );

  const filteredSorted = useMemo(() => sortStatsForEditing(filtered, match, imputedTimeById), [filtered, match, imputedTimeById]);
  const visibleRowLimit = rowLimit === 'all' ? filteredSorted.length : Math.max(50, Number(rowLimit) || 200);
  const visibleRows = useMemo(() => filteredSorted.slice(0, visibleRowLimit), [filteredSorted, visibleRowLimit]);
  const videoVisiblePlayRows = useMemo(
    () => (videoPlayExpanded ? sortedVideoPlayTableRows : sortedVideoPlayTableRows.slice(0, VIDEO_PREVIEW_COUNT)),
    [videoPlayExpanded, sortedVideoPlayTableRows]
  );
  const videoVisiblePossessionRows = useMemo(
    () => (videoPossessionExpanded ? sortedVideoPossessionRows : sortedVideoPossessionRows.slice(0, VIDEO_PREVIEW_COUNT)),
    [videoPossessionExpanded, sortedVideoPossessionRows]
  );
  const exportBaseName = useMemo(() => {
    const home = homeTeam?.name || 'home';
    const away = awayTeam?.name || 'away';
    const date = match?.date || new Date().toISOString().slice(0, 10);
    return `match-data-${safeFilePart(home)}-vs-${safeFilePart(away)}-${safeFilePart(date)}`;
  }, [homeTeam, awayTeam, match]);

  const videoShotTypeOptions = useMemo(() => {
    const values = new Set();
    for (const stat of videoGenericFiltered) {
      if (stat?.stat_type !== 'shot') continue;
      const shotData = safeParseJSON(stat?.extra_data || '{}', {})?.shot || {};
      const shotType = normalizeShotType(shotData?.type || shotData?.shot_type || shotData?.shotType || '');
      if (shotType) values.add(shotType);
    }
    return Array.from(values).sort().map((value) => ({ value, label: toTitleCase(value.replaceAll('_', ' ')) }));
  }, [videoGenericFiltered]);
  const videoShotSituationOptions = useMemo(() => {
    const values = new Set();
    for (const stat of videoGenericFiltered) {
      if (stat?.stat_type !== 'shot') continue;
      const value = normalizeShotSituation(safeParseJSON(stat?.extra_data || '{}', {})?.shot?.situation || '');
      if (value) values.add(value);
    }
    return Array.from(values).sort().map((value) => ({ value, label: toTitleCase(value.replaceAll('_', ' ')) }));
  }, [videoGenericFiltered]);
  const videoShotPressureOptions = useMemo(() => {
    const values = new Set();
    for (const stat of videoGenericFiltered) {
      if (stat?.stat_type !== 'shot') continue;
      const value = String(safeParseJSON(stat?.extra_data || '{}', {})?.shot?.pressure || '').trim();
      if (value) values.add(value);
    }
    return Array.from(values).sort().map((value) => ({ value, label: toTitleCase(value) }));
  }, [videoGenericFiltered]);
  const videoShotMethodOptions = useMemo(() => {
    const values = new Set();
    for (const stat of videoGenericFiltered) {
      if (stat?.stat_type !== 'shot') continue;
      const value = String(safeParseJSON(stat?.extra_data || '{}', {})?.shot?.method || '').trim();
      if (value) values.add(value);
    }
    return Array.from(values).sort().map((value) => ({ value, label: toTitleCase(value) }));
  }, [videoGenericFiltered]);
  const videoShotOutcomeOptions = useMemo(() => {
    const values = new Set();
    for (const stat of videoGenericFiltered) {
      if (stat?.stat_type !== 'shot') continue;
      const value = String(deriveOutcome(stat, safeParseJSON(stat?.extra_data || '{}', {})) || '').trim();
      if (value) values.add(value);
    }
    return Array.from(values).sort().map((value) => ({ value, label: toTitleCase(value.replaceAll('_', ' ')) }));
  }, [videoGenericFiltered]);

  const videoBuildOutcomeOptions = useMemo(() => {
    const values = new Set();
    for (const stat of videoGenericFiltered) {
      if (!['pass', 'carry'].includes(String(stat?.stat_type || ''))) continue;
      const value = String(deriveOutcome(stat, safeParseJSON(stat?.extra_data || '{}', {})) || '').trim();
      if (value) values.add(value);
    }
    return Array.from(values).sort().map((value) => ({ value, label: toTitleCase(value) }));
  }, [videoGenericFiltered]);
  const videoBuildOriginOptions = useMemo(
    () => POSSESSION_START_ZONES.map((value) => ({ value, label: value })),
    []
  );
  const videoBuildEndOptions = videoBuildOriginOptions;
  const videoBuildPressureOptions = useMemo(() => {
    const values = new Set();
    for (const stat of videoGenericFiltered) {
      if (!['pass', 'carry'].includes(String(stat?.stat_type || ''))) continue;
      const extra = safeParseJSON(stat?.extra_data || '{}', {});
      const value = String(stat?.stat_type === 'pass' ? (extra?.pass?.pressure_on_passer || '') : (extra?.carry?.pressure_on_carrier || '')).trim();
      if (value) values.add(value);
    }
    return Array.from(values).sort().map((value) => ({ value, label: toTitleCase(value) }));
  }, [videoGenericFiltered]);
  const videoBuildAccuracyOptions = useMemo(() => ([
    { value: '++', label: '++' },
    { value: '+', label: '+' },
    { value: '-', label: '-' },
    { value: '--', label: '--' },
  ]), []);
  const videoBuildProgressiveOptions = useMemo(() => ([
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' },
  ]), []);
  const videoCarryTakeOnOptions = useMemo(() => ([
    { value: 'completed', label: 'Completed' },
    { value: 'failed', label: 'Failed' },
    { value: 'no', label: 'No' },
  ]), []);

  const videoKickoutTargetOptions = useMemo(() => {
    const values = new Map();
    for (const stat of videoGenericFiltered) {
      if (stat?.stat_type !== 'kickout') continue;
      const target = safeParseJSON(stat?.extra_data || '{}', {})?.kickout?.intended_recipient;
      const value = getKickoutTargetLabel(stat);
      if (!value || value === 'Unknown') continue;
      const teamSort = target?.kind === 'player' ? (target?.team_side === 'home' ? 0 : 1) : 2;
      const numberSort = Number(target?.number) || 999;
      values.set(value, { value, label: value, teamSort, numberSort });
    }
    return Array.from(values.values())
      .sort((a, b) => (a.teamSort - b.teamSort) || (a.numberSort - b.numberSort) || a.label.localeCompare(b.label))
      .map(({ value, label }) => ({ value, label }));
  }, [videoGenericFiltered]);
  const videoKickoutOutcomeOptions = useMemo(() => {
    const values = new Set();
    for (const stat of videoGenericFiltered) {
      if (stat?.stat_type !== 'kickout') continue;
      const value = getKickoutOutcomeLabel(stat);
      if (value && value !== 'Unknown') values.add(value);
    }
    return Array.from(values).sort().map((value) => ({ value, label: value }));
  }, [videoGenericFiltered]);
  const videoKickoutPressOptions = useMemo(() => {
    const values = new Set();
    for (const stat of videoGenericFiltered) {
      if (stat?.stat_type !== 'kickout') continue;
      const value = getKickoutPressLabel(stat);
      if (value && value !== 'Unknown') values.add(value);
    }
    return Array.from(values).sort().map((value) => ({ value, label: value === 'M2M' ? 'M2M' : toTitleCase(value) }));
  }, [videoGenericFiltered]);
  const videoKickoutLengthOptions = useMemo(() => ([
    { value: 'Short', label: 'Short' },
    { value: 'Long', label: 'Long' },
  ]), []);
  const videoKickoutSideOptions = useMemo(() => ([
    { value: 'Left', label: 'Left' },
    { value: 'Middle', label: 'Middle' },
    { value: 'Right', label: 'Right' },
  ]), []);
  const videoKickoutLostByOptions = kickoutWonByOptions;
  const videoBuildDistanceMaxBound = useMemo(() => {
    const distances = videoGenericFiltered
      .filter((stat) => (videoPlayAction === 'carry' ? stat?.stat_type === 'carry' : stat?.stat_type === 'pass'))
      .map((stat) => {
        const startX = Number(stat?.x_position);
        const startY = Number(stat?.y_position);
        const endX = Number(stat?.end_x_position);
        const endY = Number(stat?.end_y_position);
        return [startX, startY, endX, endY].every(Number.isFinite) ? Math.hypot(endX - startX, endY - startY) : NaN;
      })
      .filter(Number.isFinite);
    const maxDistance = distances.length ? Math.max(...distances) : 60;
    return Math.max(10, Math.ceil(maxDistance / 10) * 10);
  }, [videoGenericFiltered, videoPlayAction]);
  const videoBuildDistanceMidpoint = Math.max(0, Math.round(videoBuildDistanceMaxBound / 2));

  const videoTurnoverTypeOptions = useMemo(() => {
    const values = new Set();
    for (const stat of videoGenericFiltered) {
      if (!statMatchesActionType(stat, 'turnover')) continue;
      const turnoverType = getTurnoverClassification(stat).type;
      if (turnoverType && turnoverType !== 'unknown') values.add(turnoverType);
    }
    return Array.from(values).sort().map((value) => ({ value, label: toTitleCase(value.replaceAll('_', ' ')) }));
  }, [videoGenericFiltered]);
  const videoTurnoverWonByOptions = useMemo(() => {
    const values = new Map();
    for (const stat of videoGenericFiltered) {
      if (!statMatchesActionType(stat, 'turnover')) continue;
      const turnover = safeParseJSON(stat?.extra_data || '{}', {})?.turnover || {};
      const selection = turnover?.recovered_by || turnover?.forced_by;
      const id = String(selection?.id || '');
      const label = formatSelectionLabel(selection);
      if (id && label) values.set(id, { value: id, label });
    }
    return Array.from(values.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [videoGenericFiltered]);
  const videoTurnoverLostByOptions = useMemo(() => {
    const values = new Map();
    for (const stat of videoGenericFiltered) {
      if (!statMatchesActionType(stat, 'turnover')) continue;
      const selection = safeParseJSON(stat?.extra_data || '{}', {})?.turnover?.lost_by;
      const id = String(selection?.id || '');
      const label = formatSelectionLabel(selection);
      if (id && label) values.set(id, { value: id, label });
    }
    return Array.from(values.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [videoGenericFiltered]);
  const videoTurnoverRecoveredByOptions = useMemo(() => {
    const values = new Map();
    for (const stat of videoGenericFiltered) {
      if (!statMatchesActionType(stat, 'turnover')) continue;
      const selection = safeParseJSON(stat?.extra_data || '{}', {})?.turnover?.recovered_by;
      const id = String(selection?.id || '');
      const label = formatSelectionLabel(selection);
      if (id && label) values.set(id, { value: id, label });
    }
    return Array.from(values.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [videoGenericFiltered]);
  const videoFoulTypeOptions = useMemo(() => {
    const values = new Set();
    for (const stat of videoGenericFiltered) {
      if (!statMatchesActionType(stat, 'foul')) continue;
      const foul = safeParseJSON(stat?.extra_data || '{}', {})?.foul || extractFoulFromStat(stat) || {};
      const value = String(foul?.type || foul?.foul_type || '').trim().toLowerCase();
      if (value) values.add(value);
    }
    return Array.from(values).sort().map((value) => ({ value, label: toTitleCase(value.replaceAll('_', ' ')) }));
  }, [videoGenericFiltered]);
  const videoFoulOnOptions = useMemo(() => {
    const values = new Map();
    for (const stat of videoGenericFiltered) {
      if (!statMatchesActionType(stat, 'foul')) continue;
      const selection = (safeParseJSON(stat?.extra_data || '{}', {})?.foul || extractFoulFromStat(stat) || {})?.foul_on;
      const id = String(selection?.id || '');
      const label = formatSelectionLabel(selection);
      if (id && label) values.set(id, { value: id, label });
    }
    return Array.from(values.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [videoGenericFiltered]);
  const videoFoulByOptions = useMemo(() => {
    const values = new Map();
    for (const stat of videoGenericFiltered) {
      if (!statMatchesActionType(stat, 'foul')) continue;
      const selection = (safeParseJSON(stat?.extra_data || '{}', {})?.foul || extractFoulFromStat(stat) || {})?.foul_by;
      const id = String(selection?.id || '');
      const label = formatSelectionLabel(selection);
      if (id && label) values.set(id, { value: id, label });
    }
    return Array.from(values.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [videoGenericFiltered]);

  const videoDefPressureOutcomeOptions = useMemo(() => {
    const values = new Set();
    for (const stat of videoGenericFiltered) {
      const context = getDefPressureContext(stat);
      if (!context.hasPressure) continue;
      if (context.outcome) values.add(context.outcome);
    }
    return Array.from(values).sort().map((value) => ({ value, label: formatDisplayOutcome(value) }));
  }, [videoGenericFiltered]);
  const videoDefPressureActionOptions = useMemo(() => {
    const values = new Set();
    for (const stat of videoGenericFiltered) {
      const context = getDefPressureContext(stat);
      if (!context.hasPressure) continue;
      if (context.attackingAction) values.add(context.attackingAction);
    }
    return Array.from(values).sort().map((value) => ({ value, label: toTitleCase(value.replaceAll('_', ' ')) }));
  }, [videoGenericFiltered]);
  const videoDefPressureZoneOptions = useMemo(
    () => POSSESSION_START_ZONES.map((value) => ({ value, label: value })),
    []
  );
  const videoDefPressureAttackerOptions = useMemo(() => {
    const values = new Map();
    for (const stat of videoGenericFiltered) {
      const context = getDefPressureContext(stat);
      if (!context.hasPressure || !context.attackerId || !context.attacker) continue;
      values.set(context.attackerId, { value: context.attackerId, label: context.attacker });
    }
    return Array.from(values.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [videoGenericFiltered]);

  const selectedVideoPlayRow = useMemo(
    () => sortedVideoPlayTableRows.find((row) => String(row.id) === String(selectedVideoPlayId)) || null,
    [sortedVideoPlayTableRows, selectedVideoPlayId]
  );
  const selectedVideoPossessionRow = useMemo(
    () => sortedVideoPossessionRows.find((row) => String(row.key) === String(selectedVideoPossessionKey)) || null,
    [sortedVideoPossessionRows, selectedVideoPossessionKey]
  );

  const toggleVideoPlaySort = (key) => setVideoPlaySort((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'play' || key === 'poss' || key === 'time' ? 'asc' : 'asc' });
  const toggleVideoPossessionSort = (key) => setVideoPossessionSort((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'possessionId' || key === 'startTime' || key === 'endTime' || key === 'duration' ? 'asc' : 'asc' });

  const resetVideoPlayFilters = () => {
    setTeam('both');
    setPlayerIds([]);
    setHalves([]);
    setTimeMin('');
    setTimeMax('');
    setVideoPlayAction('all');
    setVideoShotTypes([]);
    setVideoShotSituations([]);
    setVideoShotPressure([]);
    setVideoShotMethods([]);
    setVideoShotOutcomes([]);
    setVideoBuildOutcomes([]);
    setVideoBuildOriginZones([]);
    setVideoBuildEndZones([]);
    setVideoBuildPressure([]);
    setVideoBuildAccuracy([]);
    setVideoBuildProgressive([]);
    setVideoBuildRecipientIds([]);
    setVideoBuildDistanceMin('');
    setVideoBuildDistanceMax('');
    setVideoCarryTakeOns([]);
    setVideoKickoutTargets([]);
    setVideoKickoutOutcomes([]);
    setVideoKickoutWonBy([]);
    setVideoKickoutLostBy([]);
    setVideoKickoutPress([]);
    setVideoKickoutLengths([]);
    setVideoKickoutSides([]);
    setVideoTurnoverTypes([]);
    setVideoTurnoverWonBy([]);
    setVideoTurnoverLostBy([]);
    setVideoTurnoverRecoveredBy([]);
    setVideoFoulTypes([]);
    setVideoFoulOn([]);
    setVideoFoulBy([]);
    setVideoDefPressureOutcomes([]);
    setVideoDefPressureActions([]);
    setVideoDefPressureZones([]);
    setVideoDefPressureAttackers([]);
    setSelectedVideoPlayId(null);
    setVideoPlayExpanded(false);
    setVideoPlaySort({ key: 'play', dir: 'asc' });
  };

  const resetVideoPossessionFilters = () => {
    setVideoPossessionTeam('both');
    setVideoPossessionHalves([]);
    setVideoPossessionTimeMin('');
    setVideoPossessionTimeMax('');
    setVideoPossessionStartZoneFilter([]);
    setVideoPossessionOriginFilter([]);
    setVideoPossessionOutcomeFilter([]);
    setSelectedVideoPossessionKey(null);
    setVideoPossessionExpanded(false);
    setVideoPossessionSort({ key: 'startTime', dir: 'asc' });
  };

  const openPossessionVisualise = (possession) => {
    setVizStats(Array.isArray(possession?.stats) ? possession.stats : []);
    setVizTitle(`Possession #${possession?.possessionId || 'NA'} - ${possession?.teamSide === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home')}`);
    setVizOpen(true);
  };

  const exportFilteredCsv = () => {
    if (!filteredSorted.length) {
      toast.error('No rows to export');
      return;
    }
    const headers = [
      'Match ID',
      'Match Public ID',
      'Match Date',
      'Home Team',
      'Away Team',
      'Play ID',
      'Possession ID',
      'Possession Team',
      'Acting Team',
      'Set Defence',
      'Stat Type',
      'Outcome',
      'Half',
      'Clock',
      'Video Time (s)',
      'Match Time (s)',
      'Raw X',
      'Raw Y',
      'Raw End X',
      'Raw End Y',
      'X',
      'Y',
      'End X',
      'End Y',
      'Primary Player #',
      'Primary Player Name',
      'Recipient #',
      'Recipient Name',
      'Extra JSON',
    ];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = filteredSorted.map((stat) => {
      const extra = safeParseJSON(stat?.extra_data || '{}', {});
      const matchTime = getMatchTimeS(stat, match, imputedTimeById);
      return [
        stat?.match_id || '',
        match?.public_match_id || '',
        match?.date || '',
        homeTeam?.name || '',
        awayTeam?.name || '',
        stat?.play_id ?? '',
        stat?.possession_id ?? '',
        stat?.possession_team_side || '',
        stat?.team_side || '',
        getSetDefenceValue(stat, false) ? 'Yes' : 'No',
        stat?.stat_type || '',
        deriveOutcome(stat, extra) || '',
        stat?.half || '',
        Number.isFinite(matchTime) ? formatMatchClock(matchTime, match, stat?.half) : '',
        stat?.time_s ?? '',
        Number.isFinite(matchTime) ? matchTime : '',
        stat?.raw_x_position ?? '',
        stat?.raw_y_position ?? '',
        stat?.raw_end_x_position ?? '',
        stat?.raw_end_y_position ?? '',
        stat?.x_position ?? '',
        stat?.y_position ?? '',
        stat?.end_x_position ?? '',
        stat?.end_y_position ?? '',
        stat?.player_number ?? '',
        stat?.player_name || '',
        stat?.recipient_number ?? '',
        stat?.recipient_name || '',
        JSON.stringify(extra),
      ];
    });
    const csv = `\ufeff${[headers.map(esc).join(','), ...rows.map((row) => row.map(esc).join(','))].join('\n')}`;
    downloadTextFile(csv, `${exportBaseName}.csv`, 'text/csv;charset=utf-8;');
    toast.success(`CSV exported (${filteredSorted.length} row${filteredSorted.length === 1 ? '' : 's'})`);
  };

  const exportMatchJson = () => {
    if (!orderedAllStats.length) {
      toast.error('No match rows to export');
      return;
    }
    const bundle = {
      schema_version: 1,
      exported_at: new Date().toISOString(),
      source: 'gaa-stat-logger-data-tab',
      notes: 'Full match bundle for backup/demo import. Stats include rebuilt in-app fields as currently loaded.',
      match,
      teams: [homeTeam, awayTeam].filter(Boolean),
      players: [...(homePlayers || []), ...(awayPlayers || [])],
      stats: orderedAllStats,
      counts: {
        teams: [homeTeam, awayTeam].filter(Boolean).length,
        players: [...(homePlayers || []), ...(awayPlayers || [])].length,
        stats: orderedAllStats.length,
      },
    };
    downloadTextFile(JSON.stringify(bundle, null, 2), `${exportBaseName}.json`, 'application/json;charset=utf-8;');
    toast.success(`JSON exported (${orderedAllStats.length} row${orderedAllStats.length === 1 ? '' : 's'})`);
  };

  const keyForGroup = (s) => {
    const extra = safeParseJSON(s?.extra_data || '{}', {});
    if (groupBy === 'team') return s?.team_side || 'unknown';
    if (groupBy === 'action') return s?.stat_type || 'unknown';
    if (groupBy === 'half') return s?.half || 'unknown';
    if (groupBy === 'outcome') return deriveOutcome(s, extra) || 'unknown';
    if (groupBy === 'possession') {
      const pid = Number(s?.possession_id);
      const pside = s?.possession_team_side;
      if (Number.isFinite(pid) && (pside === 'home' || pside === 'away')) return `${pside}-${pid}`;
      return 'unknown';
    }
    if (groupBy === 'player') {
      if (s?.player_number) return `#${s.player_number}`;
      return 'None';
    }
    return 'unknown';
  };

  const pivot = useMemo(() => {
    if (groupBy === 'none') return null;
    const rows = new Map();
    const previousByPossessionKey = new Map();
    const statsByPossessionKey = new Map();

    if (groupBy === 'possession') {
      for (let i = 0; i < filteredSorted.length; i += 1) {
        const stat = filteredSorted[i];
        const key = getPossessionKey(stat);
        if (key === 'unknown') continue;
        const arr = statsByPossessionKey.get(key) || [];
        arr.push(stat);
        statsByPossessionKey.set(key, arr);
        if (!previousByPossessionKey.has(key)) previousByPossessionKey.set(key, i > 0 ? filteredSorted[i - 1] : null);
      }
    }

    for (const s of filtered) {
      const extra = safeParseJSON(s.extra_data || '{}', {});
      const key = keyForGroup(s);
      const cur = rows.get(key) || {
        key,
        count: 0,
        shotPoints: 0,
        start_time_s: null,
        end_time_s: null,
        start_time_norm_s: null,
        end_time_norm_s: null,
        start_action: '',
        end_action: '',
        start_half: '',
        end_half: '',
        start_source: '',
        end_outcome: '',
        attack: false,
        attack_entry_channel: '',
      };
      cur.count += 1;
      if (s.stat_type === 'shot' && !shouldExcludeFromTotals(s)) {
        const o = extra?.shot?.outcome;
        if (o === 'goal') cur.shotPoints += 3;
        if (o === 'point') cur.shotPoints += 1;
        if (o === '2_point') cur.shotPoints += 2;
      }

      if (groupBy === 'possession') {
        const t = Number(s?.time_s);
        if (Number.isFinite(t)) {
          cur.start_time_s = cur.start_time_s == null ? t : Math.min(cur.start_time_s, t);
          cur.end_time_s = cur.end_time_s == null ? t : Math.max(cur.end_time_s, t);
        }
        const tn = getMatchTimeS(s, match, imputedTimeById);
        if (Number.isFinite(tn)) {
          cur.start_time_norm_s = cur.start_time_norm_s == null ? tn : Math.min(cur.start_time_norm_s, tn);
          cur.end_time_norm_s = cur.end_time_norm_s == null ? tn : Math.max(cur.end_time_norm_s, tn);
        }
        const act = s?.stat_type || '';
        const out = deriveOutcome(s, extra) || '';
        const pid = Number(s?.play_id);
        if (Number.isFinite(pid)) {
          if (cur._minPlay == null || pid < cur._minPlay) {
            cur._minPlay = pid;
            cur.start_action = act;
            cur.start_half = s?.half || '';
            cur.start_source = inferPossessionStartSource(
              statsByPossessionKey.get(key) || [s],
              s?.possession_team_side,
              previousByPossessionKey.get(key) || [],
            );
          }
          if (cur._maxPlay == null || pid > cur._maxPlay) {
            cur._maxPlay = pid;
            cur.end_action = act;
            cur.end_half = s?.half || '';
            cur.end_outcome = out;
          }
        }
      }

      rows.set(key, cur);
    }

    const arr = Array.from(rows.values());
    if (groupBy === 'possession') {
      for (const row of arr) {
        const [side] = String(row.key || '').split('-');
        const groupStats = filtered.filter((s) => keyForGroup(s) === row.key);
        row.attack = isAttackPossession(groupStats, side);
        row.attack_entry_channel = row.attack ? getAttackEntryChannelForPossession(groupStats, side) : '';
        row.end_outcome = derivePossessionOutcome(groupStats, side);
      }
      arr.sort((a, b) => {
        const ta = a.start_time_norm_s;
        const tb = b.start_time_norm_s;
        if (ta != null && tb != null && ta !== tb) return ta - tb;
        if (a._minPlay != null && b._minPlay != null && a._minPlay !== b._minPlay) return a._minPlay - b._minPlay;
        return String(a.key).localeCompare(String(b.key));
      });
      return arr;
    }
    return arr.sort((a, b) => String(a.key).localeCompare(String(b.key)));
  }, [filtered, groupBy, match, imputedTimeById]);

  const editStat = useMemo(() => orderedAllStats.find((stat) => stat?.id === editStatId) || null, [orderedAllStats, editStatId]);
  const editIndex = useMemo(() => orderedAllStats.findIndex((stat) => stat?.id === editStatId), [orderedAllStats, editStatId]);
  const editPrev = editIndex > 0 ? orderedAllStats[editIndex - 1] : null;
  const editNext = editIndex >= 0 && editIndex + 1 < orderedAllStats.length ? orderedAllStats[editIndex + 1] : null;
  const editRangeIndices = useMemo(() => getContiguousRange(orderedAllStats, editIndex, editScope), [orderedAllStats, editIndex, editScope]);
  const editRangeStats = useMemo(() => editRangeIndices.map((index) => orderedAllStats[index]).filter(Boolean), [orderedAllStats, editRangeIndices]);
  const previousPossession = useMemo(() => findAdjacentPossession(orderedAllStats, editIndex, 'previous'), [orderedAllStats, editIndex]);
  const nextPossession = useMemo(() => findAdjacentPossession(orderedAllStats, editIndex, 'next'), [orderedAllStats, editIndex]);
  const moveTargetOptions = useMemo(() => orderedAllStats.filter((stat) => stat?.id !== editStatId), [orderedAllStats, editStatId]);

  const openEditDialogForStat = (stat) => {
    if (!stat?.id) return;
    const currentTeam = stat.possession_team_side === 'away' ? 'away' : 'home';
    setEditStatId(stat.id);
    setEditScope('row_tail');
    setTargetPossessionId(Number.isFinite(Number(stat?.possession_id)) ? String(Number(stat.possession_id)) : '');
    setTargetPossessionTeam(currentTeam);
    setNewPossessionTeam(currentTeam);
    setMoveTargetId('');
    setAdvancedOpen(false);
    setAdvancedPlayId(Number.isFinite(Number(stat?.play_id)) ? String(Number(stat.play_id)) : '');
    setAdvancedPossessionId(Number.isFinite(Number(stat?.possession_id)) ? String(Number(stat.possession_id)) : '');
    setAdvancedPossessionTeam(currentTeam);
    setRawEditOpen(false);
    setRawStatType(stat?.stat_type || '');
    setRawTeamSide(stat?.team_side === 'away' ? 'away' : (stat?.team_side === 'unknown' ? 'unknown' : 'home'));
    setRawHalf(stat?.half || 'first');
    setRawSetDefence(!!getSetDefenceValue(stat, false));
    setRawTimeS(Number.isFinite(Number(stat?.time_s)) ? String(Number(stat.time_s)) : '');
    setRawNormalizedTimeS(Number.isFinite(Number(stat?.normalized_time_s)) ? String(Number(stat.normalized_time_s)) : '');
    setRawPlayerName(stat?.player_name || '');
    setRawPlayerNumber(stat?.player_number == null ? '' : String(stat.player_number));
    setRawRecipientName(stat?.recipient_name || '');
    setRawRecipientNumber(stat?.recipient_number == null ? '' : String(stat.recipient_number));
    setRawExtraJson(JSON.stringify(safeParseJSON(stat?.extra_data || '{}', {}), null, 2));
    setEditOpen(true);
  };

  const buildPossessionUpdates = (targetId, targetTeam) => editRangeStats.map((stat) => ({
    id: stat.id,
    data: {
      possession_id: targetId,
      possession_team_side: targetTeam,
    },
  }));

  const runPossessionAction = ({ label, targetId, targetTeam }) => {
    if (!editStat || !editRangeStats.length) return;
    if (!Number.isFinite(Number(targetId)) || Number(targetId) <= 0) {
      toast.error('Choose a valid possession number');
      return;
    }
    const updates = buildPossessionUpdates(Number(targetId), targetTeam);
    const summary = `${updates.length} row${updates.length === 1 ? '' : 's'} will move to Possession ${Number(targetId)} (${formatTeamName(targetTeam, homeTeam, awayTeam)}).`;
    if (!window.confirm(`${label}\n\n${summary}`)) return;
    persistMutation.mutate(updates);
  };

  const runPlayMove = ({ label, getNewOrder }) => {
    if (!editStat || editIndex < 0) return;
    const updatedOrdered = resequenceOrderedStats(getNewOrder([...orderedAllStats]));
    const updates = updatedOrdered
      .filter((stat, index) => Number(stat?.play_id) !== Number(orderedAllStats[index]?.play_id))
      .map((stat) => ({ id: stat.id, data: { play_id: stat.play_id } }));
    if (!updates.length) return;
    const first = Math.min(...updates.map((row) => Number(row.data.play_id)));
    const last = Math.max(...updates.map((row) => Number(row.data.play_id)));
    const summary = `${updates.length} row${updates.length === 1 ? '' : 's'} will be resequenced across plays ${first}-${last}.`;
    if (!window.confirm(`${label}\n\n${summary}`)) return;
    persistMutation.mutate(updates);
  };

  const applyAdvanced = () => {
    if (!editStat) return;
    const nextPossessionId = Number(advancedPossessionId);
    const nextPlayId = Number(advancedPlayId);
    if (!Number.isFinite(nextPossessionId) || nextPossessionId <= 0) {
      toast.error('Enter a valid possession number');
      return;
    }
    if (!Number.isFinite(nextPlayId) || nextPlayId <= 0) {
      toast.error('Enter a valid play number');
      return;
    }

    const remaining = orderedAllStats.filter((stat) => stat.id !== editStat.id);
    const clampedIndex = Math.max(0, Math.min(remaining.length, Math.round(nextPlayId) - 1));
    const inserted = [...remaining.slice(0, clampedIndex), editStat, ...remaining.slice(clampedIndex)];
    const resequenced = resequenceOrderedStats(inserted);
    const playUpdates = resequenced
      .filter((stat, index) => Number(stat?.play_id) !== Number(inserted[index]?.play_id))
      .map((stat) => ({ id: stat.id, data: { play_id: stat.play_id } }));

    const possessionUpdates = editRangeStats.map((stat) => ({
      id: stat.id,
      data: {
        possession_id: nextPossessionId,
        possession_team_side: advancedPossessionTeam,
      },
    }));

    const merged = new Map();
    for (const row of [...playUpdates, ...possessionUpdates]) {
      const current = merged.get(row.id) || { id: row.id, data: {} };
      current.data = { ...current.data, ...row.data };
      merged.set(row.id, current);
    }
    const updates = Array.from(merged.values());
    const summary = `${updates.length} row${updates.length === 1 ? '' : 's'} will be updated. Possession rows will move to Possession ${nextPossessionId} (${formatTeamName(advancedPossessionTeam, homeTeam, awayTeam)}), and play order will be resequenced.`;
    if (!window.confirm(`Apply advanced raw ID changes?\n\n${summary}`)) return;
    persistMutation.mutate(updates);
  };

  const applyRawStatChanges = () => {
    if (!editStat) return;
    let parsedExtra;
    try {
      parsedExtra = JSON.parse(String(rawExtraJson || '{}'));
      if (!parsedExtra || typeof parsedExtra !== 'object') throw new Error('Extra data must be an object');
    } catch {
      toast.error('Extra JSON is invalid');
      return;
    }
    if (String(rawStatType || editStat.stat_type || '') === 'pass') {
      parsedExtra.pass = { ...(parsedExtra.pass || {}) };
      parsedExtra.pass.accuracy = normalizePassAccuracy(parsedExtra.pass.accuracy);
      if (Object.prototype.hasOwnProperty.call(parsedExtra.pass, 'style')) delete parsedExtra.pass.style;
    }

    const nextTime = rawTimeS === '' ? null : Number(rawTimeS);
    const nextNormTime = rawNormalizedTimeS === '' ? null : Number(rawNormalizedTimeS);
    const nextPlayerNumber = rawPlayerNumber === '' ? null : Number(rawPlayerNumber);
    const nextRecipientNumber = rawRecipientNumber === '' ? null : Number(rawRecipientNumber);
    if (rawTimeS !== '' && !Number.isFinite(nextTime)) return toast.error('Video Time (s) must be numeric');
    if (rawNormalizedTimeS !== '' && !Number.isFinite(nextNormTime)) return toast.error('Period Clock (s) must be numeric');
    if (rawPlayerNumber !== '' && !Number.isFinite(nextPlayerNumber)) return toast.error('Player # must be numeric');
    if (rawRecipientNumber !== '' && !Number.isFinite(nextRecipientNumber)) return toast.error('Recipient # must be numeric');

    const update = {
      id: editStat.id,
      data: {
        stat_type: String(rawStatType || editStat.stat_type || ''),
        team_side: rawTeamSide,
        half: rawHalf,
        counter_attack: !!rawSetDefence,
        set_defence: !!rawSetDefence,
        defence_set_migration_version: DEFENCE_SET_MIGRATION_VERSION,
        time_s: nextTime,
        normalized_time_s: nextNormTime,
        player_name: rawPlayerName || null,
        player_number: nextPlayerNumber,
        recipient_name: rawRecipientName || null,
        recipient_number: nextRecipientNumber,
        extra_data: JSON.stringify(parsedExtra),
      },
    };
    if (!window.confirm('Apply raw stat field changes to this row?')) return;
    persistMutation.mutate([update]);
  };

  if (isVideoMode) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <div className="inline-flex rounded-xl bg-slate-100 p-1 shadow-sm">
            <Button type="button" variant={videoBrowseMode === 'play' ? 'default' : 'outline'} size="sm" className="h-9 px-4 text-sm" onClick={() => setVideoBrowseMode('play')}>Play</Button>
            <Button type="button" variant={videoBrowseMode === 'possession' ? 'default' : 'outline'} size="sm" className="h-9 px-4 text-sm" onClick={() => setVideoBrowseMode('possession')}>Possession</Button>
          </div>
        </div>
        <Card className="border-2 border-slate-400 bg-gradient-to-br from-slate-50 via-white to-white shadow-md">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-slate-900">Filters</div>
                <div className="text-xs text-slate-500">Switch between event clips and possession clips from the top-level mode toggle.</div>
              </div>
              <Button type="button" variant="outline" size="sm" className="h-9 px-4 text-sm" onClick={() => videoBrowseMode === 'play' ? resetVideoPlayFilters() : resetVideoPossessionFilters()}>
                Reset Filters
              </Button>
            </div>

            {videoBrowseMode === 'play' ? (
              <div className="space-y-3">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,0.9fr)_minmax(0,1.55fr)] lg:items-stretch">
                  <div className={VIDEO_FIELD_STACK_CLASS}>
                    <Label className={VIDEO_FIELD_LABEL_CLASS}>Team</Label>
                    <Select value={team} onValueChange={setTeam}>
                      <SelectTrigger className={VIDEO_CONTROL_CLASS}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="both">Both</SelectItem>
                        <SelectItem value="home">{homeTeam?.name || 'Home'}</SelectItem>
                        <SelectItem value="away">{awayTeam?.name || 'Away'}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <MultiSelect
                    label="Player"
                    placeholder="Any"
                    values={playerIds}
                    onChange={setPlayerIds}
                    options={labelledPlayerOptions}
                    className={`${VIDEO_FIELD_STACK_CLASS} self-stretch space-y-0`}
                    triggerClassName={`${VIDEO_CONTROL_CLASS} font-normal leading-none`}
                    labelClassName={VIDEO_FIELD_LABEL_CLASS}
                  />
                  <MultiSelect
                    label="Half"
                    values={halves}
                    onChange={setHalves}
                    options={['first', 'second', 'et_first', 'et_second'].map((v) => ({ value: v, label: toTitleCase(v) }))}
                    className={`${VIDEO_FIELD_STACK_CLASS} self-stretch space-y-0`}
                    triggerClassName={`${VIDEO_CONTROL_CLASS} font-normal leading-none`}
                    labelClassName={VIDEO_FIELD_LABEL_CLASS}
                  />
                  <div className={VIDEO_FIELD_STACK_CLASS}>
                    <Label className={VIDEO_FIELD_LABEL_CLASS}>Action</Label>
                    <Select value={videoPlayAction} onValueChange={setVideoPlayAction}>
                      <SelectTrigger className={VIDEO_CONTROL_CLASS}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {VIDEO_PLAY_ACTION_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <MatchTimeRangeSlider
                    className="lg:col-span-1 min-h-[84px] self-stretch"
                    timeMin={timeMin}
                    timeMax={timeMax}
                    match={match}
                    stats={stats}
                    imputedTimeById={imputedTimeById}
                    compact
                    onChange={({ timeMin: nextMin, timeMax: nextMax }) => {
                      setTimeMin(nextMin);
                      setTimeMax(nextMax);
                    }}
                  />
                </div>

                {videoPlayAction !== 'all' ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Action-Specific Filters</div>
                    {videoPlayAction === 'shot' ? (
                      <div className="grid gap-3 lg:grid-cols-5">
                        <MultiSelect label="Shot Type" placeholder="Any" values={videoShotTypes} onChange={setVideoShotTypes} options={videoShotTypeOptions} />
                        <MultiSelect label="Situation" placeholder="Any" values={videoShotSituations} onChange={setVideoShotSituations} options={videoShotSituationOptions} />
                        <MultiSelect label="Outcome" placeholder="Any" values={videoShotOutcomes} onChange={setVideoShotOutcomes} options={videoShotOutcomeOptions} />
                        <MultiSelect label="Pressure" placeholder="Any" values={videoShotPressure} onChange={setVideoShotPressure} options={videoShotPressureOptions} />
                        <MultiSelect label="Method" placeholder="Any" values={videoShotMethods} onChange={setVideoShotMethods} options={videoShotMethodOptions} />
                      </div>
                    ) : null}
                    {videoPlayAction === 'pass' ? (
                      <div className="space-y-3">
                        <div className="grid gap-3 lg:grid-cols-5">
                          <MultiSelect label="Origin" placeholder="Any" values={videoBuildOriginZones} onChange={setVideoBuildOriginZones} options={videoBuildOriginOptions} />
                          <MultiSelect label="Endpoint" placeholder="Any" values={videoBuildEndZones} onChange={setVideoBuildEndZones} options={videoBuildEndOptions} />
                          <MultiSelect label="Outcome" placeholder="Any" values={videoBuildOutcomes} onChange={setVideoBuildOutcomes} options={videoBuildOutcomeOptions} />
                          <MultiSelect label="Recipient" placeholder="Any" values={videoBuildRecipientIds} onChange={setVideoBuildRecipientIds} options={labelledPlayerOptions} />
                          <MultiSelect label="Accuracy" placeholder="Any" values={videoBuildAccuracy} onChange={setVideoBuildAccuracy} options={videoBuildAccuracyOptions} />
                        </div>
                        <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1.8fr)]">
                          <MultiSelect label="Pressure" placeholder="Any" values={videoBuildPressure} onChange={setVideoBuildPressure} options={videoBuildPressureOptions} />
                          <MultiSelect label="Progressive" placeholder="Any" values={videoBuildProgressive} onChange={setVideoBuildProgressive} options={videoBuildProgressiveOptions} />
                          <RangeSliderField
                            compact
                            label="Distance"
                            min={0}
                            max={videoBuildDistanceMaxBound}
                            step={1}
                            value={[
                              videoBuildDistanceMin === '' ? 0 : Number(videoBuildDistanceMin),
                              videoBuildDistanceMax === '' ? videoBuildDistanceMaxBound : Number(videoBuildDistanceMax),
                            ]}
                            onChange={([nextMin, nextMax]) => {
                              setVideoBuildDistanceMin(nextMin <= 0 ? '' : String(nextMin));
                              setVideoBuildDistanceMax(nextMax >= videoBuildDistanceMaxBound ? '' : String(nextMax));
                            }}
                            formatValue={(value) => `${Math.round(value)}`}
                            tickValues={[0, videoBuildDistanceMidpoint, videoBuildDistanceMaxBound]}
                            tickFormatter={(value) => String(Math.round(value))}
                            showBoundsText={false}
                          />
                        </div>
                      </div>
                    ) : null}
                    {videoPlayAction === 'carry' ? (
                      <div className="space-y-3">
                        <div className="grid gap-3 lg:grid-cols-4">
                          <MultiSelect label="Origin" placeholder="Any" values={videoBuildOriginZones} onChange={setVideoBuildOriginZones} options={videoBuildOriginOptions} />
                          <MultiSelect label="Endpoint" placeholder="Any" values={videoBuildEndZones} onChange={setVideoBuildEndZones} options={videoBuildEndOptions} />
                          <MultiSelect label="Outcome" placeholder="Any" values={videoBuildOutcomes} onChange={setVideoBuildOutcomes} options={videoBuildOutcomeOptions} />
                          <MultiSelect label="Pressure" placeholder="Any" values={videoBuildPressure} onChange={setVideoBuildPressure} options={videoBuildPressureOptions} />
                        </div>
                        <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1.8fr)]">
                          <MultiSelect label="Take On" placeholder="Any" values={videoCarryTakeOns} onChange={setVideoCarryTakeOns} options={videoCarryTakeOnOptions} />
                          <MultiSelect label="Progressive" placeholder="Any" values={videoBuildProgressive} onChange={setVideoBuildProgressive} options={videoBuildProgressiveOptions} />
                          <RangeSliderField
                            compact
                            label="Distance"
                            min={0}
                            max={videoBuildDistanceMaxBound}
                            step={1}
                            value={[
                              videoBuildDistanceMin === '' ? 0 : Number(videoBuildDistanceMin),
                              videoBuildDistanceMax === '' ? videoBuildDistanceMaxBound : Number(videoBuildDistanceMax),
                            ]}
                            onChange={([nextMin, nextMax]) => {
                              setVideoBuildDistanceMin(nextMin <= 0 ? '' : String(nextMin));
                              setVideoBuildDistanceMax(nextMax >= videoBuildDistanceMaxBound ? '' : String(nextMax));
                            }}
                            formatValue={(value) => `${Math.round(value)}`}
                            tickValues={[0, videoBuildDistanceMidpoint, videoBuildDistanceMaxBound]}
                            tickFormatter={(value) => String(Math.round(value))}
                            showBoundsText={false}
                          />
                        </div>
                      </div>
                    ) : null}
                    {videoPlayAction === 'kickout' ? (
                      <div className="grid gap-3 lg:grid-cols-4">
                        <MultiSelect label="Target" placeholder="Any" values={videoKickoutTargets} onChange={setVideoKickoutTargets} options={videoKickoutTargetOptions} />
                        <MultiSelect label="Won By" placeholder="Any" values={videoKickoutWonBy} onChange={setVideoKickoutWonBy} options={kickoutWonByOptions} />
                        <MultiSelect label="Lost By" placeholder="Any" values={videoKickoutLostBy} onChange={setVideoKickoutLostBy} options={videoKickoutLostByOptions} />
                        <MultiSelect label="Outcome" placeholder="Any" values={videoKickoutOutcomes} onChange={setVideoKickoutOutcomes} options={videoKickoutOutcomeOptions} />
                        <MultiSelect label="Distance" placeholder="Any" values={videoKickoutLengths} onChange={setVideoKickoutLengths} options={videoKickoutLengthOptions} />
                        <MultiSelect label="Direction" placeholder="Any" values={videoKickoutSides} onChange={setVideoKickoutSides} options={videoKickoutSideOptions} />
                        <MultiSelect label="Press" placeholder="Any" values={videoKickoutPress} onChange={setVideoKickoutPress} options={videoKickoutPressOptions} />
                      </div>
                    ) : null}
                    {videoPlayAction === 'turnover' ? (
                      <div className="grid gap-3 lg:grid-cols-4">
                        <MultiSelect label="Type" placeholder="Any" values={videoTurnoverTypes} onChange={setVideoTurnoverTypes} options={videoTurnoverTypeOptions} />
                        <MultiSelect label="Won By" placeholder="Any" values={videoTurnoverWonBy} onChange={setVideoTurnoverWonBy} options={videoTurnoverWonByOptions} />
                        <MultiSelect label="Lost By" placeholder="Any" values={videoTurnoverLostBy} onChange={setVideoTurnoverLostBy} options={videoTurnoverLostByOptions} />
                        <MultiSelect label="Recovered By" placeholder="Any" values={videoTurnoverRecoveredBy} onChange={setVideoTurnoverRecoveredBy} options={videoTurnoverRecoveredByOptions} />
                      </div>
                    ) : null}
                    {videoPlayAction === 'foul' ? (
                      <div className="grid gap-3 lg:grid-cols-3">
                        <MultiSelect label="Type" placeholder="Any" values={videoFoulTypes} onChange={setVideoFoulTypes} options={videoFoulTypeOptions} />
                        <MultiSelect label="Foul On" placeholder="Any" values={videoFoulOn} onChange={setVideoFoulOn} options={videoFoulOnOptions} />
                        <MultiSelect label="Foul By" placeholder="Any" values={videoFoulBy} onChange={setVideoFoulBy} options={videoFoulByOptions} />
                      </div>
                    ) : null}
                    {videoPlayAction === 'def_pressure' ? (
                      <div className="grid gap-3 lg:grid-cols-4">
                        <MultiSelect label="Outcome" placeholder="Any" values={videoDefPressureOutcomes} onChange={setVideoDefPressureOutcomes} options={videoDefPressureOutcomeOptions} />
                        <MultiSelect label="Action" placeholder="Any" values={videoDefPressureActions} onChange={setVideoDefPressureActions} options={videoDefPressureActionOptions} />
                        <MultiSelect label="Zone" placeholder="Any" values={videoDefPressureZones} onChange={setVideoDefPressureZones} options={videoDefPressureZoneOptions} />
                        <MultiSelect label="Attacker" placeholder="Any" values={videoDefPressureAttackers} onChange={setVideoDefPressureAttackers} options={videoDefPressureAttackerOptions} />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,0.85fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.55fr)] lg:items-stretch">
                  <div className={VIDEO_FIELD_STACK_CLASS}>
                    <Label className={VIDEO_FIELD_LABEL_CLASS}>Team</Label>
                    <Select value={videoPossessionTeam} onValueChange={setVideoPossessionTeam}>
                      <SelectTrigger className={VIDEO_CONTROL_CLASS}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="both">Both</SelectItem>
                        <SelectItem value="home">{homeTeam?.name || 'Home'}</SelectItem>
                        <SelectItem value="away">{awayTeam?.name || 'Away'}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <MultiSelect
                    label="Half"
                    values={videoPossessionHalves}
                    onChange={setVideoPossessionHalves}
                    options={['first', 'second', 'et_first', 'et_second'].map((v) => ({ value: v, label: toTitleCase(v) }))}
                    className={`${VIDEO_FIELD_STACK_CLASS} self-stretch space-y-0`}
                    triggerClassName={VIDEO_CONTROL_CLASS}
                    labelClassName={VIDEO_FIELD_LABEL_CLASS}
                  />
                  <MultiSelect label="Start Zone" placeholder="Any" values={videoPossessionStartZoneFilter} onChange={setVideoPossessionStartZoneFilter} options={POSSESSION_START_ZONES.map((value) => ({ value, label: value }))} className={`${VIDEO_FIELD_STACK_CLASS} self-stretch space-y-0`} triggerClassName={VIDEO_CONTROL_CLASS} labelClassName={VIDEO_FIELD_LABEL_CLASS} />
                  <MultiSelect label="Origin" placeholder="Any" values={videoPossessionOriginFilter} onChange={setVideoPossessionOriginFilter} options={POSSESSION_ORIGIN_GROUPS.map((value) => ({ value, label: value }))} className={`${VIDEO_FIELD_STACK_CLASS} self-stretch space-y-0`} triggerClassName={VIDEO_CONTROL_CLASS} labelClassName={VIDEO_FIELD_LABEL_CLASS} />
                  <MultiSelect label="Outcome" placeholder="Any" values={videoPossessionOutcomeFilter} onChange={setVideoPossessionOutcomeFilter} options={POSSESSION_OUTCOME_GROUPS.map((value) => ({ value, label: value }))} className={`${VIDEO_FIELD_STACK_CLASS} self-stretch space-y-0`} triggerClassName={VIDEO_CONTROL_CLASS} labelClassName={VIDEO_FIELD_LABEL_CLASS} />
                  <MatchTimeRangeSlider
                    className="lg:col-span-1 min-h-[84px] self-stretch"
                    timeMin={videoPossessionTimeMin}
                    timeMax={videoPossessionTimeMax}
                    match={match}
                    stats={stats}
                    imputedTimeById={imputedTimeById}
                    compact
                    onChange={({ timeMin: nextMin, timeMax: nextMax }) => {
                      setVideoPossessionTimeMin(nextMin);
                      setVideoPossessionTimeMax(nextMax);
                    }}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-2 border-slate-400 bg-gradient-to-br from-slate-50 via-white to-white shadow-md">
          <CardContent className="p-4 space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="font-semibold text-slate-900">{videoBrowseMode === 'play' ? 'Play Workspace' : 'Possession Workspace'}</div>
                <div className="text-xs text-slate-500">
                  {videoBrowseMode === 'play'
                    ? `Showing ${Math.min(videoVisiblePlayRows.length, sortedVideoPlayTableRows.length)} of ${sortedVideoPlayTableRows.length} event rows.`
                    : `Showing ${Math.min(videoVisiblePossessionRows.length, sortedVideoPossessionRows.length)} of ${sortedVideoPossessionRows.length} possessions.`}
                </div>
              </div>
              <div className="flex min-h-[32px] flex-wrap items-center justify-end gap-2 lg:min-w-[360px]">
                <div className="inline-flex rounded-xl bg-slate-100 p-1">
                  <Button type="button" variant={videoViewMode === 'table' ? 'default' : 'outline'} size="sm" className="h-8 px-3 text-xs" onClick={() => setVideoViewMode('table')}>Table</Button>
                  <Button type="button" variant={videoViewMode === 'pitch' ? 'default' : 'outline'} size="sm" className="h-8 px-3 text-xs" onClick={() => setVideoViewMode('pitch')}>Pitch</Button>
                  <Button type="button" variant={videoViewMode === 'split' ? 'default' : 'outline'} size="sm" className="h-8 px-3 text-xs" onClick={() => setVideoViewMode('split')}>Split</Button>
                </div>
                {(videoBrowseMode === 'play' ? sortedVideoPlayTableRows.length : sortedVideoPossessionRows.length) > VIDEO_PREVIEW_COUNT ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 w-[92px] px-3 text-xs"
                    onClick={() => videoBrowseMode === 'play' ? setVideoPlayExpanded((current) => !current) : setVideoPossessionExpanded((current) => !current)}
                  >
                    {(videoBrowseMode === 'play' ? videoPlayExpanded : videoPossessionExpanded) ? 'Collapse' : 'Expand'}
                  </Button>
                ) : <div className="h-8 w-[92px]" />}
              </div>
            </div>

            <div className={`${videoViewMode === 'split' ? 'grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]' : ''}`}>
              {(videoViewMode === 'pitch' || videoViewMode === 'split') ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    {videoBrowseMode === 'play' ? (
                      <PitchViz
                        stats={sortedVideoPlayTableRows.map((row) => row.stat)}
                        contextStats={stats}
                        homeColor={homeTeam?.color}
                        awayColor={awayTeam?.color}
                        colorBy="team"
                        showColorControls
                        onOpenVideoAt={openVideoAt}
                        onStatClick={(stat) => setSelectedVideoPlayId((current) => String(current) === String(stat?.id) ? null : stat?.id)}
                        selectedStatId={selectedVideoPlayId}
                        fullscreenEnabled={false}
                        fullscreenTitle="Video Pitch"
                      />
                    ) : (
                      <PitchViz
                        stats={selectedVideoPossessionRow?.stats || videoVisiblePossessionRows.flatMap((row) => row.stats || [])}
                        contextStats={stats}
                        homeColor={homeTeam?.color}
                        awayColor={awayTeam?.color}
                        colorBy="team"
                        showColorControls
                        onOpenVideoAt={openVideoAt}
                        onStatClick={(stat) => {
                          const owner = sortedVideoPossessionRows.find((row) => Array.isArray(row.stats) && row.stats.some((entry) => String(entry?.id) === String(stat?.id)));
                          if (owner) setSelectedVideoPossessionKey(owner.key);
                        }}
                        fullscreenEnabled={false}
                        fullscreenTitle="Possession Pitch"
                      />
                    )}
                  </div>

                  {videoBrowseMode === 'play' && selectedVideoPlayRow ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{selectedVideoPlayRow.player}</div>
                          <div className="text-xs text-slate-500">{selectedVideoPlayRow.team} Â· {selectedVideoPlayRow.action} Â· {selectedVideoPlayRow.time}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          {!isLiveMode && Number.isFinite(Number(selectedVideoPlayRow.stat?.time_s)) ? (
                            <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => openVideoAt(Number(selectedVideoPlayRow.stat.time_s))}>Open Video</Button>
                          ) : null}
                          <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => {
                            setVizStats([selectedVideoPlayRow.stat]);
                            setVizTitle(`${selectedVideoPlayRow.action} - ${selectedVideoPlayRow.team}`);
                            setVizOpen(true);
                          }}>Visualise</Button>
                        </div>
                      </div>
                      <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
                        <div>Play: <span className="font-medium text-slate-900">{selectedVideoPlayRow.play ?? 'NA'}</span></div>
                        <div>Poss: <span className="font-medium text-slate-900">{selectedVideoPlayRow.poss ?? 'NA'}</span></div>
                        <div>Secondary: <span className="font-medium text-slate-900">{selectedVideoPlayRow.secondaryPlayer}</span></div>
                        <div>Outcome: <span className="font-medium text-slate-900">{selectedVideoPlayRow.outcome}</span></div>
                        <div>Half: <span className="font-medium text-slate-900">{selectedVideoPlayRow.half}</span></div>
                      </div>
                    </div>
                  ) : null}

                  {videoBrowseMode === 'possession' && selectedVideoPossessionRow ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">Possession #{selectedVideoPossessionRow.possessionId}</div>
                          <div className="text-xs text-slate-500">{formatTeamName(selectedVideoPossessionRow.teamSide, homeTeam, awayTeam)} Â· {selectedVideoPossessionRow.originLabel} Â· {selectedVideoPossessionRow.groupedOutcome}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          {!isLiveMode && Number.isFinite(selectedVideoPossessionRow.videoStartTime) ? (
                            <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => openVideoAt(selectedVideoPossessionRow.videoStartTime)}>Open Video</Button>
                          ) : null}
                          <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => openPossessionVisualise(selectedVideoPossessionRow)}>Visualise</Button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {(videoViewMode === 'table' || videoViewMode === 'split') ? (
                <div className="overflow-x-auto">
                  {videoBrowseMode === 'play' ? (
                    <Table className="table-fixed w-full">
                      <colgroup>
                        {videoPlayColumns.map((column) => (
                          <col key={column.key} style={column.width ? { width: column.width } : undefined} />
                        ))}
                      </colgroup>
                      <TableHeader>
                        <TableRow>
                          {videoPlayColumns.map((column) => (
                            <SortableTableHead
                              key={column.key}
                              column={column}
                              sortState={videoPlaySort}
                              onToggle={toggleVideoPlaySort}
                              className={column.key === 'actions' ? 'text-center' : undefined}
                            />
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {videoVisiblePlayRows.map((row) => {
                          const t = Number(row.stat?.time_s);
                          const hasTime = Number.isFinite(t);
                          const isSelected = String(selectedVideoPlayId) === String(row.id);
                          return (
                            <TableRow
                              key={row.id}
                              style={{
                                ...dataRowStyle(row.stat, homeTeam, awayTeam),
                                boxShadow: isSelected ? 'inset 0 0 0 2px rgba(15,23,42,0.2)' : undefined,
                              }}
                              className="cursor-pointer"
                              onClick={() => setSelectedVideoPlayId((current) => String(current) === String(row.id) ? null : row.id)}
                            >
                              <TableCell className="font-mono text-xs tabular-nums">{row.play ?? 'NA'}</TableCell>
                              <TableCell className="font-mono text-xs tabular-nums">{row.poss ?? 'NA'}</TableCell>
                              <TableCell className="text-xs whitespace-nowrap">{row.half}</TableCell>
                              <TableCell className="text-xs whitespace-nowrap">{row.time}</TableCell>
                              <TableCell className="truncate text-xs">{row.team}</TableCell>
                              <TableCell className="truncate text-xs">{row.player}</TableCell>
                              <TableCell className="truncate text-xs">{row.action}</TableCell>
                              <TableCell className="truncate text-xs">{row.outcome}</TableCell>
                              <TableCell className="truncate text-xs">{row.secondaryPlayer}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                <div className="flex items-center justify-center gap-2">
                                  {!isLiveMode ? (
                                    <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={!hasTime} onClick={(e) => { e.stopPropagation(); hasTime && openVideoAt(t); }}>
                                      Open Video
                                    </Button>
                                  ) : null}
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-7 px-2 text-xs"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setVizStats([row.stat]);
                                      setVizTitle(`${row.action} - ${row.team}`);
                                      setVizOpen(true);
                                    }}
                                  >
                                    Visualise
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        {videoVisiblePlayRows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={10} className="py-8 text-center text-sm text-slate-500">No play clips found for the current filters.</TableCell>
                          </TableRow>
                        ) : null}
                      </TableBody>
                    </Table>
                  ) : (
                    <Table className="table-fixed w-full">
                      <colgroup>
                        {videoPossessionColumns.map((column) => (
                          <col key={column.key} style={column.width ? { width: column.width } : undefined} />
                        ))}
                      </colgroup>
                      <TableHeader>
                        <TableRow>
                          {videoPossessionColumns.map((column) => (
                            <SortableTableHead
                              key={column.key}
                              column={column}
                              sortState={videoPossessionSort}
                              onToggle={toggleVideoPossessionSort}
                              className={column.key === 'actions' ? 'text-center' : undefined}
                            />
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {videoVisiblePossessionRows.map((row) => {
                          const isSelected = String(selectedVideoPossessionKey) === String(row.key);
                          return (
                            <TableRow
                              key={row.key}
                              style={{
                                ...possessionRowStyle({ possession_team_side: row.teamSide }, homeTeam, awayTeam),
                                boxShadow: isSelected ? 'inset 0 0 0 2px rgba(15,23,42,0.2)' : undefined,
                              }}
                              className="cursor-pointer"
                              onClick={() => setSelectedVideoPossessionKey((current) => String(current) === String(row.key) ? null : row.key)}
                            >
                              <TableCell className="font-mono text-xs tabular-nums">{row.possessionId}</TableCell>
                              <TableCell className="truncate text-xs">{formatTeamName(row.teamSide, homeTeam, awayTeam)}</TableCell>
                              <TableCell className="text-xs whitespace-nowrap">{toTitleCase(row.half)}</TableCell>
                              <TableCell className="text-xs whitespace-nowrap">{Number.isFinite(row.startTime) ? formatMatchClock(row.startTime, match, row.half) : 'NA'}</TableCell>
                              <TableCell className="text-xs whitespace-nowrap">{Number.isFinite(row.endTime) ? formatMatchClock(row.endTime, match, row.half) : 'NA'}</TableCell>
                              <TableCell className="text-xs whitespace-nowrap">{Number.isFinite(row.duration) ? `${row.duration.toFixed(1)}s` : 'NA'}</TableCell>
                              <TableCell className="truncate text-xs">{row.originLabel || 'NA'}</TableCell>
                              <TableCell className="truncate text-xs">{row.groupedOutcome || 'NA'}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                <div className="flex items-center justify-center gap-2">
                                  {!isLiveMode && Number.isFinite(row.videoStartTime) ? (
                                    <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={(e) => { e.stopPropagation(); openVideoAt(row.videoStartTime); }}>
                                      Open Video
                                    </Button>
                                  ) : null}
                                  <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={(e) => { e.stopPropagation(); openPossessionVisualise(row); }}>
                                    Visualise
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        {videoVisiblePossessionRows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={9} className="py-8 text-center text-sm text-slate-500">No possession clips found for the current filters.</TableCell>
                          </TableRow>
                        ) : null}
                      </TableBody>
                    </Table>
                  )}
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Dialog open={vizOpen} onOpenChange={setVizOpen}>
          <DialogContent className="sm:max-w-4xl p-4">
            <DialogHeader>
              <div className="flex items-center justify-between gap-2">
                <DialogTitle className="text-base">{vizTitle || 'Visualise'}</DialogTitle>
                {(() => {
                  const times = (vizStats || []).map((s) => Number(s?.time_s)).filter(Number.isFinite);
                  if (isLiveMode || !times.length) return null;
                  const t = Math.min(...times);
                  return (
                    <Button type="button" variant="outline" size="sm" className="h-8 px-3 text-xs" onClick={() => openVideoAt(t)}>
                      Open Video @ {formatMMSS(Math.max(0, t - VIDEO_PRE_ROLL_S))}
                    </Button>
                  );
                })()}
              </div>
            </DialogHeader>
            <div className="pt-2">
              <PitchViz stats={vizStats} homeColor={homeTeam?.color} awayColor={awayTeam?.color} colorBy="team" showColorControls />
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!isVideoMode && (
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-slate-900">Data Health</div>
              <div className="text-xs text-slate-500">Checks for rows that can break possession, filters, timing, or player reports.</div>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className={`rounded-full px-2 py-1 font-medium ${healthSummary.errors ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                {healthSummary.errors} error{healthSummary.errors === 1 ? '' : 's'}
              </span>
              <span className={`rounded-full px-2 py-1 font-medium ${healthSummary.warnings ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                {healthSummary.warnings} warning{healthSummary.warnings === 1 ? '' : 's'}
              </span>
            </div>
          </div>
          {healthChecks.length ? (
            <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Severity</TableHead>
                    <TableHead>Check</TableHead>
                    <TableHead>Detail</TableHead>
                    <TableHead className="text-right">Play</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {healthChecks.slice(0, 50).map((check, idx) => (
                    <TableRow key={`${check.title}-${check.statId || idx}`}>
                      <TableCell className={check.severity === 'error' ? 'font-medium text-red-700' : 'font-medium text-amber-700'}>
                        {toTitleCase(check.severity)}
                      </TableCell>
                      <TableCell className="font-medium">{check.title}</TableCell>
                      <TableCell className="text-xs text-slate-600">{check.detail}</TableCell>
                      <TableCell className="text-right tabular-nums">{check.playId || 'NA'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              No obvious data-health issues found in the current filtered data model.
            </div>
          )}
        </CardContent>
      </Card>
      )}
      <Card>
        <CardContent className="p-4">
          <div className="font-semibold text-slate-900 mb-3">Filters</div>
          <div className="grid lg:grid-cols-6 gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-xs text-slate-600">Team</Label>
              <Select value={team} onValueChange={setTeam}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Both</SelectItem>
                  <SelectItem value="home">{homeTeam?.name || 'Home'}</SelectItem>
                  <SelectItem value="away">{awayTeam?.name || 'Away'}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <MultiSelect
              label="Action"
              values={actions}
              onChange={setActions}
              options={['shot', 'kickout', 'pass', 'carry', 'turnover', 'foul', 'throw_in'].map((v) => ({ value: v, label: toTitleCase(v) }))}
            />
            <MultiSelect
              label="Half"
              values={halves}
              onChange={setHalves}
              options={['first', 'second', 'et_first', 'et_second'].map((v) => ({ value: v, label: toTitleCase(v) }))}
            />
            <MultiSelect
              label="Player"
              placeholder="Any"
              values={playerIds}
              onChange={setPlayerIds}
              options={playerOptions.map((p) => ({ value: p.id, label: (p.team_side === 'away' ? 'Away: ' : 'Home: ') + p.label }))}
            />
            <MatchTimeRangeSlider
              className="lg:col-span-2"
              timeMin={timeMin}
              timeMax={timeMax}
              match={match}
              stats={stats}
              imputedTimeById={imputedTimeById}
              onChange={({ timeMin: nextMin, timeMax: nextMax }) => {
                setTimeMin(nextMin);
                setTimeMax(nextMax);
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Dialog open={vizOpen} onOpenChange={setVizOpen}>
        <DialogContent className="sm:max-w-4xl p-4">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2">
              <DialogTitle className="text-base">{vizTitle || 'Visualise'}</DialogTitle>
              {(() => {
                const times = (vizStats || []).map((s) => Number(s?.time_s)).filter(Number.isFinite);
                if (isLiveMode || !times.length) return null;
                const t = Math.min(...times);
                return (
                  <Button type="button" variant="outline" size="sm" className="h-8 px-3 text-xs" onClick={() => openVideoAt(t)} title="Open the video popout and jump to this timestamp">
                    Open Video @ {formatMMSS(Math.max(0, t - VIDEO_PRE_ROLL_S))}
                  </Button>
                );
              })()}
            </div>
          </DialogHeader>
          <div className="pt-2">
            <PitchViz stats={vizStats} homeColor={homeTeam?.color} awayColor={awayTeam?.color} colorBy="team" showColorControls={false} />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-4xl p-4 max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">Edit Play / Stat Data</DialogTitle>
          </DialogHeader>
          {editStat ? (
            <div className="space-y-4 text-sm">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <div className="font-semibold text-slate-900">Current Row</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><span className="text-slate-500">Play:</span> <span className="font-mono">{Number.isFinite(Number(editStat.play_id)) ? Number(editStat.play_id) : 'NA'}</span></div>
                    <div><span className="text-slate-500">Possession:</span> <span className="font-mono">{Number.isFinite(Number(editStat.possession_id)) ? Number(editStat.possession_id) : 'NA'}</span></div>
                    <div><span className="text-slate-500">Possession Team:</span> {formatTeamName(editStat.possession_team_side, homeTeam, awayTeam)}</div>
                    <div><span className="text-slate-500">Grouping:</span> <span className="font-mono">{getPossessionKey(editStat)}</span></div>
                  </div>
                  <div className="text-xs text-slate-600">{summarizeRow(editStat, match, imputedTimeById, homeTeam, awayTeam)}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                  <div className="font-semibold text-slate-900">Context</div>
                  <div className="text-xs"><span className="text-slate-500">Previous:</span> {summarizeRow(editPrev, match, imputedTimeById, homeTeam, awayTeam)}</div>
                  <div className="text-xs"><span className="text-slate-500">Next:</span> {summarizeRow(editNext, match, imputedTimeById, homeTeam, awayTeam)}</div>
                  <div className="text-xs"><span className="text-slate-500">Scope:</span> {editRangeStats.length} row{editRangeStats.length === 1 ? '' : 's'} selected</div>
                </div>
              </div>
              <div className="grid md:grid-cols-4 gap-3 items-end">
                <div className="space-y-1">
                  <Label className="text-xs text-slate-600">Scope</Label>
                  <Select value={editScope} onValueChange={setEditScope}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="row_only">This row only</SelectItem>
                      <SelectItem value="row_tail">This row + following rows</SelectItem>
                      <SelectItem value="entire_possession">Entire current possession</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-3 text-xs text-slate-500 rounded-md border border-dashed border-slate-200 p-2">
                  Row + following rows stops at the next possession break. Play reordering applies to the selected row and then resequences play IDs safely.
                </div>
              </div>

              <div className="grid lg:grid-cols-2 gap-4">
                <div className="rounded-lg border border-slate-200 p-3 space-y-3">
                  <div className="font-semibold text-slate-900">Guided Possession Tools</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={!previousPossession || persistMutation.isPending} onClick={() => previousPossession && runPossessionAction({ label: 'Move to previous possession', targetId: Number(previousPossession.possession_id), targetTeam: previousPossession.possession_team_side })}>Move to Previous Possession</Button>
                    <Button type="button" variant="outline" size="sm" disabled={!nextPossession || persistMutation.isPending} onClick={() => nextPossession && runPossessionAction({ label: 'Move to next possession', targetId: Number(nextPossession.possession_id), targetTeam: nextPossession.possession_team_side })}>Move to Next Possession</Button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-end">
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Possession #</Label>
                      <Input className="h-8 text-xs" inputMode="numeric" value={targetPossessionId} onChange={(e) => setTargetPossessionId(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Team</Label>
                      <Select value={targetPossessionTeam} onValueChange={setTargetPossessionTeam}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="home">{homeTeam?.name || 'Home'}</SelectItem>
                          <SelectItem value="away">{awayTeam?.name || 'Away'}</SelectItem>
                          <SelectItem value="unknown">Unknown</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button type="button" size="sm" disabled={persistMutation.isPending} onClick={() => runPossessionAction({ label: 'Move to chosen possession', targetId: targetPossessionId, targetTeam: targetPossessionTeam })}>Move to Chosen Poss.</Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 items-end">
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Change possession team</Label>
                      <Select value={newPossessionTeam} onValueChange={setNewPossessionTeam}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="home">{homeTeam?.name || 'Home'}</SelectItem>
                          <SelectItem value="away">{awayTeam?.name || 'Away'}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button type="button" variant="outline" size="sm" disabled={persistMutation.isPending} onClick={() => runPossessionAction({ label: 'Change possession team', targetId: Number(editStat.possession_id), targetTeam: newPossessionTeam })}>Change Possession Team</Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 items-end">
                    <div className="text-xs text-slate-500">Starts a new possession at this row using the selected team.</div>
                    <Button type="button" variant="outline" size="sm" disabled={persistMutation.isPending} onClick={() => runPossessionAction({ label: 'Start new possession here', targetId: maxPossessionId + 1, targetTeam: newPossessionTeam })}>Start New Possession Here</Button>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 p-3 space-y-3">
                  <div className="font-semibold text-slate-900">Guided Play Order Tools</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={editIndex <= 0 || persistMutation.isPending} onClick={() => runPlayMove({ label: 'Move earlier', getNewOrder: (ordered) => { const next = [...ordered]; const [row] = next.splice(editIndex, 1); next.splice(Math.max(0, editIndex - 1), 0, row); return next; } })}>Move Earlier</Button>
                    <Button type="button" variant="outline" size="sm" disabled={editIndex < 0 || editIndex >= orderedAllStats.length - 1 || persistMutation.isPending} onClick={() => runPlayMove({ label: 'Move later', getNewOrder: (ordered) => { const next = [...ordered]; const [row] = next.splice(editIndex, 1); next.splice(Math.min(next.length, editIndex + 1), 0, row); return next; } })}>Move Later</Button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-end">
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs text-slate-600">Target row</Label>
                      <Select value={moveTargetId} onValueChange={setMoveTargetId}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Choose a row" /></SelectTrigger>
                        <SelectContent>
                          {moveTargetOptions.map((stat) => (
                            <SelectItem key={stat.id} value={stat.id}>{summarizeRow(stat, match, imputedTimeById, homeTeam, awayTeam)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="text-xs text-slate-500">Selected row only</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={!moveTargetId || persistMutation.isPending} onClick={() => { runPlayMove({ label: 'Move before chosen row', getNewOrder: (ordered) => { const currentIndex = ordered.findIndex((stat) => stat.id === editStat.id); const next = [...ordered]; const [row] = next.splice(currentIndex, 1); const insertAt = next.findIndex((stat) => stat.id === moveTargetId); next.splice(Math.max(0, insertAt), 0, row); return next; } }); }}>Move Before Chosen Row</Button>
                    <Button type="button" variant="outline" size="sm" disabled={!moveTargetId || persistMutation.isPending} onClick={() => { runPlayMove({ label: 'Move after chosen row', getNewOrder: (ordered) => { const currentIndex = ordered.findIndex((stat) => stat.id === editStat.id); const next = [...ordered]; const [row] = next.splice(currentIndex, 1); const insertAt = next.findIndex((stat) => stat.id === moveTargetId); next.splice(insertAt + 1, 0, row); return next; } }); }}>Move After Chosen Row</Button>
                  </div>
                </div>
              </div>

              <details className="rounded-lg border border-amber-200 bg-amber-50/60 p-3" open={advancedOpen} onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}>
                <summary className="cursor-pointer font-semibold text-amber-900">Advanced Raw IDs</summary>
                <div className="space-y-3 pt-3">
                  <div className="text-xs text-amber-800">Raw changes can affect possession analysis and ordering. Play ID changes are normalized safely after save.</div>
                  <div className="grid md:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Play ID</Label>
                      <Input className="h-8 text-xs" inputMode="numeric" value={advancedPlayId} onChange={(e) => setAdvancedPlayId(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Possession ID</Label>
                      <Input className="h-8 text-xs" inputMode="numeric" value={advancedPossessionId} onChange={(e) => setAdvancedPossessionId(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Possession Team</Label>
                      <Select value={advancedPossessionTeam} onValueChange={setAdvancedPossessionTeam}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="home">{homeTeam?.name || 'Home'}</SelectItem>
                          <SelectItem value="away">{awayTeam?.name || 'Away'}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button type="button" size="sm" variant="outline" disabled={persistMutation.isPending} onClick={applyAdvanced}>Apply Advanced Changes</Button>
                  </div>
                </div>
              </details>

              <details className="rounded-lg border border-slate-200 bg-slate-50/60 p-3" open>
                <summary className="cursor-pointer font-semibold text-slate-900">Structured Stat Fields</summary>
                <div className="space-y-3 pt-3">
                  <div className="text-xs text-slate-600">Edit the row's main fields without changing coordinates or possession structure. Use the advanced JSON box only when a field is not exposed here.</div>
                  <div className="grid md:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Stat Type</Label>
                      <Select value={rawStatType || 'shot'} onValueChange={setRawStatType}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {['shot', 'kickout', 'pass', 'carry', 'turnover', 'foul', 'throw_in', 'substitution', 'period_end'].map((v) => (
                            <SelectItem key={v} value={v}>{toTitleCase(v)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Team</Label>
                      <Select value={rawTeamSide} onValueChange={setRawTeamSide}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="home">{homeTeam?.name || 'Home'}</SelectItem>
                          <SelectItem value="away">{awayTeam?.name || 'Away'}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Half</Label>
                      <Select value={rawHalf} onValueChange={setRawHalf}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="first">First</SelectItem>
                          <SelectItem value="second">Second</SelectItem>
                          <SelectItem value="et_first">ET First</SelectItem>
                          <SelectItem value="et_second">ET Second</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid md:grid-cols-5 gap-3">
                    <FieldBool label="Set Defence" value={!!rawSetDefence} onChange={setRawSetDefence} />
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Video Time (s)</Label>
                      <Input className="h-8 text-xs" inputMode="numeric" value={rawTimeS} onChange={(e) => setRawTimeS(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Period Clock (s)</Label>
                      <Input className="h-8 text-xs" inputMode="numeric" value={rawNormalizedTimeS} onChange={(e) => setRawNormalizedTimeS(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Player #</Label>
                      <Input className="h-8 text-xs" inputMode="numeric" value={rawPlayerNumber} onChange={(e) => setRawPlayerNumber(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Recipient #</Label>
                      <Input className="h-8 text-xs" inputMode="numeric" value={rawRecipientNumber} onChange={(e) => setRawRecipientNumber(e.target.value)} />
                    </div>
                  </div>
                  <div className="grid md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Player Name</Label>
                      <Input className="h-8 text-xs" value={rawPlayerName} onChange={(e) => setRawPlayerName(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Recipient Name</Label>
                      <Input className="h-8 text-xs" value={rawRecipientName} onChange={(e) => setRawRecipientName(e.target.value)} />
                    </div>
                  </div>
                  {rawStatType === 'pass' && (
                    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
                      <div className="grid md:grid-cols-4 gap-3">
                        <SelectionField label="Passer" section="pass" field="passer" />
                        <SelectionField label="Intended Recipient" section="pass" field="intended_recipient" />
                        <SelectionField label="Won By" section="pass" field="won_by" />
                        <FieldBool label="Deadball" value={!!structuredExtra?.pass?.deadball} onChange={(v) => setStructuredExtraValue('pass', 'deadball', v)} />
                        <FieldSelect label="Method" value={structuredExtra?.pass?.method || 'hand'} onChange={(v) => setStructuredExtraValue('pass', 'method', v)} options={['hand', 'left', 'right'].map((v) => ({ value: v, label: toTitleCase(v) }))} />
                        <FieldSelect label="Accuracy" value={normalizePassAccuracy(structuredExtra?.pass?.accuracy)} onChange={(v) => setStructuredExtraValue('pass', 'accuracy', v)} options={['--', '-', '+', '++'].map((v) => ({ value: v, label: v }))} />
                        <FieldSelect label="Pressure" value={structuredExtra?.pass?.pressure_on_passer || 'low'} onChange={(v) => setStructuredExtraValue('pass', 'pressure_on_passer', v)} options={['low', 'medium', 'high'].map((v) => ({ value: v, label: toTitleCase(v) }))} />
                        <FieldSelect label="Outcome" value={structuredExtra?.pass?.outcome || 'completed'} onChange={(v) => setStructuredExtraValue('pass', 'outcome', v)} options={['completed', 'broken_retained', 'turnover', 'foul', 'sideline_for', 'sideline_against', '45_for', '45_against', 'goal_kick_for', 'goal_kick_against'].map((v) => ({ value: v, label: v === 'broken_retained' ? 'Broken - Retained' : toTitleCase(v) }))} />
                      </div>
                      {structuredExtra?.pass?.outcome === 'broken_retained' && <SelectionField label="Recovered By" section="pass" field="recovered_by" />}
                      {structuredExtra?.pass?.outcome === 'turnover' && renderTurnoverFields('Embedded Pass Turnover')}
                      {structuredExtra?.pass?.outcome === 'foul' && renderFoulFields('Embedded Pass Foul')}
                    </div>
                  )}
                  {rawStatType === 'carry' && (
                    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
                      <div className="grid md:grid-cols-4 gap-3">
                        <SelectionField label="Carrier" section="carry" field="carrier" />
                        <SelectionField label="Defender" section="carry" field="defender" />
                        <SelectionField label="Recovered By" section="carry" field="recovered_by" />
                        <FieldBool label="Solo & Go" value={!!structuredExtra?.carry?.solo_plus_go} onChange={(v) => setStructuredExtraValue('carry', 'solo_plus_go', v)} />
                        <FieldSelect label="Pressure" value={structuredExtra?.carry?.pressure_on_carrier || 'low'} onChange={(v) => setStructuredExtraValue('carry', 'pressure_on_carrier', v)} options={['low', 'medium', 'high'].map((v) => ({ value: v, label: toTitleCase(v) }))} />
                        <FieldSelect label="Take On" value={structuredExtra?.carry?.take_on || 'no'} onChange={(v) => setStructuredExtraValue('carry', 'take_on', v)} options={['no', 'completed', 'failed'].map((v) => ({ value: v, label: toTitleCase(v) }))} />
                        <FieldSelect label="Outcome" value={structuredExtra?.carry?.outcome || 'completed'} onChange={(v) => setStructuredExtraValue('carry', 'outcome', v)} options={['completed', 'turnover', 'foul', 'dispossessed_retained', 'turned_back', 'sideline_for', 'sideline_against', '45_for', '45_against', 'goal_kick_for', 'goal_kick_against'].map((v) => ({ value: v, label: toTitleCase(v) }))} />
                      </div>
                      {structuredExtra?.carry?.outcome === 'turnover' && renderTurnoverFields('Embedded Carry Turnover')}
                      {structuredExtra?.carry?.outcome === 'foul' && renderFoulFields('Embedded Carry Foul')}
                    </div>
                  )}
                  {rawStatType === 'shot' && (
                    <div className="grid md:grid-cols-4 gap-3 rounded-lg border border-slate-200 bg-white p-3">
                      <SelectionField label="Player" section="shot" field="player" />
                      <SelectionField label="Recovered By" section="shot" field="recovered_by" />
                      <SelectionField label="Blocked By" section="shot" field="blocked_by" />
                      <SelectionField label="Saved By" section="shot" field="saved_by" />
                      <FieldSelect label="Shot Type" value={structuredExtra?.shot?.shot_type || 'point'} onChange={(v) => setStructuredExtraValue('shot', 'shot_type', v)} options={['point', '2_point', 'goal'].map((v) => ({ value: v, label: toTitleCase(v) }))} />
                      <FieldSelect label="Situation" value={structuredExtra?.shot?.situation || 'play'} onChange={(v) => setStructuredExtraValue('shot', 'situation', v)} options={['play', 'free_hands', 'free_ground', 'mark', '45', 'penalty'].map((v) => ({ value: v, label: toTitleCase(v) }))} />
                      <FieldSelect label="Method" value={structuredExtra?.shot?.method || 'right'} onChange={(v) => setStructuredExtraValue('shot', 'method', v)} options={['left', 'right', 'hand'].map((v) => ({ value: v, label: toTitleCase(v) }))} />
                      <FieldSelect label="Pressure" value={structuredExtra?.shot?.pressure || 'low'} onChange={(v) => setStructuredExtraValue('shot', 'pressure', v)} options={['low', 'medium', 'high'].map((v) => ({ value: v, label: toTitleCase(v) }))} />
                      <FieldSelect label="Outcome" value={structuredExtra?.shot?.outcome || 'point'} onChange={(v) => setStructuredExtraValue('shot', 'outcome', v)} options={['point', '2_point', 'goal', 'wide', 'short', 'post', 'saved', 'blocked'].map((v) => ({ value: v, label: toTitleCase(v) }))} />
                      <FieldSelect label="Result" value={structuredExtra?.shot?.result || 'NA'} onChange={(v) => setStructuredExtraValue('shot', 'result', v === 'NA' ? '' : v)} options={['NA', 'retained', 'opposition', '45', 'wide'].map((v) => ({ value: v, label: toTitleCase(v) }))} />
                      <FieldBool label="Brought Back - Adv." value={!!structuredExtra?.shot?.brought_back_adv} onChange={(v) => setStructuredExtraValue('shot', 'brought_back_adv', v)} />
                    </div>
                  )}
                  {rawStatType === 'kickout' && (
                    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
                      <div className="grid md:grid-cols-4 gap-3">
                        <FieldSelect label="Kickout Team" value={structuredExtra?.kickout?.team_side || rawTeamSide} onChange={(v) => setStructuredExtraValue('kickout', 'team_side', v)} options={['home', 'away'].map((v) => ({ value: v, label: v === 'home' ? (homeTeam?.name || 'Home') : (awayTeam?.name || 'Away') }))} />
                        <SelectionField label="Intended Recipient" section="kickout" field="intended_recipient" />
                        <SelectionField label="Won By" section="kickout" field="won_by" />
                        <SelectionField label="Lost By" section="kickout" field="lost_by" />
                        <SelectionField label="Broken By" section="kickout" field="broken_by" />
                        <FieldSelect label="Outcome" value={structuredExtra?.kickout?.outcome || 'clean'} onChange={(v) => setStructuredExtraValue('kickout', 'outcome', v)} options={['clean', 'break', 'foul', 'sideline_for', 'sideline_against'].map((v) => ({ value: v, label: toTitleCase(v) }))} />
                        <FieldSelect label="Press" value={structuredExtra?.kickout?.press || 'm2m'} onChange={(v) => setStructuredExtraValue('kickout', 'press', v)} options={['m2m', 'zonal', 'conceded'].map((v) => ({ value: v, label: toTitleCase(v) }))} />
                        <FieldBool label="Mark" value={!!structuredExtra?.kickout?.mark} onChange={(v) => setStructuredExtraValue('kickout', 'mark', v)} />
                      </div>
                      {structuredExtra?.kickout?.outcome === 'foul' && renderFoulFields('Kickout Foul')}
                    </div>
                  )}
                  {rawStatType === 'throw_in' && (
                    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
                      <div className="grid md:grid-cols-4 gap-3">
                        <SelectionField label="Won By" section="throw_in" field="won_by" />
                        <SelectionField label="Lost By" section="throw_in" field="lost_by" />
                        <SelectionField label="Broken By" section="throw_in" field="broken_by" />
                        <FieldSelect label="Outcome" value={structuredExtra?.throw_in?.outcome || 'clean'} onChange={(v) => setStructuredExtraValue('throw_in', 'outcome', v)} options={['clean', 'break', 'foul'].map((v) => ({ value: v, label: toTitleCase(v) }))} />
                      </div>
                      {structuredExtra?.throw_in?.outcome === 'foul' && renderFoulFields('Throw-In Foul')}
                    </div>
                  )}
                  {rawStatType === 'turnover' && renderTurnoverFields()}
                  {rawStatType === 'foul' && renderFoulFields()}
                  {rawStatType === 'substitution' && (
                    <div className="grid md:grid-cols-3 gap-3 rounded-lg border border-slate-200 bg-white p-3">
                      <FieldSelect label="Sub Out" value={structuredExtra?.sub_out_id || 'none'} onChange={(v) => setStructuredRootValue('sub_out_id', v === 'none' ? '' : v)} options={[{ value: 'none', label: 'None' }, ...playerOptions.map((p) => ({ value: p.id, label: `${p.team_side === 'away' ? 'Away' : 'Home'}: ${p.label}` }))]} />
                      <FieldSelect label="Sub In" value={structuredExtra?.sub_in_id || 'none'} onChange={(v) => setStructuredRootValue('sub_in_id', v === 'none' ? '' : v)} options={[{ value: 'none', label: 'None' }, ...playerOptions.map((p) => ({ value: p.id, label: `${p.team_side === 'away' ? 'Away' : 'Home'}: ${p.label}` }))]} />
                      <FieldBool label="Temporary Sub" value={!!structuredExtra?.temporary} onChange={(v) => setStructuredRootValue('temporary', v)} />
                    </div>
                  )}
                  <details className="rounded-lg border border-slate-200 bg-white p-3" open={rawEditOpen} onToggle={(e) => setRawEditOpen(e.currentTarget.open)}>
                    <summary className="cursor-pointer text-xs font-semibold text-slate-900">Advanced Raw JSON</summary>
                    <div className="space-y-1 pt-3">
                      <Label className="text-xs text-slate-600">Extra JSON</Label>
                      <textarea
                        className="min-h-[160px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-mono"
                        value={rawExtraJson}
                        onChange={(e) => setRawExtraJson(e.target.value)}
                      />
                    </div>
                  </details>
                  {allowEditing ? (
                    <div className="flex items-center justify-between gap-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="text-red-600 hover:text-red-700"
                        disabled={deleteMutation.isPending || persistMutation.isPending}
                        onClick={() => setDeleteTarget(editStat)}
                      >
                        Delete Row
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="bg-emerald-600 text-white hover:bg-emerald-700"
                        disabled={persistMutation.isPending}
                        onClick={applyRawStatChanges}
                      >
                        Apply Stat Changes
                      </Button>
                    </div>
                  ) : null}
                </div>
              </details>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      {pivot ? (
        <Card>
          <CardContent className="p-4">
            <div className="font-semibold text-slate-900 mb-3">Pivot</div>
            <Table>
              <TableHeader>
                <TableRow>
                  {groupBy === 'possession' ? (
                    <>
                      <TableHead>Possession</TableHead>
                      <TableHead>Team</TableHead>
                      <TableHead>Half</TableHead>
                      <TableHead className="text-right">Start</TableHead>
                      <TableHead className="text-right">End</TableHead>
                      <TableHead className="text-right">Dur</TableHead>
                      <TableHead>Start Source</TableHead>
                      <TableHead>End Outcome</TableHead>
                      <TableHead>Attack</TableHead>
                      <TableHead>Entry</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                      <TableHead className="text-right">Shot Pts</TableHead>
                      {allowEditing ? <TableHead className="text-right">Edit</TableHead> : null}
                    </>
                  ) : (
                    <>
                      <TableHead>{toTitleCase(groupBy)}</TableHead>
                      <TableHead>Count</TableHead>
                      <TableHead>Shot Points</TableHead>
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pivot.map((r) => (
                  <TableRow key={r.key} className="cursor-pointer" onClick={() => {
                    const groupStats = filtered.filter((s) => keyForGroup(s) === r.key);
                    setVizStats(groupStats);
                    if (groupBy === 'possession') {
                      const [side, num] = String(r.key || '').split('-');
                      const teamName = side === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home');
                      setVizTitle(`Possession ${num || ''} - ${teamName} - ${groupStats.length} events`);
                    } else {
                      setVizTitle(`${toTitleCase(groupBy)}: ${toTitleCase(r.key)} (${groupStats.length})`);
                    }
                    setVizOpen(true);
                  }}>
                    {groupBy === 'possession' ? (() => {
                      const [side, num] = String(r.key || '').split('-');
                      const teamName = side === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home');
                      const start = Number.isFinite(Number(r.start_time_norm_s)) ? formatMMSS(Number(r.start_time_norm_s)) : 'NA';
                      const end = Number.isFinite(Number(r.end_time_norm_s)) ? formatMMSS(Number(r.end_time_norm_s)) : 'NA';
                      const dur = (Number.isFinite(Number(r.start_time_norm_s)) && Number.isFinite(Number(r.end_time_norm_s))) ? `${Math.max(0, Number(r.end_time_norm_s) - Number(r.start_time_norm_s)).toFixed(1)}s` : 'NA';
                      const groupStats = filtered.filter((s) => keyForGroup(s) === r.key);
                      const firstStat = sortStatsForEditing(groupStats, match, imputedTimeById)[0] || null;
                      return (
                        <>
                          <TableCell className="font-mono text-xs">#{num || 'NA'}</TableCell>
                          <TableCell className="font-medium">{teamName}</TableCell>
                          <TableCell>{toTitleCase(r.start_half || '')}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{start}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{end}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{dur}</TableCell>
                          <TableCell>{r.start_source || 'NA'}</TableCell>
                          <TableCell>{r.end_outcome || 'NA'}</TableCell>
                          <TableCell>{r.attack ? 'Yes' : 'No'}</TableCell>
                          <TableCell>{r.attack_entry_channel || 'NA'}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.count}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.shotPoints}</TableCell>
                          {allowEditing ? (
                            <TableCell className="text-right">
                              <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={!firstStat} onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (firstStat) openEditDialogForStat(firstStat); }}>Edit</Button>
                            </TableCell>
                          ) : null}
                        </>
                      );
                    })() : (
                      <>
                        <TableCell className="font-medium">{toTitleCase(r.key)}</TableCell>
                        <TableCell>{r.count}</TableCell>
                        <TableCell>{r.shotPoints}</TableCell>
                      </>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="font-semibold text-slate-900">Rows</div>
              <div className="text-xs text-slate-500">{filteredSorted.length} rows</div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[36px]"> </TableHead>
                  <TableHead>Play</TableHead>
                  <TableHead>Poss</TableHead>
                  <TableHead>Half</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Player</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead className="w-[180px]"> </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map((s) => {
                  const extra = safeParseJSON(s.extra_data || '{}', {});
                  const t = Number(s?.time_s);
                  const hasTime = Number.isFinite(t);
                  const isOpen = expandedRowId === s.id;
                  return (
                    <React.Fragment key={s.id}>
                      <TableRow style={dataRowStyle(s, homeTeam, awayTeam)}>
                        <TableCell className="align-middle">
                          <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={isOpen ? 'Collapse row' : 'Expand row'} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setExpandedRowId((cur) => (cur === s.id ? null : s.id)); }}>
                            <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                          </Button>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{Number.isFinite(Number(s.play_id)) ? Number(s.play_id) : 'NA'}</TableCell>
                        <TableCell className="font-mono text-xs">{Number.isFinite(Number(s.possession_id)) ? Number(s.possession_id) : 'NA'}</TableCell>
                        <TableCell>{toTitleCase(s.half)}</TableCell>
                        <TableCell>{s.team_side === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home')}</TableCell>
                        <TableCell>{toTitleCase(s.stat_type)}</TableCell>
                        <TableCell>{toTitleCase(deriveOutcome(s, extra))}</TableCell>
                        <TableCell>{s.player_number ? `#${s.player_number}` : ''}</TableCell>
                        <TableCell className="font-mono text-xs">{(() => { const mt = getMatchTimeS(s, match, imputedTimeById); return Number.isFinite(mt) ? formatMatchClock(mt, match, s.half) : '--:--'; })()}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2 flex-wrap">
                            {!isLiveMode && (
                              <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={!hasTime} title={hasTime ? `Open video at ${formatMMSS(Math.max(0, t - VIDEO_PRE_ROLL_S))}` : 'No video time recorded for this row'} onClick={() => hasTime && openVideoAt(t)}>Open Video</Button>
                            )}
                            <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => { setVizStats([s]); setVizTitle(`${toTitleCase(s.stat_type)} - ${toTitleCase(s.half)} - ${s.team_side === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home')}`); setVizOpen(true); }}>Visualise</Button>
                          </div>
                        </TableCell>
                      </TableRow>

                      {isOpen && (
                        <TableRow style={possessionRowStyle(s, homeTeam, awayTeam)}>
                          <TableCell colSpan={10} className="p-3">
                            <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-xs font-semibold text-slate-900">Details</div>
                                <div className="flex items-center gap-2">
                                  {allowEditing ? <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => openEditDialogForStat(s)}>Edit</Button> : null}
                                </div>
                              </div>
                              <div className="max-h-56 overflow-auto rounded-md border border-slate-200">
                                <Table>
                                  <TableBody>
                                    {(() => {
                                      const baseItems = [
                                        { label: 'Play', value: Number.isFinite(Number(s.play_id)) ? String(Number(s.play_id)) : 'NA' },
                                        { label: 'Possession', value: Number.isFinite(Number(s.possession_id)) ? String(Number(s.possession_id)) : 'NA' },
                                        { label: 'Possession Team', value: s.possession_team_side === 'away' ? (awayTeam?.name || 'Away') : (s.possession_team_side === 'home' ? (homeTeam?.name || 'Home') : 'NA') },
                                        { label: 'Set Defence', value: getSetDefenceValue(s, false) ? 'Yes' : 'No' },
                                        { label: 'Video', value: Number.isFinite(Number(s.time_s)) ? formatMMSS(Number(s.time_s)) : 'NA' },
                                        { label: 'Time', value: (() => { const rowTime = getMatchTimeS(s, match, imputedTimeById); return Number.isFinite(rowTime) ? formatMatchClock(rowTime, match, s.half) : 'NA'; })() },
                                        { label: 'X, Y', value: Number.isFinite(Number(s.x_position)) && Number.isFinite(Number(s.y_position)) ? `${Number(s.x_position).toFixed(2)}, ${Number(s.y_position).toFixed(2)}` : 'NA' },
                                        { label: 'End X, Y', value: Number.isFinite(Number(s.end_x_position)) && Number.isFinite(Number(s.end_y_position)) ? `${Number(s.end_x_position).toFixed(2)}, ${Number(s.end_y_position).toFixed(2)}` : 'NA' },
                                        { label: 'Raw X, Y', value: Number.isFinite(Number(s.raw_x_position)) && Number.isFinite(Number(s.raw_y_position)) ? `${Number(s.raw_x_position).toFixed(2)}, ${Number(s.raw_y_position).toFixed(2)}` : 'NA' },
                                        { label: 'Raw End', value: Number.isFinite(Number(s.raw_end_x_position)) && Number.isFinite(Number(s.raw_end_y_position)) ? `${Number(s.raw_end_x_position).toFixed(2)}, ${Number(s.raw_end_y_position).toFixed(2)}` : 'NA' },
                                      ];
                                      const extraItems = flattenExtra(extra)
                                        .filter((r) => r.key !== 'counter_attack')
                                        .filter((r) => !/(^|\.)(pitch_w|pitch_h|pitch_width|pitch_height|pitch_length)$/i.test(String(r.key || '')))
                                        .filter((r) => !/(^|\\b)pitch([._-]?(w|h|width|height|length))\\b/i.test(String(r.key || '')))
                                        .map((r) => ({ label: presentablePathLabel(r.key), value: formatExtraValue(r.value, r.key) }));
                                      const items = [...baseItems, ...extraItems].filter((it, idx, arr) => it.label && arr.findIndex((other) => other.label === it.label) === idx);
                                      const pairs = [];
                                      for (let i = 0; i < items.length; i += 2) pairs.push([items[i], items[i + 1] || null]);
                                      return pairs.map(([a, b], idx) => (
                                        <TableRow key={idx}>
                                          <TableCell className="py-1 text-xs text-slate-500 whitespace-nowrap">{a.label}</TableCell>
                                          <TableCell className="py-1 text-xs font-mono tabular-nums">{a.value}</TableCell>
                                          <TableCell className="py-1 text-xs text-slate-500 whitespace-nowrap">{b ? b.label : ''}</TableCell>
                                          <TableCell className="py-1 text-xs font-mono tabular-nums">{b ? b.value : ''}</TableCell>
                                        </TableRow>
                                      ));
                                    })()}
                                  </TableBody>
                                </Table>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between gap-3 pt-2">
              <div className="text-xs text-slate-500">
                {rowLimit === 'all'
                  ? `Showing all ${filteredSorted.length} rows.`
                  : `Showing first ${Math.min(filteredSorted.length, visibleRowLimit)} of ${filteredSorted.length} rows.`}
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-slate-600">Rows</Label>
                <Select value={rowLimit} onValueChange={setRowLimit}>
                  <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="200">200</SelectItem>
                    <SelectItem value="500">500</SelectItem>
                    <SelectItem value="1000">1000</SelectItem>
                    <SelectItem value="all">All</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {!isVideoMode && (
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-semibold text-slate-900">Export Data</div>
              <div className="text-xs text-slate-500">
                CSV exports the current Data-tab filtered rows. JSON exports the full match bundle for backup or demo data.
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" className="gap-2" onClick={exportFilteredCsv} disabled={!filteredSorted.length}>
                <Download className="h-4 w-4" />
                Export CSV
              </Button>
              <Button type="button" variant="outline" className="gap-2" onClick={exportMatchJson} disabled={!orderedAllStats.length}>
                <FileJson className="h-4 w-4" />
                Export JSON
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this row?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove {deleteTarget ? summarizeRow(deleteTarget, match, imputedTimeById, homeTeam, awayTeam) : 'this stat row'} from the match.
              Possessions and reports will rebuild after deletion.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete Row'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default DataTab;



