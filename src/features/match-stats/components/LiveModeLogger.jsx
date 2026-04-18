import React from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

const NONE = 'none';
const TEAM_HOME = 'team:home';
const TEAM_AWAY = 'team:away';

function toTitleCase(s) {
  return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatMMSS(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

const ACTIONS = [
  { value: 'shot', label: 'Shot' },
  { value: 'kickout', label: 'Kickout' },
  { value: 'turnover', label: 'TO' },
  { value: 'foul', label: 'Foul' },
  { value: 'throw_in', label: 'Throw In' },
];

const FOUL_TYPES = [
  'push',
  'pull',
  'throw',
  'bodycheck',
  'tackle',
  'high_tackle',
  'overcarry',
  'pick_off_ground',
  'double_bounce',
  'strike',
  'dissent',
  'breach',
  'advancement',
  'technical',
  'charge',
  'footblock',
];

function Field({ label, children }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</Label>
      {children}
    </div>
  );
}

function ToggleRow({ label, checked, onCheckedChange }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
      <Label>{label}</Label>
      <Switch checked={!!checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function PlayerSelect({ value, onChange, players, includeTeams = true, placeholder = 'Select...' }) {
  return (
    <Select value={value || NONE} onValueChange={onChange}>
      <SelectTrigger className="h-9 text-xs"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent className="max-h-80">
        <SelectItem value={NONE}>None</SelectItem>
        {includeTeams && (
          <>
            <SelectItem value={TEAM_HOME}>Home Team</SelectItem>
            <SelectItem value={TEAM_AWAY}>Away Team</SelectItem>
          </>
        )}
        {(players || []).map((p) => (
          <SelectItem key={p.id} value={`player:${p.id}`}>
            #{p.number ?? ''} {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ChoiceButtons({ value, onChange, options }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {options.map((opt) => (
        <Button
          key={opt.value}
          type="button"
          variant={value === opt.value ? 'default' : 'outline'}
          size="sm"
          className="h-8 text-xs"
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}

export function createDefaultLiveDraft(homeSide = 'home') {
  return {
    action: 'shot',
    teamSide: homeSide,
    shotPlayer: NONE,
    shotType: 'point',
    shotOutcome: 'point',
    shotResult: '',
    shotMethod: 'right',
    shotPressure: 'low',
    shotBlockedBy: NONE,
    shotSavedBy: NONE,
    shotBroughtBackAdv: false,
    kickoutTeam: homeSide,
    kickoutOutcome: 'clean',
    kickoutWonBy: NONE,
    kickoutLostBy: NONE,
    kickoutPress: 'm2m',
    turnoverWonBy: NONE,
    turnoverLostBy: NONE,
    turnoverType: 'forced',
    turnoverBroughtBackAdv: false,
    foulBy: NONE,
    foulOn: NONE,
    foulType: 'pull',
    card: 'none',
    throwOutcome: 'clean',
    throwWonBy: NONE,
    throwLostBy: NONE,
  };
}

export default function LiveModeLogger({
  draft,
  onDraftChange,
  clockSeconds,
  running,
  onToggleClock,
  onResetClock,
  half,
  getDirForHalf,
  homeTeamName,
  awayTeamName,
  homePlayers,
  awayPlayers,
  liveModeSettings,
  onLogSubstitution,
  onEndHalf,
  onUndo,
  statsCount,
  selectedCoords = null,
  onSubmit = null,
  onCancel = null,
  showUtilityActions = true,
}) {
  const players = React.useMemo(() => [...(homePlayers || []), ...(awayPlayers || [])], [homePlayers, awayPlayers]);
  const settings = liveModeSettings || {};
  const update = (patch) => onDraftChange({ ...(draft || createDefaultLiveDraft()), ...patch });
  const action = draft?.action || 'shot';
  const homeDir = getDirForHalf?.(half) === 'left' ? 'Left' : 'Right';

  return (
    <Card className="border-slate-200">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">Live Logger</div>
            <div className="text-xs text-slate-500">
              {toTitleCase(half)} | Home attacking {homeDir}
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-2xl font-bold text-slate-900">{formatMMSS(clockSeconds)}</div>
            <div className="text-xs text-slate-500">Match clock</div>
          </div>
        </div>

        {showUtilityActions && (
          <div className="grid grid-cols-3 gap-2">
            <Button type="button" variant={running ? 'secondary' : 'default'} onClick={onToggleClock} className="gap-2">
              {running ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {running ? 'Pause' : 'Start'}
            </Button>
            <Button type="button" variant="outline" onClick={onResetClock} className="gap-2">
              <RotateCcw className="w-4 h-4" />
              Reset
            </Button>
            <Button type="button" variant="outline" onClick={onUndo} disabled={!statsCount}>
              Undo
            </Button>
          </div>
        )}

        <Field label="Action">
          <ChoiceButtons
            value={action}
            onChange={(v) => update({ action: v })}
            options={ACTIONS}
          />
        </Field>

        {action === 'shot' && (
          <div className="space-y-3">
            <Field label="Player"><PlayerSelect value={draft.shotPlayer} onChange={(v) => update({ shotPlayer: v })} players={players} includeTeams={false} /></Field>
            <Field label="Shot Type">
              <ChoiceButtons value={draft.shotType} onChange={(v) => update({ shotType: v })} options={[{ value: 'point', label: '1 Pt' }, { value: '2_point', label: '2 Pt' }, { value: 'goal', label: 'Goal' }]} />
            </Field>
            <Field label="Outcome">
              <Select value={draft.shotOutcome} onValueChange={(v) => update({ shotOutcome: v })}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{['point', '2_point', 'goal', 'wide', 'short', 'post', 'saved', 'blocked'].map((v) => <SelectItem key={v} value={v}>{toTitleCase(v)}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            {['short', 'post', 'saved', 'blocked'].includes(draft.shotOutcome) && (
              <Field label="Result">
                <ChoiceButtons value={draft.shotResult} onChange={(v) => update({ shotResult: v })} options={[{ value: 'retained', label: 'Retained' }, { value: 'opposition', label: 'Opposition' }, { value: '45', label: '45' }, { value: 'wide', label: 'Wide' }]} />
              </Field>
            )}
            {settings.showShotMethod !== false && <Field label="Method"><ChoiceButtons value={draft.shotMethod} onChange={(v) => update({ shotMethod: v })} options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }, { value: 'hand', label: 'Hand' }]} /></Field>}
            {settings.showShotPressure !== false && <Field label="Pressure"><ChoiceButtons value={draft.shotPressure} onChange={(v) => update({ shotPressure: v })} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Med' }, { value: 'high', label: 'High' }]} /></Field>}
            {settings.showShotBlockedSavedBy !== false && draft.shotOutcome === 'blocked' && <Field label="Blocked By"><PlayerSelect value={draft.shotBlockedBy} onChange={(v) => update({ shotBlockedBy: v })} players={players} /></Field>}
            {settings.showShotBlockedSavedBy !== false && draft.shotOutcome === 'saved' && <Field label="Saved By"><PlayerSelect value={draft.shotSavedBy} onChange={(v) => update({ shotSavedBy: v })} players={players} /></Field>}
            {settings.showShotBroughtBackAdv !== false && <ToggleRow label="Brought Back - Adv." checked={draft.shotBroughtBackAdv} onCheckedChange={(v) => update({ shotBroughtBackAdv: v })} />}
          </div>
        )}

        {action === 'kickout' && (
          <div className="space-y-3">
            <Field label="Kickout Team"><ChoiceButtons value={draft.kickoutTeam} onChange={(v) => update({ kickoutTeam: v })} options={[{ value: 'home', label: homeTeamName || 'Home' }, { value: 'away', label: awayTeamName || 'Away' }]} /></Field>
            <Field label="Outcome">
              <Select value={draft.kickoutOutcome} onValueChange={(v) => update({ kickoutOutcome: v })}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{['clean', 'break', 'foul', 'sideline_for', 'sideline_against'].map((v) => <SelectItem key={v} value={v}>{toTitleCase(v)}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Won By"><PlayerSelect value={draft.kickoutWonBy} onChange={(v) => update({ kickoutWonBy: v })} players={players} /></Field>
            {settings.showKickoutLostBy !== false && <Field label="Lost By"><PlayerSelect value={draft.kickoutLostBy} onChange={(v) => update({ kickoutLostBy: v })} players={players} /></Field>}
            {settings.showKickoutPress !== false && <Field label="Press"><ChoiceButtons value={draft.kickoutPress} onChange={(v) => update({ kickoutPress: v })} options={[{ value: 'm2m', label: 'M2M' }, { value: 'zonal', label: 'Zonal' }, { value: 'conceded', label: 'Conceded' }]} /></Field>}
            {draft.kickoutOutcome === 'foul' && <FoulFields draft={draft} update={update} players={players} showCard={settings.showFoulCard !== false} />}
          </div>
        )}

        {action === 'turnover' && (
          <div className="space-y-3">
            {settings.showTurnoverType !== false && (
              <Field label="Type">
                <Select value={draft.turnoverType} onValueChange={(v) => update({ turnoverType: v })}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{['forced', 'unforced', 'interception', 'foul', 'breach'].map((v) => <SelectItem key={v} value={v}>{toTitleCase(v)}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            )}
            {draft.turnoverType === 'foul' ? (
              <FoulFields draft={draft} update={update} players={players} showCard={settings.showFoulCard !== false} />
            ) : (
              <>
                <Field label="Won By"><PlayerSelect value={draft.turnoverWonBy} onChange={(v) => update({ turnoverWonBy: v })} players={players} /></Field>
                <Field label="Lost By"><PlayerSelect value={draft.turnoverLostBy} onChange={(v) => update({ turnoverLostBy: v })} players={players} /></Field>
              </>
            )}
            {settings.showTurnoverBroughtBackAdv !== false && <ToggleRow label="Brought Back - Adv." checked={draft.turnoverBroughtBackAdv} onCheckedChange={(v) => update({ turnoverBroughtBackAdv: v })} />}
          </div>
        )}

        {action === 'foul' && <FoulFields draft={draft} update={update} players={players} showCard={settings.showFoulCard !== false} />}

        {action === 'throw_in' && (
          <div className="space-y-3">
            <Field label="Outcome">
              <Select value={draft.throwOutcome} onValueChange={(v) => update({ throwOutcome: v })}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{['clean', 'break', 'foul', 'sideline_for', 'sideline_against'].map((v) => <SelectItem key={v} value={v}>{toTitleCase(v)}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Won By"><PlayerSelect value={draft.throwWonBy} onChange={(v) => update({ throwWonBy: v })} players={players} /></Field>
            {settings.showThrowInLostBy !== false && <Field label="Lost By"><PlayerSelect value={draft.throwLostBy} onChange={(v) => update({ throwLostBy: v })} players={players} /></Field>}
            {draft.throwOutcome === 'foul' && <FoulFields draft={draft} update={update} players={players} showCard={settings.showFoulCard !== false} />}
          </div>
        )}

        {showUtilityActions && (
          <div className="grid grid-cols-2 gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={onLogSubstitution}>Substitution</Button>
            <Button type="button" variant="outline" onClick={onEndHalf}>End Half</Button>
          </div>
        )}

        {selectedCoords ? (
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600">
            Location selected: x={Number(selectedCoords.x).toFixed(1)}, y={Number(selectedCoords.y).toFixed(1)}
          </div>
        ) : (
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600">
            Select the action and fields, then click the pitch location to log it.
          </div>
        )}

        {onSubmit && (
          <div className="grid grid-cols-2 gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
            <Button type="button" className="bg-green-600 hover:bg-green-700" onClick={onSubmit}>Log Stat</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FoulFields({ draft, update, players, showCard }) {
  return (
    <div className="space-y-3">
      <Field label="Foul By"><PlayerSelect value={draft.foulBy} onChange={(v) => update({ foulBy: v })} players={players} /></Field>
      <Field label="Foul On"><PlayerSelect value={draft.foulOn} onChange={(v) => update({ foulOn: v })} players={players} /></Field>
      <Field label="Foul Type">
        <Select value={draft.foulType} onValueChange={(v) => update({ foulType: v })}>
          <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-80">{FOUL_TYPES.map((v) => <SelectItem key={v} value={v}>{toTitleCase(v)}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      {showCard && (
        <Field label="Card">
          <ChoiceButtons value={draft.card} onChange={(v) => update({ card: v })} options={[{ value: 'none', label: 'NA' }, { value: 'yellow', label: 'Yellow' }, { value: 'black', label: 'Black' }, { value: 'red', label: 'Red' }]} />
        </Field>
      )}
    </div>
  );
}

export { NONE, TEAM_HOME, TEAM_AWAY, formatMMSS };
