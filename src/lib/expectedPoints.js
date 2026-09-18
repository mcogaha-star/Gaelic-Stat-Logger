export const POSSESSION_XP_AGGREGATION_METHOD = 'max_xp_per_possession_v1';

function normalizeTeamSide(value) {
  return value === 'away' ? 'away' : value === 'home' ? 'home' : '';
}

function getPossessionId(shot) {
  const value = Number(shot?.possession_id ?? shot?.possessionId);
  return Number.isFinite(value) ? value : null;
}

function getPossessionKey(shot, index) {
  const teamSide = normalizeTeamSide(shot?.team_side ?? shot?.teamSide);
  const possessionId = getPossessionId(shot);
  const half = String(shot?.half || shot?.gameHalf || '');
  if (teamSide && possessionId != null) return `${half}|${teamSide}|${possessionId}`;
  return `shot:${String(shot?.id ?? shot?.key ?? index)}`;
}

function getExpectedPoints(shot) {
  const raw = shot?.xp ?? shot?.xP ?? shot?.expected_points ?? shot?.expectedPoints;
  if (raw == null || String(raw).trim() === '') return NaN;
  const value = Number(raw);
  return Number.isFinite(value) ? value : NaN;
}

/**
 * ShotArc treats retained follow-up shots as part of the same attack. For
 * aggregate xP, each attack contributes only its highest-valued shot.
 */
export function selectHighestXpShotPerPossession(shots = []) {
  const selectedByPossession = new Map();
  (Array.isArray(shots) ? shots : []).forEach((shot, index) => {
    const xp = getExpectedPoints(shot);
    if (!Number.isFinite(xp)) return;
    const key = getPossessionKey(shot, index);
    const current = selectedByPossession.get(key);
    if (!current || xp > current.xp) {
      selectedByPossession.set(key, { shot, xp, firstIndex: current?.firstIndex ?? index });
    }
  });
  return Array.from(selectedByPossession.values())
    .sort((a, b) => a.firstIndex - b.firstIndex)
    .map(({ shot }) => shot);
}

export function sumPossessionExpectedPoints(shots = []) {
  return selectHighestXpShotPerPossession(shots)
    .reduce((sum, shot) => sum + getExpectedPoints(shot), 0);
}
