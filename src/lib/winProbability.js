function clamp(value, min = 0, max = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

export function normalizeShotTypeForSim(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === '2 point' || raw === '2-point' || raw === '2_point') return '2_point';
  if (raw === 'point') return 'point';
  if (raw === 'goal') return 'goal';
  return '';
}

export function getShotScoreValue(shotType) {
  const normalized = normalizeShotTypeForSim(shotType);
  if (normalized === 'point') return 1;
  if (normalized === '2_point') return 2;
  if (normalized === 'goal') return 3;
  return null;
}

export function getShotMakeProbabilityFromXp(shotType, xpValue) {
  const scoreValue = getShotScoreValue(shotType);
  const xp = Number(xpValue);
  if (!Number.isFinite(xp) || !Number.isFinite(scoreValue) || scoreValue <= 0) return NaN;
  return clamp(xp / scoreValue, 0, 1);
}

function buildSimShot(shot) {
  const teamSide = shot?.team_side === 'away' ? 'away' : shot?.team_side === 'home' ? 'home' : '';
  const shotType = normalizeShotTypeForSim(shot?.shotType ?? shot?.shot_type ?? shot?.type);
  const xp = Number(shot?.xp ?? shot?.xP ?? shot?.expected_points ?? shot?.expectedPoints);
  const scoreValue = getShotScoreValue(shotType);
  const makeProbability = getShotMakeProbabilityFromXp(shotType, xp);
  if (!teamSide || !shotType || !Number.isFinite(scoreValue) || !Number.isFinite(makeProbability)) return null;
  return {
    team_side: teamSide,
    shotType,
    xp,
    scoreValue,
    makeProbability,
  };
}

export function simulateFullMatchFromShots(shots, iterations = 10000, rng = Math.random) {
  const normalizedShots = (Array.isArray(shots) ? shots : [])
    .map(buildSimShot)
    .filter(Boolean);

  if (!normalizedShots.length) return null;

  const totalIterations = Math.max(1, Math.floor(Number(iterations) || 10000));
  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;
  let totalHomePoints = 0;
  let totalAwayPoints = 0;
  let rawExpectedHomePoints = 0;
  let rawExpectedAwayPoints = 0;
  let homeShotCount = 0;
  let awayShotCount = 0;

  for (const shot of normalizedShots) {
    if (shot.team_side === 'home') {
      rawExpectedHomePoints += shot.xp;
      homeShotCount += 1;
    } else if (shot.team_side === 'away') {
      rawExpectedAwayPoints += shot.xp;
      awayShotCount += 1;
    }
  }

  for (let i = 0; i < totalIterations; i += 1) {
    let homePoints = 0;
    let awayPoints = 0;

    for (const shot of normalizedShots) {
      const roll = Number(rng());
      const made = Number.isFinite(roll) && roll < shot.makeProbability;
      if (!made) continue;
      if (shot.team_side === 'home') homePoints += shot.scoreValue;
      if (shot.team_side === 'away') awayPoints += shot.scoreValue;
    }

    totalHomePoints += homePoints;
    totalAwayPoints += awayPoints;

    if (homePoints > awayPoints) homeWins += 1;
    else if (awayPoints > homePoints) awayWins += 1;
    else draws += 1;
  }

  return {
    iterations: totalIterations,
    shotCountUsed: normalizedShots.length,
    homeShotCount,
    awayShotCount,
    homeWinProb: homeWins / totalIterations,
    awayWinProb: awayWins / totalIterations,
    drawProb: draws / totalIterations,
    avgHomePoints: totalHomePoints / totalIterations,
    avgAwayPoints: totalAwayPoints / totalIterations,
    rawExpectedHomePoints,
    rawExpectedAwayPoints,
    homeWins,
    awayWins,
    draws,
  };
}

export default simulateFullMatchFromShots;
