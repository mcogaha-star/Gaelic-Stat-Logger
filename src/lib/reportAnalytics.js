export const PITCH_W = 145;
export const PITCH_H = 85;
export const OPP_45_X = PITCH_W - 45;
export const GOAL_X = PITCH_W;
export const GOAL_Y = PITCH_H / 2;
export const GOAL_POST_TOP_Y = 39.25;
export const GOAL_POST_BOTTOM_Y = 45.75;
export const SCORING_ZONE_RADIUS = 32;
export const SCORING_ZONE_ANGLE_DEG = 60;
export const POSSESSION_REBUILD_VERSION = 'v2';

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
  if (stat?.half === 'second') return offsets.second + normalized;
  if (stat?.half === 'et_first') return offsets.et_first + normalized;
  if (stat?.half === 'et_second') return offsets.et_second + normalized;
  if (stat?.half === 'first' && normalized > offsets.second) return normalized;
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
      if (outcome === 'turnover' && next.pass.won_by && Object.keys(next.pass.won_by || {}).length) {
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

  const inferImmediatePossessionStartFromStat = (stat) => {
    const extra = parseExtra(stat);
    if (stat?.stat_type === 'kickout') {
      const outcome = String(extra?.kickout?.outcome || '');
      const wonSide = extra?.kickout?.won_by?.team_side;
      if ((outcome === 'clean' || outcome === 'break') && validSide(wonSide)) return wonSide;
    }
    if (stat?.stat_type === 'throw_in') {
      const outcome = String(extra?.throw_in?.outcome || '');
      const wonSide = extra?.throw_in?.won_by?.team_side;
      if ((outcome === 'clean' || outcome === 'break') && validSide(wonSide)) return wonSide;
    }
    return null;
  };

  const inferPendingNextPossessionFromStat = (stat, rowActingTeam) => {
    const extra = parseExtra(stat);
    if (stat?.stat_type === 'shot') {
      const outcome = String(extra?.shot?.outcome || '');
      const result = String(extra?.shot?.result || '');
      if (['short', 'post', 'saved', 'blocked'].includes(outcome) && result === 'opposition') {
        return oppositeSide(rowActingTeam || stat?.team_side);
      }
      return null;
    }
    if (stat?.stat_type === 'turnover' || extra?.turnover) {
      const turnoverType = String(extra?.turnover?.turnover_type || '');
      const recoveredSide = extra?.turnover?.recovered_by?.team_side;
      if (turnoverType && turnoverType !== 'foul' && validSide(recoveredSide)) return recoveredSide;
    }
    return null;
  };

  const getCanonicalActingSide = (stat, fallbackPossessionTeam) => {
    const extra = parseExtra(stat);
    const { foulBy, foulOn } = getFoulTeams(stat);
    if (validSide(foulOn) && foulOn !== foulBy) return foulOn;

    if (stat?.stat_type === 'turnover' || extra?.turnover) {
      const turnoverType = String(extra?.turnover?.turnover_type || '');
      const lostSide = extra?.turnover?.lost_by?.team_side;
      if (turnoverType && turnoverType !== 'foul' && validSide(lostSide)) return lostSide;
    }

    if (validSide(stat?.team_side)) return stat.team_side;
    if (validSide(fallbackPossessionTeam)) return fallbackPossessionTeam;
    return 'unknown';
  };

  const updates = [];
  let currentPossessionId = 0;
  let currentPossessionTeam = 'unknown';
  let pendingNextPossessionTeam = null;

  for (let i = 0; i < ordered.length; i += 1) {
    const stat = ordered[i];
    if (!stat) continue;
    const data = {};

    if (validSide(pendingNextPossessionTeam)) {
      currentPossessionId = currentPossessionId > 0 ? currentPossessionId + 1 : 1;
      currentPossessionTeam = pendingNextPossessionTeam;
      pendingNextPossessionTeam = null;
    }

    const immediateStartTeam = inferImmediatePossessionStartFromStat(stat);
    if (validSide(immediateStartTeam) && immediateStartTeam !== currentPossessionTeam) {
      currentPossessionId = currentPossessionId > 0 ? currentPossessionId + 1 : 1;
      currentPossessionTeam = immediateStartTeam;
    }

    if (currentPossessionId <= 0) {
      currentPossessionId = 1;
      currentPossessionTeam =
        validSide(currentPossessionTeam) ? currentPossessionTeam
          : validSide(stat?.possession_team_side) ? stat.possession_team_side
          : getCanonicalActingSide(stat, stat?.team_side);
    }

    let rowPossessionTeam = validSide(currentPossessionTeam)
      ? currentPossessionTeam
      : (validSide(stat?.possession_team_side) ? stat.possession_team_side : 'unknown');
    let rowActingTeam = getCanonicalActingSide(stat, rowPossessionTeam);

    const { foul, foulBy, foulOn } = getFoulTeams(stat);
    if (foul && validSide(foulOn) && foulOn !== foulBy) {
      rowActingTeam = foulOn;
      rowPossessionTeam = foulOn;
      currentPossessionTeam = foulOn;
    } else {
      const extra = parseExtra(stat);
      if (stat?.stat_type === 'turnover' || extra?.turnover) {
        const turnoverType = String(extra?.turnover?.turnover_type || '');
        const lostSide = extra?.turnover?.lost_by?.team_side;
        if (turnoverType && turnoverType !== 'foul' && validSide(lostSide)) {
          rowActingTeam = lostSide;
          rowPossessionTeam = lostSide;
          currentPossessionTeam = lostSide;
        }
      }
    }

    if (stat.team_side !== rowActingTeam) data.team_side = rowActingTeam;
    if (stat.possession_team_side !== rowPossessionTeam) data.possession_team_side = rowPossessionTeam;
    if (Number(stat?.possession_id) !== currentPossessionId) data.possession_id = currentPossessionId;
    const sanitizedExtra = sanitizeLegacyExtra(stat);
    if (sanitizedExtra != null && sanitizedExtra !== (stat?.extra_data || '')) data.extra_data = sanitizedExtra;

    if (Object.keys(data).length) {
      updates.push({ id: stat.id, data });
    }

    pendingNextPossessionTeam = inferPendingNextPossessionFromStat(stat, rowActingTeam);
  }

  return updates;
}
