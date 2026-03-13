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
}) {
  const user = await requireAuthUser();
  if (!user) return { ok: false, reason: 'not_authenticated' };

  // Insert if missing; if it already exists, select it.
  const payload = {
    user_id: user.id,
    public_match_id: publicMatchId,
    match_date: matchDate,
    code,
    level,
  };

  const { data: inserted, error: insertErr } = await supabase
    .from('matches')
    .insert(payload)
    .select('id,public_match_id')
    .maybeSingle();

  if (!insertErr && inserted?.id) return { ok: true, id: inserted.id };

  // Likely a unique constraint violation; fetch existing.
  const { data: existing, error: fetchErr } = await supabase
    .from('matches')
    .select('id,public_match_id')
    .eq('public_match_id', publicMatchId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (fetchErr || !existing?.id) return { ok: false, reason: fetchErr?.message || insertErr?.message || 'match_upsert_failed' };
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

  const { data, error } = await supabase
    .from('stat_entries')
    .insert(payload)
    .select('id')
    .maybeSingle();

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

  const { error } = await supabase
    .from('stat_entries')
    .update(payload)
    .eq('id', statId)
    .eq('user_id', user.id);

  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}
