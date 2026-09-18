import {
  GOAL_X,
  GOAL_Y,
  PITCH_H,
  calcDistanceToGoal,
  getNormalizedTimeS,
  isBroughtBackAdvantageStat,
} from './reportAnalytics.js';

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

function normalizeShotSituation(value) {
  const raw = normalizeTextLower(value);
  if (raw === 'free_kick') return 'free_hands';
  return raw;
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
  const normalized = normalizeShotSituation(situation);
  if (normalized === 'play') return 'Open Play';
  if (normalized === 'free_hands') return 'Free Kick from Hands';
  if (normalized === 'free_ground') return 'Free Kick from Ground';
  if (normalized === 'penalty') return 'Penalty';
  if (normalized === '45') return '45m Kick';
  if (normalized === 'mark') return 'Mark';
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

export function calcShotArcAngle(x, y) {
  const longitudinalDistance = GOAL_X - Number(x);
  const lateralDistance = Math.abs(Number(y) - GOAL_Y);
  if (!Number.isFinite(longitudinalDistance) || !Number.isFinite(lateralDistance)) return NaN;
  return Math.atan2(lateralDistance, longitudinalDistance) * (180 / Math.PI);
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
    const angle = calcShotArcAngle(x, y);
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
      playId: Number.isFinite(Number(stat?.play_id)) ? Number(stat.play_id) : null,
      shotPressure: getShotPressureLabel(String(shot?.pressure || '')),
      shotTypeKey: String(shot?.type || shot?.shot_type || shot?.shotType || 'point') === '2 point'
        ? '2_point'
        : String(shot?.type || shot?.shot_type || shot?.shotType || 'point'),
      shotType: getShotTypeLabel(String(shot?.type || shot?.shot_type || shot?.shotType || 'point') === '2 point'
        ? '2_point'
        : String(shot?.type || shot?.shot_type || shot?.shotType || 'point')),
      setPlayKey: normalizeShotSituation(shot?.situation || ''),
      setPlay: getSetPlayLabel(shot?.situation || ''),
      shotMethodKey: String(shot?.method || ''),
      shotMethod: getShotMethodLabel(String(shot?.method || '')),
      distanceValue: Number.isFinite(distance) ? distance : NaN,
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
    .filter((record) => !record.broughtBackAdv)
    .sort((a, b) => {
      if (a.gameHalf !== b.gameHalf) return a.gameHalf - b.gameHalf;
      if (Number.isFinite(a.playId) && Number.isFinite(b.playId) && a.playId !== b.playId) return a.playId - b.playId;
      if (Number.isFinite(a.gameTime) && Number.isFinite(b.gameTime) && a.gameTime !== b.gameTime) return a.gameTime - b.gameTime;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
  let previousAttackKey = null;
  return records.map((record) => {
    const key = record.possessionId != null
      ? `${record.half}:${record.teamSide}:${record.possessionId}`
      : `shot:${record.id}`;
    const newAttack = key === previousAttackKey ? 'No' : 'Yes';
    previousAttackKey = key;
    return mapShotToThirdPartyRow(record, newAttack);
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
  const rows = parsed.rows.map((row, index) => {
    const csvRow = /** @type {Record<string, string>} */ (row);
    return {
      ...csvRow,
      __rowIndex: index,
      __expectedScoreValue: normalizeText(csvRow.ExpectedScore) === '' ? NaN : Number(csvRow.ExpectedScore),
    };
  });
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
    if (Number.isFinite(importDistance) && !numbersClose(record.distanceValue, importDistance, 0.011)) return false;
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

export function validateThirdPartyXpImport(importRows, shotRecords, rawStatsById) {
  const summary = {
    totalRows: 0,
    expectedRows: Array.isArray(shotRecords) ? shotRecords.length : 0,
    matched: 0,
    unmatched: 0,
    ambiguous: 0,
    invalidXp: 0,
    duplicateMatches: 0,
    missingShots: 0,
    updatedShotsCount: 0,
    issues: [],
    updates: [],
    plans: [],
    valid: false,
  };

  const matchedShotIds = new Set();
  const rows = Array.isArray(importRows) ? importRows : [];
  const records = Array.isArray(shotRecords) ? shotRecords : [];
  const byId = rawStatsById instanceof Map ? rawStatsById : new Map();
  if (rows.length !== records.length) {
    summary.issues.push({
      type: 'row_count',
      expectedRows: records.length,
      actualRows: rows.length,
      signature: `Expected ${records.length} rows; received ${rows.length}`,
    });
  }

  for (const row of rows) {
    summary.totalRows += 1;
    const xpValue = Number(row.__expectedScoreValue);
    if (normalizeText(row.ExpectedScore) === '' || !Number.isFinite(xpValue)) {
      summary.invalidXp += 1;
      summary.issues.push({
        type: 'invalid_xp',
        rowIndex: row.__rowIndex,
        signature: buildImportRowSignature(row),
      });
      continue;
    }

    const match = matchThirdPartyRowToShot(row, records);
    if (match.status === 'unmatched') {
      summary.unmatched += 1;
      summary.issues.push({
        type: 'unmatched',
        rowIndex: row.__rowIndex,
        signature: buildImportRowSignature(row),
      });
      continue;
    }
    if (match.status === 'ambiguous') {
      summary.ambiguous += 1;
      summary.issues.push({
        type: 'ambiguous',
        rowIndex: row.__rowIndex,
        signature: buildImportRowSignature(row),
        candidateShotIds: match.candidates.map((candidate) => candidate.id),
      });
      continue;
    }

    const record = match.record;
    const current = byId.get(record?.id) || record?.stat || null;
    if (!current) {
      summary.unmatched += 1;
      summary.issues.push({
        type: 'unmatched',
        rowIndex: row.__rowIndex,
        signature: buildImportRowSignature(row),
      });
      continue;
    }
    if (matchedShotIds.has(current.id)) {
      summary.duplicateMatches += 1;
      summary.issues.push({
        type: 'duplicate',
        rowIndex: row.__rowIndex,
        signature: buildImportRowSignature(row),
        candidateShotIds: [current.id],
      });
      continue;
    }

    summary.matched += 1;
    matchedShotIds.add(current.id);
    summary.plans.push({ row, record, current, xpValue });
  }

  for (const record of records) {
    if (matchedShotIds.has(record?.id)) continue;
    summary.missingShots += 1;
    summary.issues.push({
      type: 'missing',
      signature: `Shot ${String(record?.id || 'unknown')} was not matched`,
      candidateShotIds: record?.id ? [record.id] : [],
    });
  }
  summary.valid = summary.issues.length === 0 && summary.plans.length === records.length;
  return summary;
}

function createImportValidationError(summary) {
  const parts = [];
  if (summary.totalRows !== summary.expectedRows) parts.push(`${summary.totalRows}/${summary.expectedRows} rows`);
  if (summary.invalidXp) parts.push(`${summary.invalidXp} blank or invalid xP`);
  if (summary.unmatched) parts.push(`${summary.unmatched} unmatched`);
  if (summary.ambiguous) parts.push(`${summary.ambiguous} ambiguous`);
  if (summary.duplicateMatches) parts.push(`${summary.duplicateMatches} duplicate matches`);
  if (summary.missingShots) parts.push(`${summary.missingShots} missing shots`);
  return Object.assign(
    new Error(`ShotArc import rejected (${parts.join(', ') || 'validation failed'}). No changes were saved.`),
    { summary },
  );
}

function ensureServerSaveSucceeded(result, shotId, action = 'save') {
  if (result?.ok === false) {
    throw new Error(`Server ${action} failed for shot ${shotId}: ${result.reason || 'unknown error'}`);
  }
}

export async function applyXpImportToShots(importRows, shotRecords, rawStatsById, updateFns = {}) {
  const {
    updateLocalShot = async () => null,
    updateServerShot = async () => null,
    uploadedAt = new Date().toISOString(),
  } = updateFns;
  const summary = validateThirdPartyXpImport(importRows, shotRecords, rawStatsById);
  if (!summary.valid) throw createImportValidationError(summary);

  const updates = summary.plans.map(({ current, xpValue }) => {
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
    return {
      id: current.id,
      serverStatId: current?.server_stat_id || null,
      patch: { extra_data: JSON.stringify(nextExtra) },
      rollbackPatch: { extra_data: current.extra_data || '{}' },
    };
  });

  const applied = [];
  try {
    for (const update of updates) {
      const state = { ...update, serverApplied: false, localApplied: false };
      applied.push(state);
      if (update.serverStatId) {
        const serverResult = await updateServerShot(update.serverStatId, update.patch);
        ensureServerSaveSucceeded(serverResult, update.id);
        state.serverApplied = true;
      }
      await updateLocalShot(update.id, update.patch);
      state.localApplied = true;
    }
  } catch (saveError) {
    const rollbackFailures = [];
    for (const state of applied.slice().reverse()) {
      if (state.localApplied) {
        try { await updateLocalShot(state.id, state.rollbackPatch); } catch (error) { rollbackFailures.push(error); }
      }
      if (state.serverApplied) {
        try {
          const result = await updateServerShot(state.serverStatId, state.rollbackPatch);
          ensureServerSaveSucceeded(result, state.id, 'rollback');
        } catch (error) {
          rollbackFailures.push(error);
        }
      }
    }
    const rollbackNote = rollbackFailures.length ? ' Automatic rollback was incomplete; refresh and check data before retrying.' : ' Earlier updates were rolled back.';
    throw new Error(`${saveError?.message || 'ShotArc import save failed.'}${rollbackNote}`);
  }

  summary.updatedShotsCount = updates.length;
  summary.updates = updates.map(({ id, patch }) => ({ id, patch }));
  delete summary.plans;
  return summary;
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
    `${summary.invalidXp || 0} invalid xP`,
    `${summary.duplicateMatches || 0} duplicate matches`,
    `${summary.updatedShotsCount} shots updated`,
  ].join(' | ');
}

export { EXPORT_HEADERS, REQUIRED_IMPORT_HEADERS };
