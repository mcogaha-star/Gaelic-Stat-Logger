import {
  PITCH_H,
  calcAngleToGoal,
  calcDistanceToGoal,
  getNormalizedTimeS,
  isBroughtBackAdvantageStat,
} from '@/lib/reportAnalytics';

const EXPORT_HEADERS = [
  'Team',
  'PlayerName',
  'GameHalf',
  'GameTimeSeconds',
  'ShotPressure',
  'ShotType',
  'SetPlay',
  'ShotMethod',
  'Distance',
  'Angle',
  'Side',
  'ShotOutcome',
  'NewAttack',
];

const REQUIRED_IMPORT_HEADERS = [...EXPORT_HEADERS, 'ExpectedScore'];
const XP_ISSUES_STORAGE_PREFIX = 'gaeliq-xp-import-issues:';

function safeParseJSONLocal(value, fallback = {}) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeTextLower(value) {
  return normalizeText(value).toLowerCase();
}

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function buildCsvLine(values) {
  return values.map(csvEscape).join(',');
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      values.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function parseCsvText(content) {
  const normalized = String(content || '').replace(/^\ufeff/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n').filter((line) => line.length > 0);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]).map((header) => normalizeText(header));
  const rows = lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return headers.reduce((acc, header, index) => {
      acc[header] = normalizeText(values[index] ?? '');
      return acc;
    }, {});
  });
  return { headers, rows };
}

function getHalfBucket(half) {
  if (half === 'second') return 2;
  if (half === 'et_first' || half === 'et_second') return 3;
  return 1;
}

function getShotTypeLabel(shotType) {
  if (shotType === 'point') return 'Point attempt';
  if (shotType === '2_point') return '2 Point attempt';
  if (shotType === 'goal') return 'Goal attempt';
  return '';
}

function getSetPlayLabel(situation) {
  if (situation === 'play') return 'Open Play';
  if (situation === 'free_hands') return 'Free Kick from Hands';
  if (situation === 'free_ground') return 'Free Kick from Ground';
  if (situation === 'penalty') return 'Penalty';
  if (situation === '45') return '45m Kick';
  if (situation === 'mark') return 'Mark';
  return '';
}

function getShotMethodLabel(method) {
  if (method === 'left') return 'Left foot';
  if (method === 'right') return 'Right foot';
  if (method === 'hand') return 'Hand';
  return '';
}

function getShotPressureLabel(pressure) {
  if (pressure === 'low') return 'Low';
  if (pressure === 'medium') return 'Medium';
  if (pressure === 'high') return 'High';
  return '';
}

function getShotOutcomeLabel(outcome, result) {
  if (normalizeText(result) === '45') return '45';
  if (outcome === 'goal') return 'Goal';
  if (outcome === 'point') return 'Point';
  if (outcome === '2_point') return '2 Point';
  if (outcome === 'wide') return 'Wide';
  if (outcome === 'short') return 'Short';
  if (outcome === 'saved') return 'Saved';
  if (outcome === 'blocked') return 'Blocked';
  if (outcome === 'post') return 'Post';
  return '';
}

function formatDistance(distance) {
  const numeric = Number(distance);
  if (!Number.isFinite(numeric)) return '';
  return numeric.toFixed(2);
}

function formatAngle(angle) {
  const numeric = Number(angle);
  if (!Number.isFinite(numeric)) return '';
  return String(Math.round(Math.abs(numeric)));
}

function getExportSide(y) {
  const yy = Number(y);
  if (!Number.isFinite(yy)) return 'Left';
  return yy <= (PITCH_H / 2) ? 'Left' : 'Right';
}

function parseDpNumber(value) {
  const text = normalizeTextLower(value);
  if (!text) return NaN;
  if (text === 'from centre' || text === 'from center') return 0;
  const match = text.match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : NaN;
}

function numbersClose(a, b, tolerance = 1) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= tolerance;
}

function buildPlayerLookup(players = []) {
  const byId = new Map();
  const bySideNumber = new Map();
  for (const player of Array.isArray(players) ? players : []) {
    if (player?.id) byId.set(String(player.id), player);
    const side = player?.team_side;
    const number = Number(player?.number);
    if ((side === 'home' || side === 'away') && Number.isFinite(number)) {
      bySideNumber.set(`${side}:${number}`, player);
    }
  }
  return { byId, bySideNumber };
}

function resolveShotPlayerName(stat, shot, playerLookup) {
  const playerSel = shot?.player && typeof shot.player === 'object' ? shot.player : null;
  const rosterPlayer = (() => {
    if (playerSel?.id && playerLookup.byId.has(String(playerSel.id))) return playerLookup.byId.get(String(playerSel.id));
    const number = Number(playerSel?.number ?? stat?.player_number);
    const side = playerSel?.team_side === 'away' || playerSel?.team_side === 'home'
      ? playerSel.team_side
      : stat?.team_side === 'away' ? 'away' : 'home';
    if (Number.isFinite(number)) return playerLookup.bySideNumber.get(`${side}:${number}`) || null;
    return null;
  })();
  return normalizeText(playerSel?.name || rosterPlayer?.name || stat?.player_name || '');
}

export function getThirdPartyXpIssuesStorageKey(matchId) {
  return `${XP_ISSUES_STORAGE_PREFIX}${String(matchId || '')}`;
}

export function readThirdPartyXpIssues(matchId) {
  if (!matchId) return [];
  try {
    const raw = localStorage.getItem(getThirdPartyXpIssuesStorageKey(matchId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeThirdPartyXpIssues(matchId, issues) {
  if (!matchId) return;
  try {
    const next = Array.isArray(issues) ? issues : [];
    if (!next.length) {
      localStorage.removeItem(getThirdPartyXpIssuesStorageKey(matchId));
      return;
    }
    localStorage.setItem(getThirdPartyXpIssuesStorageKey(matchId), JSON.stringify(next));
  } catch {}
}

export function clearThirdPartyXpIssues(matchId) {
  if (!matchId) return;
  try {
    localStorage.removeItem(getThirdPartyXpIssuesStorageKey(matchId));
  } catch {}
}

export function buildThirdPartyShotRecords(stats, match, teams = {}, players = [], imputedTimeById) {
  const playerLookup = buildPlayerLookup(players);
  const list = Array.isArray(stats) ? stats : [];
  const records = [];
  for (const stat of list) {
    if (!stat || stat.stat_type !== 'shot') continue;
    const extra = safeParseJSONLocal(stat.extra_data || '{}', {});
    const shot = extra?.shot || {};
    if (!match?.id && !stat?.match_id) continue;
    const side = stat.team_side === 'away' ? 'away' : 'home';
    const normalizedTime = getNormalizedTimeS(stat, imputedTimeById);
    const x = Number(stat?.x_position);
    const y = Number(stat?.y_position);
    const distance = calcDistanceToGoal(x, y);
    const angle = calcAngleToGoal(x, y);
    const possessionId = Number(stat?.possession_id);
    records.push({
      id: stat.id,
      stat,
      extra,
      shot,
      teamSide: side,
      teamName: side === 'away' ? normalizeText(teams?.awayTeam?.name || 'Away') : normalizeText(teams?.homeTeam?.name || 'Home'),
      playerName: resolveShotPlayerName(stat, shot, playerLookup),
      half: String(stat?.half || 'first'),
      gameHalf: getHalfBucket(stat?.half),
      gameTime: Number.isFinite(normalizedTime) ? Math.round(normalizedTime) : null,
      shotPressure: getShotPressureLabel(String(shot?.pressure || '')),
      shotTypeKey: String(shot?.type || shot?.shot_type || shot?.shotType || 'point') === '2 point'
        ? '2_point'
        : String(shot?.type || shot?.shot_type || shot?.shotType || 'point'),
      shotType: getShotTypeLabel(String(shot?.type || shot?.shot_type || shot?.shotType || 'point') === '2 point'
        ? '2_point'
        : String(shot?.type || shot?.shot_type || shot?.shotType || 'point')),
      setPlayKey: String(shot?.situation || ''),
      setPlay: getSetPlayLabel(String(shot?.situation || '')),
      shotMethodKey: String(shot?.method || ''),
      shotMethod: getShotMethodLabel(String(shot?.method || '')),
      distanceValue: Number.isFinite(distance) ? Math.round(distance) : NaN,
      distance: Number.isFinite(distance) ? formatDistance(distance) : '',
      angleValue: Number.isFinite(angle) ? Math.round(Math.abs(angle)) : NaN,
      angle: Number.isFinite(angle) ? formatAngle(angle) : '',
      side: getExportSide(y),
      shotOutcomeKey: String(shot?.outcome || ''),
      shotOutcome: getShotOutcomeLabel(String(shot?.outcome || ''), shot?.result),
      result: normalizeText(shot?.result || ''),
      possessionId: Number.isFinite(possessionId) ? possessionId : null,
      broughtBackAdv: !!shot?.brought_back_adv || isBroughtBackAdvantageStat(stat),
      x,
      y,
    });
  }
  return records;
}

export function mapShotToThirdPartyRow(record, newAttack = 'No') {
  return {
    Team: record.teamName,
    PlayerName: record.playerName,
    GameHalf: String(record.gameHalf),
    GameTimeSeconds: Number.isFinite(record.gameTime) ? String(record.gameTime) : '',
    ShotPressure: record.shotPressure,
    ShotType: record.shotType,
    SetPlay: record.setPlay,
    ShotMethod: record.shotMethod,
    Distance: record.distance,
    Angle: record.angle,
    Side: record.side,
    ShotOutcome: record.shotOutcome,
    NewAttack: newAttack,
  };
}

export function buildThirdPartyShotExportRows(stats, match, teams = {}, players = [], imputedTimeById) {
  const records = buildThirdPartyShotRecords(stats, match, teams, players, imputedTimeById)
    .filter((record) => !record.broughtBackAdv);
  const groupedCounts = new Map();
  return records.map((record) => {
    const key = record.possessionId != null ? `${record.teamSide}:${record.possessionId}` : `shot:${record.id}`;
    const count = groupedCounts.get(key) || 0;
    groupedCounts.set(key, count + 1);
    return mapShotToThirdPartyRow(record, count === 0 ? 'Yes' : 'No');
  });
}

export function serializeThirdPartyRowsToCsv(rows) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const lines = [
    buildCsvLine(EXPORT_HEADERS),
    ...normalizedRows.map((row) => buildCsvLine(EXPORT_HEADERS.map((header) => row?.[header] ?? ''))),
  ];
  return lines.join('\n');
}

export function parseThirdPartyXpCsv(fileText) {
  const parsed = parseCsvText(fileText);
  const missingHeaders = REQUIRED_IMPORT_HEADERS.filter((header) => !parsed.headers.includes(header));
  if (missingHeaders.length) {
    throw new Error(`Missing required CSV columns: ${missingHeaders.join(', ')}`);
  }
  const rows = parsed.rows.map((row, index) => ({
    ...row,
    __rowIndex: index,
    __expectedScoreValue: Number(row.ExpectedScore),
  }));
  return { headers: parsed.headers, rows };
}

export function matchThirdPartyRowToShot(importRow, shotRecords) {
  const records = Array.isArray(shotRecords) ? shotRecords : [];
  const baseCandidates = records.filter((record) => (
    normalizeTextLower(record.teamName) === normalizeTextLower(importRow.Team)
    && normalizeTextLower(record.playerName) === normalizeTextLower(importRow.PlayerName)
    && String(record.gameHalf) === String(importRow.GameHalf)
    && String(record.gameTime ?? '') === String(parseDpNumber(importRow.GameTimeSeconds))
    && normalizeTextLower(record.shotType) === normalizeTextLower(importRow.ShotType)
    && normalizeTextLower(record.setPlay) === normalizeTextLower(importRow.SetPlay)
    && normalizeTextLower(record.shotMethod) === normalizeTextLower(importRow.ShotMethod)
  ));

  if (baseCandidates.length <= 1) {
    return {
      status: baseCandidates.length === 1 ? 'matched' : 'unmatched',
      candidates: baseCandidates,
      record: baseCandidates[0] || null,
    };
  }

  const importDistance = parseDpNumber(importRow.Distance);
  const importAngle = parseDpNumber(importRow.Angle);
  const sideText = normalizeTextLower(importRow.Side);
  const outcomeText = normalizeTextLower(importRow.ShotOutcome);

  const refined = baseCandidates.filter((record) => {
    if (Number.isFinite(importDistance) && !numbersClose(record.distanceValue, importDistance, 0.01)) return false;
    if (Number.isFinite(importAngle) && !numbersClose(record.angleValue, importAngle, 1)) return false;
    if (sideText && normalizeTextLower(record.side) !== sideText) return false;
    if (outcomeText && normalizeTextLower(record.shotOutcome) !== outcomeText) return false;
    return true;
  });

  if (refined.length === 1) {
    return { status: 'matched', candidates: refined, record: refined[0] };
  }
  if (!refined.length) {
    return { status: 'unmatched', candidates: [], record: null };
  }
  return { status: 'ambiguous', candidates: refined, record: null };
}

export function applyXpImportToShots(importRows, shotRecords, rawStatsById, updateFns = {}) {
  const {
    updateLocalShot = async () => null,
    updateServerShot = async () => null,
    uploadedAt = new Date().toISOString(),
  } = updateFns;

  const summary = {
    totalRows: 0,
    matched: 0,
    unmatched: 0,
    ambiguous: 0,
    updatedShotsCount: 0,
    issues: [],
    updates: [],
  };

  const matchedShotIds = new Set();
  const rows = Array.isArray(importRows) ? importRows : [];
  const byId = rawStatsById instanceof Map ? rawStatsById : new Map();

  const work = rows.map(async (row) => {
    summary.totalRows += 1;
    const match = matchThirdPartyRowToShot(row, shotRecords);
    if (match.status === 'unmatched') {
      summary.unmatched += 1;
      summary.issues.push({
        type: 'unmatched',
        rowIndex: row.__rowIndex,
        signature: buildImportRowSignature(row),
      });
      return;
    }
    if (match.status === 'ambiguous') {
      summary.ambiguous += 1;
      summary.issues.push({
        type: 'ambiguous',
        rowIndex: row.__rowIndex,
        signature: buildImportRowSignature(row),
        candidateShotIds: match.candidates.map((candidate) => candidate.id),
      });
      return;
    }

    const record = match.record;
    const current = byId.get(record?.id) || record?.stat || null;
    const xpValue = Number(row.__expectedScoreValue);
    if (!current || !Number.isFinite(xpValue)) {
      summary.unmatched += 1;
      summary.issues.push({
        type: 'unmatched',
        rowIndex: row.__rowIndex,
        signature: buildImportRowSignature(row),
      });
      return;
    }

    summary.matched += 1;
    const extra = safeParseJSONLocal(current.extra_data || '{}', {});
    const nextExtra = {
      ...extra,
      shot: {
        ...(extra?.shot || {}),
        xp: {
          value: xpValue,
          source: 'third_party_import',
          uploaded_at: uploadedAt,
          match_status: 'matched',
        },
      },
    };
    const patch = { extra_data: JSON.stringify(nextExtra) };
    await updateLocalShot(current.id, patch);
    if (current?.server_stat_id) {
      try {
        await updateServerShot(current.server_stat_id, patch);
      } catch {}
    }
    if (!matchedShotIds.has(current.id)) {
      matchedShotIds.add(current.id);
      summary.updatedShotsCount += 1;
    }
    summary.updates.push({ id: current.id, patch });
  });

  return Promise.all(work).then(() => summary);
}

export function buildImportRowSignature(row) {
  return [
    normalizeText(row.Team),
    normalizeText(row.PlayerName),
    `H${normalizeText(row.GameHalf)}`,
    `T${normalizeText(row.GameTimeSeconds)}`,
    normalizeText(row.ShotType),
    normalizeText(row.SetPlay),
    normalizeText(row.ShotMethod),
  ].filter(Boolean).join(' | ');
}

export function formatThirdPartyXpImportSummary(summary) {
  return [
    `${summary.totalRows} rows read`,
    `${summary.matched} matched`,
    `${summary.unmatched} unmatched`,
    `${summary.ambiguous} ambiguous`,
    `${summary.updatedShotsCount} shots updated`,
  ].join(' | ');
}

export { EXPORT_HEADERS, REQUIRED_IMPORT_HEADERS };
