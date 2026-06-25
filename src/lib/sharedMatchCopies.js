import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient';
import {
  ensureServerMatch,
  generatePublicMatchId,
  insertServerStat,
  upsertPrivateMatchupStintFromLocal,
  upsertPrivatePlayerFromLocal,
  upsertPrivateTeamFromLocal,
} from '@/lib/serverSync';
import {
  deriveMatchLengthMinutes,
  normalizeDefenceSetRows,
  normalizeStatModelRows,
  rebuildPossessionRows,
} from '@/lib/reportAnalytics';

function parseJsonMaybe(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return fallback;
}

async function requireAuthUser() {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}

async function retireOtherSnapshots({ userId, shareType, sourceMatchKey, keepId }) {
  if (!userId || !shareType || !sourceMatchKey || !keepId) return;
  await supabase
    .from('shared_match_snapshots')
    .update({ deleted_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('share_type', shareType)
    .eq('source_public_match_id', sourceMatchKey)
    .is('deleted_at', null)
    .neq('id', keepId);
}

export function generateShareCode(len = 10) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const chars = [];
  for (let i = 0; i < len; i += 1) {
    chars.push(alphabet[Math.floor(Math.random() * alphabet.length)]);
  }
  return chars.join('');
}

function cloneWithoutIdentity(record = {}, { keepIds = true } = {}) {
  const next = JSON.parse(JSON.stringify(record || {}));
  if (!keepIds) {
    delete next.id;
    delete next.server_match_id;
    delete next.server_team_id;
    delete next.server_player_id;
    delete next.server_stat_id;
  }
  return next;
}

function remapSelection(selection, playerIdMap) {
  if (!selection || typeof selection !== 'object') return selection;
  if (Array.isArray(selection)) return selection.map((item) => remapSelection(item, playerIdMap));
  if (selection.kind === 'player') {
    const nextId = selection.id ? playerIdMap.get(selection.id) || null : null;
    return {
      kind: 'player',
      ...(nextId ? { id: nextId } : {}),
      name: selection.name || '',
      number: selection.number ?? null,
      team_side: selection.team_side || null,
    };
  }
  if (selection.kind === 'team' || selection.kind === 'none') return { ...selection };
  const next = {};
  for (const [key, value] of Object.entries(selection)) next[key] = remapSelection(value, playerIdMap);
  return next;
}

function remapExtraData(extraData, playerIdMap) {
  const parsed = parseJsonMaybe(extraData, {});
  return JSON.stringify(remapSelection(parsed, playerIdMap) || {});
}

function parseIdList(value) {
  const parsed = parseJsonMaybe(value, []);
  return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
}

function remapIdList(value, playerIdMap) {
  return JSON.stringify(parseIdList(value).map((id) => playerIdMap.get(id)).filter(Boolean));
}

function pickMatchPayload(match = {}) {
  const payload = cloneWithoutIdentity(match, { keepIds: true });
  delete payload.id;
  delete payload.server_match_id;
  delete payload.created_date;
  delete payload.updated_date;
  delete payload.latest_share_code;
  delete payload.latest_shared_snapshot_id;
  delete payload.share_snapshot_id;
  return payload;
}

function getShareMatchKey(match = {}) {
  const publicMatchId = String(match?.public_match_id || '').trim();
  if (publicMatchId) return publicMatchId;
  const localId = String(match?.id || '').trim();
  return localId ? `local:${localId}` : null;
}

export function buildShareableMatchPayload({
  match,
  homeTeam,
  awayTeam,
  players = [],
  stats = [],
  matchupStints = [],
  highlightReels = [],
  highlightReelClips = [],
  publicVideoNotes = [],
} = {}) {
  const normalizedStats = rebuildPossessionRows(normalizeStatModelRows(normalizeDefenceSetRows((stats || []).filter((row) => row?.stat_type !== 'defensive_contact'))));
  return {
    schema_version: 1,
    exported_at: new Date().toISOString(),
    source: 'gaeliq-share-copy',
    match: pickMatchPayload(match),
    teams: [homeTeam, awayTeam].filter(Boolean).map((team) => cloneWithoutIdentity(team, { keepIds: true })),
    players: (players || []).filter(Boolean).map((player) => cloneWithoutIdentity(player, { keepIds: true })),
    stats: normalizedStats.map((stat) => cloneWithoutIdentity(stat, { keepIds: true })),
    matchup_stints: (matchupStints || []).filter(Boolean).map((stint) => cloneWithoutIdentity(stint, { keepIds: true })),
    highlight_reels: (highlightReels || []).filter(Boolean).map((reel) => cloneWithoutIdentity(reel, { keepIds: true })),
    highlight_reel_clips: (highlightReelClips || []).filter(Boolean).map((clip) => cloneWithoutIdentity(clip, { keepIds: true })),
    video_notes: (publicVideoNotes || []).filter(Boolean).map((note) => cloneWithoutIdentity(note, { keepIds: true })),
  };
}

export async function createSharedMatchSnapshot({
  match,
  homeTeam,
  awayTeam,
  players = [],
  stats = [],
  matchupStints = [],
  highlightReels = [],
  highlightReelClips = [],
  publicVideoNotes = [],
  sourceSnapshotId = null,
  sharedFromCode = null,
  shareType = 'game_copy',
} = {}) {
  const user = await requireAuthUser();
  if (!user) return { ok: false, reason: 'not_authenticated' };
  if (!match?.id) return { ok: false, reason: 'missing_match' };
  const sourceMatchKey = getShareMatchKey(match);
  if (!sourceMatchKey) return { ok: false, reason: 'missing_match_key' };

  const payload = buildShareableMatchPayload({
    match,
    homeTeam,
    awayTeam,
    players,
    stats,
    matchupStints,
    highlightReels,
    highlightReelClips,
    publicVideoNotes,
  });
  const { data: existing, error: existingError } = await supabase
    .from('shared_match_snapshots')
    .select('id,share_code')
    .eq('user_id', user.id)
    .eq('share_type', shareType)
    .eq('source_public_match_id', sourceMatchKey)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) return { ok: false, reason: existingError.message };

  if (existing?.id) {
    const { data, error } = await supabase
      .from('shared_match_snapshots')
      .update({
        payload,
        source_snapshot_id: sourceSnapshotId || existing.id,
        shared_from_code: sharedFromCode || null,
      })
      .eq('id', existing.id)
      .select('id,share_code')
      .maybeSingle();
    if (error) return { ok: false, reason: error.message };
    await retireOtherSnapshots({
      userId: user.id,
      shareType,
      sourceMatchKey,
      keepId: data?.id || existing.id,
    });
    return {
      ok: true,
      snapshotId: data?.id || existing.id,
      shareCode: data?.share_code || existing.share_code,
      payload,
      reused: true,
    };
  }

  const shareCode = generateShareCode();
  const insertPayload = {
    user_id: user.id,
    share_type: shareType,
    share_code: shareCode,
    source_public_match_id: sourceMatchKey,
    source_snapshot_id: sourceSnapshotId || null,
    shared_from_code: sharedFromCode || null,
    payload,
  };

  const { data, error } = await supabase
    .from('shared_match_snapshots')
    .insert(insertPayload)
    .select('id,share_code')
    .maybeSingle();

  if (error) return { ok: false, reason: error.message };
  await retireOtherSnapshots({
    userId: user.id,
    shareType,
    sourceMatchKey,
    keepId: data?.id || null,
  });
  return { ok: true, snapshotId: data?.id || null, shareCode: data?.share_code || shareCode, payload, reused: false };
}

export async function fetchSharedMatchSnapshotByCode(shareCode, { requireAuth = true, allowedTypes = [] } = {}) {
  const user = await requireAuthUser();
  if (requireAuth && !user) return { ok: false, reason: 'not_authenticated' };
  if (!String(shareCode || '').trim()) return { ok: false, reason: 'missing_share_code' };

  let query = supabase
    .from('shared_match_snapshots')
    .select('*')
    .eq('share_code', String(shareCode).trim().toUpperCase())
    .is('deleted_at', null);
  if (Array.isArray(allowedTypes) && allowedTypes.length) query = query.in('share_type', allowedTypes);
  const { data, error } = await query.maybeSingle();

  if (error) return { ok: false, reason: error.message };
  if (!data?.id) return { ok: false, reason: 'not_found' };
  return { ok: true, snapshot: data };
}

export async function importSharedMatchSnapshot({ db, snapshotRow }) {
  const user = await requireAuthUser();
  if (!user) return { ok: false, reason: 'not_authenticated' };
  if (!db?.entities || !snapshotRow?.payload) return { ok: false, reason: 'invalid_snapshot' };
  if (snapshotRow?.share_type !== 'game_copy') return { ok: false, reason: 'invalid_share_type' };

  const payload = parseJsonMaybe(snapshotRow.payload, snapshotRow.payload);
  const sourceMatch = payload?.match || {};
  const sourceTeams = Array.isArray(payload?.teams) ? payload.teams : [];
  const sourcePlayers = Array.isArray(payload?.players) ? payload.players : [];
  const sourceStats = Array.isArray(payload?.stats) ? payload.stats : [];
  const sourceMatchupStints = Array.isArray(payload?.matchup_stints) ? payload.matchup_stints : [];
  const sourceHighlightReels = Array.isArray(payload?.highlight_reels) ? payload.highlight_reels : [];
  const sourceHighlightReelClips = Array.isArray(payload?.highlight_reel_clips) ? payload.highlight_reel_clips : [];
  const sourceVideoNotes = Array.isArray(payload?.video_notes) ? payload.video_notes : [];

  const oldHomeTeamId = sourceMatch?.home_team_id || sourceTeams[0]?.id || null;
  const oldAwayTeamId = sourceMatch?.away_team_id || sourceTeams[1]?.id || null;
  const sourceHomeTeam = sourceTeams.find((team) => team?.id === oldHomeTeamId) || sourceTeams[0] || null;
  const sourceAwayTeam = sourceTeams.find((team) => team?.id === oldAwayTeamId) || sourceTeams[1] || null;

  const createdHomeTeam = sourceHomeTeam
    ? await db.entities.Team.create({
        name: sourceHomeTeam.name || 'Shared Home',
        color: sourceHomeTeam.color || '#fb4b14',
        starters: '[]',
        subs: '[]',
        is_synced_placeholder: false,
      })
    : null;
  const createdAwayTeam = sourceAwayTeam
    ? await db.entities.Team.create({
        name: sourceAwayTeam.name || 'Shared Away',
        color: sourceAwayTeam.color || '#5b1f2f',
        starters: '[]',
        subs: '[]',
        is_synced_placeholder: false,
      })
    : null;

  const teamIdMap = new Map();
  if (sourceHomeTeam?.id && createdHomeTeam?.id) teamIdMap.set(sourceHomeTeam.id, createdHomeTeam.id);
  if (sourceAwayTeam?.id && createdAwayTeam?.id) teamIdMap.set(sourceAwayTeam.id, createdAwayTeam.id);

  const playerIdMap = new Map();
  const createdPlayers = [];
  for (const player of sourcePlayers) {
    const newTeamId = teamIdMap.get(player?.team_id) || null;
    const created = await db.entities.Player.create({
      name: player?.name || String(player?.number || ''),
      number: Number.isFinite(Number(player?.number)) ? Number(player.number) : null,
      position: player?.position || '',
      team_id: newTeamId,
    });
    if (player?.id && created?.id) playerIdMap.set(player.id, created.id);
    createdPlayers.push(created);
  }

  if (sourceHomeTeam?.id && createdHomeTeam?.id) {
    await db.entities.Team.update(createdHomeTeam.id, {
      starters: remapIdList(sourceHomeTeam.starters, playerIdMap),
      subs: remapIdList(sourceHomeTeam.subs, playerIdMap),
    });
  }
  if (sourceAwayTeam?.id && createdAwayTeam?.id) {
    await db.entities.Team.update(createdAwayTeam.id, {
      starters: remapIdList(sourceAwayTeam.starters, playerIdMap),
      subs: remapIdList(sourceAwayTeam.subs, playerIdMap),
    });
  }

  const importedPublicMatchId = generatePublicMatchId();
  const createdMatch = await db.entities.Match.create({
    ...sourceMatch,
    id: undefined,
    public_match_id: importedPublicMatchId,
    server_match_id: null,
    home_team_id: createdHomeTeam?.id || null,
    away_team_id: createdAwayTeam?.id || null,
    match_length_minutes: Number.isFinite(Number(sourceMatch?.match_length_minutes))
      ? Number(sourceMatch.match_length_minutes)
      : deriveMatchLengthMinutes(sourceMatch),
    is_shared_copy: true,
    shared_from_code: snapshotRow?.share_code || null,
    imported_from_snapshot_id: snapshotRow?.id || null,
    home_starters: remapIdList(sourceMatch.home_starters, playerIdMap),
    away_starters: remapIdList(sourceMatch.away_starters, playerIdMap),
    home_subs: remapIdList(sourceMatch.home_subs, playerIdMap),
    away_subs: remapIdList(sourceMatch.away_subs, playerIdMap),
    home_on_field: remapIdList(sourceMatch.home_on_field, playerIdMap),
    away_on_field: remapIdList(sourceMatch.away_on_field, playerIdMap),
  });

  const importedStats = [];
  const statIdMap = new Map();
  for (const stat of sourceStats) {
    const created = await db.entities.StatEntry.create({
      ...stat,
      id: undefined,
      match_id: createdMatch.id,
      server_stat_id: null,
      server_player_id: null,
      server_recipient_id: null,
      player_name: stat?.player_name || '',
      recipient_name: stat?.recipient_name || '',
      extra_data: remapExtraData(stat?.extra_data, playerIdMap),
    });
    if (stat?.id && created?.id) statIdMap.set(stat.id, created.id);
    importedStats.push(created);
  }

  const createdMatchupStints = [];
  for (const stint of sourceMatchupStints) {
    const created = await db.entities.MatchupStint.create({
      ...stint,
      id: undefined,
      match_id: createdMatch.id,
      server_match_id: null,
      server_matchup_stint_id: null,
      defender_player_id: playerIdMap.get(stint?.defender_player_id) || null,
      attacker_player_id: playerIdMap.get(stint?.attacker_player_id) || null,
    });
    if (created?.id) createdMatchupStints.push(created);
  }

  const reelIdMap = new Map();
  for (const reel of sourceHighlightReels) {
    const createdReel = await db.entities.HighlightReel.create({
      ...reel,
      id: undefined,
      match_id: createdMatch.id,
    });
    if (reel?.id && createdReel?.id) reelIdMap.set(reel.id, createdReel.id);
  }

  for (const clip of sourceHighlightReelClips) {
    await db.entities.HighlightReelClip.create({
      ...clip,
      id: undefined,
      match_id: createdMatch.id,
      reel_id: reelIdMap.get(clip?.reel_id) || clip?.reel_id || null,
      source_ref: clip?.source_type === 'play'
        ? (statIdMap.get(clip?.source_ref) || clip?.source_ref || null)
        : (clip?.source_ref || null),
    });
  }

  for (const note of sourceVideoNotes) {
    await db.entities.VideoNote.create({
      ...note,
      id: undefined,
      match_id: createdMatch.id,
      target_id: note?.target_type === 'play'
        ? (statIdMap.get(note?.target_id) || note?.target_id || null)
        : (note?.target_id || null),
    });
  }

  const syncedHomeTeam = createdHomeTeam?.id ? await upsertPrivateTeamFromLocal(await db.entities.Team.get(createdHomeTeam.id)) : null;
  const syncedAwayTeam = createdAwayTeam?.id ? await upsertPrivateTeamFromLocal(await db.entities.Team.get(createdAwayTeam.id)) : null;
  if (createdHomeTeam?.id && syncedHomeTeam?.ok && syncedHomeTeam?.id) await db.entities.Team.update(createdHomeTeam.id, { server_team_id: syncedHomeTeam.id });
  if (createdAwayTeam?.id && syncedAwayTeam?.ok && syncedAwayTeam?.id) await db.entities.Team.update(createdAwayTeam.id, { server_team_id: syncedAwayTeam.id });

  const localHomeTeam = createdHomeTeam?.id ? await db.entities.Team.get(createdHomeTeam.id) : null;
  const localAwayTeam = createdAwayTeam?.id ? await db.entities.Team.get(createdAwayTeam.id) : null;
  const playerRefByLocalId = {};
  for (const player of createdPlayers) {
    const local = await db.entities.Player.get(player.id);
    const teamServerId = local?.team_id === createdHomeTeam?.id ? (syncedHomeTeam?.id || null) : (syncedAwayTeam?.id || null);
    const synced = await upsertPrivatePlayerFromLocal(local, { teamServerId });
    if (synced?.ok && synced?.id) {
      await db.entities.Player.update(local.id, { server_player_id: synced.id, server_team_id: teamServerId });
      playerRefByLocalId[local.id] = synced.id;
    }
  }

  const matchServer = await ensureServerMatch({
    publicMatchId: createdMatch.public_match_id,
    matchDate: createdMatch.date,
    code: createdMatch.code || 'GAA',
    level: createdMatch.level || 'Other',
    windSpeed: createdMatch.wind_speed === '' ? null : createdMatch.wind_speed,
    windDirection: createdMatch.wind_direction === '' ? null : createdMatch.wind_direction,
    mode: createdMatch.mode || 'analysis',
    matchLengthMinutes: createdMatch.match_length_minutes,
    homeTeamRef: syncedHomeTeam?.id || localHomeTeam?.server_team_id || null,
    awayTeamRef: syncedAwayTeam?.id || localAwayTeam?.server_team_id || null,
  });
  if (matchServer?.ok && matchServer?.id) {
    await db.entities.Match.update(createdMatch.id, { server_match_id: matchServer.id });
    for (const stat of importedStats) {
      const statRes = await insertServerStat({
        matchId: matchServer.id,
        publicMatchId: createdMatch.public_match_id,
        stat,
        teamSide: stat.team_side,
        playerRefByLocalId,
      });
      if (statRes?.ok && statRes?.id) {
        await db.entities.StatEntry.update(stat.id, { server_stat_id: statRes.id });
      }
    }
    for (const matchupStint of createdMatchupStints) {
      const synced = await upsertPrivateMatchupStintFromLocal(matchupStint, {
        serverMatchId: matchServer.id,
        playerRefByLocalId,
      });
      if (synced?.ok && synced?.id) {
        await db.entities.MatchupStint.update(matchupStint.id, {
          server_match_id: matchServer.id,
          server_matchup_stint_id: synced.id,
        });
      }
    }
  }

  const sharedAgain = await createSharedMatchSnapshot({
    match: { ...createdMatch, server_match_id: matchServer?.ok ? matchServer.id : null },
    homeTeam: createdHomeTeam?.id ? await db.entities.Team.get(createdHomeTeam.id) : null,
    awayTeam: createdAwayTeam?.id ? await db.entities.Team.get(createdAwayTeam.id) : null,
    players: await db.entities.Player.filter({ team_id: createdHomeTeam?.id }).then(async (home) => {
      const away = createdAwayTeam?.id ? await db.entities.Player.filter({ team_id: createdAwayTeam.id }) : [];
      return [...home, ...away];
    }),
    stats: await db.entities.StatEntry.filter({ match_id: createdMatch.id }),
    matchupStints: await db.entities.MatchupStint.filter({ match_id: createdMatch.id }),
    highlightReels: await db.entities.HighlightReel.filter({ match_id: createdMatch.id }),
    highlightReelClips: await db.entities.HighlightReelClip.filter({ match_id: createdMatch.id }),
    publicVideoNotes: await db.entities.VideoNote.filter({ match_id: createdMatch.id, visibility: 'public' }),
    sourceSnapshotId: snapshotRow?.id || null,
    sharedFromCode: snapshotRow?.share_code || null,
    shareType: 'game_copy',
  });

  if (sharedAgain?.ok) {
    await db.entities.Match.update(createdMatch.id, {
      latest_share_code: sharedAgain.shareCode,
      latest_shared_snapshot_id: sharedAgain.snapshotId,
    });
  }

  return {
    ok: true,
    matchId: createdMatch.id,
    publicMatchId: createdMatch.public_match_id,
    shareCode: sharedAgain?.shareCode || null,
  };
}
