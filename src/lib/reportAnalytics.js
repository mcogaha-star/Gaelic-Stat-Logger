export const PITCH_W = 145;
export const PITCH_H = 85;
export const OPP_45_X = PITCH_W - 45;
export const GOAL_X = PITCH_W;
export const GOAL_Y = PITCH_H / 2;
export const GOAL_POST_TOP_Y = 39.25;
export const GOAL_POST_BOTTOM_Y = 45.75;
export const SCORING_ZONE_RADIUS = 32;
export const SCORING_ZONE_ANGLE_DEG = 60;
export const POSSESSION_REBUILD_VERSION = 'v12';
export const DEFENCE_SET_MIGRATION_VERSION = 'v1';

function shouldMigrateDefenceSetRow(stat) {
  if (!stat || typeof stat?.counter_attack !== 'boolean') return false;
  return !['kickout', 'period_end', 'substitution'].includes(String(stat?.stat_type || ''));
}

export function buildLegacyDefenceSetRepairs(stats) {
  return (Array.isArray(stats) ? stats : [])
    .filter(shouldMigrateDefenceSetRow)
    .map((stat) => ({
      id: stat.id,
      data: { counter_attack: !stat.counter_attack },
    }));
}

export function normalizeDefenceSetRows(stats, migrated = false) {
  if (migrated) return Array.isArray(stats) ? stats : [];
  return (Array.isArray(stats) ? stats : []).map((stat) => (
    shouldMigrateDefenceSetRow(stat)
      ? { ...stat, counter_attack: !stat.counter_attack }
      : stat
  ));
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
  return match?.code === 'GAA' && match?.level === 'Intercounty' ? 35 * 60 : 30 * 60;
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
  if (stat?.half === 'second') return normalized >= offsets.second ? normalized : offsets.second + normalized;
  if (stat?.half === 'et_first') return normalized >= offsets.et_first ? normalized : offsets.et_first + normalized;
  if (stat?.half === 'et_second') return normalized >= offsets.et_second ? normalized : offsets.et_second + normalized;
  if (stat?.half === 'first' && normalized > offsets.second) return normalized;
  return normalized;
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

export function formatMatchClock(matchTimeS, match) {
  const total = Number(matchTimeS);
  if (!Number.isFinite(total) || total < 0) return '00:00';

  const secondStart = getSecondHalfStartS(match);
  const offsets = getMatchSectionOffsets(match);
  const formatBase = (seconds) => {
    const mins = Math.floor(Math.max(0, seconds) / 60);
    const secs = Math.floor(Math.max(0, seconds) % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };
  const formatStoppage = (baseMinutes, secondsIntoSection) => {
    const added = Math.max(0, secondsIntoSection - baseMinutes * 60);
    if (added <= 0) return formatBase(secondsIntoSection);
    const addMins = Math.floor(added / 60);
    const addSecs = Math.floor(added % 60);
    return `${baseMinutes}+${addMins}:${String(addSecs).padStart(2, '0')}`;
  };

  if (total < secondStart) return formatStoppage(secondStart / 60, total);
  if (total <= offsets.et_first) return formatStoppage((secondStart * 2) / 60, total);
  if (total < offsets.et_second) return formatBase(total - offsets.et_first);
  return formatBase(total - offsets.et_second);
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
  const ex = Number(stat?.end_x_position);
  if (!Number.isFinite(sx) || !Number.isFinite(ex)) return false;
  const progressiveMeters = getProgressiveMeters(stat);
  const threshold = sx >= OPP_45_X ? 5 : 10;
  return progressiveMeters >= threshold || (sx < OPP_45_X && ex >= OPP_45_X);
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

export function inferPossessionOwnerFromNextPlay(stat) {
  if (!stat) return null;
  const ex = safeParseJSONLocal(stat?.extra_data || '{}', {});

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
  const passTurnover = stat?.stat_type === 'pass' && String(ex?.pass?.outcome || '') === 'turnover';
  const carryTurnover = stat?.stat_type === 'carry' && String(ex?.carry?.outcome || '') === 'turnover';
  if (stat?.stat_type === 'turnover' || ex?.turnover || passTurnover || carryTurnover) {
    const recovered = ex?.turnover?.recovered_by?.team_side;
    if (validTeamSide(recovered)) return recovered;
    const forced = ex?.turnover?.forced_by?.team_side;
    if (validTeamSide(forced)) return forced;
    const lost = ex?.turnover?.lost_by?.team_side || stat?.team_side;
    return oppositeTeamSide(lost);
  }
  return validTeamSide(stat?.team_side) ? stat.team_side : null;
}

function isNonBallInterruption(stat) {
  return String(stat?.stat_type || '') === 'substitution';
}

function getNextBallActionStat(list, startIndex) {
  if (!Array.isArray(list)) return null;
  for (let i = startIndex + 1; i < list.length; i += 1) {
    const stat = list[i];
    if (!stat || isNonBallInterruption(stat)) continue;
    return stat;
  }
  return null;
}

function isTurnoverLikeStat(stat, ex = null) {
  if (!stat) return false;
  const extra = ex || safeParseJSONLocal(stat?.extra_data || '{}', {});
  const passTurnover = stat?.stat_type === 'pass' && String(extra?.pass?.outcome || '') === 'turnover';
  const carryTurnover = stat?.stat_type === 'carry' && String(extra?.carry?.outcome || '') === 'turnover';
  return stat?.stat_type === 'turnover' || !!extra?.turnover || passTurnover || carryTurnover;
}

export function inferRestartWinnerSide(stat, nextStat = null) {
  if (!stat) return null;
  const ex = safeParseJSONLocal(stat?.extra_data || '{}', {});
  const restart = stat?.stat_type === 'kickout' ? ex?.kickout : stat?.stat_type === 'throw_in' ? ex?.throw_in : null;
  if (!restart) return null;

  const restartTeam = restart?.team_side || stat?.team_side || null;
  const outcome = String(restart?.outcome || '');
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

export function classifyTerminalOutcome(stat, teamSide) {
  if (!stat) return 'OTHER';
  const ex = safeParseJSONLocal(stat?.extra_data || '{}', {});
  const outcome = String(
    stat?.stat_type === 'shot' ? ex?.shot?.outcome :
    stat?.stat_type === 'pass' ? ex?.pass?.outcome :
    stat?.stat_type === 'carry' ? ex?.carry?.outcome :
    stat?.stat_type === 'kickout' ? ex?.kickout?.outcome :
    stat?.stat_type === 'turnover' ? ex?.turnover?.turnover_type :
    stat?.stat_type === 'throw_in' ? ex?.throw_in?.outcome :
    stat?.stat_type === 'foul' ? ex?.foul?.foul_type :
    stat?.stat_type === 'defensive_contact' ? ex?.defensive_contact?.type :
    ''
  );

  if (stat?.stat_type === 'period_end') return 'HALF_END';

  if (stat?.stat_type === 'shot') {
    if (ex?.shot?.brought_back_adv) return 'CONTINUE';
    if (shotOutcomeGroup(ex?.shot?.outcome) === 'score') return 'SCORE';
    const res = String(ex?.shot?.result || '');
    if (ex?.shot?.outcome === 'wide') return 'WIDE';
    if (['saved', 'blocked', 'short', 'post'].includes(String(ex?.shot?.outcome || ''))) {
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
  if (outcome === 'sideline_against' || outcome === 'goal_kick_against') return 'TURNOVER';
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
    return stat.team_side === teamSide || foulBy === teamSide || foulOn === teamSide;
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
    const isRelevant = stat.team_side === teamSide || foulBy === teamSide || foulOn === teamSide;
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
      if (['short', 'post', 'saved', 'blocked'].includes(outcome) && result === 'opposition') {
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
    const passTurnover = stat?.stat_type === 'pass' && String(extra?.pass?.outcome || '') === 'turnover';
    const carryTurnover = stat?.stat_type === 'carry' && String(extra?.carry?.outcome || '') === 'turnover';
    if (stat?.stat_type === 'turnover' || extra?.turnover || passTurnover || carryTurnover) {
      if (extra?.turnover?.brought_back_adv) return null;
      const turnoverType = String(extra?.turnover?.turnover_type || '');
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
      if (['short', 'post', 'saved', 'blocked'].includes(outcome) && result === 'opposition') {
        if (nextStat?.stat_type === 'period_end') return null;
        const recovered = extra?.shot?.recovered_by?.team_side || oppositeSide(rowActingTeam || stat?.team_side);
        const labelMap = { short: 'Shot Short', blocked: 'Shot Blocked', post: 'Shot Post', saved: 'Shot Saved' };
        return { forceStart: true, team: validSide(recovered) ? recovered : null, source: labelMap[outcome] || 'Open Play' };
      }
      return null;
    }
    const passTurnover = stat?.stat_type === 'pass' && String(extra?.pass?.outcome || '') === 'turnover';
    const carryTurnover = stat?.stat_type === 'carry' && String(extra?.carry?.outcome || '') === 'turnover';
    if (stat?.stat_type === 'turnover' || extra?.turnover || passTurnover || carryTurnover) {
      if (extra?.turnover?.brought_back_adv) return null;
      const turnoverType = String(extra?.turnover?.turnover_type || '');
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
    if (String(stat?.stat_type || '') === 'substitution') {
      rebuilt.push({
        ...stat,
        team_side: 'unknown',
        possession_team_side: 'unknown',
        possession_id: 0,
        __possession_start_source: 'Open Play',
      });
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
