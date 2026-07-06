import demoBundle from '@/data/demoMatch.json';
import { buildMatchRosterSnapshotPatch } from '@/lib/matchRosterSnapshots';

export const DEMO_SOURCE_ID = 'armagh-galway-2026-01-31';
export const DEMO_MATCH_ID = `demo-${DEMO_SOURCE_ID}-match`;
export const DEMO_YOUTUBE_URL = 'https://www.youtube.com/watch?v=-1JJ2TQIaW4';

const DEMO_VARIANTS = {
  analysis: {
    sourceId: DEMO_SOURCE_ID,
    matchId: DEMO_MATCH_ID,
    teamIds: {
      home: `demo-${DEMO_SOURCE_ID}-team-home`,
      away: `demo-${DEMO_SOURCE_ID}-team-away`,
    },
    mode: 'analysis',
  },
  live: {
    sourceId: `${DEMO_SOURCE_ID}-live`,
    matchId: `demo-${DEMO_SOURCE_ID}-live-match`,
    teamIds: {
      home: `demo-${DEMO_SOURCE_ID}-live-team-home`,
      away: `demo-${DEMO_SOURCE_ID}-live-team-away`,
    },
    mode: 'live',
  },
};

function getDemoVariantConfig(mode = 'analysis') {
  return String(mode || 'analysis').toLowerCase() === 'live'
    ? DEMO_VARIANTS.live
    : DEMO_VARIANTS.analysis;
}

function stripRuntimeFields(record = {}) {
  const next = {};
  for (const [key, value] of Object.entries(record || {})) {
    if (key === 'created_date' || key === 'updated_date') continue;
    if (key === 'server_match_id' || key === 'server_stat_id') continue;
    if (key.startsWith('server_')) continue;
    next[key] = value;
  }
  return next;
}

function safeParseJson(value, fallback = null) {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function remapDeep(value, idMap) {
  if (typeof value === 'string') return idMap.get(value) || value;
  if (Array.isArray(value)) return value.map((item) => remapDeep(item, idMap));
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, remapDeep(child, idMap)]),
  );
}

function remapJsonString(value, idMap) {
  const parsed = safeParseJson(value, null);
  if (parsed == null) return value;
  return JSON.stringify(remapDeep(parsed, idMap));
}

function remapJsonFields(record, fields, idMap) {
  const next = { ...record };
  for (const field of fields) {
    if (typeof next[field] === 'string') next[field] = remapJsonString(next[field], idMap);
  }
  return next;
}

function normalizeLiveTurnoverType(value, fallback = 'turnover') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === 'sideline against' || normalized === 'sidelineagainst' || normalized === 'sideline') return 'sideline_against';
  if (normalized === 'sideline for' || normalized === 'sidelinefor') return 'sideline_for';
  if (normalized === 'goal kick for') return 'goal_kick_for';
  if (normalized === 'goal kick against') return 'goal_kick_against';
  return normalized;
}

function createLiveFlattenedStat(baseStat = {}, { statType, extraKey, extraValue, x, y, fallbackTurnoverType = 'turnover' }) {
  const nextExtra = { [extraKey]: extraValue };
  if (extraKey === 'turnover' && normalizeLiveTurnoverType(extraValue?.turnover_type, '') === 'foul') {
    const parsed = safeParseJson(baseStat?.extra_data, {});
    if (parsed?.foul) nextExtra.foul = parsed.foul;
  }
  const next = {
    ...baseStat,
    stat_type: statType,
    is_pass: false,
    extra_data: JSON.stringify(nextExtra),
  };
  if (Number.isFinite(x)) next.x_position = x;
  if (Number.isFinite(y)) next.y_position = y;
  if (statType !== 'kickout' && statType !== 'throw_in') {
    next.end_x_position = Number.isFinite(x) ? x : null;
    next.end_y_position = Number.isFinite(y) ? y : null;
  }
  if (statType === 'turnover') {
    const actingSide =
      extraValue?.lost_by?.team_side
      || extraValue?.forced_by?.team_side
      || baseStat?.team_side
      || 'unknown';
    next.team_side = actingSide;
    next.extra_data = JSON.stringify({
      turnover: {
        ...extraValue,
        turnover_type: normalizeLiveTurnoverType(extraValue?.turnover_type, fallbackTurnoverType),
      },
      ...(nextExtra.foul ? { foul: nextExtra.foul } : {}),
    });
  } else if (statType === 'foul') {
    const actingSide =
      extraValue?.foul_on?.team_side
      || extraValue?.foul_on_or_forced_by?.team_side
      || extraValue?.foul_by?.team_side
      || baseStat?.team_side
      || 'unknown';
    next.team_side = actingSide;
  }
  return next;
}

function filterDemoStatsForMode(stats = [], demoConfig) {
  const sourceStats = Array.isArray(stats) ? stats : [];
  if (demoConfig.mode !== 'live') return sourceStats;

  const liveSupportedTypes = new Set([
    'shot',
    'kickout',
    'turnover',
    'foul',
    'throw_in',
    'substitution',
    'period_end',
  ]);

  const flattened = [];
  for (const stat of sourceStats) {
    const type = String(stat?.stat_type || '').trim().toLowerCase();
    if (liveSupportedTypes.has(type)) {
      flattened.push(stat);
      continue;
    }

    const extra = safeParseJson(stat?.extra_data, {});
    const embeddedTurnover = extra?.turnover && typeof extra.turnover === 'object' ? extra.turnover : null;
    const embeddedFoul = extra?.foul && typeof extra.foul === 'object' ? extra.foul : null;
    const fallbackX = Number.isFinite(Number(stat?.end_x_position)) ? Number(stat.end_x_position) : Number(stat?.x_position);
    const fallbackY = Number.isFinite(Number(stat?.end_y_position)) ? Number(stat.end_y_position) : Number(stat?.y_position);

    if (embeddedTurnover) {
      const fallbackTurnoverType =
        type === 'pass' ? 'interception'
          : type === 'carry' ? 'tackle'
            : 'turnover';
      flattened.push(createLiveFlattenedStat(stat, {
        statType: 'turnover',
        extraKey: 'turnover',
        extraValue: embeddedTurnover,
        x: fallbackX,
        y: fallbackY,
        fallbackTurnoverType,
      }));
      continue;
    }

    if (embeddedFoul) {
      flattened.push(createLiveFlattenedStat(stat, {
        statType: 'foul',
        extraKey: 'foul',
        extraValue: embeddedFoul,
        x: fallbackX,
        y: fallbackY,
      }));
    }
  }

  return flattened;
}

function buildIdMaps(bundle, demoConfig) {
  const oldMatchId = bundle?.match?.id;
  const homeTeamId = bundle?.match?.home_team_id;
  const awayTeamId = bundle?.match?.away_team_id;

  const teamIdMap = new Map([
    [homeTeamId, demoConfig.teamIds.home],
    [awayTeamId, demoConfig.teamIds.away],
  ].filter(([oldId]) => !!oldId));

  const playerIdMap = new Map(
    (bundle?.players || [])
      .filter((player) => player?.id)
      .map((player) => [player.id, `demo-${demoConfig.sourceId}-player-${player.id}`]),
  );

  const statIdMap = new Map(
    (bundle?.stats || [])
      .filter((stat) => stat?.id)
      .map((stat) => [stat.id, `demo-${demoConfig.sourceId}-stat-${stat.id}`]),
  );

  const idMap = new Map([
    ...(oldMatchId ? [[oldMatchId, demoConfig.matchId]] : []),
    ...teamIdMap,
    ...playerIdMap,
    ...statIdMap,
  ]);

  return { teamIdMap, playerIdMap, statIdMap, idMap };
}

function buildDemoTeams(bundle, maps, demoConfig) {
  const homeTeamId = bundle?.match?.home_team_id;
  const awayTeamId = bundle?.match?.away_team_id;

  return (bundle?.teams || []).map((team) => {
    const side = team?.id === homeTeamId ? 'home' : team?.id === awayTeamId ? 'away' : null;
    const id = side ? demoConfig.teamIds[side] : maps.teamIdMap.get(team.id);
    const base = stripRuntimeFields(team);
    return remapJsonFields({
      ...base,
      id,
      name: team.name || 'Team',
      is_demo: true,
      demo_source: demoConfig.sourceId,
    }, ['starters', 'subs'], maps.idMap);
  }).filter((team) => !!team.id);
}

function buildDemoPlayers(bundle, maps, demoConfig) {
  return (bundle?.players || []).map((player) => {
    const base = stripRuntimeFields(player);
    return {
      ...base,
      id: maps.playerIdMap.get(player.id),
      team_id: maps.teamIdMap.get(player.team_id) || player.team_id,
      is_demo: true,
      demo_source: demoConfig.sourceId,
    };
  }).filter((player) => !!player.id);
}

function buildDemoMatch(bundle, maps, demoPlayers = [], demoConfig) {
  const base = stripRuntimeFields(bundle?.match || {});
  const match = remapJsonFields({
    ...base,
    id: demoConfig.matchId,
    home_team_id: demoConfig.teamIds.home,
    away_team_id: demoConfig.teamIds.away,
    mode: demoConfig.mode,
    match_length_minutes: 70,
    video_config: JSON.stringify({ sourceType: 'youtube', youtubeUrl: DEMO_YOUTUBE_URL }),
    public_match_id: '',
    is_demo: true,
    demo_source: demoConfig.sourceId,
  }, [
    'home_starters',
    'home_subs',
    'home_on_field',
    'away_starters',
    'away_subs',
    'away_on_field',
  ], maps.idMap);

  return {
    ...match,
    ...buildMatchRosterSnapshotPatch({
      homePlayers: demoPlayers.filter((player) => player?.team_id === demoConfig.teamIds.home),
      awayPlayers: demoPlayers.filter((player) => player?.team_id === demoConfig.teamIds.away),
    }),
  };
}

function buildDemoStats(bundle, maps, demoConfig) {
  const sourceStats = filterDemoStatsForMode(bundle?.stats || [], demoConfig);
  return sourceStats.map((stat, index) => {
    const base = stripRuntimeFields(stat);
    const extra = safeParseJson(base.extra_data, null);
    const remappedExtra = extra ? JSON.stringify(remapDeep(extra, maps.idMap)) : base.extra_data;

    return {
      ...base,
      id: maps.statIdMap.get(stat.id) || `demo-${demoConfig.sourceId}-stat-${String(stat.id || stat.play_id || index + 1)}-${index + 1}`,
      match_id: demoConfig.matchId,
      extra_data: remappedExtra,
      is_demo: true,
      demo_source: demoConfig.sourceId,
    };
  });
}

async function upsertMany(entity, records) {
  for (const record of records) {
    await entity.create(record);
  }
}

export async function openDemoMatch(db, options = {}) {
  const demoConfig = getDemoVariantConfig(options?.mode);
  const existing = await db.entities.Match.filter({ is_demo: true, demo_source: demoConfig.sourceId });
  const existingMatch = existing?.find((match) => match?.id === demoConfig.matchId) || existing?.[0];
  const maps = buildIdMaps(demoBundle, demoConfig);
  const teams = buildDemoTeams(demoBundle, maps, demoConfig);
  const players = buildDemoPlayers(demoBundle, maps, demoConfig);
  const rosterPatch = buildMatchRosterSnapshotPatch({
    homePlayers: players.filter((player) => player?.team_id === demoConfig.teamIds.home),
    awayPlayers: players.filter((player) => player?.team_id === demoConfig.teamIds.away),
  });
  const stats = buildDemoStats(demoBundle, maps, demoConfig);
  if (existingMatch?.id) {
    const existingTeams = await db.entities.Team.filter({ is_demo: true, demo_source: demoConfig.sourceId });
    const existingPlayers = await db.entities.Player.filter({ is_demo: true, demo_source: demoConfig.sourceId });
    const existingStats = await db.entities.StatEntry.filter({ match_id: existingMatch.id });
    for (const team of teams) {
      const existingTeam = (existingTeams || []).find((row) => row?.id === team.id);
      if (existingTeam?.id) await db.entities.Team.update(existingTeam.id, team);
    }
    for (const player of players) {
      const existingPlayer = (existingPlayers || []).find((row) => row?.id === player.id);
      if (existingPlayer?.id) await db.entities.Player.update(existingPlayer.id, player);
    }
    await Promise.all((existingStats || []).map((stat) => db.entities.StatEntry.delete(stat.id)));
    await upsertMany(db.entities.StatEntry, stats);
    const updatedMatch = {
      video_config: JSON.stringify({ sourceType: 'youtube', youtubeUrl: DEMO_YOUTUBE_URL }),
      match_length_minutes: 70,
      mode: demoConfig.mode,
      public_match_id: '',
      ...rosterPatch,
    };
    await db.entities.Match.update(existingMatch.id, updatedMatch);
    return { ...existingMatch, ...updatedMatch };
  }

  const match = buildDemoMatch(demoBundle, maps, players, demoConfig);

  await upsertMany(db.entities.Team, teams);
  await upsertMany(db.entities.Player, players);
  const createdMatch = await db.entities.Match.create(match);
  await upsertMany(db.entities.StatEntry, stats);

  return createdMatch;
}

export async function deleteDemoArtifactsForMatch(db, match) {
  if (!match?.is_demo) return;
  const demoSource = String(match?.demo_source || '').trim();
  if (!demoSource) return;

  const [demoTeams, demoPlayers] = await Promise.all([
    db.entities.Team.filter({ is_demo: true, demo_source: demoSource }),
    db.entities.Player.filter({ is_demo: true, demo_source: demoSource }),
  ]);

  await Promise.all((demoPlayers || []).map((player) => db.entities.Player.delete(player.id)));
  await Promise.all((demoTeams || []).map((team) => db.entities.Team.delete(team.id)));
}
