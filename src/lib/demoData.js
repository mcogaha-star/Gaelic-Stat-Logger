import demoBundle from '@/data/demoMatch.json';

export const DEMO_SOURCE_ID = 'armagh-galway-2026-01-31';
export const DEMO_MATCH_ID = `demo-${DEMO_SOURCE_ID}-match`;
export const DEMO_YOUTUBE_URL = 'https://www.youtube.com/watch?v=-1JJ2TQIaW4';

const DEMO_TEAM_IDS = {
  home: `demo-${DEMO_SOURCE_ID}-team-home`,
  away: `demo-${DEMO_SOURCE_ID}-team-away`,
};

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

function buildIdMaps(bundle) {
  const oldMatchId = bundle?.match?.id;
  const homeTeamId = bundle?.match?.home_team_id;
  const awayTeamId = bundle?.match?.away_team_id;

  const teamIdMap = new Map([
    [homeTeamId, DEMO_TEAM_IDS.home],
    [awayTeamId, DEMO_TEAM_IDS.away],
  ].filter(([oldId]) => !!oldId));

  const playerIdMap = new Map(
    (bundle?.players || [])
      .filter((player) => player?.id)
      .map((player) => [player.id, `demo-${DEMO_SOURCE_ID}-player-${player.id}`]),
  );

  const statIdMap = new Map(
    (bundle?.stats || [])
      .filter((stat) => stat?.id)
      .map((stat) => [stat.id, `demo-${DEMO_SOURCE_ID}-stat-${stat.id}`]),
  );

  const idMap = new Map([
    ...(oldMatchId ? [[oldMatchId, DEMO_MATCH_ID]] : []),
    ...teamIdMap,
    ...playerIdMap,
    ...statIdMap,
  ]);

  return { teamIdMap, playerIdMap, statIdMap, idMap };
}

function buildDemoTeams(bundle, maps) {
  const homeTeamId = bundle?.match?.home_team_id;
  const awayTeamId = bundle?.match?.away_team_id;

  return (bundle?.teams || []).map((team) => {
    const side = team?.id === homeTeamId ? 'home' : team?.id === awayTeamId ? 'away' : null;
    const id = side ? DEMO_TEAM_IDS[side] : maps.teamIdMap.get(team.id);
    const base = stripRuntimeFields(team);
    return remapJsonFields({
      ...base,
      id,
      name: team.name || 'Team',
      is_demo: true,
      demo_source: DEMO_SOURCE_ID,
    }, ['starters', 'subs'], maps.idMap);
  }).filter((team) => !!team.id);
}

function buildDemoPlayers(bundle, maps) {
  return (bundle?.players || []).map((player) => {
    const base = stripRuntimeFields(player);
    return {
      ...base,
      id: maps.playerIdMap.get(player.id),
      team_id: maps.teamIdMap.get(player.team_id) || player.team_id,
      is_demo: true,
      demo_source: DEMO_SOURCE_ID,
    };
  }).filter((player) => !!player.id);
}

function buildDemoMatch(bundle, maps) {
  const base = stripRuntimeFields(bundle?.match || {});
  const match = remapJsonFields({
    ...base,
    id: DEMO_MATCH_ID,
    home_team_id: DEMO_TEAM_IDS.home,
    away_team_id: DEMO_TEAM_IDS.away,
    mode: 'analysis',
    match_length_minutes: 70,
    video_config: JSON.stringify({ sourceType: 'youtube', youtubeUrl: DEMO_YOUTUBE_URL }),
    public_match_id: '',
    is_demo: true,
    demo_source: DEMO_SOURCE_ID,
  }, [
    'home_starters',
    'home_subs',
    'home_on_field',
    'away_starters',
    'away_subs',
    'away_on_field',
  ], maps.idMap);

  return match;
}

function buildDemoStats(bundle, maps) {
  return (bundle?.stats || []).map((stat, index) => {
    const base = stripRuntimeFields(stat);
    const extra = safeParseJson(base.extra_data, null);
    const remappedExtra = extra ? JSON.stringify(remapDeep(extra, maps.idMap)) : base.extra_data;

    return {
      ...base,
      id: maps.statIdMap.get(stat.id) || `demo-${DEMO_SOURCE_ID}-stat-${stat.play_id || index + 1}`,
      match_id: DEMO_MATCH_ID,
      extra_data: remappedExtra,
      is_demo: true,
      demo_source: DEMO_SOURCE_ID,
    };
  });
}

async function upsertMany(entity, records) {
  for (const record of records) {
    await entity.create(record);
  }
}

export async function openDemoMatch(db) {
  const existing = await db.entities.Match.filter({ is_demo: true, demo_source: DEMO_SOURCE_ID });
  const existingMatch = existing?.find((match) => match?.id === DEMO_MATCH_ID) || existing?.[0];
  const maps = buildIdMaps(demoBundle);
  const teams = buildDemoTeams(demoBundle, maps);
  const players = buildDemoPlayers(demoBundle, maps);
  if (existingMatch?.id) {
    const existingTeams = await db.entities.Team.filter({ is_demo: true, demo_source: DEMO_SOURCE_ID });
    for (const team of teams) {
      const existingTeam = (existingTeams || []).find((row) => row?.id === team.id);
      if (existingTeam?.id) await db.entities.Team.update(existingTeam.id, team);
    }
    await db.entities.Match.update(existingMatch.id, {
      video_config: JSON.stringify({ sourceType: 'youtube', youtubeUrl: DEMO_YOUTUBE_URL }),
      match_length_minutes: 70,
      mode: 'analysis',
      public_match_id: '',
    });
    return { ...existingMatch, video_config: JSON.stringify({ sourceType: 'youtube', youtubeUrl: DEMO_YOUTUBE_URL }) };
  }

  const match = buildDemoMatch(demoBundle, maps);
  const stats = buildDemoStats(demoBundle, maps);

  await upsertMany(db.entities.Team, teams);
  await upsertMany(db.entities.Player, players);
  const createdMatch = await db.entities.Match.create(match);
  await upsertMany(db.entities.StatEntry, stats);

  return createdMatch;
}

export async function deleteDemoArtifactsForMatch(db, match) {
  if (!match?.is_demo || match?.demo_source !== DEMO_SOURCE_ID) return;

  const [demoTeams, demoPlayers] = await Promise.all([
    db.entities.Team.filter({ is_demo: true, demo_source: DEMO_SOURCE_ID }),
    db.entities.Player.filter({ is_demo: true, demo_source: DEMO_SOURCE_ID }),
  ]);

  await Promise.all((demoPlayers || []).map((player) => db.entities.Player.delete(player.id)));
  await Promise.all((demoTeams || []).map((team) => db.entities.Team.delete(team.id)));
}
