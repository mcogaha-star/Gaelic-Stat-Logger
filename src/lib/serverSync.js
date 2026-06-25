import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient';

export function generatePublicMatchId(len = 9) {
  // Numeric string (no leading zeros) to avoid looking like a UUID.
  const digits = [];
  const first = Math.floor(Math.random() * 9) + 1;
  digits.push(String(first));
  for (let i = 1; i < len; i++) digits.push(String(Math.floor(Math.random() * 10)));
  return digits.join('');
}

async function requireAuthUser() {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}

function isMissingOptionalSchema(error, pattern) {
  const msg = String(error?.message || '');
  return !!msg && pattern.test(msg);
}

function parseJsonMaybe(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return null;
}

function normaliseTeamSide(side) {
  return side === 'home' || side === 'away' ? side : null;
}

function playerRefFromSelection(selection, playerRefByLocalId = {}) {
  if (!selection || typeof selection !== 'object') return null;
  return selection.player_ref || selection.server_player_id || playerRefByLocalId[selection.id] || null;
}

function selectionNumber(selection) {
  if (!selection || typeof selection !== 'object') return null;
  const n = Number(selection.number);
  return Number.isFinite(n) ? n : null;
}

function sanitizeSelectionForServer(selection, playerRefByLocalId = {}) {
  if (!selection || typeof selection !== 'object') return selection;
  if (selection.kind === 'none') return { kind: 'none' };
  if (selection.kind === 'team') {
    return {
      kind: 'team',
      team_side: normaliseTeamSide(selection.team_side) || selection.team_side || null,
    };
  }
  if (selection.kind === 'player' || selection.id || selection.name || selection.number != null) {
    const ref = playerRefFromSelection(selection, playerRefByLocalId);
    return {
      kind: 'player',
      ...(ref ? { player_ref: ref } : {}),
      number: selectionNumber(selection),
      team_side: normaliseTeamSide(selection.team_side) || selection.team_side || null,
    };
  }
  return selection;
}

export function sanitizeExtraDataForServer(extraData, playerRefByLocalId = {}) {
  const parsed = parseJsonMaybe(extraData);
  if (!parsed || typeof parsed !== 'object') return null;

  const visit = (value) => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    if (value.kind === 'player' || value.kind === 'team' || value.kind === 'none') {
      return sanitizeSelectionForServer(value, playerRefByLocalId);
    }
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      // Do not duplicate identifying names or local-only ids inside server stat JSON.
      if (key === 'name' || key === 'player_name' || key === 'recipient_name') continue;
      if (key === 'id' && (value.kind === 'player' || value.kind === 'team')) continue;
      out[key] = visit(child);
    }
    return out;
  };

  return visit(parsed);
}

export function restoreExtraDataFromPrivateRefs(extraData, playerByServerId = new Map()) {
  const parsed = parseJsonMaybe(extraData);
  if (!parsed || typeof parsed !== 'object') return parsed || {};

  const visit = (value) => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    if (value.kind === 'player') {
      const ref = value.player_ref || value.server_player_id || null;
      const local = ref ? playerByServerId.get(ref) : null;
      if (local) {
        return {
          kind: 'player',
          id: local.id,
          name: local.name || '',
          number: local.number ?? value.number ?? null,
          team_side: local.team_side || value.team_side || null,
          server_player_id: ref,
        };
      }
      return {
        kind: 'player',
        number: value.number ?? null,
        team_side: value.team_side || null,
        ...(ref ? { server_player_id: ref } : {}),
      };
    }
    if (value.kind === 'team' || value.kind === 'none') return value;
    const out = {};
    for (const [key, child] of Object.entries(value)) out[key] = visit(child);
    return out;
  };

  return visit(parsed);
}

function findPrimaryRefs(stat, playerRefByLocalId = {}) {
  const extra = parseJsonMaybe(stat?.extra_data) || {};
  const byType = String(stat?.stat_type || '').toLowerCase();
  const primary =
    byType === 'pass' ? extra?.pass?.passer
    : byType === 'carry' ? extra?.carry?.carrier
    : byType === 'shot' ? extra?.shot?.player
    : byType === 'kickout' ? extra?.kickout?.won_by
    : byType === 'throw_in' ? extra?.throw_in?.won_by
    : byType === 'turnover' ? (extra?.turnover?.recovered_by || extra?.turnover?.forced_by || extra?.turnover?.lost_by)
    : byType === 'foul' ? (extra?.foul?.foul_on || extra?.foul?.foul_by)
    : null;
  const recipient =
    byType === 'pass' ? (extra?.pass?.intended_recipient || extra?.pass?.won_by)
    : byType === 'kickout' ? (extra?.kickout?.won_by || extra?.kickout?.intended_recipient)
    : byType === 'throw_in' ? extra?.throw_in?.won_by
    : null;
  return {
    playerRef: playerRefFromSelection(primary, playerRefByLocalId),
    recipientRef: playerRefFromSelection(recipient, playerRefByLocalId),
  };
}

export async function fetchPrivateTeams({ limit = 1000 } = {}) {
  const user = await requireAuthUser();
  if (!user) return { ok: false, reason: 'not_authenticated', teams: [] };
  const { data, error } = await supabase
    .from('private_teams')
    .select('*')
    .eq('user_id', user.id)
    .limit(limit);
  if (error) return { ok: false, reason: error.message, teams: [] };
  return { ok: true, teams: (data || []).filter((row) => !row?.deleted_at) };
}

export async function fetchPrivatePlayers({ limit = 3000 } = {}) {
  const user = await requireAuthUser();
  if (!user) return { ok: false, reason: 'not_authenticated', players: [] };
  const { data, error } = await supabase
    .from('private_players')
    .select('*')
    .eq('user_id', user.id)
    .limit(limit);
  if (error) return { ok: false, reason: error.message, players: [] };
  return { ok: true, players: (data || []).filter((row) => !row?.deleted_at) };
}

export async function fetchPrivateMatchupStints({ serverMatchId = null, limit = 10000 } = {}) {
  const user = await requireAuthUser();
  if (!user) return { ok: false, reason: 'not_authenticated', matchupStints: [] };
  let query = supabase
    .from('private_matchup_stints')
    .select('*')
    .eq('user_id', user.id)
    .limit(limit);
  if (serverMatchId) query = query.eq('match_id', serverMatchId);
  const { data, error } = await query;
  if (error) return { ok: false, reason: error.message, matchupStints: [] };
  const matchupStints = (data || []).filter((row) => !row?.deleted_at);
  matchupStints.sort((a, b) => {
    const periodOrder = { first: 0, second: 1, et_first: 2, et_second: 3 };
    const periodDiff = (periodOrder[a?.period_key] ?? 99) - (periodOrder[b?.period_key] ?? 99);
    if (periodDiff !== 0) return periodDiff;
    const startDiff = Number(a?.start_time_s || 0) - Number(b?.start_time_s || 0);
    if (startDiff !== 0) return startDiff;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
  return { ok: true, matchupStints };
}

export async function upsertPrivateTeamFromLocal(team) {
  const user = await requireAuthUser();
  if (!user || !team) return { ok: false, reason: user ? 'missing_team' : 'not_authenticated' };
  const payload = {
    user_id: user.id,
    local_team_id: team.id || null,
    name: team.name || '',
    color: team.color || '#22c55e',
    starters: team.starters || '[]',
    subs: team.subs || '[]',
    deleted_at: null,
  };

  const selectCols = 'id,local_team_id,name,color,starters,subs';
  if (team.server_team_id) {
    const { data, error } = await supabase
      .from('private_teams')
      .update(payload)
      .eq('id', team.server_team_id)
      .eq('user_id', user.id)
      .select(selectCols)
      .maybeSingle();
    if (!error && data?.id) return { ok: true, id: data.id, team: data };
    if (error && !isMissingOptionalSchema(error, /private_teams|local_team_id|starters|subs/i)) {
      return { ok: false, reason: error.message };
    }
  }

  if (team.id) {
    const { data: existing } = await supabase
      .from('private_teams')
      .select(selectCols)
      .eq('user_id', user.id)
      .eq('local_team_id', team.id)
      .maybeSingle();
    if (existing?.id) {
      const { data, error } = await supabase
        .from('private_teams')
        .update(payload)
        .eq('id', existing.id)
        .eq('user_id', user.id)
        .select(selectCols)
        .maybeSingle();
      if (!error && data?.id) return { ok: true, id: data.id, team: data };
    }
  }

  const { data, error } = await supabase
    .from('private_teams')
    .insert(payload)
    .select(selectCols)
    .maybeSingle();
  if (error) return { ok: false, reason: error.message };
  return { ok: true, id: data?.id, team: data };
}

export async function upsertPrivatePlayerFromLocal(player, { teamServerId = null } = {}) {
  const user = await requireAuthUser();
  if (!user || !player) return { ok: false, reason: user ? 'missing_player' : 'not_authenticated' };
  const payload = {
    user_id: user.id,
    local_player_id: player.id || null,
    team_ref: teamServerId || player.server_team_id || null,
    local_team_id: player.team_id || null,
    name: player.name || '',
    number: Number.isFinite(Number(player.number)) ? Number(player.number) : null,
    position: player.position || null,
    deleted_at: null,
  };

  const selectCols = 'id,local_player_id,team_ref,local_team_id,name,number,position';
  if (player.server_player_id) {
    const { data, error } = await supabase
      .from('private_players')
      .update(payload)
      .eq('id', player.server_player_id)
      .eq('user_id', user.id)
      .select(selectCols)
      .maybeSingle();
    if (!error && data?.id) return { ok: true, id: data.id, player: data };
    if (error && !isMissingOptionalSchema(error, /private_players|team_ref|local_player_id|local_team_id/i)) {
      return { ok: false, reason: error.message };
    }
  }

  if (player.id) {
    const { data: existing } = await supabase
      .from('private_players')
      .select(selectCols)
      .eq('user_id', user.id)
      .eq('local_player_id', player.id)
      .maybeSingle();
    if (existing?.id) {
      const { data, error } = await supabase
        .from('private_players')
        .update(payload)
        .eq('id', existing.id)
        .eq('user_id', user.id)
        .select(selectCols)
        .maybeSingle();
      if (!error && data?.id) return { ok: true, id: data.id, player: data };
    }
  }

  let query = supabase
    .from('private_players')
    .select(selectCols)
    .eq('user_id', user.id)
    .eq('number', payload.number);
  if (teamServerId) query = query.eq('team_ref', teamServerId);
  const { data: fallbackExisting } = await query.maybeSingle();
  if (fallbackExisting?.id) {
    const { data, error } = await supabase
      .from('private_players')
      .update(payload)
      .eq('id', fallbackExisting.id)
      .eq('user_id', user.id)
      .select(selectCols)
      .maybeSingle();
    if (!error && data?.id) return { ok: true, id: data.id, player: data };
  }

  const { data, error } = await supabase
    .from('private_players')
    .insert(payload)
    .select(selectCols)
    .maybeSingle();
  if (error) return { ok: false, reason: error.message };
  return { ok: true, id: data?.id, player: data };
}

export async function upsertPrivateMatchupStintFromLocal(
  matchupStint,
  { serverMatchId = null, playerRefByLocalId = {} } = {},
) {
  const user = await requireAuthUser();
  if (!user || !matchupStint) return { ok: false, reason: user ? 'missing_matchup_stint' : 'not_authenticated' };
  const payload = {
    user_id: user.id,
    match_id: serverMatchId || matchupStint.server_match_id || null,
    local_matchup_stint_id: matchupStint.id || null,
    defender_player_ref: playerRefByLocalId[matchupStint.defender_player_id] || null,
    defender_team_side: matchupStint.defender_team_side || null,
    attacker_player_ref: playerRefByLocalId[matchupStint.attacker_player_id] || null,
    attacker_team_side: matchupStint.attacker_team_side || null,
    period_key: matchupStint.period_key || null,
    start_time_s: Number(matchupStint.start_time_s),
    end_time_s: Number(matchupStint.end_time_s),
    updated_at: new Date().toISOString(),
    deleted_at: null,
  };

  if (!payload.match_id) return { ok: false, reason: 'missing_match_reference' };

  const selectCols = 'id,match_id,local_matchup_stint_id,defender_player_ref,defender_team_side,attacker_player_ref,attacker_team_side,period_key,start_time_s,end_time_s';

  if (matchupStint.server_matchup_stint_id) {
    const { data, error } = await supabase
      .from('private_matchup_stints')
      .update(payload)
      .eq('id', matchupStint.server_matchup_stint_id)
      .eq('user_id', user.id)
      .select(selectCols)
      .maybeSingle();
    if (!error && data?.id) return { ok: true, id: data.id, matchupStint: data };
    if (error && !isMissingOptionalSchema(error, /private_matchup_stints|local_matchup_stint_id|defender_player_ref|attacker_player_ref|period_key/i)) {
      return { ok: false, reason: error.message };
    }
  }

  if (matchupStint.id) {
    const { data: existing } = await supabase
      .from('private_matchup_stints')
      .select(selectCols)
      .eq('user_id', user.id)
      .eq('local_matchup_stint_id', matchupStint.id)
      .maybeSingle();
    if (existing?.id) {
      const { data, error } = await supabase
        .from('private_matchup_stints')
        .update(payload)
        .eq('id', existing.id)
        .eq('user_id', user.id)
        .select(selectCols)
        .maybeSingle();
      if (!error && data?.id) return { ok: true, id: data.id, matchupStint: data };
    }
  }

  const { data, error } = await supabase
    .from('private_matchup_stints')
    .insert({ ...payload, created_at: new Date().toISOString() })
    .select(selectCols)
    .maybeSingle();
  if (error) return { ok: false, reason: error.message };
  return { ok: true, id: data?.id, matchupStint: data };
}

export async function softDeletePrivateTeam(serverTeamId) {
  const user = await requireAuthUser();
  if (!user || !serverTeamId) return { ok: false, reason: user ? 'missing_team_reference' : 'not_authenticated' };
  const { error } = await supabase
    .from('private_teams')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', serverTeamId)
    .eq('user_id', user.id);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export async function softDeletePrivatePlayer(serverPlayerId) {
  const user = await requireAuthUser();
  if (!user || !serverPlayerId) return { ok: false, reason: user ? 'missing_player_reference' : 'not_authenticated' };
  const { error } = await supabase
    .from('private_players')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', serverPlayerId)
    .eq('user_id', user.id);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export async function softDeletePrivateMatchupStint(serverMatchupStintId) {
  const user = await requireAuthUser();
  if (!user || !serverMatchupStintId) return { ok: false, reason: user ? 'missing_matchup_reference' : 'not_authenticated' };
  const { error } = await supabase
    .from('private_matchup_stints')
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', serverMatchupStintId)
    .eq('user_id', user.id);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export async function ensureServerMatch({
  publicMatchId,
  matchDate,
  code,
  level,
  windSpeed,
  windDirection,
  mode,
  matchLengthMinutes,
  homeTeamRef,
  awayTeamRef,
}) {
  const user = await requireAuthUser();
  if (!user) return { ok: false, reason: 'not_authenticated' };

  // Insert if missing; if it already exists, select it.
  const basePayload = {
    user_id: user.id,
    public_match_id: publicMatchId,
    match_date: matchDate,
    code,
    level,
    mode: mode || 'analysis',
    home_team_ref: homeTeamRef || null,
    away_team_ref: awayTeamRef || null,
  };
  const payload = {
    ...basePayload,
    wind_speed: windSpeed ?? null,
    wind_direction: windDirection ?? null,
    match_length_minutes: Number.isFinite(Number(matchLengthMinutes)) ? Number(matchLengthMinutes) : null,
  };

  let inserted = null;
  let insertErr = null;
  ({ data: inserted, error: insertErr } = await supabase
    .from('matches')
    .insert(payload)
    .select('id,public_match_id')
    .maybeSingle());

  // If the live schema doesn't yet have newer optional columns, retry with
  // the original minimum payload so local logging is never blocked by rollout.
  if (isMissingOptionalSchema(insertErr, /wind_(speed|direction)|\bmode\b|match_length_minutes|home_team_ref|away_team_ref/i)) {
    const retryPayload = {
      user_id: user.id,
      public_match_id: publicMatchId,
      match_date: matchDate,
      code,
      level,
    };
    ({ data: inserted, error: insertErr } = await supabase
      .from('matches')
      .insert(retryPayload)
      .select('id,public_match_id')
      .maybeSingle());
  }

  if (!insertErr && inserted?.id) return { ok: true, id: inserted.id };

  // Likely a unique constraint violation; fetch existing.
  const { data: existing, error: fetchErr } = await supabase
    .from('matches')
    .select('id,public_match_id')
    .eq('public_match_id', publicMatchId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (fetchErr || !existing?.id) return { ok: false, reason: fetchErr?.message || insertErr?.message || 'match_upsert_failed' };

  // Best-effort update so existing server rows can receive newer metadata when columns are available.
  if (windSpeed != null || windDirection != null || matchLengthMinutes != null || mode || homeTeamRef || awayTeamRef) {
    const patch = {
      wind_speed: windSpeed ?? null,
      wind_direction: windDirection ?? null,
      mode: mode || 'analysis',
      match_length_minutes: Number.isFinite(Number(matchLengthMinutes)) ? Number(matchLengthMinutes) : null,
      home_team_ref: homeTeamRef || null,
      away_team_ref: awayTeamRef || null,
    };
    const { error: updateErr } = await supabase
      .from('matches')
      .update(patch)
      .eq('id', existing.id)
      .eq('user_id', user.id);

    if (isMissingOptionalSchema(updateErr, /wind_(speed|direction)|\bmode\b|match_length_minutes|home_team_ref|away_team_ref/i)) {
      // Ignore missing-column errors so older Supabase schemas don't block match creation.
    }
  }

  return { ok: true, id: existing.id };
}

export async function insertServerStat({
  matchId,
  publicMatchId,
  stat,
  teamSide = 'unknown',
  playerRefByLocalId = {},
}) {
  const user = await requireAuthUser();
  if (!user) return { ok: false, reason: 'not_authenticated' };

  const extra = sanitizeExtraDataForServer(stat.extra_data, playerRefByLocalId);
  const { playerRef, recipientRef } = findPrimaryRefs(stat, playerRefByLocalId);

  const payload = {
    user_id: user.id,
    match_id: matchId,
    public_match_id: publicMatchId,
    stat_type: stat.stat_type,
    is_pass: !!stat.is_pass,
    half: stat.half,
    timestamp: stat.timestamp,

    // v0.4: play/possession + time metadata
    play_id: stat.play_id ?? null,
    possession_id: stat.possession_id ?? null,
    possession_team_side: stat.possession_team_side ?? null,
    // The boolean is now semantically Set Defence. Keep counter_attack as a
    // compatibility alias for older schemas, but also send the explicit name.
    counter_attack: stat.set_defence ?? stat.counter_attack ?? false,
    set_defence: stat.set_defence ?? stat.counter_attack ?? false,
    defence_set_migration_version: stat.defence_set_migration_version ?? null,
    stat_model_migration_version: stat.stat_model_migration_version ?? null,
    time_s: stat.time_s ?? null,
    normalized_time_s: stat.normalized_time_s ?? null,

    x_position: stat.x_position,
    y_position: stat.y_position,
    end_x_position: stat.end_x_position ?? null,
    end_y_position: stat.end_y_position ?? null,
    raw_x_position: stat.raw_x_position ?? null,
    raw_y_position: stat.raw_y_position ?? null,
    raw_end_x_position: stat.raw_end_x_position ?? null,
    raw_end_y_position: stat.raw_end_y_position ?? null,
    player_number: stat.player_number ?? null,
    recipient_number: stat.recipient_number ?? null,
    player_ref: playerRef || null,
    recipient_ref: recipientRef || null,
    team_side: teamSide ?? 'unknown',
    extra_data: extra,
  };

  let { data, error } = await supabase
    .from('stat_entries')
    .insert(payload)
    .select('id')
    .maybeSingle();

  if (isMissingOptionalSchema(error, /set_defence|defence_set_migration_version|stat_model_migration_version|player_ref|recipient_ref/i)) {
    const {
      set_defence,
      defence_set_migration_version,
      stat_model_migration_version,
      player_ref,
      recipient_ref,
      ...fallbackPayload
    } = payload;
    ({ data, error } = await supabase
      .from('stat_entries')
      .insert(fallbackPayload)
      .select('id')
      .maybeSingle());
  }

  if (error) return { ok: false, reason: error.message };
  return { ok: true, id: data?.id };
}

export async function softDeleteServerMatch(matchId) {
  const user = await requireAuthUser();
  if (!user) return { ok: false, reason: 'not_authenticated' };

  const deletedAt = new Date().toISOString();

  const { error: mErr } = await supabase
    .from('matches')
    .update({ deleted_at: deletedAt })
    .eq('id', matchId)
    .eq('user_id', user.id);

  if (mErr) return { ok: false, reason: mErr.message };

  await supabase
    .from('stat_entries')
    .update({ deleted_at: deletedAt })
    .eq('match_id', matchId)
    .eq('user_id', user.id);

  return { ok: true };
}

export async function softDeleteServerStat(statId) {
  const user = await requireAuthUser();
  if (!user) return { ok: false, reason: 'not_authenticated' };

  const deletedAt = new Date().toISOString();
  const { error } = await supabase
    .from('stat_entries')
    .update({ deleted_at: deletedAt })
    .eq('id', statId)
    .eq('user_id', user.id);

  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export async function updateServerStat(statId, patch) {
  const user = await requireAuthUser();
  if (!user) return { ok: false, reason: 'not_authenticated' };

  const payload = { ...(patch || {}) };
  delete payload.player_name;
  delete payload.recipient_name;
  // Ensure jsonb for extra_data
  if (Object.prototype.hasOwnProperty.call(payload, 'extra_data')) {
    payload.extra_data = sanitizeExtraDataForServer(payload.extra_data);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'set_defence')) {
    payload.counter_attack = !!payload.set_defence;
  } else if (Object.prototype.hasOwnProperty.call(payload, 'counter_attack')) {
    payload.set_defence = !!payload.counter_attack;
  }

  let { error } = await supabase
    .from('stat_entries')
    .update(payload)
    .eq('id', statId)
    .eq('user_id', user.id);

  if (isMissingOptionalSchema(error, /set_defence|defence_set_migration_version|stat_model_migration_version|player_ref|recipient_ref/i)) {
    const {
      set_defence,
      defence_set_migration_version,
      stat_model_migration_version,
      player_ref,
      recipient_ref,
      ...fallbackPayload
    } = payload;
    ({ error } = await supabase
      .from('stat_entries')
      .update(fallbackPayload)
      .eq('id', statId)
      .eq('user_id', user.id));
  }

  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export async function fetchServerMatches({ limit = 100 } = {}) {
  const user = await requireAuthUser();
  if (!user) return { ok: false, reason: 'not_authenticated', matches: [] };

  const { data, error } = await supabase
    .from('matches')
    .select('*')
    .eq('user_id', user.id)
    .limit(limit);

  if (error) return { ok: false, reason: error.message, matches: [] };
  const matches = (data || []).filter((row) => !row?.deleted_at);
  matches.sort((a, b) => String(b?.created_at || b?.match_date || '').localeCompare(String(a?.created_at || a?.match_date || '')));
  return { ok: true, matches };
}

export async function fetchServerStatsForMatch({ serverMatchId, publicMatchId, limit = 5000 } = {}) {
  const user = await requireAuthUser();
  if (!user) return { ok: false, reason: 'not_authenticated', stats: [] };
  if (!serverMatchId && !publicMatchId) return { ok: false, reason: 'missing_match_reference', stats: [] };

  let query = supabase
    .from('stat_entries')
    .select('*')
    .eq('user_id', user.id)
    .limit(limit);

  if (serverMatchId) {
    query = query.eq('match_id', serverMatchId);
  } else {
    query = query.eq('public_match_id', publicMatchId);
  }

  const { data, error } = await query;
  if (error) return { ok: false, reason: error.message, stats: [] };
  const stats = (data || []).filter((row) => !row?.deleted_at);
  stats.sort((a, b) => {
    const playDiff = Number(a?.play_id || 0) - Number(b?.play_id || 0);
    if (playDiff) return playDiff;
    return String(a?.timestamp || '').localeCompare(String(b?.timestamp || ''));
  });
  return { ok: true, stats };
}
