import {
  buildPlayerTimeAndPossessionStats,
  deriveMatchLengthMinutes,
  getShotExpectedPointsValue,
  isAttackPossession,
  isProgressive,
  normalizeDefenceSetRows,
  normalizeStatModelRows,
  rebuildPossessionRows,
  resolveTurnoverLostBySelection,
  shotOutcomeGroup,
  shotPointsForOutcome,
  shouldExcludeFromTotals,
} from '@/lib/reportAnalytics';
import { buildEffectiveMatchupStints } from '@/lib/defendingAllowed';
import { resolveMatchRosterPlayers } from '@/lib/matchRosterSnapshots';
import { groupByPossession, normalizePlayerRef } from '@/features/report/shared';
import { parseIdList } from '@/lib/teamWorkspaces';

export const SEASON_NORMALIZATION_OPTIONS = [
  { value: 'totals', label: 'Totals' },
  { value: 'per_game', label: 'Per Game' },
  { value: 'per_60', label: 'Per 60' },
  { value: 'per_70', label: 'Per 70' },
  { value: 'per_10_possessions', label: 'Possession Norm' },
];

export const SEASON_POSSESSION_DENOMINATOR_OPTIONS = [
  { value: 'own', label: 'Own Possessions' },
  { value: 'opp', label: 'Opp Possessions' },
  { value: 'combined', label: 'Combined Possessions' },
];

export const SEASON_TEAM_METRICS = [
  { key: 'pointsFor', label: 'Points For', family: 'attack', defaultPossessionDenominator: 'own' },
  { key: 'pointsAgainst', label: 'Points Against', family: 'defence', defaultPossessionDenominator: 'opp' },
  { key: 'shotsFor', label: 'Shots For', family: 'attack', defaultPossessionDenominator: 'own' },
  { key: 'shotsAgainst', label: 'Shots Against', family: 'defence', defaultPossessionDenominator: 'opp' },
  { key: 'xpFor', label: 'xP For', family: 'attack', decimals: 2, defaultPossessionDenominator: 'own' },
  { key: 'xpAgainst', label: 'xP Against', family: 'defence', decimals: 2, defaultPossessionDenominator: 'opp' },
  { key: 'turnoversWon', label: 'TO Won', family: 'defence', defaultPossessionDenominator: 'opp' },
  { key: 'turnoversLost', label: 'TO Lost', family: 'attack', defaultPossessionDenominator: 'own' },
  { key: 'progressiveActions', label: 'Progressive Actions', family: 'attack', defaultPossessionDenominator: 'own' },
  { key: 'kickoutsWon', label: 'Kickouts Won', family: 'restart', defaultPossessionDenominator: 'combined' },
  { key: 'kickoutsLost', label: 'Kickouts Lost', family: 'restart', defaultPossessionDenominator: 'combined' },
  { key: 'attackPossessions', label: 'Attack Possessions', family: 'attack', defaultPossessionDenominator: 'own' },
  { key: 'ownPossessions', label: 'Own Possessions', family: 'pace', defaultPossessionDenominator: 'own' },
  { key: 'oppPossessions', label: 'Opp Possessions', family: 'pace', defaultPossessionDenominator: 'opp' },
  { key: 'combinedPossessions', label: 'Combined Possessions', family: 'pace', defaultPossessionDenominator: 'combined' },
];

export const SEASON_PLAYER_METRICS = [
  { key: 'points', label: 'Points', family: 'attack', defaultPossessionDenominator: 'own' },
  { key: 'shots', label: 'Shots', family: 'attack', defaultPossessionDenominator: 'own' },
  { key: 'xp', label: 'xP', family: 'attack', decimals: 2, defaultPossessionDenominator: 'own' },
  { key: 'passes', label: 'Passes', family: 'attack', defaultPossessionDenominator: 'own' },
  { key: 'carries', label: 'Carries', family: 'attack', defaultPossessionDenominator: 'own' },
  { key: 'turnoversWon', label: 'TO Won', family: 'defence', defaultPossessionDenominator: 'opp' },
  { key: 'turnoversLost', label: 'TO Lost', family: 'attack', defaultPossessionDenominator: 'own' },
  { key: 'progressiveActions', label: 'Progressive Actions', family: 'attack', defaultPossessionDenominator: 'own' },
  { key: 'kickoutsWon', label: 'Kickouts Won', family: 'restart', defaultPossessionDenominator: 'combined' },
  { key: 'minutesPlayed', label: 'Minutes', family: 'time', disableNormalization: true },
];

function validSide(side) {
  return side === 'home' || side === 'away';
}

function otherSide(side) {
  return side === 'home' ? 'away' : side === 'away' ? 'home' : null;
}

function safeParse(extraData) {
  if (!extraData) return {};
  if (typeof extraData === 'object') return extraData || {};
  try {
    return JSON.parse(extraData) || {};
  } catch {
    return {};
  }
}

function sortStats(stats = []) {
  return (Array.isArray(stats) ? stats : []).slice().sort((left, right) => {
    const playDiff = Number(left?.play_id || 0) - Number(right?.play_id || 0);
    if (playDiff) return playDiff;
    const halfOrder = { first: 0, second: 1, et_first: 2, et_second: 3 };
    const halfDiff = (halfOrder[left?.half] ?? 99) - (halfOrder[right?.half] ?? 99);
    if (halfDiff) return halfDiff;
    const timeDiff = Number(left?.normalized_time_s || 0) - Number(right?.normalized_time_s || 0);
    if (timeDiff) return timeDiff;
    return String(left?.id || '').localeCompare(String(right?.id || ''));
  });
}

function getStatPeriodKey(stat) {
  const half = String(stat?.half || '').trim();
  return ['first', 'second', 'et_first', 'et_second'].includes(half) ? half : 'first';
}

function buildPossessionWindowsLocal(stats = []) {
  const ordered = sortStats(stats).filter((stat) => !['period_end', 'substitution'].includes(String(stat?.stat_type || '')));
  const grouped = new Map();
  for (const stat of ordered) {
    const periodKey = getStatPeriodKey(stat);
    const teamSide = validSide(stat?.possession_team_side) ? stat.possession_team_side : null;
    const possessionId = Number(stat?.possession_id);
    const timeSeconds = Number(stat?.normalized_time_s);
    if (!periodKey || !teamSide || !Number.isFinite(possessionId) || possessionId <= 0 || !Number.isFinite(timeSeconds)) continue;
    const key = `${periodKey}|${teamSide}|${possessionId}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(stat);
  }

  const rows = [];
  const perPeriod = new Map();
  for (const [key, evs] of grouped.entries()) {
    const [periodKey, teamSide, possessionIdRaw] = key.split('|');
    evs.sort((left, right) => Number(left?.normalized_time_s || 0) - Number(right?.normalized_time_s || 0));
    const row = {
      key,
      periodKey,
      teamSide,
      possessionId: Number(possessionIdRaw),
      startLoggedMinute: Number(evs[0]?.normalized_time_s || 0) / 60,
      endLoggedMinute: Number(evs[evs.length - 1]?.normalized_time_s || 0) / 60,
      stats: evs,
    };
    if (!perPeriod.has(periodKey)) perPeriod.set(periodKey, []);
    perPeriod.get(periodKey).push(row);
  }

  for (const periodRows of perPeriod.values()) {
    periodRows.sort((left, right) => {
      if (left.startLoggedMinute !== right.startLoggedMinute) return left.startLoggedMinute - right.startLoggedMinute;
      return left.possessionId - right.possessionId;
    });
    for (let index = 0; index < periodRows.length; index += 1) {
      const current = periodRows[index];
      const next = periodRows[index + 1] || null;
      let endLoggedMinute = current.endLoggedMinute;
      if ((!Number.isFinite(endLoggedMinute) || endLoggedMinute <= current.startLoggedMinute) && next) {
        endLoggedMinute = next.startLoggedMinute;
      }
      if (!Number.isFinite(endLoggedMinute) || endLoggedMinute < current.startLoggedMinute) {
        endLoggedMinute = current.startLoggedMinute;
      }
      rows.push({ ...current, endLoggedMinute });
    }
  }

  return rows;
}

function normalizePlayerSelection(selection, fallbackTeamSide = null) {
  const player = normalizePlayerRef(selection);
  if (!player) return null;
  return {
    id: player.id ? String(player.id) : null,
    name: player.name || '',
    number: Number.isFinite(Number(player.number)) ? Number(player.number) : null,
    team_side: validSide(player.team_side) ? player.team_side : fallbackTeamSide,
  };
}

function playerBucketKey(player, fallbackTeamSide = null) {
  const normalized = normalizePlayerSelection(player, fallbackTeamSide);
  if (!normalized?.id && !normalized?.name && normalized?.number == null) return null;
  return `${normalized?.team_side || fallbackTeamSide || 'unknown'}:${normalized?.id || normalized?.number || normalized?.name}`;
}

function ensurePlayerAggregate(map, selection, teamSide, teamsBySide, positionsById) {
  const normalized = normalizePlayerSelection(selection, teamSide);
  const key = playerBucketKey(normalized, teamSide);
  if (!key) return null;
  if (!map.has(key)) {
    map.set(key, {
      key,
      playerId: normalized?.id || null,
      name: normalized?.name || 'Unknown',
      number: normalized?.number ?? null,
      teamSide: normalized?.team_side || teamSide || 'unknown',
      teamName: teamsBySide[normalized?.team_side || teamSide || 'home']?.name || 'Unknown',
      position: positionsById.get(String(normalized?.id || '')) || '',
      gamesPlayed: 0,
      officialMinutes: 0,
      minutesPlayed: 0,
      ownPossessions: 0,
      oppPossessions: 0,
      totalPossessions: 0,
      points: 0,
      shots: 0,
      xp: 0,
      passes: 0,
      carries: 0,
      turnoversWon: 0,
      turnoversLost: 0,
      progressiveActions: 0,
      kickoutsWon: 0,
    });
  }
  return map.get(key);
}

function incrementPlayerMetric(map, selection, teamSide, teamsBySide, positionsById, metricKey, amount = 1) {
  const row = ensurePlayerAggregate(map, selection, teamSide, teamsBySide, positionsById);
  if (!row) return;
  row[metricKey] = Number(row?.[metricKey] || 0) + amount;
}

function addPlayerAppearanceData(map, playerTimeRows = {}, teamsBySide = {}, positionsById = new Map()) {
  for (const row of Object.values(playerTimeRows || {})) {
    const aggregate = ensurePlayerAggregate(map, {
      id: row.playerId,
      name: row.playerName,
      number: row.playerNumber,
      team_side: row.teamSide,
    }, row.teamSide, teamsBySide, positionsById);
    if (!aggregate) continue;
    aggregate.gamesPlayed += row.minutesPlayed > 0 ? 1 : 0;
    aggregate.officialMinutes += Number(row.rateMinutesBase || 0);
    aggregate.minutesPlayed += Number(row.minutesPlayed || 0);
    aggregate.ownPossessions += Number(row.ownPossessionsPlayed || 0);
    aggregate.oppPossessions += Number(row.oppPossessionsPlayed || 0);
    aggregate.totalPossessions += Number(row.totalPossessionsPlayed || 0);
  }
}

function getPerspectiveSide(match, perspectiveTeamRef) {
  if (!match?.id || !perspectiveTeamRef) return null;
  if (String(match?.home_team_id || '') === String(perspectiveTeamRef || '')) return 'home';
  if (String(match?.away_team_id || '') === String(perspectiveTeamRef || '')) return 'away';
  return null;
}

function buildTeamStatLine() {
  return {
    games: 0,
    officialMinutes: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    shotsFor: 0,
    shotsAgainst: 0,
    xpFor: 0,
    xpAgainst: 0,
    turnoversWon: 0,
    turnoversLost: 0,
    progressiveActions: 0,
    kickoutsWon: 0,
    kickoutsLost: 0,
    attackPossessions: 0,
    ownPossessions: 0,
    oppPossessions: 0,
    combinedPossessions: 0,
  };
}

function mergeMetricRows(target, source) {
  const next = { ...(target || {}) };
  for (const [key, value] of Object.entries(source || {})) {
    if (typeof value === 'number') next[key] = Number(next[key] || 0) + value;
  }
  return next;
}

function extractPassOutcome(extra) {
  return String(extra?.pass?.outcome || '').trim().toLowerCase();
}

function extractCarryOutcome(extra) {
  return String(extra?.carry?.outcome || '').trim().toLowerCase();
}

function buildTeamAndPlayerMetrics({
  match,
  stats,
  perspectiveSide,
  teamsBySide,
  playerTimeRows,
  positionsById,
}) {
  const team = buildTeamStatLine();
  team.games = 1;
  team.officialMinutes = deriveMatchLengthMinutes(match);
  const players = new Map();
  addPlayerAppearanceData(players, playerTimeRows, teamsBySide, positionsById);

  const ownPossGroups = [];
  const oppPossGroups = [];
  const possessionGroups = groupByPossession(stats);
  for (const [groupKey, events] of possessionGroups.entries()) {
    const side = String(groupKey || '').startsWith('home-') ? 'home' : String(groupKey || '').startsWith('away-') ? 'away' : null;
    if (!side) continue;
    if (side === perspectiveSide) ownPossGroups.push(events);
    else oppPossGroups.push(events);
  }
  team.ownPossessions = ownPossGroups.length;
  team.oppPossessions = oppPossGroups.length;
  team.combinedPossessions = ownPossGroups.length + oppPossGroups.length;
  team.attackPossessions = ownPossGroups.filter((events) => isAttackPossession(events, perspectiveSide)).length;

  for (const stat of Array.isArray(stats) ? stats : []) {
    if (!stat || shouldExcludeFromTotals(stat)) continue;
    const extra = safeParse(stat.extra_data);
    const teamSide = validSide(stat?.team_side) ? stat.team_side : null;

    if (stat.stat_type === 'shot') {
      const shotPlayer = extra?.shot?.player;
      const outcome = String(extra?.shot?.outcome || '');
      const points = shotPointsForOutcome(outcome);
      const xp = getShotExpectedPointsValue(stat);
      if (teamSide === perspectiveSide) {
        team.shotsFor += 1;
        team.pointsFor += points;
        team.xpFor += xp;
      } else if (validSide(teamSide)) {
        team.shotsAgainst += 1;
        team.pointsAgainst += points;
        team.xpAgainst += xp;
      }
      incrementPlayerMetric(players, shotPlayer, teamSide, teamsBySide, positionsById, 'shots', 1);
      incrementPlayerMetric(players, shotPlayer, teamSide, teamsBySide, positionsById, 'points', points);
      incrementPlayerMetric(players, shotPlayer, teamSide, teamsBySide, positionsById, 'xp', xp);
      continue;
    }

    if (stat.stat_type === 'pass') {
      const passer = extra?.pass?.passer;
      incrementPlayerMetric(players, passer, teamSide, teamsBySide, positionsById, 'passes', 1);
      if (teamSide === perspectiveSide && isProgressive(stat)) {
        team.progressiveActions += 1;
        incrementPlayerMetric(players, passer, teamSide, teamsBySide, positionsById, 'progressiveActions', 1);
      }
      if (extractPassOutcome(extra) === 'turnover') {
        const lostBy = resolveTurnoverLostBySelection(stat, extra);
        const lostSide = normalizePlayerSelection(lostBy, teamSide)?.team_side || teamSide;
        if (lostSide === perspectiveSide) team.turnoversLost += 1;
        else if (validSide(lostSide)) team.turnoversWon += 1;
        incrementPlayerMetric(players, lostBy, lostSide, teamsBySide, positionsById, 'turnoversLost', 1);
      }
      continue;
    }

    if (stat.stat_type === 'carry') {
      const carrier = extra?.carry?.carrier;
      incrementPlayerMetric(players, carrier, teamSide, teamsBySide, positionsById, 'carries', 1);
      if (teamSide === perspectiveSide && isProgressive(stat)) {
        team.progressiveActions += 1;
        incrementPlayerMetric(players, carrier, teamSide, teamsBySide, positionsById, 'progressiveActions', 1);
      }
      if (extractCarryOutcome(extra) === 'turnover') {
        const lostBy = resolveTurnoverLostBySelection(stat, extra);
        const lostSide = normalizePlayerSelection(lostBy, teamSide)?.team_side || teamSide;
        if (lostSide === perspectiveSide) team.turnoversLost += 1;
        else if (validSide(lostSide)) team.turnoversWon += 1;
        incrementPlayerMetric(players, lostBy, lostSide, teamsBySide, positionsById, 'turnoversLost', 1);
      }
      continue;
    }

    if (stat.stat_type === 'kickout') {
      const wonBy = extra?.kickout?.won_by;
      const lostBy = extra?.kickout?.lost_by;
      const wonSide = normalizePlayerSelection(wonBy, null)?.team_side || null;
      const lostSide = normalizePlayerSelection(lostBy, null)?.team_side || (validSide(wonSide) ? otherSide(wonSide) : null);
      if (wonSide === perspectiveSide) team.kickoutsWon += 1;
      if (lostSide === perspectiveSide) team.kickoutsLost += 1;
      incrementPlayerMetric(players, wonBy, wonSide, teamsBySide, positionsById, 'kickoutsWon', 1);
      continue;
    }

    if (stat.stat_type === 'turnover') {
      const recoveredBy = extra?.turnover?.recovered_by;
      const forcedBy = extra?.turnover?.forced_by;
      const lostBy = resolveTurnoverLostBySelection(stat, extra);
      const winnerSide = normalizePlayerSelection(recoveredBy, null)?.team_side
        || normalizePlayerSelection(forcedBy, null)?.team_side
        || otherSide(normalizePlayerSelection(lostBy, teamSide)?.team_side || teamSide);
      const lostSide = normalizePlayerSelection(lostBy, teamSide)?.team_side || teamSide;
      if (winnerSide === perspectiveSide) team.turnoversWon += 1;
      if (lostSide === perspectiveSide) team.turnoversLost += 1;
      incrementPlayerMetric(players, recoveredBy, winnerSide, teamsBySide, positionsById, 'turnoversWon', 1);
      incrementPlayerMetric(players, forcedBy, winnerSide, teamsBySide, positionsById, 'turnoversWon', 1);
      incrementPlayerMetric(players, lostBy, lostSide, teamsBySide, positionsById, 'turnoversLost', 1);
    }
  }

  return {
    team,
    players: Array.from(players.values()),
  };
}

function isPartialImportMatch(match) {
  return [
    match?.is_shared_copy,
    match?.is_stat_view_copy,
    match?.read_only_shared_view,
    match?.is_synced_import,
    match?.imported_from_snapshot_id,
    match?.shared_from_code,
  ].some(Boolean);
}

function buildMatchHealth({ match, stats, playerTimeAndPossessionStats }) {
  const reasons = [];
  if (String(match?.mode || 'analysis') !== 'analysis') {
    reasons.push('Season analytics is analysis-mode only in v1.');
    return { state: 'excluded', advancedEligible: false, reasons };
  }

  const possessionCount = groupByPossession(stats).size;
  if (!possessionCount) {
    reasons.push('No usable possession data was found for this match.');
    return { state: 'excluded', advancedEligible: false, reasons };
  }

  const hasRosterSnapshots = !!(match?.home_roster_snapshot || match?.away_roster_snapshot);
  const warnings = Array.isArray(playerTimeAndPossessionStats?.warnings) ? playerTimeAndPossessionStats.warnings : [];
  const lowConfidencePlayers = Object.values(playerTimeAndPossessionStats?.players || {}).filter((row) => String(row?.confidence || '') === 'low');
  const partialImport = isPartialImportMatch(match);

  if (!hasRosterSnapshots || lowConfidencePlayers.length > 0 || warnings.length > 0) {
    reasons.push('Lineup reconstruction has warnings, so on-field player and stint outputs are limited.');
    return { state: 'limited_lineups', advancedEligible: !partialImport, reasons };
  }

  if (partialImport) {
    reasons.push('Imported or shared copies are excluded from advanced season calculations by default.');
    return { state: 'partial_import', advancedEligible: false, reasons };
  }

  return { state: 'ready', advancedEligible: true, reasons };
}

function denominatorValue(row, denominatorMode, fallbackMode) {
  const mode = denominatorMode || fallbackMode || 'own';
  if (mode === 'opp') return Number(row?.oppPossessions || 0);
  if (mode === 'combined') return Number(row?.totalPossessions || row?.combinedPossessions || 0);
  return Number(row?.ownPossessions || 0);
}

export function normalizeMetricValue({ value, metric, row, normalizationMode, possessionDenominatorMode }) {
  if (!Number.isFinite(Number(value))) return 0;
  const raw = Number(value);
  if (!metric || normalizationMode === 'totals' || metric.disableNormalization) return raw;
  if (normalizationMode === 'per_game') {
    return row?.games > 0 ? raw / row.games : 0;
  }
  if (normalizationMode === 'per_60') {
    const minutes = Number(row?.officialMinutes || row?.minutesPlayed || 0);
    return minutes > 0 ? (raw / minutes) * 60 : 0;
  }
  if (normalizationMode === 'per_70') {
    const minutes = Number(row?.officialMinutes || row?.minutesPlayed || 0);
    return minutes > 0 ? (raw / minutes) * 70 : 0;
  }
  if (normalizationMode === 'per_10_possessions') {
    const denom = denominatorValue(row, possessionDenominatorMode, metric.defaultPossessionDenominator);
    return denom > 0 ? (raw / denom) * 10 : 0;
  }
  return raw;
}

export function formatSeasonMetricValue(value, metric, normalizationMode) {
  const numeric = Number(value || 0);
  const decimals = metric?.decimals ?? (normalizationMode === 'totals' ? 0 : 1);
  return Number.isFinite(numeric) ? numeric.toFixed(decimals) : '0';
}

function averageMetricAcrossRows(rows, metricKey) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return 0;
  return list.reduce((sum, row) => sum + Number(row?.[metricKey] || 0), 0) / list.length;
}

function buildPlayerPositionAverageRows(players, metricKey) {
  const byPosition = new Map();
  for (const player of Array.isArray(players) ? players : []) {
    const key = player?.position || 'Unknown';
    if (!byPosition.has(key)) byPosition.set(key, []);
    byPosition.get(key).push(player);
  }
  const averages = new Map();
  for (const [position, rows] of byPosition.entries()) {
    averages.set(position, averageMetricAcrossRows(rows, metricKey));
  }
  return averages;
}

function aggregateTeamRows(rows = []) {
  return rows.reduce((acc, row) => mergeMetricRows(acc, row), buildTeamStatLine());
}

function aggregatePlayerRows(rows = []) {
  const byKey = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = String(row?.key || '');
    if (!key) continue;
    const current = byKey.get(key) || {
      ...row,
      gamesPlayed: 0,
      officialMinutes: 0,
      minutesPlayed: 0,
      ownPossessions: 0,
      oppPossessions: 0,
      totalPossessions: 0,
      points: 0,
      shots: 0,
      xp: 0,
      passes: 0,
      carries: 0,
      turnoversWon: 0,
      turnoversLost: 0,
      progressiveActions: 0,
      kickoutsWon: 0,
    };
    for (const [metricKey, value] of Object.entries(row || {})) {
      if (typeof value === 'number') current[metricKey] = Number(current[metricKey] || 0) + value;
    }
    byKey.set(key, current);
  }
  return Array.from(byKey.values()).sort((left, right) => {
    const pointsDiff = Number(right?.points || 0) - Number(left?.points || 0);
    if (pointsDiff) return pointsDiff;
    return String(left?.name || '').localeCompare(String(right?.name || ''));
  });
}

function buildStintWindowsFromRows(includedRows, excludedRows) {
  if (!includedRows.length) return { minutes: 0, ownIds: new Set(), oppIds: new Set(), totalIds: new Set() };
  const ownSets = includedRows.map((row) => new Set(Array.isArray(row?.ownPossessionIdsPlayed) ? row.ownPossessionIdsPlayed : []));
  const oppSets = includedRows.map((row) => new Set(Array.isArray(row?.oppPossessionIdsPlayed) ? row.oppPossessionIdsPlayed : []));
  const totalSets = includedRows.map((row) => new Set(Array.isArray(row?.totalPossessionIdsPlayed) ? row.totalPossessionIdsPlayed : []));

  const intersectSets = (sets) => {
    if (!sets.length) return new Set();
    const [first, ...rest] = sets;
    const out = new Set(Array.from(first).filter((value) => rest.every((set) => set.has(value))));
    return out;
  };

  const ownIds = intersectSets(ownSets);
  const oppIds = intersectSets(oppSets);
  const totalIds = intersectSets(totalSets);

  for (const row of excludedRows) {
    const remove = (values = []) => values.forEach((value) => {
      ownIds.delete(value);
      oppIds.delete(value);
      totalIds.delete(value);
    });
    remove(Array.isArray(row?.totalPossessionIdsPlayed) ? row.totalPossessionIdsPlayed : []);
  }

  const windowsByPlayer = includedRows.map((row) => Array.isArray(row?.stints) ? row.stints : []);
  let windows = windowsByPlayer[0].map((stint) => ({
    periodKey: stint.periodKey,
    start: Number(stint.startLoggedMinute || 0),
    end: Number(stint.endLoggedMinute || 0),
  }));

  const intersectWindows = (base, next) => {
    const out = [];
    for (const left of base) {
      for (const right of next) {
        if (left.periodKey !== right.periodKey) continue;
        const start = Math.max(left.start, Number(right.startLoggedMinute || 0));
        const end = Math.min(left.end, Number(right.endLoggedMinute || 0));
        if (end > start) out.push({ periodKey: left.periodKey, start, end });
      }
    }
    return out;
  };

  for (let index = 1; index < windowsByPlayer.length; index += 1) {
    windows = intersectWindows(windows, windowsByPlayer[index]);
  }

  for (const row of excludedRows) {
    const excludeWindows = Array.isArray(row?.stints) ? row.stints : [];
    const nextWindows = [];
    for (const window of windows) {
      let fragments = [window];
      for (const exclude of excludeWindows) {
        if (window.periodKey !== exclude.periodKey) continue;
        const excludeStart = Number(exclude.startLoggedMinute || 0);
        const excludeEnd = Number(exclude.endLoggedMinute || 0);
        fragments = fragments.flatMap((fragment) => {
          if (fragment.periodKey !== exclude.periodKey || excludeEnd <= fragment.start || excludeStart >= fragment.end) {
            return [fragment];
          }
          const pieces = [];
          if (excludeStart > fragment.start) pieces.push({ ...fragment, end: excludeStart });
          if (excludeEnd < fragment.end) pieces.push({ ...fragment, start: excludeEnd });
          return pieces;
        });
      }
      nextWindows.push(...fragments);
    }
    windows = nextWindows;
  }

  const minutes = windows.reduce((sum, window) => sum + Math.max(0, window.end - window.start), 0);
  return { minutes, ownIds, oppIds, totalIds };
}

function aggregateMetricsForPossessionKeys(context, possessionKeys) {
  const byWindowKey = new Map(context.possessionWindows.map((window) => [window.key, window]));
  const stats = [];
  for (const key of possessionKeys) {
    const window = byWindowKey.get(key);
    if (!window) continue;
    stats.push(...window.stats);
  }
  const metrics = buildTeamAndPlayerMetrics({
    match: context.match,
    stats,
    perspectiveSide: context.perspectiveSide,
    teamsBySide: context.teamsBySide,
    playerTimeRows: {},
    positionsById: context.positionsById,
  }).team;
  metrics.games = 0;
  metrics.officialMinutes = 0;
  metrics.ownPossessions = Array.from(possessionKeys).filter((key) => String(key || '').includes(`|${context.perspectiveSide}|`)).length;
  metrics.oppPossessions = Array.from(possessionKeys).length - metrics.ownPossessions;
  metrics.combinedPossessions = Array.from(possessionKeys).length;
  return metrics;
}

function buildContext({
  match,
  perspectiveTeamRef,
  teamsById,
  playersByTeamId,
  rawStats,
  rawMatchupStints,
}) {
  const perspectiveSide = getPerspectiveSide(match, perspectiveTeamRef);
  if (!perspectiveSide) return null;
  const opponentSide = otherSide(perspectiveSide);
  const ownTeam = teamsById.get(String(perspectiveTeamRef || '')) || null;
  const opponentTeam = teamsById.get(String(perspectiveSide === 'home' ? match?.away_team_id : match?.home_team_id || '')) || null;
  const homeTeam = teamsById.get(String(match?.home_team_id || '')) || null;
  const awayTeam = teamsById.get(String(match?.away_team_id || '')) || null;
  const homePlayers = resolveMatchRosterPlayers(match?.home_roster_snapshot, playersByTeamId.get(String(match?.home_team_id || '')) || [], match?.home_team_id || null);
  const awayPlayers = resolveMatchRosterPlayers(match?.away_roster_snapshot, playersByTeamId.get(String(match?.away_team_id || '')) || [], match?.away_team_id || null);
  const playerOptions = [...homePlayers, ...awayPlayers];
  const positionsById = new Map(playerOptions.filter((player) => player?.id).map((player) => [String(player.id), player.position || '']));
  const normalizedStats = rebuildPossessionRows(normalizeStatModelRows(normalizeDefenceSetRows((Array.isArray(rawStats) ? rawStats : []).filter((stat) => stat?.stat_type !== 'defensive_contact'))));
  const sortedStats = sortStats(normalizedStats);
  const playerTimeAndPossessionStats = buildPlayerTimeAndPossessionStats({
    match,
    stats: sortedStats,
    playerOptions,
    homeTeam,
    awayTeam,
  });
  const effectiveMatchupStints = buildEffectiveMatchupStints({
    match,
    stats: sortedStats,
    matchupStints: rawMatchupStints,
    playerOptions,
    playerTimeAndPossessionStats,
  });
  const health = buildMatchHealth({
    match,
    stats: sortedStats,
    playerTimeAndPossessionStats,
  });
  const metrics = buildTeamAndPlayerMetrics({
    match,
    stats: sortedStats,
    perspectiveSide,
    teamsBySide: { home: homeTeam, away: awayTeam },
    playerTimeRows: playerTimeAndPossessionStats.players,
    positionsById,
  });
  return {
    match,
    perspectiveTeamRef,
    perspectiveSide,
    opponentSide,
    ownTeam,
    opponentTeam,
    homeTeam,
    awayTeam,
    homePlayers,
    awayPlayers,
    playerOptions,
    positionsById,
    stats: sortedStats,
    possessionWindows: buildPossessionWindowsLocal(sortedStats),
    playerTimeAndPossessionStats,
    effectiveMatchupStints,
    health,
    teamMetrics: metrics.team,
    playerMetrics: metrics.players,
    teamsBySide: { home: homeTeam, away: awayTeam },
  };
}

function summarizeContexts(contexts = []) {
  const teamRows = contexts.map((context) => ({
    ...context.teamMetrics,
    totalPossessions: context.teamMetrics.combinedPossessions,
  }));
  const teamAggregate = aggregateTeamRows(teamRows);
  teamAggregate.totalPossessions = teamAggregate.combinedPossessions;
  const playerRows = aggregatePlayerRows(contexts.flatMap((context) => context.playerMetrics.map((row) => ({
    ...row,
    games: row.gamesPlayed,
    totalPossessions: row.totalPossessions,
  }))));
  return { teamAggregate, playerRows };
}

export function buildSeasonAnalytics({
  workspace,
  selectedGroupId,
  allMatches = [],
  allTeams = [],
  allPlayers = [],
  allStats = [],
  allMatchupStints = [],
  allGroups = [],
  allGroupMatches = [],
  allStintPresets = [],
}) {
  if (!workspace?.id) {
    return {
      linkedMatches: [],
      selectedMatchContexts: [],
      advancedContexts: [],
      teamAggregate: buildTeamStatLine(),
      playerRows: [],
      opponentRows: [],
      stintRows: [],
      groups: [],
      selectedGroup: null,
    };
  }

  const teamsById = new Map((Array.isArray(allTeams) ? allTeams : []).filter((team) => team?.id).map((team) => [String(team.id), team]));
  const playersByTeamId = new Map();
  for (const player of Array.isArray(allPlayers) ? allPlayers : []) {
    const key = String(player?.team_id || '');
    if (!playersByTeamId.has(key)) playersByTeamId.set(key, []);
    playersByTeamId.get(key).push(player);
  }
  const statsByMatchId = new Map();
  for (const stat of Array.isArray(allStats) ? allStats : []) {
    const key = String(stat?.match_id || '');
    if (!statsByMatchId.has(key)) statsByMatchId.set(key, []);
    statsByMatchId.get(key).push(stat);
  }
  const matchupByMatchId = new Map();
  for (const row of Array.isArray(allMatchupStints) ? allMatchupStints : []) {
    const key = String(row?.match_id || '');
    if (!matchupByMatchId.has(key)) matchupByMatchId.set(key, []);
    matchupByMatchId.get(key).push(row);
  }

  const linkedMatches = (Array.isArray(allMatches) ? allMatches : []).filter((match) => String(match?.team_workspace_id || '') === String(workspace.id || ''));
  const groups = (Array.isArray(allGroups) ? allGroups : []).filter((group) => String(group?.workspace_id || '') === String(workspace.id || '') && !group?.archived_at);
  const groupMatches = (Array.isArray(allGroupMatches) ? allGroupMatches : []).filter((row) => groups.some((group) => String(group.id) === String(row?.group_id || '')));
  const selectedGroup = groups.find((group) => String(group.id) === String(selectedGroupId || '')) || null;

  const defaultRows = linkedMatches.map((match) => ({
    id: `workspace:${match.id}`,
    group_id: '__workspace__',
    match_id: match.id,
    perspective_team_ref: match?.workspace_perspective_team_ref || workspace.primary_team_ref || null,
    is_scouting_match: String(match?.workspace_perspective_team_ref || workspace.primary_team_ref || '') !== String(workspace.primary_team_ref || ''),
    include_in_advanced: !isPartialImportMatch(match),
  }));
  const selectedRows = selectedGroup
    ? groupMatches.filter((row) => String(row?.group_id || '') === String(selectedGroup.id || ''))
    : defaultRows;

  const contextCache = new Map();
  const getContext = (matchId, perspectiveTeamRef) => {
    const cacheKey = `${matchId}|${perspectiveTeamRef || 'none'}`;
    if (contextCache.has(cacheKey)) return contextCache.get(cacheKey);
    const match = (Array.isArray(allMatches) ? allMatches : []).find((row) => String(row?.id || '') === String(matchId || ''));
    if (!match?.id) {
      contextCache.set(cacheKey, null);
      return null;
    }
    const context = buildContext({
      match,
      perspectiveTeamRef,
      teamsById,
      playersByTeamId,
      rawStats: statsByMatchId.get(String(match.id)) || [],
      rawMatchupStints: matchupByMatchId.get(String(match.id)) || [],
    });
    contextCache.set(cacheKey, context);
    return context;
  };

  const selectedMatchContexts = selectedRows
    .map((row) => {
      const context = getContext(row?.match_id, row?.perspective_team_ref || workspace.primary_team_ref || null);
      if (!context) return null;
      return {
        ...context,
        groupRow: row,
        advancedIncluded: context.health.advancedEligible || !!row?.include_in_advanced,
      };
    })
    .filter(Boolean);

  const advancedContexts = selectedMatchContexts.filter((context) => context.advancedIncluded && context.health.state !== 'excluded');
  const { teamAggregate, playerRows } = summarizeContexts(advancedContexts);
  teamAggregate.totalPossessions = teamAggregate.combinedPossessions;

  const opponentIds = Array.from(new Set(advancedContexts.map((context) => String(context?.opponentTeam?.id || '')).filter(Boolean)));
  const opponentRows = opponentIds.map((opponentId) => {
    const selectedForOpponent = advancedContexts.filter((context) => String(context?.opponentTeam?.id || '') === opponentId);
    const overallContexts = (Array.isArray(allMatches) ? allMatches : [])
      .filter((match) => String(match?.home_team_id || '') === opponentId || String(match?.away_team_id || '') === opponentId)
      .map((match) => getContext(match.id, opponentId))
      .filter((context) => context && context.health.state !== 'excluded');
    const vsWorkspaceContexts = overallContexts.filter((context) => String(context?.opponentTeam?.id || '') === String(workspace.primary_team_ref || ''));
    const selectedAggregate = summarizeContexts(selectedForOpponent).teamAggregate;
    const overallAggregate = summarizeContexts(overallContexts).teamAggregate;
    const vsWorkspaceAggregate = summarizeContexts(vsWorkspaceContexts).teamAggregate;
    return {
      opponentId,
      opponentName: selectedForOpponent[0]?.opponentTeam?.name || overallContexts[0]?.ownTeam?.name || 'Opponent',
      selectedAggregate,
      overallAggregate,
      vsWorkspaceAggregate,
      selectedGames: selectedForOpponent.length,
      overallGames: overallContexts.length,
      vsWorkspaceGames: vsWorkspaceContexts.length,
    };
  }).sort((left, right) => left.opponentName.localeCompare(right.opponentName));

  const presetRows = (Array.isArray(allStintPresets) ? allStintPresets : [])
    .filter((preset) => String(preset?.workspace_id || '') === String(workspace.id || ''))
    .map((preset) => {
      const includeIds = parseIdList(preset?.include_player_refs);
      const excludeIds = parseIdList(preset?.exclude_player_refs);
      let minutes = 0;
      let games = 0;
      const possessionKeys = new Set();
      for (const context of advancedContexts) {
        const playerRowsById = new Map(Object.values(context.playerTimeAndPossessionStats?.players || {}).map((row) => [String(row?.playerId || ''), row]));
        const includedRows = includeIds.map((id) => playerRowsById.get(String(id))).filter(Boolean);
        if (!includedRows.length) continue;
        const excludedRows = excludeIds.map((id) => playerRowsById.get(String(id))).filter(Boolean);
        const selection = buildStintWindowsFromRows(includedRows, excludedRows);
        if (selection.minutes <= 0 && selection.totalIds.size === 0) continue;
        minutes += selection.minutes;
        games += 1;
        Array.from(selection.totalIds).forEach((key) => possessionKeys.add(key));
      }
      const metrics = advancedContexts.reduce((acc, context) => mergeMetricRows(acc, aggregateMetricsForPossessionKeys(context, possessionKeys)), buildTeamStatLine());
      metrics.games = games;
      metrics.officialMinutes = minutes;
      metrics.totalPossessions = metrics.combinedPossessions;
      return {
        id: preset.id,
        name: preset.name || 'Preset',
        notes: preset.notes || '',
        includeIds,
        excludeIds,
        metrics,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    linkedMatches,
    groups,
    selectedGroup,
    selectedMatchContexts,
    advancedContexts,
    teamAggregate,
    playerRows,
    opponentRows,
    stintRows: presetRows,
    teamMetricOptions: SEASON_TEAM_METRICS,
    playerMetricOptions: SEASON_PLAYER_METRICS,
    normalizationOptions: SEASON_NORMALIZATION_OPTIONS,
    possessionDenominatorOptions: SEASON_POSSESSION_DENOMINATOR_OPTIONS,
    buildPlayerPositionAverageRows: (metricKey) => buildPlayerPositionAverageRows(playerRows, metricKey),
  };
}
