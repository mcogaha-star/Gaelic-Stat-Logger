import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const NONE = 'none';

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

function TeamAwarePlayerSelect({
  label,
  value,
  onChange,
  homePlayers,
  awayPlayers,
  restrictTeamSide = null,
  includeTeamOptions = true,
}) {
  const options = useMemo(() => {
    const build = (players, side) => {
      const list = [];
      if (!restrictTeamSide || restrictTeamSide === side) {
        if (includeTeamOptions) list.push({ value: `team:${side}`, label: side === 'home' ? 'Home Team' : 'Away Team' });
        for (const p of players) {
          list.push({ value: `player:${p.id}`, label: `#${p.number} ${p.name || ''}`.trim() });
        }
      }
      return list;
    };
    const base = [{ value: NONE, label: 'None' }];
    return base.concat(build(homePlayers, 'home')).concat(build(awayPlayers, 'away'));
  }, [homePlayers, awayPlayers, restrictTeamSide, includeTeamOptions]);

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-slate-700">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={`Select ${label.toLowerCase()}...`} />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
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
  defaultReceiver, // selection object
  initialStat, // full stat row for edit mode (optional)
  customFields, // { custom_1..custom_3: { enabled, label, options[] } }
  onSubmit,
}) {
  const [action, setAction] = useState(isDrag ? 'pass' : 'shot');
  const [counterAttack, setCounterAttack] = useState(false);

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
  }, [open]); // intentionally only on open

  // Turnover: recovered_by defaults to forced_by when untouched
  useEffect(() => {
    if (action !== 'turnover') return;
    if (recoveredBy === NONE && forcedBy !== NONE) setRecoveredBy(forcedBy);
  }, [forcedBy, action]);

  const ctx = useMemo(() => ({ homePlayers, awayPlayers }), [homePlayers, awayPlayers]);

  const foulPanel = () => (
    <div className="space-y-4 border rounded-lg p-3 bg-slate-50">
      <TeamAwarePlayerSelect label="Foul By" value={foulBy} onChange={setFoulBy} homePlayers={homePlayers} awayPlayers={awayPlayers} />
      <TeamAwarePlayerSelect label="Foul On / Forced By" value={foulOn} onChange={setFoulOn} homePlayers={homePlayers} awayPlayers={awayPlayers} />
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
    <div className="space-y-4 border rounded-lg p-3 bg-slate-50">
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
          <TeamAwarePlayerSelect label="Lost By" value={lostBy} onChange={setLostBy} homePlayers={homePlayers} awayPlayers={awayPlayers} />
          <TeamAwarePlayerSelect label="Forced By" value={forcedBy} onChange={setForcedBy} homePlayers={homePlayers} awayPlayers={awayPlayers} />
          <TeamAwarePlayerSelect label="Recovered By" value={recoveredBy} onChange={setRecoveredBy} homePlayers={homePlayers} awayPlayers={awayPlayers} />
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
      <DialogContent className="w-full sm:max-w-xl md:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">
            {isDrag ? 'Log Pass / Carry' : 'Log Stat'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-4 flex-1 overflow-y-auto pr-1">

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
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-5">
              {action === 'shot' && !isDrag && (
                <>
                  <TeamAwarePlayerSelect label="Player" value={primaryPlayer} onChange={setPrimaryPlayer} homePlayers={homePlayers} awayPlayers={awayPlayers} />
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
                  <TeamAwarePlayerSelect
                    label="Intended Recipient"
                    value={intendedRecipient}
                    onChange={setIntendedRecipient}
                    homePlayers={homePlayers}
                    awayPlayers={awayPlayers}
                    restrictTeamSide={kickoutTeam}
                    includeTeamOptions={true}
                  />
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
                  <TeamAwarePlayerSelect label="Player" value={primaryPlayer} onChange={setPrimaryPlayer} homePlayers={homePlayers} awayPlayers={awayPlayers} />
                  <Buttons label="Type" value={defType} onChange={setDefType} options={[{ value: 'dispossession', label: 'Dispossession' }, { value: 'contact', label: 'Contact' }]} />
                </>
              )}

              {action === 'carry' && isDrag && (
                <>
                  <TeamAwarePlayerSelect label="Carrier" value={carrier} onChange={setCarrier} homePlayers={homePlayers} awayPlayers={awayPlayers} />
                  <Buttons label="Pressure on Carrier" value={carrierPressure} onChange={setCarrierPressure} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Med' }, { value: 'high', label: 'High' }]} />
                  <YesNo label="Take On Attempted" value={takeOnAttempted} onChange={setTakeOnAttempted} />
                  {takeOnAttempted && (
                    <>
                      <YesNo label="Take On Completed" value={takeOnCompleted} onChange={setTakeOnCompleted} />
                      <TeamAwarePlayerSelect label="Defender" value={defender} onChange={setDefender} homePlayers={homePlayers} awayPlayers={awayPlayers} />
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
                  <TeamAwarePlayerSelect label="Passer" value={passer} onChange={setPasser} homePlayers={homePlayers} awayPlayers={awayPlayers} />
                  <TeamAwarePlayerSelect
                    label="Intended Recipient"
                    value={passIntendedRecipient}
                    onChange={setPassIntendedRecipient}
                    homePlayers={homePlayers}
                    awayPlayers={awayPlayers}
                    restrictTeamSide={makeSelection(passer, ctx).team_side || null}
                    includeTeamOptions={true}
                  />
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
                  <TeamAwarePlayerSelect label="Won By" value={passWonBy} onChange={setPassWonBy} homePlayers={homePlayers} awayPlayers={awayPlayers} />
                  <YesNo label="Deadball" value={deadball} onChange={setDeadball} />
                </>
              )}
            </div>

            <div className="space-y-5">
              {action === 'shot' && !isDrag && ['short', 'post', 'saved', 'blocked'].includes(shotOutcome) && (
                <Buttons label="Result" value={shotResult} onChange={setShotResult} options={[{ value: 'retained', label: 'Retained' }, { value: 'opposition', label: 'Opposition' }, { value: '45', label: '45' }, { value: 'wide', label: 'Wide' }]} />
              )}

              {action === 'kickout' && !isDrag && (
                <>
                  {(kickoutOutcome === 'clean') && (
                    <>
                      <TeamAwarePlayerSelect label="Won By" value={kickoutWonBy} onChange={setKickoutWonBy} homePlayers={homePlayers} awayPlayers={awayPlayers} />
                      <TeamAwarePlayerSelect label="Lost By" value={kickoutLostBy} onChange={setKickoutLostBy} homePlayers={homePlayers} awayPlayers={awayPlayers} />
                    </>
                  )}
                  {(kickoutOutcome === 'break') && (
                    <>
                      <TeamAwarePlayerSelect label="Broken By" value={kickoutBrokenBy} onChange={setKickoutBrokenBy} homePlayers={homePlayers} awayPlayers={awayPlayers} />
                      <TeamAwarePlayerSelect label="Won By" value={kickoutWonBy} onChange={setKickoutWonBy} homePlayers={homePlayers} awayPlayers={awayPlayers} />
                      <TeamAwarePlayerSelect label="Lost By" value={kickoutLostBy} onChange={setKickoutLostBy} homePlayers={homePlayers} awayPlayers={awayPlayers} />
                    </>
                  )}
                  {(kickoutOutcome === 'foul') && foulPanel()}
                </>
              )}

              {action === 'throw_in' && !isDrag && (
                <>
                  {throwOutcome === 'clean' && (
                    <>
                      <TeamAwarePlayerSelect label="Won By" value={wonBy} onChange={setWonBy} homePlayers={homePlayers} awayPlayers={awayPlayers} />
                      <TeamAwarePlayerSelect label="Lost By" value={throwLostBy} onChange={setThrowLostBy} homePlayers={homePlayers} awayPlayers={awayPlayers} />
                    </>
                  )}
                  {throwOutcome === 'break' && (
                    <>
                      <TeamAwarePlayerSelect label="Broken By" value={brokenBy} onChange={setBrokenBy} homePlayers={homePlayers} awayPlayers={awayPlayers} />
                      <TeamAwarePlayerSelect label="Won By" value={wonBy} onChange={setWonBy} homePlayers={homePlayers} awayPlayers={awayPlayers} />
                      <TeamAwarePlayerSelect label="Lost By" value={throwLostBy} onChange={setThrowLostBy} homePlayers={homePlayers} awayPlayers={awayPlayers} />
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
