import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const NONE = 'none';
const TEAM_HOME = 'team:home';
const TEAM_AWAY = 'team:away';

function toTitleCase(s) {
  return String(s || '')
    .replace(/_/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function selectionToValue(sel) {
  if (!sel) return NONE;
  if (sel.kind === 'none') return NONE;
  if (sel.kind === 'team') return `team:${sel.team_side}`;
  if (sel.kind === 'player') return `player:${sel.id}`;
  return NONE;
}

function makeSelection(value, { homePlayers, awayPlayers }) {
  if (!value || value === NONE) return { kind: 'none' };
  if (value.startsWith('team:')) {
    const team_side = value.split(':')[1] || 'unknown';
    return { kind: 'team', team_side };
  }
  if (value.startsWith('player:')) {
    const id = value.slice('player:'.length);
    const p = [...homePlayers, ...awayPlayers].find((x) => x.id === id);
    if (!p) return { kind: 'none' };
    const team_side = homePlayers.some((x) => x.id === id) ? 'home' : 'away';
    return { kind: 'player', id: p.id, number: p.number ?? null, name: p.name ?? '', team_side };
  }
  return { kind: 'none' };
}

function formatSelectionValue(value, { homePlayers, awayPlayers }) {
  if (!value || value === NONE) return 'None';
  if (value === TEAM_HOME) return 'Home Team';
  if (value === TEAM_AWAY) return 'Away Team';
  if (value.startsWith('player:')) {
    const id = value.slice('player:'.length);
    const p = [...homePlayers, ...awayPlayers].find((x) => x.id === id);
    if (!p) return 'Player';
    return `#${p.number ?? ''} ${p.name || ''}`.trim();
  }
  return String(value);
}

function RoleButton({ label, valueText, active, onClick, disabled = false }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        'w-full text-left rounded-lg border px-3 py-2 transition-colors',
        disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50',
        active ? 'border-slate-900 ring-2 ring-slate-900/10 bg-slate-50' : 'border-slate-200 bg-white',
      ].join(' ')}
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-900 truncate">{valueText}</div>
    </button>
  );
}

function RosterPanel({
  title,
  side,
  color,
  players,
  onFieldIds,
  disabled = false,
  disabledReason = '',
  canPickSide,
  onPickValue,
}) {
  const set = useMemo(() => new Set(onFieldIds || []), [onFieldIds]);
  const byId = useMemo(() => new Map((players || []).map((p) => [p.id, p])), [players]);
  // Keep on-field order stable using the onFieldIds array (match lineup order).
  const onField = useMemo(
    () => (onFieldIds || []).map((id) => byId.get(id)).filter(Boolean),
    [onFieldIds, byId]
  );
  const bench = useMemo(() => (players || []).filter((p) => !set.has(p.id)), [players, set]);

  const tint = (() => {
    // best-effort tint: append alpha to hex if possible
    const c = String(color || '').trim();
    if (/^#([0-9a-f]{6})$/i.test(c)) return `${c}14`; // ~8% alpha
    return 'rgba(15, 23, 42, 0.04)';
  })();

  const Row = ({ children, onClick, isDisabled }) => (
    <button
      type="button"
      disabled={isDisabled || disabled}
      onClick={onClick}
      className={[
        'w-full text-left px-3 py-2 rounded-md border text-sm transition-colors',
        isDisabled || disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-white/70',
        'border-slate-200 bg-white/30',
      ].join(' ')}
    >
      {children}
    </button>
  );

  const disallowOtherTeamRow = (rowSide) => (canPickSide && rowSide && canPickSide !== rowSide);

  return (
    <div className="h-full flex flex-col rounded-xl border border-slate-200 overflow-hidden bg-white">
      <div className="px-3 py-2 border-b" style={{ background: tint }}>
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold text-slate-900 text-sm">{title}</div>
          <div className="h-2 w-10 rounded-full" style={{ backgroundColor: color || (side === 'home' ? '#22c55e' : '#ef4444') }} />
        </div>
        {disabledReason && (
          <div className="text-xs text-slate-600 mt-1">{disabledReason}</div>
        )}
      </div>

      <div className="p-3 space-y-2 overflow-y-auto">
        <Row onClick={() => onPickValue(NONE)} isDisabled={false}>None</Row>
        <Row onClick={() => onPickValue(TEAM_HOME)} isDisabled={disallowOtherTeamRow('home')}>Home Team</Row>
        <Row onClick={() => onPickValue(TEAM_AWAY)} isDisabled={disallowOtherTeamRow('away')}>Away Team</Row>

        {onField.length > 0 && (
          <>
            <div className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">On Field</div>
            {onField.map((p) => (
              <Row
                key={p.id}
                onClick={() => onPickValue(`player:${p.id}`)}
                isDisabled={disallowOtherTeamRow(side)}
              >
                {`#${p.number ?? ''} ${p.name || ''}`.trim()}
              </Row>
            ))}
          </>
        )}

        {bench.length > 0 && (
          <>
            <div className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Bench</div>
            {bench.map((p) => (
              <Row
                key={p.id}
                onClick={() => onPickValue(`player:${p.id}`)}
                isDisabled={disallowOtherTeamRow(side)}
              >
                {`#${p.number ?? ''} ${p.name || ''}`.trim()}
              </Row>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function Buttons({ label, value, onChange, options }) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-slate-700">{label}</Label>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {options.map((opt) => (
          <Button
            key={opt.value}
            type="button"
            variant={value === opt.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function YesNo({ label, value, onChange }) {
  return (
    <Buttons
      label={label}
      value={value ? 'yes' : 'no'}
      onChange={(v) => onChange(v === 'yes')}
      options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]}
    />
  );
}

function CustomFieldInput({ label, config, value, onChange }) {
  if (!config?.enabled) return null;
  const opts = Array.isArray(config.options) ? config.options : [];
  const name = String(config.label || label || '').trim() || label;

  const normalized = opts
    .filter((o) => o && typeof o === 'object')
    .map((o) => ({ value: String(o.value || ''), label: String(o.label || o.value || '') }))
    .filter((o) => o.value || o.label);

  if (opts.length > 0 && opts.length <= 4) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm font-medium text-slate-700">{name}</Label>
          {!!value && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')}>
              Clear
            </Button>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {normalized.map((opt) => (
            <Button
              key={opt.value}
              type="button"
              variant={value === opt.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => onChange(opt.value)}
            >
              {opt.label || opt.value}
            </Button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-slate-700">{name}</Label>
      <Select value={value || ''} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Select..." />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          <SelectItem value="">None</SelectItem>
          {normalized.map((o) => (
            <SelectItem key={`${name}-${o.value}-${o.label}`} value={o.value}>
              {o.label || o.value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const FOUL_TYPES = [
  { value: 'push', label: 'Push' },
  { value: 'pull', label: 'Pull' },
  { value: 'tackle', label: 'Tackle' },
  { value: 'high_tackle', label: 'High Tackle' },
  { value: 'overcarry', label: 'Overcarry' },
  { value: 'pick_off_ground', label: 'Pick Off Ground' },
  { value: 'double_bounce', label: 'Double Bounce' },
  { value: 'strike', label: 'Strike' },
  { value: 'dissent', label: 'Dissent' },
  { value: 'breach', label: 'Breach' },
  { value: 'advancement', label: 'Advancement' },
  { value: 'technical', label: 'Technical' },
  { value: 'charge', label: 'Charge' },
  { value: 'footblock', label: 'Footblock' },
];

const CARD_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'yellow', label: 'Yellow' },
  { value: 'black', label: 'Black' },
  { value: 'red', label: 'Red' },
];

export default function StatModalV4({
  open,
  onClose,
  isDrag,
  startCoords,
  endCoords,
  homePlayers,
  awayPlayers,
  homeRoster,
  awayRoster,
  homeOnFieldIds,
  awayOnFieldIds,
  homeTeamColor,
  awayTeamColor,
  defaultReceiver, // selection object
  initialStat, // full stat row for edit mode (optional)
  customFields, // { custom_1..custom_3: { enabled, label, options[] } }
  onSubmit,
}) {
  const [action, setAction] = useState(isDrag ? 'pass' : 'shot');
  const [counterAttack, setCounterAttack] = useState(false);
  const [activeRole, setActiveRole] = useState(null);

  // Custom field selections store option.value (string). Empty string => unset.
  const [custom1, setCustom1] = useState('');
  const [custom2, setCustom2] = useState('');
  const [custom3, setCustom3] = useState('');

  // Common: primary acting team side (for kickout we select explicitly; otherwise inferred from primary player).
  const [teamSide, setTeamSide] = useState('home');

  // Core player selections (stored as select values; converted to selection objects at submit time)
  const [primaryPlayer, setPrimaryPlayer] = useState(NONE);

  // Foul
  const [foulBy, setFoulBy] = useState(NONE);
  const [foulOn, setFoulOn] = useState(NONE);
  const [foulType, setFoulType] = useState('');
  const [card, setCard] = useState('none');

  // Turnover
  const [turnoverType, setTurnoverType] = useState('');
  const [lostBy, setLostBy] = useState(NONE);
  const [forcedBy, setForcedBy] = useState(NONE);
  const [recoveredBy, setRecoveredBy] = useState(NONE);
  const [unforced, setUnforced] = useState(false);

  // Throw in
  const [throwOutcome, setThrowOutcome] = useState('');
  const [wonBy, setWonBy] = useState(NONE);
  const [throwLostBy, setThrowLostBy] = useState(NONE);
  const [brokenBy, setBrokenBy] = useState(NONE);

  // Kickout
  const [kickoutTeam, setKickoutTeam] = useState('home');
  const [kickoutOutcome, setKickoutOutcome] = useState('');
  const [intendedRecipient, setIntendedRecipient] = useState(NONE);
  const [kickoutWonBy, setKickoutWonBy] = useState(NONE);
  const [kickoutLostBy, setKickoutLostBy] = useState(NONE);
  const [kickoutBrokenBy, setKickoutBrokenBy] = useState(NONE);
  const [kickoutMark, setKickoutMark] = useState(false);

  // Shot
  const [shotType, setShotType] = useState('');
  const [shotSituation, setShotSituation] = useState('');
  const [shotMethod, setShotMethod] = useState('');
  const [shotPressure, setShotPressure] = useState('');
  const [shotOutcome, setShotOutcome] = useState('');
  const [shotResult, setShotResult] = useState('');

  // Defensive contact
  const [defType, setDefType] = useState('');

  // Carry (drag)
  const [carrier, setCarrier] = useState(NONE);
  const [carrierPressure, setCarrierPressure] = useState('');
  const [takeOnAttempted, setTakeOnAttempted] = useState(false);
  const [takeOnCompleted, setTakeOnCompleted] = useState(false);
  const [defender, setDefender] = useState(NONE);
  const [carryOutcome, setCarryOutcome] = useState('');
  const [soloPlusGo, setSoloPlusGo] = useState(false);

  // Pass (drag)
  const [passer, setPasser] = useState(NONE);
  const [passIntendedRecipient, setPassIntendedRecipient] = useState(NONE);
  const [passMethod, setPassMethod] = useState('');
  const [passStyle, setPassStyle] = useState('');
  const [passPressure, setPassPressure] = useState('');
  const [passOutcome, setPassOutcome] = useState('');
  const [passWonBy, setPassWonBy] = useState(NONE);
  const [deadball, setDeadball] = useState(false);

  const safeParse = (s) => {
    try { return JSON.parse(s); } catch { return {}; }
  };

  // Edit mode: seed fields from an existing row.
  useEffect(() => {
    if (!open) return;
    if (!initialStat?.id) return;

    const extra = initialStat?.extra_data ? safeParse(initialStat.extra_data) : {};

    const findPlayerByNumber = (side, number) => {
      const n = Number(number);
      if (!Number.isFinite(n)) return NONE;
      const list = side === 'away' ? awayPlayers : homePlayers;
      const p = (list || []).find((x) => Number(x.number) === n);
      return p ? `player:${p.id}` : NONE;
    };

    const primaryFromStat = (() => {
      const side = initialStat.team_side === 'away' ? 'away' : 'home';
      if (initialStat?.player_number == null) return NONE;
      return findPlayerByNumber(side, initialStat.player_number);
    })();

    setAction(initialStat.stat_type || (isDrag ? 'pass' : 'shot'));
    setCounterAttack(!!initialStat.counter_attack);

    // Reset common fields before re-seeding.
    setPrimaryPlayer(NONE);
    setFoulBy(NONE);
    setFoulOn(NONE);
    setFoulType('');
    setCard('none');
    setTurnoverType('');
    setLostBy(NONE);
    setForcedBy(NONE);
    setRecoveredBy(NONE);
    setUnforced(false);
    setThrowOutcome('');
    setWonBy(NONE);
    setThrowLostBy(NONE);
    setBrokenBy(NONE);
    setKickoutTeam(extra?.kickout?.team_side || initialStat.team_side || 'home');
    setKickoutOutcome('');
    setIntendedRecipient(NONE);
    setKickoutWonBy(NONE);
    setKickoutLostBy(NONE);
    setKickoutBrokenBy(NONE);
    setKickoutMark(false);
    setShotType('');
    setShotSituation('');
    setShotMethod('');
    setShotPressure('');
    setShotOutcome('');
    setShotResult('');
    setDefType('');
    setCarrier(NONE);
    setCarrierPressure('');
    setTakeOnAttempted(false);
    setTakeOnCompleted(false);
    setDefender(NONE);
    setCarryOutcome('');
    setSoloPlusGo(false);
    setPasser(NONE);
    setPassIntendedRecipient(NONE);
    setPassMethod('');
    setPassStyle('');
    setPassPressure('');
    setPassOutcome('');
    setPassWonBy(NONE);
    setDeadball(false);
    setCustom1('');
    setCustom2('');
    setCustom3('');

    // Shared foul section (if present).
    if (extra?.foul) {
      setFoulBy(selectionToValue(extra.foul.foul_by));
      setFoulOn(selectionToValue(extra.foul.foul_on));
      setFoulType(extra.foul.foul_type || '');
      setCard(extra.foul.card || 'none');
    }

    // Custom fields (if present).
    const cf = extra?.custom_fields || {};
    const getCustomValue = (k) => {
      const v = cf?.[k];
      if (!v) return '';
      if (typeof v === 'string') return v;
      return v.value || '';
    };
    setCustom1(getCustomValue('custom_1'));
    setCustom2(getCustomValue('custom_2'));
    setCustom3(getCustomValue('custom_3'));

    setActiveRole(null);

    const type = initialStat.stat_type;
    if (type === 'shot') {
      setPrimaryPlayer(primaryFromStat);
      setShotType(extra?.shot?.shot_type || '');
      setShotSituation(extra?.shot?.situation || '');
      setShotMethod(extra?.shot?.method || '');
      setShotPressure(extra?.shot?.pressure || '');
      setShotOutcome(extra?.shot?.outcome || '');
      setShotResult(extra?.shot?.result || '');
    } else if (type === 'kickout') {
      setKickoutTeam(extra?.kickout?.team_side || initialStat.team_side || 'home');
      setKickoutOutcome(extra?.kickout?.outcome || '');
      setIntendedRecipient(selectionToValue(extra?.kickout?.intended_recipient));
      setKickoutWonBy(selectionToValue(extra?.kickout?.won_by));
      setKickoutLostBy(selectionToValue(extra?.kickout?.lost_by));
      setKickoutBrokenBy(selectionToValue(extra?.kickout?.broken_by));
      setKickoutMark(!!extra?.kickout?.mark);
    } else if (type === 'foul') {
      setPrimaryPlayer(selectionToValue(extra?.foul?.foul_by));
    } else if (type === 'turnover') {
      setTurnoverType(extra?.turnover?.turnover_type || '');
      setLostBy(selectionToValue(extra?.turnover?.lost_by));
      setForcedBy(selectionToValue(extra?.turnover?.forced_by));
      setRecoveredBy(selectionToValue(extra?.turnover?.recovered_by));
      setUnforced(!!extra?.turnover?.unforced);
    } else if (type === 'throw_in') {
      setThrowOutcome(extra?.throw_in?.outcome || '');
      setWonBy(selectionToValue(extra?.throw_in?.won_by));
      setThrowLostBy(selectionToValue(extra?.throw_in?.lost_by));
      setBrokenBy(selectionToValue(extra?.throw_in?.broken_by));
    } else if (type === 'defensive_contact') {
      setPrimaryPlayer(primaryFromStat);
      setDefType(extra?.defensive_contact?.type || '');
    } else if (type === 'carry') {
      setCarrier(selectionToValue(extra?.carry?.carrier));
      setCarrierPressure(extra?.carry?.pressure_on_carrier || '');
      setTakeOnAttempted(!!extra?.carry?.take_on_attempted);
      setTakeOnCompleted(!!extra?.carry?.take_on_completed);
      setDefender(selectionToValue(extra?.carry?.defender));
      setCarryOutcome(extra?.carry?.outcome || '');
      setSoloPlusGo(!!extra?.carry?.solo_plus_go);
    } else if (type === 'pass') {
      setPasser(selectionToValue(extra?.pass?.passer));
      setPassIntendedRecipient(selectionToValue(extra?.pass?.intended_recipient));
      setPassMethod(extra?.pass?.method || '');
      setPassStyle(extra?.pass?.style || '');
      setPassPressure(extra?.pass?.pressure_on_passer || '');
      setPassOutcome(extra?.pass?.outcome || '');
      setPassWonBy(selectionToValue(extra?.pass?.won_by));
      setDeadball(!!extra?.pass?.deadball);
    }
  }, [open, initialStat?.id]);

  // Defaulting to last receiver on open.
  useEffect(() => {
    if (!open) return;
    if (initialStat?.id) return;
    const def = selectionToValue(defaultReceiver);
    if (!isDrag) {
      // Defaults for click-based actors.
      setPrimaryPlayer(def);
      setFoulOn(def);
    } else {
      setPasser(def);
      setCarrier(def);
    }
    setActiveRole(null);
  }, [open]); // intentionally only on open

  // Turnover: recovered_by defaults to forced_by when untouched
  useEffect(() => {
    if (action !== 'turnover') return;
    if (recoveredBy === NONE && forcedBy !== NONE) setRecoveredBy(forcedBy);
  }, [forcedBy, action]);

  const ctx = useMemo(() => ({ homePlayers, awayPlayers }), [homePlayers, awayPlayers]);

  const rosters = useMemo(() => {
    // Prefer explicit rosters (can be ordered), fall back to homePlayers/awayPlayers.
    return {
      home: (homeRoster && Array.isArray(homeRoster)) ? homeRoster : homePlayers,
      away: (awayRoster && Array.isArray(awayRoster)) ? awayRoster : awayPlayers,
    };
  }, [homeRoster, awayRoster, homePlayers, awayPlayers]);

  const formatValue = (v) => formatSelectionValue(v, { homePlayers: rosters.home, awayPlayers: rosters.away });

  const roleDefs = useMemo(() => ({
    player: { label: 'Player', get: () => primaryPlayer, set: setPrimaryPlayer },
    foul_by: { label: 'Foul By', get: () => foulBy, set: setFoulBy },
    foul_on: { label: 'Foul On / Forced By', get: () => foulOn, set: setFoulOn },
    lost_by: { label: 'Lost By', get: () => lostBy, set: setLostBy },
    forced_by: { label: 'Forced By', get: () => forcedBy, set: setForcedBy },
    recovered_by: { label: 'Recovered By', get: () => recoveredBy, set: setRecoveredBy },
    throw_won_by: { label: 'Won By', get: () => wonBy, set: setWonBy },
    throw_lost_by: { label: 'Lost By', get: () => throwLostBy, set: setThrowLostBy },
    broken_by: { label: 'Broken By', get: () => brokenBy, set: setBrokenBy },
    kickout_intended: { label: 'Intended Recipient', get: () => intendedRecipient, set: setIntendedRecipient },
    kickout_won_by: { label: 'Won By', get: () => kickoutWonBy, set: setKickoutWonBy },
    kickout_lost_by: { label: 'Lost By', get: () => kickoutLostBy, set: setKickoutLostBy },
    kickout_broken_by: { label: 'Broken By', get: () => kickoutBrokenBy, set: setKickoutBrokenBy },
    carrier: { label: 'Carrier', get: () => carrier, set: setCarrier },
    defender: { label: 'Defender', get: () => defender, set: setDefender },
    passer: { label: 'Passer', get: () => passer, set: setPasser },
    pass_intended: { label: 'Intended Recipient', get: () => passIntendedRecipient, set: setPassIntendedRecipient },
    pass_won_by: { label: 'Won By', get: () => passWonBy, set: setPassWonBy },
  }), [
    primaryPlayer, foulBy, foulOn, lostBy, forcedBy, recoveredBy,
    wonBy, throwLostBy, brokenBy,
    intendedRecipient, kickoutWonBy, kickoutLostBy, kickoutBrokenBy,
    carrier, defender, passer, passIntendedRecipient, passWonBy,
  ]);

  const getRoleValue = (k) => roleDefs?.[k]?.get?.() ?? NONE;

  const roleOrder = useMemo(() => {
    if (action === 'shot') return ['player'];
    if (action === 'defensive_contact') return ['player'];
    if (action === 'foul') return ['foul_by', 'foul_on'];
    if (action === 'turnover') {
      if (turnoverType === 'foul') return ['foul_by', 'foul_on'];
      return ['lost_by', 'forced_by', 'recovered_by'];
    }
    if (action === 'throw_in') {
      if (throwOutcome === 'clean') return ['throw_won_by', 'throw_lost_by'];
      if (throwOutcome === 'break') return ['broken_by', 'throw_won_by', 'throw_lost_by'];
      if (throwOutcome === 'foul') return ['foul_by', 'foul_on'];
      return [];
    }
    if (action === 'kickout') {
      if (kickoutOutcome === 'clean') return ['kickout_intended', 'kickout_won_by', 'kickout_lost_by'];
      if (kickoutOutcome === 'break') return ['kickout_intended', 'kickout_broken_by', 'kickout_won_by', 'kickout_lost_by'];
      if (kickoutOutcome === 'foul') return ['kickout_intended', 'foul_by', 'foul_on'];
      return ['kickout_intended'];
    }
    if (action === 'pass') {
      const base = ['passer', 'pass_intended', 'pass_won_by'];
      if (passOutcome === 'turnover') return base.concat(turnoverType === 'foul' ? ['foul_by', 'foul_on'] : ['lost_by', 'forced_by', 'recovered_by']);
      if (passOutcome === 'foul') return base.concat(['foul_by', 'foul_on']);
      return base;
    }
    if (action === 'carry') {
      const base = ['carrier'].concat(takeOnAttempted ? ['defender'] : []);
      if (carryOutcome === 'turnover') return base.concat(turnoverType === 'foul' ? ['foul_by', 'foul_on'] : ['lost_by', 'forced_by', 'recovered_by']);
      if (carryOutcome === 'foul') return base.concat(['foul_by', 'foul_on']);
      return base;
    }
    return [];
  }, [
    action,
    turnoverType,
    throwOutcome,
    kickoutOutcome,
    passOutcome,
    carryOutcome,
    takeOnAttempted,
  ]);

  const nextUnfilledRole = (override = {}) => {
    for (const k of roleOrder) {
      const v = Object.prototype.hasOwnProperty.call(override, k) ? override[k] : getRoleValue(k);
      if (!v || v === NONE) return k;
    }
    return null;
  };

  const getRestrictSideForRole = (k) => {
    if (k === 'pass_intended') {
      const side = makeSelection(passer, ctx).team_side;
      return side === 'home' || side === 'away' ? side : null;
    }
    if (k === 'kickout_intended') return kickoutTeam === 'home' || kickoutTeam === 'away' ? kickoutTeam : null;
    return null;
  };

  const assignRole = (roleKey, value) => {
    const def = roleDefs?.[roleKey];
    if (!def?.set) return;
    def.set(value);
    const next = nextUnfilledRole({ [roleKey]: value });
    setActiveRole(next);
  };

  const handlePickValue = (value) => {
    const targetRole = activeRole || nextUnfilledRole();
    if (!targetRole) return;
    const restrict = getRestrictSideForRole(targetRole);
    if (restrict) {
      if (value === TEAM_HOME && restrict !== 'home') return;
      if (value === TEAM_AWAY && restrict !== 'away') return;
      if (value.startsWith('player:')) {
        const side = makeSelection(value, ctx).team_side;
        if (side && side !== restrict) return;
      }
    }
    assignRole(targetRole, value);
  };

  const roleButton = (k, { disabled = false } = {}) => (
    <RoleButton
      label={roleDefs?.[k]?.label || k}
      valueText={formatValue(getRoleValue(k))}
      active={activeRole === k}
      disabled={disabled}
      onClick={() => setActiveRole(k)}
    />
  );

  const pickingForLabel = activeRole ? (roleDefs?.[activeRole]?.label || toTitleCase(activeRole)) : (nextUnfilledRole() ? (roleDefs?.[nextUnfilledRole()]?.label || '') : '');

  const foulPanel = () => (
    <div className="space-y-3 border rounded-lg p-3 bg-slate-50">
      <div className="grid grid-cols-2 gap-2">
        {roleButton('foul_by')}
        {roleButton('foul_on')}
      </div>
      <div className="space-y-2">
        <Label className="text-sm font-medium text-slate-700">Foul Type</Label>
        <Select value={foulType} onValueChange={setFoulType}>
          <SelectTrigger><SelectValue placeholder="Select foul type..." /></SelectTrigger>
          <SelectContent className="max-h-72">
            {FOUL_TYPES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Buttons label="Card" value={card} onChange={setCard} options={CARD_OPTIONS} />
    </div>
  );

  const turnoverPanel = () => (
    <div className="space-y-3 border rounded-lg p-3 bg-slate-50">
      <div className="space-y-2">
        <Label className="text-sm font-medium text-slate-700">Turnover Type</Label>
        <Select value={turnoverType} onValueChange={setTurnoverType}>
          <SelectTrigger><SelectValue placeholder="Select turnover type..." /></SelectTrigger>
          <SelectContent>
            {['foul', 'tackle', 'group_tackle', 'broken', 'interception', 'sidelineagainst'].map((v) => (
              <SelectItem key={v} value={v}>{toTitleCase(v)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {turnoverType === 'foul' ? (
        foulPanel()
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {roleButton('lost_by')}
            {roleButton('forced_by')}
            {roleButton('recovered_by')}
          </div>
          <YesNo label="Unforced" value={unforced} onChange={setUnforced} />
        </>
      )}
    </div>
  );

  const canSubmit = () => {
    if (!startCoords) return false;
    if (isDrag && !endCoords) return false;
    if (!action) return false;
    // Minimal validation per action.
    if (action === 'shot') return shotOutcome && primaryPlayer !== NONE;
    if (action === 'foul') return foulBy !== NONE && foulOn !== NONE && foulType;
    if (action === 'turnover') {
      if (!turnoverType) return false;
      if (turnoverType === 'foul') return foulBy !== NONE && foulOn !== NONE && foulType;
      return lostBy !== NONE && forcedBy !== NONE && recoveredBy !== NONE;
    }
    if (action === 'throw_in') {
      if (!throwOutcome) return false;
      if (throwOutcome === 'foul') return foulBy !== NONE && foulOn !== NONE && foulType;
      if (throwOutcome === 'clean') return wonBy !== NONE && throwLostBy !== NONE;
      if (throwOutcome === 'break') return brokenBy !== NONE && wonBy !== NONE && throwLostBy !== NONE;
      return false;
    }
    if (action === 'kickout') {
      if (!kickoutOutcome) return false;
      if (kickoutOutcome === 'foul') return foulBy !== NONE && foulOn !== NONE && foulType;
      if (kickoutOutcome === 'clean') return kickoutWonBy !== NONE && kickoutLostBy !== NONE;
      if (kickoutOutcome === 'break') return kickoutBrokenBy !== NONE && kickoutWonBy !== NONE && kickoutLostBy !== NONE;
      return true; // sideline outcomes
    }
    if (action === 'defensive_contact') return defType && primaryPlayer !== NONE;
    if (action === 'carry') return carrier !== NONE && carryOutcome;
    if (action === 'pass') return passer !== NONE && passOutcome;
    return false;
  };

  const submit = () => {
    if (!canSubmit()) return;

    const extra = {
      counter_attack: !!counterAttack,
    };

    const normalizedCustomFields = (() => {
      const cfg = customFields && typeof customFields === 'object' ? customFields : {};
      const build = (k, selected) => {
        const f = cfg?.[k];
        if (!f?.enabled) return null;
        const opts = Array.isArray(f.options) ? f.options : [];
        if (!selected) return { value: '', label: '' };
        const match = opts.find((o) => String(o.value) === String(selected));
        return { value: String(selected), label: String(match?.label || selected) };
      };
      const out = {};
      const c1 = build('custom_1', custom1);
      const c2 = build('custom_2', custom2);
      const c3 = build('custom_3', custom3);
      if (c1) out.custom_1 = c1;
      if (c2) out.custom_2 = c2;
      if (c3) out.custom_3 = c3;
      // Only include the object when at least one field is enabled.
      return Object.keys(out).length ? out : null;
    })();

    if (normalizedCustomFields) {
      extra.custom_fields = normalizedCustomFields;
    }

    // Helper to put structured selections in extra_data
    const sel = (v) => makeSelection(v, ctx);

    let actingSide = teamSide;
    let primary = sel(primaryPlayer);

    if (action === 'kickout') {
      actingSide = kickoutTeam;
      primary = { kind: 'team', team_side: kickoutTeam };
      extra.kickout = {
        team_side: kickoutTeam,
        intended_recipient: sel(intendedRecipient),
        outcome: kickoutOutcome,
        won_by: sel(kickoutWonBy),
        lost_by: sel(kickoutLostBy),
        broken_by: sel(kickoutBrokenBy),
        mark: !!kickoutMark,
      };
      if (kickoutOutcome === 'foul') {
        extra.foul = { foul_by: sel(foulBy), foul_on: sel(foulOn), foul_type: foulType, card };
      }
    } else if (action === 'foul') {
      actingSide = makeSelection(foulBy, ctx).team_side || 'unknown';
      primary = makeSelection(foulBy, ctx);
      extra.foul = { foul_by: sel(foulBy), foul_on: sel(foulOn), foul_type: foulType, card };
    } else if (action === 'turnover') {
      const forced = sel(forcedBy);
      actingSide = forced.team_side || makeSelection(lostBy, ctx).team_side || 'unknown';
      primary = forced.kind !== 'none' ? forced : makeSelection(lostBy, ctx);
      extra.turnover = {
        turnover_type: turnoverType,
        lost_by: sel(lostBy),
        forced_by: sel(forcedBy),
        recovered_by: sel(recoveredBy),
        unforced: !!unforced,
      };
      if (turnoverType === 'foul') {
        extra.foul = { foul_by: sel(foulBy), foul_on: sel(foulOn), foul_type: foulType, card };
      }
    } else if (action === 'throw_in') {
      actingSide = makeSelection(wonBy, ctx).team_side || makeSelection(brokenBy, ctx).team_side || 'unknown';
      primary = makeSelection(wonBy, ctx);
      extra.throw_in = {
        outcome: throwOutcome,
        won_by: sel(wonBy),
        lost_by: sel(throwLostBy),
        broken_by: sel(brokenBy),
      };
      if (throwOutcome === 'foul') {
        extra.foul = { foul_by: sel(foulBy), foul_on: sel(foulOn), foul_type: foulType, card };
      }
    } else if (action === 'shot') {
      actingSide = makeSelection(primaryPlayer, ctx).team_side || 'unknown';
      primary = makeSelection(primaryPlayer, ctx);
      extra.shot = {
        shot_type: shotType,
        situation: shotSituation,
        method: shotMethod,
        pressure: shotPressure,
        outcome: shotOutcome,
        result: shotResult,
      };
    } else if (action === 'defensive_contact') {
      actingSide = makeSelection(primaryPlayer, ctx).team_side || 'unknown';
      primary = makeSelection(primaryPlayer, ctx);
      extra.defensive_contact = { type: defType };
    } else if (action === 'carry') {
      actingSide = makeSelection(carrier, ctx).team_side || 'unknown';
      primary = makeSelection(carrier, ctx);
      extra.carry = {
        carrier: sel(carrier),
        pressure_on_carrier: carrierPressure,
        take_on_attempted: !!takeOnAttempted,
        take_on_completed: !!takeOnCompleted,
        defender: sel(defender),
        solo_plus_go: !!soloPlusGo,
        outcome: carryOutcome,
      };
      if (carryOutcome === 'turnover') extra.turnover = { turnover_type: turnoverType, lost_by: sel(lostBy), forced_by: sel(forcedBy), recovered_by: sel(recoveredBy), unforced: !!unforced };
      if (carryOutcome === 'foul') extra.foul = { foul_by: sel(foulBy), foul_on: sel(foulOn), foul_type: foulType, card };
    } else if (action === 'pass') {
      const passerSel = sel(passer);
      actingSide = passerSel.team_side || 'unknown';
      primary = passerSel;
      extra.pass = {
        passer: passerSel,
        intended_recipient: sel(passIntendedRecipient),
        method: passMethod,
        style: passStyle,
        pressure_on_passer: passPressure,
        outcome: passOutcome,
        won_by: sel(passWonBy),
        deadball: !!deadball,
      };
      if (passOutcome === 'turnover') extra.turnover = { turnover_type: turnoverType, lost_by: sel(lostBy), forced_by: sel(forcedBy), recovered_by: sel(recoveredBy), unforced: !!unforced };
      if (passOutcome === 'foul') extra.foul = { foul_by: sel(foulBy), foul_on: sel(foulOn), foul_type: foulType, card };
    }

    onSubmit?.({
      stat_type: action,
      is_pass: isDrag,
      team_side: actingSide,
      counter_attack: !!counterAttack,
      primary_player: primary,
      extra,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent className="w-full sm:max-w-xl md:max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">
            {isDrag ? 'Log Pass / Carry' : 'Log Stat'}
          </DialogTitle>
        </DialogHeader>

        <div className="py-3 flex-1 overflow-y-auto pr-1">
          <div className="grid md:grid-cols-[260px_1fr_260px] gap-4">
            <RosterPanel
              title="Home"
              side="home"
              color={homeTeamColor || '#22c55e'}
              players={rosters.home}
              onFieldIds={homeOnFieldIds}
              canPickSide={getRestrictSideForRole(activeRole || nextUnfilledRole())}
              disabledReason={
                (() => {
                  const r = activeRole || nextUnfilledRole();
                  const restrict = getRestrictSideForRole(r);
                  if (r === 'pass_intended' && restrict) return "Recipient must be on passer's team";
                  if (r === 'kickout_intended' && restrict) return 'Recipient must be on kickout team';
                  return '';
                })()
              }
              onPickValue={handlePickValue}
            />

            <div className="space-y-3">
              {pickingForLabel && (
                <div className="text-xs text-slate-600">
                  Picking for: <span className="font-semibold text-slate-900">{pickingForLabel}</span>
                </div>
              )}

          {/* Action selector (locked in edit mode) */}
          {initialStat?.id ? (
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-700">Action</Label>
              <div className="text-sm font-semibold text-slate-900">{toTitleCase(action)}</div>
            </div>
          ) : (
            <>
              {isDrag ? (
                <Buttons
                  label="Action"
                  value={action}
                  onChange={setAction}
                  options={[{ value: 'pass', label: 'Pass' }, { value: 'carry', label: 'Carry' }]}
                />
              ) : (
                <Buttons
                  label="Action"
                  value={action}
                  onChange={setAction}
                  options={[
                    { value: 'shot', label: 'Shot' },
                    { value: 'kickout', label: 'Kickout' },
                    { value: 'turnover', label: 'Turnover' },
                    { value: 'foul', label: 'Foul' },
                    { value: 'defensive_contact', label: 'Defensive' },
                    { value: 'throw_in', label: 'Throw In' },
                  ]}
                />
              )}
            </>
          )}

          {/* Forms */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-3">
              {action === 'shot' && !isDrag && (
                <>
                  {roleButton('player')}
                  <Buttons label="Shot Type" value={shotType} onChange={setShotType} options={[{ value: 'point', label: '1 Point' }, { value: '2_point', label: '2 Point' }, { value: 'goal', label: 'Goal' }]} />
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium text-slate-700">Situation</Label>
                      <Select value={shotSituation} onValueChange={setShotSituation}>
                        <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                        <SelectContent>
                          {['play', 'free_ground', 'free_hands', '45', 'penalty', 'mark'].map((v) => <SelectItem key={v} value={v}>{toTitleCase(v)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <Buttons label="Method" value={shotMethod} onChange={setShotMethod} options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }, { value: 'hand', label: 'Hand' }]} />
                  </div>
                  <Buttons label="Pressure" value={shotPressure} onChange={setShotPressure} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Med' }, { value: 'high', label: 'High' }]} />
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-slate-700">Outcome</Label>
                    <Select value={shotOutcome} onValueChange={setShotOutcome}>
                      <SelectTrigger><SelectValue placeholder="Select outcome..." /></SelectTrigger>
                      <SelectContent className="max-h-72">
                        {['point', '2_point', 'goal', 'wide', 'short', 'post', 'saved', 'blocked'].map((v) => (
                          <SelectItem key={v} value={v}>{toTitleCase(v)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              {action === 'kickout' && !isDrag && (
                <>
                  <Buttons label="Team" value={kickoutTeam} onChange={setKickoutTeam} options={[{ value: 'home', label: 'Home' }, { value: 'away', label: 'Away' }]} />
                  {roleButton('kickout_intended')}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-slate-700">Outcome</Label>
                    <Select value={kickoutOutcome} onValueChange={setKickoutOutcome}>
                      <SelectTrigger><SelectValue placeholder="Select outcome..." /></SelectTrigger>
                      <SelectContent>
                        {['clean', 'break', 'foul', 'sideline_for', 'sideline_against'].map((v) => (
                          <SelectItem key={v} value={v}>{toTitleCase(v)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <YesNo label="Mark" value={kickoutMark} onChange={setKickoutMark} />
                </>
              )}

              {action === 'foul' && !isDrag && foulPanel()}

              {action === 'turnover' && !isDrag && turnoverPanel()}

              {action === 'throw_in' && !isDrag && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-slate-700">Outcome</Label>
                  <Select value={throwOutcome} onValueChange={setThrowOutcome}>
                    <SelectTrigger><SelectValue placeholder="Select outcome..." /></SelectTrigger>
                    <SelectContent>
                      {['clean', 'break', 'foul'].map((v) => <SelectItem key={v} value={v}>{toTitleCase(v)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {action === 'defensive_contact' && !isDrag && (
                <>
                  {roleButton('player')}
                  <Buttons label="Type" value={defType} onChange={setDefType} options={[{ value: 'dispossession', label: 'Dispossession' }, { value: 'contact', label: 'Contact' }]} />
                </>
              )}

              {action === 'carry' && isDrag && (
                <>
                  {roleButton('carrier')}
                  <Buttons label="Pressure on Carrier" value={carrierPressure} onChange={setCarrierPressure} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Med' }, { value: 'high', label: 'High' }]} />
                  <YesNo label="Take On Attempted" value={takeOnAttempted} onChange={setTakeOnAttempted} />
                  {takeOnAttempted && (
                    <>
                      <YesNo label="Take On Completed" value={takeOnCompleted} onChange={setTakeOnCompleted} />
                      {roleButton('defender')}
                    </>
                  )}
                  <YesNo label="Solo + Go" value={soloPlusGo} onChange={setSoloPlusGo} />
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-slate-700">Outcome</Label>
                    <Select value={carryOutcome} onValueChange={setCarryOutcome}>
                      <SelectTrigger><SelectValue placeholder="Select outcome..." /></SelectTrigger>
                      <SelectContent>
                        {['completed', 'turnover', 'foul', 'turned_back', 'sideline_for', '45', 'goal_kick_for'].map((v) => (
                          <SelectItem key={v} value={v}>{toTitleCase(v)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              {action === 'pass' && isDrag && (
                <>
                  {roleButton('passer')}
                  {roleButton('pass_intended')}
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium text-slate-700">Method</Label>
                      <Select value={passMethod} onValueChange={setPassMethod}>
                        <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                        <SelectContent>
                          {['left', 'right', 'hand', 'other'].map((v) => <SelectItem key={v} value={v}>{toTitleCase(v)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium text-slate-700">Style</Label>
                      <Select value={passStyle} onValueChange={setPassStyle}>
                        <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                        <SelectContent>
                          {['high', 'chest', '1_bounce', '2plus_bounce', 'ground'].map((v) => <SelectItem key={v} value={v}>{toTitleCase(v)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Buttons label="Pressure on Passer" value={passPressure} onChange={setPassPressure} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Med' }, { value: 'high', label: 'High' }]} />
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-slate-700">Outcome</Label>
                    <Select value={passOutcome} onValueChange={setPassOutcome}>
                      <SelectTrigger><SelectValue placeholder="Select outcome..." /></SelectTrigger>
                      <SelectContent>
                        {['completed', 'turnover', 'foul', 'sideline_for', '45_for', 'goal_kick_for', 'goal_kick_against'].map((v) => (
                          <SelectItem key={v} value={v}>{toTitleCase(v)}</SelectItem>
                        ))}
                      </SelectContent>
                </Select>
              </div>
                  {roleButton('pass_won_by')}
                  <YesNo label="Deadball" value={deadball} onChange={setDeadball} />
                </>
              )}
            </div>

            <div className="space-y-3">
              {action === 'shot' && !isDrag && ['short', 'post', 'saved', 'blocked'].includes(shotOutcome) && (
                <Buttons label="Result" value={shotResult} onChange={setShotResult} options={[{ value: 'retained', label: 'Retained' }, { value: 'opposition', label: 'Opposition' }, { value: '45', label: '45' }, { value: 'wide', label: 'Wide' }]} />
              )}

              {action === 'kickout' && !isDrag && (
                <>
                  {(kickoutOutcome === 'clean') && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        {roleButton('kickout_won_by')}
                        {roleButton('kickout_lost_by')}
                      </div>
                    </>
                  )}
                  {(kickoutOutcome === 'break') && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        {roleButton('kickout_broken_by')}
                        {roleButton('kickout_won_by')}
                        {roleButton('kickout_lost_by')}
                      </div>
                    </>
                  )}
                  {(kickoutOutcome === 'foul') && foulPanel()}
                </>
              )}

              {action === 'throw_in' && !isDrag && (
                <>
                  {throwOutcome === 'clean' && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        {roleButton('throw_won_by')}
                        {roleButton('throw_lost_by')}
                      </div>
                    </>
                  )}
                  {throwOutcome === 'break' && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        {roleButton('broken_by')}
                        {roleButton('throw_won_by')}
                        {roleButton('throw_lost_by')}
                      </div>
                    </>
                  )}
                  {throwOutcome === 'foul' && foulPanel()}
                </>
              )}

              {action === 'carry' && isDrag && (
                <>
                  {carryOutcome === 'turnover' && turnoverPanel()}
                  {carryOutcome === 'foul' && foulPanel()}
                </>
              )}

              {action === 'pass' && isDrag && (
                <>
                  {passOutcome === 'turnover' && turnoverPanel()}
                  {passOutcome === 'foul' && foulPanel()}
                </>
              )}
            </div>
          </div>

          <div className="pt-4 border-t">
            <div className="space-y-4 pb-4">
              <CustomFieldInput label="Custom 1" config={customFields?.custom_1} value={custom1} onChange={setCustom1} />
              <CustomFieldInput label="Custom 2" config={customFields?.custom_2} value={custom2} onChange={setCustom2} />
              <CustomFieldInput label="Custom 3" config={customFields?.custom_3} value={custom3} onChange={setCustom3} />
            </div>
            <YesNo label="Counter Attack" value={counterAttack} onChange={setCounterAttack} />
          </div>
            </div>

            <RosterPanel
              title="Away"
              side="away"
              color={awayTeamColor || '#ef4444'}
              players={rosters.away}
              onFieldIds={awayOnFieldIds}
              canPickSide={getRestrictSideForRole(activeRole || nextUnfilledRole())}
              disabledReason={
                (() => {
                  const r = activeRole || nextUnfilledRole();
                  const restrict = getRestrictSideForRole(r);
                  if (r === 'pass_intended' && restrict) return "Recipient must be on passer's team";
                  if (r === 'kickout_intended' && restrict) return 'Recipient must be on kickout team';
                  return '';
                })()
              }
              onPickValue={handlePickValue}
            />
          </div>
        </div>

        <div className="flex gap-3 pt-4 border-t">
          <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit()} className="flex-1 bg-green-600 hover:bg-green-700">
            Log Stat
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
