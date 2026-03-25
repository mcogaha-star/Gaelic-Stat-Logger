export const PITCH_W = 145;
export const PITCH_H = 85;
export const OPP_45_X = PITCH_W - 45;
export const GOAL_X = PITCH_W;
export const GOAL_Y = PITCH_H / 2;
export const GOAL_POST_TOP_Y = 39.25;
export const GOAL_POST_BOTTOM_Y = 45.75;

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

export function getMatchTimeS(stat, match, imputedMap) {
  const normalized = getNormalizedTimeS(stat, imputedMap);
  if (!Number.isFinite(normalized)) return null;
  const secondHalfStartS = getSecondHalfStartS(match);
  if (stat?.half === 'second') return secondHalfStartS + normalized;
  if (stat?.half === 'first' && normalized > secondHalfStartS) return normalized;
  return normalized;
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
  if (!Number.isFinite(distance) || distance > 32) return false;
  const dx = GOAL_X - Number(x);
  const dy = Number(y) - GOAL_Y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || dx < 0) return false;
  const angle = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
  return angle <= 60;
}

export function getProgressiveMeters(stat) {
  const sx = Number(stat?.x_position);
  const ex = Number(stat?.end_x_position);
  if (!Number.isFinite(sx) || !Number.isFinite(ex)) return 0;
  return Math.max(0, ex - sx);
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
    if (shotOutcomeGroup(ex?.shot?.outcome) === 'score') return 'SCORE';
    const res = String(ex?.shot?.result || '');
    if (ex?.shot?.outcome === 'wide') return 'MISSED_SHOT';
    if (['saved', 'blocked', 'short', 'post'].includes(String(ex?.shot?.outcome || ''))) {
      if (res === 'opposition') return 'MISSED_SHOT';
      return 'CONTINUE';
    }
    return 'OTHER';
  }

  const { foulBy, foulOn } = getFoulTeams(stat);
  if (foulBy === teamSide) return 'TURNOVER';
  if (foulOn === teamSide) return 'CONTINUE';

  if (stat?.stat_type === 'turnover' || ex?.turnover) return 'TURNOVER';
  if (outcome === 'sideline_against' || outcome === 'goal_kick_against') return 'TURNOVER';
  if (outcome === 'sideline_for' || outcome === '45_for' || outcome === '45' || outcome === 'goal_kick_for') return 'CONTINUE';

  return 'OTHER';
}

export function derivePossessionOutcome(events, teamSide) {
  const acting = (Array.isArray(events) ? events : []).filter((e) => e && e.team_side === teamSide);
  if (!acting.length) return 'Other';
  for (let i = acting.length - 1; i >= 0; i -= 1) {
    const cls = classifyTerminalOutcome(acting[i], teamSide);
    if (cls === 'CONTINUE' || cls === 'OTHER') continue;
    if (cls === 'SCORE') return 'Score';
    if (cls === 'MISSED_SHOT') return 'Missed Shot';
    if (cls === 'TURNOVER') return 'Turnover';
    if (cls === 'HALF_END') return 'Half End';
  }
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
    const next = list[i + 1];
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
