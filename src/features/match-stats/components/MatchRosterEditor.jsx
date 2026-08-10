const db = globalThis.__B44_DB__ || {
  entities: new Proxy({}, { get: () => ({ update: async () => ({}) }) }),
};

import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { buildMatchRosterSnapshotPatch } from '@/lib/matchRosterSnapshots';
import { collectPlayerIds, safeParseJSON } from '@/features/report/shared';

const POSITIONS = [
  'Goalkeeper',
  'Corner Back',
  'Full Back',
  'Wing Back',
  'Centre Back',
  'Midfielder',
  'Wing Forward',
  'Centre Forward',
  'Corner Forward',
  'Full Forward',
  'Substitute',
];

function parseIdList(value) {
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function createDraftRows(players = [], starterIds = []) {
  const starterSet = new Set(Array.isArray(starterIds) ? starterIds : []);
  return (Array.isArray(players) ? players : []).map((player) => ({
    id: player?.id || '',
    team_id: player?.team_id || null,
    name: player?.name || '',
    number: player?.number ?? '',
    position: player?.position || '',
    squadRole: starterSet.has(player?.id) ? 'starter' : 'sub',
  }));
}

function makeMatchRosterId(matchId, teamSide) {
  const timePart = Date.now();
  const randPart = Math.random().toString(36).slice(2, 8);
  return `match-roster:${matchId || 'match'}:${teamSide}:${timePart}:${randPart}`;
}

function normalizeRows(rows = [], teamId = null) {
  return rows
    .map((row, index) => ({
      id: row?.id || `${teamId || 'team'}:${index}`,
      team_id: row?.team_id || teamId || null,
      name: String(row?.name || '').trim(),
      number: row?.number === '' ? null : (Number.isFinite(Number(row?.number)) ? Number(row.number) : null),
      position: String(row?.position || '').trim(),
      squadRole: row?.squadRole === 'starter' ? 'starter' : 'sub',
    }))
    .filter((row) => row.name || row.number != null);
}

function buildOnFieldIds(match, side, nextStarterIds = [], rosterIds = [], hasSubstitutions = false) {
  const currentOnFieldIds = parseIdList(side === 'home' ? match?.home_on_field : match?.away_on_field);
  const rosterSet = new Set(rosterIds);
  if (!hasSubstitutions) return nextStarterIds.slice(0, 15);

  const preserved = currentOnFieldIds.filter((id) => rosterSet.has(id));
  const seen = new Set(preserved);
  for (const starterId of nextStarterIds) {
    if (preserved.length >= 15) break;
    if (seen.has(starterId)) continue;
    preserved.push(starterId);
    seen.add(starterId);
  }
  return preserved.slice(0, 15);
}

function TeamRosterEditor({
  title,
  rows,
  usedPlayerIds,
  onChange,
  onAddPlayer,
}) {
  const startersCount = rows.filter((row) => row.squadRole === 'starter').length;

  const updateRow = (rowId, patch) => {
    onChange(rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  };

  const removeRow = (rowId) => {
    if (usedPlayerIds.has(rowId)) {
      toast.error('This player already has logged actions in the match and cannot be removed.');
      return;
    }
    onChange(rows.filter((row) => row.id !== rowId));
  };

  return (
    <Card className="report-pane">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-slate-900">{title}</div>
            <div className="text-xs text-slate-500">{startersCount} starters, {Math.max(0, rows.length - startersCount)} subs</div>
          </div>
          <Button type="button" size="sm" variant="outline" className="gap-2" onClick={onAddPlayer}>
            <Plus className="h-4 w-4" /> Add Player
          </Button>
        </div>

        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="grid gap-3 lg:grid-cols-[88px_minmax(0,1fr)_170px_120px_44px]">
                <div className="space-y-1">
                  <Label className="text-xs text-slate-600">Number</Label>
                  <Input
                    value={row.number ?? ''}
                    inputMode="numeric"
                    onChange={(event) => updateRow(row.id, { number: event.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-600">Name</Label>
                  <Input
                    value={row.name}
                    onChange={(event) => updateRow(row.id, { name: event.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-600">Position</Label>
                  <Select value={row.position || 'unassigned'} onValueChange={(value) => updateRow(row.id, { position: value === 'unassigned' ? '' : value })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {POSITIONS.map((position) => (
                        <SelectItem key={position} value={position}>{position}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-600">Squad</Label>
                  <Select value={row.squadRole} onValueChange={(value) => updateRow(row.id, { squadRole: value === 'starter' ? 'starter' : 'sub' })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="starter">Starter</SelectItem>
                      <SelectItem value="sub">Sub</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-600">Remove</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="border-slate-200"
                    onClick={() => removeRow(row.id)}
                    disabled={usedPlayerIds.has(row.id)}
                    title={usedPlayerIds.has(row.id) ? 'Player already used in logged actions' : 'Remove player from this match roster'}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}

          {!rows.length ? (
            <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
              No players in this match roster yet.
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export default function MatchRosterEditor({
  match,
  homeTeam,
  awayTeam,
  homePlayers = [],
  awayPlayers = [],
  stats = [],
}) {
  const queryClient = useQueryClient();
  const [homeDraft, setHomeDraft] = useState([]);
  const [awayDraft, setAwayDraft] = useState([]);

  useEffect(() => {
    setHomeDraft(createDraftRows(homePlayers, parseIdList(match?.home_starters)));
  }, [homePlayers, match?.home_starters]);

  useEffect(() => {
    setAwayDraft(createDraftRows(awayPlayers, parseIdList(match?.away_starters)));
  }, [awayPlayers, match?.away_starters]);

  const usedPlayerIds = useMemo(() => {
    const ids = new Set();
    for (const stat of Array.isArray(stats) ? stats : []) {
      const extra = safeParseJSON(stat?.extra_data || '{}', {});
      for (const id of collectPlayerIds(extra)) ids.add(String(id));
    }
    return ids;
  }, [stats]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const nextHomeRows = normalizeRows(homeDraft, homeTeam?.id || match?.home_team_id || null);
      const nextAwayRows = normalizeRows(awayDraft, awayTeam?.id || match?.away_team_id || null);
      const nextHomeStarters = nextHomeRows.filter((row) => row.squadRole === 'starter').map((row) => row.id).slice(0, 15);
      const nextAwayStarters = nextAwayRows.filter((row) => row.squadRole === 'starter').map((row) => row.id).slice(0, 15);
      const nextHomeSubs = nextHomeRows.filter((row) => !nextHomeStarters.includes(row.id)).map((row) => row.id);
      const nextAwaySubs = nextAwayRows.filter((row) => !nextAwayStarters.includes(row.id)).map((row) => row.id);
      const hasSubstitutions = (Array.isArray(stats) ? stats : []).some((stat) => String(stat?.stat_type || '') === 'substitution');
      const patch = {
        home_starters: JSON.stringify(nextHomeStarters),
        away_starters: JSON.stringify(nextAwayStarters),
        home_subs: JSON.stringify(nextHomeSubs),
        away_subs: JSON.stringify(nextAwaySubs),
        home_on_field: JSON.stringify(buildOnFieldIds(match, 'home', nextHomeStarters, nextHomeRows.map((row) => row.id), hasSubstitutions)),
        away_on_field: JSON.stringify(buildOnFieldIds(match, 'away', nextAwayStarters, nextAwayRows.map((row) => row.id), hasSubstitutions)),
        ...buildMatchRosterSnapshotPatch({
          homeTeam,
          awayTeam,
          homePlayers: nextHomeRows.map((row) => ({
            id: row.id,
            team_id: row.team_id || homeTeam?.id || match?.home_team_id || null,
            name: row.name,
            number: row.number,
            position: row.position,
          })),
          awayPlayers: nextAwayRows.map((row) => ({
            id: row.id,
            team_id: row.team_id || awayTeam?.id || match?.away_team_id || null,
            name: row.name,
            number: row.number,
            position: row.position,
          })),
        }),
      };
      await db.entities.Match.update(match.id, patch);
      return patch;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['match', match?.id] });
      toast.success('Match roster updated');
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to update match roster');
    },
  });

  if (!match?.id) return null;

  return (
    <div className="space-y-4 pb-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 shadow-sm">
        <div>
          <div className="text-lg font-semibold text-slate-900">Match Rosters</div>
          <div className="text-sm text-slate-500">
            Edit this match roster only. Team colors stay live, but player lists and locked team names are preserved on the match.
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="button" className="gap-2" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            <Save className="h-4 w-4" /> Save Match Roster
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <TeamRosterEditor
          title={homeTeam?.name || 'Home'}
          rows={homeDraft}
          usedPlayerIds={usedPlayerIds}
          onChange={setHomeDraft}
          onAddPlayer={() => setHomeDraft((current) => ([
            ...current,
            {
              id: makeMatchRosterId(match?.id, 'home'),
              team_id: homeTeam?.id || match?.home_team_id || null,
              name: '',
              number: '',
              position: '',
              squadRole: 'sub',
            },
          ]))}
        />
        <TeamRosterEditor
          title={awayTeam?.name || 'Away'}
          rows={awayDraft}
          usedPlayerIds={usedPlayerIds}
          onChange={setAwayDraft}
          onAddPlayer={() => setAwayDraft((current) => ([
            ...current,
            {
              id: makeMatchRosterId(match?.id, 'away'),
              team_id: awayTeam?.id || match?.away_team_id || null,
              name: '',
              number: '',
              position: '',
              squadRole: 'sub',
            },
          ]))}
        />
      </div>
    </div>
  );
}
