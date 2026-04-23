import {
  fetchPrivatePlayers,
  fetchPrivateTeams,
  fetchServerMatches,
  fetchServerStatsForMatch,
  generatePublicMatchId,
  restoreExtraDataFromPrivateRefs,
} from '@/lib/serverSync';
import { deriveMatchLengthMinutes } from '@/lib/reportAnalytics';

function stringifyServerExtra(extraData) {
  if (!extraData) return '{}';
  if (typeof extraData === 'string') {
    try { return JSON.stringify(JSON.parse(extraData) || {}); } catch { return '{}'; }
  }
  if (typeof extraData === 'object') return JSON.stringify(extraData);
  return '{}';
}

function sameText(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function buildImportedMatchSheet(players = []) {
  const ordered = (Array.isArray(players) ? players : [])
    .filter((player) => player?.id)
    .slice()
    .sort((a, b) => Number(a?.number || 0) - Number(b?.number || 0));
  const starters = ordered.slice(0, 15).map((player) => player.id);
  const starterSet = new Set(starters);
  const subs = ordered.filter((player) => !starterSet.has(player.id)).map((player) => player.id);
  return { starters, subs, on_field: starters.slice() };
}

function parseIdList(value) {
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function localStatFromServer(row, localMatchId, playerByServerId = new Map()) {
  const setDefence = typeof row?.set_defence === 'boolean' ? row.set_defence : !!row?.counter_attack;
  const player = row?.player_ref ? playerByServerId.get(row.player_ref) : null;
  const recipient = row?.recipient_ref ? playerByServerId.get(row.recipient_ref) : null;
  const restoredExtra = restoreExtraDataFromPrivateRefs(row?.extra_data, playerByServerId);
  return {
    match_id: localMatchId,
    server_stat_id: row?.id || null,
    stat_type: row?.stat_type || 'unknown',
    is_pass: !!row?.is_pass,
    half: row?.half || 'first',
    timestamp: row?.timestamp || new Date().toISOString(),
    play_id: row?.play_id ?? null,
    possession_id: row?.possession_id ?? null,
    possession_team_side: row?.possession_team_side ?? null,
    team_side: row?.team_side || 'unknown',
    counter_attack: setDefence,
    set_defence: setDefence,
    defence_set_migration_version: row?.defence_set_migration_version ?? null,
    stat_model_migration_version: row?.stat_model_migration_version ?? null,
    time_s: row?.time_s ?? null,
    normalized_time_s: row?.normalized_time_s ?? null,
    x_position: row?.x_position ?? null,
    y_position: row?.y_position ?? null,
    end_x_position: row?.end_x_position ?? null,
    end_y_position: row?.end_y_position ?? null,
    raw_x_position: row?.raw_x_position ?? null,
    raw_y_position: row?.raw_y_position ?? null,
    raw_end_x_position: row?.raw_end_x_position ?? null,
    raw_end_y_position: row?.raw_end_y_position ?? null,
    player_number: player?.number ?? row?.player_number ?? null,
    recipient_number: recipient?.number ?? row?.recipient_number ?? null,
    player_name: player?.name || null,
    recipient_name: recipient?.name || null,
    server_player_id: row?.player_ref || null,
    server_recipient_id: row?.recipient_ref || null,
    extra_data: stringifyServerExtra(restoredExtra),
  };
}

async function createImportedTeam(db, side, serverMatch) {
  const publicId = serverMatch?.public_match_id || String(serverMatch?.id || '').slice(0, 8) || 'match';
  const label = side === 'home' ? 'Home' : 'Away';
  return db.entities.Team.create({
    name: `Synced ${label} (${publicId})`,
    color: side === 'home' ? '#fb4b14' : '#5b1f2f',
    starters: '[]',
    subs: '[]',
    is_synced_placeholder: true,
  });
}

async function hydratePrivateTeamsAndPlayers(db, { localTeams, localPlayers }) {
  const teamByServerId = new Map((localTeams || []).filter((t) => t?.server_team_id).map((t) => [t.server_team_id, t]));
  const playerByServerId = new Map((localPlayers || []).filter((p) => p?.server_player_id).map((p) => [p.server_player_id, p]));
  let importedTeams = 0;
  let importedPlayers = 0;

  const privateTeams = await fetchPrivateTeams({ limit: 1000 });
  if (privateTeams.ok) {
    for (const serverTeam of (privateTeams.teams || [])) {
      let local = serverTeam?.id ? teamByServerId.get(serverTeam.id) : null;
      if (!local) local = (localTeams || []).find((team) => !team?.server_team_id && sameText(team?.name, serverTeam?.name));
      const patch = {
        name: serverTeam?.name || local?.name || 'Synced Team',
        color: serverTeam?.color || local?.color || '#22c55e',
        starters: serverTeam?.starters || local?.starters || '[]',
        subs: serverTeam?.subs || local?.subs || '[]',
        server_team_id: serverTeam?.id || null,
        is_synced_placeholder: false,
      };
      if (local?.id) {
        await db.entities.Team.update(local.id, patch);
        local = { ...local, ...patch };
      } else {
        local = await db.entities.Team.create(patch);
        importedTeams += 1;
      }
      if (serverTeam?.id && local?.id) teamByServerId.set(serverTeam.id, local);
    }
  }

  const privatePlayers = await fetchPrivatePlayers({ limit: 5000 });
  if (privatePlayers.ok) {
    for (const serverPlayer of (privatePlayers.players || [])) {
      const localTeam = serverPlayer?.team_ref ? teamByServerId.get(serverPlayer.team_ref) : null;
      let local = serverPlayer?.id ? playerByServerId.get(serverPlayer.id) : null;
      if (!local && localTeam?.id) {
        local = (localPlayers || []).find((player) =>
          !player?.server_player_id && player.team_id === localTeam.id && Number(player.number) === Number(serverPlayer.number)
        );
      }
      const patch = {
        name: serverPlayer?.name || local?.name || String(serverPlayer?.number || ''),
        number: Number.isFinite(Number(serverPlayer?.number)) ? Number(serverPlayer.number) : local?.number,
        position: serverPlayer?.position || local?.position || '',
        team_id: localTeam?.id || local?.team_id || null,
        server_player_id: serverPlayer?.id || null,
        server_team_id: serverPlayer?.team_ref || null,
      };
      if (local?.id) {
        await db.entities.Player.update(local.id, patch);
        local = { ...local, ...patch };
      } else {
        local = await db.entities.Player.create(patch);
        importedPlayers += 1;
      }
      if (serverPlayer?.id && local?.id) playerByServerId.set(serverPlayer.id, local);
    }
  }

  return { teamByServerId, playerByServerId, importedTeams, importedPlayers };
}

export async function hydrateServerAccountData(db, { localMatches = [], localStats = [], localTeams = [], localPlayers = [] } = {}) {
  const identity = await hydratePrivateTeamsAndPlayers(db, { localTeams, localPlayers });
  const serverMatchesResult = await fetchServerMatches({ limit: 150 });
  if (!serverMatchesResult.ok) {
    if (serverMatchesResult.reason === 'not_authenticated') return { importedMatches: 0, importedStats: 0, skipped: true };
    throw new Error(serverMatchesResult.reason || 'Failed to fetch server matches');
  }

  const localByPublicId = new Map((localMatches || []).filter((m) => m?.public_match_id).map((m) => [m.public_match_id, m]));
  const localByServerId = new Map((localMatches || []).filter((m) => m?.server_match_id).map((m) => [m.server_match_id, m]));
  const localServerStatIds = new Set((localStats || []).map((s) => s?.server_stat_id).filter(Boolean));
  let importedMatches = 0;
  let importedStats = 0;

  for (const serverMatch of (serverMatchesResult.matches || [])) {
    const publicMatchId = serverMatch?.public_match_id || '';
    let localMatch =
      (serverMatch?.id ? localByServerId.get(serverMatch.id) : null)
      || (publicMatchId ? localByPublicId.get(publicMatchId) : null);

    if (!localMatch) {
      const homeTeam = serverMatch?.home_team_ref ? identity.teamByServerId.get(serverMatch.home_team_ref) : null;
      const awayTeam = serverMatch?.away_team_ref ? identity.teamByServerId.get(serverMatch.away_team_ref) : null;
      const fallbackHomeTeam = homeTeam || await createImportedTeam(db, 'home', serverMatch);
      const fallbackAwayTeam = awayTeam || await createImportedTeam(db, 'away', serverMatch);
      const homeSheet = buildImportedMatchSheet(
        Array.from(identity.playerByServerId.values()).filter((player) => player?.team_id === fallbackHomeTeam.id),
      );
      const awaySheet = buildImportedMatchSheet(
        Array.from(identity.playerByServerId.values()).filter((player) => player?.team_id === fallbackAwayTeam.id),
      );
      localMatch = await db.entities.Match.create({
        home_team_id: fallbackHomeTeam.id,
        away_team_id: fallbackAwayTeam.id,
        date: serverMatch?.match_date || new Date().toISOString().slice(0, 10),
        venue: '',
        competition: 'Synced from account',
        level: serverMatch?.level || 'Other',
        code: serverMatch?.code || 'GAA',
        mode: serverMatch?.mode || 'analysis',
        match_length_minutes: Number.isFinite(Number(serverMatch?.match_length_minutes)) ? Number(serverMatch.match_length_minutes) : deriveMatchLengthMinutes(serverMatch || {}),
        wind_speed: serverMatch?.wind_speed ?? '',
        wind_direction: serverMatch?.wind_direction ?? '',
        public_match_id: publicMatchId || generatePublicMatchId(),
        server_match_id: serverMatch?.id || null,
        is_synced_import: true,
        home_starters: JSON.stringify(homeSheet.starters),
        away_starters: JSON.stringify(awaySheet.starters),
        home_subs: JSON.stringify(homeSheet.subs),
        away_subs: JSON.stringify(awaySheet.subs),
        home_on_field: JSON.stringify(homeSheet.on_field),
        away_on_field: JSON.stringify(awaySheet.on_field),
      });
      importedMatches += 1;
      if (publicMatchId) localByPublicId.set(publicMatchId, localMatch);
      if (serverMatch?.id) localByServerId.set(serverMatch.id, localMatch);
    } else if (serverMatch?.id && !localMatch.server_match_id) {
      await db.entities.Match.update(localMatch.id, { server_match_id: serverMatch.id });
      localMatch = { ...localMatch, server_match_id: serverMatch.id };
      localByServerId.set(serverMatch.id, localMatch);
    }

    if (localMatch) {
      const localHomeTeam = serverMatch?.home_team_ref ? identity.teamByServerId.get(serverMatch.home_team_ref) : null;
      const localAwayTeam = serverMatch?.away_team_ref ? identity.teamByServerId.get(serverMatch.away_team_ref) : null;
      if (localHomeTeam?.id && localAwayTeam?.id) {
        const homeSheet = buildImportedMatchSheet(
          Array.from(identity.playerByServerId.values()).filter((player) => player?.team_id === localHomeTeam.id),
        );
        const awaySheet = buildImportedMatchSheet(
          Array.from(identity.playerByServerId.values()).filter((player) => player?.team_id === localAwayTeam.id),
        );
        const needsRosterBackfill =
          parseIdList(localMatch.home_starters).length === 0
          && parseIdList(localMatch.away_starters).length === 0
          && (homeSheet.starters.length > 0 || awaySheet.starters.length > 0);
        if (needsRosterBackfill) {
          const rosterPatch = {
            home_team_id: localHomeTeam.id,
            away_team_id: localAwayTeam.id,
            home_starters: JSON.stringify(homeSheet.starters),
            away_starters: JSON.stringify(awaySheet.starters),
            home_subs: JSON.stringify(homeSheet.subs),
            away_subs: JSON.stringify(awaySheet.subs),
            home_on_field: JSON.stringify(homeSheet.on_field),
            away_on_field: JSON.stringify(awaySheet.on_field),
          };
          await db.entities.Match.update(localMatch.id, rosterPatch);
          localMatch = { ...localMatch, ...rosterPatch };
        }
      }
    }

    const serverStatsResult = await fetchServerStatsForMatch({ serverMatchId: serverMatch?.id, publicMatchId, limit: 10000 });
    if (!serverStatsResult.ok) continue;

    for (const serverStat of (serverStatsResult.stats || [])) {
      if (serverStat?.id && localServerStatIds.has(serverStat.id)) continue;
      const created = await db.entities.StatEntry.create(localStatFromServer(serverStat, localMatch.id, identity.playerByServerId));
      if (serverStat?.id) localServerStatIds.add(serverStat.id);
      if (created?.id) importedStats += 1;
    }
  }

  return {
    importedMatches,
    importedStats,
    importedTeams: identity.importedTeams || 0,
    importedPlayers: identity.importedPlayers || 0,
    skipped: false,
  };
}
