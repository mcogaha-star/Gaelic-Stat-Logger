function safeParseSnapshot(value) {
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function buildMatchRosterSnapshot(players = []) {
  const rows = (Array.isArray(players) ? players : [])
    .filter((player) => player?.id)
    .slice()
    .sort((a, b) => Number(a?.number || 0) - Number(b?.number || 0))
    .map((player) => ({
      id: player.id,
      team_id: player.team_id || null,
      name: player.name || '',
      number: Number.isFinite(Number(player.number)) ? Number(player.number) : null,
      position: player.position || '',
    }));

  return JSON.stringify(rows);
}

export function remapMatchRosterSnapshot(snapshotValue, playerIdMap = new Map(), fallbackPlayers = []) {
  const parsed = safeParseSnapshot(snapshotValue);
  if (parsed.length > 0) {
    return JSON.stringify(parsed.map((entry) => ({
      ...entry,
      id: playerIdMap.get(entry?.id) || entry?.id || null,
      team_id: playerIdMap.get(entry?.team_id) || entry?.team_id || null,
    })));
  }
  return buildMatchRosterSnapshot(fallbackPlayers);
}

export function resolveMatchRosterPlayers(snapshotValue, livePlayers = [], fallbackTeamId = null) {
  const snapshot = safeParseSnapshot(snapshotValue);
  if (!snapshot.length) return Array.isArray(livePlayers) ? livePlayers : [];

  const liveById = new Map((Array.isArray(livePlayers) ? livePlayers : []).filter((player) => player?.id).map((player) => [player.id, player]));

  const resolved = snapshot
    .filter((entry) => entry?.id)
    .map((entry) => {
      const live = liveById.get(entry.id) || {};
      return {
        ...live,
        id: entry.id,
        team_id: entry.team_id || live.team_id || fallbackTeamId || null,
        name: entry.name || live.name || '',
        number: entry.number ?? live.number ?? null,
        position: entry.position || live.position || '',
      };
    });

  return resolved;
}

export function buildMatchRosterSnapshotPatch({ homeTeam = null, awayTeam = null, homePlayers = [], awayPlayers = [] }) {
  return {
    home_team_name: homeTeam?.name || null,
    away_team_name: awayTeam?.name || null,
    home_roster_snapshot: buildMatchRosterSnapshot(homePlayers),
    away_roster_snapshot: buildMatchRosterSnapshot(awayPlayers),
  };
}

export function matchHasRosterSnapshots(match) {
  return safeParseSnapshot(match?.home_roster_snapshot).length > 0 || safeParseSnapshot(match?.away_roster_snapshot).length > 0;
}
