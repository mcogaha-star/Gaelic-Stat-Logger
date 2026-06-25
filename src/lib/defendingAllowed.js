import {
  extractFoulFromStat,
  formatHalfClock,
  getMatchSectionOffsets,
  getNormalizedTimeS,
  getOfficialPeriodLengthMinutes,
  getProgressiveMeters,
  isProgressive,
  shotPointsForOutcome,
} from '@/lib/reportAnalytics';

function safeParseJSON(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function normalizeTeamSide(value) {
  return value === 'home' || value === 'away' ? value : null;
}

function normalizeSelection(selection, playerMaps) {
  if (!selection || typeof selection !== 'object') return null;
  const teamSide = normalizeTeamSide(selection.team_side);
  const id = selection.id ? String(selection.id) : '';
  if (teamSide && id) {
    const direct = playerMaps.byId.get(`${teamSide}|${id}`);
    if (direct) return direct;
  }
  const number = selection.number != null ? String(selection.number).trim() : '';
  if (teamSide && number) {
    const byNumber = playerMaps.byTeamNumber.get(`${teamSide}|${number}`);
    if (byNumber) return byNumber;
  }
  const name = String(selection.name || '').trim().toLowerCase();
  if (teamSide && name) {
    const byName = playerMaps.byTeamName.get(`${teamSide}|${name}`);
    if (byName) return byName;
  }
  if (!teamSide || (!id && !number && !name)) return null;
  return {
    id: id || null,
    team_side: teamSide,
    number: selection.number ?? null,
    name: String(selection.name || '').trim(),
  };
}

function buildPlayerMaps(playerOptions = []) {
  const byId = new Map();
  const byTeamNumber = new Map();
  const byTeamName = new Map();
  for (const player of Array.isArray(playerOptions) ? playerOptions : []) {
    const teamSide = normalizeTeamSide(player?.team_side);
    const id = player?.id ? String(player.id) : '';
    if (!teamSide || !id) continue;
    byId.set(`${teamSide}|${id}`, player);
    if (player?.number != null && String(player.number).trim() !== '') {
      byTeamNumber.set(`${teamSide}|${String(player.number).trim()}`, player);
    }
    const name = String(player?.name || '').trim().toLowerCase();
    if (name) byTeamName.set(`${teamSide}|${name}`, player);
  }
  return { byId, byTeamNumber, byTeamName };
}

function playerKeyFromPlayer(player) {
  const teamSide = normalizeTeamSide(player?.team_side);
  const id = player?.id ? String(player.id) : '';
  if (!teamSide || !id) return null;
  return `${teamSide}|${id}`;
}

function playerLabel(player) {
  if (!player) return 'Unknown';
  const bits = [];
  if (player?.number != null && String(player.number).trim() !== '') bits.push(`#${player.number}`);
  if (player?.name) bits.push(String(player.name).trim());
  return bits.join(' ').trim() || 'Unknown';
}

const MATCHUP_PERIOD_ORDER = ['first', 'second', 'et_first', 'et_second'];

function normalizePositionToken(position) {
  const raw = String(position || '').trim().toLowerCase();
  if (!raw) return '';
  const text = raw.replace(/-/g, ' ').replace(/\s+/g, ' ');
  if (text === 'gk' || text.includes('goalkeeper')) return 'goalkeeper';
  if (text.includes('midfield')) return 'midfielder';
  if (text.includes('corner') && text.includes('back')) return 'corner-back';
  if (text.includes('full') && text.includes('back')) return 'full-back';
  if ((text.includes('centre') || text.includes('center')) && text.includes('back')) return 'centre-half-back';
  if (text.includes('wing') && text.includes('back')) return 'wing-back';
  if (text.includes('corner') && text.includes('forward')) return 'corner-forward';
  if (text.includes('full') && text.includes('forward')) return 'full-forward';
  if ((text.includes('centre') || text.includes('center')) && text.includes('forward')) return 'centre-half-forward';
  if (text.includes('wing') && text.includes('forward')) return 'wing-forward';
  if (text.includes('back')) return 'back';
  if (text.includes('forward')) return 'forward';
  return text;
}

function counterpartPositionToken(token) {
  const map = {
    goalkeeper: 'goalkeeper',
    midfielder: 'midfielder',
    'corner-back': 'corner-forward',
    'full-back': 'full-forward',
    'centre-half-back': 'centre-half-forward',
    'wing-back': 'wing-forward',
    'corner-forward': 'corner-back',
    'full-forward': 'full-back',
    'centre-half-forward': 'centre-half-back',
    'wing-forward': 'wing-back',
    back: 'forward',
    forward: 'back',
  };
  return map[token] || '';
}

function positionPriority(token) {
  const order = {
    goalkeeper: 0,
    'corner-back': 1,
    'full-back': 2,
    'wing-back': 3,
    'centre-half-back': 4,
    midfielder: 5,
    'centre-half-forward': 6,
    'wing-forward': 7,
    'full-forward': 8,
    'corner-forward': 9,
    back: 10,
    forward: 11,
  };
  return order[token] ?? 99;
}

function scoreSlotPair(leftToken, rightToken) {
  const target = counterpartPositionToken(leftToken);
  if (target && rightToken === target) return 100;
  if (leftToken === 'goalkeeper' && rightToken === 'goalkeeper') return 100;
  if (leftToken === 'midfielder' && rightToken === 'midfielder') return 95;
  if ((leftToken.includes('back') || leftToken === 'back') && (rightToken.includes('forward') || rightToken === 'forward')) return 80;
  if ((leftToken.includes('forward') || leftToken === 'forward') && (rightToken.includes('back') || rightToken === 'back')) return 80;
  if (!leftToken || !rightToken) return 5;
  return 10;
}

function getSelectionCandidateSides(selection, playerMaps) {
  const sides = new Set();
  const id = selection?.id ? String(selection.id) : '';
  if (id) {
    for (const teamSide of ['home', 'away']) {
      if (playerMaps.byId.has(`${teamSide}|${id}`)) sides.add(teamSide);
    }
    if (sides.size) return Array.from(sides);
  }
  const number = selection?.number != null ? String(selection.number).trim() : '';
  if (number) {
    for (const teamSide of ['home', 'away']) {
      if (playerMaps.byTeamNumber.has(`${teamSide}|${number}`)) sides.add(teamSide);
    }
  }
  const name = String(selection?.name || '').trim().toLowerCase();
  if (name) {
    for (const teamSide of ['home', 'away']) {
      if (playerMaps.byTeamName.has(`${teamSide}|${name}`)) sides.add(teamSide);
    }
  }
  return Array.from(sides);
}

function resolveSelectionAcrossTeams(selection, playerMaps, preferredTeamSide = null) {
  if (!selection || typeof selection !== 'object') return null;
  if (preferredTeamSide) {
    const preferred = normalizeSelection({ ...selection, team_side: preferredTeamSide }, playerMaps);
    if (preferred) return preferred;
  }
  const candidateSides = getSelectionCandidateSides(selection, playerMaps);
  if (candidateSides.length !== 1) return null;
  return normalizeSelection({ ...selection, team_side: candidateSides[0] }, playerMaps);
}

export function buildMatchupPeriodMaxSeconds({ stats = [], match = null, imputedTimeById = null } = {}) {
  const result = {};
  for (const periodKey of MATCHUP_PERIOD_ORDER) {
    const periodStats = (Array.isArray(stats) ? stats : []).filter((stat) => String(stat?.half || '') === periodKey);
    const officialSeconds = getOfficialPeriodLengthMinutes(match, periodKey) * 60;
    if (!periodStats.length) {
      result[periodKey] = periodKey.startsWith('et_') ? 0 : officialSeconds;
      continue;
    }
    const periodEndMax = periodStats
      .filter((stat) => String(stat?.stat_type || '') === 'period_end')
      .map((stat) => getNormalizedTimeS(stat, imputedTimeById))
      .filter(Number.isFinite)
      .reduce((max, value) => Math.max(max, value), 0);
    const latestEventMax = periodStats
      .map((stat) => getNormalizedTimeS(stat, imputedTimeById))
      .filter(Number.isFinite)
      .reduce((max, value) => Math.max(max, value), 0);
    result[periodKey] = Math.max(officialSeconds, periodEndMax || latestEventMax || 0);
  }
  return result;
}

function buildNormalizedSubstitutionRows(stats = [], playerMaps, imputedTimeById = null) {
  return (Array.isArray(stats) ? stats : [])
    .filter((stat) => String(stat?.stat_type || '') === 'substitution')
    .map((stat) => {
      const extra = safeParseJSON(stat?.extra_data || '{}', {});
      const rawTeamSide = normalizeTeamSide(stat?.team_side);
      const offSelection = {
        id: extra?.sub_out_id || extra?.player_off_id || null,
        number: stat?.player_number ?? extra?.sub_out_number ?? null,
        name: stat?.player_name || extra?.sub_out_name || '',
        team_side: rawTeamSide,
      };
      const onSelection = {
        id: extra?.sub_in_id || extra?.player_on_id || null,
        number: stat?.recipient_number ?? extra?.sub_in_number ?? null,
        name: stat?.recipient_name || extra?.sub_in_name || '',
        team_side: rawTeamSide,
      };
      let playerOff = rawTeamSide ? normalizeSelection(offSelection, playerMaps) : null;
      let playerOn = rawTeamSide ? normalizeSelection(onSelection, playerMaps) : null;
      if (!playerOff) playerOff = resolveSelectionAcrossTeams(offSelection, playerMaps, rawTeamSide);
      if (!playerOn) playerOn = resolveSelectionAcrossTeams(onSelection, playerMaps, rawTeamSide);
      const offSide = normalizeTeamSide(playerOff?.team_side);
      const onSide = normalizeTeamSide(playerOn?.team_side);
      const teamSide = rawTeamSide || offSide || onSide || null;
      const timeSeconds = getNormalizedTimeS(stat, imputedTimeById);
      if (!teamSide || !Number.isFinite(timeSeconds) || !MATCHUP_PERIOD_ORDER.includes(String(stat?.half || ''))) return null;
      return {
        statId: stat?.id || null,
        periodKey: String(stat?.half || ''),
        teamSide,
        offKey: playerKeyFromPlayer(playerOff),
        onKey: playerKeyFromPlayer(playerOn),
        offPlayer: playerOff || null,
        onPlayer: playerOn || null,
        timeSeconds: Math.max(0, Number(timeSeconds) || 0),
        playId: Number.isFinite(Number(stat?.play_id)) ? Number(stat.play_id) : null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const periodDiff = MATCHUP_PERIOD_ORDER.indexOf(a.periodKey) - MATCHUP_PERIOD_ORDER.indexOf(b.periodKey);
      if (periodDiff !== 0) return periodDiff;
      if (a.timeSeconds !== b.timeSeconds) return a.timeSeconds - b.timeSeconds;
      if (a.playId !== b.playId) return (a.playId ?? -1) - (b.playId ?? -1);
      return String(a.statId || '').localeCompare(String(b.statId || ''));
    });
}

function buildStartersBySide(playerOptions = [], playerTimeAndPossessionStats = null) {
  const playerMetaByKey = new Map();
  for (const player of Array.isArray(playerOptions) ? playerOptions : []) {
    const key = playerKeyFromPlayer(player);
    if (key) playerMetaByKey.set(key, player);
  }
  const players = Object.values(playerTimeAndPossessionStats?.players || {});
  const bySide = { home: [], away: [] };
  for (const row of players) {
    if (!row?.started || !normalizeTeamSide(row.teamSide)) continue;
    const key = row.playerKey || `${row.teamSide}|${row.playerId}`;
    const meta = playerMetaByKey.get(key) || {};
    bySide[row.teamSide].push({
      key,
      id: row.playerId || meta.id || null,
      team_side: row.teamSide,
      number: meta.number ?? row.playerNumber ?? null,
      name: meta.name || row.playerName || '',
      position: meta.position || row.position || '',
    });
  }
  for (const teamSide of ['home', 'away']) {
    bySide[teamSide].sort((left, right) => {
      const leftToken = normalizePositionToken(left.position);
      const rightToken = normalizePositionToken(right.position);
      const priorityDiff = positionPriority(leftToken) - positionPriority(rightToken);
      if (priorityDiff !== 0) return priorityDiff;
      const leftNumber = Number(left.number);
      const rightNumber = Number(right.number);
      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) return leftNumber - rightNumber;
      return String(left.name || '').localeCompare(String(right.name || ''), undefined, { numeric: true, sensitivity: 'base' });
    });
  }
  return bySide;
}

function buildPeriodStartPlayerKeysBySide(playerTimeAndPossessionStats = null) {
  const byPeriod = {};
  for (const periodKey of MATCHUP_PERIOD_ORDER) {
    byPeriod[periodKey] = { home: [], away: [] };
  }
  for (const row of Object.values(playerTimeAndPossessionStats?.players || {})) {
    const teamSide = normalizeTeamSide(row?.teamSide);
    if (!teamSide) continue;
    for (const stint of Array.isArray(row?.stints) ? row.stints : []) {
      const periodKey = String(stint?.periodKey || '');
      if (!MATCHUP_PERIOD_ORDER.includes(periodKey)) continue;
      if (Math.abs(Number(stint?.startLoggedMinute || 0)) > 0.0001) continue;
      if (!byPeriod[periodKey][teamSide].includes(row.playerKey)) {
        byPeriod[periodKey][teamSide].push(row.playerKey);
      }
    }
  }
  return byPeriod;
}

function realignSlotsForPeriodStart(teamSlots = [], activePlayerKeys = [], playerMetaByKey = new Map()) {
  const activeSet = new Set(activePlayerKeys.filter(Boolean));
  if (!activeSet.size) return;
  const remainingPlayers = [...activeSet].map((playerKey) => {
    const player = playerMetaByKey.get(playerKey) || null;
    return {
      key: playerKey,
      token: normalizePositionToken(player?.position),
    };
  });

  const scoreSameSideSlotFit = (slot, candidate) => {
    let score = 0;
    if (slot.currentPlayerKey === candidate.key) score += 1000;
    if (slot.basePositionToken && candidate.token && slot.basePositionToken === candidate.token) score += 500;
    else if (slot.basePositionToken === 'midfielder' && candidate.token === 'midfielder') score += 450;
    else if ((slot.basePositionToken.includes('back') || slot.basePositionToken === 'back') && (candidate.token.includes('back') || candidate.token === 'back')) score += 350;
    else if ((slot.basePositionToken.includes('forward') || slot.basePositionToken === 'forward') && (candidate.token.includes('forward') || candidate.token === 'forward')) score += 350;
    else if (slot.basePositionToken === 'goalkeeper' && candidate.token === 'goalkeeper') score += 500;
    score -= Math.abs(positionPriority(slot.basePositionToken) - positionPriority(candidate.token));
    return score;
  };

  for (const slot of teamSlots) {
    if (!remainingPlayers.length) {
      slot.currentPlayerKey = null;
      continue;
    }
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let index = 0; index < remainingPlayers.length; index += 1) {
      const score = scoreSameSideSlotFit(slot, remainingPlayers[index]);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    slot.currentPlayerKey = remainingPlayers.splice(bestIndex, 1)[0]?.key || null;
  }
}

function ensureUniqueCurrentPlayerAssignment(teamSlots = [], playerKey, preferredSlotKey = null) {
  if (!playerKey) return;
  for (const slot of teamSlots) {
    if (slot.slotKey === preferredSlotKey) continue;
    if (slot.currentPlayerKey === playerKey) {
      slot.currentPlayerKey = null;
      slot.lastChangePeriodKey = slot.lastChangePeriodKey || null;
      slot.lastEnteredBySub = false;
    }
  }
}

function buildSlotAssignments({ stats = [], match = null, playerOptions = [], playerTimeAndPossessionStats = null, imputedTimeById = null }) {
  const startersBySide = buildStartersBySide(playerOptions, playerTimeAndPossessionStats);
  const substitutions = buildNormalizedSubstitutionRows(stats, buildPlayerMaps(playerOptions), imputedTimeById);
  const periodMaxSeconds = buildMatchupPeriodMaxSeconds({ stats, match, imputedTimeById });
  const periodStartPlayerKeysBySide = buildPeriodStartPlayerKeysBySide(playerTimeAndPossessionStats);
  const playerMetaByKey = new Map();
  for (const player of Array.isArray(playerOptions) ? playerOptions : []) {
    const key = playerKeyFromPlayer(player);
    if (key) playerMetaByKey.set(key, player);
  }
  const slotsBySide = { home: [], away: [] };

  for (const teamSide of ['home', 'away']) {
    slotsBySide[teamSide] = startersBySide[teamSide].map((player, index) => ({
      slotKey: `${teamSide}:slot:${index}`,
      teamSide,
      basePositionToken: normalizePositionToken(player.position),
      currentPlayerKey: player.key,
      segments: [],
      lastChangePeriodKey: null,
      lastEnteredBySub: false,
    }));
  }

  for (const periodKey of MATCHUP_PERIOD_ORDER) {
    const periodMax = Number(periodMaxSeconds?.[periodKey]) || 0;
    if (!(periodMax > 0)) continue;

    const openSegmentBySlot = new Map();
    const periodStartPlayersBySide = {
      home: periodStartPlayerKeysBySide?.[periodKey]?.home || [],
      away: periodStartPlayerKeysBySide?.[periodKey]?.away || [],
    };
    for (const teamSide of ['home', 'away']) {
      const explicitPeriodStartPlayers = periodStartPlayersBySide[teamSide];
      const hasCurrentAssignments = (slotsBySide[teamSide] || []).some((slot) => Boolean(slot.currentPlayerKey));
      const explicitPeriodStartSet = new Set(explicitPeriodStartPlayers.filter(Boolean));
      const shouldRealignForPeriodStart = (
        periodKey === 'first'
        || !hasCurrentAssignments
        || (
          explicitPeriodStartSet.size > 0
          && (
            explicitPeriodStartPlayers.some((playerKey) => (
              playerKey
              && !(slotsBySide[teamSide] || []).some((slot) => slot.currentPlayerKey === playerKey)
            ))
            || (slotsBySide[teamSide] || []).some((slot) => (
              slot.currentPlayerKey
              && !explicitPeriodStartSet.has(slot.currentPlayerKey)
            ))
          )
        )
      );
      if (shouldRealignForPeriodStart) {
        realignSlotsForPeriodStart(slotsBySide[teamSide], explicitPeriodStartPlayers, playerMetaByKey);
        for (const slot of slotsBySide[teamSide]) {
          ensureUniqueCurrentPlayerAssignment(slotsBySide[teamSide], slot.currentPlayerKey, slot.slotKey);
        }
      }
      for (const slot of slotsBySide[teamSide]) {
        if (slot.currentPlayerKey) {
          openSegmentBySlot.set(slot.slotKey, { playerKey: slot.currentPlayerKey, startTimeS: 0 });
        }
      }
    }

    const periodSubs = substitutions.filter((sub) => sub.periodKey === periodKey);
    for (const sub of periodSubs) {
      const teamSlots = slotsBySide[sub.teamSide] || [];
      const slot = teamSlots.find((entry) => entry.currentPlayerKey && entry.currentPlayerKey === sub.offKey)
        || teamSlots.find((entry) => !entry.currentPlayerKey && sub.onKey && normalizePositionToken(sub.onPlayer?.position) === entry.basePositionToken)
        || null;
      const periodStartPlayers = new Set(periodStartPlayersBySide[sub.teamSide] || []);
      const isBoundaryCarryoverChange = periodKey !== 'first' && sub.timeSeconds <= 0.0001;
      const periodIndex = MATCHUP_PERIOD_ORDER.indexOf(periodKey);
      const previousPeriodKey = periodIndex > 0 ? MATCHUP_PERIOD_ORDER[periodIndex - 1] : null;
      const teamHasOnPlayer = Boolean(sub.onKey) && teamSlots.some((entry) => entry.currentPlayerKey === sub.onKey);
      const teamHasOffPlayer = Boolean(sub.offKey) && teamSlots.some((entry) => entry.currentPlayerKey === sub.offKey);
      if (
        isBoundaryCarryoverChange
        && (
          (teamHasOnPlayer && !teamHasOffPlayer)
          || (!teamHasOnPlayer && !teamHasOffPlayer)
          || (
            slot
            && slot.lastEnteredBySub
            && previousPeriodKey
            && slot.lastChangePeriodKey === previousPeriodKey
            && !teamHasOffPlayer
          )
          || (
            slot
            && teamSlots.some((entry) => Boolean(entry.currentPlayerKey))
            && !teamHasOffPlayer
            && (
              !periodStartPlayers.size
              || (sub.offKey && !periodStartPlayers.has(sub.offKey))
            )
          )
        )
      ) {
        continue;
      }
      if (!slot) continue;
      const open = openSegmentBySlot.get(slot.slotKey);
      if (open?.playerKey && sub.timeSeconds > open.startTimeS) {
        slot.segments.push({ periodKey, playerKey: open.playerKey, startTimeS: open.startTimeS, endTimeS: Math.min(periodMax, sub.timeSeconds) });
      }
      openSegmentBySlot.delete(slot.slotKey);
      slot.currentPlayerKey = sub.onKey || null;
      slot.lastChangePeriodKey = periodKey;
      slot.lastEnteredBySub = Boolean(sub.onKey);
      ensureUniqueCurrentPlayerAssignment(teamSlots, slot.currentPlayerKey, slot.slotKey);
      if (slot.currentPlayerKey && sub.timeSeconds < periodMax) {
        openSegmentBySlot.set(slot.slotKey, { playerKey: slot.currentPlayerKey, startTimeS: Math.max(0, Math.min(periodMax, sub.timeSeconds)) });
      }
    }

    for (const teamSide of ['home', 'away']) {
      for (const slot of slotsBySide[teamSide]) {
        const open = openSegmentBySlot.get(slot.slotKey);
        if (open?.playerKey && periodMax > open.startTimeS) {
          slot.segments.push({ periodKey, playerKey: open.playerKey, startTimeS: open.startTimeS, endTimeS: periodMax });
        }
        openSegmentBySlot.delete(slot.slotKey);
      }
    }
  }

  return { slotsBySide, periodMaxSeconds };
}

function pairSlots(homeSlots = [], awaySlots = []) {
  const availableAway = [...awaySlots];
  return homeSlots.map((homeSlot) => {
    const homeToken = homeSlot.basePositionToken;
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let index = 0; index < availableAway.length; index += 1) {
      const awaySlot = availableAway[index];
      const awayToken = awaySlot.basePositionToken;
      const score = scoreSlotPair(homeToken, awayToken) * 1000 - Math.abs(positionPriority(homeToken) - positionPriority(awayToken));
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    const [awaySlot] = availableAway.splice(bestIndex, 1);
    return awaySlot ? { homeSlot, awaySlot } : null;
  }).filter(Boolean);
}

function subtractIntervals(range, overlaps = []) {
  let fragments = [{ startTimeS: range.startTimeS, endTimeS: range.endTimeS }];
  for (const overlap of overlaps) {
    const next = [];
    for (const fragment of fragments) {
      if (overlap.endTimeS <= fragment.startTimeS || overlap.startTimeS >= fragment.endTimeS) {
        next.push(fragment);
        continue;
      }
      if (overlap.startTimeS > fragment.startTimeS) {
        next.push({ startTimeS: fragment.startTimeS, endTimeS: overlap.startTimeS });
      }
      if (overlap.endTimeS < fragment.endTimeS) {
        next.push({ startTimeS: overlap.endTimeS, endTimeS: fragment.endTimeS });
      }
    }
    fragments = next.filter((fragment) => fragment.endTimeS > fragment.startTimeS);
  }
  return fragments;
}

export function buildEffectiveMatchupStints({
  match = null,
  stats = [],
  matchupStints = [],
  playerOptions = [],
  playerTimeAndPossessionStats = null,
  imputedTimeById = null,
} = {}) {
  const explicitStints = Array.isArray(matchupStints) ? matchupStints.filter(Boolean) : [];
  const { slotsBySide } = buildSlotAssignments({
    stats,
    match,
    playerOptions,
    playerTimeAndPossessionStats,
    imputedTimeById,
  });
  const playerMetaByKey = new Map();
  for (const player of Array.isArray(playerOptions) ? playerOptions : []) {
    const key = playerKeyFromPlayer(player);
    if (key) playerMetaByKey.set(key, player);
  }

  const defaultStints = [];
  const pairs = pairSlots(slotsBySide.home, slotsBySide.away);
  for (const pair of pairs) {
    const homeSegmentsByPeriod = MATCHUP_PERIOD_ORDER.map((periodKey) => pair.homeSlot.segments.filter((segment) => segment.periodKey === periodKey));
    const awaySegmentsByPeriod = MATCHUP_PERIOD_ORDER.map((periodKey) => pair.awaySlot.segments.filter((segment) => segment.periodKey === periodKey));
    for (let periodIndex = 0; periodIndex < MATCHUP_PERIOD_ORDER.length; periodIndex += 1) {
      const periodKey = MATCHUP_PERIOD_ORDER[periodIndex];
      for (const homeSegment of homeSegmentsByPeriod[periodIndex]) {
        for (const awaySegment of awaySegmentsByPeriod[periodIndex]) {
          const overlapStart = Math.max(homeSegment.startTimeS, awaySegment.startTimeS);
          const overlapEnd = Math.min(homeSegment.endTimeS, awaySegment.endTimeS);
          if (!(overlapEnd > overlapStart)) continue;
          const homePlayer = playerMetaByKey.get(homeSegment.playerKey);
          const awayPlayer = playerMetaByKey.get(awaySegment.playerKey);
          if (homePlayer && awayPlayer) {
            defaultStints.push({
              id: null,
              source: 'default',
              defender_player_id: homePlayer.id,
              defender_team_side: 'home',
              attacker_player_id: awayPlayer.id,
              attacker_team_side: 'away',
              period_key: periodKey,
              start_time_s: overlapStart,
              end_time_s: overlapEnd,
            });
            defaultStints.push({
              id: null,
              source: 'default',
              defender_player_id: awayPlayer.id,
              defender_team_side: 'away',
              attacker_player_id: homePlayer.id,
              attacker_team_side: 'home',
              period_key: periodKey,
              start_time_s: overlapStart,
              end_time_s: overlapEnd,
            });
          }
        }
      }
    }
  }

  if (!defaultStints.length) return explicitStints;

  const explicitBlocksByDefenderAttackerPeriod = new Map();
  for (const source of explicitStints) {
    const defenderTeamSide = normalizeTeamSide(source?.defender_team_side);
    const defenderPlayerId = source?.defender_player_id ? String(source.defender_player_id) : '';
    const attackerPlayerId = source?.attacker_player_id ? String(source.attacker_player_id) : '';
    const periodKey = String(source?.period_key || '');
    const startTimeS = Number(source?.start_time_s);
    const endTimeS = Number(source?.end_time_s);
    if (!defenderTeamSide || !defenderPlayerId || !attackerPlayerId || !MATCHUP_PERIOD_ORDER.includes(periodKey)) continue;
    if (!Number.isFinite(startTimeS) || !Number.isFinite(endTimeS) || !(endTimeS > startTimeS)) continue;
    const bucketKey = `${defenderTeamSide}|${defenderPlayerId}|${attackerPlayerId}|${periodKey}`;
    const bucket = explicitBlocksByDefenderAttackerPeriod.get(bucketKey) || [];
    bucket.push({ startTimeS, endTimeS });
    explicitBlocksByDefenderAttackerPeriod.set(bucketKey, bucket);
  }

  const defaultFragments = [];
  for (const source of defaultStints) {
    const defenderTeamSide = normalizeTeamSide(source?.defender_team_side);
    const defenderPlayerId = source?.defender_player_id ? String(source.defender_player_id) : '';
    const attackerPlayerId = source?.attacker_player_id ? String(source.attacker_player_id) : '';
    const periodKey = String(source?.period_key || '');
    if (!defenderTeamSide || !defenderPlayerId || !attackerPlayerId || !MATCHUP_PERIOD_ORDER.includes(periodKey)) continue;
    const overlaps = explicitBlocksByDefenderAttackerPeriod.get(`${defenderTeamSide}|${defenderPlayerId}|${attackerPlayerId}|${periodKey}`) || [];
    const fragments = subtractIntervals(
      { startTimeS: Number(source.start_time_s), endTimeS: Number(source.end_time_s) },
      overlaps,
    );
    for (const fragment of fragments) {
      defaultFragments.push({
        ...source,
        start_time_s: fragment.startTimeS,
        end_time_s: fragment.endTimeS,
      });
    }
  }

  return [...explicitStints, ...defaultFragments].sort((left, right) => {
    const periodDiff = MATCHUP_PERIOD_ORDER.indexOf(String(left?.period_key || '')) - MATCHUP_PERIOD_ORDER.indexOf(String(right?.period_key || ''));
    if (periodDiff !== 0) return periodDiff;
    if (Number(left?.start_time_s) !== Number(right?.start_time_s)) return Number(left?.start_time_s) - Number(right?.start_time_s);
    return String(left?.id || `${left?.defender_player_id}-${left?.attacker_player_id}`).localeCompare(String(right?.id || `${right?.defender_player_id}-${right?.attacker_player_id}`));
  });
}

function deriveOutcome(stat, extra) {
  if (!stat) return '';
  if (stat.stat_type === 'pass') return String(extra?.pass?.outcome || '').trim().toLowerCase();
  if (stat.stat_type === 'carry') return String(extra?.carry?.outcome || '').trim().toLowerCase();
  if (stat.stat_type === 'shot') return String(extra?.shot?.outcome || '').trim().toLowerCase();
  if (stat.stat_type === 'kickout') return String(extra?.kickout?.outcome || '').trim().toLowerCase();
  if (stat.stat_type === 'throw_in') return String(extra?.throw_in?.outcome || '').trim().toLowerCase();
  if (stat.stat_type === 'turnover') return String(extra?.turnover?.turnover_type || '').trim().toLowerCase();
  return '';
}

function getCompletedPassReceiver(stat, extra, playerMaps) {
  if (deriveOutcome(stat, extra) !== 'completed') return null;
  const wonBy = normalizeSelection(extra?.pass?.won_by, playerMaps);
  if (wonBy?.team_side === normalizeTeamSide(stat?.team_side)) return wonBy;
  return normalizeSelection(extra?.pass?.intended_recipient, playerMaps);
}

function getFilterTimeSeconds(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || String(value ?? '') === '') return null;
  return Math.max(0, Math.round(minutes * 60));
}

function addMetric(row, setName, itemKey, amount = 1, targetKey = null) {
  if (!row || !itemKey || !targetKey) return;
  const seen = row.__seen?.[setName];
  if (!seen || seen.has(itemKey)) return;
  seen.add(itemKey);
  row[targetKey] = (Number(row[targetKey]) || 0) + amount;
}

function buildEmptyRow(defender) {
  return {
    key: playerKeyFromPlayer(defender),
    id: defender?.id || null,
    player: playerLabel(defender),
    team: defender?.team_side || 'home',
    number: defender?.number ?? null,
    name: defender?.name || '',
    position: defender?.position || '',
    matchupMinutes: 0,
    daTouches: 0,
    daShots: 0,
    daPoints: 0,
    daXp: 0,
    daPasses: 0,
    daProgPasses: 0,
    daCarries: 0,
    daProgCarries: 0,
    daProgPassesReceived: 0,
    daProgMetres: 0,
    daKickoutsWon: 0,
    daKickoutTotal: 0,
    daKickoutWinPct: 0,
    daTurnoversLost: 0,
    daFoulsWon: 0,
    daStints: [],
    __seen: {
      touches: new Set(),
      shots: new Set(),
      points: new Set(),
      xp: new Set(),
      passes: new Set(),
      progPasses: new Set(),
      carries: new Set(),
      progCarries: new Set(),
      progPassesReceived: new Set(),
      progMetres: new Set(),
      kickoutWon: new Set(),
      kickoutTotal: new Set(),
      turnoversLost: new Set(),
      foulsWon: new Set(),
    },
  };
}

function removeInternalState(row) {
  if (!row) return row;
  delete row.__seen;
  return row;
}

export function buildDefendingAllowedRows({
  stats = [],
  touchEvents = [],
  matchupStints = [],
  playerOptions = [],
  reportFilters = null,
  match = null,
} = {}) {
  const playerMaps = buildPlayerMaps(playerOptions);
  const matchOffsets = getMatchSectionOffsets(match);
  const filterHalves = Array.isArray(reportFilters?.halves) ? reportFilters.halves : [];
  const timeMinS = getFilterTimeSeconds(reportFilters?.timeMin);
  const timeMaxS = getFilterTimeSeconds(reportFilters?.timeMax);

  const rowsByKey = new Map();
  const stintsByPeriodAndAttacker = new Map();

  const ensureRow = (defender) => {
    const key = playerKeyFromPlayer(defender);
    if (!key) return null;
    if (!rowsByKey.has(key)) rowsByKey.set(key, buildEmptyRow(defender));
    return rowsByKey.get(key);
  };

  const addIndexedStint = (periodKey, attackerKey, stintRecord) => {
    const bucketKey = `${periodKey}|${attackerKey}`;
    const bucket = stintsByPeriodAndAttacker.get(bucketKey) || [];
    bucket.push(stintRecord);
    stintsByPeriodAndAttacker.set(bucketKey, bucket);
  };

  for (const source of Array.isArray(matchupStints) ? matchupStints : []) {
    const defender = playerMaps.byId.get(`${source?.defender_team_side}|${source?.defender_player_id}`) || null;
    const attacker = playerMaps.byId.get(`${source?.attacker_team_side}|${source?.attacker_player_id}`) || null;
    const defenderKey = playerKeyFromPlayer(defender);
    const attackerKey = playerKeyFromPlayer(attacker);
    const periodKey = String(source?.period_key || '');
    const rawStart = Number(source?.start_time_s);
    const rawEnd = Number(source?.end_time_s);
    if (!defender || !attacker || !defenderKey || !attackerKey) continue;
    if (!['first', 'second', 'et_first', 'et_second'].includes(periodKey)) continue;
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || rawEnd <= rawStart) continue;
    if (filterHalves.length && !filterHalves.includes(periodKey)) continue;

    const periodLimit = getOfficialPeriodLengthMinutes(match, periodKey) * 60;
    const safeStart = Math.max(0, Math.min(periodLimit, rawStart));
    const safeEnd = Math.max(0, Math.min(periodLimit, rawEnd));
    if (!(safeEnd > safeStart)) continue;

    const offset = Number(matchOffsets?.[periodKey] || 0);
    const stintStartMatchS = offset + safeStart;
    const stintEndMatchS = offset + safeEnd;
    const clippedStartMatchS = timeMinS == null ? stintStartMatchS : Math.max(stintStartMatchS, timeMinS);
    const clippedEndMatchS = timeMaxS == null ? stintEndMatchS : Math.min(stintEndMatchS, timeMaxS);
    if (!(clippedEndMatchS > clippedStartMatchS)) continue;

    const clippedStartPeriodS = clippedStartMatchS - offset;
    const clippedEndPeriodS = clippedEndMatchS - offset;
    const clippedDurationS = clippedEndMatchS - clippedStartMatchS;
    if (!(clippedDurationS > 0)) continue;

    const defenderRow = ensureRow(defender);
    if (!defenderRow) continue;

    const displayStint = {
      id: source?.id || null,
      defenderKey,
      defenderPlayerId: defender?.id || null,
      defenderPlayerLabel: playerLabel(defender),
      attackerKey,
      attackerPlayerId: attacker?.id || null,
      attackerPlayerLabel: playerLabel(attacker),
      attackerTeamSide: attacker?.team_side || null,
      defenderTeamSide: defender?.team_side || null,
      periodKey,
      startTimeS: safeStart,
      endTimeS: safeEnd,
      clippedStartTimeS: clippedStartPeriodS,
      clippedEndTimeS: clippedEndPeriodS,
      clippedDurationS,
      startLabel: formatHalfClock(safeStart, periodKey, match),
      endLabel: formatHalfClock(safeEnd, periodKey, match),
      clippedStartLabel: formatHalfClock(clippedStartPeriodS, periodKey, match),
      clippedEndLabel: formatHalfClock(clippedEndPeriodS, periodKey, match),
    };

    defenderRow.daStints.push(displayStint);
    addIndexedStint(periodKey, attackerKey, {
      defenderKey,
      attackerKey,
      startMatchS: clippedStartMatchS,
      endMatchS: clippedEndMatchS,
    });
  }

  for (const row of rowsByKey.values()) {
    const intervals = row.daStints
      .map((stint) => ({
        start: Number(matchOffsets?.[stint.periodKey] || 0) + Number(stint.clippedStartTimeS || 0),
        end: Number(matchOffsets?.[stint.periodKey] || 0) + Number(stint.clippedEndTimeS || 0),
      }))
      .filter((interval) => Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end > interval.start)
      .sort((a, b) => a.start - b.start);
    const merged = [];
    for (const interval of intervals) {
      const last = merged[merged.length - 1];
      if (!last || interval.start > last.end) {
        merged.push({ ...interval });
      } else {
        last.end = Math.max(last.end, interval.end);
      }
    }
    row.matchupMinutes = merged.reduce((sum, interval) => sum + (interval.end - interval.start), 0) / 60;
    row.daStints.sort((a, b) => {
      const periodDiff = ['first', 'second', 'et_first', 'et_second'].indexOf(a.periodKey) - ['first', 'second', 'et_first', 'et_second'].indexOf(b.periodKey);
      if (periodDiff !== 0) return periodDiff;
      return a.startTimeS - b.startTimeS;
    });
  }

  const addForMatchingStints = (attackerSelection, stat, cb) => {
    const attacker = normalizeSelection(attackerSelection, playerMaps);
    const attackerKey = playerKeyFromPlayer(attacker);
    const periodKey = String(stat?.half || '');
    if (!attackerKey || !periodKey) return;
    const normalizedTimeS = getNormalizedTimeS(stat);
    if (!Number.isFinite(normalizedTimeS)) return;
    const matchTimeS = Number(matchOffsets?.[periodKey] || 0) + normalizedTimeS;
    const relevant = stintsByPeriodAndAttacker.get(`${periodKey}|${attackerKey}`) || [];
    for (const stint of relevant) {
      if (matchTimeS < stint.startMatchS || matchTimeS >= stint.endMatchS) continue;
      const row = rowsByKey.get(stint.defenderKey);
      if (row) cb(row, attackerKey, matchTimeS);
    }
  };

  for (const touch of Array.isArray(touchEvents) ? touchEvents : []) {
    if (!touch?.stat) continue;
    addForMatchingStints(touch.player, touch.stat, (row) => {
      addMetric(row, 'touches', String(touch.key || touch.stat?.id || ''), 1, 'daTouches');
    });
  }

  for (const stat of Array.isArray(stats) ? stats : []) {
    if (!stat) continue;
    const extra = safeParseJSON(stat.extra_data || '{}', {});

    if (stat.stat_type === 'shot') {
      const shooter = extra?.shot?.player || null;
      const shotId = String(stat.id || '');
      const outcome = String(extra?.shot?.outcome || '').trim().toLowerCase();
      const xp = Number(extra?.shot?.xp?.value ?? extra?.shot?.expected_points ?? extra?.shot?.expectedPoints ?? extra?.shot?.xp ?? extra?.shot?.xP ?? 0);
      addForMatchingStints(shooter, stat, (row) => {
        addMetric(row, 'shots', shotId, 1, 'daShots');
        addMetric(row, 'points', shotId, shotPointsForOutcome(outcome), 'daPoints');
        addMetric(row, 'xp', shotId, Number.isFinite(xp) ? xp : 0, 'daXp');
      });
      continue;
    }

    if (stat.stat_type === 'pass') {
      const passId = String(stat.id || '');
      const passer = extra?.pass?.passer || null;
      const progressive = isProgressive(stat);
      const completed = deriveOutcome(stat, extra) === 'completed';
      const progressiveMeters = completed ? (Number(getProgressiveMeters(stat)) || 0) : 0;
      addForMatchingStints(passer, stat, (row) => {
        addMetric(row, 'passes', passId, 1, 'daPasses');
        if (progressive) addMetric(row, 'progPasses', passId, 1, 'daProgPasses');
        if (progressiveMeters) addMetric(row, 'progMetres', `pass:${passId}`, progressiveMeters, 'daProgMetres');
      });
      if (completed && progressive) {
        const receiver = getCompletedPassReceiver(stat, extra, playerMaps);
        addForMatchingStints(receiver, stat, (row) => {
          addMetric(row, 'progPassesReceived', passId, 1, 'daProgPassesReceived');
        });
      }
      continue;
    }

    if (stat.stat_type === 'carry') {
      const carryId = String(stat.id || '');
      const carrier = extra?.carry?.carrier || null;
      const progressive = isProgressive(stat);
      const progressiveMeters = deriveOutcome(stat, extra) === 'completed' ? (Number(getProgressiveMeters(stat)) || 0) : 0;
      addForMatchingStints(carrier, stat, (row) => {
        addMetric(row, 'carries', carryId, 1, 'daCarries');
        if (progressive) addMetric(row, 'progCarries', carryId, 1, 'daProgCarries');
        if (progressiveMeters) addMetric(row, 'progMetres', `carry:${carryId}`, progressiveMeters, 'daProgMetres');
      });
      continue;
    }

    if (stat.stat_type === 'kickout' || stat.stat_type === 'throw_in') {
      const restartId = String(stat.id || '');
      const restart = stat.stat_type === 'kickout' ? extra?.kickout : extra?.throw_in;
      const winner = restart?.won_by || null;
      const loser = restart?.lost_by || null;
      addForMatchingStints(winner, stat, (row) => {
        addMetric(row, 'kickoutWon', restartId, 1, 'daKickoutsWon');
        addMetric(row, 'kickoutTotal', restartId, 1, 'daKickoutTotal');
      });
      addForMatchingStints(loser, stat, (row) => {
        addMetric(row, 'kickoutTotal', restartId, 1, 'daKickoutTotal');
      });
      continue;
    }

    if (stat.stat_type === 'turnover' || extra?.turnover) {
      const turnoverId = String(stat.id || '');
      const lostBy = extra?.turnover?.lost_by || null;
      addForMatchingStints(lostBy, stat, (row) => {
        addMetric(row, 'turnoversLost', turnoverId, 1, 'daTurnoversLost');
      });
      continue;
    }

    const foul = extractFoulFromStat(stat);
    if (foul) {
      const foulId = String(stat.id || '');
      addForMatchingStints(foul?.foul_on || foul?.foul_on_or_forced_by, stat, (row) => {
        addMetric(row, 'foulsWon', foulId, 1, 'daFoulsWon');
      });
    }
  }

  for (const row of rowsByKey.values()) {
    const total = Number(row.daKickoutTotal) || 0;
    row.daKickoutWinPct = total > 0 ? ((Number(row.daKickoutsWon) || 0) / total) * 100 : 0;
    removeInternalState(row);
  }

  const rows = Array.from(rowsByKey.values()).sort((a, b) => {
    if ((b.matchupMinutes || 0) !== (a.matchupMinutes || 0)) return (b.matchupMinutes || 0) - (a.matchupMinutes || 0);
    const aNumber = Number(a.number);
    const bNumber = Number(b.number);
    if (Number.isFinite(aNumber) && Number.isFinite(bNumber) && aNumber !== bNumber) return aNumber - bNumber;
    return String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });
  });

  const byKey = new Map(rows.map((row) => [row.key, row]));
  return { rows, byKey };
}
