import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import pitchImg from '@/assets/pitch.png';
import {
  CartesianGrid,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
} from 'recharts';
import {
  PITCH_W,
  PITCH_H,
  calcDistanceToGoal,
  classifyKickoutLength,
  extractFoulFromStat,
  findScorableFreeConcededRows,
  getNextBallActionStat,
  buildPlayerTimeAndPossessionStats,
  getProgressiveMeters,
  getScoringZoneEntry,
  inferRestartWinnerSide,
  isAttackPossession,
  shouldExcludeFromTotals,
  isProgressive as isProgressiveShared,
  shotOutcomeGroup,
  shotPointsForOutcome,
  normalizeFoulType,
  getPlayerRateMinutesBase,
} from '@/lib/reportAnalytics';
import { buildDefendingAllowedRows } from '@/lib/defendingAllowed';
import {
  safeParseJSON,
  formatExtraValue,
  formatPct,
  formatMMSS,
  sortRows,
  SortableTableHead,
  groupByPossession,
  derivePossessionOutcome,
  deriveOutcome,
  getCompletedReceiptSelection,
  getPrimaryActorSelection,
  getKeeperCandidate,
  isGoalkeeperPlayer,
  buildShotAssistCredits,
  buildDefensiveActions,
  buildTouchEvents,
  selectionKey,
  selectionTooltipLabel,
  normalizePlayerRef,
  teamRowTint,
  applyNonTeamReportFilters,
  inferRestartTeamSide,
  shotSideFromY,
  toTitleCase,
} from '../shared';
import { createTimestampClipRef, getVideoClipSettings } from '@/lib/videoWorkflow';

const PLAYER_CARD_MODES = [
  ['player-card', 'Player Card'],
  ['comparison', 'Comparison'],
];

const TABLE_OPTIONS = [
  { value: 'scoring', label: 'Shooting' },
  { value: 'passing', label: 'Passing' },
  { value: 'carrying', label: 'Carrying' },
  { value: 'progression', label: 'Progression' },
  { value: 'restarts', label: 'Restarts' },
  { value: 'defending', label: 'Defending' },
  { value: 'defending_allowed', label: 'Defending Allowed' },
  { value: 'goalkeepers', label: 'Goalkeepers' },
];

const POSITIVE_COLOR = '#16a34a';
const NEGATIVE_COLOR = '#dc2626';
const ACCENT_COLOR = '#0f766e';
const PITCH_LINE_COLOR = '#cbd5e1';
const KEEPER_KICKOUT_POSITIVE_COLOR = '#1d4ed8';
const KEEPER_KICKOUT_NEGATIVE_COLOR = '#dc2626';
const RADAR_AVERAGE_MINUTES_THRESHOLD = 20;

const COMPARISON_PRESET_OPTIONS = [
  { value: 'overall', label: 'Overall' },
  { value: 'passing', label: 'Passing' },
  { value: 'carrying', label: 'Carrying' },
  { value: 'shooting', label: 'Shooting' },
  { value: 'progression', label: 'Progression' },
  { value: 'restarts', label: 'Restarts' },
  { value: 'defending', label: 'Defending' },
  { value: 'defending_allowed', label: 'Defending Allowed' },
  { value: 'goalkeeping', label: 'Goalkeeping' },
];

const COMPARISON_AXIS_GROUPS = [
  { key: 'shooting', label: 'Shooting' },
  { key: 'passing', label: 'Passing' },
  { key: 'carrying', label: 'Carrying' },
  { key: 'progression', label: 'Progression' },
  { key: 'restarts', label: 'Restarts' },
  { key: 'defending', label: 'Defending' },
  { key: 'defending_allowed', label: 'Defending Allowed' },
  { key: 'goalkeeping', label: 'Goalkeeping' },
];

const COMPARISON_PRESET_METRIC_KEYS = {
  overall: ['points', 'pts_xp', 'prog_passes', 'prog_carries', 'def_actions', 'kickouts_won', 'to_won', 'to_lost'],
  passing: ['passes', 'prog_passes', 'shot_assists', 'final_third_prog_passes', 'passes_to_scoring_zone', 'avg_pass_length', 'prog_metres_passes', 'first_time_pass_pct', 'to_passes'],
  carrying: ['carries', 'prog_carries', 'takeons', 'high_pressure_carries', 'prog_carries_opp_third', 'fouls_won_carries', 'total_carry_metres', 'prog_carry_metres'],
  shooting: ['points', 'xp', 'scoring_pct', 'goal_pct', 'one_point_pct', 'two_point_pct', 'points_per_shot', 'xp_per_shot', 'shots_short', 'avg_distance'],
  progression: ['passes_received', 'prog_passes_received', 'touches', 'prog_passes_received_opp_third', 'total_prog_metres', 'scorable_frees_won'],
  restarts: ['targetted', 'targetted_kos_won', 'clean_won', 'clean_lost', 'break_won', 'break_lost', 'broken', 'marks'],
  defending: ['to_forced', 'to_recovered', 'def_actions', 'blocks', 'pressure_applied', 'fouls_conceded'],
  defending_allowed: ['da_touches', 'da_shots', 'da_points', 'da_xp', 'da_passes', 'da_prog_passes', 'da_carries', 'da_prog_carries', 'da_prog_passes_received', 'da_prog_metres', 'da_kickout_win_pct', 'da_to_lost', 'da_fouls_won'],
  goalkeeping: ['gk_points', 'gk_touches', 'gk_saves', 'gk_kickout_pct', 'gk_progression'],
};

const COMPARISON_METRIC_DEFINITIONS = [
  { key: 'points', label: 'Points', shortLabel: 'Points', category: 'shooting', decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, row?.points, mode) },
  { key: 'pts_xp', label: 'Pts-XP', shortLabel: 'Pts-XP', category: 'shooting', decimals: 2, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, row?.xpCount ? (row.points - row.xpTotal) : 0, mode) },
  { key: 'prog_passes', label: 'Prog Passes', shortLabel: 'Prog Passes', category: 'passing', decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, row?.progPassComp, mode) },
  { key: 'prog_carries', label: 'Prog Carries', shortLabel: 'Prog Carries', category: 'carrying', decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, row?.progCarryComp, mode) },
  { key: 'def_actions', label: 'Defensive Actions', shortLabel: 'Def Actions', category: 'defending', decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, row?.defActions, mode) },
  { key: 'kickouts_won', label: 'Kickouts Won', shortLabel: 'KO Won', category: 'restarts', decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, (Number(row?.cleanWon) || 0) + (Number(row?.breakWon) || 0), mode) },
  { key: 'to_won', label: 'TO Won', shortLabel: 'TO Won', category: 'defending', decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, row?.turnoversWon, mode) },
  { key: 'to_lost', label: 'TO Lost', shortLabel: 'TO Lost', category: 'passing', decimals: 1, inverse: true, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, row?.turnoversLost, mode) },
  { key: 'passes', label: 'Passes', shortLabel: 'Passes', category: 'passing', decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, row?.passComp, mode) },
  { key: 'shot_assists', label: 'Shot Assists', shortLabel: 'Shot Ast', category: 'passing', decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, row?.shotAssists, mode) },
  { key: 'final_third_prog_passes', label: 'Final 1/3 Prog Passes', shortLabel: 'F1/3 Prog', category: 'passing', decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, derived?.finalThirdProgressivePasses, mode) },
  { key: 'passes_to_scoring_zone', label: 'Passes To Scoring Zone', shortLabel: 'To Scoring Zone', category: 'passing', decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, row?.passesIntoScoringZone, mode) },
  { key: 'avg_pass_length', label: 'Avg Pass Length', shortLabel: 'Avg Pass Len', category: 'passing', decimals: 1, suffix: 'm', getValue: (row, derived) => derived?.passLengthCount ? (derived.passLengthTotal / derived.passLengthCount) : 0 },
  { key: 'prog_metres_passes', label: 'Prog Metres From Passes', shortLabel: 'Prog Pass M', category: 'passing', decimals: 1, suffix: 'm', getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, derived?.passProgressiveMeters, mode) },
  { key: 'first_time_pass_pct', label: 'First Time Pass %', shortLabel: '1st Time %', category: 'passing', decimals: 1, suffix: '%', getValue: (row) => Number(row?.noCarryPassRate) || 0 },
  { key: 'to_passes', label: 'TO Passes', shortLabel: 'TO Passes', category: 'passing', decimals: 1, inverse: true, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, derived?.passTurnovers, mode) },
  { key: 'carries', label: 'Carries', shortLabel: 'Carries', category: 'carrying', decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, row?.carryComp, mode) },
  { key: 'takeons', label: 'Takeons', shortLabel: 'Takeons', category: 'carrying', decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, derived?.takeOnCompleted, mode) },
  { key: 'high_pressure_carries', label: 'High Pressure Carries', shortLabel: 'High Pressure', category: 'carrying', decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, derived?.highPressureCarries, mode) },
  { key: 'prog_carries_opp_third', label: 'Prog Carries In Opp 1/3', shortLabel: 'Prog Carries O1/3', category: 'carrying', decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, derived?.progressiveCarriesInOppThird, mode) },
  { key: 'fouls_won_carries', label: 'Fouls Won On Carries', shortLabel: 'Fouls Won', category: 'carrying', decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, derived?.foulsWonOnCarries, mode) },
  { key: 'total_carry_metres', label: 'Total Carry Metres', shortLabel: 'Carry Metres', category: 'carrying', decimals: 1, suffix: 'm', getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, derived?.carryDistance, mode) },
  { key: 'prog_carry_metres', label: 'Prog Carry Metres', shortLabel: 'Prog Carry M', category: 'carrying', decimals: 1, suffix: 'm', getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, derived?.carryProgressiveMeters, mode) },
  { key: 'xp', label: 'xP', shortLabel: 'xP', category: 'shooting', decimals: 2, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, row?.xpCount ? row.xpTotal : 0, mode) },
  { key: 'scoring_pct', label: 'Scoring %', shortLabel: 'Scoring %', category: 'shooting', decimals: 1, suffix: '%', getValue: (row) => comparisonRatioPct(row?.scores, row?.shots) },
  { key: 'goal_pct', label: 'Goals %', shortLabel: 'Goal %', category: 'shooting', decimals: 1, suffix: '%', getValue: (row) => comparisonRatioPct(row?.goalMade, row?.goalAtt) },
  { key: 'one_point_pct', label: '1 Point %', shortLabel: '1P %', category: 'shooting', decimals: 1, suffix: '%', getValue: (row) => comparisonRatioPct(row?.pointMade, row?.pointAtt) },
  { key: 'two_point_pct', label: '2 Point %', shortLabel: '2P %', category: 'shooting', decimals: 1, suffix: '%', getValue: (row) => comparisonRatioPct(row?.twoMade, row?.twoAtt) },
  { key: 'points_per_shot', label: 'Points/Shot', shortLabel: 'Pts/Shot', category: 'shooting', decimals: 2, getValue: (row) => row?.shots ? (row.points / row.shots) : 0 },
  { key: 'xp_per_shot', label: 'xP/Shot', shortLabel: 'xP/Shot', category: 'shooting', decimals: 2, getValue: (row) => row?.xpCount ? (row.xpTotal / row.xpCount) : 0 },
  { key: 'shots_short', label: 'Shots Short', shortLabel: 'Short', category: 'shooting', decimals: 1, inverse: true, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, row?.shortShots, mode) },
  { key: 'avg_distance', label: 'Avg Distance', shortLabel: 'Avg Dist', category: 'shooting', decimals: 1, suffix: 'm', getValue: (row) => Number(row?.avgShotDist) || 0 },
  { key: 'passes_received', label: 'Passes Received', shortLabel: 'Pass Rec', category: 'progression', decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, derived?.passesReceived, mode) },
  { key: 'prog_passes_received', label: 'Prog Passes Received', shortLabel: 'Prog Rec', category: 'progression', decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, row?.progPassRecv, mode) },
  { key: 'touches', label: 'Touches', shortLabel: 'Touches', category: 'progression', decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, row?.touches, mode) },
  { key: 'prog_passes_received_opp_third', label: 'Prog Passes Received In Opp 1/3', shortLabel: 'Prog Rec O1/3', category: 'progression', decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, derived?.progressiveReceptionsOppThird, mode) },
  { key: 'total_prog_metres', label: 'Total Prog Metres', shortLabel: 'Prog Metres', category: 'progression', decimals: 1, suffix: 'm', getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, (Number(derived?.passProgressiveMeters) || 0) + (Number(derived?.carryProgressiveMeters) || 0), mode) },
  { key: 'scorable_frees_won', label: 'Scorable Frees Won', shortLabel: 'Scorable Frees', category: 'progression', decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, derived?.scorableFreesWon, mode) },
  { key: 'targetted', label: 'Targetted', shortLabel: 'Targetted', category: 'restarts', decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, row?.kickoutTargets, mode) },
  { key: 'targetted_kos_won', label: 'Targetted KOs Won By Team', shortLabel: 'KO Won By Team', category: 'restarts', decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, row?.kickoutWins, mode) },
  { key: 'clean_won', label: 'Clean Won', shortLabel: 'Clean Won', category: 'restarts', decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, row?.cleanWon, mode) },
  { key: 'clean_lost', label: 'Clean Lost', shortLabel: 'Clean Lost', category: 'restarts', decimals: 1, inverse: true, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, row?.cleanLost, mode) },
  { key: 'break_won', label: 'Break Won', shortLabel: 'Break Won', category: 'restarts', decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, row?.breakWon, mode) },
  { key: 'break_lost', label: 'Break Lost', shortLabel: 'Break Lost', category: 'restarts', decimals: 1, inverse: true, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, row?.breakLost, mode) },
  { key: 'broken', label: 'Broken', shortLabel: 'Broken', category: 'restarts', decimals: 1, inverse: true, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, row?.broken, mode) },
  { key: 'marks', label: 'Marks', shortLabel: 'Marks', category: 'restarts', decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, row?.marks, mode) },
  { key: 'to_forced', label: 'TO Forced', shortLabel: 'TO Forced', category: 'defending', decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, row?.turnoversForced, mode) },
  { key: 'to_recovered', label: 'TO Recovered', shortLabel: 'TO Recovered', category: 'defending', decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, row?.turnoversRecovered, mode) },
  { key: 'blocks', label: 'Blocks', shortLabel: 'Blocks', category: 'defending', decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, row?.blocks, mode) },
  { key: 'pressure_applied', label: 'Pressure Applied', shortLabel: 'Pressure', category: 'defending', decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, derived?.highPressureActions, mode) },
  { key: 'fouls_conceded', label: 'Fouls', shortLabel: 'Fouls', category: 'defending', decimals: 1, inverse: true, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, row?.foulsConceded, mode) },
  { key: 'da_touches', label: 'Touches Allowed', shortLabel: 'Touches', category: 'defending_allowed', decimals: 1, inverse: true, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonMatchupCountValue(row, row?.daTouches, mode) },
  { key: 'da_shots', label: 'Shots Allowed', shortLabel: 'Shots', category: 'defending_allowed', decimals: 1, inverse: true, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonMatchupCountValue(row, row?.daShots, mode) },
  { key: 'da_points', label: 'Points Allowed', shortLabel: 'Points', category: 'defending_allowed', decimals: 1, inverse: true, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonMatchupCountValue(row, row?.daPoints, mode) },
  { key: 'da_xp', label: 'xP Allowed', shortLabel: 'xP', category: 'defending_allowed', decimals: 2, inverse: true, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonMatchupCountValue(row, row?.daXp, mode) },
  { key: 'da_passes', label: 'Passes Allowed', shortLabel: 'Passes', category: 'defending_allowed', decimals: 1, inverse: true, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonMatchupCountValue(row, row?.daPasses, mode) },
  { key: 'da_prog_passes', label: 'Prog Passes Allowed', shortLabel: 'Prog Passes', category: 'defending_allowed', decimals: 1, inverse: true, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonMatchupCountValue(row, row?.daProgPasses, mode) },
  { key: 'da_carries', label: 'Carries Allowed', shortLabel: 'Carries', category: 'defending_allowed', decimals: 1, inverse: true, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonMatchupCountValue(row, row?.daCarries, mode) },
  { key: 'da_prog_carries', label: 'Prog Carries Allowed', shortLabel: 'Prog Carries', category: 'defending_allowed', decimals: 1, inverse: true, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonMatchupCountValue(row, row?.daProgCarries, mode) },
  { key: 'da_prog_passes_received', label: 'Prog Passes Received Allowed', shortLabel: 'Prog Pass Rec', category: 'defending_allowed', decimals: 1, inverse: true, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonMatchupCountValue(row, row?.daProgPassesReceived, mode) },
  { key: 'da_prog_metres', label: 'Prog Metres Allowed', shortLabel: 'Prog Metres', category: 'defending_allowed', decimals: 1, inverse: true, suffix: 'm', getValue: (row, derived, { mode = 'rate' } = {}) => comparisonMatchupCountValue(row, row?.daProgMetres, mode) },
  { key: 'da_kickout_win_pct', label: 'Kickout Win % Allowed', shortLabel: 'KO Win %', category: 'defending_allowed', decimals: 1, inverse: true, suffix: '%', getValue: (row) => Number(row?.daKickoutWinPct) || 0 },
  { key: 'da_to_lost', label: 'TO Lost Forced', shortLabel: 'TO Lost', category: 'defending_allowed', decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonMatchupCountValue(row, row?.daTurnoversLost, mode) },
  { key: 'da_fouls_won', label: 'Fouls Won Allowed', shortLabel: 'Fouls Won', category: 'defending_allowed', decimals: 1, inverse: true, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonMatchupCountValue(row, row?.daFoulsWon, mode) },
  { key: 'gk_points', label: 'Points', shortLabel: 'Points', category: 'goalkeeping', goalkeepingOnly: true, decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, row?.points, mode) },
  { key: 'gk_touches', label: 'Touches', shortLabel: 'Touches', category: 'goalkeeping', goalkeepingOnly: true, decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, row?.touches, mode) },
  { key: 'gk_saves', label: 'Saves', shortLabel: 'Saves', category: 'goalkeeping', goalkeepingOnly: true, decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, row?.goalShotsSaved, mode) },
  { key: 'gk_kickout_pct', label: 'Kickout %', shortLabel: 'Kickout %', category: 'goalkeeping', goalkeepingOnly: true, decimals: 1, suffix: '%', getValue: (row) => Number(row?.ownKickoutWinPct) || 0 },
  { key: 'gk_progression', label: 'Progression', shortLabel: 'Progression', category: 'goalkeeping', goalkeepingOnly: true, decimals: 1, getValue: (row, derived, { mode = 'rate' } = {}) => comparisonCountValue(row, (Number(row?.progPassComp) || 0) + (Number(row?.progCarryComp) || 0), mode) },
];

function normalizePlayerShotType(value) {
  const v = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (v === '1_point' || v === 'one_point') return 'point';
  if (v === '2_point' || v === 'two_point') return '2_point';
  if (v === 'goal') return 'goal';
  return v;
}

function normalizeShotMethod(value) {
  const v = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (!v) return '';
  if (v.includes('left')) return 'left';
  if (v.includes('right')) return 'right';
  if (v.includes('hand') || v.includes('fist')) return 'hand';
  return v;
}

function teamLabelForSide(teamSide, homeTeam, awayTeam) {
  return teamSide === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home');
}

function shortTeamLabel(label) {
  const cleaned = String(label || '').trim();
  if (!cleaned) return 'UNK';
  const compact = cleaned.replace(/[^A-Za-z0-9]/g, '');
  return (compact || cleaned).slice(0, 3).toUpperCase();
}

function getRateModeLabel(match) {
  return getPlayerRateMinutesBase(match) === 70 ? 'Per 70' : 'Per 60';
}

function formatModeMinuteBase(match) {
  return getPlayerRateMinutesBase(match) === 70 ? 70 : 60;
}

function safeFinite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function formatSigned(value, decimals = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'NA';
  return `${num > 0 ? '+' : ''}${num.toFixed(decimals)}`;
}

function formatCompactNumber(value, decimals = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'NA';
  if (decimals <= 0) return String(Math.round(num));
  return num.toFixed(decimals);
}

function formatMetricValue(value, { decimals = 0, suffix = '', signed = false } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'NA';
  const text = decimals > 0 ? num.toFixed(decimals) : String(Math.round(num));
  return `${signed && num > 0 ? '+' : ''}${text}${suffix}`;
}

function formatScoringFraction(made, attempts) {
  const madeN = Number(made) || 0;
  const attemptsN = Number(attempts) || 0;
  if (!Number.isFinite(attemptsN) || attemptsN <= 0) return `${madeN}/0`;
  return `${madeN}/${attemptsN}`;
}

function buildPlayerDisplayTitle(row) {
  if (!row) return '';
  const existing = String(row.player || '').replace(/\s*\((Away|Home)\)\s*/gi, ' ').trim();
  if (!existing) return row.number != null ? `Unknown #${row.number}` : 'Unknown Player';
  if (row.number != null) {
    const cleaned = existing.replace(new RegExp(`^#${row.number}\\s+`), '').trim();
    return `${cleaned} #${row.number}`;
  }
  return existing;
}

function hexToRgbaLocal(color, alpha = 0.08) {
  const fallback = `rgba(148, 163, 184, ${alpha})`;
  const hex = String(color || '').trim().replace('#', '');
  if (!hex) return fallback;
  const normalized = hex.length === 3
    ? hex.split('').map((char) => `${char}${char}`).join('')
    : hex;
  if (normalized.length !== 6) return fallback;
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value)) return fallback;
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function orientPointForSelectedTeam(x, y, selectedTeamSide) {
  const xx = Number(x);
  const yy = Number(y);
  if (!Number.isFinite(xx) || !Number.isFinite(yy)) return null;
  return { x: xx, y: yy };
}

function getDirectionByPeriodForMatch(matchValue) {
  const fallback = { first: 'right', second: 'left', et_first: 'right', et_second: 'left' };
  const raw = matchValue?.direction_by_period;
  if (!raw) return fallback;
  if (typeof raw === 'object') return { ...fallback, ...raw };
  try {
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

function verticalPointForSelectedTeam(x, y, selectedTeamSide) {
  const point = orientPointForSelectedTeam(x, y, selectedTeamSide);
  if (!point) return null;
  return { x: point.y, y: PITCH_W - point.x };
}

function transformKickoutDisplayPoint(x, y, kickoutTeamSide) {
  const xx = Number(x);
  const yy = Number(y);
  if (!Number.isFinite(xx) || !Number.isFinite(yy)) return null;
  if (kickoutTeamSide === 'away') {
    return { x: PITCH_W - xx, y: PITCH_H - yy };
  }
  return { x: xx, y: yy };
}

function buildStarPoints(cx, cy, outerRadius = 2.25, innerRadius = 0.95, spikes = 5) {
  const points = [];
  const step = Math.PI / spikes;
  let rotation = -Math.PI / 2;
  for (let i = 0; i < spikes * 2; i += 1) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const x = cx + (Math.cos(rotation) * radius);
    const y = cy + (Math.sin(rotation) * radius);
    points.push(`${x},${y}`);
    rotation += step;
  }
  return points.join(' ');
}

function PlayerMapOverlay({ title, arrowText = 'Attacking ->', arrowSide = 'left', onOpenVideo = null }) {
  return (
    <>
      <div className="pointer-events-none absolute left-3 top-2 z-20 rounded-full bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-700 shadow-sm">
        {title}
      </div>
      {typeof onOpenVideo === 'function' ? (
        <div className="absolute right-3 top-2 z-20">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 rounded-full bg-white/95 px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-700 shadow-sm"
            onClick={(event) => {
              event.stopPropagation();
              onOpenVideo();
            }}
          >
            Video
          </Button>
        </div>
      ) : null}
      <div className={`pointer-events-none absolute bottom-2 z-20 ${arrowSide === 'right' ? 'right-3' : 'left-3'} rounded-full bg-white px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-slate-700 shadow-sm`}>
        {arrowText}
      </div>
    </>
  );
}

function formatComparisonMetricRawValue(metric, value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  const decimals = metric?.decimals ?? 1;
  const formatted = decimals > 0 ? num.toFixed(decimals) : String(Math.round(num));
  return `${formatted}${metric?.suffix || ''}`;
}

function formatComparisonAxisTick(metric, value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  const decimals = metric?.decimals ?? 1;
  const rounded = decimals > 0 ? num.toFixed(Math.min(decimals, 1)) : String(Math.round(num));
  return `${rounded}${metric?.suffix || ''}`;
}

function normalizeComparisonMetricScore(metric, value, average, spread) {
  const num = Number(value);
  if (!Number.isFinite(num)) return NaN;
  if (!Number.isFinite(average)) return NaN;
  if (!Number.isFinite(spread) || spread <= 0) return 50;
  const delta = metric?.inverse ? (average - num) : (num - average);
  return Math.max(0, Math.min(100, 50 + ((delta / spread) * 40)));
}

function comparisonCountValue(row, value, mode = 'rate') {
  const numeric = Number(value) || 0;
  return mode === 'rate' ? scalePlayerCount(row, numeric, 'rate') : numeric;
}

function comparisonMatchupCountValue(row, value, mode = 'rate') {
  const numeric = Number(value) || 0;
  if (mode !== 'rate') return numeric;
  const minutes = Number(row?.matchupMinutes) || 0;
  const base = Number(row?.rateMinutesBase) || 70;
  return minutes > 0 ? (numeric / minutes) * base : 0;
}

function comparisonRatioPct(made, attempts) {
  const madeN = Number(made) || 0;
  const attemptsN = Number(attempts) || 0;
  if (!Number.isFinite(attemptsN) || attemptsN <= 0) return 0;
  return (madeN / attemptsN) * 100;
}

function formatMatchupMetricValue(row, value, statMode = 'raw', options = {}) {
  const numeric = statMode === 'rate'
    ? comparisonMatchupCountValue(row, value, 'rate')
    : (Number(value) || 0);
  return formatMetricValue(numeric, options);
}

function comparisonPlayerShortLabel(entry) {
  if (entry?.row) return buildPlayerDisplayTitle(entry.row);
  if (entry?.option) {
    const teamless = String(entry.option.displayLabel || entry.option.label || '').split('|')[0].trim();
    return teamless || 'Selected Player';
  }
  return 'Selected Player';
}

function ComparisonInlineSelect({
  value,
  onChange,
  groups = [],
  className = '',
  ariaLabel = 'Select option',
}) {
  const triggerLabel = (() => {
    const selectedValue = String(value ?? '');
    for (const group of groups) {
      const match = (group.options || []).find((option) => String(option.value) === selectedValue);
      if (match) return match.label;
    }
    return ariaLabel;
  })();

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label={ariaLabel}
          className={`h-10 w-full justify-between rounded-full border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 shadow-sm ${className}`.trim()}
        >
          <span className="truncate">{triggerLabel}</span>
          <span className="ml-3 text-slate-500">▾</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[220px] p-1">
        <DropdownMenuRadioGroup value={String(value ?? '')} onValueChange={onChange}>
          {groups.map((group) => (
            <React.Fragment key={group.key || group.label || 'group'}>
              {group.label ? <DropdownMenuLabel>{group.label}</DropdownMenuLabel> : null}
              {(group.options || []).map((option) => (
                <DropdownMenuRadioItem key={option.value} value={String(option.value)}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </React.Fragment>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  /*
  return (
    <div className={`relative ${className}`.trim()}>
      <select
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
        aria-label={ariaLabel}
        className="h-10 w-full appearance-none rounded-full border border-slate-300 bg-white px-4 pr-10 text-sm font-medium text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
      >
        {groups.map((group) => (
          group.label ? (
            <optgroup key={group.key || group.label} label={group.label}>
              {group.options.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </optgroup>
          ) : (
            group.options.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))
          )
        ))}
      </select>
      <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-slate-500">▾</span>
    </div>
  );
  */
}

function ComparisonRadarTooltip({ active, payload, playerALabel, playerBLabel }) {
  if (!active || !payload?.length) return null;
  const datum = payload[0]?.payload;
  if (!datum) return null;

  return (
    <div className="min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-xl">
      <div className="font-semibold text-slate-900">{datum.label}</div>
      <div className="mt-2 space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-500">Average</span>
          <span className="font-medium tabular-nums text-slate-900">{formatComparisonMetricRawValue(datum.metricDef, datum.averageRaw)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-500">{playerALabel}</span>
          <span className="font-medium tabular-nums text-slate-900">{formatComparisonMetricRawValue(datum.metricDef, datum.primaryRaw)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-500">{playerBLabel}</span>
          <span className="font-medium tabular-nums text-slate-900">{formatComparisonMetricRawValue(datum.metricDef, datum.secondaryRaw)}</span>
        </div>
      </div>
    </div>
  );
}

function ComparisonScatterTooltip({ active, payload, metricX, metricY }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="min-w-[190px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-xl">
      <div className="font-semibold text-slate-900">{point.player}</div>
      <div className="text-[11px] text-slate-500">{point.teamLabel}</div>
      <div className="mt-2 space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-500">{metricX?.label || 'X Axis'}</span>
          <span className="font-medium tabular-nums text-slate-900">{formatComparisonMetricRawValue(metricX, point.xRaw)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-500">{metricY?.label || 'Y Axis'}</span>
          <span className="font-medium tabular-nums text-slate-900">{formatComparisonMetricRawValue(metricY, point.yRaw)}</span>
        </div>
      </div>
    </div>
  );
}

function horizontalPointForSelectedTeam(point, selectedTeamSide, matchValue) {
  const directionByPeriod = getDirectionByPeriodForMatch(matchValue);
  const half = String(point?.stat?.half || 'first');
  const directionUsed = directionByPeriod?.[half] || 'right';
  const rawX = Number(point?.rawX);
  const rawY = Number(point?.rawY);
  const fallbackX = Number(point?.x);
  const fallbackY = Number(point?.y);

  let normalized = null;
  if (Number.isFinite(rawX) && Number.isFinite(rawY)) {
    normalized = directionUsed !== 'left'
      ? { x: rawX, y: rawY }
      : { x: PITCH_W - rawX, y: PITCH_H - rawY };
  } else if (Number.isFinite(fallbackX) && Number.isFinite(fallbackY)) {
    normalized = { x: fallbackX, y: fallbackY };
  }

  if (!normalized) return null;
  if (selectedTeamSide === 'away') {
    return {
      x: PITCH_W - normalized.x,
      y: PITCH_H - normalized.y,
    };
  }
  return normalized;
}

function classifyOrientedZone(x) {
  if (!Number.isFinite(Number(x))) return 'Unknown';
  if (x < 45) return 'Defensive Third';
  if (x < (PITCH_W - 45)) return 'Middle Third';
  return 'Attacking Third';
}

function scalePlayerCount(row, value, statMode) {
  if (statMode !== 'rate') return value;
  const num = Number(value);
  if (!Number.isFinite(num)) return NaN;
  const factor = Number(row?.minutesRateFactor);
  return Number.isFinite(factor) ? (num * factor) : num;
}

function computeMetricValue(row, derived, metric, statMode) {
  if (!row) return NaN;
  if (typeof metric.compute === 'function') return metric.compute(row, derived, statMode);
  const baseValue = row?.[metric.key];
  if (metric.type === 'count') return scalePlayerCount(row, baseValue, statMode);
  return baseValue;
}

function formatPlayerMetric(metric, row, derived, statMode) {
  const value = computeMetricValue(row, derived, metric, statMode);
  if (metric.type === 'pct') return formatPct(value);
  if (metric.type === 'signed') return formatSigned(value, metric.decimals ?? 1);
  return formatMetricValue(value, { decimals: metric.decimals ?? 0, suffix: metric.suffix || '' });
}

function rankWithinTeam(row, teamRows, accessor) {
  const values = teamRows
    .map((candidate) => Number(accessor(candidate)))
    .filter(Number.isFinite)
    .sort((a, b) => b - a);
  if (!values.length) return 0;
  const own = Number(accessor(row));
  if (!Number.isFinite(own)) return 0;
  const max = values[0] || 0;
  return max > 0 ? own / max : 0;
}

function MetricCategoryCard({ title, subtitle = '', metrics, tone = 'slate' }) {
  const toneClasses = {
    slate: 'border-slate-200 bg-white',
    teal: 'border-slate-200 bg-white',
    blue: 'border-slate-200 bg-white',
    amber: 'border-slate-200 bg-white',
    rose: 'border-slate-200 bg-white',
    emerald: 'border-slate-200 bg-white',
    violet: 'border-slate-200 bg-white',
  };

  return (
    <Card className={toneClasses[tone] || toneClasses.slate}>
      <CardContent className="p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-base font-semibold text-slate-900">{title}</div>
            {subtitle ? <div className="text-xs text-slate-500">{subtitle}</div> : null}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <div key={metric.label} className="rounded-lg border border-white/70 bg-white/80 p-3 shadow-sm">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">{metric.label}</div>
              <div className={`mt-1 text-xl font-semibold ${metric.emphasisClass || 'text-slate-900'}`}>{metric.value}</div>
              {metric.meta ? <div className="mt-1 text-xs text-slate-500">{metric.meta}</div> : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function classifyPlayerShotContext(extra) {
  const situation = String(extra?.shot?.situation || '').trim().toLowerCase();
  if (!situation || situation === 'play') return 'play';
  return 'deadball';
}

function PlayerShootingPanel({
  row,
  shots = [],
  statMode = 'raw',
  teamSide = 'home',
  match = null,
  filter = 'all',
  onFilterChange = null,
  onOpenVideoSelection = null,
  cardStyle = undefined,
}) {
  const summary = useMemo(() => {
    const sourceShots = Array.isArray(shots) ? shots : [];
    const filteredShots = sourceShots.filter((stat) => {
      const extra = safeParseJSON(stat?.extra_data || '{}', {});
      const contextType = classifyPlayerShotContext(extra);
      return filter === 'all' ? true : contextType === filter;
    });

    let points = 0;
    let scores = 0;
    let xpTotal = 0;
    let xpCount = 0;
    let pointAtt = 0;
    let pointMade = 0;
    let twoAtt = 0;
    let twoMade = 0;
    let goalAtt = 0;
    let goalMade = 0;
    let shortShots = 0;
    let avgShotDistTotal = 0;
    let avgShotDistCount = 0;
    let leftShots = 0;
    let handShots = 0;
    let rightShots = 0;

    const mapShots = filteredShots
      .map((stat) => {
        const extra = safeParseJSON(stat?.extra_data || '{}', {});
        const point = horizontalPointForSelectedTeam({
          stat,
          rawX: stat?.raw_x_position,
          rawY: stat?.raw_y_position,
          x: stat?.x_position,
          y: stat?.y_position,
        }, teamSide, match);
        if (!point) return null;

        const outcome = String(extra?.shot?.outcome || '');
        const outcomeGroup = shotOutcomeGroup(outcome);
        const shotType = normalizePlayerShotType(extra?.shot?.shot_type || extra?.shot?.type || '');
        const shotMethod = normalizeShotMethod(extra?.shot?.method);
        const xpRaw = extra?.shot?.xp?.value ?? extra?.shot?.expected_points ?? extra?.shot?.expectedPoints ?? extra?.shot?.xp ?? extra?.shot?.xP ?? null;
        const xp = Number(xpRaw);
        const dist = calcDistanceToGoal(Number(stat?.x_position), Number(stat?.y_position));

        if (shotMethod === 'left') leftShots += 1;
        else if (shotMethod === 'hand') handShots += 1;
        else if (shotMethod === 'right') rightShots += 1;

        points += shotPointsForOutcome(outcome);
        if (outcomeGroup === 'score') scores += 1;
        if (Number.isFinite(xp)) {
          xpTotal += xp;
          xpCount += 1;
        }
        if (shotType === 'point') pointAtt += 1;
        if (shotType === '2_point') twoAtt += 1;
        if (shotType === 'goal') goalAtt += 1;
        if (outcome === 'point') pointMade += 1;
        if (outcome === '2_point') twoMade += 1;
        if (outcome === 'goal') goalMade += 1;
        if (outcome === 'short') shortShots += 1;
        if (Number.isFinite(dist)) {
          avgShotDistTotal += dist;
          avgShotDistCount += 1;
        }

        return {
          id: `player-shot-pane-${stat.id}`,
          x: Math.max(0, Math.min(PITCH_W / 2, point.x - (PITCH_W / 2))),
          y: point.y,
          raw: stat,
          outcome,
          shotType,
          xp,
          distance: dist,
          situation: String(extra?.shot?.situation || ''),
          playerLabel: buildPlayerDisplayTitle(row),
          timeLabel: Number.isFinite(Number(stat?.normalized_time_s))
            ? formatMMSS(Number(stat.normalized_time_s))
            : Number.isFinite(Number(stat?.time_s))
              ? formatMMSS(Number(stat.time_s))
              : 'NA',
          possessionLabel: Number.isFinite(Number(stat?.possession_id)) ? `${Number(stat.possession_id)}` : '',
        };
      })
      .filter(Boolean);

    const shotCount = filteredShots.length;
    const shotMethodTotal = leftShots + handShots + rightShots;
    const avgShotDist = avgShotDistCount > 0 ? (avgShotDistTotal / avgShotDistCount) : NaN;

    return {
      shotCount,
      points,
      scores,
      xpTotal,
      xpCount,
      pointAtt,
      pointMade,
      twoAtt,
      twoMade,
      goalAtt,
      goalMade,
      shortShots,
      avgShotDist,
      leftShots,
      handShots,
      rightShots,
      leftShare: shotMethodTotal > 0 ? (leftShots / shotMethodTotal) : 0,
      handShare: shotMethodTotal > 0 ? (handShots / shotMethodTotal) : 0,
      rightShare: shotMethodTotal > 0 ? (rightShots / shotMethodTotal) : 0,
      mapShots,
    };
  }, [filter, match, shots, teamSide]);

  const metrics = [
    {
      label: 'Points',
      value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, summary.points, 'rate') : summary.points, { decimals: 0 }),
    },
    {
      label: 'xP',
      value: summary.xpCount ? formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, summary.xpTotal, 'rate') : summary.xpTotal, { decimals: 2 }) : 'NA',
    },
    {
      label: 'Scoring',
      value: formatScoringFraction(summary.scores, summary.shotCount),
    },
    {
      label: 'Goals',
      value: formatScoringFraction(summary.goalMade, summary.goalAtt),
    },
    {
      label: '1 Point',
      value: formatScoringFraction(summary.pointMade, summary.pointAtt),
    },
    {
      label: '2 Point',
      value: formatScoringFraction(summary.twoMade, summary.twoAtt),
    },
    {
      label: 'Points / Shot',
      value: summary.shotCount ? formatMetricValue(summary.points / summary.shotCount, { decimals: 2 }) : 'NA',
    },
    {
      label: 'xP / Shot',
      value: summary.shotCount && summary.xpCount ? formatMetricValue(summary.xpTotal / summary.shotCount, { decimals: 2 }) : 'NA',
    },
    {
      label: 'Shots Short',
      value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, summary.shortShots, 'rate') : summary.shortShots, { decimals: 0 }),
    },
    {
      label: 'Avg Distance',
      value: Number.isFinite(summary.avgShotDist) ? formatMetricValue(summary.avgShotDist, { decimals: 1, suffix: 'm' }) : 'NA',
    },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
      <Card style={cardStyle}>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="text-lg font-semibold text-slate-900">Shooting</div>
            <div className="flex min-w-0 items-center sm:w-[128px]">
              <select
                value={filter}
                onChange={(event) => onFilterChange?.(event.target.value)}
                className="flex h-8 min-w-0 w-full rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold shadow-sm outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring"
                aria-label="Filter player shooting pane"
              >
                <option value="all">All</option>
                <option value="play">Play</option>
                <option value="deadball">Deadball</option>
              </select>
            </div>
          </div>

          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {metrics.map((metric) => (
              <div key={metric.label} className="min-w-0 space-y-1">
                <div className="text-sm font-medium uppercase tracking-wide text-slate-500">{metric.label}</div>
                <div className="text-2xl font-semibold leading-none text-slate-900">{metric.value}</div>
              </div>
            ))}
          </div>

          <div className="space-y-2 pt-1">
            <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Shot Method Split</div>
            <div className="w-full max-w-[320px] space-y-2">
              <div className="relative h-3 overflow-hidden rounded-full bg-slate-200">
                <div className="absolute inset-y-0 left-0 bg-sky-400" style={{ width: `${summary.leftShare * 100}%` }} />
                <div className="absolute inset-y-0 bg-amber-400" style={{ left: `${summary.leftShare * 100}%`, width: `${summary.handShare * 100}%` }} />
                <div className="absolute inset-y-0 right-0 bg-violet-400" style={{ width: `${summary.rightShare * 100}%` }} />
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs font-medium text-slate-600">
                <div className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-sky-400" />
                  <span>{`Left ${Math.round(summary.leftShare * 100)}%`}</span>
                </div>
                <div className="flex items-center justify-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" />
                  <span>{`Hand ${Math.round(summary.handShare * 100)}%`}</span>
                </div>
                <div className="flex items-center justify-end gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-violet-400" />
                  <span>{`Right ${Math.round(summary.rightShare * 100)}%`}</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card style={cardStyle}>
        <CardContent className="p-4 space-y-4">
          <div className="relative overflow-hidden rounded-lg bg-slate-100" style={{ aspectRatio: `${PITCH_H} / ${PITCH_W / 2}` }}>
              <svg viewBox={`0 0 ${PITCH_H} ${PITCH_W / 2}`} className="relative z-10 h-full w-full">
                <g transform={`translate(0 ${PITCH_W / 2}) rotate(-90)`}>
                  <image
                    href={pitchImg}
                    x={-(PITCH_W / 2)}
                    y="0"
                    width={PITCH_W}
                    height={PITCH_H}
                    preserveAspectRatio="none"
                  />
                  {summary.mapShots.map((shot) => {
                    const tip = [
                      `Player: ${shot.playerLabel || 'NA'}`,
                      `Time: ${shot.timeLabel || 'NA'}`,
                      `Shot Type: ${toTitleCase(shot.shotType)}`,
                      `Situation: ${toTitleCase(shot.situation || 'play')}`,
                      `Outcome: ${toTitleCase(shot.outcome)}`,
                      `xP: ${Number.isFinite(shot.xp) ? shot.xp.toFixed(2) : 'N/A'}`,
                      Number.isFinite(shot.distance) ? `Distance: ${shot.distance.toFixed(1)}` : null,
                      shot.possessionLabel ? `Possession: ${shot.possessionLabel}` : null,
                    ].filter(Boolean).join('\n');
                    const shape = ['point', '2_point', 'goal'].includes(String(shot.outcome || ''))
                      ? String(shot.outcome)
                      : shot.shotType;
                    const size = 1.87;
                    const handleOpenVideo = (event) => {
                      event.stopPropagation();
                      onOpenVideoSelection?.(summary.mapShots, { sourceLabel: 'Player Shots', selectedId: shot.raw?.id });
                    };

                    if (shape === 'goal') {
                      return (
                        <g
                          key={shot.id}
                          className="cursor-pointer"
                          onClick={(event) => event.stopPropagation()}
                          onDoubleClick={handleOpenVideo}
                        >
                          <rect
                            x={shot.x - size}
                            y={shot.y - size}
                            width={size * 2}
                            height={size * 2}
                            fill="none"
                            stroke="#111827"
                            strokeWidth="0.425"
                          />
                          <rect
                            x={shot.x - size}
                            y={shot.y - size}
                            width={size * 2}
                            height={size * 2}
                            fill={shotOutcomeGroup(shot.outcome) === 'score' ? '#16a34a' : '#dc2626'}
                            opacity="0.9"
                          >
                            <title>{tip}</title>
                          </rect>
                          <rect
                            x={shot.x - size}
                            y={shot.y - size}
                            width={size * 2}
                            height={size * 2}
                            fill="none"
                            stroke="#ffffff"
                            strokeWidth="0.6"
                          />
                        </g>
                      );
                    }

                    if (shape === '2_point') {
                      return (
                        <g
                          key={shot.id}
                          className="cursor-pointer"
                          onClick={(event) => event.stopPropagation()}
                          onDoubleClick={handleOpenVideo}
                        >
                          <rect
                            x={shot.x - size}
                            y={shot.y - size}
                            width={size * 2}
                            height={size * 2}
                            fill="none"
                            transform={`rotate(45 ${shot.x} ${shot.y})`}
                            stroke="#111827"
                            strokeWidth="0.425"
                          />
                          <rect
                            x={shot.x - size}
                            y={shot.y - size}
                            width={size * 2}
                            height={size * 2}
                            fill={shotOutcomeGroup(shot.outcome) === 'score' ? '#16a34a' : '#dc2626'}
                            opacity="0.9"
                            transform={`rotate(45 ${shot.x} ${shot.y})`}
                          >
                            <title>{tip}</title>
                          </rect>
                          <rect
                            x={shot.x - size}
                            y={shot.y - size}
                            width={size * 2}
                            height={size * 2}
                            fill="none"
                            transform={`rotate(45 ${shot.x} ${shot.y})`}
                            stroke="#ffffff"
                            strokeWidth="0.6"
                          />
                        </g>
                      );
                    }

                    return (
                      <g
                        key={shot.id}
                        className="cursor-pointer"
                        onClick={(event) => event.stopPropagation()}
                        onDoubleClick={handleOpenVideo}
                      >
                        <circle
                          cx={shot.x}
                          cy={shot.y}
                          r={size}
                          fill="none"
                          stroke="#111827"
                          strokeWidth="0.425"
                        />
                        <circle
                          cx={shot.x}
                          cy={shot.y}
                          r={size}
                          fill={shotOutcomeGroup(shot.outcome) === 'score' ? '#16a34a' : '#dc2626'}
                          opacity="0.9"
                        >
                          <title>{tip}</title>
                        </circle>
                        <circle
                          cx={shot.x}
                          cy={shot.y}
                          r={size}
                          fill="none"
                          stroke="#ffffff"
                          strokeWidth="0.6"
                        />
                      </g>
                    );
                  })}
                </g>
              </svg>
            <PlayerMapOverlay
              title="Shots"
              arrowText="Attacking ↑"
              onOpenVideo={summary.mapShots.length ? () => onOpenVideoSelection?.(summary.mapShots, { sourceLabel: 'Player Shots' }) : null}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PlayerPassingPanel({
  row,
  passes = [],
  statMode = 'raw',
  teamSide = 'home',
  match = null,
  onOpenVideoSelection = null,
  cardStyle = undefined,
}) {
  const summary = useMemo(() => {
    const sourcePasses = Array.isArray(passes) ? passes : [];
    let completedPasses = 0;
    let progressiveAttempts = 0;
    let progressiveCompleted = 0;
    let finalThirdProgressive = 0;
    let passLengthTotal = 0;
    let passLengthCount = 0;
    let perfectPasses = 0;
    let inaccuratePasses = 0;
    let passTurnovers = 0;
    let passProgressiveMeters = 0;
    let leftPasses = 0;
    let handPasses = 0;
    let rightPasses = 0;

    const mapPasses = sourcePasses.map((stat) => {
      const extra = safeParseJSON(stat?.extra_data || '{}', {});
      const start = horizontalPointForSelectedTeam({
        stat,
        rawX: stat?.raw_x_position,
        rawY: stat?.raw_y_position,
        x: stat?.x_position,
        y: stat?.y_position,
      }, teamSide, match);
      const end = horizontalPointForSelectedTeam({
        stat,
        rawX: safeFinite(stat?.raw_end_x_position) ?? safeFinite(stat?.raw_x_position),
        rawY: safeFinite(stat?.raw_end_y_position) ?? safeFinite(stat?.raw_y_position),
        x: safeFinite(stat?.end_x_position) ?? safeFinite(stat?.x_position),
        y: safeFinite(stat?.end_y_position) ?? safeFinite(stat?.y_position),
      }, teamSide, match);

      const outcome = deriveOutcome(stat, extra);
      const isCompleted = outcome === 'completed';
      if (isCompleted) completedPasses += 1;
      if (outcome === 'turnover') passTurnovers += 1;

      const isProgressive = isProgressiveShared(stat);
      if (isProgressive) progressiveAttempts += 1;
      if (isProgressive && isCompleted) progressiveCompleted += 1;
      if (isProgressive && isCompleted && start && start.x >= ((2 * PITCH_W) / 3)) finalThirdProgressive += 1;

      const gainedMeters = isCompleted ? getProgressiveMeters(stat) : 0;
      if (Number.isFinite(gainedMeters)) passProgressiveMeters += gainedMeters;

      const accuracy = String(extra?.pass?.accuracy || '').trim();
      if (accuracy === '++') perfectPasses += 1;
      if (accuracy === '-' || accuracy === '--') inaccuratePasses += 1;

      const method = String(extra?.pass?.method || '').trim().toLowerCase();
      if (method === 'left') leftPasses += 1;
      else if (method === 'hand') handPasses += 1;
      else if (method === 'right') rightPasses += 1;

      if (start && end) {
        const dx = Number(end.x) - Number(start.x);
        const dy = Number(end.y) - Number(start.y);
        const length = Math.sqrt((dx * dx) + (dy * dy));
        if (Number.isFinite(length)) {
          passLengthTotal += length;
          passLengthCount += 1;
        }
      }

      const recipient = getCompletedReceiptSelection(stat, extra);
      const recipientLabel = recipient ? formatExtraValue(recipient).replace(/\s+\((Home|Away)\)\s*$/i, '') : 'NA';
      const playerLabel = buildPlayerDisplayTitle(row);
      const timeLabel = Number.isFinite(Number(stat?.normalized_time_s))
        ? formatMMSS(Number(stat.normalized_time_s))
        : Number.isFinite(Number(stat?.time_s))
          ? formatMMSS(Number(stat.time_s))
          : 'NA';
      const tip = [
        `Player: ${playerLabel || 'NA'}`,
        `Time: ${timeLabel}`,
        `Recipient: ${recipientLabel || 'NA'}`,
        `Method: ${toTitleCase(method || 'other')}`,
        `Outcome: ${toTitleCase(outcome || 'unknown')}`,
        `Accuracy: ${accuracy || 'NA'}`,
        Number.isFinite(gainedMeters) ? `Progressive Metres: ${gainedMeters.toFixed(1)}` : null,
        (start && end) ? `Length: ${Math.sqrt((((Number(end.x) - Number(start.x)) ** 2) + ((Number(end.y) - Number(start.y)) ** 2))).toFixed(1)}` : null,
        Number.isFinite(Number(stat?.possession_id)) ? `Possession: ${Number(stat.possession_id)}` : null,
      ].filter(Boolean).join('\n');

      return {
        id: `player-pass-pane-${stat.id}`,
        start,
        end,
        outcome,
        accuracy,
        color: isCompleted ? '#2563eb' : '#dc2626',
        tooltip: tip,
        raw: stat,
      };
    }).filter((entry) => entry.start && entry.end);

    const passCount = sourcePasses.length;
    const passMethodTotal = leftPasses + handPasses + rightPasses;
    const avgPassLength = passLengthCount > 0 ? (passLengthTotal / passLengthCount) : NaN;

    return {
      passCount,
      completedPasses,
      progressiveAttempts,
      progressiveCompleted,
      finalThirdProgressive,
      avgPassLength,
      perfectPasses,
      inaccuratePasses,
      passTurnovers,
      passProgressiveMeters,
      leftShare: passMethodTotal > 0 ? (leftPasses / passMethodTotal) : 0,
      handShare: passMethodTotal > 0 ? (handPasses / passMethodTotal) : 0,
      rightShare: passMethodTotal > 0 ? (rightPasses / passMethodTotal) : 0,
      mapPasses,
    };
  }, [match, passes, row, teamSide]);

  const metrics = [
    { label: 'Passes', value: formatScoringFraction(summary.completedPasses, summary.passCount) },
    { label: 'Prog Passes', value: formatScoringFraction(summary.progressiveCompleted, summary.progressiveAttempts) },
    { label: 'Shot Assists', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, row.shotAssists, 'rate') : row.shotAssists, { decimals: 0 }) },
    { label: 'Final 1/3 Prog Passes', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, summary.finalThirdProgressive, 'rate') : summary.finalThirdProgressive, { decimals: 0 }) },
    { label: 'Passes To Scoring Zone', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, row.passesIntoScoringZone, 'rate') : row.passesIntoScoringZone, { decimals: 0 }) },
    { label: 'Avg Pass Length', value: Number.isFinite(summary.avgPassLength) ? formatMetricValue(summary.avgPassLength, { decimals: 1, suffix: 'm' }) : 'NA' },
    { label: 'First Time Pass %', value: formatPct(row.noCarryPassRate) },
    { label: 'Inaccurate Passes', value: `${formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, summary.inaccuratePasses, 'rate') : summary.inaccuratePasses, { decimals: 0 })} (${formatPct(summary.passCount ? (summary.inaccuratePasses / summary.passCount) * 100 : NaN)})` },
    { label: 'Prog Metres From Passes', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, summary.passProgressiveMeters, 'rate') : summary.passProgressiveMeters, { decimals: 1, suffix: 'm' }) },
    { label: 'TO Passes', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, summary.passTurnovers, 'rate') : summary.passTurnovers, { decimals: 0 }) },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
      <Card style={cardStyle}>
        <CardContent className="p-4 space-y-4">
          <div className="text-lg font-semibold text-slate-900">Passing</div>

          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {metrics.map((metric) => (
              <div key={metric.label} className="min-w-0 space-y-1">
                <div className="text-sm font-medium uppercase tracking-wide text-slate-500">{metric.label}</div>
                <div className="text-2xl font-semibold leading-none text-slate-900">{metric.value}</div>
              </div>
            ))}
          </div>

        </CardContent>
      </Card>

      <Card style={cardStyle}>
        <CardContent className="p-4 space-y-4">
          <div className="relative w-full overflow-hidden rounded-lg" style={{ aspectRatio: `${PITCH_W} / ${PITCH_H}` }}>
              <svg viewBox={`0 0 ${PITCH_W} ${PITCH_H}`} className="relative z-10 h-full w-full">
                <defs>
                  <marker id="player-pass-pane-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" stroke="context-stroke" />
                  </marker>
                </defs>
                <image
                  href={pitchImg}
                  x="0"
                  y="0"
                  width={PITCH_W}
                  height={PITCH_H}
                  preserveAspectRatio="none"
                />
                {summary.mapPasses.map((pass) => {
                  const handleOpenVideo = (event) => {
                    event.stopPropagation();
                    onOpenVideoSelection?.(summary.mapPasses, { sourceLabel: 'Player Passes', selectedId: pass.raw?.id });
                  };
                  return (
                    <g
                      key={pass.id}
                      className="cursor-pointer"
                      onClick={(event) => event.stopPropagation()}
                      onDoubleClick={handleOpenVideo}
                    >
                      <line
                        x1={pass.start.x}
                        y1={pass.start.y}
                        x2={pass.end.x}
                        y2={pass.end.y}
                        stroke="#111827"
                        strokeWidth="0.75"
                        opacity="0.5"
                      />
                      <line
                        x1={pass.start.x}
                        y1={pass.start.y}
                        x2={pass.end.x}
                        y2={pass.end.y}
                        stroke={pass.color}
                        strokeWidth="0.55"
                        opacity="0.92"
                        markerEnd="url(#player-pass-pane-arrow)"
                      >
                        <title>{pass.tooltip}</title>
                      </line>
                    </g>
                  );
                })}
              </svg>
            <PlayerMapOverlay
              title="Passes"
              onOpenVideo={summary.mapPasses.length ? () => onOpenVideoSelection?.(summary.mapPasses, { sourceLabel: 'Player Passes' }) : null}
            />
          </div>
          <div className="space-y-2 pt-1">
            <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Pass Method Split</div>
            <div className="w-full max-w-[320px] space-y-2">
              <div className="relative h-3 overflow-hidden rounded-full bg-slate-200">
                <div className="absolute inset-y-0 left-0 bg-sky-400" style={{ width: `${summary.leftShare * 100}%` }} />
                <div className="absolute inset-y-0 bg-amber-400" style={{ left: `${summary.leftShare * 100}%`, width: `${summary.handShare * 100}%` }} />
                <div className="absolute inset-y-0 right-0 bg-violet-400" style={{ width: `${summary.rightShare * 100}%` }} />
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs font-medium text-slate-600">
                <div className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-sky-400" />
                  <span>{`Left ${Math.round(summary.leftShare * 100)}%`}</span>
                </div>
                <div className="flex items-center justify-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" />
                  <span>{`Hand ${Math.round(summary.handShare * 100)}%`}</span>
                </div>
                <div className="flex items-center justify-end gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-violet-400" />
                  <span>{`Right ${Math.round(summary.rightShare * 100)}%`}</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PlayerCarryingPanel({
  row,
  carries = [],
  statMode = 'raw',
  teamSide = 'home',
  match = null,
  onOpenVideoSelection = null,
  cardStyle = undefined,
}) {
  const summary = useMemo(() => {
    const sourceCarries = Array.isArray(carries) ? carries : [];
    let completedCarries = 0;
    let progressiveAttempts = 0;
    let progressiveCompleted = 0;
    let highPressureCarries = 0;
    let progressiveCarriesInOppThird = 0;
    let takeOnAttempts = 0;
    let takeOnCompleted = 0;
    let foulsWonOnCarries = 0;
    let totalCarryMetres = 0;
    let progCarryMetres = 0;

    const mapCarries = sourceCarries.map((stat) => {
      const extra = safeParseJSON(stat?.extra_data || '{}', {});
      const start = horizontalPointForSelectedTeam({
        stat,
        rawX: stat?.raw_x_position,
        rawY: stat?.raw_y_position,
        x: stat?.x_position,
        y: stat?.y_position,
      }, teamSide, match);
      const end = horizontalPointForSelectedTeam({
        stat,
        rawX: safeFinite(stat?.raw_end_x_position) ?? safeFinite(stat?.raw_x_position),
        rawY: safeFinite(stat?.raw_end_y_position) ?? safeFinite(stat?.raw_y_position),
        x: safeFinite(stat?.end_x_position) ?? safeFinite(stat?.x_position),
        y: safeFinite(stat?.end_y_position) ?? safeFinite(stat?.y_position),
      }, teamSide, match);

      const outcome = deriveOutcome(stat, extra);
      const isCompleted = outcome === 'completed';
      if (isCompleted) completedCarries += 1;

      const isProgressive = isProgressiveShared(stat);
      if (isProgressive) progressiveAttempts += 1;
      if (isProgressive && isCompleted) progressiveCompleted += 1;
      if (isProgressive && isCompleted && start && start.x >= ((2 * PITCH_W) / 3)) progressiveCarriesInOppThird += 1;

      const takeOn = String(extra?.carry?.take_on || '').trim().toLowerCase();
      const takeOnWasAttempted = takeOn === 'completed' || takeOn === 'failed';
      if (takeOnWasAttempted) takeOnAttempts += 1;
      if (takeOn === 'completed') takeOnCompleted += 1;

      const carryOutcome = String(extra?.carry?.outcome || '').trim().toLowerCase();
      const isFoulWonCarry = carryOutcome === 'foul';
      if (isFoulWonCarry) foulsWonOnCarries += 1;
      if (String(extra?.carry?.pressure_on_carrier || '').trim().toLowerCase() === 'high') highPressureCarries += 1;

      let length = NaN;
      if (start && end) {
        const dx = Number(end.x) - Number(start.x);
        const dy = Number(end.y) - Number(start.y);
        length = Math.sqrt((dx * dx) + (dy * dy));
        if (Number.isFinite(length)) totalCarryMetres += length;
      }

      const gainedMeters = isCompleted ? getProgressiveMeters(stat) : 0;
      if (Number.isFinite(gainedMeters)) progCarryMetres += gainedMeters;

      const playerLabel = buildPlayerDisplayTitle(row);
      const timeLabel = Number.isFinite(Number(stat?.normalized_time_s))
        ? formatMMSS(Number(stat.normalized_time_s))
        : Number.isFinite(Number(stat?.time_s))
          ? formatMMSS(Number(stat.time_s))
          : 'NA';
      const tip = [
        `Player: ${playerLabel || 'NA'}`,
        `Time: ${timeLabel}`,
        `Outcome: ${toTitleCase(outcome || 'unknown')}`,
        `Take On: ${toTitleCase(takeOn || 'no')}`,
        Number.isFinite(gainedMeters) ? `Progressive Metres: ${gainedMeters.toFixed(1)}` : null,
        Number.isFinite(length) ? `Length: ${length.toFixed(1)}` : null,
        Number.isFinite(Number(stat?.possession_id)) ? `Possession: ${Number(stat.possession_id)}` : null,
      ].filter(Boolean).join('\n');

      return {
        id: `player-carry-pane-${stat.id}`,
        start,
        end,
        outcome,
        takeOn,
        takeOnCompleted: takeOn === 'completed',
        color: (isCompleted || isFoulWonCarry) ? '#2563eb' : '#dc2626',
        tooltip: tip,
        raw: stat,
      };
    }).filter((entry) => entry.start && entry.end);

    return {
      carryCount: sourceCarries.length,
      completedCarries,
      progressiveAttempts,
      progressiveCompleted,
      highPressureCarries,
      progressiveCarriesInOppThird,
      takeOnAttempts,
      takeOnCompleted,
      foulsWonOnCarries,
      totalCarryMetres,
      progCarryMetres,
      mapCarries,
    };
  }, [carries, match, row, teamSide]);

  const metrics = [
    { label: 'Carries', value: formatScoringFraction(summary.completedCarries, summary.carryCount) },
    { label: 'Prog Carries', value: formatScoringFraction(summary.progressiveCompleted, summary.progressiveAttempts) },
    { label: 'Takeons', value: formatScoringFraction(summary.takeOnCompleted, summary.takeOnAttempts) },
    { label: 'Prog Carries In Opp 1/3', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, summary.progressiveCarriesInOppThird, 'rate') : summary.progressiveCarriesInOppThird, { decimals: 0 }) },
    { label: 'High Pressure Carries', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, summary.highPressureCarries, 'rate') : summary.highPressureCarries, { decimals: 0 }) },
    { label: 'Fouls Won On Carries', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, summary.foulsWonOnCarries, 'rate') : summary.foulsWonOnCarries, { decimals: 0 }) },
    { label: 'Total Carry Metres', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, summary.totalCarryMetres, 'rate') : summary.totalCarryMetres, { decimals: 1, suffix: 'm' }) },
    { label: 'Prog Carry Metres', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, summary.progCarryMetres, 'rate') : summary.progCarryMetres, { decimals: 1, suffix: 'm' }) },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
      <Card style={cardStyle}>
        <CardContent className="p-4 space-y-4">
          <div className="text-lg font-semibold text-slate-900">Carrying</div>

          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {metrics.map((metric) => (
              <div key={metric.label} className="min-w-0 space-y-1">
                <div className="text-sm font-medium uppercase tracking-wide text-slate-500">{metric.label}</div>
                <div className="text-2xl font-semibold leading-none text-slate-900">{metric.value}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card style={cardStyle}>
        <CardContent className="flex h-full items-center p-4">
          <div className="relative w-full overflow-hidden rounded-lg" style={{ aspectRatio: `${PITCH_W} / ${PITCH_H}` }}>
            <svg viewBox={`0 0 ${PITCH_W} ${PITCH_H}`} className="relative z-10 h-full w-full">
              <defs>
                <marker id="player-carry-pane-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" stroke="context-stroke" />
                </marker>
              </defs>
              <image
                href={pitchImg}
                x="0"
                y="0"
                width={PITCH_W}
                height={PITCH_H}
                preserveAspectRatio="none"
              />
              {summary.mapCarries.map((carry) => {
                const handleOpenVideo = (event) => {
                  event.stopPropagation();
                  onOpenVideoSelection?.(summary.mapCarries, { sourceLabel: 'Player Carries', selectedId: carry.raw?.id });
                };
                return (
                  <g
                    key={carry.id}
                    className="cursor-pointer"
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={handleOpenVideo}
                  >
                    <line
                      x1={carry.start.x}
                      y1={carry.start.y}
                      x2={carry.end.x}
                      y2={carry.end.y}
                      stroke="#111827"
                      strokeWidth="0.75"
                      opacity="0.5"
                    />
                    <line
                      x1={carry.start.x}
                      y1={carry.start.y}
                      x2={carry.end.x}
                      y2={carry.end.y}
                      stroke={carry.color}
                      strokeWidth="0.65"
                      opacity="0.92"
                      markerEnd="url(#player-carry-pane-arrow)"
                    >
                      <title>{carry.tooltip}</title>
                    </line>
                    {carry.takeOnCompleted ? (
                      <>
                      <polygon
                        points={buildStarPoints((carry.start.x + carry.end.x) / 2, (carry.start.y + carry.end.y) / 2, 2.2, 0.95, 5)}
                        fill="#f59e0b"
                        stroke="#ffffff"
                        strokeWidth="0.35"
                        paintOrder="stroke"
                      />
                      <text
                        display="none"
                        x={(carry.start.x + carry.end.x) / 2}
                        y={((carry.start.y + carry.end.y) / 2) - 1.2}
                        textAnchor="middle"
                        fontSize="4.6"
                        fontWeight="700"
                        fill="#f59e0b"
                        stroke="#ffffff"
                        strokeWidth="0.25"
                        paintOrder="stroke"
                      >
                        ★
                      </text>
                      </>
                    ) : null}
                  </g>
                );
                })}
              </svg>
            <PlayerMapOverlay
              title="Carries"
              onOpenVideo={summary.mapCarries.length ? () => onOpenVideoSelection?.(summary.mapCarries, { sourceLabel: 'Player Carries' }) : null}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PlayerRestartPanel({
  row,
  statMode = 'raw',
  kickoutItems = [],
  teamSide = 'home',
  onOpenVideoSelection = null,
  cardStyle = undefined,
}) {
  if (!row) return null;

  const metrics = [
    { label: 'Targetted', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, row.kickoutTargets, 'rate') : row.kickoutTargets, { decimals: 0 }) },
    { label: 'Targetted KOs Won By Team', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, row.kickoutWins, 'rate') : row.kickoutWins, { decimals: 0 }) },
    { label: 'Clean Won', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, row.cleanWon, 'rate') : row.cleanWon, { decimals: 0 }) },
    { label: 'Clean Lost', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, row.cleanLost, 'rate') : row.cleanLost, { decimals: 0 }) },
    { label: 'Break Won', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, row.breakWon, 'rate') : row.breakWon, { decimals: 0 }) },
    { label: 'Break Lost', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, row.breakLost, 'rate') : row.breakLost, { decimals: 0 }) },
    { label: 'Broken', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, row.broken, 'rate') : row.broken, { decimals: 0 }) },
    { label: 'Marks', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, row.marks, 'rate') : row.marks, { decimals: 0 }) },
  ];

  const safeKickoutItems = Array.isArray(kickoutItems) ? kickoutItems : [];

  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
      <Card style={cardStyle}>
        <CardContent className="p-4 space-y-4">
          <div className="text-lg font-semibold text-slate-900">Restarts</div>

          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {metrics.map((metric) => (
              <div key={metric.label} className="min-w-0 space-y-1">
                <div className="text-sm font-medium uppercase tracking-wide text-slate-500">{metric.label}</div>
                <div className="text-2xl font-semibold leading-none text-slate-900">{metric.value}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card style={cardStyle}>
        <CardContent className="flex h-full items-center p-4">
          <div className="relative w-full overflow-hidden rounded-lg" style={{ aspectRatio: `${PITCH_W} / ${PITCH_H}` }}>
            <svg viewBox={`0 0 ${PITCH_W} ${PITCH_H}`} className="relative z-10 h-full w-full">
              <defs>
                <marker id="player-restart-pane-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" stroke="context-stroke" />
                </marker>
              </defs>
              <image
                href={pitchImg}
                x="0"
                y="0"
                width={PITCH_W}
                height={PITCH_H}
                preserveAspectRatio="none"
              />
              {safeKickoutItems.map((item) => {
                const startPoint = item.start;
                const endPoint = item.end;
                if (!startPoint || !endPoint) return null;

                const handleOpenVideo = (event) => {
                  event.stopPropagation();
                  onOpenVideoSelection?.(safeKickoutItems, { sourceLabel: 'Player Restarts', selectedId: item.raw?.id });
                };

                return (
                  <g
                    key={item.id}
                    className="cursor-pointer"
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={handleOpenVideo}
                  >
                    <line
                      x1={startPoint.x}
                      y1={startPoint.y}
                      x2={endPoint.x}
                      y2={endPoint.y}
                      stroke={item.lineColor || item.color || ACCENT_COLOR}
                      strokeWidth={0.95}
                      opacity={0.88}
                      markerEnd="url(#player-restart-pane-arrow)"
                    >
                      <title>{item.tooltip}</title>
                    </line>
                    <circle cx={startPoint.x} cy={startPoint.y} r="0.9" fill={item.lineColor || item.color || ACCENT_COLOR} opacity="0.95" />
                    <circle
                      cx={endPoint.x}
                      cy={endPoint.y}
                      r="1.15"
                      fill={item.endColor || item.color || ACCENT_COLOR}
                      stroke={item.lineColor || item.color || ACCENT_COLOR}
                      strokeWidth="0.35"
                      opacity="0.95"
                    />
                  </g>
                );
              })}
            </svg>
            <PlayerMapOverlay
              title="Kickouts"
              arrowText={teamSide === 'away' ? '<- Attacking' : 'Attacking ->'}
              arrowSide={teamSide === 'away' ? 'right' : 'left'}
              onOpenVideo={safeKickoutItems.length ? () => onOpenVideoSelection?.(safeKickoutItems, { sourceLabel: 'Player Restarts' }) : null}
            />
            {!safeKickoutItems.length ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-medium text-slate-500">
                No kickout involvements in the current filter.
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PlayerProgressionPanel({
  row,
  derived = {},
  receptions = [],
  passes = [],
  carries = [],
  scorableFreesWon = 0,
  statMode = 'raw',
  teamSide = 'home',
  match = null,
  onOpenVideoSelection = null,
  cardStyle = undefined,
}) {
  if (!row) return null;

  const summary = useMemo(() => {
    const safeReceptions = Array.isArray(receptions) ? receptions : [];
    const safePasses = Array.isArray(passes) ? passes : [];
    const safeCarries = Array.isArray(carries) ? carries : [];
    let progressiveReceptionsInOppThird = 0;
    let passProgressiveMeters = 0;
    let carryProgressiveMeters = 0;

    const mapReceptions = safeReceptions.map((stat) => {
      const extra = safeParseJSON(stat?.extra_data || '{}', {});
      const endPoint = horizontalPointForSelectedTeam({
        stat,
        rawX: safeFinite(stat?.raw_end_x_position) ?? safeFinite(stat?.raw_x_position),
        rawY: safeFinite(stat?.raw_end_y_position) ?? safeFinite(stat?.raw_y_position),
        x: safeFinite(stat?.end_x_position) ?? safeFinite(stat?.x_position),
        y: safeFinite(stat?.end_y_position) ?? safeFinite(stat?.y_position),
      }, teamSide, match);
      if (!endPoint) return null;

      const isProgressive = isProgressiveShared(stat);
      if (isProgressive && endPoint.x >= ((2 * PITCH_W) / 3)) progressiveReceptionsInOppThird += 1;

      const passer = getPrimaryActorSelection(stat, extra);
      const playerLabel = buildPlayerDisplayTitle(row);
      const timeLabel = Number.isFinite(Number(stat?.normalized_time_s))
        ? formatMMSS(Number(stat.normalized_time_s))
        : Number.isFinite(Number(stat?.time_s))
          ? formatMMSS(Number(stat.time_s))
          : 'NA';
      const tooltip = [
        `Player: ${playerLabel || 'NA'}`,
        `Time: ${timeLabel}`,
        `From: ${formatExtraValue(passer).replace(/\s+\((Home|Away)\)\s*$/i, '') || 'NA'}`,
        `Progressive: ${isProgressive ? 'Yes' : 'No'}`,
        Number.isFinite(Number(stat?.possession_id)) ? `Possession: ${Number(stat.possession_id)}` : null,
      ].filter(Boolean).join('\n');

      return {
        id: `player-reception-pane-${stat.id}`,
        point: endPoint,
        color: isProgressive ? '#2563eb' : '#16a34a',
        tooltip,
        raw: stat,
      };
    }).filter(Boolean);

    for (const stat of safePasses) {
      const extra = safeParseJSON(stat?.extra_data || '{}', {});
      const outcome = deriveOutcome(stat, extra);
      if (outcome !== 'completed') continue;
      const gainedMeters = getProgressiveMeters(stat);
      if (Number.isFinite(gainedMeters)) passProgressiveMeters += gainedMeters;
    }

    for (const stat of safeCarries) {
      const extra = safeParseJSON(stat?.extra_data || '{}', {});
      const outcome = deriveOutcome(stat, extra);
      if (outcome !== 'completed') continue;
      const gainedMeters = getProgressiveMeters(stat);
      if (Number.isFinite(gainedMeters)) carryProgressiveMeters += gainedMeters;
    }

    return {
      progressiveReceptionsInOppThird,
      passProgressiveMeters,
      carryProgressiveMeters,
      totalProgressiveMeters: passProgressiveMeters + carryProgressiveMeters,
      mapReceptions,
    };
  }, [carries, match, passes, receptions, row, teamSide]);

  const totalProgressiveBalance = summary.passProgressiveMeters + summary.carryProgressiveMeters;
  const passShare = totalProgressiveBalance > 0 ? (summary.passProgressiveMeters / totalProgressiveBalance) : 0;
  const carryShare = totalProgressiveBalance > 0 ? (summary.carryProgressiveMeters / totalProgressiveBalance) : 0;

  const metrics = [
    { label: 'Passes Received', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, derived.passesReceived, 'rate') : derived.passesReceived, { decimals: 0 }) },
    { label: 'Prog Passes Received', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, row.progPassRecv, 'rate') : row.progPassRecv, { decimals: 0 }) },
    { label: 'Touches', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, row.touches, 'rate') : row.touches, { decimals: 0 }) },
    { label: 'Prog Passes Received In Opp 1/3', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, summary.progressiveReceptionsInOppThird, 'rate') : summary.progressiveReceptionsInOppThird, { decimals: 0 }) },
    { label: 'Total Prog Metres', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, summary.totalProgressiveMeters, 'rate') : summary.totalProgressiveMeters, { decimals: 1, suffix: 'm' }) },
    { label: 'Scorable Frees Won', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, scorableFreesWon, 'rate') : scorableFreesWon, { decimals: 0 }) },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
      <Card style={cardStyle}>
        <CardContent className="p-4 space-y-4">
          <div className="text-lg font-semibold text-slate-900">Progression</div>

          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {metrics.map((metric) => (
              <div key={metric.label} className="min-w-0 space-y-1">
                <div className="text-sm font-medium uppercase tracking-wide text-slate-500">{metric.label}</div>
                <div className="text-2xl font-semibold leading-none text-slate-900">{metric.value}</div>
              </div>
            ))}
          </div>

          <div className="space-y-2 pt-1">
            <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Carry : Pass Progressive Balance</div>
            <div className="w-full max-w-[320px] space-y-2">
              <div className="relative h-3 overflow-hidden rounded-full bg-slate-200">
                <div className="absolute inset-y-0 left-0 bg-violet-400" style={{ width: `${carryShare * 100}%` }} />
                <div className="absolute inset-y-0 right-0 bg-sky-400" style={{ width: `${passShare * 100}%` }} />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs font-medium text-slate-600">
                <div className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-violet-400" />
                  <span>{`Carry ${Math.round(carryShare * 100)}%`}</span>
                </div>
                <div className="flex items-center justify-end gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-sky-400" />
                  <span>{`Pass ${Math.round(passShare * 100)}%`}</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card style={cardStyle}>
        <CardContent className="flex h-full items-center p-4">
          <div className="relative w-full overflow-hidden rounded-lg" style={{ aspectRatio: `${PITCH_W} / ${PITCH_H}` }}>
            <svg viewBox={`0 0 ${PITCH_W} ${PITCH_H}`} className="relative z-10 h-full w-full">
              <image
                href={pitchImg}
                x="0"
                y="0"
                width={PITCH_W}
                height={PITCH_H}
                preserveAspectRatio="none"
              />
              {summary.mapReceptions.map((reception) => {
                const handleOpenVideo = (event) => {
                  event.stopPropagation();
                  onOpenVideoSelection?.(summary.mapReceptions, { sourceLabel: 'Player Receptions', selectedId: reception.raw?.id });
                };
                return (
                  <g
                    key={reception.id}
                    className="cursor-pointer"
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={handleOpenVideo}
                  >
                    <circle cx={reception.point.x} cy={reception.point.y} r="1.9" fill="none" stroke="#111827" strokeWidth="0.4" />
                    <circle cx={reception.point.x} cy={reception.point.y} r="1.9" fill={reception.color} opacity="0.92">
                      <title>{reception.tooltip}</title>
                    </circle>
                    <circle cx={reception.point.x} cy={reception.point.y} r="1.9" fill="none" stroke="#ffffff" strokeWidth="0.55" />
                  </g>
                );
              })}
            </svg>
            <PlayerMapOverlay
              title="Receptions"
              onOpenVideo={summary.mapReceptions.length ? () => onOpenVideoSelection?.(summary.mapReceptions, { sourceLabel: 'Player Receptions' }) : null}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PlayerDefensePanel({
  row,
  actions = [],
  cardCounts = null,
  statMode = 'raw',
  onOpenVideoSelection = null,
  cardStyle = undefined,
}) {
  if (!row) return null;

  const summary = useMemo(() => {
    const safeActions = Array.isArray(actions) ? actions : [];
    const pressureApplied = safeActions.filter((action) => String(action?.reason || '').toLowerCase().includes('pressure')).length;
    const mapActions = safeActions.map((action) => {
      const reason = String(action?.reason || '').toLowerCase();
      const isPressure = reason.includes('pressure');
      const isFoul = reason.includes('foul');
      const playerLabel = buildPlayerDisplayTitle(row);
      const timeLabel = Number.isFinite(Number(action?.stat?.normalized_time_s))
        ? formatMMSS(Number(action.stat.normalized_time_s))
        : Number.isFinite(Number(action?.stat?.time_s))
          ? formatMMSS(Number(action.stat.time_s))
          : 'NA';
      const tooltip = [
        `Player: ${playerLabel || 'NA'}`,
        `Time: ${timeLabel}`,
        `Action: ${action?.reason || 'Defensive Action'}`,
        action?.oppositionPlayerLabel ? `Opponent: ${action.oppositionPlayerLabel}` : null,
        Number.isFinite(Number(action?.stat?.possession_id)) ? `Possession: ${Number(action.stat.possession_id)}` : null,
      ].filter(Boolean).join('\n');

      return {
        id: `player-defence-pane-${action.key}`,
        x: Number(action?.x),
        y: Number(action?.y),
        color: isFoul ? '#dc2626' : isPressure ? '#f59e0b' : '#2563eb',
        shape: isFoul ? 'cross' : 'circle',
        tooltip,
        raw: action?.stat,
      };
    }).filter((action) => Number.isFinite(action.x) && Number.isFinite(action.y));

    return { pressureApplied, mapActions };
  }, [actions, row]);

  const resolvedCardCounts = cardCounts || { yellow: 0, black: 0, red: 0 };

  const metrics = [
    { label: 'TO Forced', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, row.turnoversForced, 'rate') : row.turnoversForced, { decimals: 0 }) },
    { label: 'TO Recovered', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, row.turnoversRecovered, 'rate') : row.turnoversRecovered, { decimals: 0 }) },
    { label: 'Defensive Actions', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, row.defActions, 'rate') : row.defActions, { decimals: 0 }) },
    { label: 'Fouls', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, row.foulsConceded, 'rate') : row.foulsConceded, { decimals: 0 }) },
    { label: 'Blocks', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, row.blocks, 'rate') : row.blocks, { decimals: 0 }) },
    { label: 'Pressure Applied', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, summary.pressureApplied, 'rate') : summary.pressureApplied, { decimals: 0 }) },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
      <Card style={cardStyle}>
        <CardContent className="p-4 space-y-4">
          <div className="text-lg font-semibold text-slate-900">Defense</div>

          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {metrics.map((metric) => (
              <div key={metric.label} className="min-w-0 space-y-1">
                <div className="text-sm font-medium uppercase tracking-wide text-slate-500">{metric.label}</div>
                <div className="text-2xl font-semibold leading-none text-slate-900">{metric.value}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-4 border-t border-slate-200 pt-3 text-sm font-medium text-slate-700">
            <div className="inline-flex items-center gap-2">
              <span className="inline-block h-12 w-9 rounded-sm border border-yellow-500 bg-yellow-400" />
              <span className="tabular-nums">{resolvedCardCounts.yellow}</span>
            </div>
            <div className="inline-flex items-center gap-2">
              <span className="inline-block h-12 w-9 rounded-sm border border-slate-700 bg-slate-900" />
              <span className="tabular-nums">{resolvedCardCounts.black}</span>
            </div>
            <div className="inline-flex items-center gap-2">
              <span className="inline-block h-12 w-9 rounded-sm border border-red-700 bg-red-500" />
              <span className="tabular-nums">{resolvedCardCounts.red}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card style={cardStyle}>
        <CardContent className="flex h-full items-center p-4">
          <div className="relative w-full overflow-hidden rounded-lg" style={{ aspectRatio: `${PITCH_W} / ${PITCH_H}` }}>
            <svg viewBox={`0 0 ${PITCH_W} ${PITCH_H}`} className="relative z-10 h-full w-full">
              <image
                href={pitchImg}
                x="0"
                y="0"
                width={PITCH_W}
                height={PITCH_H}
                preserveAspectRatio="none"
              />
              {summary.mapActions.map((action) => {
                const handleOpenVideo = (event) => {
                  event.stopPropagation();
                  onOpenVideoSelection?.(summary.mapActions, { sourceLabel: 'Player Defensive Actions', selectedId: action.raw?.id });
                };
                return (
                  <g
                    key={action.id}
                    className="cursor-pointer"
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={handleOpenVideo}
                  >
                    {action.shape === 'cross' ? (
                      <>
                        <line x1={action.x - 1.7} y1={action.y - 1.7} x2={action.x + 1.7} y2={action.y + 1.7} stroke={action.color} strokeWidth="0.95">
                          <title>{action.tooltip}</title>
                        </line>
                        <line x1={action.x - 1.7} y1={action.y + 1.7} x2={action.x + 1.7} y2={action.y - 1.7} stroke={action.color} strokeWidth="0.95" />
                      </>
                    ) : (
                      <>
                        <circle cx={action.x} cy={action.y} r="1.9" fill="none" stroke="#111827" strokeWidth="0.4" />
                        <circle cx={action.x} cy={action.y} r="1.9" fill={action.color} opacity="0.92">
                          <title>{action.tooltip}</title>
                        </circle>
                        <circle cx={action.x} cy={action.y} r="1.9" fill="none" stroke="#ffffff" strokeWidth="0.55" />
                      </>
                    )}
                  </g>
                );
              })}
            </svg>
            <PlayerMapOverlay
              title="Defensive Actions"
              onOpenVideo={summary.mapActions.length ? () => onOpenVideoSelection?.(summary.mapActions, { sourceLabel: 'Player Defensive Actions' }) : null}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PlayerDefendingAllowedPanel({
  row,
  statMode = 'raw',
  readOnly = false,
  onOpenMatchupEditor = null,
  touchPoints = [],
  finalThirdTouches = 0,
  teamSide = 'home',
  match = null,
  onOpenVideoSelection = null,
  cardStyle = undefined,
}) {
  if (!row) return null;
  const [stintsOpen, setStintsOpen] = useState(false);

  const matchupMinutesLabel = formatMetricValue(row.matchupMinutes, { decimals: 1, suffix: ' mins' });
  const metrics = [
    { label: 'Touches', value: formatMatchupMetricValue(row, row.daTouches, statMode, { decimals: 0 }) },
    { label: 'Shots', value: formatMatchupMetricValue(row, row.daShots, statMode, { decimals: 0 }) },
    { label: 'Points', value: formatMatchupMetricValue(row, row.daPoints, statMode, { decimals: 0 }) },
    { label: 'xP', value: formatMatchupMetricValue(row, row.daXp, statMode, { decimals: 2 }) },
    { label: 'Passes', value: formatMatchupMetricValue(row, row.daPasses, statMode, { decimals: 0 }) },
    { label: 'Prog Passes', value: formatMatchupMetricValue(row, row.daProgPasses, statMode, { decimals: 0 }) },
    { label: 'Carries', value: formatMatchupMetricValue(row, row.daCarries, statMode, { decimals: 0 }) },
    { label: 'Prog Carries', value: formatMatchupMetricValue(row, row.daProgCarries, statMode, { decimals: 0 }) },
    { label: 'Prog Passes Received', value: formatMatchupMetricValue(row, row.daProgPassesReceived, statMode, { decimals: 0 }) },
    { label: 'Prog Metres', value: formatMatchupMetricValue(row, row.daProgMetres, statMode, { decimals: 1, suffix: 'm' }) },
    { label: 'Final 1/3 Touches', value: formatMatchupMetricValue(row, finalThirdTouches, statMode, { decimals: 0 }) },
    {
      label: 'Kickouts Won',
      value: row.daKickoutTotal
        ? `${Math.round(Number(row.daKickoutsWon) || 0)}/${Math.round(Number(row.daKickoutTotal) || 0)} (${formatPct(row.daKickoutWinPct)})`
        : '0/0 (NA)',
    },
    { label: 'TO Lost', value: formatMatchupMetricValue(row, row.daTurnoversLost, statMode, { decimals: 0 }) },
    { label: 'Fouls Won', value: formatMatchupMetricValue(row, row.daFoulsWon, statMode, { decimals: 0 }) },
  ];

  const safeStints = Array.isArray(row.daStints) ? row.daStints : [];
  const previewStints = safeStints.slice(0, 2);

  return (
    <>
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <Card style={cardStyle} className="h-full">
        <CardContent className="flex h-full flex-col gap-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-lg font-semibold text-slate-900">Defending Allowed</div>
            <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              {matchupMinutesLabel}
            </div>
          </div>

          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {metrics.map((metric) => (
              <div key={metric.label} className="min-w-0 space-y-1">
                <div className="text-sm font-medium uppercase tracking-wide text-slate-500">{metric.label}</div>
                <div className="text-2xl font-semibold leading-none text-slate-900">{metric.value}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex h-full min-h-0 flex-col gap-4">
        <Card style={cardStyle} className="shrink-0">
          <CardContent className="p-3">
            <div className="relative w-full overflow-hidden rounded-lg" style={{ aspectRatio: `${PITCH_W} / ${PITCH_H}` }}>
              <svg viewBox={`0 0 ${PITCH_W} ${PITCH_H}`} className="relative z-10 h-full w-full">
                <image
                  href={pitchImg}
                  x="0"
                  y="0"
                  width={PITCH_W}
                  height={PITCH_H}
                  preserveAspectRatio="none"
                />
                {touchPoints.map((touch) => {
                  const point = horizontalPointForSelectedTeam(touch, touch?.teamSide || teamSide, match);
                  if (!point) return null;
                  const handleOpenVideo = (event) => {
                    event.stopPropagation();
                    onOpenVideoSelection?.(touchPoints, { sourceLabel: 'Defending Allowed Touches', selectedId: touch.raw?.id });
                  };
                  return (
                    <g
                      key={touch.id}
                      className="cursor-pointer"
                      onClick={(event) => event.stopPropagation()}
                      onDoubleClick={handleOpenVideo}
                    >
                      <circle cx={point.x} cy={point.y} r="1.9" fill="none" stroke="#111827" strokeWidth="0.4" />
                      <circle cx={point.x} cy={point.y} r="1.9" fill={touch.color || '#2563eb'} opacity="0.92">
                        <title>{touch.tooltip}</title>
                      </circle>
                      <circle cx={point.x} cy={point.y} r="1.9" fill="none" stroke="#ffffff" strokeWidth="0.55" />
                    </g>
                  );
                })}
              </svg>
              <PlayerMapOverlay
                title="Touches Allowed"
                onOpenVideo={touchPoints.length ? () => onOpenVideoSelection?.(touchPoints, { sourceLabel: 'Defending Allowed Touches' }) : null}
              />
              {!touchPoints.length ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-medium text-slate-500">
                  No matchup touches in the current filter.
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card style={cardStyle} className="shrink-0">
          <CardContent className="flex flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="text-lg font-semibold text-slate-900">Matchups</div>
              <div className="flex shrink-0 items-center gap-2">
                <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                  {matchupMinutesLabel}
                </div>
                {safeStints.length > 2 ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setStintsOpen(true)}>
                    Expand
                  </Button>
                ) : null}
                {!readOnly && typeof onOpenMatchupEditor === 'function' ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => onOpenMatchupEditor(row.key)}>
                    Manage Matchups
                  </Button>
                ) : null}
              </div>
            </div>

            {previewStints.length ? (
              <div className="space-y-2">
                {previewStints.map((stint) => (
                  <div key={stint.id || `${stint.periodKey}-${stint.startTimeS}-${stint.attackerKey}`} className="rounded-2xl border border-slate-200 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <div className="min-w-0 flex-1 font-medium text-slate-900">{stint.attackerPlayerLabel || 'Unknown attacker'}</div>
                      <div className="shrink-0 text-slate-600">
                        {`${stint.clippedStartLabel || stint.startLabel} - ${stint.clippedEndLabel || stint.endLabel}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[6.25rem] items-center justify-center rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
                No matchup stints assigned for this defender yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
    <Dialog open={stintsOpen} onOpenChange={setStintsOpen} modal={false}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Matchup Stints</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {safeStints.map((stint) => (
            <div key={`dialog-${stint.id || `${stint.periodKey}-${stint.startTimeS}-${stint.attackerKey}`}`} className="rounded-2xl border border-slate-200 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div className="min-w-0 flex-1 font-medium text-slate-900">{stint.attackerPlayerLabel || 'Unknown attacker'}</div>
                <div className="shrink-0 text-slate-600">
                  {`${stint.clippedStartLabel || stint.startLabel} - ${stint.clippedEndLabel || stint.endLabel}`}
                </div>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}

function PlayerHeaderCard({
  row,
  role,
  homeTeam,
  awayTeam,
  heroKpis = [],
  teamSide = 'home',
  heatmapPoints = [],
  match = null,
  rightPanelMode = 'heatmap',
  kickoutMapItems = [],
  onComparePlayer = null,
  onOpenVideoSelection = null,
}) {
  if (!row) return null;
  const position = String(row.position || '').trim() || 'Position not logged';
  const hideRoleChip = isGoalkeeperPlayer(row) || /goalkeeper/i.test(position) || position.toLowerCase() === 'gk';
  const teamLabel = teamLabelForSide(row.team, homeTeam, awayTeam);
  const playerTitle = buildPlayerDisplayTitle(row);
  const paneStyle = {
    backgroundColor: '#ffffff',
    borderColor: 'rgb(226, 232, 240)',
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
        <Card style={paneStyle}>
          <CardContent className="h-full p-0">
            <div className="min-w-0">
              <div className="min-w-0 p-4 pb-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1.5">
                    <div className="text-[2rem] font-semibold uppercase leading-tight tracking-[0.02em] text-slate-900 break-words">{playerTitle}</div>
                    <div className="text-base font-medium text-slate-700">{teamLabel}</div>
                  </div>
                  {typeof onComparePlayer === 'function' ? (
                    <Button type="button" variant="outline" className="h-8 rounded-full px-3 text-xs font-semibold" onClick={onComparePlayer}>
                      Compare This Player
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="min-w-0 px-4 pb-2 pt-2">
                <TooltipProvider delayDuration={120}>
                  <div className="flex flex-wrap items-center gap-3">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <Badge variant="outline" className="rounded-full bg-white px-4 py-2 text-[1rem] font-medium leading-none text-slate-900">{position}</Badge>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Position</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <Badge variant="outline" className="rounded-full bg-white px-4 py-2 text-[1rem] font-medium leading-none text-slate-900">{`${formatCompactNumber(row.minutesPlayed, 0)} mins`}</Badge>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Minutes played</TooltipContent>
                    </Tooltip>

                    {!hideRoleChip ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex">
                            <Badge variant="outline" className="rounded-full bg-white px-4 py-2 text-[1rem] font-medium leading-none text-slate-900">{role?.label || 'Role TBD'}</Badge>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>Role</TooltipContent>
                      </Tooltip>
                    ) : null}
                  </div>
                </TooltipProvider>
              </div>

              <div className="min-w-0 px-4 pb-4 pt-3">
                <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
                  {heroKpis.map((item) => (
                    <div key={item.label} className="min-w-0 space-y-1">
                      <div className="text-sm font-medium uppercase tracking-wide text-slate-500">{item.label}</div>
                      <div className="text-3xl font-semibold leading-none text-slate-900">{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card style={paneStyle}>
          <CardContent className="h-full p-0">
              {rightPanelMode === 'kickout-map' ? (
                <PlayerTopPitchMap items={kickoutMapItems} teamSide={teamSide} match={match} onOpenVideoSelection={onOpenVideoSelection} />
              ) : (
                <PlayerInvolvementHeatmap points={heatmapPoints} teamSide={teamSide} match={match} onOpenVideoSelection={onOpenVideoSelection} showVideoButton={false} />
              )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function heatmapColorForRatio(ratio) {
  const clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
  if (clamped <= 0) return 'transparent';
  if (clamped < 0.28) return `rgba(165, 243, 252, ${0.16 + (clamped * 0.26)})`;
  if (clamped < 0.58) return `rgba(250, 204, 21, ${0.26 + (clamped * 0.22)})`;
  if (clamped < 0.82) return `rgba(249, 115, 22, ${0.46 + (clamped * 0.18)})`;
  return `rgba(239, 68, 68, ${0.6 + (clamped * 0.14)})`;
}

function PlayerInvolvementHeatmap({ points = [], teamSide = 'home', match = null, onOpenVideoSelection = null, title = 'Heatmap', showVideoButton = true }) {
  const safePoints = Array.isArray(points) ? points : [];
  const bins = useMemo(() => {
    const oriented = safePoints
      .map((point) => horizontalPointForSelectedTeam(point, teamSide, match))
      .filter(Boolean);

    const cols = 32;
    const rows = 20;
    const cellW = PITCH_W / cols;
    const cellH = PITCH_H / rows;
    const sigmaX = cellW * 0.82;
    const sigmaY = cellH * 0.82;
    const cells = [];
    let maxWeight = 0;

    for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
      for (let colIndex = 0; colIndex < cols; colIndex += 1) {
        const centerX = (colIndex + 0.5) * cellW;
        const centerY = (rowIndex + 0.5) * cellH;
        let weight = 0;
        for (const point of oriented) {
          const dx = (point.x - centerX) / sigmaX;
          const dy = (point.y - centerY) / sigmaY;
          weight += Math.exp(-0.5 * ((dx * dx) + (dy * dy)));
        }
        maxWeight = Math.max(maxWeight, weight);
        cells.push({ x: colIndex * cellW, y: rowIndex * cellH, width: cellW, height: cellH, weight });
      }
    }

    const positiveWeights = cells
      .map((cell) => cell.weight)
      .filter((weight) => Number.isFinite(weight) && weight > 0)
      .sort((a, b) => a - b);
    const percentileIndex = positiveWeights.length
      ? Math.min(positiveWeights.length - 1, Math.floor(positiveWeights.length * 0.92))
      : -1;
    const cappedMaxWeight = percentileIndex >= 0
      ? positiveWeights[percentileIndex]
      : maxWeight;

    return {
      cells,
      maxWeight,
      cappedMaxWeight,
      pointCount: oriented.length,
    };
  }, [safePoints, teamSide, match]);

  return (
    <div className="flex min-w-0 overflow-hidden p-2">
      <div className="relative w-full max-w-full overflow-hidden rounded-lg" style={{ aspectRatio: `${PITCH_W} / ${PITCH_H}` }}>
        <svg viewBox={`0 0 ${PITCH_W} ${PITCH_H}`} className="relative z-10 h-full w-full">
          <image
            href={pitchImg}
            x="0"
            y="0"
            width={PITCH_W}
            height={PITCH_H}
            preserveAspectRatio="none"
            style={{ filter: 'saturate(0.72) brightness(0.82)' }}
          />
          <rect x="0" y="0" width={PITCH_W} height={PITCH_H} fill="rgba(15, 23, 42, 0.14)" />
          {bins.cells.map((cell) => {
            const ratio = bins.cappedMaxWeight > 0 ? Math.min(cell.weight / bins.cappedMaxWeight, 1) : 0;
            if (ratio <= 0.1) return null;
            return (
              <rect
                key={`${cell.x}-${cell.y}`}
                x={cell.x}
                y={cell.y}
                width={cell.width}
                height={cell.height}
                fill={heatmapColorForRatio(ratio)}
              />
            );
          })}
          <image
            href={pitchImg}
            x="0"
            y="0"
            width={PITCH_W}
            height={PITCH_H}
            preserveAspectRatio="none"
            opacity="0.16"
            style={{ filter: 'grayscale(0.08) brightness(1.08)' }}
          />
        </svg>
        <PlayerMapOverlay title={title} onOpenVideo={showVideoButton && safePoints.length ? () => onOpenVideoSelection?.(safePoints, { sourceLabel: `Player ${title}` }) : null} />
      </div>
    </div>
  );
}

function PlayerTopPitchMap({ items = [], teamSide = 'home', match = null, title = 'Kickouts', arrowText = 'Attacking ->', arrowSide = 'left', onOpenVideoSelection = null }) {
  const safeItems = Array.isArray(items) ? items : [];

  return (
    <div className="flex min-w-0 overflow-hidden p-2">
      <div className="relative w-full max-w-full overflow-hidden rounded-lg" style={{ aspectRatio: `${PITCH_W} / ${PITCH_H}` }}>
        <svg viewBox={`0 0 ${PITCH_W} ${PITCH_H}`} className="relative z-10 h-full w-full">
          <defs>
            <marker id="player-top-pitch-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" stroke="context-stroke" />
            </marker>
          </defs>
          <image
            href={pitchImg}
            x="0"
            y="0"
            width={PITCH_W}
            height={PITCH_H}
            preserveAspectRatio="none"
          />
          {safeItems.map((item) => {
            const startPoint = horizontalPointForSelectedTeam(item.start, teamSide, match);
            const endPoint = item.end ? horizontalPointForSelectedTeam(item.end, teamSide, match) : null;
            if (!startPoint) return null;

            if (item.kind === 'line' && endPoint) {
              return (
                <g
                  key={item.id}
                  className={item.raw ? 'cursor-pointer' : undefined}
                  onDoubleClick={(event) => {
                    if (!item.raw) return;
                    event.stopPropagation();
                    onOpenVideoSelection?.(safeItems, { sourceLabel: title, selectedId: item.raw?.id });
                  }}
                >
                  {item.tooltip ? <title>{item.tooltip}</title> : null}
                  <line
                    x1={startPoint.x}
                    y1={startPoint.y}
                    x2={endPoint.x}
                    y2={endPoint.y}
                    stroke={item.color || ACCENT_COLOR}
                    strokeWidth={item.strokeWidth || 0.9}
                    opacity={item.opacity || 0.82}
                    markerEnd="url(#player-top-pitch-arrow)"
                  />
                  <circle cx={startPoint.x} cy={startPoint.y} r="0.8" fill={item.color || ACCENT_COLOR} opacity="0.95" />
                  <circle cx={endPoint.x} cy={endPoint.y} r={item.endRadius || 1.05} fill={item.color || ACCENT_COLOR} opacity="0.95" />
                </g>
              );
            }

            return (
              <g
                key={item.id}
                className={item.raw ? 'cursor-pointer' : undefined}
                onDoubleClick={(event) => {
                  if (!item.raw) return;
                  event.stopPropagation();
                  onOpenVideoSelection?.(safeItems, { sourceLabel: title, selectedId: item.raw?.id });
                }}
              >
                {item.tooltip ? <title>{item.tooltip}</title> : null}
                <circle
                  cx={startPoint.x}
                  cy={startPoint.y}
                  r={item.radius || 1.55}
                  fill={item.fill || item.color || ACCENT_COLOR}
                  opacity={item.opacity || 0.92}
                  stroke={item.stroke || '#ffffff'}
                  strokeWidth={item.strokeWidth || 0.25}
                />
              </g>
            );
          })}
        </svg>
        <PlayerMapOverlay
          title={title}
          arrowText={arrowText}
          arrowSide={arrowSide}
          onOpenVideo={safeItems.length ? () => onOpenVideoSelection?.(safeItems, { sourceLabel: title }) : null}
        />
      </div>
    </div>
  );
}

function GoalkeeperPressTable({ card, homeTeam, awayTeam }) {
  const [sortState, setSortState] = useState({ key: 'overall', dir: 'desc' });
  const columns = useMemo(() => ([
    { key: 'press', label: 'Press', sortValue: (row) => row.press },
    { key: 'overall', label: 'Overall', sortValue: (row) => row.overall },
    { key: 'short', label: 'Short', sortValue: (row) => row.short },
    { key: 'long', label: 'Long', sortValue: (row) => row.long },
  ]), []);
  const sortedRows = useMemo(() => sortRows(card.pressRows, sortState, columns, 'key'), [card.pressRows, sortState, columns]);
  const toggleSort = (key) => setSortState((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'press' ? 'asc' : 'desc' });

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium text-slate-900">{card.player}</div>
          <div className="text-xs text-slate-500">
            {card.team === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home')}
          </div>
        </div>
        <div className="text-right text-xs text-slate-600">
          <div className="font-medium text-slate-900">{card.kickoutsTaken ? `${card.ownKickoutsWon}/${card.kickoutsTaken}` : 'NA'}</div>
          <div>Own KO Wins</div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <SortableTableHead
                  key={column.key}
                  column={column}
                  sortState={sortState}
                  onToggle={toggleSort}
                  className={column.key === 'press' ? undefined : 'text-right'}
                />
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.map((row) => (
              <TableRow key={row.key} style={teamRowTint(card.team, homeTeam?.color, awayTeam?.color, 0.07)}>
                <TableCell className="font-medium">{row.press}</TableCell>
                <TableCell className="text-right tabular-nums">{row.overall}</TableCell>
                <TableCell className="text-right tabular-nums">{row.short}</TableCell>
                <TableCell className="text-right tabular-nums">{row.long}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function GoalkeeperSummaryMetricsCard({ title, metrics = [], cardStyle = undefined }) {
  return (
    <Card style={cardStyle}>
      <CardContent className="p-4 space-y-4">
        <div className="text-lg font-semibold text-slate-900">{title}</div>
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {metrics.map((metric) => (
            <div key={metric.label} className="min-w-0 space-y-1">
              <div className="text-sm font-medium uppercase tracking-wide text-slate-500">{metric.label}</div>
              <div className="text-2xl font-semibold leading-none text-slate-900">{metric.value}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function GoalkeeperPressPanel({ card, cardStyle = undefined }) {
  if (!card) return null;
  return (
    <Card style={cardStyle}>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-lg font-semibold text-slate-900">Kickout Press Breakdown</div>
          <div className="text-right text-sm text-slate-600">
            <div className="font-semibold text-slate-900">
              {card.kickoutsTaken ? `${card.ownKickoutsWon}/${card.kickoutsTaken}` : '0/0'}
            </div>
            <div>Own KO Wins</div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableCell className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Press</TableCell>
                <TableCell className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Overall</TableCell>
                <TableCell className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Short</TableCell>
                <TableCell className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Long</TableCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {card.pressRows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="px-3 py-3 font-medium">{row.press}</TableCell>
                  <TableCell className="px-3 py-3 text-right tabular-nums">{row.overall}</TableCell>
                  <TableCell className="px-3 py-3 text-right tabular-nums">{row.short}</TableCell>
                  <TableCell className="px-3 py-3 text-right tabular-nums">{row.long}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function GoalkeeperShotsMap({ shots = [], teamSide = 'home', match = null, onOpenVideoSelection = null, cardStyle = undefined }) {
  const safeShots = Array.isArray(shots) ? shots : [];
  const zoneDepth = 45;
  const visibleDepth = zoneDepth * 0.75;

  return (
    <Card style={cardStyle}>
      <CardContent className="p-4">
        <div className="relative overflow-hidden rounded-lg bg-slate-100" style={{ aspectRatio: `${PITCH_H} / ${visibleDepth}` }}>
          <svg viewBox={`0 0 ${PITCH_H} ${visibleDepth}`} className="relative z-10 h-full w-full">
            <g transform={`translate(${PITCH_H} 0) rotate(90)`}>
              <image
                href={pitchImg}
                x="0"
                y="0"
                width={PITCH_W}
                height={PITCH_H}
                preserveAspectRatio="none"
              />
              {safeShots.map((shot) => {
                const point = horizontalPointForSelectedTeam({
                  stat: shot.raw,
                  rawX: shot.raw?.raw_x_position,
                  rawY: shot.raw?.raw_y_position,
                  x: shot.raw?.x_position,
                  y: shot.raw?.y_position,
                }, teamSide, match);
                if (!point || point.x < 0 || point.x > zoneDepth) return null;
                if (point.x > visibleDepth) return null;
                const tip = [
                  `Shooter: ${shot.shooter || 'NA'}`,
                  `Time: ${shot.timeLabel || 'NA'}`,
                  `Outcome: ${toTitleCase(shot.outcome)}`,
                  Number.isFinite(shot.xp) ? `xP: ${shot.xp.toFixed(2)}` : null,
                ].filter(Boolean).join('\n');
                return (
                  <g
                    key={shot.id}
                    className="cursor-pointer"
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      onOpenVideoSelection?.(safeShots, { sourceLabel: 'Goalkeeper Shots On Goal', selectedId: shot.raw?.id });
                    }}
                  >
                    <circle cx={point.x} cy={point.y} r="1.9" fill="none" stroke="#111827" strokeWidth="0.4" />
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r="1.9"
                      fill={
                        shot.outcome === 'saved'
                          ? '#1d4ed8'
                          : shot.outcome === 'goal'
                            ? '#dc2626'
                            : '#f59e0b'
                      }
                      opacity="0.92"
                    >
                      <title>{tip}</title>
                    </circle>
                    <circle cx={point.x} cy={point.y} r="1.9" fill="none" stroke="#ffffff" strokeWidth="0.55" />
                  </g>
                );
              })}
            </g>
          </svg>
          <PlayerMapOverlay
            title="Shots On Goal"
            arrowText="Attacking ^"
            onOpenVideo={safeShots.length ? () => onOpenVideoSelection?.(safeShots, { sourceLabel: 'Goalkeeper Shots On Goal' }) : null}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function PlayersAnalyticsTabContent({
  stats,
  homeTeam,
  awayTeam,
  playerOptions,
  reportFilters,
  match = null,
  matchupStints = [],
  playerTimeAndPossessionStats: playerTimeAndPossessionStatsProp = null,
  readOnly = false,
  onOpenMatchupEditor = null,
  focusPlayerId = null,
  setFocusPlayerId = null,
  lockPlayerValue = null,
  lockPlayerBucket = null,
  singlePlayerOnly = false,
  playersNavPortalTargetId = '',
  onOpenVideoAt = null,
  onOpenVideoSelection = null,
}) {
  const externalSelectionRef = useRef({ lockPlayerValue: lockPlayerValue || null, focusPlayerId: focusPlayerId || null });
  const scopedReportFilters = useMemo(
    () => ({
      ...reportFilters,
      match: reportFilters?.match || match,
      allowedActionTypes: ['shot', 'pass', 'carry', 'turnover', 'foul', 'kickout', 'throw_in'],
    }),
    [match, reportFilters],
  );
  const [playerBucket, setPlayerBucket] = useState(lockPlayerBucket || 'scoring');
  const [activeMode, setActiveMode] = useState('player-card');
  const [chartPlayerId, setChartPlayerId] = useState(lockPlayerValue || focusPlayerId || 'all');
  const [comparisonSecondPlayerId, setComparisonSecondPlayerId] = useState('all');
  const [comparisonPreset, setComparisonPreset] = useState('overall');
  const [scatterXMetric, setScatterXMetric] = useState('points');
  const [scatterYMetric, setScatterYMetric] = useState('prog_passes');
  const [statMode, setStatMode] = useState('raw');
  const [playerShotPaneFilter, setPlayerShotPaneFilter] = useState('all');
  const [lbSort, setLbSort] = useState({ key: 'points', dir: 'desc' });

  const base = useMemo(() => applyNonTeamReportFilters(stats, scopedReportFilters), [stats, scopedReportFilters]);
  const calcBase = useMemo(() => base.filter((s) => !shouldExcludeFromTotals(s)), [base]);
  const defendingAllowedBase = useMemo(
    () => applyNonTeamReportFilters(stats, { ...scopedReportFilters, playerIds: [] }),
    [stats, scopedReportFilters],
  );
  const defendingAllowedCalcBase = useMemo(
    () => defendingAllowedBase.filter((s) => !shouldExcludeFromTotals(s)),
    [defendingAllowedBase],
  );
  const teamMode = String(reportFilters?.team || 'both');
  const rateModeLabel = getRateModeLabel(reportFilters?.match);
  const rateModeBase = formatModeMinuteBase(reportFilters?.match);
  const playersNavPortalTarget = useMemo(() => {
    if (!playersNavPortalTargetId || typeof document === 'undefined') return null;
    return document.getElementById(playersNavPortalTargetId);
  }, [playersNavPortalTargetId]);
  const playerMapClipSettings = useMemo(() => getVideoClipSettings(reportFilters?.match), [reportFilters?.match]);

  const openPlayerMapVideoSelection = (items, { sourceLabel = 'Player Map', selectedId = null } = {}) => {
    const matchId = reportFilters?.match?.id || '';
    const clips = [];
    for (const item of Array.isArray(items) ? items : []) {
      const stat = item?.raw || item?.stat || item || null;
      const sourceRef = String(stat?.id || item?.id || '');
      const timeS = Number(stat?.time_s ?? stat?.normalized_time_s);
      if (!sourceRef || !Number.isFinite(timeS) || !matchId) continue;
      const clip = createTimestampClipRef({
        matchId,
        timeS,
        label: `${sourceLabel} - ${formatMMSS(timeS)}`,
        sourceRef,
        playId: stat?.play_id,
        possessionId: stat?.possession_id,
        clipSettings: playerMapClipSettings,
      });
      if (clip) clips.push(clip);
    }
    const deduped = Array.from(new Map(clips.map((clip) => [clip.source_ref, clip])).values())
      .sort((a, b) => Number(a.action_time || 0) - Number(b.action_time || 0));
    if (!deduped.length) return;
    const ordered = selectedId
      ? [
          ...deduped.filter((clip) => String(clip.source_ref) === String(selectedId)),
          ...deduped.filter((clip) => String(clip.source_ref) !== String(selectedId)),
        ]
      : deduped;
    if (typeof onOpenVideoSelection === 'function' && ordered.length > 0) {
      onOpenVideoSelection(ordered, { sourceLabel: `${sourceLabel} - ${ordered.length} clips` });
      return;
    }
    const firstTime = Number(ordered[0]?.action_time);
    if (Number.isFinite(firstTime)) onOpenVideoAt?.(firstTime);
  };

  const nextStatById = useMemo(() => {
    const ordered = (Array.isArray(stats) ? stats : []).slice().sort((a, b) => {
      const pa = Number(a?.play_id);
      const pb = Number(b?.play_id);
      if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa - pb;
      const ta = Number(a?.normalized_time_s);
      const tb = Number(b?.normalized_time_s);
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
    const map = new Map();
    for (let i = 0; i < ordered.length; i += 1) map.set(ordered[i]?.id, getNextBallActionStat(ordered, i));
    return map;
  }, [stats]);

  const playerMetaByKey = useMemo(() => {
    const map = new Map();
    for (const p of playerOptions || []) {
      if (p?.id && (p.team_side === 'home' || p.team_side === 'away')) {
        map.set(`${p.team_side}|${p.id}`, p);
      }
    }
    return map;
  }, [playerOptions]);

  const playerMetaByTeamNumber = useMemo(() => {
    const map = new Map();
    for (const p of playerOptions || []) {
      if ((p?.team_side === 'home' || p?.team_side === 'away') && p?.number != null) {
        map.set(`${p.team_side}|${p.number}`, p);
      }
    }
    return map;
  }, [playerOptions]);

  const playerMetaByTeamName = useMemo(() => {
    const map = new Map();
    for (const p of playerOptions || []) {
      const name = String(p?.name || '').trim().toLowerCase();
      if ((p?.team_side === 'home' || p?.team_side === 'away') && name) {
        map.set(`${p.team_side}|${name}`, p);
      }
    }
    return map;
  }, [playerOptions]);

  const resolveLeaderboardPlayer = (sel) => {
    const player = normalizePlayerRef(sel);
    if (!player) return null;
    const direct = playerMetaByKey.get(`${player.team_side}|${player.id}`);
    if (direct) return { ...player, ...direct, id: direct.id, team_side: direct.team_side };
    if (player.number != null) {
      const byNumber = playerMetaByTeamNumber.get(`${player.team_side}|${player.number}`);
      if (byNumber) return { ...player, ...byNumber, id: byNumber.id, team_side: byNumber.team_side };
    }
    const lowered = String(player.name || '').trim().toLowerCase();
    if (lowered) {
      const byName = playerMetaByTeamName.get(`${player.team_side}|${lowered}`);
      if (byName) return { ...player, ...byName, id: byName.id, team_side: byName.team_side };
    }
    return player;
  };

  const resolveLeaderboardKey = (sel) => {
    const player = resolveLeaderboardPlayer(sel);
    return player?.id && (player.team_side === 'home' || player.team_side === 'away')
      ? `${player.team_side}|${player.id}`
      : null;
  };

  const shotAssistCredits = useMemo(() => buildShotAssistCredits(calcBase), [calcBase]);
  const touchEvents = useMemo(() => buildTouchEvents(calcBase, playerOptions), [calcBase, playerOptions]);
  const defendingAllowedTouchEvents = useMemo(
    () => buildTouchEvents(defendingAllowedCalcBase, playerOptions),
    [defendingAllowedCalcBase, playerOptions],
  );
  const defensiveActions = useMemo(() => buildDefensiveActions(calcBase, { match: reportFilters?.match }), [calcBase, reportFilters?.match]);
  const scorableFreeRows = useMemo(() => findScorableFreeConcededRows(calcBase), [calcBase]);
  const playerTimeAndPossessionStats = useMemo(
    () => playerTimeAndPossessionStatsProp || buildPlayerTimeAndPossessionStats({ match: reportFilters?.match, stats, playerOptions, homeTeam, awayTeam }),
    [awayTeam, homeTeam, playerOptions, playerTimeAndPossessionStatsProp, reportFilters?.match, stats],
  );
  const defendingAllowedData = useMemo(
    () => buildDefendingAllowedRows({
      stats: defendingAllowedCalcBase,
      touchEvents: defendingAllowedTouchEvents,
      matchupStints,
      playerOptions,
      reportFilters: { ...scopedReportFilters, playerIds: [] },
      match: scopedReportFilters?.match || match,
    }),
    [defendingAllowedCalcBase, defendingAllowedTouchEvents, matchupStints, playerOptions, scopedReportFilters, match],
  );
  const defendingAllowedByKey = defendingAllowedData?.byKey || new Map();

  const leaderboard = useMemo(() => {
    const rows = new Map();
    const ensure = (sel) => {
      const player = resolveLeaderboardPlayer(sel);
      if (!player) return null;
      const key = `${player.team_side}|${player.id}`;
      const meta = playerMetaByKey.get(key) || {};
      const current = rows.get(key) || {
        key,
        id: player.id,
        player: formatExtraValue({ kind: 'player', ...meta, ...player }),
        team: player.team_side || 'unknown',
        number: meta.number ?? player.number ?? null,
        name: meta.name || player.name || '',
        position: meta.position || player.position || '',
        shots: 0,
        scores: 0,
        points: 0,
        xpTotal: 0,
        xpCount: 0,
        passes: 0,
        passComp: 0,
        carries: 0,
        carryComp: 0,
        turnoversForced: 0,
        turnoversRecovered: 0,
        turnoversWon: 0,
        turnoversLost: 0,
        foulsWon: 0,
        foulsConceded: 0,
        pointAtt: 0,
        pointMade: 0,
        twoAtt: 0,
        twoMade: 0,
        goalAtt: 0,
        goalMade: 0,
        shortShots: 0,
        defActions: 0,
        blocks: 0,
        progPassAtt: 0,
        progPassComp: 0,
        progPassRecv: 0,
        progCarryAtt: 0,
        progCarryComp: 0,
        progMeters: 0,
        scoringZoneEntriesCreated: 0,
        passesIntoScoringZone: 0,
        shotAssists: 0,
        shotsCreated: 0,
        attacksInvolved: 0,
        possessionsInvolved: 0,
        scoringPossessionsInvolved: 0,
        kickoutTargets: 0,
        kickoutWins: 0,
        cleanWon: 0,
        cleanLost: 0,
        breakWon: 0,
        breakLost: 0,
        broken: 0,
        throwInsWon: 0,
        marks: 0,
        touches: 0,
        noCarryPasses: 0,
        avgShotDistTotal: 0,
        avgShotDistCount: 0,
        kickoutsTaken: 0,
        ownKickoutsWon: 0,
        cleanKickoutsWon: 0,
        shortKickoutsTaken: 0,
        longKickoutsTaken: 0,
        shortKickoutsWon: 0,
        longKickoutsWon: 0,
        goalShotsSaved: 0,
        goalShotsAgainst: 0,
        pressBreakdown: {
          m2m: { taken: 0, won: 0, shortTaken: 0, shortWon: 0, longTaken: 0, longWon: 0 },
          zonal: { taken: 0, won: 0, shortTaken: 0, shortWon: 0, longTaken: 0, longWon: 0 },
          conceded: { taken: 0, won: 0, shortTaken: 0, shortWon: 0, longTaken: 0, longWon: 0 },
        },
      };
      rows.set(key, current);
      return current;
    };

    const homeKeeper = getKeeperCandidate(playerOptions, 'home');
    const awayKeeper = getKeeperCandidate(playerOptions, 'away');
    ensure(homeKeeper);
    ensure(awayKeeper);
    for (const matchupRow of defendingAllowedData?.rows || []) {
      ensure({
        id: matchupRow.id,
        team_side: matchupRow.team,
        number: matchupRow.number,
        name: matchupRow.name,
        position: matchupRow.position,
      });
    }
    for (const touch of touchEvents) ensure(touch?.player);
    for (const action of defensiveActions.playerActions) ensure(action?.player);

    const touchPossessionsByPlayer = new Map();
    for (const touch of touchEvents) {
      const row = ensure(touch?.player);
      const playerKey = row?.key || null;
      const teamSide = touch?.stat?.possession_team_side;
      const possessionId = Number(touch?.stat?.possession_id);
      if (!playerKey || (teamSide !== 'home' && teamSide !== 'away') || !Number.isFinite(possessionId)) continue;
      const possessionKey = `${teamSide}-${possessionId}`;
      const set = touchPossessionsByPlayer.get(playerKey) || new Set();
      set.add(possessionKey);
      touchPossessionsByPlayer.set(playerKey, set);
      row.touches += 1;
    }

    for (const s of calcBase) {
      const ex = safeParseJSON(s.extra_data || '{}', {});
      if (s.stat_type === 'shot' && !shouldExcludeFromTotals(s)) {
        const p = ex?.shot?.player || getPrimaryActorSelection(s, ex) || (
          (s?.team_side === 'home' || s?.team_side === 'away') && (s?.player_number || s?.player_name)
            ? {
                kind: 'player',
                id: `legacy:${s.team_side}:${s.player_number ?? 'na'}:${String(s.player_name || '').trim() || 'unknown'}`,
                number: s.player_number ?? null,
                name: s.player_name || '',
                team_side: s.team_side,
              }
            : null
        );
        const row = ensure(p);
        if (row) {
          row.shots += 1;
          const outcome = ex?.shot?.outcome;
          if (shotOutcomeGroup(outcome) === 'score') row.scores += 1;
          row.points += shotPointsForOutcome(outcome);
          const xpRaw = ex?.shot?.xp?.value ?? ex?.shot?.expected_points ?? ex?.shot?.expectedPoints ?? ex?.shot?.xp ?? ex?.shot?.xP ?? null;
          const xp = Number(xpRaw);
          if (Number.isFinite(xp)) {
            row.xpTotal += xp;
            row.xpCount += 1;
          }
          const shotType = normalizePlayerShotType(ex?.shot?.shot_type || ex?.shot?.type || '');
          if (shotType === 'point') row.pointAtt += 1;
          if (shotType === '2_point') row.twoAtt += 1;
          if (shotType === 'goal') row.goalAtt += 1;
          if (outcome === 'point') row.pointMade += 1;
          if (outcome === '2_point') row.twoMade += 1;
          if (outcome === 'goal') row.goalMade += 1;
          if (outcome === 'short') row.shortShots += 1;
          const dist = calcDistanceToGoal(Number(s.x_position), Number(s.y_position));
          if (Number.isFinite(dist)) {
            row.avgShotDistTotal += dist;
            row.avgShotDistCount += 1;
          }
        }
        const blocker = ensure(ex?.shot?.blocked_by);
        if (blocker && String(ex?.shot?.outcome || '') === 'blocked') blocker.blocks += 1;
        const goalShotType = normalizePlayerShotType(ex?.shot?.shot_type || ex?.shot?.type || '') === 'goal';
        if (goalShotType && ['goal', 'saved'].includes(String(ex?.shot?.outcome || ''))) {
          const keeperSide = s.team_side === 'away' ? 'home' : 'away';
          const savedBy = normalizePlayerRef(ex?.shot?.saved_by);
          const keeperRow = ensure(savedBy?.team_side === keeperSide ? savedBy : (keeperSide === 'home' ? homeKeeper : awayKeeper));
          if (keeperRow) {
            if (ex?.shot?.outcome === 'saved') keeperRow.goalShotsSaved += 1;
            if (ex?.shot?.outcome === 'goal') keeperRow.goalShotsAgainst += 1;
          }
        }
      }

      if (s.stat_type === 'pass') {
        const pass = ex?.pass || {};
        const row = ensure(pass?.passer);
        const isProg = isProgressiveShared(s);
        const isCompleted = deriveOutcome(s, ex) === 'completed';
        const gainedMeters = isCompleted ? getProgressiveMeters(s) : 0;
        if (row) {
          row.passes += 1;
          if (isCompleted) row.passComp += 1;
          row.progMeters += gainedMeters;
          if (isProg) {
            row.progPassAtt += 1;
            if (isCompleted) row.progPassComp += 1;
          }
          if (isCompleted && getScoringZoneEntry(s)) {
            row.passesIntoScoringZone += 1;
            row.scoringZoneEntriesCreated += 1;
          }
        }
        if (isProg && isCompleted) {
          const receiver = pass?.won_by?.kind === 'player' ? pass?.won_by : pass?.intended_recipient;
          const receiverRow = ensure(receiver);
          if (receiverRow) receiverRow.progPassRecv += 1;
        }
      }

      if (s.stat_type === 'carry') {
        const row = ensure(ex?.carry?.carrier);
        const isProg = isProgressiveShared(s);
        const isCompleted = deriveOutcome(s, ex) === 'completed';
        const gainedMeters = isCompleted ? getProgressiveMeters(s) : 0;
        if (row) {
          row.carries += 1;
          if (isCompleted) row.carryComp += 1;
          row.progMeters += gainedMeters;
          if (isProg) {
            row.progCarryAtt += 1;
            if (isCompleted) row.progCarryComp += 1;
          }
          if (getScoringZoneEntry(s)) row.scoringZoneEntriesCreated += 1;
        }
      }

      if (!shouldExcludeFromTotals(s) && (s.stat_type === 'turnover' || ex?.turnover)) {
        const turnover = ex?.turnover || {};
        const turnoverType = normalizeFoulType(turnover?.turnover_type || turnover?.type || '');
        const foul = turnoverType === 'foul' ? extractFoulFromStat(s) : null;
        const recovered = turnoverType === 'foul'
          ? ensure(foul?.foul_on || foul?.foul_on_or_forced_by || turnover?.forced_by)
          : ensure(turnover?.recovered_by);
        const forced = ensure(turnover?.forced_by);
        const lost = ensure(turnover?.lost_by);
        const defensivePlayers = new Set();
        if (recovered) {
          recovered.turnoversRecovered += 1;
          defensivePlayers.add(recovered.key);
        }
        if (forced) {
          forced.turnoversForced += 1;
          defensivePlayers.add(forced.key);
        }
        for (const playerKey of defensivePlayers) {
          const row = rows.get(playerKey);
          if (row) {
            row.turnoversWon += 1;
            row.defActions += 1;
          }
        }
        if (lost) lost.turnoversLost += 1;
      }

      const foul = extractFoulFromStat(s);
      if (foul) {
        const won = ensure(foul?.foul_on_or_forced_by);
        const conceded = ensure(foul?.foul_by);
        if (won) won.foulsWon += 1;
        if (conceded) conceded.foulsConceded += 1;
      }

      if (s.stat_type === 'kickout') {
        const kick = ex?.kickout || {};
        const koTeam = kick?.team_side;
        const keeper = ensure(koTeam === 'home' ? homeKeeper : koTeam === 'away' ? awayKeeper : null);
        if (keeper) {
          keeper.kickoutsTaken += 1;
          const won = inferRestartWinnerSide(s, nextStatById.get(s.id)) === koTeam;
          const cleanWon = kick?.outcome === 'clean' && kick?.won_by?.team_side === koTeam;
          if (won) keeper.ownKickoutsWon += 1;
          if (cleanWon) keeper.cleanKickoutsWon += 1;
          const isLong = classifyKickoutLength(s) === 'long';
          const pressKey = ['m2m', 'zonal', 'conceded'].includes(String(kick?.press || '').toLowerCase()) ? String(kick.press).toLowerCase() : null;
          if (isLong) {
            keeper.longKickoutsTaken += 1;
            if (won) keeper.longKickoutsWon += 1;
          } else {
            keeper.shortKickoutsTaken += 1;
            if (won) keeper.shortKickoutsWon += 1;
          }
          if (pressKey && keeper.pressBreakdown?.[pressKey]) {
            keeper.pressBreakdown[pressKey].taken += 1;
            if (won) keeper.pressBreakdown[pressKey].won += 1;
            if (isLong) {
              keeper.pressBreakdown[pressKey].longTaken += 1;
              if (won) keeper.pressBreakdown[pressKey].longWon += 1;
            } else {
              keeper.pressBreakdown[pressKey].shortTaken += 1;
              if (won) keeper.pressBreakdown[pressKey].shortWon += 1;
            }
          }
        }
        const target = ensure(kick?.intended_recipient);
        const wonSide = inferRestartWinnerSide(s, nextStatById.get(s.id));
        const winnerRow = ensure(kick?.won_by);
        const loserRow = ensure(kick?.lost_by);
        const brokenRow = ensure(kick?.broken_by);
        if (target) {
          target.kickoutTargets += 1;
          if (wonSide === koTeam) target.kickoutWins += 1;
        }
        if (kick?.outcome === 'clean') {
          if (winnerRow) winnerRow.cleanWon += 1;
          if (loserRow) loserRow.cleanLost += 1;
          if (kick?.mark && winnerRow) winnerRow.marks += 1;
        }
        if (kick?.outcome === 'break') {
          if (winnerRow) winnerRow.breakWon += 1;
          if (loserRow) loserRow.breakLost += 1;
          if (brokenRow) brokenRow.broken += 1;
        }
      }

      if (s.stat_type === 'throw_in') {
        const won = ensure(ex?.throw_in?.won_by);
        if (won) won.throwInsWon += 1;
      }
    }

    for (const row of shotAssistCredits) {
      const passer = ensure(row.passer);
      if (passer) {
        passer.shotAssists += 1;
        passer.shotsCreated += 1;
      }
    }

    const possessionGroups = groupByPossession(calcBase);
    for (const [key, events] of possessionGroups.entries()) {
      const [teamSide] = String(key).split('-');
      if (teamSide !== 'home' && teamSide !== 'away') continue;
      const acting = events.filter((event) => event && event.team_side === teamSide);
      if (!acting.length) continue;
      const carriedEarlier = new Set();
      for (const event of acting) {
        const extra = safeParseJSON(event.extra_data || '{}', {});
        if (event?.stat_type === 'pass') {
          const passerKey = selectionKey(extra?.pass?.passer);
          if (passerKey && !carriedEarlier.has(passerKey)) {
            const row = rows.get(passerKey);
            if (row) row.noCarryPasses += 1;
          }
        }
        if (event?.stat_type === 'carry') {
          const carrierKey = selectionKey(extra?.carry?.carrier);
          if (carrierKey) carriedEarlier.add(carrierKey);
        }
      }
      const isAttack = isAttackPossession(events, teamSide);
      const outcome = derivePossessionOutcome(events, teamSide);
      for (const [playerKey, possessionKeys] of touchPossessionsByPlayer.entries()) {
        if (!possessionKeys.has(key)) continue;
        const row = rows.get(playerKey);
        if (!row) continue;
        row.possessionsInvolved += 1;
        if (isAttack) row.attacksInvolved += 1;
        if (outcome === 'Score') row.scoringPossessionsInvolved += 1;
      }
    }

    for (const action of defensiveActions.playerActions) {
      if (String(action?.reason || '') === 'Turnover Recovered' || String(action?.reason || '') === 'Turnover Forced') continue;
      const row = ensure(action.player);
      if (row) row.defActions += 1;
    }

    return Array.from(rows.values()).map((row) => {
      const passPct = row.passes ? (row.passComp / row.passes) * 100 : NaN;
      const carryPct = row.carries ? (row.carryComp / row.carries) * 100 : NaN;
      const progPassPct = row.progPassAtt ? (row.progPassComp / row.progPassAtt) * 100 : NaN;
      const turnoversLostPer10Poss = row.possessionsInvolved ? (row.turnoversLost / row.possessionsInvolved) * 10 : NaN;
      const passRate = row.touches ? (row.passes / row.touches) * 100 : NaN;
      const carryRate = row.touches ? (row.carries / row.touches) * 100 : NaN;
      const shootRate = row.touches ? (row.shots / row.touches) * 100 : NaN;
      const noCarryPassRate = row.touches ? (row.noCarryPasses / row.touches) * 100 : NaN;
      const avgShotDist = row.avgShotDistCount ? row.avgShotDistTotal / row.avgShotDistCount : NaN;
      const goalShotSavePct = (row.goalShotsSaved + row.goalShotsAgainst)
        ? (row.goalShotsSaved / (row.goalShotsSaved + row.goalShotsAgainst)) * 100
        : NaN;
      const ownKickoutWinPct = row.kickoutsTaken ? (row.ownKickoutsWon / row.kickoutsTaken) * 100 : NaN;
      const kickoutTargetWinPct = row.kickoutTargets ? (row.kickoutWins / row.kickoutTargets) * 100 : NaN;
      const cleanKickoutWinPct = row.kickoutsTaken ? (row.cleanKickoutsWon / row.kickoutsTaken) * 100 : NaN;
      const shortKickoutWinPct = row.shortKickoutsTaken ? (row.shortKickoutsWon / row.shortKickoutsTaken) * 100 : NaN;
      const longKickoutWinPct = row.longKickoutsTaken ? (row.longKickoutsWon / row.longKickoutsTaken) * 100 : NaN;
      const cleanWinPct = (row.cleanWon + row.cleanLost) ? (row.cleanWon / (row.cleanWon + row.cleanLost)) * 100 : NaN;
      const breakWinPct = (row.breakWon + row.breakLost) ? (row.breakWon / (row.breakWon + row.breakLost)) * 100 : NaN;
      const timeStats = playerTimeAndPossessionStats?.players?.[row.key] || null;
      const defendingAllowed = defendingAllowedByKey.get(row.key) || {};
      return {
        ...row,
        passPct,
        carryPct,
        progPassPct,
        turnoversLostPer10Poss,
        passRate,
        carryRate,
        shootRate,
        noCarryPassRate,
        avgShotDist,
        goalShotSavePct,
        ownKickoutWinPct,
        kickoutTargetWinPct,
        cleanKickoutWinPct,
        shortKickoutWinPct,
        longKickoutWinPct,
        cleanWinPct,
        breakWinPct,
        minutesPlayed: timeStats?.minutesPlayed ?? 0,
        minutesPlayedRawLogged: timeStats?.minutesPlayedRawLogged ?? 0,
        minutesPlayedScaledBeforeCards: timeStats?.minutesPlayedScaledBeforeCards ?? 0,
        blackCards: timeStats?.blackCards ?? 0,
        blackCardMinutesSubtracted: timeStats?.blackCardMinutesSubtracted ?? 0,
        ownPossessionsPlayed: timeStats?.ownPossessionsPlayed ?? 0,
        oppPossessionsPlayed: timeStats?.oppPossessionsPlayed ?? 0,
        totalPossessionsPlayed: timeStats?.totalPossessionsPlayed ?? 0,
        rateMinutesBase: timeStats?.rateMinutesBase ?? rateModeBase,
        minutesRateFactor: timeStats?.minutesRateFactor ?? null,
        ownPossRateFactor10: timeStats?.ownPossRateFactor10 ?? null,
        oppPossRateFactor10: timeStats?.oppPossRateFactor10 ?? null,
        totalPossRateFactor10: timeStats?.totalPossRateFactor10 ?? null,
        started: timeStats?.started ?? false,
        playerTimeConfidence: timeStats?.confidence ?? 'low',
        playerTimeWarnings: Array.isArray(timeStats?.warnings) ? timeStats.warnings : [],
        playerStints: Array.isArray(timeStats?.stints) ? timeStats.stints : [],
        matchupMinutes: Number(defendingAllowed.matchupMinutes) || 0,
        daTouches: Number(defendingAllowed.daTouches) || 0,
        daShots: Number(defendingAllowed.daShots) || 0,
        daPoints: Number(defendingAllowed.daPoints) || 0,
        daXp: Number(defendingAllowed.daXp) || 0,
        daPasses: Number(defendingAllowed.daPasses) || 0,
        daProgPasses: Number(defendingAllowed.daProgPasses) || 0,
        daCarries: Number(defendingAllowed.daCarries) || 0,
        daProgCarries: Number(defendingAllowed.daProgCarries) || 0,
        daProgPassesReceived: Number(defendingAllowed.daProgPassesReceived) || 0,
        daProgMetres: Number(defendingAllowed.daProgMetres) || 0,
        daKickoutsWon: Number(defendingAllowed.daKickoutsWon) || 0,
        daKickoutTotal: Number(defendingAllowed.daKickoutTotal) || 0,
        daKickoutWinPct: Number(defendingAllowed.daKickoutWinPct) || 0,
        daTurnoversLost: Number(defendingAllowed.daTurnoversLost) || 0,
        daFoulsWon: Number(defendingAllowed.daFoulsWon) || 0,
        daStints: Array.isArray(defendingAllowed.daStints) ? defendingAllowed.daStints : [],
      };
    });
  }, [calcBase, defendingAllowedByKey, defendingAllowedData?.rows, defensiveActions.playerActions, nextStatById, playerMetaByKey, playerOptions, playerTimeAndPossessionStats, rateModeBase, shotAssistCredits, touchEvents]);

  const leaderboardByKey = useMemo(() => {
    const map = new Map();
    for (const row of leaderboard || []) map.set(row.key, row);
    return map;
  }, [leaderboard]);

  const chartPlayerOptions = useMemo(
    () => (playerOptions || [])
      .filter((p) => p?.id != null && String(p.id).trim() !== '')
      .filter((p) => teamMode === 'both' || p.team_side === teamMode)
        .map((p) => ({
          ...p,
          value: `${String(p.team_side || '')}|${String(p.id)}`,
          displayLabel: `${String(p.name || p.label || formatExtraValue({ kind: 'player', ...p })).replace(new RegExp(`\\s*#${p.number}\\s*$`), '').trim()}${p.number != null ? ` #${p.number}` : ''} | ${shortTeamLabel(teamLabelForSide(p.team_side, homeTeam, awayTeam))}`,
        }))
      .sort((a, b) => {
        const teamCompare = String(teamLabelForSide(a.team_side, homeTeam, awayTeam)).localeCompare(String(teamLabelForSide(b.team_side, homeTeam, awayTeam)), undefined, { sensitivity: 'base' });
        if (teamCompare !== 0) return teamCompare;
        const aNumber = Number(a.number);
        const bNumber = Number(b.number);
        if (Number.isFinite(aNumber) && Number.isFinite(bNumber) && aNumber !== bNumber) return aNumber - bNumber;
        return String(a.name || a.label || '').localeCompare(String(b.name || b.label || ''), undefined, { numeric: true, sensitivity: 'base' });
      }),
    [playerOptions, teamMode, homeTeam, awayTeam],
  );

  const defaultChartPlayerValue = useMemo(() => {
    if (!chartPlayerOptions.length) return 'all';
    const rankPlayerOptions = (options) => [...options].sort((a, b) => {
      const aRow = leaderboardByKey.get(`${a.team_side}|${a.id}`) || null;
      const bRow = leaderboardByKey.get(`${b.team_side}|${b.id}`) || null;
      const aTouches = Number(aRow?.touches) || 0;
      const bTouches = Number(bRow?.touches) || 0;
      if (bTouches !== aTouches) return bTouches - aTouches;
      const aMinutes = Number(aRow?.minutesPlayed) || 0;
      const bMinutes = Number(bRow?.minutesPlayed) || 0;
      if (bMinutes !== aMinutes) return bMinutes - aMinutes;
      const aNumber = Number(a.number);
      const bNumber = Number(b.number);
        if (Number.isFinite(aNumber) && Number.isFinite(bNumber) && aNumber !== bNumber) return aNumber - bNumber;
        return String(a.name || a.label || '').localeCompare(String(b.name || b.label || ''), undefined, { numeric: true, sensitivity: 'base' });
    });
    const bestHome = rankPlayerOptions(chartPlayerOptions.filter((player) => player.team_side === 'home'))[0];
    const bestAway = rankPlayerOptions(chartPlayerOptions.filter((player) => player.team_side === 'away'))[0];
    const bestOption = bestHome || bestAway || rankPlayerOptions(chartPlayerOptions)[0];
    return bestOption?.value || 'all';
  }, [chartPlayerOptions, leaderboardByKey]);

  const safeChartPlayerValue = useMemo(() => (
    chartPlayerOptions.some((p) => p.value === chartPlayerId) ? chartPlayerId : 'all'
  ), [chartPlayerId, chartPlayerOptions]);

  useEffect(() => {
    if (safeChartPlayerValue !== chartPlayerId) setChartPlayerId(safeChartPlayerValue);
  }, [safeChartPlayerValue, chartPlayerId]);

  useEffect(() => {
    if (lockPlayerBucket && playerBucket !== lockPlayerBucket) setPlayerBucket(lockPlayerBucket);
  }, [lockPlayerBucket, playerBucket]);

  useEffect(() => {
    if (lockPlayerValue && externalSelectionRef.current.lockPlayerValue !== lockPlayerValue) {
      externalSelectionRef.current.lockPlayerValue = lockPlayerValue;
      setChartPlayerId(lockPlayerValue);
    } else if (!lockPlayerValue) {
      externalSelectionRef.current.lockPlayerValue = null;
    }
  }, [lockPlayerValue]);

  useEffect(() => {
    if (!lockPlayerValue && focusPlayerId && externalSelectionRef.current.focusPlayerId !== focusPlayerId) {
      externalSelectionRef.current.focusPlayerId = focusPlayerId;
      setChartPlayerId(focusPlayerId);
    } else if (!focusPlayerId) {
      externalSelectionRef.current.focusPlayerId = null;
    }
  }, [focusPlayerId, lockPlayerValue]);

  useEffect(() => {
    if (chartPlayerId === 'all' && defaultChartPlayerValue !== 'all') setChartPlayerId(defaultChartPlayerValue);
  }, [chartPlayerId, defaultChartPlayerValue]);

  const defaultComparisonSecondValue = useMemo(() => {
    const bestAway = [...chartPlayerOptions]
      .filter((player) => player.team_side === 'away')
      .sort((a, b) => {
        const aRow = leaderboardByKey.get(`${a.team_side}|${a.id}`) || null;
        const bRow = leaderboardByKey.get(`${b.team_side}|${b.id}`) || null;
        const aTouches = Number(aRow?.touches) || 0;
        const bTouches = Number(bRow?.touches) || 0;
        if (bTouches !== aTouches) return bTouches - aTouches;
        const aMinutes = Number(aRow?.minutesPlayed) || 0;
        const bMinutes = Number(bRow?.minutesPlayed) || 0;
        if (bMinutes !== aMinutes) return bMinutes - aMinutes;
        return String(a.name || a.label || '').localeCompare(String(b.name || b.label || ''), undefined, { numeric: true, sensitivity: 'base' });
      })[0];
    if (bestAway?.value && bestAway.value !== safeChartPlayerValue) return bestAway.value;
    const bestHome = [...chartPlayerOptions]
      .filter((player) => player.team_side === 'home' && player.value !== safeChartPlayerValue)
      .sort((a, b) => {
        const aRow = leaderboardByKey.get(`${a.team_side}|${a.id}`) || null;
        const bRow = leaderboardByKey.get(`${b.team_side}|${b.id}`) || null;
        const aTouches = Number(aRow?.touches) || 0;
        const bTouches = Number(bRow?.touches) || 0;
        if (bTouches !== aTouches) return bTouches - aTouches;
        const aMinutes = Number(aRow?.minutesPlayed) || 0;
        const bMinutes = Number(bRow?.minutesPlayed) || 0;
        if (bMinutes !== aMinutes) return bMinutes - aMinutes;
        return String(a.name || a.label || '').localeCompare(String(b.name || b.label || ''), undefined, { numeric: true, sensitivity: 'base' });
      })[0];
    if (bestHome?.value) return bestHome.value;
    const fallback = chartPlayerOptions.find((player) => player.value !== safeChartPlayerValue);
    return fallback?.value || safeChartPlayerValue || 'all';
  }, [chartPlayerOptions, leaderboardByKey, safeChartPlayerValue]);

  useEffect(() => {
    const stillValid = chartPlayerOptions.some((player) => player.value === comparisonSecondPlayerId);
    if (!stillValid || comparisonSecondPlayerId === safeChartPlayerValue) {
      setComparisonSecondPlayerId(defaultComparisonSecondValue);
    }
  }, [chartPlayerOptions, comparisonSecondPlayerId, defaultComparisonSecondValue, safeChartPlayerValue]);

  useEffect(() => {
    if (typeof setFocusPlayerId === 'function' && chartPlayerId !== 'all') setFocusPlayerId(chartPlayerId);
  }, [chartPlayerId, setFocusPlayerId]);

  const activeChartPlayer = useMemo(
    () => chartPlayerOptions.find((player) => player.value === safeChartPlayerValue) || null,
    [chartPlayerOptions, safeChartPlayerValue],
  );

  const selectedPlayerRow = useMemo(
    () => activeChartPlayer ? (leaderboardByKey.get(`${activeChartPlayer.team_side}|${activeChartPlayer.id}`) || null) : null,
    [activeChartPlayer, leaderboardByKey],
  );

  const selectedPlayerKey = selectedPlayerRow?.key || null;
  const selectedPlayerTeamSide = activeChartPlayer?.team_side || selectedPlayerRow?.team_side || selectedPlayerRow?.team || 'home';
  const selectedIsGoalkeeper = selectedPlayerRow ? isGoalkeeperPlayer(selectedPlayerRow) : false;
  const selectedTopRightIsGoalkeeper = selectedIsGoalkeeper || /goalkeeper/i.test(String(selectedPlayerRow?.position || ''));
  const selectedCardTintStyle = useMemo(() => ({
    backgroundColor: '#ffffff',
    borderColor: 'rgb(226, 232, 240)',
  }), []);

  const playerDerivedByKey = useMemo(() => {
    const map = new Map();
    const ensure = (rowKey) => {
      if (!rowKey) return null;
      const current = map.get(rowKey) || {
        passMethods: { left: 0, right: 0, hand: 0, other: 0, total: 0 },
        shotMethods: { left: 0, right: 0, hand: 0, other: 0, total: 0 },
        passTurnovers: 0,
        inaccuratePasses: 0,
        passProgressiveMeters: 0,
        finalThirdProgressivePasses: 0,
        passLengthTotal: 0,
        passLengthCount: 0,
        carryTurnovers: 0,
        carryDistance: 0,
        takeOnAttempts: 0,
        takeOnCompleted: 0,
        highPressureCarries: 0,
        progressiveCarriesInOppThird: 0,
        foulsWonOnCarries: 0,
        carryProgressiveMeters: 0,
        shotsOnGoal: 0,
        passesReceived: 0,
        progressiveReceptionsOppThird: 0,
        receivingZones: { 'Defensive Third': 0, 'Middle Third': 0, 'Attacking Third': 0 },
        highPressureActions: 0,
        scorableFreesWon: 0,
        scorableFreesConceded: 0,
      };
      map.set(rowKey, current);
      return current;
    };

    for (const stat of calcBase) {
      const extra = safeParseJSON(stat.extra_data || '{}', {});
      if (stat.stat_type === 'pass') {
        const passerKey = resolveLeaderboardKey(extra?.pass?.passer);
        const passerInfo = ensure(passerKey);
        if (passerInfo) {
          const method = String(extra?.pass?.method || '').trim().toLowerCase();
          const accuracy = String(extra?.pass?.accuracy || '').trim();
          if (method === 'left' || method === 'right' || method === 'hand') passerInfo.passMethods[method] += 1;
          else passerInfo.passMethods.other += 1;
          passerInfo.passMethods.total += 1;
          if (accuracy === '-' || accuracy === '--') passerInfo.inaccuratePasses += 1;
          if (deriveOutcome(stat, extra) === 'turnover') passerInfo.passTurnovers += 1;
          const outcome = deriveOutcome(stat, extra);
          const start = orientPointForSelectedTeam(
            safeFinite(stat.x_position),
            safeFinite(stat.y_position),
            leaderboardByKey.get(passerKey)?.team || 'home',
          );
          const end = orientPointForSelectedTeam(
            safeFinite(stat.end_x_position) ?? safeFinite(stat.x_position),
            safeFinite(stat.end_y_position) ?? safeFinite(stat.y_position),
            leaderboardByKey.get(passerKey)?.team || 'home',
          );
          if (start && end) {
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const length = Math.sqrt((dx * dx) + (dy * dy));
            if (Number.isFinite(length)) {
              passerInfo.passLengthTotal += length;
              passerInfo.passLengthCount += 1;
            }
          }
          if (outcome === 'completed') {
            const gainedMeters = getProgressiveMeters(stat);
            if (Number.isFinite(gainedMeters)) passerInfo.passProgressiveMeters += gainedMeters;
            if (isProgressiveShared(stat) && start && start.x >= ((2 * PITCH_W) / 3)) {
              passerInfo.finalThirdProgressivePasses += 1;
            }
          }
        }
        const receiverKey = resolveLeaderboardKey(getCompletedReceiptSelection(stat, extra));
        const receiverInfo = ensure(receiverKey);
        if (receiverInfo) {
          receiverInfo.passesReceived += 1;
          const oriented = orientPointForSelectedTeam(
            safeFinite(stat.end_x_position) ?? safeFinite(stat.x_position),
            safeFinite(stat.end_y_position) ?? safeFinite(stat.y_position),
            leaderboardByKey.get(receiverKey)?.team || 'home',
          );
          receiverInfo.receivingZones[classifyOrientedZone(oriented?.x)] += 1;
          if (isProgressiveShared(stat) && oriented && oriented.x >= ((2 * PITCH_W) / 3)) {
            receiverInfo.progressiveReceptionsOppThird += 1;
          }
        }
      }

      if (stat.stat_type === 'carry') {
        const carrierKey = resolveLeaderboardKey(extra?.carry?.carrier);
        const carrierInfo = ensure(carrierKey);
        if (carrierInfo) {
          if (deriveOutcome(stat, extra) === 'turnover') carrierInfo.carryTurnovers += 1;
          const start = orientPointForSelectedTeam(stat.x_position, stat.y_position, leaderboardByKey.get(carrierKey)?.team || 'home');
          const end = orientPointForSelectedTeam(
            safeFinite(stat.end_x_position) ?? safeFinite(stat.x_position),
            safeFinite(stat.end_y_position) ?? safeFinite(stat.y_position),
            leaderboardByKey.get(carrierKey)?.team || 'home',
          );
          if (start && end) {
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            carrierInfo.carryDistance += Math.sqrt((dx * dx) + (dy * dy));
            if (isProgressiveShared(stat) && deriveOutcome(stat, extra) === 'completed' && start.x >= ((2 * PITCH_W) / 3)) {
              carrierInfo.progressiveCarriesInOppThird += 1;
            }
          }
          const takeOn = String(extra?.carry?.take_on || '').trim().toLowerCase();
          if (takeOn === 'completed' || takeOn === 'failed') carrierInfo.takeOnAttempts += 1;
          if (takeOn === 'completed') carrierInfo.takeOnCompleted += 1;
          if (String(extra?.carry?.pressure_on_carrier || '').trim().toLowerCase() === 'high') carrierInfo.highPressureCarries += 1;
          if (String(extra?.carry?.outcome || '').trim().toLowerCase() === 'foul') carrierInfo.foulsWonOnCarries += 1;
          if (deriveOutcome(stat, extra) === 'completed') {
            const gainedMeters = getProgressiveMeters(stat);
            if (Number.isFinite(gainedMeters)) carrierInfo.carryProgressiveMeters += gainedMeters;
          }
        }
      }

      if (stat.stat_type === 'shot') {
        const shooter = extra?.shot?.player || getPrimaryActorSelection(stat, extra);
        const shooterKey = resolveLeaderboardKey(shooter);
        const shooterInfo = ensure(shooterKey);
        if (shooterInfo) {
          const method = normalizeShotMethod(extra?.shot?.method);
          if (method === 'left' || method === 'right' || method === 'hand') shooterInfo.shotMethods[method] += 1;
          else shooterInfo.shotMethods.other += 1;
          shooterInfo.shotMethods.total += 1;
          if (['goal', 'saved', 'blocked'].includes(String(extra?.shot?.outcome || ''))) shooterInfo.shotsOnGoal += 1;
        }
      }
    }

    for (const action of defensiveActions.playerActions) {
      const rowKey = resolveLeaderboardKey(action?.player);
      const info = ensure(rowKey);
      if (!info) continue;
      if (String(action?.reason || '').toLowerCase().includes('pressure')) info.highPressureActions += 1;
    }

    for (const row of scorableFreeRows) {
      const foul = extractFoulFromStat(row?.foulStat);
      const wonKey = resolveLeaderboardKey(foul?.foul_on || foul?.foul_on_or_forced_by);
      const wonInfo = ensure(wonKey);
      if (wonInfo) wonInfo.scorableFreesWon += 1;
      const concedingKey = resolveLeaderboardKey(foul?.foul_by);
      const info = ensure(concedingKey);
      if (info) info.scorableFreesConceded += 1;
    }

    return map;
  }, [calcBase, defensiveActions.playerActions, leaderboardByKey, scorableFreeRows]);

  const comparisonPoolEntries = useMemo(() => (
    chartPlayerOptions
      .map((option) => {
        const row = leaderboardByKey.get(`${option.team_side}|${option.id}`) || null;
        if (!row) return null;
        return {
          option,
          row,
          derived: playerDerivedByKey.get(row.key) || {},
          teamLabel: teamLabelForSide(row.team, homeTeam, awayTeam),
          shortLabel: comparisonPlayerShortLabel({ option, row }),
          isGoalkeeper: isGoalkeeperPlayer(row),
        };
      })
      .filter(Boolean)
  ), [awayTeam, chartPlayerOptions, homeTeam, leaderboardByKey, playerDerivedByKey]);

  const comparisonPrimaryEntry = useMemo(
    () => comparisonPoolEntries.find((entry) => entry.option.value === safeChartPlayerValue) || null,
    [comparisonPoolEntries, safeChartPlayerValue],
  );

  const comparisonSecondaryEntry = useMemo(
    () => comparisonPoolEntries.find((entry) => entry.option.value === comparisonSecondPlayerId) || null,
    [comparisonPoolEntries, comparisonSecondPlayerId],
  );

  const bothComparisonPlayersAreGoalkeepers = Boolean(comparisonPrimaryEntry?.isGoalkeeper && comparisonSecondaryEntry?.isGoalkeeper);

  useEffect(() => {
    if (comparisonPreset === 'goalkeeping' && !bothComparisonPlayersAreGoalkeepers) {
      setComparisonPreset('overall');
    }
  }, [bothComparisonPlayersAreGoalkeepers, comparisonPreset]);

  const playerRoleByKey = useMemo(() => {
    const byTeam = {
      home: leaderboard.filter((row) => row.team === 'home'),
      away: leaderboard.filter((row) => row.team === 'away'),
    };
    const out = new Map();

    for (const row of leaderboard) {
      const positionText = String(row.position || '').toLowerCase();
      if (isGoalkeeperPlayer(row) || positionText.includes('goalkeeper') || positionText === 'gk') {
        out.set(row.key, {
          label: 'Goalkeeper',
          summary: [
            { label: 'Restart Base', value: `${row.kickoutsTaken || 0} kickouts taken` },
            { label: 'Retention', value: row.kickoutsTaken ? `${row.ownKickoutsWon}/${row.kickoutsTaken} own KO wins` : 'No kickouts logged' },
            { label: 'Shot Stopping', value: (row.goalShotsSaved + row.goalShotsAgainst) ? `${row.goalShotsSaved} saved, ${row.goalShotsAgainst} conceded` : 'No goal shots faced' },
          ],
        });
        continue;
      }

      const teamRows = byTeam[row.team] || [];
      const shootingScore = rankWithinTeam(row, teamRows, (candidate) => scalePlayerCount(candidate, candidate.shots, 'rate') + (candidate.points * 0.8));
      const defenseScore = rankWithinTeam(row, teamRows, (candidate) => scalePlayerCount(candidate, candidate.defActions + candidate.turnoversWon + (candidate.blocks * 1.25), 'rate'));
      const progressionScore = rankWithinTeam(row, teamRows, (candidate) => scalePlayerCount(candidate, candidate.progPassComp + candidate.progCarryComp, 'rate') + ((candidate.progMeters || 0) / 20));
      const creatorScore = rankWithinTeam(row, teamRows, (candidate) => scalePlayerCount(candidate, candidate.shotAssists + candidate.scoringZoneEntriesCreated + candidate.passesIntoScoringZone, 'rate'));
      const kickoutTargetScore = rankWithinTeam(row, teamRows, (candidate) => scalePlayerCount(candidate, candidate.kickoutTargets + candidate.cleanWon + candidate.breakWon + (candidate.marks * 0.5), 'rate'));
      const broadContributionCount = [shootingScore, defenseScore, progressionScore, creatorScore, kickoutTargetScore].filter((value) => value >= 0.55).length;

      // Keep this heuristic simple and inspectable so the team can tune it later without untangling a black-box model.
      let label = 'All Action';
      if (broadContributionCount >= 4 && scalePlayerCount(row, row.touches, 'rate') >= 12) label = 'All Action';
      else if ((positionText.includes('back') || positionText.includes('def')) && defenseScore >= 0.55) label = 'Back';
      else if (kickoutTargetScore >= Math.max(shootingScore, defenseScore, progressionScore, creatorScore) && kickoutTargetScore >= 0.45) label = 'Kickout Target';
      else if (shootingScore >= Math.max(defenseScore, progressionScore, creatorScore) && shootingScore >= 0.52) label = 'Finisher';
      else if (creatorScore >= Math.max(shootingScore, defenseScore, progressionScore) && creatorScore >= 0.48) label = 'Creator';
      else if (progressionScore >= Math.max(shootingScore, defenseScore, creatorScore) && progressionScore >= 0.48) label = 'Progressor';
      else if (defenseScore >= 0.45) label = 'Back';

      out.set(row.key, {
        label,
        summary: [
          { label: 'Touches', value: `${Math.round(scalePlayerCount(row, row.touches, 'rate'))} ${rateModeLabel.toLowerCase()}` },
          { label: 'Progression', value: `${Math.round(scalePlayerCount(row, row.progPassComp + row.progCarryComp, 'rate'))} progressive actions` },
          { label: 'Defence', value: `${Math.round(scalePlayerCount(row, row.defActions, 'rate'))} defensive actions` },
        ],
      });
    }
    return out;
  }, [leaderboard, rateModeLabel]);

  const defendingAllowedTableColumns = useMemo(() => ([
    { key: 'player', label: 'Player', render: (row) => buildPlayerDisplayTitle(row) },
    { key: 'team', label: 'Team', render: (row) => teamLabelForSide(row.team, homeTeam, awayTeam) },
    { key: 'matchupMinutes', label: 'Matchup Mins', numeric: true, render: (row) => formatMetricValue(row.matchupMinutes, { decimals: 1 }) },
    { key: 'daTouches', label: 'Touches', numeric: true, render: (row) => formatMatchupMetricValue(row, row.daTouches, statMode, { decimals: 0 }) },
    { key: 'daShots', label: 'Shots', numeric: true, render: (row) => formatMatchupMetricValue(row, row.daShots, statMode, { decimals: 0 }) },
    { key: 'daPoints', label: 'Points', numeric: true, render: (row) => formatMatchupMetricValue(row, row.daPoints, statMode, { decimals: 0 }) },
    { key: 'daXp', label: 'xP', numeric: true, render: (row) => formatMatchupMetricValue(row, row.daXp, statMode, { decimals: 2 }) },
    { key: 'daPasses', label: 'Passes', numeric: true, render: (row) => formatMatchupMetricValue(row, row.daPasses, statMode, { decimals: 0 }) },
    { key: 'daProgPasses', label: 'Prog Passes', numeric: true, render: (row) => formatMatchupMetricValue(row, row.daProgPasses, statMode, { decimals: 0 }) },
    { key: 'daCarries', label: 'Carries', numeric: true, render: (row) => formatMatchupMetricValue(row, row.daCarries, statMode, { decimals: 0 }) },
    { key: 'daProgCarries', label: 'Prog Carries', numeric: true, render: (row) => formatMatchupMetricValue(row, row.daProgCarries, statMode, { decimals: 0 }) },
    { key: 'daProgPassesReceived', label: 'Prog Pass Rec', numeric: true, render: (row) => formatMatchupMetricValue(row, row.daProgPassesReceived, statMode, { decimals: 0 }) },
    { key: 'daProgMetres', label: 'Prog Metres', numeric: true, render: (row) => formatMatchupMetricValue(row, row.daProgMetres, statMode, { decimals: 1, suffix: 'm' }) },
    {
      key: 'daKickoutWinPct',
      label: 'Kickouts Won',
      numeric: true,
      sortValue: (row) => Number(row.daKickoutWinPct) || 0,
      render: (row) => row.daKickoutTotal ? `${Math.round(Number(row.daKickoutsWon) || 0)}/${Math.round(Number(row.daKickoutTotal) || 0)} (${formatPct(row.daKickoutWinPct)})` : '0/0 (NA)',
    },
    { key: 'daTurnoversLost', label: 'TO Lost', numeric: true, render: (row) => formatMatchupMetricValue(row, row.daTurnoversLost, statMode, { decimals: 0 }) },
    { key: 'daFoulsWon', label: 'Fouls Won', numeric: true, render: (row) => formatMatchupMetricValue(row, row.daFoulsWon, statMode, { decimals: 0 }) },
    ...(!readOnly && typeof onOpenMatchupEditor === 'function' ? [{
      key: 'actions',
      label: 'Actions',
      render: (row) => (
        <Button type="button" variant="outline" size="sm" onClick={() => onOpenMatchupEditor(row.key)}>
          Edit
        </Button>
      ),
    }] : []),
  ]), [awayTeam, homeTeam, onOpenMatchupEditor, readOnly, statMode]);

  const sortedLeaderboard = useMemo(() => {
    const bucketFilters = {
      scoring: () => true,
      passing: () => true,
      carrying: () => true,
      progression: () => true,
      defending: () => true,
      defending_allowed: () => true,
      restarts: () => true,
      goalkeepers: (row) => isGoalkeeperPlayer(row),
    };
    const list = (Array.isArray(leaderboard) ? leaderboard : [])
      .filter((row) => teamMode === 'both' || row.team === teamMode)
      .filter((row) => !singlePlayerOnly || !lockPlayerValue || row.key === lockPlayerValue)
      .filter(bucketFilters[playerBucket] || (() => true))
      .slice();
    const dir = lbSort?.dir === 'asc' ? 1 : -1;
    const key = String(lbSort?.key || 'points');
    const currentColumns = bucketColumnsBuilder({
      homeTeam,
      awayTeam,
      derivedByKey: playerDerivedByKey,
      statMode,
      renderPlayerCell: (row) => row.player,
      renderScoringFraction: (made, attempts) => {
        const madeN = Number(made) || 0;
        const attemptsN = Number(attempts) || 0;
        if (!Number.isFinite(attemptsN) || attemptsN <= 0) return `${madeN}/0 (NA)`;
        return `${madeN}/${attemptsN} (${formatPct((madeN / attemptsN) * 100)})`;
      },
    });
    const columns = playerBucket === 'defending_allowed'
      ? defendingAllowedTableColumns
      : (currentColumns[playerBucket] || currentColumns.scoring);
    const sortColumn = columns.find((column) => column.key === key);
    const getSortValue = (row) => {
      if (!row) return 0;
      if (typeof sortColumn?.sortValue === 'function') {
        const custom = sortColumn.sortValue(row);
        return typeof custom === 'number' && Number.isFinite(custom) ? custom : -Infinity;
      }
      const value = row[key];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      return -Infinity;
    };
    list.sort((a, b) => (getSortValue(a) - getSortValue(b)) * dir || String(a?.player || '').localeCompare(String(b?.player || '')));
    return list;
  }, [awayTeam, defendingAllowedTableColumns, homeTeam, leaderboard, lbSort, lockPlayerValue, playerBucket, playerDerivedByKey, singlePlayerOnly, statMode, teamMode]);

  const currentColumns = useMemo(() => {
    const renderScoringFraction = (made, attempts) => {
      const madeN = Number(made) || 0;
      const attemptsN = Number(attempts) || 0;
      if (!Number.isFinite(attemptsN) || attemptsN <= 0) return `${madeN}/0 (NA)`;
      return `${madeN}/${attemptsN} (${formatPct((madeN / attemptsN) * 100)})`;
    };

    return bucketColumnsBuilder({
      homeTeam,
      awayTeam,
      derivedByKey: playerDerivedByKey,
      statMode,
      renderPlayerCell: (row) => buildPlayerDisplayTitle(row),
      renderScoringFraction,
      readOnly,
      onOpenMatchupEditor,
    });
  }, [awayTeam, homeTeam, onOpenMatchupEditor, playerDerivedByKey, readOnly, statMode]);

  useEffect(() => {
    const defaults = {
      scoring: 'points',
      passing: 'passComp',
      carrying: 'carryComp',
      progression: 'progMeters',
      defending: 'defActions',
      defending_allowed: 'matchupMinutes',
      restarts: 'kickoutWins',
      goalkeepers: 'kickoutsTaken',
    };
    const nextKey = defaults[playerBucket] || 'points';
    const columns = playerBucket === 'defending_allowed'
      ? defendingAllowedTableColumns
      : (currentColumns[playerBucket] || []);
    if (!columns.some((column) => column.key === lbSort.key)) {
      setLbSort({ key: nextKey, dir: 'desc' });
    }
  }, [playerBucket, currentColumns, defendingAllowedTableColumns, lbSort.key]);

  const matchesPlayerOption = (selection, playerOption) => {
    if (!playerOption) return false;
    const candidate = resolveLeaderboardPlayer(selection);
    if (!candidate) return false;
    if (candidate.team_side !== playerOption.team_side) return false;
    if (candidate.id != null && playerOption.id != null && String(candidate.id) === String(playerOption.id)) return true;
    if (candidate.number != null && playerOption.number != null && String(candidate.number) === String(playerOption.number)) return true;
    const candidateName = String(candidate.name || '').trim().toLowerCase();
    const playerName = String(playerOption.name || '').trim().toLowerCase();
    return Boolean(candidateName && playerName && candidateName === playerName);
  };

  const selectedPlayerPassStats = useMemo(() => (
    activeChartPlayer
      ? calcBase.filter((stat) => {
          if (stat?.stat_type !== 'pass') return false;
          const extra = safeParseJSON(stat.extra_data || '{}', {});
          return matchesPlayerOption(extra?.pass?.passer, activeChartPlayer);
        })
      : []
  ), [activeChartPlayer, calcBase]);

  const selectedPlayerCarryStats = useMemo(() => (
    activeChartPlayer
      ? calcBase.filter((stat) => {
          if (stat?.stat_type !== 'carry') return false;
          const extra = safeParseJSON(stat.extra_data || '{}', {});
          return matchesPlayerOption(extra?.carry?.carrier, activeChartPlayer);
        })
      : []
  ), [activeChartPlayer, calcBase]);

  const selectedPlayerShotStats = useMemo(() => (
    activeChartPlayer
      ? calcBase.filter((stat) => {
          if (stat?.stat_type !== 'shot') return false;
          const extra = safeParseJSON(stat.extra_data || '{}', {});
          return matchesPlayerOption(extra?.shot?.player || getPrimaryActorSelection(stat, extra), activeChartPlayer);
        })
      : []
  ), [activeChartPlayer, calcBase]);

  const selectedPlayerReceptionStats = useMemo(() => (
    activeChartPlayer
      ? calcBase.filter((stat) => {
          if (stat?.stat_type !== 'pass') return false;
          const extra = safeParseJSON(stat.extra_data || '{}', {});
          if (deriveOutcome(stat, extra) !== 'completed') return false;
          return matchesPlayerOption(getCompletedReceiptSelection(stat, extra), activeChartPlayer);
        })
      : []
  ), [activeChartPlayer, calcBase]);

  const selectedPlayerRestartStats = useMemo(() => (
    activeChartPlayer
      ? calcBase.filter((stat) => {
          if (!['kickout', 'throw_in'].includes(String(stat?.stat_type || ''))) return false;
          const extra = safeParseJSON(stat.extra_data || '{}', {});
          const restart = stat.stat_type === 'kickout' ? extra?.kickout : extra?.throw_in;
          return [
            restart?.intended_recipient,
            restart?.won_by,
            restart?.lost_by,
            restart?.broken_by,
            getPrimaryActorSelection(stat, extra),
          ].some((selection) => matchesPlayerOption(selection, activeChartPlayer));
        })
      : []
  ), [activeChartPlayer, calcBase]);

  const selectedPlayerDefensiveActions = useMemo(() => (
    activeChartPlayer
      ? defensiveActions.playerActions.filter((action) => matchesPlayerOption(action?.player, activeChartPlayer))
      : []
  ), [activeChartPlayer, defensiveActions.playerActions]);

  const selectedPlayerCardCounts = useMemo(() => {
    const empty = { yellow: 0, black: 0, red: 0 };
    if (!activeChartPlayer) return empty;
    return calcBase.reduce((acc, stat) => {
      const foul = extractFoulFromStat(stat);
      if (!foul || !matchesPlayerOption(foul?.foul_by, activeChartPlayer)) return acc;
      const card = String(foul?.card || stat?.card || '').trim().toLowerCase();
      if (card === 'yellow') acc.yellow += 1;
      if (card === 'black') acc.black += 1;
      if (card === 'red') acc.red += 1;
      return acc;
    }, { yellow: 0, black: 0, red: 0 });
  }, [activeChartPlayer, calcBase]);

  const selectedPlayerHeatmapPoints = useMemo(() => {
    if (!activeChartPlayer) return [];
    const points = [];
    const addPoint = (stat, rawX, rawY, x, y, key) => {
      const xx = safeFinite(x);
      const yy = safeFinite(y);
      const rawXX = safeFinite(rawX);
      const rawYY = safeFinite(rawY);
      if (!Number.isFinite(xx) || !Number.isFinite(yy)) {
        if (!Number.isFinite(rawXX) || !Number.isFinite(rawYY)) return;
      }
      points.push({ stat, rawX: rawXX, rawY: rawYY, x: xx, y: yy, key });
    };

    for (const stat of selectedPlayerPassStats) addPoint(stat, stat.raw_x_position, stat.raw_y_position, stat.x_position, stat.y_position, `pass:${stat.id}:start`);
    for (const stat of selectedPlayerCarryStats) addPoint(stat, stat.raw_x_position, stat.raw_y_position, stat.x_position, stat.y_position, `carry:${stat.id}:start`);
    for (const stat of selectedPlayerShotStats) addPoint(stat, stat.raw_x_position, stat.raw_y_position, stat.x_position, stat.y_position, `shot:${stat.id}:start`);
    for (const stat of selectedPlayerRestartStats) {
      addPoint(
        stat,
        safeFinite(stat.raw_end_x_position) ?? safeFinite(stat.raw_x_position),
        safeFinite(stat.raw_end_y_position) ?? safeFinite(stat.raw_y_position),
        safeFinite(stat.end_x_position) ?? safeFinite(stat.x_position),
        safeFinite(stat.end_y_position) ?? safeFinite(stat.y_position),
        `restart:${stat.id}:end`,
      );
    }
    for (const stat of selectedPlayerReceptionStats) {
      addPoint(
        stat,
        safeFinite(stat.raw_end_x_position) ?? safeFinite(stat.raw_x_position),
        safeFinite(stat.raw_end_y_position) ?? safeFinite(stat.raw_y_position),
        safeFinite(stat.end_x_position) ?? safeFinite(stat.x_position),
        safeFinite(stat.end_y_position) ?? safeFinite(stat.y_position),
        `reception:${stat.id}`,
      );
    }
    for (const action of selectedPlayerDefensiveActions) addPoint(action.stat || null, action.stat?.raw_x_position, action.stat?.raw_y_position, action.x, action.y, `defence:${action.key}`);
    for (const touch of touchEvents.filter((event) => matchesPlayerOption(event?.player, activeChartPlayer))) {
      addPoint(touch.stat || null, touch.stat?.raw_x_position, touch.stat?.raw_y_position, touch.x, touch.y, `touch:${touch.key}`);
    }

    const unique = new Map();
    for (const point of points) {
      unique.set(point.key, point);
    }
    return Array.from(unique.values());
  }, [
    activeChartPlayer,
    selectedPlayerPassStats,
    selectedPlayerCarryStats,
    selectedPlayerShotStats,
    selectedPlayerRestartStats,
    selectedPlayerReceptionStats,
    selectedPlayerDefensiveActions,
    touchEvents,
  ]);

  const selectedPlayerDerived = useMemo(() => (
    selectedPlayerKey ? (playerDerivedByKey.get(selectedPlayerKey) || null) : null
  ), [playerDerivedByKey, selectedPlayerKey]);

  const selectedPlayerScorableFreesWon = useMemo(() => {
    if (!activeChartPlayer) return 0;
    return scorableFreeRows.reduce((count, row) => {
      const foul = extractFoulFromStat(row?.foulStat);
      return matchesPlayerOption(foul?.foul_on || foul?.foul_on_or_forced_by, activeChartPlayer) ? count + 1 : count;
    }, 0);
  }, [activeChartPlayer, scorableFreeRows]);

  const selectedPlayerDefendingAllowedTouchSummary = useMemo(() => {
    const safeStints = Array.isArray(selectedPlayerRow?.daStints) ? selectedPlayerRow.daStints : [];
    if (!safeStints.length) return { points: [], finalThirdTouches: 0 };

    const stintMap = new Map();
    for (const stint of safeStints) {
      const attackerKey = String(stint?.attackerKey || '');
      const periodKey = String(stint?.periodKey || '');
      if (!attackerKey || !periodKey) continue;
      const bucketKey = `${periodKey}|${attackerKey}`;
      const bucket = stintMap.get(bucketKey) || [];
      bucket.push({
        startTimeS: Number(stint?.clippedStartTimeS),
        endTimeS: Number(stint?.clippedEndTimeS),
      });
      stintMap.set(bucketKey, bucket);
    }

    const points = [];
    const selectedPlayerLabel = buildPlayerDisplayTitle(selectedPlayerRow);

    for (const touch of Array.isArray(defendingAllowedTouchEvents) ? defendingAllowedTouchEvents : []) {
      const attackerKey = selectionKey(touch?.player);
      const periodKey = String(touch?.stat?.half || '');
      const timeS = Number(touch?.stat?.normalized_time_s);
      if (!attackerKey || !periodKey || !Number.isFinite(timeS)) continue;
      const windows = stintMap.get(`${periodKey}|${attackerKey}`) || [];
      if (!windows.some((window) => timeS >= window.startTimeS && timeS <= window.endTimeS)) continue;

      const reason = String(touch?.reason || 'Touch');
      const matchupLabel = selectionTooltipLabel(touch?.player).replace(/\s+\((Home|Away)\)\s*$/i, '') || 'Unknown matchup';
      const loweredReason = reason.toLowerCase();
      const color = loweredReason.includes('kickout')
        ? '#1d4ed8'
        : loweredReason.includes('turnover')
          ? '#f59e0b'
          : loweredReason.includes('shot')
            ? '#dc2626'
            : '#2563eb';
      const timeLabel = Number.isFinite(Number(touch?.stat?.normalized_time_s))
        ? formatMMSS(Number(touch.stat.normalized_time_s))
        : Number.isFinite(Number(touch?.stat?.time_s))
          ? formatMMSS(Number(touch.stat.time_s))
          : 'NA';

      points.push({
        id: `defending-allowed-touch:${touch.key || touch?.stat?.id || `${attackerKey}:${periodKey}:${timeS}`}`,
        raw: touch.stat,
        rawX: touch?.stat?.raw_x_position,
        rawY: touch?.stat?.raw_y_position,
        x: touch?.x,
        y: touch?.y,
        teamSide: touch?.player?.team_side || selectedPlayerTeamSide,
        color,
        tooltip: [
          `Defender: ${selectedPlayerLabel || 'NA'}`,
          `Attacker: ${matchupLabel}`,
          `Time: ${timeLabel}`,
          `Touch Allowed: ${reason}`,
          Number.isFinite(Number(touch?.stat?.possession_id)) ? `Possession: ${Number(touch.stat.possession_id)}` : null,
        ].filter(Boolean).join('\n'),
      });
    }

    const unique = new Map();
    for (const point of points) unique.set(point.id, point);
    const dedupedPoints = Array.from(unique.values());
    const finalThirdTouches = dedupedPoints.reduce((count, point) => {
      const oriented = horizontalPointForSelectedTeam(point, point?.teamSide || selectedPlayerTeamSide, reportFilters?.match);
      return oriented && oriented.x >= ((2 * PITCH_W) / 3) ? count + 1 : count;
    }, 0);
    return { points: dedupedPoints, finalThirdTouches };
  }, [defendingAllowedTouchEvents, reportFilters?.match, selectedPlayerRow, selectedPlayerTeamSide]);

  const selectedGoalkeeperShotsOnGoal = useMemo(() => {
    if (!selectedIsGoalkeeper || !selectedPlayerRow) return [];
    return calcBase
      .filter((stat) => {
        if (stat?.stat_type !== 'shot') return false;
        const extra = safeParseJSON(stat?.extra_data || '{}', {});
        const shot = extra?.shot || {};
        const isGoalShot = normalizePlayerShotType(shot?.shot_type || shot?.type || '') === 'goal';
        if (!isGoalShot) return false;
        const keeperSide = stat?.team_side === 'away' ? 'home' : 'away';
        return keeperSide === selectedPlayerTeamSide;
      })
      .map((stat) => {
        const extra = safeParseJSON(stat?.extra_data || '{}', {});
        const shot = extra?.shot || {};
        const xpRaw = shot?.xp?.value ?? shot?.expected_points ?? shot?.expectedPoints ?? shot?.xp ?? shot?.xP ?? null;
        const xp = Number(xpRaw);
        return {
          id: `goalkeeper-shot-on-goal-${stat.id}`,
          raw: stat,
          outcome: String(shot?.outcome || '').toLowerCase(),
          xp,
          shooter: formatExtraValue(shot?.player),
          timeLabel: Number.isFinite(Number(stat?.normalized_time_s))
            ? formatMMSS(Number(stat.normalized_time_s))
            : Number.isFinite(Number(stat?.time_s))
              ? formatMMSS(Number(stat.time_s))
              : 'NA',
        };
      });
  }, [calcBase, selectedIsGoalkeeper, selectedPlayerRow, selectedPlayerTeamSide]);

  const goalkeeperPressCards = useMemo(() => {
    const sourceRows = (leaderboard || []).filter((row) => isGoalkeeperPlayer(row));
    return sourceRows
      .map((row) => {
        const pressRows = ['m2m', 'zonal', 'conceded']
          .map((press) => {
            const info = row.pressBreakdown?.[press];
            if (!info) return null;
            return {
              key: `${row.key}-${press}`,
              press: press === 'm2m' ? 'M2M' : press.charAt(0).toUpperCase() + press.slice(1),
              overall: info.taken ? `${info.won}/${info.taken} (${formatPct((info.won / info.taken) * 100)})` : 'NA',
              short: info.shortTaken ? `${info.shortWon}/${info.shortTaken} (${formatPct((info.shortWon / info.shortTaken) * 100)})` : 'NA',
              long: info.longTaken ? `${info.longWon}/${info.longTaken} (${formatPct((info.longWon / info.longTaken) * 100)})` : 'NA',
            };
          })
          .filter(Boolean);
        if (!pressRows.length) return null;
        return {
          key: row.key,
          player: row.player,
          team: row.team,
          ownKickoutsWon: row.ownKickoutsWon,
          kickoutsTaken: row.kickoutsTaken,
          pressRows,
        };
      })
      .filter(Boolean);
  }, [leaderboard]);

  const selectedGoalkeeperPressCard = useMemo(
    () => goalkeeperPressCards.find((card) => card.key === selectedPlayerRow?.key) || null,
    [goalkeeperPressCards, selectedPlayerRow?.key],
  );

  const goalkeeperKickoutItems = useMemo(() => {
    try {
      if (!selectedPlayerRow || !selectedTopRightIsGoalkeeper) return [];

      const allKickouts = calcBase.filter((stat) => stat?.stat_type === 'kickout');
      const directKickouts = allKickouts.filter((stat) => {
        const extra = safeParseJSON(stat.extra_data || '{}', {});
        const kick = extra?.kickout;
        return matchesPlayerOption(getPrimaryActorSelection(stat, extra), activeChartPlayer)
          || matchesPlayerOption(kick?.won_by, activeChartPlayer)
          || matchesPlayerOption(kick?.intended_recipient, activeChartPlayer);
      });

      const sourceKickouts = directKickouts.length
        ? directKickouts
        : allKickouts.filter((stat) => {
            const extra = safeParseJSON(stat.extra_data || '{}', {});
            const restartSide = inferRestartTeamSide(stat, extra) || stat?.team_side;
            return restartSide === selectedPlayerTeamSide;
          });

      return sourceKickouts.map((stat) => {
        const won = inferRestartWinnerSide(stat, nextStatById.get(stat.id)) === selectedPlayerTeamSide;
        return {
          id: `top-keeper-ko-${stat.id}`,
          kind: 'line',
          start: { x: stat.x_position, y: stat.y_position },
          end: {
            x: safeFinite(stat.end_x_position) ?? safeFinite(stat.x_position),
            y: safeFinite(stat.end_y_position) ?? safeFinite(stat.y_position),
          },
          color: won ? KEEPER_KICKOUT_POSITIVE_COLOR : KEEPER_KICKOUT_NEGATIVE_COLOR,
          strokeWidth: 1.15,
          endRadius: 1.15,
          opacity: 0.95,
        };
      });
    } catch {
      return [];
    }
  }, [activeChartPlayer, calcBase, nextStatById, selectedPlayerRow, selectedPlayerTeamSide, selectedTopRightIsGoalkeeper]);

  const selectedPlayerKickoutMapItems = useMemo(() => {
    try {
      if (!selectedPlayerRow || !activeChartPlayer || selectedIsGoalkeeper) return [];

      return calcBase
        .filter((stat) => stat?.stat_type === 'kickout')
        .map((stat) => {
          const extra = safeParseJSON(stat.extra_data || '{}', {});
          const kick = extra?.kickout || {};
          const takerMatch = matchesPlayerOption(getPrimaryActorSelection(stat, extra), activeChartPlayer);
          const targetMatch = matchesPlayerOption(kick?.intended_recipient, activeChartPlayer);
          const cleanWonMatch = matchesPlayerOption(kick?.won_by, activeChartPlayer);
          const cleanLostMatch = matchesPlayerOption(kick?.lost_by, activeChartPlayer);
          const brokenMatch = matchesPlayerOption(kick?.broken_by, activeChartPlayer);

          if (!takerMatch && !targetMatch && !cleanWonMatch && !cleanLostMatch && !brokenMatch) return null;

          const wonSide = inferRestartWinnerSide(stat, nextStatById.get(stat.id));
          const kickTeamSide = kick?.team_side || stat?.team_side || selectedPlayerTeamSide;
          const teamWon = wonSide === selectedPlayerTeamSide;
          const playerRole = [
            takerMatch ? 'Taker' : null,
            targetMatch ? 'Target' : null,
            cleanWonMatch ? 'Clean Won' : null,
            cleanLostMatch ? 'Clean Lost' : null,
            brokenMatch ? 'Broken' : null,
          ].filter(Boolean).join(', ');

          const lineColor = kickTeamSide === 'away'
            ? (awayTeam?.color || '#ef4444')
            : (homeTeam?.color || '#22c55e');
          const outcomeUsesWinLoss = ['clean', 'break', 'sideline_for', 'sideline_against', 'foul'].includes(String(kick?.outcome || '').toLowerCase());
          const endColor = outcomeUsesWinLoss && wonSide && selectedPlayerTeamSide && wonSide === selectedPlayerTeamSide ? '#16a34a' : '#dc2626';

          const timeLabel = Number.isFinite(Number(stat?.normalized_time_s))
            ? formatMMSS(Number(stat.normalized_time_s))
            : Number.isFinite(Number(stat?.time_s))
              ? formatMMSS(Number(stat.time_s))
              : 'NA';

          const tooltip = [
            `Time: ${timeLabel}`,
            `Role: ${playerRole || 'Involved'}`,
            `Outcome: ${toTitleCase(String(kick?.outcome || 'unknown'))}`,
            targetMatch ? `Targetted: ${teamWon ? 'Won by team' : 'Lost by team'}` : null,
            kick?.mark ? `Mark: ${kick.mark ? 'Yes' : 'No'}` : null,
          ].filter(Boolean).join('\n');

          return {
            id: `player-restart-pane-${stat.id}`,
            start: transformKickoutDisplayPoint(stat.x_position, stat.y_position, kickTeamSide),
            end: transformKickoutDisplayPoint(
              safeFinite(stat.end_x_position) ?? safeFinite(stat.x_position),
              safeFinite(stat.end_y_position) ?? safeFinite(stat.y_position),
              kickTeamSide,
            ),
            lineColor,
            endColor,
            tooltip,
            raw: stat,
          };
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }, [activeChartPlayer, awayTeam?.color, calcBase, homeTeam?.color, nextStatById, selectedIsGoalkeeper, selectedPlayerRow, selectedPlayerTeamSide]);

  const comparisonMetricByKey = useMemo(
    () => new Map(COMPARISON_METRIC_DEFINITIONS.map((metric) => [metric.key, metric])),
    [],
  );

  const comparisonMetricScales = useMemo(() => {
    if (activeMode !== 'comparison') return new Map();
    const scales = new Map();
    const outfieldCohort = comparisonPoolEntries.filter((entry) => !entry.isGoalkeeper && Number(entry.row?.minutesPlayed) > RADAR_AVERAGE_MINUTES_THRESHOLD);
    const goalkeeperCohort = comparisonPoolEntries.filter((entry) => entry.isGoalkeeper && Number(entry.row?.minutesPlayed) > RADAR_AVERAGE_MINUTES_THRESHOLD);

    for (const metric of COMPARISON_METRIC_DEFINITIONS) {
      const cohort = (metric.goalkeepingOnly ? goalkeeperCohort : outfieldCohort)
        .filter((entry) => metric.category !== 'defending_allowed' || Number(entry.row?.matchupMinutes) > 0);
      const valuesRate = cohort
        .map((entry) => {
          try {
            return Number(metric.getValue(entry.row, entry.derived, { mode: 'rate' }));
          } catch {
            return NaN;
          }
        })
        .filter(Number.isFinite);
      const valuesRaw = cohort
        .map((entry) => {
          try {
            return Number(metric.getValue(entry.row, entry.derived, { mode: 'raw' }));
          } catch {
            return NaN;
          }
        })
        .filter(Number.isFinite);
      const averageRate = valuesRate.length
        ? (valuesRate.reduce((sum, value) => sum + value, 0) / valuesRate.length)
        : NaN;
      const averageRaw = valuesRaw.length
        ? (valuesRaw.reduce((sum, value) => sum + value, 0) / valuesRaw.length)
        : NaN;
      const spreadRate = valuesRate.length && Number.isFinite(averageRate)
        ? Math.max(...valuesRate.map((value) => Math.abs(value - averageRate)))
        : NaN;
      const spreadRaw = valuesRaw.length && Number.isFinite(averageRaw)
        ? Math.max(...valuesRaw.map((value) => Math.abs(value - averageRaw)))
        : NaN;
      scales.set(metric.key, {
        averageRate,
        averageRaw,
        spreadRate,
        spreadRaw,
      });
    }

    return scales;
  }, [activeMode, comparisonPoolEntries]);

  const getComparisonMetricValue = (entry, metricKey, mode = statMode) => {
    const metric = comparisonMetricByKey.get(metricKey);
    if (!metric || !entry?.row) return 0;
    try {
      const value = Number(metric.getValue(entry.row, entry.derived, { mode }));
      return Number.isFinite(value) ? value : 0;
    } catch {
      return 0;
    }
  };

  const comparisonRadarMetricKeys = useMemo(
    () => COMPARISON_PRESET_METRIC_KEYS[comparisonPreset] || COMPARISON_PRESET_METRIC_KEYS.overall,
    [comparisonPreset],
  );

  const comparisonAverageCohort = useMemo(() => {
    if (activeMode !== 'comparison') return [];
    const goalkeeperMode = comparisonPreset === 'goalkeeping';
    return comparisonPoolEntries.filter((entry) => (
      Number(entry.row?.minutesPlayed) > RADAR_AVERAGE_MINUTES_THRESHOLD
      && (comparisonPreset !== 'defending_allowed' || Number(entry.row?.matchupMinutes) > 0)
      && (goalkeeperMode ? entry.isGoalkeeper : !entry.isGoalkeeper)
    ));
  }, [activeMode, comparisonPoolEntries, comparisonPreset]);

  const comparisonRadarData = useMemo(() => {
    if (activeMode !== 'comparison') return [];
    return comparisonRadarMetricKeys.map((metricKey) => {
      const metric = comparisonMetricByKey.get(metricKey);
      const scale = comparisonMetricScales.get(metricKey) || {};
      const primaryRaw = getComparisonMetricValue(comparisonPrimaryEntry, metricKey, statMode);
      const secondaryRaw = getComparisonMetricValue(comparisonSecondaryEntry, metricKey, statMode);
      const averageValues = comparisonAverageCohort
        .map((entry) => {
          try {
            return Number(metric?.getValue(entry.row, entry.derived, { mode: 'rate' }));
          } catch {
            return NaN;
          }
        })
        .filter(Number.isFinite);
      const averageRaw = averageValues.length
        ? (averageValues.reduce((sum, value) => sum + value, 0) / averageValues.length)
        : NaN;
      const selectedAverage = statMode === 'rate'
        ? scale?.averageRate
        : scale?.averageRaw;
      const selectedSpread = Math.max(
        Number.isFinite(primaryRaw) && Number.isFinite(selectedAverage) ? Math.abs(primaryRaw - selectedAverage) : 0,
        Number.isFinite(secondaryRaw) && Number.isFinite(selectedAverage) ? Math.abs(secondaryRaw - selectedAverage) : 0,
        Number(statMode === 'rate' ? scale?.spreadRate : scale?.spreadRaw) || 0,
      );

      return {
        key: metricKey,
        label: metric?.label || metricKey,
        metric: metric?.shortLabel || metric?.label || metricKey,
        metricDef: metric || null,
        average: Number.isFinite(averageRaw) ? 50 : NaN,
        playerA: normalizeComparisonMetricScore(metric, primaryRaw, selectedAverage, selectedSpread),
        playerB: normalizeComparisonMetricScore(metric, secondaryRaw, selectedAverage, selectedSpread),
        averageRaw,
        primaryRaw,
        secondaryRaw,
      };
    })
  }, [activeMode, comparisonAverageCohort, comparisonMetricByKey, comparisonMetricScales, comparisonPrimaryEntry, comparisonRadarMetricKeys, comparisonSecondaryEntry, statMode]);

  const comparisonAxisGroups = useMemo(() => (
    activeMode !== 'comparison'
      ? []
      : (
    COMPARISON_AXIS_GROUPS
      .filter((group) => group.key !== 'goalkeeping' || comparisonPreset === 'goalkeeping')
      .map((group) => ({
        ...group,
        options: COMPARISON_METRIC_DEFINITIONS
          .filter((metric) => metric.category === group.key)
          .filter((metric) => !metric.goalkeepingOnly || comparisonPreset === 'goalkeeping')
          .map((metric) => ({ value: metric.key, label: metric.label })),
      }))
      .filter((group) => group.options.length > 0)
      )
  ), [activeMode, comparisonPreset]);

  const validScatterMetricKeys = useMemo(
    () => new Set(comparisonAxisGroups.flatMap((group) => group.options.map((option) => option.value))),
    [comparisonAxisGroups],
  );

  useEffect(() => {
    if (activeMode !== 'comparison') return;
    if (!validScatterMetricKeys.has(scatterXMetric)) {
      setScatterXMetric(comparisonPreset === 'goalkeeping' ? 'gk_kickout_pct' : 'points');
    }
    if (!validScatterMetricKeys.has(scatterYMetric)) {
      setScatterYMetric(comparisonPreset === 'goalkeeping' ? 'gk_saves' : 'prog_passes');
    }
  }, [activeMode, comparisonPreset, scatterXMetric, scatterYMetric, validScatterMetricKeys]);

  const comparisonScatterMetricX = comparisonMetricByKey.get(scatterXMetric) || null;
  const comparisonScatterMetricY = comparisonMetricByKey.get(scatterYMetric) || null;

  const comparisonScatterData = useMemo(() => {
    if (activeMode !== 'comparison') return [];
    if (!comparisonScatterMetricX || !comparisonScatterMetricY) return [];
    const goalkeeperMode = comparisonScatterMetricX.goalkeepingOnly || comparisonScatterMetricY.goalkeepingOnly;
    const needsMatchupMinutes = comparisonScatterMetricX.category === 'defending_allowed' || comparisonScatterMetricY.category === 'defending_allowed';

    return comparisonPoolEntries
      .filter((entry) => (goalkeeperMode ? entry.isGoalkeeper : true))
      .filter((entry) => !needsMatchupMinutes || Number(entry.row?.matchupMinutes) > 0)
      .map((entry) => {
        const xRaw = getComparisonMetricValue(entry, comparisonScatterMetricX.key, statMode);
        const yRaw = getComparisonMetricValue(entry, comparisonScatterMetricY.key, statMode);
        const x = xRaw;
        const y = yRaw;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

        return {
          key: entry.row.key,
          player: entry.shortLabel,
          teamLabel: entry.teamLabel,
          team: entry.row.team,
          isSelectedA: entry.option.value === safeChartPlayerValue,
          isSelectedB: entry.option.value === comparisonSecondPlayerId,
          x,
          y,
          xRaw,
          yRaw,
        };
      })
      .filter(Boolean);
  }, [activeMode, comparisonPoolEntries, comparisonScatterMetricX, comparisonScatterMetricY, comparisonSecondPlayerId, safeChartPlayerValue, statMode]);

  const comparisonScatterBaseData = useMemo(
    () => comparisonScatterData.filter((point) => !point.isSelectedA && !point.isSelectedB),
    [comparisonScatterData],
  );

  const comparisonScatterSelectedA = useMemo(
    () => comparisonScatterData.filter((point) => point.isSelectedA),
    [comparisonScatterData],
  );

  const comparisonScatterSelectedB = useMemo(
    () => comparisonScatterData.filter((point) => point.isSelectedB),
    [comparisonScatterData],
  );

  const comparisonPresetOptions = useMemo(
    () => (
      bothComparisonPlayersAreGoalkeepers
        ? COMPARISON_PRESET_OPTIONS
        : COMPARISON_PRESET_OPTIONS.filter((option) => option.value !== 'goalkeeping')
    ),
    [bothComparisonPlayersAreGoalkeepers],
  );

  const comparisonPlayerSelectGroups = useMemo(() => ([
    {
      key: 'players',
      options: chartPlayerOptions.map((player) => ({
        value: player.value,
        label: player.displayLabel,
      })),
    },
  ]), [chartPlayerOptions]);

  const comparisonPresetSelectGroups = useMemo(() => ([
    {
      key: 'presets',
      options: comparisonPresetOptions.map((option) => ({
        value: option.value,
        label: option.label,
      })),
    },
  ]), [comparisonPresetOptions]);

  const comparisonTableSelectGroups = useMemo(() => ([
    {
      key: 'tables',
      options: TABLE_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
      })),
    },
  ]), []);

  const playerCardSections = useMemo(() => {
    if (!selectedPlayerRow) return [];
    const row = selectedPlayerRow;
    const derived = selectedPlayerDerived || {};

    const restartMetrics = [
      { label: 'Kickouts Taken', value: formatPlayerMetric({ key: 'kickoutsTaken', type: 'count' }, row, derived, statMode) },
      { label: 'Own KO Wins', value: formatPlayerMetric({ key: 'ownKickoutsWon', type: 'count' }, row, derived, statMode) },
      { label: 'Own KO Win %', value: row.kickoutsTaken ? formatPct(row.ownKickoutWinPct) : 'NA' },
      { label: 'Kickout Targets', value: formatPlayerMetric({ key: 'kickoutTargets', type: 'count' }, row, derived, statMode) },
      { label: 'Target Win %', value: row.kickoutTargets ? formatPct(row.kickoutTargetWinPct) : 'NA' },
      { label: 'Clean Wins', value: formatPlayerMetric({ key: 'cleanWon', type: 'count' }, row, derived, statMode) },
      { label: 'Break Wins', value: formatPlayerMetric({ key: 'breakWon', type: 'count' }, row, derived, statMode) },
      { label: 'Throw-Ins Won', value: formatPlayerMetric({ key: 'throwInsWon', type: 'count' }, row, derived, statMode) },
      { label: 'Marks', value: formatPlayerMetric({ key: 'marks', type: 'count' }, row, derived, statMode) },
      { label: 'Short KO Win %', value: row.shortKickoutsTaken ? formatPct(row.shortKickoutWinPct) : 'NA' },
      { label: 'Long KO Win %', value: row.longKickoutsTaken ? formatPct(row.longKickoutWinPct) : 'NA' },
      { label: 'Restart Involvement', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, row.kickoutTargets + row.cleanWon + row.breakWon + row.throwInsWon, 'rate') : (row.kickoutTargets + row.cleanWon + row.breakWon + row.throwInsWon), { decimals: 0 }) },
    ];

    const defenceMetrics = [
      { label: 'Defensive Actions', value: formatPlayerMetric({ key: 'defActions', type: 'count' }, row, derived, statMode) },
      { label: 'Turnovers Forced', value: formatPlayerMetric({ key: 'turnoversForced', type: 'count' }, row, derived, statMode) },
      { label: 'Turnovers Recovered', value: formatPlayerMetric({ key: 'turnoversRecovered', type: 'count' }, row, derived, statMode) },
      { label: 'Blocks', value: formatPlayerMetric({ key: 'blocks', type: 'count' }, row, derived, statMode) },
      { label: 'High-Pressure Actions', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, derived.highPressureActions, 'rate') : derived.highPressureActions, { decimals: 0 }) },
      { label: 'Fouls Conceded', value: formatPlayerMetric({ key: 'foulsConceded', type: 'count' }, row, derived, statMode) },
      { label: 'Scorable Frees Conceded', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, derived.scorableFreesConceded, 'rate') : derived.scorableFreesConceded, { decimals: 0 }) },
      { label: 'Fouls Won', value: formatPlayerMetric({ key: 'foulsWon', type: 'count' }, row, derived, statMode) },
      { label: 'TO Won Total', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, row.turnoversWon, 'rate') : row.turnoversWon, { decimals: 0 }) },
      { label: 'TO Lost / 10 Poss', value: Number.isFinite(row.turnoversLostPer10Poss) ? row.turnoversLostPer10Poss.toFixed(2) : 'NA' },
      { label: 'Opp Possessions Played', value: formatMetricValue(row.oppPossessionsPlayed, { decimals: 0 }) },
      { label: 'First Contact Wins', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, row.cleanWon + row.breakWon, 'rate') : (row.cleanWon + row.breakWon), { decimals: 0 }) },
    ];

    if (selectedIsGoalkeeper) {
      return [
        {
          title: 'Goalkeeper Restart Profile',
          subtitle: 'Position-specific restart and distribution profile.',
          tone: 'teal',
          metrics: restartMetrics,
        },
        {
          title: 'Distribution & Retention',
          subtitle: 'How the keeper keeps possession moving.',
          tone: 'blue',
          metrics: [
            { label: 'Passes Completed', value: formatPlayerMetric({ key: 'passComp', type: 'count' }, row, derived, statMode) },
            { label: 'Pass Completion', value: formatPct(row.passPct) },
            { label: 'Progressive Passes', value: formatPlayerMetric({ key: 'progPassComp', type: 'count' }, row, derived, statMode) },
            { label: 'Progressive Metres', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, row.progMeters, 'rate') : row.progMeters, { decimals: 1, suffix: 'm' }) },
            { label: 'First-Time Pass Rate', value: formatPct(row.noCarryPassRate) },
            { label: 'Hand Pass %', value: formatPct(derived.passMethods?.total ? ((derived.passMethods.hand || 0) / derived.passMethods.total) * 100 : NaN) },
            { label: 'Left-Side Pass %', value: formatPct(derived.passMethods?.total ? ((derived.passMethods.left || 0) / derived.passMethods.total) * 100 : NaN) },
            { label: 'Right-Side Pass %', value: formatPct(derived.passMethods?.total ? ((derived.passMethods.right || 0) / derived.passMethods.total) * 100 : NaN) },
          ],
        },
        {
          title: 'Shot Stopping & Defensive Work',
          subtitle: 'Goalmouth actions and defensive workload.',
          tone: 'rose',
          metrics: [
            { label: 'Goal Shots Saved', value: formatPlayerMetric({ key: 'goalShotsSaved', type: 'count' }, row, derived, statMode) },
            { label: 'Goals Conceded', value: formatPlayerMetric({ key: 'goalShotsAgainst', type: 'count' }, row, derived, statMode) },
            { label: 'Save %', value: (row.goalShotsSaved + row.goalShotsAgainst) ? formatPct(row.goalShotSavePct) : 'NA' },
            { label: 'Defensive Actions', value: formatPlayerMetric({ key: 'defActions', type: 'count' }, row, derived, statMode) },
            { label: 'Turnovers Recovered', value: formatPlayerMetric({ key: 'turnoversRecovered', type: 'count' }, row, derived, statMode) },
            { label: 'High Pressure', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, derived.highPressureActions, 'rate') : derived.highPressureActions, { decimals: 0 }) },
            { label: 'Fouls Conceded', value: formatPlayerMetric({ key: 'foulsConceded', type: 'count' }, row, derived, statMode) },
            { label: 'Touches', value: formatPlayerMetric({ key: 'touches', type: 'count' }, row, derived, statMode) },
          ],
        },
      ];
    }

    return [];
  }, [selectedIsGoalkeeper, selectedPlayerDerived, selectedPlayerRow, statMode]);

  const heroKpis = useMemo(() => {
    if (!selectedPlayerRow) return [];
    const progressionValue = selectedPlayerRow.progPassComp + selectedPlayerRow.progCarryComp;
    const kickoutsWonValue = (selectedPlayerRow.cleanWon || 0) + (selectedPlayerRow.breakWon || 0);
    if (selectedIsGoalkeeper) {
      return [
        {
          label: 'Points',
          value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(selectedPlayerRow, selectedPlayerRow.points, 'rate') : selectedPlayerRow.points, { decimals: 0 }),
        },
        {
          label: 'Touches',
          value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(selectedPlayerRow, selectedPlayerRow.touches, 'rate') : selectedPlayerRow.touches, { decimals: 0 }),
        },
        {
          label: 'Saves',
          value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(selectedPlayerRow, selectedPlayerRow.goalShotsSaved, 'rate') : selectedPlayerRow.goalShotsSaved, { decimals: 0 }),
        },
        {
          label: 'Kickouts',
          value: selectedPlayerRow.kickoutsTaken
            ? `${selectedPlayerRow.ownKickoutsWon}/${selectedPlayerRow.kickoutsTaken} (${formatPct(selectedPlayerRow.ownKickoutWinPct)})`
            : '0/0',
        },
        {
          label: 'Progression',
          value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(selectedPlayerRow, progressionValue, 'rate') : progressionValue, { decimals: 0 }),
        },
      ];
    }
    return [
      {
        label: 'Points',
        value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(selectedPlayerRow, selectedPlayerRow.points, 'rate') : selectedPlayerRow.points, { decimals: 0 }),
      },
      {
        label: 'Touches',
        value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(selectedPlayerRow, selectedPlayerRow.touches, 'rate') : selectedPlayerRow.touches, { decimals: 0 }),
      },
      {
        label: 'Defensive Actions',
        value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(selectedPlayerRow, selectedPlayerRow.defActions, 'rate') : selectedPlayerRow.defActions, { decimals: 0 }),
      },
      {
        label: 'Kickouts Won',
        value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(selectedPlayerRow, kickoutsWonValue, 'rate') : kickoutsWonValue, { decimals: 0 }),
      },
      {
        label: 'Progression',
        value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(selectedPlayerRow, progressionValue, 'rate') : progressionValue, { decimals: 0 }),
      },
      {
        label: 'Passes',
        value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(selectedPlayerRow, selectedPlayerRow.passes, 'rate') : selectedPlayerRow.passes, { decimals: 0 }),
      },
    ];
  }, [selectedIsGoalkeeper, selectedPlayerRow, statMode]);

  const goalkeeperInvolvementMetrics = useMemo(() => {
    if (!selectedIsGoalkeeper || !selectedPlayerRow) return [];
    return [
      { label: 'Passes', value: formatScoringFraction(selectedPlayerRow.passComp, selectedPlayerRow.passes) },
      { label: 'Prog Passes', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(selectedPlayerRow, selectedPlayerRow.progPassComp, 'rate') : selectedPlayerRow.progPassComp, { decimals: 0 }) },
      { label: 'Carries', value: formatScoringFraction(selectedPlayerRow.carryComp, selectedPlayerRow.carries) },
      { label: 'Prog Carries', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(selectedPlayerRow, selectedPlayerRow.progCarryComp, 'rate') : selectedPlayerRow.progCarryComp, { decimals: 0 }) },
      { label: 'Pts', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(selectedPlayerRow, selectedPlayerRow.points, 'rate') : selectedPlayerRow.points, { decimals: 0 }) },
      { label: 'xP', value: selectedPlayerRow.xpCount ? formatMetricValue(statMode === 'rate' ? scalePlayerCount(selectedPlayerRow, selectedPlayerRow.xpTotal, 'rate') : selectedPlayerRow.xpTotal, { decimals: 2 }) : '0.00' },
      { label: 'TO Won', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(selectedPlayerRow, selectedPlayerRow.turnoversWon, 'rate') : selectedPlayerRow.turnoversWon, { decimals: 0 }) },
      { label: 'TO Lost', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(selectedPlayerRow, selectedPlayerRow.turnoversLost, 'rate') : selectedPlayerRow.turnoversLost, { decimals: 0 }) },
    ];
  }, [selectedIsGoalkeeper, selectedPlayerRow, statMode]);

  const goalkeeperSavingMetrics = useMemo(() => {
    if (!selectedIsGoalkeeper || !selectedPlayerRow) return [];
    const shotsOnGoal = selectedGoalkeeperShotsOnGoal.length;
    const shotsOnTarget = selectedGoalkeeperShotsOnGoal.filter((shot) => ['saved', 'goal'].includes(String(shot.outcome || '').toLowerCase()));
    const widesOfShotsOnGoal = selectedGoalkeeperShotsOnGoal.filter((shot) => String(shot.outcome || '').toLowerCase() === 'wide').length;
    const xPShotsOnGoal = selectedGoalkeeperShotsOnGoal.reduce((sum, shot) => sum + (Number.isFinite(shot.xp) ? shot.xp : 0), 0);
    const xPShotsOnTarget = shotsOnTarget.reduce((sum, shot) => sum + (Number.isFinite(shot.xp) ? shot.xp : 0), 0);
    return [
      { label: 'Shots On Goal', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(selectedPlayerRow, shotsOnGoal, 'rate') : shotsOnGoal, { decimals: 0 }) },
      { label: 'Goals Conceded', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(selectedPlayerRow, selectedPlayerRow.goalShotsAgainst, 'rate') : selectedPlayerRow.goalShotsAgainst, { decimals: 0 }) },
      { label: 'Wides Of Shots On Goal', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(selectedPlayerRow, widesOfShotsOnGoal, 'rate') : widesOfShotsOnGoal, { decimals: 0 }) },
      { label: 'Saves', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(selectedPlayerRow, selectedPlayerRow.goalShotsSaved, 'rate') : selectedPlayerRow.goalShotsSaved, { decimals: 0 }) },
      { label: 'xP Of Shots On Goal', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(selectedPlayerRow, xPShotsOnGoal, 'rate') : xPShotsOnGoal, { decimals: 2 }) },
      { label: 'xP Of Shots On Target', value: formatMetricValue(statMode === 'rate' ? scalePlayerCount(selectedPlayerRow, xPShotsOnTarget, 'rate') : xPShotsOnTarget, { decimals: 2 }) },
    ];
  }, [selectedGoalkeeperShotsOnGoal, selectedIsGoalkeeper, selectedPlayerRow, statMode]);

  const toggleSort = (key) => {
    setLbSort((current) => {
      if (current?.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
      return { key, dir: 'desc' };
    });
  };

  const renderSimpleTable = (rows, columns, options = {}) => (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <SortableTableHead
                key={column.key}
                column={{ key: column.key, label: column.label }}
                sortState={lbSort}
                onToggle={toggleSort}
                className={[
                  options.compactHeaders ? 'px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 whitespace-normal leading-tight' : '',
                  column.numeric ? 'text-right' : '',
                ].filter(Boolean).join(' ')}
              />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, 250).map((row) => (
            <TableRow key={row.key} style={teamRowTint(row.team, homeTeam?.color, awayTeam?.color, 0.07)}>
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  className={[
                    options.compactHeaders ? 'px-3 py-3' : '',
                    column.numeric ? 'text-right tabular-nums' : '',
                    column.key === 'player' ? 'font-medium' : '',
                  ].filter(Boolean).join(' ')}
                >
                  {column.render ? column.render(row) : row[column.key]}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  const comparisonPrimaryLabel = comparisonPlayerShortLabel(comparisonPrimaryEntry);
  const comparisonSecondaryLabel = comparisonPlayerShortLabel(comparisonSecondaryEntry);
  const comparisonTableColumns = playerBucket === 'defending_allowed'
    ? defendingAllowedTableColumns
    : (currentColumns[playerBucket] || currentColumns.scoring);

  const renderToolbarPlayerSelect = (value, onChange) => (
    <div className="flex min-w-0 items-center sm:w-[165px] lg:w-[185px]">
      <select
        value={String(value || 'all')}
        onChange={(event) => onChange(event.target.value)}
        className="flex h-8 min-w-0 w-full rounded-full border border-slate-300 bg-white px-2 pr-6 py-1 text-[13px] shadow-sm outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring"
      >
        <option value="all">Select Player</option>
        {chartPlayerOptions.map((player) => (
          <option key={player.value} value={player.value}>
            {player.displayLabel}
          </option>
        ))}
      </select>
    </div>
  );

  const playersNavControls = (
    <div className="flex max-w-full flex-nowrap items-center justify-end gap-0.5" aria-label="Players tab controls">
      {(activeMode === 'player-card' && !singlePlayerOnly) ? (
        renderToolbarPlayerSelect(safeChartPlayerValue, setChartPlayerId)
      ) : null}
      {(activeMode === 'player-card' || activeMode === 'comparison') ? (
        <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-0.5">
          <Button type="button" size="sm" variant={statMode === 'raw' ? 'default' : 'ghost'} className="h-7 rounded-full px-1.5 text-xs" onClick={() => setStatMode('raw')}>Total</Button>
          <Button type="button" size="sm" variant={statMode === 'rate' ? 'default' : 'ghost'} className="h-7 rounded-full px-1.5 text-xs" onClick={() => setStatMode('rate')}>{rateModeLabel}</Button>
        </div>
      ) : null}
      <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-0.5">
        {(singlePlayerOnly ? PLAYER_CARD_MODES.slice(0, 1) : PLAYER_CARD_MODES).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={activeMode === value ? 'default' : 'ghost'}
            className="h-7 rounded-full px-2 text-xs"
            onClick={() => setActiveMode(value)}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-4" style={{ scrollbarGutter: 'stable both-edges' }}>
      {playersNavPortalTarget ? createPortal(playersNavControls, playersNavPortalTarget) : playersNavControls}

      {activeMode === 'player-card' && (
        <div className="space-y-2.5">
          {selectedPlayerRow ? (
              <div className="space-y-2.5">
                <PlayerHeaderCard
                  row={selectedPlayerRow}
                  role={playerRoleByKey.get(selectedPlayerRow.key)}
                  homeTeam={homeTeam}
                  awayTeam={awayTeam}
                  heroKpis={heroKpis}
                  teamSide={selectedPlayerTeamSide}
                  heatmapPoints={selectedPlayerHeatmapPoints}
                  match={reportFilters?.match}
                  rightPanelMode={selectedTopRightIsGoalkeeper ? 'kickout-map' : 'heatmap'}
                  kickoutMapItems={selectedTopRightIsGoalkeeper ? goalkeeperKickoutItems : []}
                  onComparePlayer={!singlePlayerOnly ? () => {
                    setActiveMode('comparison');
                    if (!comparisonSecondPlayerId || comparisonSecondPlayerId === safeChartPlayerValue) {
                      setComparisonSecondPlayerId(defaultComparisonSecondValue);
                    }
                  } : null}
                  onOpenVideoSelection={openPlayerMapVideoSelection}
                />

                <div className="space-y-4">
                  {!selectedIsGoalkeeper ? (
                    <PlayerShootingPanel
                      row={selectedPlayerRow}
                      shots={selectedPlayerShotStats}
                      statMode={statMode}
                      teamSide={selectedPlayerTeamSide}
                      match={reportFilters?.match}
                      filter={playerShotPaneFilter}
                      onFilterChange={setPlayerShotPaneFilter}
                      onOpenVideoSelection={openPlayerMapVideoSelection}
                      cardStyle={selectedCardTintStyle}
                    />
                  ) : null}
                  {!selectedIsGoalkeeper ? (
                    <PlayerPassingPanel
                      row={selectedPlayerRow}
                      passes={selectedPlayerPassStats}
                      statMode={statMode}
                      teamSide={selectedPlayerTeamSide}
                      match={reportFilters?.match}
                      onOpenVideoSelection={openPlayerMapVideoSelection}
                      cardStyle={selectedCardTintStyle}
                    />
                  ) : null}
                  {!selectedIsGoalkeeper ? (
                    <PlayerCarryingPanel
                      row={selectedPlayerRow}
                      carries={selectedPlayerCarryStats}
                      statMode={statMode}
                      teamSide={selectedPlayerTeamSide}
                      match={reportFilters?.match}
                      onOpenVideoSelection={openPlayerMapVideoSelection}
                      cardStyle={selectedCardTintStyle}
                    />
                  ) : null}
                  {!selectedIsGoalkeeper ? (
                    <PlayerProgressionPanel
                      row={selectedPlayerRow}
                      derived={selectedPlayerDerived || {}}
                      receptions={selectedPlayerReceptionStats}
                      passes={selectedPlayerPassStats}
                      carries={selectedPlayerCarryStats}
                      scorableFreesWon={selectedPlayerScorableFreesWon}
                      statMode={statMode}
                      teamSide={selectedPlayerTeamSide}
                      match={reportFilters?.match}
                      onOpenVideoSelection={openPlayerMapVideoSelection}
                      cardStyle={selectedCardTintStyle}
                    />
                  ) : null}
                  {!selectedIsGoalkeeper ? (
                    <PlayerRestartPanel
                      row={selectedPlayerRow}
                      statMode={statMode}
                      kickoutItems={selectedPlayerKickoutMapItems}
                      teamSide={selectedPlayerTeamSide}
                      match={reportFilters?.match}
                      onOpenVideoSelection={openPlayerMapVideoSelection}
                      cardStyle={selectedCardTintStyle}
                    />
                  ) : null}
                  {!selectedIsGoalkeeper ? (
                    <PlayerDefensePanel
                      row={selectedPlayerRow}
                      actions={selectedPlayerDefensiveActions}
                      cardCounts={selectedPlayerCardCounts}
                      statMode={statMode}
                      onOpenVideoSelection={openPlayerMapVideoSelection}
                      cardStyle={selectedCardTintStyle}
                    />
                  ) : null}
                  {!selectedIsGoalkeeper ? (
                    <PlayerDefendingAllowedPanel
                      row={selectedPlayerRow}
                      statMode={statMode}
                      readOnly={readOnly}
                      onOpenMatchupEditor={onOpenMatchupEditor}
                      touchPoints={selectedPlayerDefendingAllowedTouchSummary.points}
                      finalThirdTouches={selectedPlayerDefendingAllowedTouchSummary.finalThirdTouches}
                      teamSide={selectedPlayerTeamSide}
                      match={reportFilters?.match}
                      onOpenVideoSelection={openPlayerMapVideoSelection}
                      cardStyle={selectedCardTintStyle}
                    />
                  ) : null}
                  {!selectedIsGoalkeeper ? playerCardSections.map((section) => (
                    <MetricCategoryCard
                      key={section.title}
                      title={section.title}
                      subtitle={section.subtitle}
                      tone={section.tone}
                      metrics={section.metrics}
                    />
                  )) : null}

                  {selectedIsGoalkeeper ? (
                    <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
                      <GoalkeeperPressPanel card={selectedGoalkeeperPressCard} cardStyle={selectedCardTintStyle} />
                      <GoalkeeperSummaryMetricsCard title="Involvement" metrics={goalkeeperInvolvementMetrics} cardStyle={selectedCardTintStyle} />
                    </div>
                  ) : null}

                  {selectedIsGoalkeeper ? (
                    <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
                      <GoalkeeperSummaryMetricsCard title="Saving Metrics" metrics={goalkeeperSavingMetrics} cardStyle={selectedCardTintStyle} />
                      <GoalkeeperShotsMap
                        shots={selectedGoalkeeperShotsOnGoal}
                        teamSide={selectedPlayerTeamSide}
                        match={reportFilters?.match}
                        onOpenVideoSelection={openPlayerMapVideoSelection}
                        cardStyle={selectedCardTintStyle}
                      />
                    </div>
                  ) : null}
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-600">Select a player to view the player card.</div>
          )}
        </div>
      )}

          {activeMode === 'comparison' && (
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardContent className="p-4 space-y-4">
                    <div className="flex flex-col gap-3 border-b border-slate-100 pb-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="text-lg font-semibold text-slate-900">Radar Comparison</div>
                        <div className="w-full sm:w-[180px]">
                          <ComparisonInlineSelect
                            value={comparisonPreset}
                            onChange={setComparisonPreset}
                            groups={comparisonPresetSelectGroups}
                            ariaLabel="Radar preset"
                          />
                        </div>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <ComparisonInlineSelect
                          value={safeChartPlayerValue}
                          onChange={setChartPlayerId}
                          groups={comparisonPlayerSelectGroups}
                          ariaLabel="Primary player"
                        />
                        <ComparisonInlineSelect
                          value={comparisonSecondPlayerId}
                          onChange={setComparisonSecondPlayerId}
                          groups={comparisonPlayerSelectGroups}
                          ariaLabel="Comparison player"
                        />
                      </div>
                    </div>

                    {comparisonRadarData.length ? (
                      <>
                        <ChartContainer
                          id="players-comparison-radar"
                          className="h-[360px] w-full"
                          config={{
                            average: { label: 'Average', color: '#94a3b8' },
                            playerA: { label: comparisonPrimaryLabel, color: '#0f766e' },
                            playerB: { label: comparisonSecondaryLabel, color: '#7c3aed' },
                          }}
                        >
                          <RadarChart data={comparisonRadarData} outerRadius="72%">
                            <PolarGrid stroke="#cbd5e1" />
                            <PolarAngleAxis dataKey="metric" tick={{ fill: '#475569', fontSize: 11 }} />
                            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                            <ChartTooltip
                              cursor={false}
                              content={(
                                <ComparisonRadarTooltip
                                  playerALabel={comparisonPrimaryLabel}
                                  playerBLabel={comparisonSecondaryLabel}
                                />
                              )}
                            />
                            <Radar dataKey="average" stroke="#94a3b8" fill="#94a3b8" fillOpacity={0} strokeWidth={2} strokeDasharray="4 4" dot={false} />
                            <Radar dataKey="playerA" stroke="#2dd4bf" fill="#2dd4bf" fillOpacity={0.2} strokeWidth={2.5} dot={{ r: 3, fill: '#5eead4', strokeWidth: 0 }} />
                            <Radar dataKey="playerB" stroke="#c084fc" fill="#a855f7" fillOpacity={0.2} strokeWidth={2.5} dot={{ r: 3, fill: '#c084fc', strokeWidth: 0 }} />
                          </RadarChart>
                        </ChartContainer>
                        <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-slate-600">
                          <div className="inline-flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
                            <span>Average</span>
                          </div>
                          <div className="inline-flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full bg-teal-400" />
                            <span>{comparisonPrimaryLabel}</span>
                          </div>
                          <div className="inline-flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full bg-violet-400" />
                            <span>{comparisonSecondaryLabel}</span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="flex h-[360px] items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-500">
                        Comparison data is not available for the current selection.
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-4 space-y-4">
                    <div className="flex flex-col gap-3 border-b border-slate-100 pb-4">
                        <div>
                          <div className="text-lg font-semibold text-slate-900">Player Scatter</div>
                        </div>
                      <div className="grid gap-2 lg:grid-cols-2">
                        <ComparisonInlineSelect
                          value={scatterXMetric}
                          onChange={setScatterXMetric}
                          groups={comparisonAxisGroups}
                          ariaLabel="Scatter x axis"
                        />
                        <ComparisonInlineSelect
                          value={scatterYMetric}
                          onChange={setScatterYMetric}
                          groups={comparisonAxisGroups}
                          ariaLabel="Scatter y axis"
                        />
                      </div>
                    </div>

                    <ChartContainer
                      id="players-comparison-scatter"
                      className="h-[360px] w-full"
                      config={{
                        cohort: { label: 'Players', color: '#94a3b8' },
                        selectedA: { label: comparisonPrimaryLabel, color: '#0f766e' },
                        selectedB: { label: comparisonSecondaryLabel, color: '#7c3aed' },
                      }}
                    >
                      <ScatterChart margin={{ top: 12, right: 18, bottom: 18, left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis
                          type="number"
                          dataKey="x"
                          domain={['auto', 'auto']}
                          tick={{ fill: '#64748b', fontSize: 11 }}
                          tickCount={6}
                          tickFormatter={(value) => formatComparisonAxisTick(comparisonScatterMetricX, value)}
                          label={{
                            value: comparisonScatterMetricX?.label || 'X Axis',
                            position: 'insideBottom',
                            offset: -6,
                            fill: '#475569',
                            fontSize: 12,
                          }}
                        />
                        <YAxis
                          type="number"
                          dataKey="y"
                          domain={['auto', 'auto']}
                          tick={{ fill: '#64748b', fontSize: 11 }}
                          tickCount={6}
                          tickFormatter={(value) => formatComparisonAxisTick(comparisonScatterMetricY, value)}
                          label={{
                            value: comparisonScatterMetricY?.label || 'Y Axis',
                            angle: -90,
                            position: 'insideLeft',
                            fill: '#475569',
                            fontSize: 12,
                          }}
                        />
                        <ChartTooltip
                          cursor={{ stroke: '#cbd5e1', strokeDasharray: '3 3' }}
                          content={<ComparisonScatterTooltip metricX={comparisonScatterMetricX} metricY={comparisonScatterMetricY} />}
                        />
                        <Scatter data={comparisonScatterBaseData} fill="#94a3b8" opacity={0.72} />
                        <Scatter data={comparisonScatterSelectedA} fill="#0f766e" opacity={1} />
                        <Scatter data={comparisonScatterSelectedB} fill="#7c3aed" opacity={1} />
                      </ScatterChart>
                    </ChartContainer>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardContent className="p-4 space-y-4">
                  <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-lg font-semibold text-slate-900">Comparison Table</div>
                    </div>
                    <div className="w-full sm:w-[220px]">
                      <ComparisonInlineSelect
                        value={playerBucket}
                        onChange={setPlayerBucket}
                        groups={comparisonTableSelectGroups}
                        ariaLabel="Comparison table"
                      />
                    </div>
                  </div>

                  {renderSimpleTable(sortedLeaderboard, comparisonTableColumns, { compactHeaders: true })}
                </CardContent>
              </Card>

              {playerBucket === 'goalkeepers' && goalkeeperPressCards.length > 0 ? (
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <div className="text-lg font-semibold text-slate-900">Kickout Press Breakdown</div>
                    <div className="grid gap-3 lg:grid-cols-2">
                      {goalkeeperPressCards.map((card) => (
                        <GoalkeeperPressTable key={card.key} card={card} homeTeam={homeTeam} awayTeam={awayTeam} />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ) : null}
            </div>
          )}
    </div>
  );
}

class PlayersAnalyticsTabErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep the original error visible in the console while preventing the whole tab from blanking.
    console.error('PlayersAnalyticsTab crashed', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <Card>
          <CardContent className="p-6 space-y-3">
            <div className="text-lg font-semibold text-slate-900">Players tab hit an error</div>
            <div className="text-sm text-slate-600">
              {this.state.error?.message || 'Unknown players-tab error'}
            </div>
            <div className="text-xs text-slate-500">
              Open the browser console to see the full stack trace if this persists.
            </div>
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}

function bucketColumnsBuilder({
  homeTeam,
  awayTeam,
  derivedByKey,
  statMode = 'raw',
  renderPlayerCell,
  renderScoringFraction,
  readOnly = false,
  onOpenMatchupEditor = null,
}) {
  const getDerived = (row) => (derivedByKey?.get(row?.key) || {});
  const countValue = (row, value) => formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, value, 'rate') : value, { decimals: 0 });
  const distanceValue = (row, value) => Number.isFinite(value)
    ? formatMetricValue(statMode === 'rate' ? scalePlayerCount(row, value, 'rate') : value, { decimals: 1, suffix: 'm' })
    : 'NA';
  const avgDistanceValue = (value) => Number.isFinite(value) ? formatMetricValue(value, { decimals: 1, suffix: 'm' }) : 'NA';
  const matchupCountValue = (row, value, options = { decimals: 0 }) => formatMatchupMetricValue(row, value, statMode, options);

  return {
    scoring: [
      { key: 'player', label: 'Player', render: renderPlayerCell },
      { key: 'team', label: 'Team', render: (row) => teamLabelForSide(row.team, homeTeam, awayTeam) },
      { key: 'shots', label: 'Shots', numeric: true },
      { key: 'points', label: 'Points', numeric: true },
      { key: 'xp', label: 'xP', numeric: true, sortValue: (row) => (row.xpCount ? row.xpTotal : -1), render: (row) => row.xpCount ? row.xpTotal.toFixed(2) : 'NA' },
      { key: 'xpPts', label: 'Pts-XP', numeric: true, sortValue: (row) => (row.xpCount ? (row.points - row.xpTotal) : -Infinity), render: (row) => row.xpCount ? (row.points - row.xpTotal).toFixed(2) : 'NA' },
      { key: 'pointsPerShot', label: 'Pts/Shot', numeric: true, sortValue: (row) => (row.shots ? row.points / row.shots : -1), render: (row) => row.shots ? (row.points / row.shots).toFixed(2) : 'NA' },
      { key: 'xpPerShot', label: 'xP/Shot', numeric: true, sortValue: (row) => (row.xpCount ? (row.xpTotal / row.xpCount) : -1), render: (row) => row.xpCount ? (row.xpTotal / row.xpCount).toFixed(2) : 'NA' },
      { key: 'avgShotDist', label: 'Avg Dist', numeric: true, sortValue: (row) => row.avgShotDist, render: (row) => Number.isFinite(row.avgShotDist) ? row.avgShotDist.toFixed(1) : 'NA' },
      { key: 'pointFraction', label: '1 Point', numeric: true, sortValue: (row) => row.pointMade, render: (row) => renderScoringFraction(row.pointMade, row.pointAtt) },
      { key: 'twoFraction', label: '2 Point', numeric: true, sortValue: (row) => row.twoMade, render: (row) => renderScoringFraction(row.twoMade, row.twoAtt) },
      { key: 'goalFraction', label: 'Goal', numeric: true, sortValue: (row) => row.goalMade, render: (row) => renderScoringFraction(row.goalMade, row.goalAtt) },
    ],
    passing: [
      { key: 'player', label: 'Player', render: renderPlayerCell },
      { key: 'team', label: 'Team', render: (row) => teamLabelForSide(row.team, homeTeam, awayTeam) },
      { key: 'passFraction', label: 'Passes', numeric: true, sortValue: (row) => row.passComp, render: (row) => renderScoringFraction(row.passComp, row.passes) },
      { key: 'progPassFraction', label: 'Prog Passes', numeric: true, sortValue: (row) => row.progPassComp, render: (row) => renderScoringFraction(row.progPassComp, row.progPassAtt) },
      { key: 'shotAssists', label: 'Shot Assists', numeric: true, render: (row) => countValue(row, row.shotAssists) },
      { key: 'finalThirdProgPasses', label: 'Final 1/3 Prog Passes', numeric: true, sortValue: (row) => getDerived(row).finalThirdProgressivePasses || 0, render: (row) => countValue(row, getDerived(row).finalThirdProgressivePasses || 0) },
      { key: 'passesIntoScoringZone', label: 'Passes To Scoring Zone', numeric: true, render: (row) => countValue(row, row.passesIntoScoringZone) },
      { key: 'avgPassLength', label: 'Avg Pass Length', numeric: true, sortValue: (row) => {
        const derived = getDerived(row);
        return derived.passLengthCount ? (derived.passLengthTotal / derived.passLengthCount) : -1;
      }, render: (row) => {
        const derived = getDerived(row);
        return avgDistanceValue(derived.passLengthCount ? (derived.passLengthTotal / derived.passLengthCount) : NaN);
      } },
      { key: 'firstTimePassRate', label: 'First Time Pass %', numeric: true, sortValue: (row) => row.noCarryPassRate, render: (row) => formatPct(row.noCarryPassRate) },
      { key: 'inaccuratePasses', label: 'Inaccurate Passes', numeric: true, sortValue: (row) => getDerived(row).inaccuratePasses || 0, render: (row) => {
        const inaccuratePasses = getDerived(row).inaccuratePasses || 0;
        return `${countValue(row, inaccuratePasses)} (${formatPct(row.passes ? (inaccuratePasses / row.passes) * 100 : NaN)})`;
      } },
      { key: 'passProgMetres', label: 'Prog Metres From Passes', numeric: true, sortValue: (row) => getDerived(row).passProgressiveMeters || 0, render: (row) => distanceValue(row, getDerived(row).passProgressiveMeters || 0) },
      { key: 'toPasses', label: 'TO Passes', numeric: true, sortValue: (row) => getDerived(row).passTurnovers || 0, render: (row) => countValue(row, getDerived(row).passTurnovers || 0) },
    ],
    carrying: [
      { key: 'player', label: 'Player', render: renderPlayerCell },
      { key: 'team', label: 'Team', render: (row) => teamLabelForSide(row.team, homeTeam, awayTeam) },
      { key: 'carryFraction', label: 'Carries', numeric: true, sortValue: (row) => row.carryComp, render: (row) => renderScoringFraction(row.carryComp, row.carries) },
      { key: 'progCarryFraction', label: 'Prog Carries', numeric: true, sortValue: (row) => row.progCarryComp, render: (row) => renderScoringFraction(row.progCarryComp, row.progCarryAtt) },
      { key: 'takeons', label: 'Takeons', numeric: true, sortValue: (row) => getDerived(row).takeOnCompleted || 0, render: (row) => renderScoringFraction(getDerived(row).takeOnCompleted || 0, getDerived(row).takeOnAttempts || 0) },
      { key: 'highPressureCarries', label: 'High Pressure Carries', numeric: true, sortValue: (row) => getDerived(row).highPressureCarries || 0, render: (row) => countValue(row, getDerived(row).highPressureCarries || 0) },
      { key: 'progCarriesOppThird', label: 'Prog Carries In Opp 1/3', numeric: true, sortValue: (row) => getDerived(row).progressiveCarriesInOppThird || 0, render: (row) => countValue(row, getDerived(row).progressiveCarriesInOppThird || 0) },
      { key: 'foulsWonOnCarries', label: 'Fouls Won On Carries', numeric: true, sortValue: (row) => getDerived(row).foulsWonOnCarries || 0, render: (row) => countValue(row, getDerived(row).foulsWonOnCarries || 0) },
      { key: 'totalCarryMetres', label: 'Total Carry Metres', numeric: true, sortValue: (row) => getDerived(row).carryDistance || 0, render: (row) => distanceValue(row, getDerived(row).carryDistance || 0) },
      { key: 'progCarryMetres', label: 'Prog Carry Metres', numeric: true, sortValue: (row) => getDerived(row).carryProgressiveMeters || 0, render: (row) => distanceValue(row, getDerived(row).carryProgressiveMeters || 0) },
    ],
    progression: [
      { key: 'player', label: 'Player', render: renderPlayerCell },
      { key: 'team', label: 'Team', render: (row) => teamLabelForSide(row.team, homeTeam, awayTeam) },
      { key: 'passesReceived', label: 'Passes Received', numeric: true, sortValue: (row) => getDerived(row).passesReceived || 0, render: (row) => countValue(row, getDerived(row).passesReceived || 0) },
      { key: 'progPassRecv', label: 'Prog Passes Received', numeric: true, render: (row) => countValue(row, row.progPassRecv) },
      { key: 'touches', label: 'Touches', numeric: true, render: (row) => countValue(row, row.touches) },
      { key: 'progRecvOppThird', label: 'Prog Passes Received In Opp 1/3', numeric: true, sortValue: (row) => getDerived(row).progressiveReceptionsOppThird || 0, render: (row) => countValue(row, getDerived(row).progressiveReceptionsOppThird || 0) },
      { key: 'totalProgMetres', label: 'Total Prog Metres', numeric: true, sortValue: (row) => (getDerived(row).passProgressiveMeters || 0) + (getDerived(row).carryProgressiveMeters || 0), render: (row) => distanceValue(row, (getDerived(row).passProgressiveMeters || 0) + (getDerived(row).carryProgressiveMeters || 0)) },
      { key: 'scorableFreesWon', label: 'Scorable Frees Won', numeric: true, sortValue: (row) => getDerived(row).scorableFreesWon || 0, render: (row) => countValue(row, getDerived(row).scorableFreesWon || 0) },
    ],
    defending: [
      { key: 'player', label: 'Player', render: renderPlayerCell },
      { key: 'team', label: 'Team', render: (row) => teamLabelForSide(row.team, homeTeam, awayTeam) },
      { key: 'turnoversForced', label: 'TO Forced', numeric: true, render: (row) => countValue(row, row.turnoversForced) },
      { key: 'turnoversRecovered', label: 'TO Recovered', numeric: true, render: (row) => countValue(row, row.turnoversRecovered) },
      { key: 'defActions', label: 'Defensive Actions', numeric: true, render: (row) => countValue(row, row.defActions) },
      { key: 'foulsConceded', label: 'Fouls', numeric: true, render: (row) => countValue(row, row.foulsConceded) },
      { key: 'blocks', label: 'Blocks', numeric: true, render: (row) => countValue(row, row.blocks) },
      { key: 'pressureApplied', label: 'Pressure Applied', numeric: true, sortValue: (row) => getDerived(row).highPressureActions || 0, render: (row) => countValue(row, getDerived(row).highPressureActions || 0) },
    ],
    defending_allowed: [
      { key: 'player', label: 'Player', render: renderPlayerCell },
      { key: 'team', label: 'Team', render: (row) => teamLabelForSide(row.team, homeTeam, awayTeam) },
      { key: 'placeholder', label: 'Pending', render: () => '—' },
    ],
    restarts: [
      { key: 'player', label: 'Player', render: renderPlayerCell },
      { key: 'team', label: 'Team', render: (row) => teamLabelForSide(row.team, homeTeam, awayTeam) },
      { key: 'kickoutTargets', label: 'Targets', numeric: true },
      { key: 'kickoutWins', label: 'Won By Team', numeric: true },
      { key: 'kickoutTargetWinPct', label: 'Win %', numeric: true, sortValue: (row) => row.kickoutTargetWinPct, render: (row) => row.kickoutTargets ? formatPct(row.kickoutTargetWinPct) : 'NA' },
      { key: 'cleanWon', label: 'Clean Won', numeric: true },
      { key: 'cleanLost', label: 'Clean Lost', numeric: true },
      { key: 'cleanWinPct', label: 'Clean %', numeric: true, sortValue: (row) => row.cleanWinPct, render: (row) => Number.isFinite(row.cleanWinPct) ? formatPct(row.cleanWinPct) : 'NA' },
      { key: 'breakWon', label: 'Break Won', numeric: true },
      { key: 'breakLost', label: 'Break Lost', numeric: true },
      { key: 'breakWinPct', label: 'Break %', numeric: true, sortValue: (row) => row.breakWinPct, render: (row) => Number.isFinite(row.breakWinPct) ? formatPct(row.breakWinPct) : 'NA' },
      { key: 'broken', label: 'Broken', numeric: true },
      { key: 'throwInsWon', label: 'Throw-Ins Won', numeric: true },
      { key: 'marks', label: 'Marks', numeric: true },
    ],
    goalkeepers: [
      { key: 'player', label: 'Player', render: renderPlayerCell },
      { key: 'team', label: 'Team', render: (row) => teamLabelForSide(row.team, homeTeam, awayTeam) },
      { key: 'kickoutsTaken', label: 'KOs Taken', numeric: true },
      { key: 'ownKickoutWinPct', label: 'Own KO Win %', numeric: true, sortValue: (row) => row.ownKickoutWinPct, render: (row) => row.kickoutsTaken ? `${row.ownKickoutsWon}/${row.kickoutsTaken} (${formatPct(row.ownKickoutWinPct)})` : 'NA' },
      { key: 'cleanKickoutWinPct', label: 'Clean KO Win %', numeric: true, sortValue: (row) => row.cleanKickoutWinPct, render: (row) => row.kickoutsTaken ? `${row.cleanKickoutsWon}/${row.kickoutsTaken} (${formatPct(row.cleanKickoutWinPct)})` : 'NA' },
      { key: 'shortKickoutsTaken', label: 'Short KOs', numeric: true },
      { key: 'longKickoutsTaken', label: 'Long KOs', numeric: true },
      { key: 'shortKickoutWinPct', label: 'Short Win %', numeric: true, sortValue: (row) => row.shortKickoutWinPct, render: (row) => row.shortKickoutsTaken ? `${row.shortKickoutsWon}/${row.shortKickoutsTaken} (${formatPct(row.shortKickoutWinPct)})` : 'NA' },
      { key: 'longKickoutWinPct', label: 'Long Win %', numeric: true, sortValue: (row) => row.longKickoutWinPct, render: (row) => row.longKickoutsTaken ? `${row.longKickoutsWon}/${row.longKickoutsTaken} (${formatPct(row.longKickoutWinPct)})` : 'NA' },
      { key: 'goalShotSavePct', label: 'Goal Shot Saves', numeric: true, sortValue: (row) => row.goalShotSavePct, render: (row) => (row.goalShotsSaved + row.goalShotsAgainst) ? `${row.goalShotsSaved}/${row.goalShotsSaved + row.goalShotsAgainst} (${formatPct(row.goalShotSavePct)})` : 'NA' },
    ],
  };
}

export default function PlayersAnalyticsTab(props) {
  return (
    <PlayersAnalyticsTabErrorBoundary>
      <PlayersAnalyticsTabContent {...props} />
    </PlayersAnalyticsTabErrorBoundary>
  );
}
