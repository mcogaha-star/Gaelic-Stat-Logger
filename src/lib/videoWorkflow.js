function parseJsonMaybe(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function toTitleCase(value) {
  return String(value || '')
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export const DEFAULT_VIDEO_CLIP_SETTINGS = {
  play_preroll_s: 3,
  play_fallback_postroll_s: 15,
  possession_postroll_s: 3,
};

export function getVideoClipSettings(match) {
  const parsed = parseJsonMaybe(match?.video_clip_settings, {});
  return {
    play_preroll_s: Number.isFinite(Number(parsed?.play_preroll_s))
      ? Math.max(0, Number(parsed.play_preroll_s))
      : DEFAULT_VIDEO_CLIP_SETTINGS.play_preroll_s,
    play_fallback_postroll_s: Number.isFinite(Number(parsed?.play_fallback_postroll_s))
      ? Math.max(0, Number(parsed.play_fallback_postroll_s))
      : DEFAULT_VIDEO_CLIP_SETTINGS.play_fallback_postroll_s,
    possession_postroll_s: Number.isFinite(Number(parsed?.possession_postroll_s))
      ? Math.max(0, Number(parsed.possession_postroll_s))
      : DEFAULT_VIDEO_CLIP_SETTINGS.possession_postroll_s,
  };
}

export function formatTimeMMSS(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function buildClipSignature({ reelType, sourceRef, playId = null, possessionId = null, startTime, endTime }) {
  return [
    String(reelType || ''),
    String(sourceRef || ''),
    Number.isFinite(Number(playId)) ? Number(playId) : '',
    Number.isFinite(Number(possessionId)) ? Number(possessionId) : '',
    Number.isFinite(Number(startTime)) ? Math.round(Number(startTime) * 10) : '',
    Number.isFinite(Number(endTime)) ? Math.round(Number(endTime) * 10) : '',
  ].join('|');
}

function buildPlayLabel(row) {
  return [
    formatTimeMMSS(Number(row?.stat?.time_s)),
    row?.action || 'Play',
    row?.player || 'Unknown',
  ].filter(Boolean).join(' - ');
}

function buildPossessionLabel(row, homeTeam, awayTeam) {
  const teamLabel = row?.teamSide === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home');
  return [
    `Poss ${Number.isFinite(Number(row?.possessionId)) ? Number(row.possessionId) : 'NA'}`,
    teamLabel,
    row?.groupedOutcome || row?.originLabel || 'Possession',
  ].filter(Boolean).join(' - ');
}

export function createPlayClipRef(row, nextRow, match, clipSettings) {
  const stat = row?.stat || null;
  const startBase = Number(stat?.time_s);
  if (!stat || !Number.isFinite(startBase)) return null;
  const nextBase = Number(nextRow?.stat?.time_s);
  const start = Math.max(0, startBase - Number(clipSettings?.play_preroll_s ?? DEFAULT_VIDEO_CLIP_SETTINGS.play_preroll_s));
  const end = Number.isFinite(nextBase)
    ? Math.max(start + 0.25, nextBase + 1)
    : Math.max(start + 0.25, startBase + Number(clipSettings?.play_fallback_postroll_s ?? DEFAULT_VIDEO_CLIP_SETTINGS.play_fallback_postroll_s));
  return {
    match_id: match?.id || stat?.match_id || '',
    reel_type: 'play',
    source_type: 'play',
    source_ref: String(stat?.id || row?.id || ''),
    play_id: Number.isFinite(Number(stat?.play_id)) ? Number(stat.play_id) : null,
    possession_id: Number.isFinite(Number(stat?.possession_id)) ? Number(stat.possession_id) : null,
    label: buildPlayLabel(row),
    start_time: start,
    end_time: end,
  };
}

export function createPossessionClipRef(row, match, homeTeam, awayTeam, clipSettings) {
  const start = Number(row?.startTime);
  const end = Number(row?.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return {
    match_id: match?.id || '',
    reel_type: 'possession',
    source_type: 'possession',
    source_ref: String(row?.key || row?.possessionId || ''),
    play_id: null,
    possession_id: Number.isFinite(Number(row?.possessionId)) ? Number(row.possessionId) : null,
    label: buildPossessionLabel(row, homeTeam, awayTeam),
    start_time: Math.max(0, start),
    end_time: Math.max(start + 0.25, end + Number(clipSettings?.possession_postroll_s ?? DEFAULT_VIDEO_CLIP_SETTINGS.possession_postroll_s)),
  };
}

export function reorderClipList(clips = []) {
  return (Array.isArray(clips) ? clips : []).map((clip, index) => ({ ...clip, order_index: index }));
}

export function getAuthorInitials(user) {
  const metadata = user?.user_metadata || {};
  const candidates = [
    metadata?.initials,
    metadata?.full_name,
    metadata?.name,
    metadata?.display_name,
    user?.email,
  ].filter(Boolean);
  const source = String(candidates[0] || '').trim();
  if (!source) return 'NA';
  if (source.includes('@')) {
    const namePart = source.split('@')[0];
    const pieces = namePart.split(/[._\-\s]+/).filter(Boolean);
    return pieces.slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('').slice(0, 3) || 'NA';
  }
  const pieces = source.split(/\s+/).filter(Boolean);
  if (pieces.length === 1) return pieces[0].slice(0, 2).toUpperCase();
  return pieces.slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('') || 'NA';
}

export function parsePresetPayload(record) {
  return {
    filters: parseJsonMaybe(record?.filters_json, {}),
    sort: parseJsonMaybe(record?.sort_json, null),
  };
}

export function serializeClipSettings(settings) {
  return JSON.stringify({
    play_preroll_s: Number(settings?.play_preroll_s ?? DEFAULT_VIDEO_CLIP_SETTINGS.play_preroll_s),
    play_fallback_postroll_s: Number(settings?.play_fallback_postroll_s ?? DEFAULT_VIDEO_CLIP_SETTINGS.play_fallback_postroll_s),
    possession_postroll_s: Number(settings?.possession_postroll_s ?? DEFAULT_VIDEO_CLIP_SETTINGS.possession_postroll_s),
  });
}

export { parseJsonMaybe, toTitleCase };
