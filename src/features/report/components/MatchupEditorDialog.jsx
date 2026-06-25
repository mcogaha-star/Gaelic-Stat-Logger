import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatHalfClock, getOfficialPeriodLengthMinutes } from '@/lib/reportAnalytics';

const PERIOD_OPTIONS = [
  { value: 'first', label: '1st Half' },
  { value: 'second', label: '2nd Half' },
  { value: 'et_first', label: 'ET 1' },
  { value: 'et_second', label: 'ET 2' },
];

const DEFAULT_MATCHUP_PERIODS = ['first', 'second'];

function getPeriodLimitSeconds(match, periodKey, periodMaxSecondsByKey = {}) {
  const actual = Number(periodMaxSecondsByKey?.[periodKey]);
  if (Number.isFinite(actual) && actual > 0) return actual;
  return getOfficialPeriodLengthMinutes(match, periodKey) * 60;
}

function buildPlayerKey(player) {
  if (!player?.id || !player?.team_side) return null;
  return `${player.team_side}|${player.id}`;
}

function formatPlayerLabel(player, teamNameBySide) {
  if (!player) return 'Unknown';
  const bits = [];
  if (player?.number != null && String(player.number).trim() !== '') bits.push(`#${player.number}`);
  if (player?.name) bits.push(String(player.name).trim());
  const teamLabel = teamNameBySide[player.team_side] || player.team_side || 'Team';
  return `${bits.join(' ').trim()} | ${teamLabel}`.trim();
}

function sortPlayers(list = []) {
  return [...list].sort((a, b) => {
    if (a.team_side !== b.team_side) return String(a.team_side || '').localeCompare(String(b.team_side || ''));
    const aNumber = Number(a.number);
    const bNumber = Number(b.number);
    if (Number.isFinite(aNumber) && Number.isFinite(bNumber) && aNumber !== bNumber) return aNumber - bNumber;
    return String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });
  });
}

function normalizePositionToken(position) {
  const raw = String(position || '').trim().toLowerCase();
  if (!raw) return '';
  const text = raw.replace(/-/g, ' ').replace(/\s+/g, ' ');
  if (text === 'gk' || text.includes('goalkeeper')) return 'goalkeeper';
  if (text.includes('midfield')) return 'midfielder';
  if (text.includes('corner') && text.includes('back')) return 'corner-back';
  if (text.includes('full') && text.includes('back')) return 'full-back';
  if ((text.includes('centre') || text.includes('center')) && text.includes('back')) return 'centre-half-back';
  if (text.includes('wing') && text.includes('back')) return 'wing-back';
  if (text.includes('corner') && text.includes('forward')) return 'corner-forward';
  if (text.includes('full') && text.includes('forward')) return 'full-forward';
  if ((text.includes('centre') || text.includes('center')) && text.includes('forward')) return 'centre-half-forward';
  if (text.includes('wing') && text.includes('forward')) return 'wing-forward';
  if (text.includes('back')) return 'back';
  if (text.includes('forward')) return 'forward';
  return text;
}

function counterpartPositionToken(token) {
  const map = {
    'goalkeeper': 'goalkeeper',
    'midfielder': 'midfielder',
    'corner-back': 'corner-forward',
    'full-back': 'full-forward',
    'centre-half-back': 'centre-half-forward',
    'wing-back': 'wing-forward',
    'corner-forward': 'corner-back',
    'full-forward': 'full-back',
    'centre-half-forward': 'centre-half-back',
    'wing-forward': 'wing-back',
    'back': 'forward',
    'forward': 'back',
  };
  return map[token] || '';
}

function scoreSuggestedAttacker(defender, attacker) {
  if (!defender || !attacker || defender.team_side === attacker.team_side) return -1;
  const defenderToken = normalizePositionToken(defender.position);
  const attackerToken = normalizePositionToken(attacker.position);
  const targetToken = counterpartPositionToken(defenderToken);
  if (!targetToken) return 0;
  if (attackerToken === targetToken) return 100;
  if (targetToken === 'forward' && attackerToken.includes('forward')) return 80;
  if (targetToken === 'back' && attackerToken.includes('back')) return 80;
  if (targetToken === 'midfielder' && attackerToken.includes('mid')) return 80;
  if (targetToken === 'goalkeeper' && attackerToken === 'goalkeeper') return 90;
  return 0;
}

function getSuggestedAttacker(defender, playerOptions = []) {
  if (!defender?.team_side) return null;
  const candidates = sortPlayers(
    (Array.isArray(playerOptions) ? playerOptions : []).filter((player) => player?.team_side && player.team_side !== defender.team_side),
  );
  if (!candidates.length) return null;
  const scored = candidates
    .map((candidate) => ({ candidate, score: scoreSuggestedAttacker(defender, candidate) }))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0].candidate : candidates[0];
}

function clampRangeToPeriod(startTimeS, endTimeS, periodLimitS) {
  const safeLimit = Math.max(1, Number(periodLimitS) || 1);
  const safeStart = Math.max(0, Math.min(safeLimit, Number(startTimeS) || 0));
  const safeEndRaw = Math.max(0, Math.min(safeLimit, Number(endTimeS) || safeLimit));
  const safeEnd = Math.max(safeStart + 1, Math.min(safeLimit, safeEndRaw));
  if (safeEnd > safeLimit) {
    return { startTimeS: Math.max(0, safeLimit - 1), endTimeS: safeLimit };
  }
  return { startTimeS: safeStart, endTimeS: safeEnd };
}

function buildDraftRow(source, match, defaultDefenderKey = null, playerByKey = new Map(), playerOptions = [], periodMaxSecondsByKey = {}) {
  const defaultDefender = defaultDefenderKey ? playerByKey.get(defaultDefenderKey) : null;
  const defenderPlayerId = source?.defender_player_id || defaultDefender?.id || '';
  const defenderTeamSide = source?.defender_team_side || defaultDefender?.team_side || '';
  const defender = defenderPlayerId && defenderTeamSide ? playerByKey.get(`${defenderTeamSide}|${defenderPlayerId}`) : defaultDefender;
  const suggestedAttacker = source?.attacker_player_id ? null : getSuggestedAttacker(defender, playerOptions);
  const attackerPlayerId = source?.attacker_player_id || suggestedAttacker?.id || '';
  const attackerTeamSide = source?.attacker_team_side || suggestedAttacker?.team_side || '';
  const periodKey = source?.period_key || 'first';
  const periodLimitS = getPeriodLimitSeconds(match, periodKey, periodMaxSecondsByKey);
  const rawStart = Number.isFinite(Number(source?.start_time_s)) ? Number(source.start_time_s) : 0;
  const rawEnd = Number.isFinite(Number(source?.end_time_s)) ? Number(source.end_time_s) : periodLimitS;
  const range = clampRangeToPeriod(rawStart, rawEnd, periodLimitS);

  return {
    key: source?.id || `draft-${Math.random().toString(36).slice(2, 10)}`,
    id: source?.id || null,
    defenderPlayerId,
    defenderTeamSide,
    attackerPlayerId,
    attackerTeamSide,
    periodKey,
    startTimeS: range.startTimeS,
    endTimeS: range.endTimeS,
    isNew: !source?.id,
    source: source?.source || (source?.id ? 'saved' : 'draft'),
  };
}

function buildSuggestedRows(match, defaultDefenderKey, playerByKey, playerOptions, periodMaxSecondsByKey = {}) {
  if (!defaultDefenderKey) return [];
  const defender = playerByKey.get(defaultDefenderKey);
  if (!defender) return [];
  const suggestedAttacker = getSuggestedAttacker(defender, playerOptions);
  return DEFAULT_MATCHUP_PERIODS
    .filter((periodKey) => getPeriodLimitSeconds(match, periodKey, periodMaxSecondsByKey) > 0)
    .map((periodKey) => {
      const periodLimitS = getPeriodLimitSeconds(match, periodKey, periodMaxSecondsByKey);
      return buildDraftRow({
        defender_player_id: defender.id,
        defender_team_side: defender.team_side,
        attacker_player_id: suggestedAttacker?.id || '',
        attacker_team_side: suggestedAttacker?.team_side || '',
        period_key: periodKey,
        start_time_s: 0,
        end_time_s: periodLimitS,
        source: 'default',
      }, match, defaultDefenderKey, playerByKey, playerOptions, periodMaxSecondsByKey);
    });
}

function rowsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

export default function MatchupEditorDialog({
  open,
  onOpenChange,
  match,
  playerOptions = [],
  matchupStints = [],
  periodMaxSecondsByKey = {},
  defaultDefenderKey = null,
  onCreateMatchupStint,
  onUpdateMatchupStint,
  onDeleteMatchupStint,
}) {
  const [draftRows, setDraftRows] = useState([]);
  const [busyKey, setBusyKey] = useState('');
  const [errorByKey, setErrorByKey] = useState({});

  const teamNameBySide = useMemo(() => {
    const home = match?.home_team_name || match?.homeTeamName || 'Home';
    const away = match?.away_team_name || match?.awayTeamName || 'Away';
    return { home, away };
  }, [match?.awayTeamName, match?.away_team_name, match?.homeTeamName, match?.home_team_name]);

  const sortedPlayerOptions = useMemo(() => sortPlayers(Array.isArray(playerOptions) ? playerOptions : []), [playerOptions]);

  const playerByKey = useMemo(() => {
    const map = new Map();
    for (const player of sortedPlayerOptions) {
      const key = buildPlayerKey(player);
      if (key) map.set(key, player);
    }
    return map;
  }, [sortedPlayerOptions]);

  const playerById = useMemo(() => {
    const map = new Map();
    for (const player of sortedPlayerOptions) {
      if (player?.id) map.set(String(player.id), player);
    }
    return map;
  }, [sortedPlayerOptions]);

  const filteredSourceRows = useMemo(() => {
    const list = Array.isArray(matchupStints) ? matchupStints : [];
    if (!defaultDefenderKey) return list;
    const defender = playerByKey.get(defaultDefenderKey);
    if (!defender?.id) return list;
    return list.filter((row) => String(row?.defender_player_id || '') === String(defender.id));
  }, [defaultDefenderKey, matchupStints, playerByKey]);

  useEffect(() => {
    if (!open) return;
    const seededRows = filteredSourceRows.length
      ? filteredSourceRows.map((row) => buildDraftRow(row, match, defaultDefenderKey, playerByKey, sortedPlayerOptions, periodMaxSecondsByKey))
      : buildSuggestedRows(match, defaultDefenderKey, playerByKey, sortedPlayerOptions, periodMaxSecondsByKey);
    setDraftRows(seededRows);
    setErrorByKey({});
    setBusyKey('');
  }, [defaultDefenderKey, filteredSourceRows, match, open, periodMaxSecondsByKey, playerByKey, sortedPlayerOptions]);

  const addRow = () => {
    setDraftRows((current) => [...current, buildDraftRow(null, match, defaultDefenderKey, playerByKey, sortedPlayerOptions, periodMaxSecondsByKey)]);
  };

  const updateRow = (rowKey, patch) => {
    setDraftRows((current) => current.map((row) => {
      if (row.key !== rowKey) return row;
      const next = { ...row, ...patch };
      if (Object.prototype.hasOwnProperty.call(patch, 'periodKey')) {
        const periodLimitS = getPeriodLimitSeconds(match, patch.periodKey, periodMaxSecondsByKey);
        Object.assign(next, clampRangeToPeriod(next.startTimeS, next.endTimeS, periodLimitS));
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'defenderPlayerId')) {
        const defender = playerById.get(String(patch.defenderPlayerId || ''));
        next.defenderTeamSide = defender?.team_side || '';
        const currentAttacker = playerById.get(String(next.attackerPlayerId || ''));
        if (!currentAttacker || currentAttacker.team_side === defender?.team_side) {
          const suggestedAttacker = getSuggestedAttacker(defender, sortedPlayerOptions);
          next.attackerPlayerId = suggestedAttacker?.id || '';
          next.attackerTeamSide = suggestedAttacker?.team_side || '';
        }
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'attackerPlayerId')) {
        const attacker = playerById.get(String(patch.attackerPlayerId || ''));
        next.attackerTeamSide = attacker?.team_side || '';
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'range')) {
        const [rawStart, rawEnd] = Array.isArray(patch.range) ? patch.range : [next.startTimeS, next.endTimeS];
        const periodLimitS = getPeriodLimitSeconds(match, next.periodKey, periodMaxSecondsByKey);
        Object.assign(next, clampRangeToPeriod(rawStart, rawEnd, periodLimitS));
      }
      return next;
    }));
    setErrorByKey((current) => ({ ...current, [rowKey]: '' }));
  };

  const validateRow = (row) => {
    const defender = playerById.get(String(row.defenderPlayerId || ''));
    const attacker = playerById.get(String(row.attackerPlayerId || ''));
    const startTimeS = Number(row.startTimeS);
    const endTimeS = Number(row.endTimeS);
    if (!defender) return { ok: false, message: 'Choose a defender.' };
    if (!attacker) return { ok: false, message: 'Choose an attacker.' };
    if (defender.team_side === attacker.team_side) return { ok: false, message: 'Defender and attacker must be on opposite teams.' };
    if (!PERIOD_OPTIONS.some((option) => option.value === row.periodKey)) return { ok: false, message: 'Choose a valid period.' };
    if (!Number.isFinite(startTimeS) || !Number.isFinite(endTimeS)) return { ok: false, message: 'Choose a valid matchup range.' };
    if (endTimeS <= startTimeS) return { ok: false, message: 'End time must be after start time.' };
    const periodLimitS = getPeriodLimitSeconds(match, row.periodKey, periodMaxSecondsByKey);
    if (startTimeS < 0 || endTimeS > periodLimitS) return { ok: false, message: 'Times must stay within the selected period.' };

    const overlap = draftRows.some((other) => {
      if (other.key === row.key) return false;
      if (String(other.defenderPlayerId || '') !== String(row.defenderPlayerId || '')) return false;
      if (String(other.attackerPlayerId || '') !== String(row.attackerPlayerId || '')) return false;
      if (String(other.periodKey || '') !== String(row.periodKey || '')) return false;
      return rowsOverlap(startTimeS, endTimeS, Number(other.startTimeS), Number(other.endTimeS));
    });
    if (overlap) return { ok: false, message: 'Overlapping rows for the same defender, attacker, and period are not allowed.' };

    return {
      ok: true,
      payload: {
        defender_player_id: defender.id,
        defender_team_side: defender.team_side,
        attacker_player_id: attacker.id,
        attacker_team_side: attacker.team_side,
        period_key: row.periodKey,
        start_time_s: startTimeS,
        end_time_s: endTimeS,
      },
    };
  };

  const saveRow = async (row) => {
    const validation = validateRow(row);
    if (!validation.ok) {
      setErrorByKey((current) => ({ ...current, [row.key]: validation.message }));
      return;
    }
    setBusyKey(row.key);
    try {
      if (row.id) {
        await onUpdateMatchupStint?.(row.id, validation.payload);
      } else {
        await onCreateMatchupStint?.(validation.payload);
      }
      setErrorByKey((current) => ({ ...current, [row.key]: '' }));
    } finally {
      setBusyKey('');
    }
  };

  const deleteRow = async (row) => {
    if (!row.id) {
      setDraftRows((current) => current.filter((entry) => entry.key !== row.key));
      return;
    }
    setBusyKey(row.key);
    try {
      await onDeleteMatchupStint?.(row.id);
    } finally {
      setBusyKey('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Assign Matchups</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-600">
              {defaultDefenderKey
                ? 'Focused on one defender with suggested opposition matchups and draggable stint windows.'
                : 'Assign defender-vs-attacker stints using period clocks and the matchup range bar.'}
            </div>
            <Button type="button" size="sm" onClick={addRow} className="gap-2">
              <Plus className="h-4 w-4" />
              Add Matchup
            </Button>
          </div>

          <div className="max-h-[68vh] space-y-3 overflow-y-auto pr-1">
            {draftRows.length ? draftRows.map((row) => {
              const defender = playerById.get(String(row.defenderPlayerId || '')) || null;
              const attackerCandidates = defender?.team_side
                ? sortedPlayerOptions.filter((player) => player.team_side && player.team_side !== defender.team_side)
                : sortedPlayerOptions;
              const periodLimitS = getPeriodLimitSeconds(match, row.periodKey, periodMaxSecondsByKey);
              const startLabel = formatHalfClock(row.startTimeS, row.periodKey, match);
              const endLabel = formatHalfClock(row.endTimeS, row.periodKey, match);
              const durationLabel = formatHalfClock(Math.max(0, row.endTimeS - row.startTimeS), 'first', { code: 'GAA', level: 'Other' });
              const error = errorByKey[row.key] || '';
              const saving = busyKey === row.key;

              return (
                <div key={row.key} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="grid gap-3 lg:grid-cols-[1.2fr_1.2fr_0.7fr_auto] lg:items-center">
                    <Select value={String(row.defenderPlayerId || '')} onValueChange={(value) => updateRow(row.key, { defenderPlayerId: value })}>
                      <SelectTrigger className="h-10 rounded-xl bg-white" aria-label="Select defender">
                        <SelectValue placeholder="Choose defender" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>Players</SelectLabel>
                          {sortedPlayerOptions.map((player) => (
                            <SelectItem key={player.id} value={String(player.id)}>
                              {formatPlayerLabel(player, teamNameBySide)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>

                    <Select value={String(row.attackerPlayerId || '')} onValueChange={(value) => updateRow(row.key, { attackerPlayerId: value })}>
                      <SelectTrigger className="h-10 rounded-xl bg-white" aria-label="Select attacker">
                        <SelectValue placeholder="Choose attacker" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>Opposition</SelectLabel>
                          {attackerCandidates.map((player) => (
                            <SelectItem key={player.id} value={String(player.id)}>
                              {formatPlayerLabel(player, teamNameBySide)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>

                    <Select value={row.periodKey} onValueChange={(value) => updateRow(row.key, { periodKey: value })}>
                      <SelectTrigger className="h-10 rounded-xl bg-white" aria-label="Select period">
                        <SelectValue placeholder="Period" />
                      </SelectTrigger>
                      <SelectContent>
                        {PERIOD_OPTIONS.filter((option) => getPeriodLimitSeconds(match, option.value, periodMaxSecondsByKey) > 0).map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <div className="flex items-center justify-end gap-2">
                      <Button type="button" size="sm" variant="outline" className="h-9 rounded-xl px-3" onClick={() => saveRow(row)} disabled={saving}>
                        <Save className="h-4 w-4" />
                      </Button>
                      <Button type="button" size="sm" variant="outline" className="h-9 rounded-xl px-3 text-red-600" onClick={() => deleteRow(row)} disabled={saving}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-slate-700">
                      <span>{startLabel}</span>
                      <span>{endLabel}</span>
                    </div>
                    <Slider
                      min={0}
                      max={Math.max(1, periodLimitS)}
                      step={1}
                      value={[row.startTimeS, row.endTimeS]}
                      onValueChange={(range) => updateRow(row.key, { range })}
                      className="px-0"
                    />
                    <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-slate-500">
                      <span>0</span>
                      <span>{PERIOD_OPTIONS.find((option) => option.value === row.periodKey)?.label || row.periodKey}</span>
                      <span>{formatHalfClock(periodLimitS, row.periodKey, match)}</span>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="inline-flex items-center gap-2 text-sm text-slate-600">
                      <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">{durationLabel}</span>
                      <span className={`${error ? 'text-red-600' : 'text-slate-500'}`}>
                        {error || (row.source === 'default' ? 'Default' : row.id ? 'Saved' : 'Draft')}
                      </span>
                    </div>
                  </div>
                </div>
              );
            }) : (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
                No matchup stints yet.
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
