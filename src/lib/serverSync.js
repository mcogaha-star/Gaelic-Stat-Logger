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

export async function ensureServerMatch({
  publicMatchId,
  matchDate,
  code,
  level,
  windSpeed,
  windDirection,
  mode,
  matchLengthMinutes,
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
  if (insertErr?.message && /wind_(speed|direction)|\bmode\b|match_length_minutes/i.test(insertErr.message)) {
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
  if (windSpeed != null || windDirection != null || matchLengthMinutes != null || mode) {
    const patch = {
      wind_speed: windSpeed ?? null,
      wind_direction: windDirection ?? null,
      mode: mode || 'analysis',
      match_length_minutes: Number.isFinite(Number(matchLengthMinutes)) ? Number(matchLengthMinutes) : null,
    };
    const { error: updateErr } = await supabase
      .from('matches')
      .update(patch)
      .eq('id', existing.id)
      .eq('user_id', user.id);

    if (updateErr?.message && /wind_(speed|direction)|\bmode\b|match_length_minutes/i.test(updateErr.message)) {
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
}) {
  const user = await requireAuthUser();
  if (!user) return { ok: false, reason: 'not_authenticated' };

  const extra = stat.extra_data ? (() => {
    try { return JSON.parse(stat.extra_data); } catch { return null; }
  })() : null;

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
    team_side: teamSide ?? 'unknown',
    extra_data: extra,
  };

  let { data, error } = await supabase
    .from('stat_entries')
    .insert(payload)
    .select('id')
    .maybeSingle();

  if (error?.message && /set_defence|defence_set_migration_version|stat_model_migration_version/i.test(error.message)) {
    const {
      set_defence,
      defence_set_migration_version,
      stat_model_migration_version,
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
  // Ensure jsonb for extra_data
  if (payload.extra_data && typeof payload.extra_data === 'string') {
    try { payload.extra_data = JSON.parse(payload.extra_data); } catch { payload.extra_data = null; }
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

  if (error?.message && /set_defence|defence_set_migration_version|stat_model_migration_version/i.test(error.message)) {
    const {
      set_defence,
      defence_set_migration_version,
      stat_model_migration_version,
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
