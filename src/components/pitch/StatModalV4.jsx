import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

function formatMMSS(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const s = Math.floor(seconds);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function parseMMSS(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  // Accept MM:SS or M:SS
  const m = t.match(/^(\d+)\s*:\s*([0-5]?\d)$/);
  if (!m) return NaN;
  const mm = Number(m[1]);
  const ss = Number(m[2]);
  if (!Number.isFinite(mm) || !Number.isFinite(ss)) return NaN;
  return mm * 60 + ss;
}

function formatSignedMMSS(seconds) {
  if (!Number.isFinite(seconds)) return '--:--';
  const sign = seconds < 0 ? '-' : '';
  const abs = Math.abs(seconds);
  const base = formatMMSS(abs);
  return base ? `${sign}${base}` : '--:--';
}

function VideoTimeBlock({
  currentVideoTimeS,
  videoTimeText,
  setVideoTimeText,
  setVideoTimeTouched,
  normalizedVideoTimeS,
  videoTimeInvalid,
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">
            Video Time (MM:SS)
          </Label>
          <Input
            value={videoTimeText}
            onChange={(e) => { setVideoTimeTouched(true); setVideoTimeText(e.target.value); }}
            placeholder="--:--"
            className="h-8 text-xs font-mono"
            inputMode="numeric"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 px-2 text-xs"
          disabled={!Number.isFinite(Number(currentVideoTimeS))}
          onClick={() => {
            if (!Number.isFinite(Number(currentVideoTimeS))) return;
            setVideoTimeTouched(true);
            setVideoTimeText(formatMMSS(Number(currentVideoTimeS)));
          }}
          title={Number.isFinite(Number(currentVideoTimeS)) ? 'Set to current video time' : 'Open the video window to use current time'}
        >
          Use Current
        </Button>
      </div>
      <div className="text-[11px] text-slate-500 leading-tight">
        Normalized: {Number.isFinite(normalizedVideoTimeS) ? formatSignedMMSS(normalizedVideoTimeS) : '--'}
      </div>
      {videoTimeInvalid && (
        <div className="text-[11px] text-red-600 leading-tight">Invalid format. Use MM:SS.</div>
      )}
    </div>
  );
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
        'w-full text-left rounded-md border px-2 py-1.5 transition-colors',
        disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50',
        // Stronger active state so it's obvious what the next roster click will fill.
        active ? 'border-slate-900 ring-2 ring-slate-900/20 bg-slate-900 text-white' : 'border-slate-200 bg-white',
      ].join(' ')}
    >
      <div className={['text-[10px] font-semibold uppercase tracking-wide leading-tight', active ? 'text-white/70' : 'text-slate-500'].join(' ')}>
        {label}
      </div>
      <div className={['text-xs font-semibold truncate leading-tight', active ? 'text-white' : 'text-slate-900'].join(' ')}>
        {valueText}
      </div>
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
  onOpenBench,
}) {
  const byId = useMemo(() => new Map((players || []).map((p) => [p.id, p])), [players]);
  // Keep on-field order stable using the onFieldIds array (match lineup order).
  const onField = useMemo(
    () => (onFieldIds || []).map((id) => byId.get(id)).filter(Boolean).slice(0, 15),
    [onFieldIds, byId]
  );

  const tint = (() => {
    // Solid team colour background (match mockup); rows are white pills for readability.
    const c = String(color || '').trim();
    if (/^#([0-9a-f]{6})$/i.test(c)) return c;
    return 'rgba(15, 23, 42, 0.04)';
  })();

  const Row = ({ children, onClick, isDisabled }) => (
    <button
      type="button"
      disabled={isDisabled || disabled}
      onClick={onClick}
      className={[
        // Keep font size, reduce height via padding/leading.
        // Slightly shorter than h-6 (~5%) without changing font size.
        'w-full text-left px-2 h-[23px] flex items-center rounded-md border text-xs leading-none transition-colors',
        isDisabled || disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-white/70',
        'border-white/60 bg-white/80',
      ].join(' ')}
    >
      {children}
    </button>
  );

  const disallowOtherTeamRow = (rowSide) => (canPickSide && rowSide && canPickSide !== rowSide);

  return (
    <div className="h-full flex flex-col rounded-[28px] overflow-hidden" style={{ background: tint }}>
      <div className="px-3 pt-2.5 pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold text-white text-sm drop-shadow-sm">{title}</div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={onOpenBench}
          >
            Bench
          </Button>
        </div>
        {disabledReason && (
          <div className="text-[10px] text-white/80 mt-1 leading-tight">{disabledReason}</div>
        )}
      </div>

      <div className="px-3 pb-3 space-y-1">
        {side === 'home' ? (
          <Row onClick={() => onPickValue(TEAM_HOME)} isDisabled={disallowOtherTeamRow('home')}>Team</Row>
        ) : (
          <Row onClick={() => onPickValue(TEAM_AWAY)} isDisabled={disallowOtherTeamRow('away')}>Team</Row>
        )}

        {onField.map((p) => (
          <Row
            key={p.id}
            onClick={() => onPickValue(`player:${p.id}`)}
            isDisabled={disallowOtherTeamRow(side)}
          >
            {`#${p.number ?? ''} ${p.name || ''}`.trim()}
          </Row>
        ))}

        {/* Keep None at the bottom so it's less likely to be clicked accidentally. */}
        <div className="pt-1">
          <Row onClick={() => onPickValue(NONE)} isDisabled={false}>None</Row>
        </div>
      </div>
    </div>
  );
}

function Buttons({ label, value, onChange, options }) {
  const gridCols =
    options.length === 3
      ? 'grid-cols-3'
      : options.length >= 4
        ? 'grid-cols-2 sm:grid-cols-4'
        : 'grid-cols-2';
  return (
    <div className="space-y-1">
      <Label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">{label}</Label>
      <div className={['grid gap-2', gridCols].join(' ')}>
        {options.map((opt) => (
          <Button
            key={opt.value}
            type="button"
            variant={value === opt.value ? 'default' : 'outline'}
            size="sm"
            className="h-8 px-2 text-xs whitespace-nowrap"
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function CardSwatches({ value, onChange }) {
  const opts = [
    { value: 'none', aria: 'No card', label: 'NA', className: 'bg-white text-slate-900' },
    { value: 'yellow', aria: 'Yellow card', label: '', className: 'bg-yellow-400' },
    { value: 'black', aria: 'Black card', label: '', className: 'bg-slate-900' },
    { value: 'red', aria: 'Red card', label: '', className: 'bg-red-500' },
  ];

  return (
    <div className="space-y-1">
      <Label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">Card</Label>
      <div className="grid grid-cols-4 gap-2">
        {opts.map((o) => {
          const selected = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-label={o.aria}
              onClick={() => onChange(o.value)}
              className={[
                'h-8 rounded-md border flex items-center justify-center',
                selected ? 'ring-2 ring-slate-900/20 border-slate-900' : 'border-slate-200',
                o.className,
              ].join(' ')}
            >
              {o.label ? <span className="text-xs font-semibold">{o.label}</span> : null}
            </button>
          );
        })}
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
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">{name}</Label>
          {!!value && (
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onChange('')}>
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
              className="h-8 px-2 text-xs"
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
    <div className="space-y-1">
      <Label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">{name}</Label>
      <Select value={value || ''} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-xs">
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

export default function StatModalV4({
  open,
  onClose,
  isDrag,
  startCoords,
  endCoords,
  currentVideoTimeS,
  halfStartTimeS,
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
  const [touchedRoles, setTouchedRoles] = useState(() => ({})); // { [roleKey]: true } when user explicitly picks (including None)
  const [benchOpen, setBenchOpen] = useState(null); // 'home' | 'away' | null
  const [benchQuery, setBenchQuery] = useState('');

  // v0.5: video timestamps
  const [videoTimeText, setVideoTimeText] = useState('');
  const [videoTimeTouched, setVideoTimeTouched] = useState(false);

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
  const [shotOutcomeTouched, setShotOutcomeTouched] = useState(false);
  const [shotResult, setShotResult] = useState('');
  const [shotRecoveredBy, setShotRecoveredBy] = useState(NONE);
  const [shotBlockedBy, setShotBlockedBy] = useState(NONE);
  const [shotSavedBy, setShotSavedBy] = useState(NONE);

  const parsedVideoTimeS = useMemo(() => parseMMSS(videoTimeText), [videoTimeText]);
  const videoTimeInvalid = !!String(videoTimeText || '').trim() && !Number.isFinite(parsedVideoTimeS);
  const normalizedVideoTimeS = useMemo(() => {
    if (!Number.isFinite(parsedVideoTimeS)) return null;
    const hs = Number(halfStartTimeS);
    if (!Number.isFinite(hs)) return null;
    return parsedVideoTimeS - hs;
  }, [parsedVideoTimeS, halfStartTimeS]);

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
    setShotOutcomeTouched(false);
    setShotResult('');
    setShotRecoveredBy(NONE);
    setShotBlockedBy(NONE);
    setShotSavedBy(NONE);
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
    setTouchedRoles({});
    setVideoTimeText('');
    setVideoTimeTouched(false);

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
      setShotOutcomeTouched(true);
      setShotResult(extra?.shot?.result || '');
      setShotRecoveredBy(selectionToValue(extra?.shot?.recovered_by));
      setShotBlockedBy(selectionToValue(extra?.shot?.blocked_by));
      setShotSavedBy(selectionToValue(extra?.shot?.saved_by));
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

    // Seed "touched" from what's present in the saved row so explicit None remains a valid selection in edit mode.
    // Note: submit stores selection objects for role keys it knows about, so "kind:none" implies explicit.
    const touched = {};
    const markSel = (k, selObj) => {
      if (selObj && typeof selObj === 'object' && 'kind' in selObj) touched[k] = true;
    };
    markSel('foul_by', extra?.foul?.foul_by);
    markSel('foul_on', extra?.foul?.foul_on);
    markSel('lost_by', extra?.turnover?.lost_by);
    markSel('forced_by', extra?.turnover?.forced_by);
    markSel('recovered_by', extra?.turnover?.recovered_by);
    markSel('throw_won_by', extra?.throw_in?.won_by);
    markSel('throw_lost_by', extra?.throw_in?.lost_by);
    markSel('broken_by', extra?.throw_in?.broken_by);
    markSel('kickout_intended', extra?.kickout?.intended_recipient);
    markSel('kickout_won_by', extra?.kickout?.won_by);
    markSel('kickout_lost_by', extra?.kickout?.lost_by);
    markSel('kickout_broken_by', extra?.kickout?.broken_by);
    markSel('carrier', extra?.carry?.carrier);
    markSel('defender', extra?.carry?.defender);
    markSel('passer', extra?.pass?.passer);
    markSel('pass_intended', extra?.pass?.intended_recipient);
    markSel('pass_won_by', extra?.pass?.won_by);
    markSel('shot_recovered_by', extra?.shot?.recovered_by);
    markSel('shot_blocked_by', extra?.shot?.blocked_by);
    markSel('shot_saved_by', extra?.shot?.saved_by);
    setTouchedRoles(touched);

    // Seed video time from the existing row (edit mode).
    const ts = Number(initialStat?.time_s);
    if (Number.isFinite(ts)) {
      setVideoTimeText(formatMMSS(ts));
      setVideoTimeTouched(true);
    } else {
      setVideoTimeText('');
      setVideoTimeTouched(false);
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
    setTouchedRoles({});
    setShotOutcomeTouched(false);
    setVideoTimeTouched(false);
    if (Number.isFinite(Number(currentVideoTimeS))) {
      setVideoTimeText(formatMMSS(Number(currentVideoTimeS)));
    } else {
      setVideoTimeText('');
    }
  }, [open]); // intentionally only on open

  // Shot: default outcome to match shot type (unless user manually picked a different outcome).
  useEffect(() => {
    if (!open) return;
    if (initialStat?.id) return;
    if (action !== 'shot') return;
    if (!shotType) return;
    if (shotOutcomeTouched) return;
    // Only auto-set when the type is one of the score types.
    if (['point', '2_point', 'goal'].includes(shotType)) setShotOutcome(shotType);
  }, [open, initialStat?.id, action, shotType, shotOutcomeTouched]);

  // Turnover: recovered_by defaults to forced_by when untouched
  useEffect(() => {
    if (action !== 'turnover') return;
    if (recoveredBy === NONE && forcedBy !== NONE) setRecoveredBy(forcedBy);
  }, [forcedBy, action]);

  // Pass turnover defaults:
  // - lost_by defaults to passer
  // - forced_by + recovered_by default to won_by
  useEffect(() => {
    if (!isDrag) return;
    if (action !== 'pass') return;
    if (passOutcome !== 'turnover') return;

    if (lostBy === NONE && passer !== NONE) setLostBy(passer);
    if (passWonBy !== NONE) {
      if (forcedBy === NONE) setForcedBy(passWonBy);
      if (recoveredBy === NONE) setRecoveredBy(passWonBy);
    }
  }, [isDrag, action, passOutcome, passer, passWonBy, lostBy, forcedBy, recoveredBy]);

  // Pass default: "Won By" should default to the intended recipient (when it's a player) if not set.
  useEffect(() => {
    if (!open) return;
    if (!isDrag) return;
    if (action !== 'pass') return;
    if (passOutcome === 'turnover') return; // "won_by" is not used for turnover passes
    if (passWonBy !== NONE) return;
    if (!passIntendedRecipient || passIntendedRecipient === NONE) return;
    if (!String(passIntendedRecipient).startsWith('player:')) return;
    setPassWonBy(passIntendedRecipient);
  }, [open, isDrag, action, passOutcome, passWonBy, passIntendedRecipient]);

  const ctx = useMemo(() => ({ homePlayers, awayPlayers }), [homePlayers, awayPlayers]);

  const isRoleFilled = (roleKey, value) => {
    if (!roleKey) return false;
    if (value && value !== NONE) return true;
    if (value === NONE) return !!touchedRoles?.[roleKey];
    return false;
  };

  const rosters = useMemo(() => {
    // Prefer explicit rosters (can be ordered), fall back to homePlayers/awayPlayers.
    return {
      home: (homeRoster && Array.isArray(homeRoster)) ? homeRoster : homePlayers,
      away: (awayRoster && Array.isArray(awayRoster)) ? awayRoster : awayPlayers,
    };
  }, [homeRoster, awayRoster, homePlayers, awayPlayers]);

  const benchPlayersBySide = useMemo(() => {
    const build = (side) => {
      const all = side === 'home' ? rosters.home : rosters.away;
      const onFieldSet = new Set((side === 'home' ? homeOnFieldIds : awayOnFieldIds) || []);
      return (all || []).filter((p) => p && !onFieldSet.has(p.id));
    };
    return { home: build('home'), away: build('away') };
  }, [rosters, homeOnFieldIds, awayOnFieldIds]);

  const benchFiltered = useMemo(() => {
    const side = benchOpen;
    if (!side) return [];
    const q = String(benchQuery || '').trim().toLowerCase();
    const list = benchPlayersBySide[side] || [];
    if (!q) return list;
    return list.filter((p) => {
      const s = `${p.number ?? ''} ${p.name || ''}`.toLowerCase();
      return s.includes(q);
    });
  }, [benchOpen, benchQuery, benchPlayersBySide]);

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
    shot_recovered_by: { label: 'Recovered By', get: () => shotRecoveredBy, set: setShotRecoveredBy },
    shot_blocked_by: { label: 'Blocked By', get: () => shotBlockedBy, set: setShotBlockedBy },
    shot_saved_by: { label: 'Saved By', get: () => shotSavedBy, set: setShotSavedBy },
  }), [
    primaryPlayer, foulBy, foulOn, lostBy, forcedBy, recoveredBy,
    wonBy, throwLostBy, brokenBy,
    intendedRecipient, kickoutWonBy, kickoutLostBy, kickoutBrokenBy,
    carrier, defender, passer, passIntendedRecipient, passWonBy,
    shotRecoveredBy, shotBlockedBy, shotSavedBy,
  ]);

  const getRoleValue = (k) => roleDefs?.[k]?.get?.() ?? NONE;

  const roleOrder = useMemo(() => {
    if (action === 'shot') {
      const base = ['player'];
      if (shotOutcome === 'saved') base.push('shot_saved_by');
      if (shotOutcome === 'blocked') base.push('shot_blocked_by');
      if (shotResult === 'retained' || shotResult === 'opposition') base.push('shot_recovered_by');
      return base;
    }
    if (action === 'defensive_contact') return ['player'];
    if (action === 'foul') return ['foul_by', 'foul_on'];
    if (action === 'turnover') {
      if (turnoverType === 'foul') return ['lost_by', 'forced_by', 'foul_by', 'foul_on'];
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
      // For turnover, "won by" is not required/used.
      const base = passOutcome === 'turnover' ? ['passer', 'pass_intended'] : ['passer', 'pass_intended', 'pass_won_by'];
      if (passOutcome === 'turnover') return base.concat(turnoverType === 'foul' ? ['lost_by', 'forced_by', 'foul_by', 'foul_on'] : ['lost_by', 'forced_by', 'recovered_by']);
      if (passOutcome === 'foul') return base.concat(['foul_by', 'foul_on']);
      return base;
    }
    if (action === 'carry') {
      const base = ['carrier'].concat(takeOnAttempted ? ['defender'] : []);
      if (carryOutcome === 'turnover') return base.concat(turnoverType === 'foul' ? ['lost_by', 'forced_by', 'foul_by', 'foul_on'] : ['lost_by', 'forced_by', 'recovered_by']);
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
      if (!isRoleFilled(k, v)) return k;
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
    setTouchedRoles((prev) => ({ ...(prev || {}), [targetRole]: true }));
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

  // Always keep an "armed" role so the UI can highlight what the next click will fill.
  useEffect(() => {
    if (!open) return;
    const next = nextUnfilledRole();
    if (!next) {
      if (activeRole !== null) setActiveRole(null);
      return;
    }
    if (!activeRole) {
      setActiveRole(next);
      return;
    }
    const currentVal = getRoleValue(activeRole);
    if (isRoleFilled(activeRole, currentVal)) {
      setActiveRole(next);
    }
  }, [
    open,
    action,
    turnoverType,
    throwOutcome,
    kickoutOutcome,
    passOutcome,
    carryOutcome,
    takeOnAttempted,
    shotOutcome,
    shotResult,
    // Role values that can satisfy activeRole
    primaryPlayer,
    foulBy,
    foulOn,
    lostBy,
    forcedBy,
    recoveredBy,
    wonBy,
    throwLostBy,
    brokenBy,
    intendedRecipient,
    kickoutWonBy,
    kickoutLostBy,
    kickoutBrokenBy,
    carrier,
    defender,
    passer,
    passIntendedRecipient,
    passWonBy,
    shotRecoveredBy,
    shotBlockedBy,
    shotSavedBy,
    touchedRoles,
  ]);

  // Shot saved-by defaults to opposition #1 (goalkeeper) unless user explicitly set it.
  useEffect(() => {
    if (!open) return;
    if (action !== 'shot') return;
    if (shotOutcome !== 'saved') return;
    if (isRoleFilled('shot_saved_by', shotSavedBy)) return;

    const shooterSide = makeSelection(primaryPlayer, ctx).team_side;
    const keeperSide = shooterSide === 'home' ? 'away' : shooterSide === 'away' ? 'home' : null;
    const list = keeperSide === 'away' ? awayPlayers : keeperSide === 'home' ? homePlayers : [];
    const keeper = (list || []).find((p) => Number(p?.number) === 1);
    if (keeper?.id) setShotSavedBy(`player:${keeper.id}`);
  }, [open, action, shotOutcome, primaryPlayer, shotSavedBy, homePlayers, awayPlayers, touchedRoles]);

  const foulRolesBlock = () => (
    <div className="grid grid-cols-1 gap-2">
      {roleButton('foul_on')}
      {roleButton('foul_by')}
    </div>
  );

  const foulFieldsBlock = () => (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">Foul Type</Label>
        <Select value={foulType} onValueChange={setFoulType}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select foul type..." /></SelectTrigger>
          <SelectContent className="max-h-72">
            {FOUL_TYPES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <CardSwatches value={card} onChange={setCard} />
    </div>
  );

  const foulPanel = () => (
    <div className="border rounded-md p-2 bg-slate-50">
      {/* Compact + stable: Foul type on the left, Foul On then Foul By stacked on the right. */}
      <div className="grid grid-cols-2 gap-2 items-start">
        <div className="space-y-1">
          <Label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">Foul Type</Label>
          <Select value={foulType} onValueChange={setFoulType}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select foul type..." /></SelectTrigger>
            <SelectContent className="max-h-72">
              {FOUL_TYPES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          {roleButton('foul_on')}
          {roleButton('foul_by')}
        </div>
      </div>
      <div className="pt-2">
        <CardSwatches value={card} onChange={setCard} />
      </div>
    </div>
  );

  const turnoverRolesBlock = () => (
    <div className="grid grid-cols-2 gap-2">
      {roleButton('lost_by')}
      {roleButton('forced_by')}
      {turnoverType !== 'foul' && roleButton('recovered_by')}
    </div>
  );

  const turnoverFieldsBlock = () => (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">Turnover Type</Label>
        <Select value={turnoverType} onValueChange={setTurnoverType}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select turnover type..." /></SelectTrigger>
          <SelectContent>
            {[
              { value: 'foul', label: 'Foul' },
              { value: 'tackle', label: 'Tackle' },
              { value: 'group_tackle', label: 'Group Tackle' },
              { value: 'broken', label: 'Broken' },
              { value: 'interception', label: 'Interception' },
              { value: 'sidelineagainst', label: 'Sideline Against' },
            ].map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <YesNo label="Unforced" value={unforced} onChange={setUnforced} />
    </div>
  );

  const turnoverPanel = ({ foulLayout = 'side' } = {}) => (
    <div className="border rounded-md p-2 bg-slate-50">
      {turnoverType === 'foul' && foulLayout === 'stack' ? (
        <div className="space-y-2">
          {turnoverFieldsBlock()}
          {turnoverRolesBlock()}
          {foulPanel()}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 items-start">
          <div>{turnoverFieldsBlock()}</div>
          <div className="space-y-2">
            {turnoverRolesBlock()}
            {turnoverType === 'foul' && foulPanel()}
          </div>
        </div>
      )}
    </div>
  );

  const canSubmit = () => {
    if (!startCoords) return false;
    if (isDrag && !endCoords) return false;
    if (!action) return false;
    if (videoTimeInvalid) return false;
    // Minimal validation per action.
    if (action === 'shot') return !!shotOutcome && isRoleFilled('player', primaryPlayer);
    if (action === 'foul') return isRoleFilled('foul_by', foulBy) && isRoleFilled('foul_on', foulOn) && !!foulType;
    if (action === 'turnover') {
      if (!turnoverType) return false;
      if (turnoverType === 'foul') {
        return isRoleFilled('lost_by', lostBy)
          && isRoleFilled('forced_by', forcedBy)
          && isRoleFilled('foul_by', foulBy)
          && isRoleFilled('foul_on', foulOn)
          && !!foulType;
      }
      return isRoleFilled('lost_by', lostBy) && isRoleFilled('forced_by', forcedBy) && isRoleFilled('recovered_by', recoveredBy);
    }
    if (action === 'throw_in') {
      if (!throwOutcome) return false;
      if (throwOutcome === 'foul') return isRoleFilled('foul_by', foulBy) && isRoleFilled('foul_on', foulOn) && !!foulType;
      if (throwOutcome === 'clean') return isRoleFilled('throw_won_by', wonBy) && isRoleFilled('throw_lost_by', throwLostBy);
      if (throwOutcome === 'break') return isRoleFilled('broken_by', brokenBy) && isRoleFilled('throw_won_by', wonBy) && isRoleFilled('throw_lost_by', throwLostBy);
      return false;
    }
    if (action === 'kickout') {
      if (!kickoutOutcome) return false;
      if (kickoutOutcome === 'foul') return isRoleFilled('foul_by', foulBy) && isRoleFilled('foul_on', foulOn) && !!foulType;
      if (kickoutOutcome === 'clean') return isRoleFilled('kickout_won_by', kickoutWonBy) && isRoleFilled('kickout_lost_by', kickoutLostBy);
      if (kickoutOutcome === 'break') return isRoleFilled('kickout_broken_by', kickoutBrokenBy) && isRoleFilled('kickout_won_by', kickoutWonBy) && isRoleFilled('kickout_lost_by', kickoutLostBy);
      return true; // sideline outcomes
    }
    if (action === 'defensive_contact') return !!defType && isRoleFilled('player', primaryPlayer);
    if (action === 'carry') return isRoleFilled('carrier', carrier) && !!carryOutcome;
    if (action === 'pass') return isRoleFilled('passer', passer) && !!passOutcome;
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
        // For foul turnovers, recovered_by is implicit (forced_by) and not chosen in the UI.
        recovered_by: sel(turnoverType === 'foul' ? forcedBy : recoveredBy),
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
        recovered_by: sel(shotRecoveredBy),
        blocked_by: sel(shotBlockedBy),
        saved_by: sel(shotSavedBy),
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
      if (carryOutcome === 'turnover') {
        // For foul turnovers, recovered_by is implicit (forced_by) and not chosen in the UI.
        const recovered = turnoverType === 'foul' ? forcedBy : recoveredBy;
        extra.turnover = { turnover_type: turnoverType, lost_by: sel(lostBy), forced_by: sel(forcedBy), recovered_by: sel(recovered), unforced: !!unforced };
      }
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
      if (passOutcome === 'turnover') {
        // For foul turnovers, recovered_by is implicit (forced_by) and not chosen in the UI.
        const recovered = turnoverType === 'foul' ? forcedBy : recoveredBy;
        extra.turnover = { turnover_type: turnoverType, lost_by: sel(lostBy), forced_by: sel(forcedBy), recovered_by: sel(recovered), unforced: !!unforced };
      }
      if (passOutcome === 'foul') extra.foul = { foul_by: sel(foulBy), foul_on: sel(foulOn), foul_type: foulType, card };
    }

    onSubmit?.({
      stat_type: action,
      is_pass: isDrag,
      team_side: actingSide,
      counter_attack: !!counterAttack,
      time_s: Number.isFinite(parsedVideoTimeS) ? parsedVideoTimeS : null,
      normalized_time_s: Number.isFinite(normalizedVideoTimeS) ? normalizedVideoTimeS : null,
      primary_player: primary,
      extra,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      {/* Keep the modal comfortably within the viewport so it centers nicely (no "sagging" to the bottom). */}
      {/* Anchor under the ribbon: keep Radix's `fixed` positioning and override top/translate-y. */}
      <DialogContent className="!top-[8px] !translate-y-0 w-full sm:max-w-xl md:max-w-6xl max-h-[calc(100vh-16px)] overflow-hidden flex flex-col p-3">
        {/* Only scroll if viewport is too small; otherwise stays fixed (no-scroll). */}
        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          <div className="grid md:grid-cols-[240px_1fr_240px] gap-3 items-stretch">
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
              onOpenBench={() => { setBenchQuery(''); setBenchOpen('home'); }}
            />

            <div className="space-y-2">
          {/* Action selector (locked in edit mode) */}
          {initialStat?.id ? (
            <div className="space-y-1">
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">Action</Label>
              <div className="text-xs font-semibold text-slate-900">{toTitleCase(action)}</div>
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
                    { value: 'defensive_contact', label: 'Def. Action' },
                    { value: 'throw_in', label: 'Throw In' },
                  ]}
                />
              )}
            </>
          )}

          {/* Forms */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              {action === 'shot' && !isDrag && (
                <>
                  <Buttons label="Shot Type" value={shotType} onChange={setShotType} options={[{ value: 'point', label: '1 Point' }, { value: '2_point', label: '2 Point' }, { value: 'goal', label: 'Goal' }]} />
                  <div className="grid sm:grid-cols-2 gap-2">
                    <div className="space-y-2">
                      <Label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">Situation</Label>
                      <Select value={shotSituation} onValueChange={setShotSituation}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select..." /></SelectTrigger>
                        <SelectContent>
                          {['play', 'free_ground', 'free_hands', '45', 'penalty', 'mark'].map((v) => <SelectItem key={v} value={v}>{toTitleCase(v)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <Buttons label="Method" value={shotMethod} onChange={setShotMethod} options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }, { value: 'hand', label: 'Hand' }]} />
                  </div>
                  <Buttons label="Pressure" value={shotPressure} onChange={setShotPressure} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Med' }, { value: 'high', label: 'High' }]} />
                  <div className="space-y-2">
                    <Label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">Outcome</Label>
                    <Select
                      value={shotOutcome}
                      onValueChange={(v) => {
                        setShotOutcomeTouched(true);
                        setShotOutcome(v);
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select outcome..." /></SelectTrigger>
                      <SelectContent className="max-h-72">
                        {['point', '2_point', 'goal', 'wide', 'short', 'post', 'saved', 'blocked'].map((v) => (
                          <SelectItem key={v} value={v}>{toTitleCase(v)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <YesNo label="Counter Attack" value={counterAttack} onChange={setCounterAttack} />
                  <VideoTimeBlock
                    currentVideoTimeS={currentVideoTimeS}
                    videoTimeText={videoTimeText}
                    setVideoTimeText={setVideoTimeText}
                    setVideoTimeTouched={setVideoTimeTouched}
                    normalizedVideoTimeS={normalizedVideoTimeS}
                    videoTimeInvalid={videoTimeInvalid}
                  />
                </>
              )}

              {action === 'kickout' && !isDrag && (
                <>
                  <Buttons label="Team" value={kickoutTeam} onChange={setKickoutTeam} options={[{ value: 'home', label: 'Home' }, { value: 'away', label: 'Away' }]} />
                  <div className="space-y-2">
                    <Label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">Outcome</Label>
                    <Select value={kickoutOutcome} onValueChange={setKickoutOutcome}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select outcome..." /></SelectTrigger>
                      <SelectContent>
                        {['clean', 'break', 'foul', 'sideline_for', 'sideline_against'].map((v) => (
                          <SelectItem key={v} value={v}>{toTitleCase(v)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <YesNo label="Mark" value={kickoutMark} onChange={setKickoutMark} />
                  <YesNo label="Counter Attack" value={counterAttack} onChange={setCounterAttack} />
                  <VideoTimeBlock
                    currentVideoTimeS={currentVideoTimeS}
                    videoTimeText={videoTimeText}
                    setVideoTimeText={setVideoTimeText}
                    setVideoTimeTouched={setVideoTimeTouched}
                    normalizedVideoTimeS={normalizedVideoTimeS}
                    videoTimeInvalid={videoTimeInvalid}
                  />
                </>
              )}

              {action === 'foul' && !isDrag && (
                <>
                  {foulFieldsBlock()}
                  <YesNo label="Counter Attack" value={counterAttack} onChange={setCounterAttack} />
                  <VideoTimeBlock
                    currentVideoTimeS={currentVideoTimeS}
                    videoTimeText={videoTimeText}
                    setVideoTimeText={setVideoTimeText}
                    setVideoTimeTouched={setVideoTimeTouched}
                    normalizedVideoTimeS={normalizedVideoTimeS}
                    videoTimeInvalid={videoTimeInvalid}
                  />
                </>
              )}

              {action === 'turnover' && !isDrag && (
                <>
                  {turnoverFieldsBlock()}
                  <YesNo label="Counter Attack" value={counterAttack} onChange={setCounterAttack} />
                  <VideoTimeBlock
                    currentVideoTimeS={currentVideoTimeS}
                    videoTimeText={videoTimeText}
                    setVideoTimeText={setVideoTimeText}
                    setVideoTimeTouched={setVideoTimeTouched}
                    normalizedVideoTimeS={normalizedVideoTimeS}
                    videoTimeInvalid={videoTimeInvalid}
                  />
                </>
              )}

              {action === 'throw_in' && !isDrag && (
                <div className="space-y-2">
                  <Label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">Outcome</Label>
                  <Select value={throwOutcome} onValueChange={setThrowOutcome}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select outcome..." /></SelectTrigger>
                    <SelectContent>
                      {['clean', 'break', 'foul'].map((v) => <SelectItem key={v} value={v}>{toTitleCase(v)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <YesNo label="Counter Attack" value={counterAttack} onChange={setCounterAttack} />
                  <VideoTimeBlock
                    currentVideoTimeS={currentVideoTimeS}
                    videoTimeText={videoTimeText}
                    setVideoTimeText={setVideoTimeText}
                    setVideoTimeTouched={setVideoTimeTouched}
                    normalizedVideoTimeS={normalizedVideoTimeS}
                    videoTimeInvalid={videoTimeInvalid}
                  />
                </div>
              )}

              {action === 'defensive_contact' && !isDrag && (
                <>
                  <Buttons
                    label="Type"
                    value={defType}
                    onChange={setDefType}
                    options={[
                      { value: 'dispossession', label: 'Dispossession' },
                      { value: 'contact', label: 'Contact' },
                      { value: 'block', label: 'Block' },
                    ]}
                  />
                  <YesNo label="Counter Attack" value={counterAttack} onChange={setCounterAttack} />
                  <VideoTimeBlock
                    currentVideoTimeS={currentVideoTimeS}
                    videoTimeText={videoTimeText}
                    setVideoTimeText={setVideoTimeText}
                    setVideoTimeTouched={setVideoTimeTouched}
                    normalizedVideoTimeS={normalizedVideoTimeS}
                    videoTimeInvalid={videoTimeInvalid}
                  />
                </>
              )}

              {action === 'carry' && isDrag && (
                <>
                  <Buttons label="Pressure on Carrier" value={carrierPressure} onChange={setCarrierPressure} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Med' }, { value: 'high', label: 'High' }]} />
                  <YesNo label="Take On Attempted" value={takeOnAttempted} onChange={setTakeOnAttempted} />
                  {takeOnAttempted && (
                    <>
                      <YesNo label="Take On Completed" value={takeOnCompleted} onChange={setTakeOnCompleted} />
                    </>
                  )}
                  <YesNo label="Solo & Go" value={soloPlusGo} onChange={setSoloPlusGo} />
                  <div className="space-y-2">
                    <Label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">Outcome</Label>
                    <Select value={carryOutcome} onValueChange={setCarryOutcome}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select outcome..." /></SelectTrigger>
                      <SelectContent>
                        {['completed', 'turnover', 'foul', 'turned_back', 'sideline_for', '45', 'goal_kick_for'].map((v) => (
                          <SelectItem key={v} value={v}>{toTitleCase(v)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {/* Counter attack doesn't need to live at the very bottom for pass/carry */}
                  <YesNo label="Counter Attack" value={counterAttack} onChange={setCounterAttack} />
                  <VideoTimeBlock
                    currentVideoTimeS={currentVideoTimeS}
                    videoTimeText={videoTimeText}
                    setVideoTimeText={setVideoTimeText}
                    setVideoTimeTouched={setVideoTimeTouched}
                    normalizedVideoTimeS={normalizedVideoTimeS}
                    videoTimeInvalid={videoTimeInvalid}
                  />
                </>
              )}

              {action === 'pass' && isDrag && (
                <>
                  <div className="grid sm:grid-cols-2 gap-2">
                    <div className="space-y-2">
                      <Label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">Method</Label>
                      <Select value={passMethod} onValueChange={setPassMethod}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select..." /></SelectTrigger>
                        <SelectContent>
                          {['left', 'right', 'hand', 'other'].map((v) => <SelectItem key={v} value={v}>{toTitleCase(v)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">Style</Label>
                      <Select value={passStyle} onValueChange={setPassStyle}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select..." /></SelectTrigger>
                        <SelectContent>
                          {['high', 'chest', '1_bounce', '2plus_bounce', 'ground'].map((v) => <SelectItem key={v} value={v}>{toTitleCase(v)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Buttons label="Pressure on Passer" value={passPressure} onChange={setPassPressure} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Med' }, { value: 'high', label: 'High' }]} />
                  <div className="space-y-2">
                    <Label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">Outcome</Label>
                    <Select value={passOutcome} onValueChange={setPassOutcome}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select outcome..." /></SelectTrigger>
                      <SelectContent>
                        {['completed', 'turnover', 'foul', 'sideline_for', '45_for', 'goal_kick_for', 'goal_kick_against'].map((v) => (
                          <SelectItem key={v} value={v}>{toTitleCase(v)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <YesNo label="Deadball" value={deadball} onChange={setDeadball} />
                  {/* Counter attack doesn't need to live at the very bottom for pass/carry */}
                  <YesNo label="Counter Attack" value={counterAttack} onChange={setCounterAttack} />
                  <VideoTimeBlock
                    currentVideoTimeS={currentVideoTimeS}
                    videoTimeText={videoTimeText}
                    setVideoTimeText={setVideoTimeText}
                    setVideoTimeTouched={setVideoTimeTouched}
                    normalizedVideoTimeS={normalizedVideoTimeS}
                    videoTimeInvalid={videoTimeInvalid}
                  />
                </>
              )}
            </div>

            <div className="space-y-2">
              {action === 'shot' && !isDrag && roleButton('player')}
              {action === 'shot' && !isDrag && ['short', 'post', 'saved', 'blocked'].includes(shotOutcome) && (
                <Buttons label="Result" value={shotResult} onChange={setShotResult} options={[{ value: 'retained', label: 'Retained' }, { value: 'opposition', label: 'Opposition' }, { value: '45', label: '45' }, { value: 'wide', label: 'Wide' }]} />
              )}
              {action === 'shot' && !isDrag && (shotResult === 'retained' || shotResult === 'opposition') && (
                roleButton('shot_recovered_by')
              )}
              {action === 'shot' && !isDrag && shotOutcome === 'blocked' && (
                roleButton('shot_blocked_by')
              )}
              {action === 'shot' && !isDrag && shotOutcome === 'saved' && (
                roleButton('shot_saved_by')
              )}

              {action === 'kickout' && !isDrag && (
                <>
                  {roleButton('kickout_intended')}
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

              {action === 'defensive_contact' && !isDrag && roleButton('player')}

              {action === 'foul' && !isDrag && foulRolesBlock()}

              {action === 'turnover' && !isDrag && (
                <div className="space-y-2">
                  {turnoverRolesBlock()}
                  {turnoverType === 'foul' && foulPanel()}
                </div>
              )}

              {action === 'carry' && isDrag && (
                <>
                  {takeOnAttempted ? (
                    <div className="grid grid-cols-2 gap-2">
                      {roleButton('carrier')}
                      {roleButton('defender')}
                    </div>
                  ) : (
                    roleButton('carrier')
                  )}
                  {carryOutcome === 'turnover' && turnoverPanel({ foulLayout: 'stack' })}
                  {carryOutcome === 'foul' && foulPanel()}
                </>
              )}

              {action === 'pass' && isDrag && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    {roleButton('passer')}
                    {roleButton('pass_intended')}
                  </div>
                  {passOutcome !== 'turnover' && roleButton('pass_won_by')}
                  {passOutcome === 'turnover' && turnoverPanel({ foulLayout: 'stack' })}
                  {passOutcome === 'foul' && foulPanel()}
                </>
              )}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-200">
            <div className="grid grid-cols-3 gap-2">
              <CustomFieldInput label="Custom 1" config={customFields?.custom_1} value={custom1} onChange={setCustom1} />
              <CustomFieldInput label="Custom 2" config={customFields?.custom_2} value={custom2} onChange={setCustom2} />
              <CustomFieldInput label="Custom 3" config={customFields?.custom_3} value={custom3} onChange={setCustom3} />
            </div>
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
              onOpenBench={() => { setBenchQuery(''); setBenchOpen('away'); }}
            />
          </div>
        </div>

        {/* Bench drawer overlay */}
        {benchOpen && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
            <div className="w-full max-w-md rounded-xl bg-white shadow-xl border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-900">
                  {benchOpen === 'home' ? 'Home Bench' : 'Away Bench'}
                </div>
                <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setBenchOpen(null)}>
                  Close
                </Button>
              </div>
              <div className="pt-2">
                <Input
                  value={benchQuery}
                  onChange={(e) => setBenchQuery(e.target.value)}
                  placeholder="Search..."
                  className="h-8 text-xs"
                />
              </div>
              <div className="pt-2 max-h-80 overflow-y-auto space-y-1">
                {benchFiltered.length === 0 ? (
                  <div className="text-xs text-slate-500 py-2">No bench players found.</div>
                ) : (
                  benchFiltered.map((p) => (
                    <Button
                      key={p.id}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full justify-start h-8 text-xs"
                      onClick={() => {
                        handlePickValue(`player:${p.id}`);
                        setBenchOpen(null);
                      }}
                    >
                      {`#${p.number ?? ''} ${p.name || ''}`.trim()}
                    </Button>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-3 pt-2 border-t border-slate-200">
          <Button variant="outline" onClick={onClose} className="flex-1 h-8 text-xs">Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit()} className="flex-1 h-8 bg-green-600 hover:bg-green-700 text-xs">
            Log Stat
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
