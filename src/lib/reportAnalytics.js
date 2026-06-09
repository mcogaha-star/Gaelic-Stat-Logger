export const PITCH_W = 145;
export const PITCH_H = 85;
export const OPP_45_X = PITCH_W - 45;
export const GOAL_X = PITCH_W;
export const GOAL_Y = PITCH_H / 2;
export const GOAL_POST_TOP_Y = 39.25;
export const GOAL_POST_BOTTOM_Y = 45.75;
export const SCORING_ZONE_RADIUS = 32;
export const SCORING_ZONE_ANGLE_DEG = 60;
export const POSSESSION_REBUILD_VERSION = 'v13';
export const DEFENCE_SET_MIGRATION_VERSION = 'v2';
export const STAT_MODEL_MIGRATION_VERSION = 'v5';

const SHOT_REQUIRES_RESULT_OUTCOMES = ['short', 'saved', 'blocked', 'post'];
const ADMIN_STAT_TYPES = ['substitution', 'period_end'];
const DEAD_BALL_TURNOVER_OUTCOMES = ['sideline_against', '45_against', 'goal_kick_against'];

export function deriveMatchLengthMinutes(matchOrCode, maybeLevel) {
  if (typeof matchOrCode === 'object') {
    const stored = Number(matchOrCode?.match_length_minutes);
    if (Number.isFinite(stored) && stored > 0) return stored;
  }
  const code = typeof matchOrCode === 'object' ? matchOrCode?.code : matchOrCode;
  const level = typeof matchOrCode === 'object' ? matchOrCode?.level : maybeLevel;
  const normalizedLevel = String(level || '').toLowerCase().replace(/[\s_-]+/g, '');
  return String(code || '').toUpperCase() === 'GAA' && normalizedLevel === 'intercounty' ? 70 : 60;
}

export function deriveMatchHalfMinutes(matchOrCode, maybeLevel) {
  return deriveMatchLengthMinutes(matchOrCode, maybeLevel) / 2;
}

export function getOfficialPeriodLengthMinutes(match, periodKey) {
  const normalHalfLength = deriveMatchHalfMinutes(match);
  if (periodKey === 'et_first' || periodKey === 'et_second') return 10;
  if (periodKey === 'first' || periodKey === 'second') return normalHalfLength;
  return normalHalfLength;
}

export function getPlayerRateMinutesBase(match) {
  return deriveMatchLengthMinutes(match) === 70 ? 70 : 60;
}

function safeParseIdList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item || '').trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function safeParseExtraObject(stat) {
  if (!stat?.extra_data) return {};
  return safeParseJSONLocal(stat.extra_data, {});
}

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clampMinZero(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(0, num) : 0;
}

function buildPlayerIdentityMaps(playerOptions = []) {
  const byId = new Map();
  const byTeamNumber = new Map();
  const byTeamName = new Map();
  for (const player of Array.isArray(playerOptions) ? playerOptions : []) {
    const teamSide = player?.team_side === 'home' || player?.team_side === 'away' ? player.team_side : null;
    if (!teamSide) continue;
    const id = player?.id ? String(player.id) : null;
    const number = player?.number != null ? String(player.number) : '';
    const name = String(player?.name || '').trim();
    if (id) byId.set(`${teamSide}|${id}`, player);
    if (number) byTeamNumber.set(`${teamSide}|${number}`, player);
    if (name) byTeamName.set(`${teamSide}|${name.toLowerCase()}`, player);
  }
  return { byId, byTeamNumber, byTeamName };
}

function normalizeTeamSideLocal(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'home' || v === 'home team') return 'home';
  if (v === 'away' || v === 'away team') return 'away';
  return null;
}

function normalizeSelectionToPlayerLocal(selection, playerMaps, fallbackTeamSide = null) {
  if (!selection || typeof selection !== 'object') return null;
  const teamSide = normalizeTeamSideLocal(selection.team_side) || fallbackTeamSide || null;
  const id = selection.id ? String(selection.id) : '';
  if (teamSide && id) {
    const direct = playerMaps.byId.get(`${teamSide}|${id}`);
    if (direct) return { ...selection, ...direct, id: direct.id, team_side: teamSide };
  }
  const number = selection.number != null ? String(selection.number) : '';
  if (teamSide && number) {
    const byNumber = playerMaps.byTeamNumber.get(`${teamSide}|${number}`);
    if (byNumber) return { ...selection, ...byNumber, id: byNumber.id, team_side: teamSide };
  }
  const name = String(selection.name || '').trim();
  if (teamSide && name) {
    const byName = playerMaps.byTeamName.get(`${teamSide}|${name.toLowerCase()}`);
    if (byName) return { ...selection, ...byName, id: byName.id, team_side: teamSide };
  }
  if (!teamSide || (!id && !number && !name)) return null;
  return {
    id: id || null,
    number: selection.number ?? null,
    name,
    team_side: teamSide,
  };
}

function makePlayerKeyLocal(playerLike) {
  if (!playerLike) return null;
  const teamSide = normalizeTeamSideLocal(playerLike.team_side);
  if (!teamSide) return null;
  if (playerLike.id) return `${teamSide}|${playerLike.id}`;
  const number = playerLike.number != null ? String(playerLike.number) : '';
  const name = String(playerLike.name || '').trim().toLowerCase();
  if (!number && !name) return null;
  return `${teamSide}|${number}|${name}`;
}

function displayPlayerNameLocal(playerLike) {
  if (!playerLike) return '';
  const number = playerLike.number != null && String(playerLike.number).trim() !== '' ? `#${playerLike.number} ` : '';
  const name = String(playerLike.name || '').trim();
  return `${number}${name}`.trim();
}

function buildPlayerSeed(match, playerOptions = []) {
  const seeds = new Map();
  const addSeed = (playerLike, teamSide, warningTarget = null) => {
    const normalized = normalizeSelectionToPlayerLocal({ ...(playerLike || {}), team_side: teamSide || playerLike?.team_side }, playerMaps, teamSide);
    const key = makePlayerKeyLocal(normalized);
    if (!key) return null;
    if (!seeds.has(key)) {
      seeds.set(key, {
        playerKey: key,
        playerId: normalized?.id || null,
        playerName: normalized?.name || '',
        playerNumber: normalized?.number ?? null,
        teamSide: normalized?.team_side || teamSide || 'unknown',
        teamName: normalized?.team_side === 'away'
          ? (match?.away_team_name || match?.awayTeamName || 'Away')
          : (match?.home_team_name || match?.homeTeamName || 'Home'),
      });
    }
    return key;
  };
  const playerMaps = buildPlayerIdentityMaps(playerOptions);

  for (const player of Array.isArray(playerOptions) ? playerOptions : []) addSeed(player, player?.team_side);
  const homeStarters = safeParseIdList(match?.home_starters || match?.home_on_field);
  const awayStarters = safeParseIdList(match?.away_starters || match?.away_on_field);
  for (const id of homeStarters) addSeed({ id, team_side: 'home' }, 'home');
  for (const id of awayStarters) addSeed({ id, team_side: 'away' }, 'away');

  return { seeds, playerMaps };
}

function extractSubstitutionInfo(stat, playerMaps) {
  if (String(stat?.stat_type || '') !== 'substitution') return null;
  const extra = safeParseExtraObject(stat);
  const normalizedTeamSide = normalizeTeamSideLocal(stat?.team_side);
  const playerOff = normalizeSelectionToPlayerLocal({ id: extra?.sub_out_id || null, team_side: normalizedTeamSide }, playerMaps, normalizedTeamSide);
  const playerOn = normalizeSelectionToPlayerLocal({ id: extra?.sub_in_id || null, team_side: normalizedTeamSide }, playerMaps, normalizedTeamSide);
  return {
    teamSide: normalizedTeamSide,
    playerOff,
    playerOn,
    timeMinutes: clampMinZero((safeNumber(stat?.normalized_time_s) || 0) / 60),
    playId: Number.isFinite(Number(stat?.play_id)) ? Number(stat.play_id) : null,
    statId: stat?.id || null,
    temporary: !!extra?.temporary,
  };
}

function getStatPeriodKey(stat) {
  const half = String(stat?.half || '').trim();
  return ['first', 'second', 'et_first', 'et_second'].includes(half) ? half : null;
}

function getPeriodActualLengthInfo(match, stats = []) {
  const periods = ['first', 'second', 'et_first', 'et_second'];
  const periodInfo = {};
  for (const periodKey of periods) {
    const officialPeriodLengthMinutes = getOfficialPeriodLengthMinutes(match, periodKey);
    const periodStats = (Array.isArray(stats) ? stats : []).filter((stat) => getStatPeriodKey(stat) === periodKey);
    const explicitEndRows = periodStats
      .filter((stat) => String(stat?.stat_type || '') === 'period_end')
      .map((stat) => safeNumber(stat?.normalized_time_s))
      .filter((value) => value != null)
      .map((value) => value / 60);
    const latestEventTimeMinutes = periodStats
      .map((stat) => safeNumber(stat?.normalized_time_s))
      .filter((value) => value != null)
      .map((value) => value / 60)
      .reduce((max, value) => Math.max(max, value), 0);

    const hasData = periodStats.length > 0;
    let actualLoggedPeriodLengthMinutes = officialPeriodLengthMinutes;
    let confidence = 'low';
    let source = 'official_fallback';

    if (!hasData && (periodKey === 'et_first' || periodKey === 'et_second')) {
      actualLoggedPeriodLengthMinutes = 0;
      confidence = 'low';
      source = 'no_period_data';
    } else if (explicitEndRows.length) {
      actualLoggedPeriodLengthMinutes = explicitEndRows.reduce((max, value) => Math.max(max, value), 0);
      confidence = 'high';
      source = 'period_end';
    } else if (latestEventTimeMinutes > 0) {
      actualLoggedPeriodLengthMinutes = latestEventTimeMinutes;
      confidence = 'medium';
      source = 'latest_event';
    }

    const validActual = Number.isFinite(actualLoggedPeriodLengthMinutes) && actualLoggedPeriodLengthMinutes > 0;
    const scaleFactor = validActual ? (officialPeriodLengthMinutes / actualLoggedPeriodLengthMinutes) : 1;
    periodInfo[periodKey] = {
      officialPeriodLengthMinutes,
      actualLoggedPeriodLengthMinutes: hasData
        ? (validActual ? actualLoggedPeriodLengthMinutes : officialPeriodLengthMinutes)
        : 0,
      scaleFactor: Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1,
      confidence,
      source,
      hasData,
    };
  }
  return periodInfo;
}

function sortStatsForStints(stats = []) {
  return (Array.isArray(stats) ? stats : []).slice().sort((a, b) => {
    const periodOrder = { first: 0, second: 1, et_first: 2, et_second: 3 };
    const pa = periodOrder[getStatPeriodKey(a)] ?? 99;
    const pb = periodOrder[getStatPeriodKey(b)] ?? 99;
    if (pa !== pb) return pa - pb;
    const ta = safeNumber(a?.normalized_time_s) ?? -1;
    const tb = safeNumber(b?.normalized_time_s) ?? -1;
    if (ta !== tb) return ta - tb;
    const playA = safeNumber(a?.play_id) ?? -1;
    const playB = safeNumber(b?.play_id) ?? -1;
    if (playA !== playB) return playA - playB;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
}

function buildPossessionWindows(stats = []) {
  const ordered = sortStatsForStints(stats).filter((stat) => !ADMIN_STAT_TYPES.includes(String(stat?.stat_type || '')));
  const grouped = new Map();
  for (const stat of ordered) {
    const periodKey = getStatPeriodKey(stat);
    const teamSide = normalizeTeamSideLocal(stat?.possession_team_side);
    const possessionId = Number(stat?.possession_id);
    const timeSeconds = safeNumber(stat?.normalized_time_s);
    if (!periodKey || !teamSide || !Number.isFinite(possessionId) || possessionId <= 0 || timeSeconds == null) continue;
    const key = `${periodKey}|${teamSide}|${possessionId}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(stat);
  }

  const windowsByPeriod = new Map();
  for (const [key, evs] of grouped.entries()) {
    const [periodKey, teamSide, possessionIdRaw] = key.split('|');
    const possessionId = Number(possessionIdRaw);
    evs.sort((a, b) => {
      const ta = safeNumber(a?.normalized_time_s) ?? -1;
      const tb = safeNumber(b?.normalized_time_s) ?? -1;
      if (ta !== tb) return ta - tb;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
    const startMinutes = (safeNumber(evs[0]?.normalized_time_s) || 0) / 60;
    const endMinutesSeed = (safeNumber(evs[evs.length - 1]?.normalized_time_s) || 0) / 60;
    const row = {
      key,
      possessionId,
      teamSide,
      periodKey,
      startLoggedMinute: startMinutes,
      endLoggedMinute: endMinutesSeed,
      confidence: 'medium',
      source: 'last_event',
      statIds: evs.map((ev) => ev?.id).filter(Boolean),
    };
    if (!windowsByPeriod.has(periodKey)) windowsByPeriod.set(periodKey, []);
    windowsByPeriod.get(periodKey).push(row);
  }

  const possessions = [];
  for (const [periodKey, rows] of windowsByPeriod.entries()) {
    rows.sort((a, b) => {
      if (a.startLoggedMinute !== b.startLoggedMinute) return a.startLoggedMinute - b.startLoggedMinute;
      return a.possessionId - b.possessionId;
    });
    for (let i = 0; i < rows.length; i += 1) {
      const current = rows[i];
      const next = rows[i + 1] || null;
      let endLoggedMinute = current.endLoggedMinute;
      let confidence = current.confidence;
      let source = current.source;
      if ((!Number.isFinite(endLoggedMinute) || endLoggedMinute <= current.startLoggedMinute) && next && Number.isFinite(next.startLoggedMinute)) {
        endLoggedMinute = next.startLoggedMinute;
        confidence = 'medium';
        source = 'next_possession_start';
      }
      if (!Number.isFinite(endLoggedMinute) || endLoggedMinute < current.startLoggedMinute) {
        endLoggedMinute = current.startLoggedMinute;
        confidence = 'low';
        source = 'same_start_fallback';
      }
      possessions.push({
        ...current,
        endLoggedMinute,
        confidence,
        source,
      });
    }
  }
  return possessions;
}

export function buildPlayerTimeAndPossessionStats({
  match,
  stats = [],
  playerOptions = [],
  homeTeam = null,
  awayTeam = null,
} = {}) {
  const warnings = [];
  const { seeds, playerMaps } = buildPlayerSeed(
    {
      ...match,
      home_team_name: homeTeam?.name || match?.home_team_name || 'Home',
      away_team_name: awayTeam?.name || match?.away_team_name || 'Away',
    },
    playerOptions,
  );

  const players = {};
  const ensurePlayerRecord = (playerLike, teamSide = null) => {
    const normalized = normalizeSelectionToPlayerLocal({ ...(playerLike || {}), team_side: teamSide || playerLike?.team_side }, playerMaps, teamSide);
    const key = makePlayerKeyLocal(normalized);
    if (!key) return null;
    const seed = seeds.get(key) || {
      playerKey: key,
      playerId: normalized?.id || null,
      playerName: normalized?.name || '',
      playerNumber: normalized?.number ?? null,
      teamSide: normalized?.team_side || teamSide || 'unknown',
      teamName: (normalized?.team_side || teamSide) === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home'),
    };
    if (!players[key]) {
      players[key] = {
        ...seed,
        started: false,
        stints: [],
        minutesPlayed: 0,
        minutesPlayedRawLogged: 0,
        minutesPlayedScaledBeforeCards: 0,
        blackCards: 0,
        blackCardMinutesSubtracted: 0,
        ownPossessionsPlayed: 0,
        oppPossessionsPlayed: 0,
        totalPossessionsPlayed: 0,
        ownPossessionIdsPlayed: [],
        oppPossessionIdsPlayed: [],
        totalPossessionIdsPlayed: [],
        rateMinutesBase: getPlayerRateMinutesBase(match),
        minutesRateFactor: null,
        ownPossRateFactor10: null,
        oppPossRateFactor10: null,
        totalPossRateFactor10: null,
        confidence: 'high',
        warnings: [],
      };
    }
    return players[key];
  };

  for (const seed of seeds.values()) ensurePlayerRecord(seed, seed.teamSide);

  const periodInfo = getPeriodActualLengthInfo(match, stats);
  const periodOrder = ['first', 'second', 'et_first', 'et_second'];
  const sortedStats = sortStatsForStints(stats);

  const homeStarterIds = safeParseIdList(match?.home_starters).length
    ? safeParseIdList(match?.home_starters)
    : safeParseIdList(match?.home_on_field);
  const awayStarterIds = safeParseIdList(match?.away_starters).length
    ? safeParseIdList(match?.away_starters)
    : safeParseIdList(match?.away_on_field);

  const onPitchBySide = {
    home: new Set(homeStarterIds),
    away: new Set(awayStarterIds),
  };

  const addWarning = (message, playerKey = null) => {
    warnings.push(message);
    if (playerKey && players[playerKey]) players[playerKey].warnings.push(message);
  };

  for (const starterId of homeStarterIds) {
    const row = ensurePlayerRecord({ id: starterId, team_side: 'home' }, 'home');
    if (row) row.started = true;
  }
  for (const starterId of awayStarterIds) {
    const row = ensurePlayerRecord({ id: starterId, team_side: 'away' }, 'away');
    if (row) row.started = true;
  }

  for (const periodKey of periodOrder) {
    const info = periodInfo[periodKey] || {
      officialPeriodLengthMinutes: getOfficialPeriodLengthMinutes(match, periodKey),
      actualLoggedPeriodLengthMinutes: getOfficialPeriodLengthMinutes(match, periodKey),
      scaleFactor: 1,
      confidence: 'low',
      source: 'official_fallback',
      hasData: periodKey === 'first' || periodKey === 'second',
    };
    if ((periodKey === 'et_first' || periodKey === 'et_second') && !info.hasData) continue;
    const periodEndMinute = clampMinZero(info.actualLoggedPeriodLengthMinutes);
    const sourceLabel = periodKey === 'first'
      ? 'starter'
      : periodKey.startsWith('et_')
        ? 'extra_time_carryover'
        : 'carryover';
    const openStints = new Map();

    for (const teamSide of ['home', 'away']) {
      for (const playerId of onPitchBySide[teamSide]) {
        const row = ensurePlayerRecord({ id: playerId, team_side: teamSide }, teamSide);
        if (!row) {
          addWarning(`Unable to resolve ${teamSide} on-pitch player ${playerId} at start of ${periodKey}.`);
          continue;
        }
        openStints.set(row.playerKey, {
          playerKey: row.playerKey,
          startLoggedMinute: 0,
          source: sourceLabel,
          teamSide,
        });
      }
    }

    const periodSubs = sortedStats
      .filter((stat) => getStatPeriodKey(stat) === periodKey && String(stat?.stat_type || '') === 'substitution')
      .map((stat) => extractSubstitutionInfo(stat, playerMaps))
      .filter(Boolean)
      .sort((a, b) => {
        if (a.timeMinutes !== b.timeMinutes) return a.timeMinutes - b.timeMinutes;
        const playA = a.playId ?? -1;
        const playB = b.playId ?? -1;
        if (playA !== playB) return playA - playB;
        return String(a.statId || '').localeCompare(String(b.statId || ''));
      });

    const closeStint = (playerKey, endMinute) => {
      const row = players[playerKey];
      const open = openStints.get(playerKey);
      if (!row || !open) return;
      const loggedDurationMinutes = Math.max(0, endMinute - open.startLoggedMinute);
      const scaledDurationMinutes = loggedDurationMinutes * (Number.isFinite(info.scaleFactor) && info.scaleFactor > 0 ? info.scaleFactor : 1);
      row.stints.push({
        playerKey,
        playerId: row.playerId,
        playerName: row.playerName,
        playerNumber: row.playerNumber,
        teamSide: row.teamSide,
        periodKey,
        startLoggedMinute: open.startLoggedMinute,
        endLoggedMinute: endMinute,
        loggedDurationMinutes,
        scaleFactor: info.scaleFactor,
        scaledDurationMinutes,
        source: open.source,
        confidence: info.confidence,
      });
      openStints.delete(playerKey);
    };

    for (const sub of periodSubs) {
      const teamSide = sub.teamSide;
      if (teamSide !== 'home' && teamSide !== 'away') {
        addWarning(`Substitution ${sub.statId || ''} has no team side in ${periodKey}.`);
        continue;
      }
      if (sub.playerOff) {
        const offRow = ensurePlayerRecord(sub.playerOff, teamSide);
        const offKey = offRow?.playerKey;
        if (!offKey) addWarning(`Substitution ${sub.statId || ''} player_off could not be resolved.`, null);
        if (offKey && !onPitchBySide[teamSide].has(offRow.playerId || sub.playerOff.id)) {
          addWarning(`Sub player_off not currently on pitch for ${offRow.playerName || offKey} in ${periodKey}.`, offKey);
        }
        if (offKey) {
          closeStint(offKey, sub.timeMinutes);
          if (offRow.playerId) onPitchBySide[teamSide].delete(String(offRow.playerId));
        }
      }
      if (sub.playerOn) {
        const onRow = ensurePlayerRecord(sub.playerOn, teamSide);
        const onKey = onRow?.playerKey;
        if (!onKey) addWarning(`Substitution ${sub.statId || ''} player_on could not be resolved.`, null);
        if (onKey) {
          if (onRow.playerId) onPitchBySide[teamSide].add(String(onRow.playerId));
          openStints.set(onKey, {
            playerKey: onKey,
            startLoggedMinute: sub.timeMinutes,
            source: 'sub_on',
            teamSide,
          });
        }
      }
      if (onPitchBySide[teamSide].size > 15) addWarning(`More than expected players on pitch for ${teamSide} after substitution ${sub.statId || ''}.`);
      if (onPitchBySide[teamSide].size < 15) addWarning(`Fewer than expected players on pitch for ${teamSide} after substitution ${sub.statId || ''}.`);
    }

    for (const [playerKey] of openStints.entries()) closeStint(playerKey, periodEndMinute);
  }

  const blackCardsByPlayer = new Map();
  for (const stat of Array.isArray(stats) ? stats : []) {
    const extra = safeParseExtraObject(stat);
    const card = String(extra?.foul?.card || stat?.card || '').trim().toLowerCase();
    if (card !== 'black') continue;
    const foulBy = normalizeSelectionToPlayerLocal(extra?.foul?.foul_by, playerMaps, normalizeTeamSideLocal(stat?.team_side));
    const key = makePlayerKeyLocal(foulBy);
    if (!key) continue;
    blackCardsByPlayer.set(key, (blackCardsByPlayer.get(key) || 0) + 1);
  }

  const possessions = buildPossessionWindows(stats);
  const possessionIdsByPlayer = new Map();
  for (const possession of possessions) {
    const possessionStart = clampMinZero(possession.startLoggedMinute);
    const possessionEnd = clampMinZero(possession.endLoggedMinute);
    for (const row of Object.values(players)) {
      const overlappingStint = row.stints.find((stint) => stint.periodKey === possession.periodKey && possessionStart < stint.endLoggedMinute && possessionEnd > stint.startLoggedMinute);
      if (!overlappingStint) continue;
      const posKey = possession.key;
      if (!possessionIdsByPlayer.has(row.playerKey)) {
        possessionIdsByPlayer.set(row.playerKey, { own: new Set(), opp: new Set(), total: new Set() });
      }
      const bucket = possessionIdsByPlayer.get(row.playerKey);
      bucket.total.add(posKey);
      if (possession.teamSide === row.teamSide) bucket.own.add(posKey);
      else bucket.opp.add(posKey);
    }
  }

  for (const row of Object.values(players)) {
    row.minutesPlayedRawLogged = row.stints.reduce((sum, stint) => sum + (Number(stint.loggedDurationMinutes) || 0), 0);
    row.minutesPlayedScaledBeforeCards = row.stints.reduce((sum, stint) => sum + (Number(stint.scaledDurationMinutes) || 0), 0);
    row.blackCards = blackCardsByPlayer.get(row.playerKey) || 0;
    row.blackCardMinutesSubtracted = row.blackCards * 10;
    row.minutesPlayed = Math.max(0, row.minutesPlayedScaledBeforeCards - row.blackCardMinutesSubtracted);
    row.rateMinutesBase = getPlayerRateMinutesBase(match);
    row.minutesRateFactor = row.minutesPlayed > 0 ? row.rateMinutesBase / row.minutesPlayed : null;
    const possBucket = possessionIdsByPlayer.get(row.playerKey);
    row.ownPossessionIdsPlayed = possBucket ? Array.from(possBucket.own) : [];
    row.oppPossessionIdsPlayed = possBucket ? Array.from(possBucket.opp) : [];
    row.totalPossessionIdsPlayed = possBucket ? Array.from(possBucket.total) : [];
    row.ownPossessionsPlayed = row.ownPossessionIdsPlayed.length;
    row.oppPossessionsPlayed = row.oppPossessionIdsPlayed.length;
    row.totalPossessionsPlayed = row.totalPossessionIdsPlayed.length;
    row.ownPossRateFactor10 = row.ownPossessionsPlayed > 0 ? 10 / row.ownPossessionsPlayed : null;
    row.oppPossRateFactor10 = row.oppPossessionsPlayed > 0 ? 10 / row.oppPossessionsPlayed : null;
    row.totalPossRateFactor10 = row.totalPossessionsPlayed > 0 ? 10 / row.totalPossessionsPlayed : null;
    if (row.blackCards > 0) {
      row.warnings.push('Black card minutes subtracted from minutes only; possession counts not adjusted for sin-bin timing.');
      row.confidence = row.confidence === 'low' ? 'low' : 'medium';
    }
  }

  return {
    players,
    periodInfo,
    warnings,
  };
}

function shouldMigrateDefenceSetRow(stat) {
  if (!stat || typeof stat?.counter_attack !== 'boolean') return false;
  if (typeof stat?.set_defence === 'boolean') return false;
  if (stat?.defence_set_migration_version === DEFENCE_SET_MIGRATION_VERSION) return false;
  return !['kickout', 'period_end', 'substitution'].includes(String(stat?.stat_type || ''));
}

export function getSetDefenceValue(stat, fallback = null) {
  if (!stat) return fallback;
  if (typeof stat?.set_defence === 'boolean') return !!stat.set_defence;
  if (typeof stat?.counter_attack === 'boolean') return !!stat.counter_attack;
  return fallback;
}

export function buildLegacyDefenceSetRepairs(stats) {
  return (Array.isArray(stats) ? stats : [])
    .filter(shouldMigrateDefenceSetRow)
    .map((stat) => {
      const setDefence = getSetDefenceValue(stat, false);
      return {
        id: stat.id,
        // Freeze the current boolean as Set Defence and mark it so later reads
        // can trust the explicit field without re-inferring semantics.
        data: {
          counter_attack: !!setDefence,
          set_defence: !!setDefence,
          defence_set_migration_version: DEFENCE_SET_MIGRATION_VERSION,
        },
      };
    });
}

export function normalizeDefenceSetRows(stats, migrated = false) {
  return (Array.isArray(stats) ? stats : []).map((stat) => {
    if (!stat || typeof stat.counter_attack !== 'boolean') return stat;
    const setDefence = getSetDefenceValue(stat, false);
    return {
      ...stat,
      counter_attack: !!setDefence,
      set_defence: !!setDefence,
    };
  });
}

export function isLegacyDefensiveContactStat(stat) {
  return String(stat?.stat_type || '') === 'defensive_contact';
}

export function buildLegacyDefensiveContactDeletes(stats) {
  return (Array.isArray(stats) ? stats : [])
    .filter(isLegacyDefensiveContactStat)
    .map((stat) => ({ id: stat.id, server_stat_id: stat.server_stat_id || null }));
}

function normalizeStatModelExtra(stat) {
  if (isLegacyDefensiveContactStat(stat)) {
    const extra = stat?.extra_data ? safeParseJSONLocal(stat.extra_data, {}) : {};
    return JSON.stringify({ ...(extra || {}), __delete_legacy_defensive_contact: true });
  }
  if (!stat?.extra_data) return null;
  const extra = safeParseJSONLocal(stat.extra_data, {});
  const next = JSON.parse(JSON.stringify(extra || {}));
  let changed = false;

  if (stat?.stat_type === 'pass' && next?.pass) {
    const passAccuracy = String(next.pass.accuracy || '').trim();
    if (!['++', '+', '-', '--'].includes(passAccuracy)) {
      next.pass.accuracy = '+';
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(next.pass, 'style')) {
      delete next.pass.style;
      changed = true;
    }
    const outcome = String(next.pass.outcome || '');
    if (outcome === 'sidelineagainst') {
      next.pass.outcome = 'sideline_against';
      changed = true;
    }
    if (outcome === 'broken') {
      next.pass.outcome = 'broken_retained';
      changed = true;
    }
    if (String(next.pass.outcome || '') === 'broken_retained') {
      const passer = next.pass?.passer;
      const recovered = next.pass?.recovered_by;
      const recoveredFilled = recovered && recovered.kind && recovered.kind !== 'none';
      if (!recoveredFilled && passer?.kind) {
        next.pass.recovered_by = JSON.parse(JSON.stringify(passer));
        changed = true;
      }
    }
  }

  if (stat?.stat_type === 'carry' && next?.carry) {
    if (Object.prototype.hasOwnProperty.call(next.carry, 'defensive_contact_type')) {
      delete next.carry.defensive_contact_type;
      changed = true;
    }
    if (!next.carry.take_on && Object.prototype.hasOwnProperty.call(next.carry, 'take_on_attempted')) {
      next.carry.take_on = next.carry.take_on_attempted
        ? (next.carry.take_on_completed ? 'completed' : 'failed')
        : 'no';
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(next.carry, 'take_on_attempted')) {
      delete next.carry.take_on_attempted;
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(next.carry, 'take_on_completed')) {
      delete next.carry.take_on_completed;
      changed = true;
    }
    const defender = next.carry.defender;
    const defenderFilled = defender && defender.kind && defender.kind !== 'none';
    const pressure = String(next.carry.pressure_on_carrier || '').toLowerCase();
    const takeOn = String(next.carry.take_on || 'no').toLowerCase();
    const carrierSide = next.carry.carrier?.team_side;
    const defenderSide = defender?.team_side;
    const clearByContext = defenderFilled && pressure !== 'high' && takeOn === 'no';
    const clearBySameTeam =
      defenderFilled
      && (carrierSide === 'home' || carrierSide === 'away')
      && defenderSide === carrierSide;
    if (clearByContext || clearBySameTeam) {
      next.carry.defender = { kind: 'none' };
      changed = true;
    }
    const outcome = String(next.carry.outcome || '');
    if (outcome === 'sidelineagainst') {
      next.carry.outcome = 'sideline_against';
      changed = true;
    }
  }

  for (const key of ['kickout', 'throw_in', 'turnover']) {
    if (!next?.[key]) continue;
    const outcomeKey = key === 'turnover' ? 'turnover_type' : 'outcome';
    const value = String(next[key][outcomeKey] || '');
    if (value === 'sidelineagainst') {
      next[key][outcomeKey] = 'sideline_against';
      changed = true;
    }
  }

  if (!changed) return null;
  return JSON.stringify(next);
}

export function buildStatModelRepairs(stats) {
  return (Array.isArray(stats) ? stats : [])
    .filter((stat) => !isLegacyDefensiveContactStat(stat))
    .map((stat) => {
      const extra_data = normalizeStatModelExtra(stat);
      return extra_data == null ? null : { id: stat.id, data: { extra_data } };
    })
    .filter(Boolean);
}

export function normalizeStatModelRows(stats, migrated = false) {
  return (Array.isArray(stats) ? stats : []).map((stat) => {
    const extra_data = normalizeStatModelExtra(stat);
    return extra_data == null ? stat : { ...stat, extra_data };
  });
}

function safeParseJSONLocal(s, fallback = {}) {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : fallback;
  } catch {
    return fallback;
  }
}

export function shotOutcomeGroup(outcome) {
  const o = String(outcome || '');
  if (['goal', 'point', '2_point'].includes(o)) return 'score';
  if (o === 'wide') return 'wide';
  if (o === 'short') return 'short';
  if (o === 'saved') return 'saved';
  if (o === 'blocked') return 'blocked';
  if (o === 'post') return 'post';
  return 'other';
}

export function shotPointsForOutcome(outcome) {
  if (outcome === 'goal') return 3;
  if (outcome === '2_point') return 2;
  if (outcome === 'point') return 1;
  return 0;
}

export function getShotExpectedPointsValue(stat) {
  const extra = safeParseJSONLocal(stat?.extra_data || '{}', {});
  const shot = extra?.shot || {};
  const xpRaw = shot?.xp?.value ?? shot?.expected_points ?? shot?.expectedPoints ?? shot?.xp ?? shot?.xP ?? null;
  const xp = Number(xpRaw);
  return Number.isFinite(xp) ? xp : 0;
}

export function getShotContextType(stat) {
  const extra = safeParseJSONLocal(stat?.extra_data || '{}', {});
  const shot = extra?.shot || {};
  const raw = String(shot?.situation || shot?.source || shot?.context || '').trim().toLowerCase();
  const normalized = raw === 'free_kick' ? 'free_hands' : raw;
  if (normalized === 'play') return 'play';
  if (['free_ground', 'free_hands', '45', 'penalty', 'mark'].includes(normalized)) return 'deadball';
  return 'unknown';
}

export function getNormalizedTimeS(stat, imputedMap) {
  const t = Number(stat?.normalized_time_s);
  if (Number.isFinite(t)) return Math.max(0, t);
  if (imputedMap && typeof imputedMap.get === 'function') {
    const imputed = Number(imputedMap.get(stat?.id));
    if (Number.isFinite(imputed)) return Math.max(0, imputed);
  }
  return null;
}

export function getSecondHalfStartS(match) {
  return deriveMatchHalfMinutes(match) * 60;
}

export function shotRequiresResult(outcome) {
  return SHOT_REQUIRES_RESULT_OUTCOMES.includes(String(outcome || ''));
}

export function isBroughtBackAdvantageStat(stat) {
  if (!stat) return false;
  const ex = safeParseJSONLocal(stat?.extra_data || '{}', {});
  return !!(
    ex?.shot?.brought_back_adv
    || ex?.turnover?.brought_back_adv
    || ex?.pass?.brought_back_adv
    || ex?.carry?.brought_back_adv
  );
}

export function shouldExcludeFromTotals(stat) {
  return isBroughtBackAdvantageStat(stat);
}

export function getMatchSectionOffsets(match) {
  const second = getSecondHalfStartS(match);
  const secondHalfDuration = second;
  const etFirst = second + secondHalfDuration;
  const etSecond = etFirst + 10 * 60;
  return {
    first: 0,
    second,
    et_first: etFirst,
    et_second: etSecond,
  };
}

export function getMatchTimeS(stat, match, imputedMap) {
  const normalized = getNormalizedTimeS(stat, imputedMap);
  if (!Number.isFinite(normalized)) return null;
  const offsets = getMatchSectionOffsets(match);
  if (stat?.half === 'second') return offsets.second + normalized;
  if (stat?.half === 'et_first') return offsets.et_first + normalized;
  if (stat?.half === 'et_second') return offsets.et_second + normalized;
  return normalized;
}

export function isNonLiveStat(stat) {
  return ADMIN_STAT_TYPES.includes(String(stat?.stat_type || ''));
}

export function isDeadBallGapStart(stat) {
  if (!stat) return false;
  const ex = safeParseJSONLocal(stat?.extra_data || '{}', {});
  if (stat?.stat_type === 'period_end') return true;
  if (extractFoulFromStat(stat)) return true;
  if (stat?.stat_type === 'shot') {
    const outcome = String(ex?.shot?.outcome || '');
    const result = String(ex?.shot?.result || '');
    if (shotOutcomeGroup(outcome) === 'score' || outcome === 'wide' || result === '45') return true;
  }
  const outcome =
    stat?.stat_type === 'pass' ? String(ex?.pass?.outcome || '') :
    stat?.stat_type === 'carry' ? String(ex?.carry?.outcome || '') :
    stat?.stat_type === 'kickout' ? String(ex?.kickout?.outcome || '') :
    stat?.stat_type === 'throw_in' ? String(ex?.throw_in?.outcome || '') :
    stat?.stat_type === 'turnover' ? String(ex?.turnover?.turnover_type || '') :
    '';
  if ([
    'foul',
    'sideline_for',
    'sideline_against',
    'sidelineagainst',
    '45',
    '45_for',
    '45_against',
    'goal_kick_for',
    'goal_kick_against',
  ].includes(outcome)) return true;
  return false;
}

export function getDerivedPossessionDurationSeconds(events, match, imputedMap) {
  const ordered = (Array.isArray(events) ? events : [])
    .filter((s) => s && !isNonLiveStat(s))
    .slice()
    .sort((a, b) => {
      const pa = Number(a?.play_id);
      const pb = Number(b?.play_id);
      if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa - pb;
      const ta = getMatchTimeS(a, match, imputedMap);
      const tb = getMatchTimeS(b, match, imputedMap);
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
  let total = 0;
  for (let i = 0; i < ordered.length - 1; i += 1) {
    const current = ordered[i];
    const next = ordered[i + 1];
    if (isDeadBallGapStart(current)) continue;
    const a = getMatchTimeS(current, match, imputedMap);
    const b = getMatchTimeS(next, match, imputedMap);
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a) total += b - a;
  }
  return total;
}

export const POSSESSION_ZONE_LABELS = ['Defensive Third', 'Middle Third', 'Attacking Third', 'Unknown'];

export function getPossessionZoneForX(x, teamSide) {
  const raw = Number(x);
  if (!Number.isFinite(raw)) return 'Unknown';
  // Normalized coordinates are already stored in an attacking left-to-right frame
  // for the acting/possession team, so no extra away-team flip belongs here.
  if (raw < 45) return 'Defensive Third';
  if (raw < PITCH_W - 45) return 'Middle Third';
  return 'Attacking Third';
}

function splitZoneDurationByDistance(fromX, toX, duration, teamSide) {
  const seconds = Number(duration);
  const a = Number(fromX);
  const b = Number(toX);
  const out = Object.fromEntries(POSSESSION_ZONE_LABELS.map((z) => [z, 0]));
  if (!Number.isFinite(seconds) || seconds <= 0) return out;
  if (!Number.isFinite(a) && !Number.isFinite(b)) {
    out.Unknown += seconds;
    return out;
  }
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b - a) < 0.001) {
    out[getPossessionZoneForX(Number.isFinite(a) ? a : b, teamSide)] += seconds;
    return out;
  }

  const ax = a;
  const bx = b;
  const minX = Math.min(ax, bx);
  const maxX = Math.max(ax, bx);
  const total = Math.max(0.001, maxX - minX);
  const segments = [
    ['Defensive Third', 0, 45],
    ['Middle Third', 45, PITCH_W - 45],
    ['Attacking Third', PITCH_W - 45, PITCH_W],
  ];
  for (const [zone, start, end] of segments) {
    const overlap = Math.max(0, Math.min(maxX, end) - Math.max(minX, start));
    if (overlap > 0) out[zone] += seconds * (overlap / total);
  }
  const allocated = out['Defensive Third'] + out['Middle Third'] + out['Attacking Third'];
  if (allocated <= 0) out.Unknown += seconds;
  return out;
}

function addZoneDurations(target, add) {
  for (const z of POSSESSION_ZONE_LABELS) {
    target[z] = Number(target[z] || 0) + Number(add?.[z] || 0);
  }
}

export function getPossessionTimeSummary(events, teamSide, match, imputedMap, options = {}) {
  const ordered = (Array.isArray(events) ? events : [])
    .filter((s) => s && !isNonLiveStat(s))
    .slice()
    .sort((a, b) => {
      const pa = Number(a?.play_id);
      const pb = Number(b?.play_id);
      if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa - pb;
      const ta = getMatchTimeS(a, match, imputedMap);
      const tb = getMatchTimeS(b, match, imputedMap);
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
  const zoneSeconds = Object.fromEntries(POSSESSION_ZONE_LABELS.map((z) => [z, 0]));
  let liveSeconds = 0;

  const first = ordered[0] || null;
  const startAnchor = Number(options?.startAnchorTimeS);
  if (first && Number.isFinite(startAnchor)) {
    const firstTime = getMatchTimeS(first, match, imputedMap);
    if (Number.isFinite(firstTime) && firstTime >= startAnchor) {
      const gap = firstTime - startAnchor;
      liveSeconds += gap;
      addZoneDurations(zoneSeconds, splitZoneDurationByDistance(first.x_position, first.x_position, gap, teamSide));
    }
  }

  for (let i = 0; i < ordered.length - 1; i += 1) {
    const current = ordered[i];
    const next = ordered[i + 1];
    if (isDeadBallGapStart(current)) continue;
    const a = getMatchTimeS(current, match, imputedMap);
    const b = getMatchTimeS(next, match, imputedMap);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) continue;
    const duration = b - a;
    liveSeconds += duration;
    const endX = Number.isFinite(Number(current?.end_x_position)) ? current.end_x_position : current?.x_position;
    addZoneDurations(zoneSeconds, splitZoneDurationByDistance(current?.x_position, endX, duration, teamSide));
  }

  return { liveSeconds, zoneSeconds };
}

export function getHalfClockBaseS(half, match) {
  const second = getSecondHalfStartS(match);
  if (half === 'second') return second;
  return 0;
}

function formatClockBase(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(total / 60);
  const secs = Math.floor(total % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatAddedClock(baseSeconds, totalSeconds) {
  const added = Math.max(0, Math.floor(totalSeconds - baseSeconds));
  if (added <= 0) return formatClockBase(totalSeconds);
  const addedMinutes = Math.floor(added / 60);
  const addedSeconds = Math.floor(added % 60);
  return `${Math.floor(baseSeconds / 60)}+${addedMinutes}:${String(addedSeconds).padStart(2, '0')}`;
}

export function formatHalfClock(normalizedTimeS, half, match) {
  const normalized = Math.max(0, Number(normalizedTimeS) || 0);
  const second = getSecondHalfStartS(match);
  if (half === 'first') return formatAddedClock(second, normalized);
  if (half === 'second') return formatAddedClock(second * 2, second + normalized);
  if (half === 'et_first') return formatAddedClock(10 * 60, normalized);
  if (half === 'et_second') return formatAddedClock(10 * 60, normalized);
  return formatClockBase(normalized);
}

export function formatMatchClock(matchTimeS, match, half = null) {
  const total = Number(matchTimeS);
  if (!Number.isFinite(total) || total < 0) return '--:--';

  const halfLength = getSecondHalfStartS(match);
  const offsets = getMatchSectionOffsets(match);

  const section = (() => {
    if (half === 'first') return { start: offsets.first, normal: halfLength, baseClock: 0, et: false };
    if (half === 'second') return { start: offsets.second, normal: halfLength, baseClock: halfLength, et: false };
    if (half === 'et_first') return { start: offsets.et_first, normal: 10 * 60, baseClock: 0, et: true };
    if (half === 'et_second') return { start: offsets.et_second, normal: 10 * 60, baseClock: 0, et: true };
    if (total >= offsets.et_second) return { start: offsets.et_second, normal: 10 * 60, baseClock: 0, et: true };
    if (total >= offsets.et_first) return { start: offsets.et_first, normal: 10 * 60, baseClock: 0, et: true };
    if (total >= offsets.second) return { start: offsets.second, normal: halfLength, baseClock: halfLength, et: false };
    return { start: offsets.first, normal: halfLength, baseClock: 0, et: false };
  })();

  const local = Math.max(0, total - section.start);
  const baseClock = section.et ? 0 : section.baseClock;
  const displaySeconds = section.et ? local : baseClock + local;
  if (local <= section.normal) return formatClockBase(displaySeconds);

  const baseLabelMinutes = section.et
    ? Math.floor(section.normal / 60)
    : Math.floor((baseClock + section.normal) / 60);
  const added = Math.max(0, Math.floor(local - section.normal));
    const addMins = Math.floor(added / 60);
    const addSecs = Math.floor(added % 60);
  return `${baseLabelMinutes}+${addMins}:${String(addSecs).padStart(2, '0')}`;
}

export function normalizeFoulType(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function calcDistanceToGoal(x, y) {
  const dx = GOAL_X - Number(x);
  const dy = GOAL_Y - Number(y);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return NaN;
  return Math.sqrt(dx * dx + dy * dy);
}

export function calcAngleToGoal(x, y) {
  const halfW = (GOAL_POST_BOTTOM_Y - GOAL_POST_TOP_Y) / 2;
  const p1 = { x: GOAL_X, y: GOAL_Y - halfW };
  const p2 = { x: GOAL_X, y: GOAL_Y + halfW };
  const vx1 = p1.x - Number(x);
  const vy1 = p1.y - Number(y);
  const vx2 = p2.x - Number(x);
  const vy2 = p2.y - Number(y);
  if (![vx1, vy1, vx2, vy2].every(Number.isFinite)) return NaN;
  const a1 = Math.atan2(vy1, vx1);
  const a2 = Math.atan2(vy2, vx2);
  let ang = Math.abs(a2 - a1);
  if (ang > Math.PI) ang = 2 * Math.PI - ang;
  return (ang * 180) / Math.PI;
}

export function isInScoringZone(x, y) {
  const distance = calcDistanceToGoal(x, y);
  if (!Number.isFinite(distance) || distance > SCORING_ZONE_RADIUS) return false;
  const dx = GOAL_X - Number(x);
  const dy = Number(y) - GOAL_Y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || dx < 0) return false;
  const angle = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
  return angle <= SCORING_ZONE_ANGLE_DEG;
}

export function getProgressiveMeters(stat) {
  const sx = Number(stat?.x_position);
  const sy = Number(stat?.y_position);
  const ex = Number(stat?.end_x_position);
  const ey = Number(stat?.end_y_position);
  if (![sx, sy, ex, ey].every(Number.isFinite)) return 0;
  const startDist = calcDistanceToGoal(sx, sy);
  const endDist = calcDistanceToGoal(ex, ey);
  if (![startDist, endDist].every(Number.isFinite)) return 0;
  return Math.max(0, startDist - endDist);
}

export function isProgressive(stat) {
  const sx = Number(stat?.x_position);
  const sy = Number(stat?.y_position);
  const ex = Number(stat?.end_x_position);
  const ey = Number(stat?.end_y_position);
  if (![sx, sy, ex, ey].every(Number.isFinite)) return false;
  const startDist = calcDistanceToGoal(sx, sy);
  const endDist = calcDistanceToGoal(ex, ey);
  if (!Number.isFinite(startDist) || !Number.isFinite(endDist) || startDist <= 0) return false;
  const closerPct = ((startDist - endDist) / startDist) * 100;
  const thresholdPct = stat?.stat_type === 'carry' ? 15 : 20;
  return closerPct > thresholdPct;
}

export function getScoringZoneEntry(stat) {
  const sx = Number(stat?.x_position);
  const sy = Number(stat?.y_position);
  const ex = Number(stat?.end_x_position);
  const ey = Number(stat?.end_y_position);
  if (![sx, sy, ex, ey].every(Number.isFinite)) return false;
  return !isInScoringZone(sx, sy) && isInScoringZone(ex, ey);
}

export function getFieldTiltContribution(stat) {
  if (!stat || !['pass', 'carry'].includes(String(stat?.stat_type || ''))) return false;
  const ex = Number(stat?.end_x_position);
  return Number.isFinite(ex) && ex >= OPP_45_X;
}

export function statHasEnteredOpp45(stat) {
  const sx = Number(stat?.x_position);
  const ex = Number(stat?.end_x_position);
  return (Number.isFinite(sx) && sx >= OPP_45_X) || (Number.isFinite(ex) && ex >= OPP_45_X);
}

export function getEntryChannelFromY(y) {
  const yy = Number(y);
  if (!Number.isFinite(yy)) return '';
  if (yy < PITCH_H / 3) return 'Left';
  if (yy > (2 * PITCH_H) / 3) return 'Right';
  return 'Middle';
}

function getInterpolatedEntryY(start, end) {
  const sx = Number(start?.x);
  const sy = Number(start?.y);
  const ex = Number(end?.x);
  const ey = Number(end?.y);
  if (![sx, sy, ex, ey].every(Number.isFinite)) return NaN;
  if (sx === ex) return ey;
  const t = (OPP_45_X - sx) / (ex - sx);
  if (!Number.isFinite(t)) return NaN;
  return sy + ((ey - sy) * t);
}

export function getAttackEntryChannelForPossession(events, teamSide) {
  const list = Array.isArray(events) ? events.filter((e) => e && e.team_side === teamSide) : [];
  for (const stat of list) {
    const sx = Number(stat?.x_position);
    const sy = Number(stat?.y_position);
    const ex = Number(stat?.end_x_position);
    const ey = Number(stat?.end_y_position);
    const isPassCarry = stat?.stat_type === 'pass' || stat?.stat_type === 'carry';
    if (isPassCarry && Number.isFinite(sx) && Number.isFinite(ex) && sx < OPP_45_X && ex >= OPP_45_X) {
      const y = getInterpolatedEntryY({ x: sx, y: sy }, { x: ex, y: ey });
      return getEntryChannelFromY(y);
    }
  }
  for (const stat of list) {
    const sx = Number(stat?.x_position);
    const sy = Number(stat?.y_position);
    if (Number.isFinite(sx) && sx >= OPP_45_X) return getEntryChannelFromY(sy);
  }
  for (const stat of list) {
    const ex = Number(stat?.end_x_position);
    const ey = Number(stat?.end_y_position);
    if (Number.isFinite(ex) && ex >= OPP_45_X) return getEntryChannelFromY(ey);
  }
  return '';
}

export function extractFoulFromStat(stat) {
  const ex = safeParseJSONLocal(stat?.extra_data || '{}', {});
  if (stat?.stat_type === 'foul' && ex?.foul) return ex.foul;
  if (ex?.foul) return ex.foul;
  if (ex?.turnover?.type === 'foul' && ex?.turnover?.foul) return ex.turnover.foul;
  if (ex?.pass?.outcome === 'foul' && ex?.pass?.foul) return ex.pass.foul;
  if (ex?.carry?.outcome === 'foul' && ex?.carry?.foul) return ex.carry.foul;
  if (ex?.kickout?.outcome === 'foul' && ex?.kickout?.foul) return ex.kickout.foul;
  if (ex?.throw_in?.outcome === 'foul' && ex?.throw_in?.foul) return ex.throw_in.foul;
  return null;
}

function getFoulTeams(stat) {
  const foul = extractFoulFromStat(stat);
  return {
    foul,
    foulBy: foul?.foul_by?.team_side,
    foulOn: foul?.foul_on?.team_side || foul?.foul_on_or_forced_by?.team_side,
  };
}

export function validTeamSide(side) {
  return side === 'home' || side === 'away';
}

export function oppositeTeamSide(side) {
  return side === 'home' ? 'away' : side === 'away' ? 'home' : null;
}

export function normalizeOutcomeAlias(value, context = '') {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'sidelineagainst' || v === 'sideline against') return 'sideline_against';
  if (v === 'sidelinefor' || v === 'sideline for') return 'sideline_for';
  if (v === 'goal kick for') return 'goal_kick_for';
  if (v === 'goal kick against') return 'goal_kick_against';
  // Plain "sideline" was mostly used as a turnover-against type.
  if (v === 'sideline' && context === 'turnover') return 'sideline_against';
  return v;
}

export function inferPossessionOwnerFromNextPlay(stat) {
  if (!stat) return null;
  const ex = safeParseJSONLocal(stat?.extra_data || '{}', {});

  const passTurnover = stat?.stat_type === 'pass' && normalizeOutcomeAlias(ex?.pass?.outcome) === 'turnover';
  const carryTurnover = stat?.stat_type === 'carry' && normalizeOutcomeAlias(ex?.carry?.outcome) === 'turnover';
  if (stat?.stat_type === 'turnover' || ex?.turnover || passTurnover || carryTurnover) {
    const lost = ex?.turnover?.lost_by?.team_side
      || ex?.pass?.passer?.team_side
      || ex?.carry?.carrier?.team_side
      || stat?.team_side;
    if (validTeamSide(lost)) return lost;
  }

  if (stat?.stat_type === 'pass') {
    return ex?.pass?.passer?.team_side || stat?.team_side || null;
  }
  if (stat?.stat_type === 'carry') {
    return ex?.carry?.carrier?.team_side || stat?.team_side || null;
  }
  if (stat?.stat_type === 'shot') {
    return ex?.shot?.player?.team_side || stat?.team_side || null;
  }
  if (stat?.stat_type === 'kickout' || stat?.stat_type === 'throw_in') {
    return inferRestartWinnerSide(stat, null);
  }
  return validTeamSide(stat?.team_side) ? stat.team_side : null;
}

export function getNextBallActionStat(list, startIndex, options = {}) {
  if (!Array.isArray(list)) return null;
  const stopAtPeriodEnd = options?.stopAtPeriodEnd !== false;
  for (let i = startIndex + 1; i < list.length; i += 1) {
    const stat = list[i];
    if (!stat) continue;
    if (String(stat?.stat_type || '') === 'period_end') {
      if (stopAtPeriodEnd) return null;
      continue;
    }
    if (String(stat?.stat_type || '') === 'substitution') continue;
    return stat;
  }
  return null;
}

function isTurnoverLikeStat(stat, ex = null) {
  if (!stat) return false;
  const extra = ex || safeParseJSONLocal(stat?.extra_data || '{}', {});
  const passTurnover = stat?.stat_type === 'pass' && normalizeOutcomeAlias(extra?.pass?.outcome) === 'turnover';
  const carryTurnover = stat?.stat_type === 'carry' && normalizeOutcomeAlias(extra?.carry?.outcome) === 'turnover';
  const passDeadBallTurnover = stat?.stat_type === 'pass' && DEAD_BALL_TURNOVER_OUTCOMES.includes(normalizeOutcomeAlias(extra?.pass?.outcome));
  const carryDeadBallTurnover = stat?.stat_type === 'carry' && DEAD_BALL_TURNOVER_OUTCOMES.includes(normalizeOutcomeAlias(extra?.carry?.outcome));
  return stat?.stat_type === 'turnover' || !!extra?.turnover || passTurnover || carryTurnover || passDeadBallTurnover || carryDeadBallTurnover;
}

export function inferRestartWinnerSide(stat, nextStat = null) {
  if (!stat) return null;
  const ex = safeParseJSONLocal(stat?.extra_data || '{}', {});
  const restart = stat?.stat_type === 'kickout' ? ex?.kickout : stat?.stat_type === 'throw_in' ? ex?.throw_in : null;
  if (!restart) return null;

  const restartTeam = restart?.team_side || stat?.team_side || null;
  const outcome = normalizeOutcomeAlias(restart?.outcome);
  const explicitWon = restart?.won_by?.team_side;
  if (validTeamSide(explicitWon)) return explicitWon;

  if (outcome === 'sideline_for' || outcome === '45_for' || outcome === '45' || outcome === 'goal_kick_for') {
    return validTeamSide(restartTeam) ? restartTeam : null;
  }
  if (outcome === 'sideline_against' || outcome === 'goal_kick_against') {
    return oppositeTeamSide(restartTeam);
  }
  if (outcome === 'foul') {
    const foul = extractFoulFromStat(stat);
    const foulBy = foul?.foul_by?.team_side || null;
    if (validTeamSide(restartTeam) && validTeamSide(foulBy)) {
      return foulBy === restartTeam ? oppositeTeamSide(restartTeam) : restartTeam;
    }
    const nextBallTeam = inferPossessionOwnerFromNextPlay(nextStat);
    if (validTeamSide(nextBallTeam)) return nextBallTeam;
    return null;
  }

  if (outcome === 'clean' || outcome === 'break') {
    const brokenBy = restart?.broken_by?.team_side;
    if (validTeamSide(brokenBy)) return brokenBy;
    const nextBallTeam = inferPossessionOwnerFromNextPlay(nextStat);
    if (validTeamSide(nextBallTeam)) return nextBallTeam;
  }

  return null;
}

export function classifyKickoutLength(stat) {
  if (!stat || String(stat?.stat_type || '') !== 'kickout') return 'unknown';
  const endX = Number(stat?.end_x_position);
  if (!Number.isFinite(endX)) return 'unknown';
  // Coordinates are normalized from the kickout team's attacking direction, so
  // own 45 is always x <= 45 regardless of home/away or half direction.
  return endX > 45 ? 'long' : 'short';
}

export function statHasEmbeddedTurnover(stat) {
  if (!stat) return false;
  const ex = safeParseJSONLocal(stat?.extra_data || '{}', {});
  return isTurnoverLikeStat(stat, ex);
}

export function classifyTerminalOutcome(stat, teamSide) {
  if (!stat) return 'OTHER';
  const ex = safeParseJSONLocal(stat?.extra_data || '{}', {});
  const outcome = String(
    stat?.stat_type === 'shot' ? ex?.shot?.outcome :
    stat?.stat_type === 'pass' ? normalizeOutcomeAlias(ex?.pass?.outcome) :
    stat?.stat_type === 'carry' ? normalizeOutcomeAlias(ex?.carry?.outcome) :
    stat?.stat_type === 'kickout' ? normalizeOutcomeAlias(ex?.kickout?.outcome) :
    stat?.stat_type === 'turnover' ? normalizeOutcomeAlias(ex?.turnover?.turnover_type, 'turnover') :
    stat?.stat_type === 'throw_in' ? normalizeOutcomeAlias(ex?.throw_in?.outcome) :
    stat?.stat_type === 'foul' ? ex?.foul?.foul_type :
    ''
  );

  if (stat?.stat_type === 'period_end') return 'HALF_END';

  if (stat?.stat_type === 'shot') {
    if (ex?.shot?.brought_back_adv) return 'CONTINUE';
    if (shotOutcomeGroup(ex?.shot?.outcome) === 'score') return 'SCORE';
    const res = String(ex?.shot?.result || '');
    if (ex?.shot?.outcome === 'wide') return 'WIDE';
    if (SHOT_REQUIRES_RESULT_OUTCOMES.includes(String(ex?.shot?.outcome || ''))) {
      if (res === 'opposition') return String(ex?.shot?.outcome || '').toUpperCase();
      return 'CONTINUE';
    }
    return 'OTHER';
  }

  if (ex?.turnover?.brought_back_adv) return 'CONTINUE';
  if (stat?.stat_type === 'foul') return 'CONTINUE';
  if (stat?.stat_type === 'pass' && outcome === 'foul') return 'CONTINUE';
  if (stat?.stat_type === 'carry' && outcome === 'foul') return 'CONTINUE';
  if (stat?.stat_type === 'kickout' && outcome === 'foul') return 'CONTINUE';
  if (stat?.stat_type === 'throw_in' && outcome === 'foul') return 'CONTINUE';
  if (isTurnoverLikeStat(stat, ex)) return 'TURNOVER';
  const { foulBy, foulOn } = getFoulTeams(stat);
  if (foulOn === teamSide) return 'CONTINUE';
  if (outcome === 'sideline_against' || outcome === '45_against' || outcome === 'goal_kick_against') return 'TURNOVER';
  if (outcome === 'sideline_for' || outcome === '45_for' || outcome === '45' || outcome === 'goal_kick_for') return 'CONTINUE';
  if (foulBy === teamSide) return 'CONTINUE';

  return 'OTHER';
}

export function derivePossessionOutcome(events, teamSide) {
  const list = Array.isArray(events) ? events.filter(Boolean) : [];
  const ordered = list.slice().sort((a, b) => {
    const pa = Number(a?.play_id);
    const pb = Number(b?.play_id);
    if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa - pb;
    const ta = Number(a?.normalized_time_s);
    const tb = Number(b?.normalized_time_s);
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    const ra = Number(a?.time_s);
    const rb = Number(b?.time_s);
    if (Number.isFinite(ra) && Number.isFinite(rb) && ra !== rb) return ra - rb;
    const tsa = Date.parse(String(a?.timestamp || a?.created_date || ''));
    const tsb = Date.parse(String(b?.timestamp || b?.created_date || ''));
    if (Number.isFinite(tsa) && Number.isFinite(tsb) && tsa !== tsb) return tsa - tsb;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });

  const relevant = ordered.filter((stat) => {
    if (!stat) return false;
    const { foulBy, foulOn } = getFoulTeams(stat);
    return stat.team_side === teamSide || stat.possession_team_side === teamSide || foulBy === teamSide || foulOn === teamSide;
  });
  if (!relevant.length) return 'Other';

  const acting = ordered.filter((stat) => stat?.team_side === teamSide);
  for (let i = acting.length - 1; i >= 0; i -= 1) {
    const stat = acting[i];
    if (!stat) continue;
    const cls = classifyTerminalOutcome(stat, teamSide);
    if (cls === 'CONTINUE' || cls === 'OTHER' || cls === 'HALF_END') continue;
    if (cls === 'SCORE') return 'Score';
    if (cls === 'WIDE') return 'Wide';
    if (cls === 'SHORT') return 'Short';
    if (cls === 'BLOCKED') return 'Blocked';
    if (cls === 'SAVED') return 'Saved';
    if (cls === 'POST') return 'Post';
    if (cls === 'TURNOVER') return 'Turnover';
  }

  let halfEndFallback = false;
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const stat = ordered[i];
    if (!stat) continue;
    const { foulBy, foulOn } = getFoulTeams(stat);
    const isRelevant = stat.team_side === teamSide || stat.possession_team_side === teamSide || foulBy === teamSide || foulOn === teamSide;
    if (!isRelevant) continue;

    // If the grouped possession already contains later rows, a foul cannot be
    // the terminal event for this possession even if the foul metadata alone
    // looks turnover-like.
    if ((foulBy === teamSide || foulOn === teamSide) && i < ordered.length - 1) continue;

    const cls = classifyTerminalOutcome(stat, teamSide);
    if (cls === 'CONTINUE' || cls === 'OTHER') continue;
    if (cls === 'HALF_END') {
      halfEndFallback = true;
      continue;
    }
    if (cls === 'SCORE') return 'Score';
    if (cls === 'WIDE') return 'Wide';
    if (cls === 'SHORT') return 'Short';
    if (cls === 'BLOCKED') return 'Blocked';
    if (cls === 'SAVED') return 'Saved';
    if (cls === 'POST') return 'Post';
    if (cls === 'TURNOVER') return 'Turnover';
  }
  if (halfEndFallback) return 'Half End';
  return 'Other';
}

export function isAttackPossession(events, teamSide) {
  const list = Array.isArray(events) ? events.filter((e) => e && e.team_side === teamSide) : [];
  for (const stat of list) {
    if (!stat) continue;
    const sx = Number(stat?.x_position);
    const ex = Number(stat?.end_x_position);
    if ((stat?.stat_type === 'pass' || stat?.stat_type === 'carry') && Number.isFinite(ex) && ex >= OPP_45_X) return true;
    if (Number.isFinite(sx) && sx >= OPP_45_X) return true;
    if (Number.isFinite(ex) && ex >= OPP_45_X) return true;
  }
  return false;
}

export function findScorableFreeConcededRows(stats) {
  const list = Array.isArray(stats) ? stats.slice() : [];
  list.sort((a, b) => {
    const pa = Number(a?.play_id);
    const pb = Number(b?.play_id);
    if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa - pb;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });

  const out = [];
  for (let i = 0; i < list.length - 1; i += 1) {
    const foulStat = list[i];
    const next = getNextBallActionStat(list, i);
    const { foul, foulBy, foulOn } = getFoulTeams(foulStat);
    if (!foul || !foulBy || !foulOn || foulBy === foulOn) continue;
    if (!next || next?.team_side !== foulOn) continue;

    const ex = safeParseJSONLocal(next?.extra_data || '{}', {});
    const qualifies =
      (next?.stat_type === 'shot' && ['free_ground', 'free_hands'].includes(String(ex?.shot?.situation || ''))) ||
      (next?.stat_type === 'pass' && !!ex?.pass?.deadball) ||
      (next?.stat_type === 'carry' && !!ex?.carry?.solo_plus_go);
    if (!qualifies) continue;

    const x = Number(next?.x_position);
    const y = Number(next?.y_position);
    const distance = calcDistanceToGoal(x, y);
    if (!Number.isFinite(distance) || distance > 45) continue;
    if (!Number.isFinite(y) || y < 5 || y > 80) continue;

    out.push({
      foulStat,
      restartStat: next,
      foul,
      concedingSide: foulBy,
      winningSide: foulOn,
      restartType: next?.stat_type,
      distance,
      playId: Number(foulStat?.play_id),
      possessionId: Number(foulStat?.possession_id),
    });
  }
  return out;
}

export function buildDataHealthChecks(stats) {
  const list = Array.isArray(stats) ? stats.filter(Boolean) : [];
  const rebuiltList = rebuildPossessionRows(list);
  const rebuiltById = new Map(rebuiltList.map((stat) => [stat?.id, stat]));
  const checks = [];
  const add = (severity, title, detail, stat = null) => {
    checks.push({
      severity,
      title,
      detail,
      statId: stat?.id || null,
      playId: Number.isFinite(Number(stat?.play_id)) ? Number(stat.play_id) : null,
    });
  };

  const possessionTeamById = new Map();
  const possessionIds = new Set();
  const visitSelections = (value, callback) => {
    if (Array.isArray(value)) {
      value.forEach((item) => visitSelections(item, callback));
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (value.kind === 'player' || value.kind === 'team' || value.kind === 'none') callback(value);
    for (const child of Object.values(value)) visitSelections(child, callback);
  };
  for (const stat of list) {
    const type = String(stat?.stat_type || '');
    const extra = safeParseJSONLocal(stat?.extra_data || '{}', {});
    const rebuilt = rebuiltById.get(stat?.id) || stat;
    const pid = Number(rebuilt?.possession_id);
    const pside = rebuilt?.possession_team_side;
    if (Number.isFinite(pid) && pid > 0 && !ADMIN_STAT_TYPES.includes(type)) {
      possessionIds.add(pid);
      const set = possessionTeamById.get(pid) || new Set();
      if (validTeamSide(pside)) set.add(pside);
      possessionTeamById.set(pid, set);
    }

    if (type === 'defensive_contact') add('error', 'Legacy Defensive Contact row', 'This row should be deleted; defensive contact is no longer a stat type.', stat);
    if (extra?.pass?.style) add('warning', 'Legacy pass style', 'Pass style should be removed and pass accuracy should be used instead.', stat);
    if (type === 'period_end' && pid > 0 && rebuilt?.team_side !== 'unknown') add('warning', 'Period end acting team', 'Period-end markers should not have an acting team.', stat);
    if (type === 'substitution' && pid > 0) add('warning', 'Substitution in possession', 'Substitutions should not belong to a possession.', stat);
    if (type === 'shot' && shotRequiresResult(extra?.shot?.outcome) && !extra?.shot?.result) add('error', 'Shot missing result', 'Short/saved/blocked/post shots need a result so possession can be rebuilt.', stat);
    if (type === 'kickout') {
      if (!validTeamSide(extra?.kickout?.won_by?.team_side) && !['sideline_for', 'sideline_against', 'foul'].includes(normalizeOutcomeAlias(extra?.kickout?.outcome))) {
        add('warning', 'Kickout missing winner', 'Kickouts should have Won By/Lost By, or a clear foul/sideline outcome.', stat);
      }
    }
    if (type === 'throw_in' && !validTeamSide(extra?.throw_in?.won_by?.team_side) && normalizeOutcomeAlias(extra?.throw_in?.outcome) !== 'foul') {
      add('warning', 'Throw-in missing winner', 'Throw-ins should have Won By/Lost By unless the outcome is a foul.', stat);
    }
    if ((type === 'pass' && normalizeOutcomeAlias(extra?.pass?.outcome) === 'turnover') || (type === 'carry' && normalizeOutcomeAlias(extra?.carry?.outcome) === 'turnover') || type === 'turnover') {
      if (!validTeamSide(extra?.turnover?.lost_by?.team_side)) add('warning', 'Turnover missing lost-by team', 'Turnovers need a lost-by side for robust possession logic.', stat);
    }
    const foul = extractFoulFromStat(stat);
    if (foul && (!validTeamSide(foul?.foul_by?.team_side) || !validTeamSide(foul?.foul_on?.team_side))) {
      add('warning', 'Foul missing team side', 'Foul By and Foul On should be player/team selections with home/away side.', stat);
    }
    if (type === 'carry') {
      const carrierSide = extra?.carry?.carrier?.team_side;
      const defenderSide = extra?.carry?.defender?.team_side;
      if (validTeamSide(carrierSide) && defenderSide === carrierSide) add('warning', 'Same-team carry defender', 'High-pressure carry defender should be on the opposite team.', stat);
    }
    if (!ADMIN_STAT_TYPES.includes(type) && !validTeamSide(pside)) {
      add('warning', 'Missing possession team', 'Live/action rows should have a rebuilt possession team.', stat);
    }
    if (!validTeamSide(stat?.team_side) && !ADMIN_STAT_TYPES.includes(type)) {
      add('warning', 'Unknown acting team', 'Live/action rows should have a clear acting team.', stat);
    }
    visitSelections(extra, (selection) => {
      if (selection?.kind === 'player' && !validTeamSide(selection?.team_side)) {
        add('warning', 'Player selection missing side', 'Player selections inside row data should carry a home/away team side.', stat);
      }
    });
    if (normalizeOutcomeAlias(extra?.turnover?.turnover_type, 'turnover') !== String(extra?.turnover?.turnover_type || '') && extra?.turnover?.turnover_type) {
      add('info', 'Legacy turnover enum', 'This row uses a legacy turnover enum alias and should be normalized.', stat);
    }
  }

  for (const [pid, teams] of possessionTeamById.entries()) {
    if (teams.size > 1) {
      add('error', 'Mixed-team possession', `Possession #${pid} is assigned to multiple possession teams: ${Array.from(teams).join(', ')}.`);
    }
  }
  const ids = Array.from(possessionIds).sort((a, b) => a - b);
  for (let i = 0; i < ids.length; i += 1) {
    if (ids[i] !== i + 1) {
      add('warning', 'Possession ID gap', `Expected possession #${i + 1}, found #${ids[i]}.`);
      break;
    }
  }

  const matchId = String(list[0]?.match_id || '').trim();
  if (matchId && typeof window !== 'undefined' && window?.localStorage) {
    try {
      const rawIssues = window.localStorage.getItem(`gaeliq-xp-import-issues:${matchId}`);
      const parsedIssues = rawIssues ? JSON.parse(rawIssues) : [];
      if (Array.isArray(parsedIssues)) {
        parsedIssues.forEach((issue) => {
          const signature = String(issue?.signature || '').trim() || 'Unknown import row';
          if (issue?.type === 'ambiguous') {
            add('warning', 'xP import ambiguous row', `Could not safely assign imported xP for ${signature}.`, null);
          } else if (issue?.type === 'unmatched') {
            add('warning', 'xP import unmatched row', `No local shot matched imported xP row ${signature}.`, null);
          }
        });
      }
    } catch {}
  }
  return checks;
}

export function buildLegacyPossessionRepairs(stats) {
  const ordered = (Array.isArray(stats) ? stats.slice() : []).sort((a, b) => {
    const pa = Number(a?.play_id);
    const pb = Number(b?.play_id);
    if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa - pb;
    const ta = Date.parse(String(a?.timestamp || a?.created_date || ''));
    const tb = Date.parse(String(b?.timestamp || b?.created_date || ''));
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });

  const validSide = (side) => side === 'home' || side === 'away';
  const oppositeSide = (side) => (side === 'home' ? 'away' : side === 'away' ? 'home' : null);
  const parseExtra = (stat) => safeParseJSONLocal(stat?.extra_data || '{}', {});
  const cloneSelection = (sel) => {
    if (!sel || typeof sel !== 'object') return sel;
    return { ...sel };
  };
  const sanitizeLegacyExtra = (stat) => {
    const extra = parseExtra(stat);
    let changed = false;
    const next = JSON.parse(JSON.stringify(extra || {}));

    if (stat?.stat_type === 'shot' && next?.shot) {
      const outcome = String(next.shot.outcome || '');
      const supportsResult = ['short', 'saved', 'blocked', 'post'].includes(outcome);
      if (!supportsResult && next.shot.result) {
        next.shot.result = '';
        changed = true;
      }
      if (!supportsResult && next.shot.recovered_by && Object.keys(next.shot.recovered_by || {}).length) {
        next.shot.recovered_by = null;
        changed = true;
      }
      if (outcome !== 'blocked' && next.shot.blocked_by && Object.keys(next.shot.blocked_by || {}).length) {
        next.shot.blocked_by = null;
        changed = true;
      }
      if (outcome !== 'saved' && next.shot.saved_by && Object.keys(next.shot.saved_by || {}).length) {
        next.shot.saved_by = null;
        changed = true;
      }
    }

    if (stat?.stat_type === 'pass' && next?.pass) {
      const outcome = String(next.pass.outcome || '');
      const passerSide = next.pass?.passer?.team_side || stat?.team_side;
      const wonSide = next.pass?.won_by?.team_side;
      const hasPassTurnover = outcome === 'turnover' || !!next?.turnover;
      if (hasPassTurnover && next.pass.won_by && Object.keys(next.pass.won_by || {}).length) {
        next.pass.won_by = null;
        changed = true;
      }
      if (outcome === 'completed' && passerSide && wonSide && wonSide !== passerSide) {
        next.pass.won_by = cloneSelection(next.pass.intended_recipient) || {
          kind: 'team',
          team_side: passerSide,
        };
        changed = true;
      }
    }

    if (!changed) return null;
    return JSON.stringify(next);
  };

  const inferPrimaryActionTeam = (stat, fallbackTeam) => {
    const extra = parseExtra(stat);
    if (stat?.stat_type === 'kickout') {
      return extra?.kickout?.team_side || stat?.team_side || fallbackTeam || 'unknown';
    }
    if (stat?.stat_type === 'throw_in') {
      return extra?.throw_in?.team_side || stat?.team_side || fallbackTeam || 'unknown';
    }
    if (stat?.stat_type === 'pass') {
      return extra?.pass?.passer?.team_side || extra?.turnover?.lost_by?.team_side || stat?.team_side || fallbackTeam || 'unknown';
    }
    if (stat?.stat_type === 'carry') {
      return extra?.carry?.carrier?.team_side || extra?.turnover?.lost_by?.team_side || stat?.team_side || fallbackTeam || 'unknown';
    }
    if (stat?.stat_type === 'shot') {
      return extra?.shot?.player?.team_side || stat?.team_side || fallbackTeam || 'unknown';
    }
    if (stat?.stat_type === 'turnover' || extra?.turnover) {
      return extra?.turnover?.lost_by?.team_side || stat?.team_side || fallbackTeam || 'unknown';
    }
    if (stat?.stat_type === 'foul') {
      const { foulOn } = getFoulTeams(stat);
      return foulOn || stat?.team_side || fallbackTeam || 'unknown';
    }
    return stat?.team_side || fallbackTeam || 'unknown';
  };

  const inferImmediatePossessionStartFromStat = (stat) => {
    const wonSide = inferRestartWinnerSide(stat, null);
    if (stat?.stat_type === 'kickout' && validSide(wonSide)) return { team: wonSide, source: 'Kickout Won' };
    if (stat?.stat_type === 'throw_in' && validSide(wonSide)) return { team: wonSide, source: 'Throw In Won' };
    return null;
  };

  const inferNextRowPossessionFromTerminalStat = (stat, rowActingTeam, nextStat) => {
    const extra = parseExtra(stat);
    if (stat?.stat_type === 'shot') {
      if (extra?.shot?.brought_back_adv) return null;
      const outcome = String(extra?.shot?.outcome || '');
      const result = String(extra?.shot?.result || '');
      if (shotOutcomeGroup(outcome) === 'score' || outcome === 'wide') {
        if (nextStat?.stat_type === 'period_end') return null;
        return { forceStart: true, team: null, source: 'Open Play' };
      }
      if (SHOT_REQUIRES_RESULT_OUTCOMES.includes(outcome) && result === 'opposition') {
        if (nextStat?.stat_type === 'period_end') return null;
        const recovered = extra?.shot?.recovered_by?.team_side || oppositeSide(rowActingTeam || stat?.team_side);
        const labelMap = { short: 'Shot Short', blocked: 'Shot Blocked', post: 'Shot Post', saved: 'Shot Saved' };
        return {
          forceStart: true,
          team: validSide(recovered) ? recovered : null,
          source: labelMap[outcome] || 'Open Play',
        };
      }
      return null;
    }
    const passOutcome = normalizeOutcomeAlias(extra?.pass?.outcome);
    const carryOutcome = normalizeOutcomeAlias(extra?.carry?.outcome);
    const passTurnover = stat?.stat_type === 'pass' && passOutcome === 'turnover';
    const carryTurnover = stat?.stat_type === 'carry' && carryOutcome === 'turnover';
    const passDeadBallTurnover = stat?.stat_type === 'pass' && DEAD_BALL_TURNOVER_OUTCOMES.includes(passOutcome);
    const carryDeadBallTurnover = stat?.stat_type === 'carry' && DEAD_BALL_TURNOVER_OUTCOMES.includes(carryOutcome);
    if (stat?.stat_type === 'turnover' || extra?.turnover || passTurnover || carryTurnover || passDeadBallTurnover || carryDeadBallTurnover) {
      if (extra?.turnover?.brought_back_adv) return null;
      const turnoverType = normalizeOutcomeAlias(extra?.turnover?.turnover_type, 'turnover');
      const recoveredSide = extra?.turnover?.recovered_by?.team_side;
      const forcedSide = extra?.turnover?.forced_by?.team_side;
      const nextBallTeam = inferPossessionOwnerFromNextPlay(nextStat);
      if (turnoverType === 'foul') {
        const foul = extractFoulFromStat(stat);
        const foulOn = foul?.foul_on?.team_side || foul?.foul_on_or_forced_by?.team_side;
        return {
          forceStart: true,
          team: validSide(foulOn)
            ? foulOn
            : (validSide(forcedSide) ? forcedSide : (validSide(nextBallTeam) ? nextBallTeam : oppositeSide(rowActingTeam || stat?.team_side))),
          source: 'Turnover Won',
        };
      }
      return {
        forceStart: true,
        team: validSide(recoveredSide)
          ? recoveredSide
          : (validSide(forcedSide) ? forcedSide : (validSide(nextBallTeam) ? nextBallTeam : oppositeSide(rowActingTeam || stat?.team_side))),
        source: 'Turnover Won',
      };
    }
    if (stat?.stat_type === 'period_end') return null;
    return null;
  };

  const rebuilt = sequencePossessionRows(ordered, {
    parseExtra,
    validSide,
    inferPrimaryActionTeam,
    inferImmediatePossessionStartFromStat,
    inferNextRowPossessionFromTerminalStat,
    sanitizeLegacyExtra,
  });
  const updates = [];

  for (let i = 0; i < ordered.length; i += 1) {
    const current = ordered[i];
    const next = rebuilt[i];
    if (!current || !next) continue;
    const data = {};
    if (current.team_side !== next.team_side) data.team_side = next.team_side;
    if (current.possession_team_side !== next.possession_team_side) data.possession_team_side = next.possession_team_side;
    if (Number(current?.possession_id) !== Number(next?.possession_id)) data.possession_id = next.possession_id;
    if ((current?.extra_data || '') !== (next?.extra_data || '')) data.extra_data = next.extra_data;
    if (Object.keys(data).length) updates.push({ id: current.id, data });
  }

  return updates;
}

export function rebuildPossessionRows(stats) {
  const ordered = (Array.isArray(stats) ? stats.slice() : []).sort((a, b) => {
    const pa = Number(a?.play_id);
    const pb = Number(b?.play_id);
    if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa - pb;
    const ta = Number(a?.normalized_time_s);
    const tb = Number(b?.normalized_time_s);
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    const ra = Number(a?.time_s);
    const rb = Number(b?.time_s);
    if (Number.isFinite(ra) && Number.isFinite(rb) && ra !== rb) return ra - rb;
    const tsa = Date.parse(String(a?.timestamp || a?.created_date || ''));
    const tsb = Date.parse(String(b?.timestamp || b?.created_date || ''));
    if (Number.isFinite(tsa) && Number.isFinite(tsb) && tsa !== tsb) return tsa - tsb;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
  const sequenced = sequencePossessionRows(ordered);
  const map = new Map(sequenced.map((row) => [row.id, row]));
  return (Array.isArray(stats) ? stats : []).map((stat) => map.get(stat?.id) || stat);
}

export function sequencePossessionRows(stats, injected = {}) {
  const ordered = (Array.isArray(stats) ? stats.slice() : []).sort((a, b) => {
    const pa = Number(a?.play_id);
    const pb = Number(b?.play_id);
    if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa - pb;
    const ta = Number(a?.normalized_time_s);
    const tb = Number(b?.normalized_time_s);
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    const ra = Number(a?.time_s);
    const rb = Number(b?.time_s);
    if (Number.isFinite(ra) && Number.isFinite(rb) && ra !== rb) return ra - rb;
    const tsa = Date.parse(String(a?.timestamp || a?.created_date || ''));
    const tsb = Date.parse(String(b?.timestamp || b?.created_date || ''));
    if (Number.isFinite(tsa) && Number.isFinite(tsb) && tsa !== tsb) return tsa - tsb;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
  const parseExtra = injected.parseExtra || ((stat) => safeParseJSONLocal(stat?.extra_data || '{}', {}));
  const validSide = injected.validSide || ((side) => side === 'home' || side === 'away');
  const inferPrimaryActionTeam = injected.inferPrimaryActionTeam || ((stat, fallbackTeam) => {
    const extra = parseExtra(stat);
    if (stat?.stat_type === 'kickout') return extra?.kickout?.team_side || stat?.team_side || fallbackTeam || 'unknown';
    if (stat?.stat_type === 'throw_in') return extra?.throw_in?.team_side || stat?.team_side || fallbackTeam || 'unknown';
    if (stat?.stat_type === 'pass') return extra?.pass?.passer?.team_side || extra?.turnover?.lost_by?.team_side || stat?.team_side || fallbackTeam || 'unknown';
    if (stat?.stat_type === 'carry') return extra?.carry?.carrier?.team_side || extra?.turnover?.lost_by?.team_side || stat?.team_side || fallbackTeam || 'unknown';
    if (stat?.stat_type === 'shot') return extra?.shot?.player?.team_side || stat?.team_side || fallbackTeam || 'unknown';
    if (stat?.stat_type === 'turnover' || extra?.turnover) return extra?.turnover?.lost_by?.team_side || stat?.team_side || fallbackTeam || 'unknown';
    if (stat?.stat_type === 'foul') {
      const { foulOn } = getFoulTeams(stat);
      return foulOn || stat?.team_side || fallbackTeam || 'unknown';
    }
    return stat?.team_side || fallbackTeam || 'unknown';
  });
  const inferImmediatePossessionStartFromStat = injected.inferImmediatePossessionStartFromStat || ((stat, nextStat) => {
    const wonSide = inferRestartWinnerSide(stat, nextStat);
    if (stat?.stat_type === 'kickout' && validSide(wonSide)) return { team: wonSide, source: 'Kickout Won' };
    if (stat?.stat_type === 'throw_in' && validSide(wonSide)) return { team: wonSide, source: 'Throw In Won' };
    return null;
  });
  const inferNextRowPossessionFromTerminalStat = injected.inferNextRowPossessionFromTerminalStat || ((stat, rowActingTeam, nextStat) => {
    const extra = parseExtra(stat);
    if (stat?.stat_type === 'shot') {
      if (extra?.shot?.brought_back_adv) return null;
      const outcome = String(extra?.shot?.outcome || '');
      const result = String(extra?.shot?.result || '');
      if (shotOutcomeGroup(outcome) === 'score' || outcome === 'wide') {
        if (nextStat?.stat_type === 'period_end') return null;
        return { forceStart: true, team: null, source: 'Open Play' };
      }
      if (SHOT_REQUIRES_RESULT_OUTCOMES.includes(outcome) && result === 'opposition') {
        if (nextStat?.stat_type === 'period_end') return null;
        const recovered = extra?.shot?.recovered_by?.team_side || oppositeSide(rowActingTeam || stat?.team_side);
        const labelMap = { short: 'Shot Short', blocked: 'Shot Blocked', post: 'Shot Post', saved: 'Shot Saved' };
        return { forceStart: true, team: validSide(recovered) ? recovered : null, source: labelMap[outcome] || 'Open Play' };
      }
      return null;
    }
    const passOutcome = normalizeOutcomeAlias(extra?.pass?.outcome);
    const carryOutcome = normalizeOutcomeAlias(extra?.carry?.outcome);
    const passTurnover = stat?.stat_type === 'pass' && passOutcome === 'turnover';
    const carryTurnover = stat?.stat_type === 'carry' && carryOutcome === 'turnover';
    const passDeadBallTurnover = stat?.stat_type === 'pass' && DEAD_BALL_TURNOVER_OUTCOMES.includes(passOutcome);
    const carryDeadBallTurnover = stat?.stat_type === 'carry' && DEAD_BALL_TURNOVER_OUTCOMES.includes(carryOutcome);
    if (stat?.stat_type === 'turnover' || extra?.turnover || passTurnover || carryTurnover || passDeadBallTurnover || carryDeadBallTurnover) {
      if (extra?.turnover?.brought_back_adv) return null;
      const turnoverType = normalizeOutcomeAlias(extra?.turnover?.turnover_type, 'turnover');
      const recoveredSide = extra?.turnover?.recovered_by?.team_side;
      const forcedSide = extra?.turnover?.forced_by?.team_side;
      const nextBallTeam = inferPossessionOwnerFromNextPlay(nextStat);
      if (turnoverType === 'foul') {
        const foul = extractFoulFromStat(stat);
        const foulOn = foul?.foul_on?.team_side || foul?.foul_on_or_forced_by?.team_side;
        return {
          forceStart: true,
          team: validSide(foulOn)
            ? foulOn
            : (validSide(forcedSide) ? forcedSide : (validSide(nextBallTeam) ? nextBallTeam : oppositeTeamSide(rowActingTeam || stat?.team_side))),
          source: 'Turnover Won',
        };
      }
      return {
        forceStart: true,
        team: validSide(recoveredSide)
          ? recoveredSide
          : (validSide(forcedSide) ? forcedSide : (validSide(nextBallTeam) ? nextBallTeam : oppositeTeamSide(rowActingTeam || stat?.team_side))),
        source: 'Turnover Won',
      };
    }
    if (stat?.stat_type === 'period_end') return null;
    return null;
  });
  const sanitizeLegacyExtra = injected.sanitizeLegacyExtra || ((stat) => null);

  const rebuilt = [];
  let currentPossessionId = 0;
  let currentPossessionTeam = 'unknown';
  let nextPossession = null;
  let currentStartSource = 'Open Play';

  for (let idx = 0; idx < ordered.length; idx += 1) {
    const original = ordered[idx];
    if (!original) continue;
    const stat = original;
    const statType = String(stat?.stat_type || '');
    if (statType === 'substitution') {
      rebuilt.push({
        ...stat,
        team_side: 'unknown',
        possession_team_side: 'unknown',
        possession_id: 0,
        __possession_start_source: 'Open Play',
      });
      continue;
    }
    if (statType === 'period_end') {
      const attachedTeam = validSide(currentPossessionTeam) ? currentPossessionTeam : 'unknown';
      rebuilt.push({
        ...stat,
        team_side: 'unknown',
        possession_team_side: attachedTeam,
        possession_id: currentPossessionId > 0 && validSide(attachedTeam) ? currentPossessionId : 0,
        __possession_start_source: currentStartSource,
      });
      // Close the live possession. The next half starts only when a real
      // restart/live action arrives; immediate restart rows still override this.
      nextPossession = { forceStart: true, team: null, source: 'Open Play' };
      continue;
    }
    const nextStat = getNextBallActionStat(ordered, idx);
    const extra = parseExtra(stat);
    const { foul, foulBy, foulOn } = getFoulTeams(stat);
    const immediateStart = inferImmediatePossessionStartFromStat(stat, nextStat);
    const sanitizedExtra = sanitizeLegacyExtra(stat);
    const extraData = sanitizedExtra != null ? sanitizedExtra : (stat?.extra_data || '');
    const actorFromData = inferPrimaryActionTeam({ ...stat, extra_data: extraData }, currentPossessionTeam);
    const isEmbeddedActionFoul =
      (stat?.stat_type === 'pass' && String(extra?.pass?.outcome || '') === 'foul')
      || (stat?.stat_type === 'carry' && String(extra?.carry?.outcome || '') === 'foul')
      || (stat?.stat_type === 'kickout' && String(extra?.kickout?.outcome || '') === 'foul')
      || (stat?.stat_type === 'throw_in' && String(extra?.throw_in?.outcome || '') === 'foul');
    const isStandaloneFoul = !!foul && !isEmbeddedActionFoul;

    let startInfo = null;
    if (immediateStart?.team && validSide(immediateStart.team)) {
      startInfo = immediateStart;
    } else if (nextPossession?.forceStart) {
      const fallbackTeam = validSide(actorFromData) ? actorFromData : (validSide(currentPossessionTeam) ? currentPossessionTeam : stat?.team_side);
      startInfo = {
        team: validSide(nextPossession.team) ? nextPossession.team : fallbackTeam,
        source: nextPossession.source || 'Open Play',
      };
    } else if (currentPossessionId <= 0) {
      startInfo = {
        team: validSide(actorFromData) ? actorFromData : (validSide(stat?.possession_team_side) ? stat.possession_team_side : stat?.team_side),
        source: 'Open Play',
      };
    }

    if (startInfo?.team && validSide(startInfo.team)) {
      currentPossessionId += 1;
      currentPossessionTeam = startInfo.team;
      currentStartSource = startInfo.source || 'Open Play';
    } else if (!validSide(currentPossessionTeam) && validSide(actorFromData)) {
      currentPossessionId += currentPossessionId > 0 ? 1 : 1;
      currentPossessionTeam = actorFromData;
      currentStartSource = 'Open Play';
    }

    nextPossession = null;

    let rowActingTeam = actorFromData;
    let rowPossessionTeam = currentPossessionTeam;

    if (immediateStart?.team && validSide(immediateStart.team)) {
      rowActingTeam = validSide(actorFromData) ? actorFromData : immediateStart.team;
      rowPossessionTeam = immediateStart.team;
    } else if (isStandaloneFoul) {
      rowPossessionTeam = validSide(currentPossessionTeam) ? currentPossessionTeam : (validSide(foulOn) ? foulOn : actorFromData);
      rowActingTeam = rowPossessionTeam;
    } else if (isEmbeddedActionFoul) {
      rowPossessionTeam = validSide(actorFromData) ? actorFromData : currentPossessionTeam;
      rowActingTeam = validSide(actorFromData) ? actorFromData : rowPossessionTeam;
    } else {
      if (!validSide(rowPossessionTeam) && validSide(actorFromData)) rowPossessionTeam = actorFromData;
      if (!validSide(rowActingTeam) && validSide(rowPossessionTeam)) rowActingTeam = rowPossessionTeam;
    }

    const row = {
      ...stat,
      team_side: rowActingTeam,
      possession_team_side: rowPossessionTeam,
      possession_id: currentPossessionId,
      extra_data: extraData,
      __possession_start_source: currentStartSource,
    };

    rebuilt.push(row);
    nextPossession = inferNextRowPossessionFromTerminalStat(row, rowActingTeam, nextStat);
  }

  return rebuilt;
}
