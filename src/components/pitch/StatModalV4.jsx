import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { eventMatchesShortcut, isTypingTarget, parseShortcutConfig } from '@/lib/shortcuts';
import { shotRequiresResult } from '@/lib/reportAnalytics';

const NONE = 'none';
const TEAM_HOME = 'team:home';
const TEAM_AWAY = 'team:away';

function normalizePassAccuracy(value) {
  const accuracy = String(value || '').trim();
  return ['++', '+', '-', '--'].includes(accuracy) ? accuracy : '+';
}

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

function LiveTimeBlock({ liveClockSeconds }) {
  const seconds = Number(liveClockSeconds);
  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
      <Label className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 leading-tight">
        Live Time
      </Label>
      <div className="font-mono text-sm font-semibold text-emerald-950">
        {Number.isFinite(seconds) ? formatMMSS(seconds) : '--:--'}
      </div>
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

function getToneClasses(tone, selected) {
  if (!tone) return '';
  const tones = {
    blue: selected ? 'bg-blue-600 text-white border-blue-700 hover:bg-blue-700' : 'bg-blue-50 text-blue-800 border-blue-300 hover:bg-blue-100',
    green: selected ? 'bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-700' : 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100',
    yellow: selected ? 'bg-amber-500 text-slate-950 border-amber-600 hover:bg-amber-500' : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100',
    red: selected ? 'bg-red-600 text-white border-red-700 hover:bg-red-700' : 'bg-red-50 text-red-800 border-red-300 hover:bg-red-100',
  };
  return tones[tone] || '';
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
        {options.map((opt) => {
          const selected = value === opt.value;
          const toneClasses = getToneClasses(opt.tone, selected);
          return (
            <Button
              key={opt.value}
              type="button"
              variant={opt.tone ? 'outline' : (selected ? 'default' : 'outline')}
              size="sm"
              className={[
                'h-8 px-2 text-xs whitespace-nowrap',
                toneClasses,
                opt.tone && selected ? 'ring-2 ring-slate-900/20' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => onChange(opt.value)}
            >
              {opt.label}
            </Button>
          );
        })}
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
  { value: 'throw', label: 'Throw' },
  { value: 'bodycheck', label: 'Bodycheck' },
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
  previousStat,
  customFields, // { custom_1..custom_3: { enabled, label, options[] } }
  shortcutConfig,
  defaultCounterAttack = false,
  homeAttacksRight = true,
  liveMode = false,
  liveClockSeconds = null,
  liveModeSettings = null,
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
  const [broughtBackAdv, setBroughtBackAdv] = useState(false);

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
  const [kickoutPress, setKickoutPress] = useState('m2m');

  // Shot
  const [shotType, setShotType] = useState('');
  const [shotTypeTouched, setShotTypeTouched] = useState(false);
  const [shotSituation, setShotSituation] = useState('play');
  const [shotMethod, setShotMethod] = useState('right');
  const [shotPressure, setShotPressure] = useState('');
  const [shotOutcome, setShotOutcome] = useState('');
  const [shotOutcomeTouched, setShotOutcomeTouched] = useState(false);
  const [shotResult, setShotResult] = useState('');
  const [shotRecoveredBy, setShotRecoveredBy] = useState(NONE);
  const [shotBlockedBy, setShotBlockedBy] = useState(NONE);
  const [shotSavedBy, setShotSavedBy] = useState(NONE);
  const [shotBroughtBackAdv, setShotBroughtBackAdv] = useState(false);

  const parsedVideoTimeS = useMemo(() => parseMMSS(videoTimeText), [videoTimeText]);
  const videoTimeInvalid = !!String(videoTimeText || '').trim() && !Number.isFinite(parsedVideoTimeS);
  const normalizedVideoTimeS = useMemo(() => {
    if (!Number.isFinite(parsedVideoTimeS)) return null;
    const hs = Number(halfStartTimeS);
    if (!Number.isFinite(hs)) return null;
    return parsedVideoTimeS - hs;
  }, [parsedVideoTimeS, halfStartTimeS]);
  const liveNormalizedTimeS = Number(liveClockSeconds);
  const fallbackInitialNormalizedTimeS = Number(initialStat?.normalized_time_s);
  const renderTimeBlock = () => liveMode ? (
    <LiveTimeBlock liveClockSeconds={liveClockSeconds} />
  ) : (
    <VideoTimeBlock
      currentVideoTimeS={currentVideoTimeS}
      videoTimeText={videoTimeText}
      setVideoTimeText={setVideoTimeText}
      setVideoTimeTouched={setVideoTimeTouched}
      normalizedVideoTimeS={normalizedVideoTimeS}
      videoTimeInvalid={videoTimeInvalid}
    />
  );

  // Carry (drag)
  const [carrier, setCarrier] = useState(NONE);
  const [carrierPressure, setCarrierPressure] = useState('low');
  const [takeOnStatus, setTakeOnStatus] = useState('no');
  const [defender, setDefender] = useState(NONE);
  const [carryOutcome, setCarryOutcome] = useState('completed');
  const [soloPlusGo, setSoloPlusGo] = useState(false);

  // Pass (drag)
  const [passer, setPasser] = useState(NONE);
  const [passIntendedRecipient, setPassIntendedRecipient] = useState(NONE);
  const [passMethod, setPassMethod] = useState('hand');
  const [passAccuracy, setPassAccuracy] = useState('+');
  const [passPressure, setPassPressure] = useState('low');
  const [passOutcome, setPassOutcome] = useState('completed');
  const [passWonBy, setPassWonBy] = useState(NONE);
  const [deadball, setDeadball] = useState(false);
  const numberBufferRef = useRef('');
  const numberBufferTimerRef = useRef(null);
  const preferredSideRef = useRef(null);
  const preferredSideTimerRef = useRef(null);
  const previousActionRef = useRef(action);
  const previousTurnoverContextRef = useRef(false);
  const liveSettingEnabled = (key) => !liveMode || liveModeSettings?.[key] !== false;

  const safeParse = (s) => {
    try { return JSON.parse(s); } catch { return {}; }
  };
  const teamValue = (side) => (side === 'home' ? TEAM_HOME : side === 'away' ? TEAM_AWAY : NONE);
  const oppositeTeamValue = (side) => (side === 'home' ? TEAM_AWAY : side === 'away' ? TEAM_HOME : NONE);
  const shortcuts = useMemo(() => parseShortcutConfig(shortcutConfig), [shortcutConfig]);
  const previousShotOppositeSide =
    previousStat?.stat_type === 'shot'
      ? (previousStat?.team_side === 'home' ? 'away' : previousStat?.team_side === 'away' ? 'home' : null)
      : null;
  const previousShotNeedsKickout =
    previousStat?.stat_type === 'shot' && (() => {
      const ex = safeParse(previousStat?.extra_data || '{}');
      const outcome = String(ex?.shot?.outcome || '');
      return outcome === 'wide' || ['goal', 'point', '2_point'].includes(outcome);
    })();
  const rosters = useMemo(() => {
    // Prefer explicit rosters (can be ordered), fall back to homePlayers/awayPlayers.
    return {
      home: (homeRoster && Array.isArray(homeRoster)) ? homeRoster : homePlayers,
      away: (awayRoster && Array.isArray(awayRoster)) ? awayRoster : awayPlayers,
    };
  }, [homeRoster, awayRoster, homePlayers, awayPlayers]);

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
    setAction(initialStat.stat_type || (isDrag ? 'pass' : (previousShotNeedsKickout ? 'kickout' : 'shot')));
    setCounterAttack(
      typeof initialStat.set_defence === 'boolean'
        ? !!initialStat.set_defence
        : (typeof initialStat.counter_attack === 'boolean' ? !!initialStat.counter_attack : true)
    );

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
    setBroughtBackAdv(false);
    setThrowOutcome('');
    setWonBy(NONE);
    setThrowLostBy(NONE);
    setBrokenBy(NONE);
    setKickoutTeam(extra?.kickout?.team_side || initialStat.team_side || previousShotOppositeSide || 'home');
    setKickoutOutcome('');
    setIntendedRecipient(NONE);
    setKickoutWonBy(NONE);
    setKickoutLostBy(NONE);
    setKickoutBrokenBy(NONE);
    setKickoutMark(false);
    setKickoutPress('m2m');
    setShotType('');
    setShotTypeTouched(false);
    setShotSituation('play');
    setShotMethod('right');
    setShotPressure('low');
    setShotOutcome('');
    setShotOutcomeTouched(false);
    setShotResult('');
    setShotRecoveredBy(NONE);
    setShotBlockedBy(NONE);
    setShotSavedBy(NONE);
    setShotBroughtBackAdv(false);
    setCarrier(NONE);
    setCarrierPressure('low');
    setTakeOnStatus('no');
    setDefender(NONE);
    setCarryOutcome('completed');
    setSoloPlusGo(false);
    setPasser(NONE);
    setPassIntendedRecipient(NONE);
    setPassMethod('hand');
    setPassAccuracy('+');
    setPassPressure('low');
    setPassOutcome('completed');
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
      setShotTypeTouched(true);
      setShotSituation(extra?.shot?.situation || '');
      setShotMethod(extra?.shot?.method || '');
      setShotPressure(extra?.shot?.pressure || '');
      setShotOutcome(extra?.shot?.outcome || '');
      setShotOutcomeTouched(true);
      setShotResult(extra?.shot?.result || '');
      setShotRecoveredBy(selectionToValue(extra?.shot?.recovered_by));
      setShotBlockedBy(selectionToValue(extra?.shot?.blocked_by));
      setShotSavedBy(selectionToValue(extra?.shot?.saved_by));
      setShotBroughtBackAdv(!!extra?.shot?.brought_back_adv);
    } else if (type === 'kickout') {
      setKickoutTeam(extra?.kickout?.team_side || initialStat.team_side || 'home');
      setKickoutOutcome(extra?.kickout?.outcome || '');
      setIntendedRecipient(selectionToValue(extra?.kickout?.intended_recipient));
      setKickoutWonBy(selectionToValue(extra?.kickout?.won_by));
      setKickoutLostBy(selectionToValue(extra?.kickout?.lost_by));
      setKickoutBrokenBy(selectionToValue(extra?.kickout?.broken_by));
      setKickoutMark(!!extra?.kickout?.mark);
      setKickoutPress(extra?.kickout?.press || '');
    } else if (type === 'foul') {
      setPrimaryPlayer(selectionToValue(extra?.foul?.foul_by));
    } else if (type === 'turnover') {
      setTurnoverType(extra?.turnover?.turnover_type || '');
      setLostBy(selectionToValue(extra?.turnover?.lost_by));
      setForcedBy(selectionToValue(extra?.turnover?.forced_by));
      setRecoveredBy(selectionToValue(extra?.turnover?.recovered_by));
      setUnforced(!!extra?.turnover?.unforced);
      setBroughtBackAdv(!!extra?.turnover?.brought_back_adv);
    } else if (type === 'throw_in') {
      setThrowOutcome(extra?.throw_in?.outcome || '');
      setWonBy(selectionToValue(extra?.throw_in?.won_by));
      setThrowLostBy(selectionToValue(extra?.throw_in?.lost_by));
      setBrokenBy(selectionToValue(extra?.throw_in?.broken_by));
    } else if (type === 'carry') {
      setCarrier(selectionToValue(extra?.carry?.carrier));
      setCarrierPressure(extra?.carry?.pressure_on_carrier || 'low');
      setTakeOnStatus(extra?.carry?.take_on || (extra?.carry?.take_on_attempted ? (extra?.carry?.take_on_completed ? 'completed' : 'failed') : 'no'));
      setDefender(selectionToValue(extra?.carry?.defender));
      setCarryOutcome(extra?.carry?.outcome || '');
      setSoloPlusGo(!!extra?.carry?.solo_plus_go);
      setRecoveredBy(selectionToValue(extra?.carry?.recovered_by));
    } else if (type === 'pass') {
      setPasser(selectionToValue(extra?.pass?.passer));
      setPassIntendedRecipient(selectionToValue(extra?.pass?.intended_recipient));
      setPassMethod(extra?.pass?.method === 'other' ? 'hand' : (extra?.pass?.method || ''));
      setPassAccuracy(normalizePassAccuracy(extra?.pass?.accuracy));
      setPassPressure(extra?.pass?.pressure_on_passer || 'low');
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
  }, [open, initialStat?.id, previousShotNeedsKickout]);

  useEffect(() => {
    if (!open || action !== 'shot') return;
    if (initialStat?.id) return;
    setShotBroughtBackAdv(false);
  }, [open, action, initialStat?.id]);

  useEffect(() => {
    if (!open) return;
    const actionShortcuts = isDrag ? (shortcuts?.stat_drag || {}) : (shortcuts?.stat_click || {});
    const videoShortcuts = Object.values(shortcuts?.video || {}).filter(Boolean);
    const onKeyDown = (e) => {
      if (isTypingTarget(e.target)) return;
      if (e.defaultPrevented) return;
      if (videoShortcuts.some((shortcut) => eventMatchesShortcut(e, shortcut))) return;
      const lower = String(e.key || '').toLowerCase();
      const active = activeRole || nextUnfilledRole();
      if ((lower === 'b' || lower === 'c') && active) {
        preferredSideRef.current = lower === 'b' ? 'home' : 'away';
        if (preferredSideTimerRef.current) clearTimeout(preferredSideTimerRef.current);
        preferredSideTimerRef.current = setTimeout(() => {
          preferredSideRef.current = null;
        }, 1200);
        return;
      }

      for (const [nextAction, shortcut] of Object.entries(actionShortcuts)) {
        if (!eventMatchesShortcut(e, shortcut)) continue;
        e.preventDefault();
        setAction(nextAction);
        break;
      }

      if (/^\d$/.test(String(e.key || ''))) {
        e.preventDefault();
        if (!active) return;
        numberBufferRef.current = `${numberBufferRef.current}${e.key}`.slice(-2);
        const desiredSide = getRestrictSideForRole(active) || preferredSideRef.current;
        const sides = desiredSide ? [desiredSide] : ['home', 'away'];
        const pool = sides.flatMap((side) => (rosters?.[side] || []).map((p) => ({ ...p, team_side: side })));
        const buffer = numberBufferRef.current;
        const exactMatches = pool.filter((p) => String(p?.number ?? '') === buffer);
        const canExtend = pool.some((p) => String(p?.number ?? '').startsWith(buffer) && String(p?.number ?? '') !== buffer);
        if (exactMatches.length === 1 && (buffer.length >= 2 || !canExtend)) {
          handlePickValue(`player:${exactMatches[0].id}`);
          numberBufferRef.current = '';
          preferredSideRef.current = null;
          if (numberBufferTimerRef.current) clearTimeout(numberBufferTimerRef.current);
          if (preferredSideTimerRef.current) clearTimeout(preferredSideTimerRef.current);
          return;
        }
        if (numberBufferTimerRef.current) clearTimeout(numberBufferTimerRef.current);
        numberBufferTimerRef.current = setTimeout(() => {
          const buffered = numberBufferRef.current;
          const delayedMatches = pool.filter((p) => String(p?.number ?? '') === buffered);
          if (delayedMatches.length === 1) {
            handlePickValue(`player:${delayedMatches[0].id}`);
          }
          numberBufferRef.current = '';
          preferredSideRef.current = null;
        }, 2200);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      if (numberBufferTimerRef.current) clearTimeout(numberBufferTimerRef.current);
      if (preferredSideTimerRef.current) clearTimeout(preferredSideTimerRef.current);
    };
  }, [open, isDrag, shortcuts, activeRole, rosters, touchedRoles, action, passOutcome, carryOutcome, kickoutOutcome, turnoverType, shotOutcome, shotResult, passer, passIntendedRecipient, passWonBy, intendedRecipient, kickoutWonBy, kickoutLostBy, kickoutBrokenBy, carrier, defender, foulBy, foulOn, lostBy, forcedBy, recoveredBy, wonBy, throwLostBy, brokenBy, shotRecoveredBy, shotBlockedBy, shotSavedBy]);

  // Defaulting to last receiver on open.
  useEffect(() => {
    if (!open) return;
    if (initialStat) return;
    const def = selectionToValue(defaultReceiver);
    setPassMethod('hand');
    setPassAccuracy('+');
    setPassPressure('low');
    setPassOutcome('completed');
    setDeadball(false);
    setCarrierPressure('low');
    setCarryOutcome('completed');
    setTakeOnStatus('no');
    setDefender(NONE);
    setSoloPlusGo(false);
    setShotSituation('play');
    setShotMethod('right');
    setKickoutPress('m2m');
    if (!isDrag) {
      // Defaults for click-based actors.
      setPrimaryPlayer(def);
      setFoulOn(def);
    } else {
      setPasser(def);
      setCarrier(def);
    }
    setCounterAttack(!!defaultCounterAttack);
    setActiveRole(null);
    setTouchedRoles({});
    setShotOutcomeTouched(false);
    setShotTypeTouched(false);
    setVideoTimeTouched(false);
    setBroughtBackAdv(false);
    if (Number.isFinite(Number(currentVideoTimeS))) {
      setVideoTimeText(formatMMSS(Number(currentVideoTimeS)));
    } else {
      setVideoTimeText('');
    }
    if (!initialStat?.id) {
      setAction(isDrag ? 'pass' : (previousShotNeedsKickout ? 'kickout' : 'shot'));
    }
  }, [open, defaultCounterAttack, defaultReceiver, initialStat?.id, isDrag, previousShotNeedsKickout]); // intentionally seeded on open

  useEffect(() => {
    if (!open) return;
    if (initialStat?.id) return;
    const previousAction = previousActionRef.current;
    previousActionRef.current = action;
    if (action === 'pass') {
      if (!passMethod) setPassMethod('hand');
      if (!passAccuracy) setPassAccuracy('+');
      if (!passPressure) setPassPressure('low');
      if (!passOutcome) setPassOutcome('completed');
      if (previousAction !== 'pass') {
        setDeadball(false);
        setPassIntendedRecipient(NONE);
        setPassWonBy(NONE);
      }
    }
    if (action === 'carry') {
      if (!carrierPressure) setCarrierPressure('low');
      if (!carryOutcome) setCarryOutcome('completed');
      if (previousAction !== 'carry') {
        setSoloPlusGo(false);
        setTakeOnStatus('no');
        setDefender(NONE);
      }
    }
    if (action === 'foul' && previousAction !== 'foul') {
      setCard('none');
    }
    if (liveMode && liveModeSettings?.showTurnoverType === false && !turnoverType) {
      setTurnoverType('tackle');
    }
    if (action === 'shot') {
      if (!shotPressure) setShotPressure('low');
      if (!shotSituation) {
        setShotSituation(previousStat?.stat_type === 'foul' ? 'free_hands' : 'play');
      }
      if (!shotMethod) setShotMethod('right');
    }
    if (action === 'kickout' && !kickoutPress) {
      setKickoutPress('m2m');
    }
    if (action === 'kickout' && previousAction !== 'kickout' && previousShotOppositeSide && !initialStat?.id) {
      setKickoutTeam(previousShotOppositeSide);
    }
    if (action === 'kickout' && previousAction !== 'kickout') {
      setIntendedRecipient(NONE);
      setKickoutWonBy(NONE);
    }
  }, [open, initialStat?.id, action, passMethod, passAccuracy, passPressure, passOutcome, deadball, carrierPressure, carryOutcome, shotPressure, shotSituation, shotMethod, kickoutPress, previousStat?.stat_type, previousShotOppositeSide, liveMode, liveModeSettings?.showTurnoverType, turnoverType]);

  useEffect(() => {
    if (!open) return;
    if (initialStat?.id) return;
    if (action !== 'pass' && deadball) {
      setDeadball(false);
    }
  }, [open, initialStat?.id, action, deadball]);

  const ctx = useMemo(() => ({ homePlayers, awayPlayers }), [homePlayers, awayPlayers]);

  useEffect(() => {
    if (action !== 'carry') return;
    if (carrierPressure !== 'high' && takeOnStatus === 'no' && defender !== NONE) {
      setDefender(NONE);
    }
  }, [action, carrierPressure, takeOnStatus, defender]);

  useEffect(() => {
    if (action !== 'carry') return;
    if (defender === NONE) return;
    const carrierSide = makeSelection(carrier, ctx).team_side;
    const defenderSide = makeSelection(defender, ctx).team_side;
    if ((carrierSide === 'home' || carrierSide === 'away') && defenderSide === carrierSide) {
      setDefender(NONE);
    }
  }, [action, carrier, defender, ctx]);

  useEffect(() => {
    if (!open) return;
    if (initialStat?.id) return;
    const turnoverContext =
      action === 'turnover'
      || (action === 'pass' && passOutcome === 'turnover')
      || (action === 'carry' && carryOutcome === 'turnover');
    if (turnoverContext && !previousTurnoverContextRef.current) {
      setBroughtBackAdv(false);
    } else if (!turnoverContext && broughtBackAdv) {
      setBroughtBackAdv(false);
    }
    previousTurnoverContextRef.current = turnoverContext;
  }, [open, initialStat?.id, action, passOutcome, carryOutcome, broughtBackAdv]);

  useEffect(() => {
    if (!open) return;
    if (initialStat?.id) return;
    if (action !== 'shot') return;
    if (shotTypeTouched) return;
    if (!startCoords) return;

    const actingShotSide = makeSelection(primaryPlayer, ctx).team_side || teamSide || 'home';
    const rawX = Number(startCoords?.x);
    const rawY = Number(startCoords?.y);
    if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return;

    const actingAttacksRight = actingShotSide === 'home' ? homeAttacksRight : !homeAttacksRight;
    const normX = actingAttacksRight ? rawX : 145 - rawX;
    const normY = actingAttacksRight ? rawY : 85 - rawY;
    const dx = 145 - normX;
    const dy = 42.5 - normY;
    const distance = Math.sqrt((dx * dx) + (dy * dy));
    const inferred = distance > 40 ? '2_point' : (distance < 10 ? 'goal' : 'point');
    if (shotType !== inferred) setShotType(inferred);
  }, [open, initialStat?.id, action, shotTypeTouched, startCoords, primaryPlayer, ctx, teamSide, shotType, homeAttacksRight]);

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
    const isTurnoverContext =
      action === 'turnover'
      || (action === 'pass' && passOutcome === 'turnover' && turnoverType !== 'foul')
      || (action === 'carry' && carryOutcome === 'turnover' && turnoverType !== 'foul');
    if (initialStat) return;
    if (!isTurnoverContext) return;
    if (touchedRoles?.recovered_by) return;
    setRecoveredBy(forcedBy !== NONE ? forcedBy : NONE);
  }, [forcedBy, action, passOutcome, carryOutcome, turnoverType, touchedRoles, initialStat]);

  useEffect(() => {
    const isTurnoverContext =
      action === 'turnover'
      || (action === 'pass' && passOutcome === 'turnover' && turnoverType !== 'foul')
      || (action === 'carry' && carryOutcome === 'turnover' && turnoverType !== 'foul');
    if (initialStat) return;
    if (!isTurnoverContext) return;
    const lostSide = makeSelection(lostBy, ctx).team_side;
    const forcedSide = makeSelection(forcedBy, ctx).team_side;
    const recoveredSide = makeSelection(recoveredBy, ctx).team_side;
    const requiredSide =
      lostSide === 'home' ? 'away'
        : lostSide === 'away' ? 'home'
        : (forcedSide === 'home' || forcedSide === 'away' ? forcedSide : null);
    if (!requiredSide) return;
    if (recoveredSide && recoveredSide !== requiredSide) {
      setRecoveredBy(requiredSide === 'home' ? TEAM_HOME : TEAM_AWAY);
    }
  }, [action, passOutcome, carryOutcome, turnoverType, lostBy, forcedBy, recoveredBy, ctx, initialStat]);

  // Pass turnover defaults:
  // - lost_by defaults to passer
  // - forced_by + recovered_by default to won_by
  useEffect(() => {
    if (initialStat) return;
    if (!isDrag) return;
    if (action !== 'pass') return;
    if (passOutcome !== 'turnover') return;

    if (lostBy === NONE && passer !== NONE) setLostBy(passer);
    if (passWonBy !== NONE) {
      if (forcedBy === NONE) setForcedBy(passWonBy);
      if (recoveredBy === NONE) setRecoveredBy(passWonBy);
    }
  }, [isDrag, action, passOutcome, passer, passWonBy, lostBy, forcedBy, recoveredBy, initialStat]);

  useEffect(() => {
    if (initialStat) return;
    if (!isDrag) return;
    if (action !== 'carry') return;
    if (carryOutcome !== 'turnover') return;
    if (lostBy === NONE && carrier !== NONE) setLostBy(carrier);
  }, [isDrag, action, carryOutcome, carrier, lostBy, initialStat]);

  // Pass default: "Won By" should default to the intended recipient (when it's a player) if not set.
  useEffect(() => {
    if (!open) return;
    if (initialStat) return;
    if (!isDrag) return;
    if (action !== 'pass') return;
    if (passOutcome === 'turnover') return; // "won_by" is not used for turnover passes
    if (touchedRoles?.pass_won_by) return;
    if (!passIntendedRecipient || passIntendedRecipient === NONE) {
      if (passWonBy !== NONE) setPassWonBy(NONE);
      return;
    }
    if (!String(passIntendedRecipient).startsWith('player:')) return;
    if (passWonBy !== passIntendedRecipient) setPassWonBy(passIntendedRecipient);
  }, [open, isDrag, action, passOutcome, passWonBy, passIntendedRecipient, touchedRoles, initialStat]);

  useEffect(() => {
    if (!open) return;
    if (initialStat) return;
    if (!isDrag) return;
    if (action !== 'pass') return;
    if (passOutcome !== 'turnover') return;
    if (passWonBy === NONE) return;
    if (touchedRoles?.pass_won_by) return;
    setPassWonBy(NONE);
  }, [open, isDrag, action, passOutcome, passWonBy, touchedRoles, initialStat]);

  useEffect(() => {
    if (!open) return;
    if (initialStat) return;
    if (!isDrag) return;
    if (action !== 'pass') return;
    if (passOutcome !== 'completed') return;
    const side = makeSelection(passIntendedRecipient, ctx).team_side || makeSelection(passer, ctx).team_side;
    if (side !== 'home' && side !== 'away') return;
    const wonSide = makeSelection(passWonBy, ctx).team_side;
    if (wonSide && wonSide !== side) {
      setPassWonBy(side === 'home' ? TEAM_HOME : TEAM_AWAY);
    }
  }, [open, isDrag, action, passOutcome, passWonBy, passIntendedRecipient, passer, ctx, initialStat]);

  useEffect(() => {
    if (!open) return;
    if (initialStat?.id) return;
    if (action !== 'kickout') return;
    if (kickoutOutcome === 'sideline_against' || kickoutOutcome === 'sideline_for') return;
    if (touchedRoles?.kickout_won_by) return;
    if (!intendedRecipient || intendedRecipient === NONE) {
      if (kickoutWonBy !== NONE) setKickoutWonBy(NONE);
      return;
    }
    if (!String(intendedRecipient).startsWith('player:')) return;
    if (kickoutWonBy !== intendedRecipient) setKickoutWonBy(intendedRecipient);
  }, [open, initialStat?.id, action, kickoutOutcome, kickoutWonBy, intendedRecipient, touchedRoles]);

  useEffect(() => {
    if (!open) return;
    if (action !== 'kickout') return;
    if (touchedRoles?.kickout_won_by) return;
    const target =
      kickoutOutcome === 'sideline_against'
        ? oppositeTeamValue(kickoutTeam)
        : kickoutOutcome === 'sideline_for'
          ? teamValue(kickoutTeam)
          : NONE;
    if (target !== NONE && kickoutWonBy !== target) setKickoutWonBy(target);
  }, [open, action, kickoutOutcome, kickoutTeam, kickoutWonBy, touchedRoles]);

  useEffect(() => {
    if (!open) return;
    if (initialStat) return;
    if (action !== 'kickout') return;
    if (touchedRoles?.kickout_lost_by) return;
    const wonSide = makeSelection(kickoutWonBy, ctx).team_side;
    if (wonSide !== 'home' && wonSide !== 'away') return;
    const oppositeValue = wonSide === 'home' ? TEAM_AWAY : TEAM_HOME;
    if (kickoutLostBy !== oppositeValue) setKickoutLostBy(oppositeValue);
  }, [open, action, kickoutWonBy, kickoutLostBy, touchedRoles, ctx, initialStat]);

  useEffect(() => {
    if (!open) return;
    if (initialStat) return;
    if (action !== 'throw_in') return;
    if (touchedRoles?.throw_lost_by) return;
    const wonSide = makeSelection(wonBy, ctx).team_side;
    if (wonSide !== 'home' && wonSide !== 'away') return;
    const oppositeValue = wonSide === 'home' ? TEAM_AWAY : TEAM_HOME;
    if (throwLostBy !== oppositeValue) setThrowLostBy(oppositeValue);
  }, [open, action, wonBy, throwLostBy, touchedRoles, ctx, initialStat]);

  useEffect(() => {
    if (!open) return;
    if (initialStat) return;
    if (action !== 'carry') return;
    if (carryOutcome !== 'foul') return;
    if (touchedRoles?.foul_on) return;
    if (!carrier || carrier === NONE) return;
    setFoulOn(carrier);
  }, [open, action, carryOutcome, carrier, touchedRoles, initialStat]);

  useEffect(() => {
    if (!open) return;
    if (initialStat) return;
    if (action !== 'shot') return;
    const supportsResult = ['short', 'saved', 'blocked', 'post'].includes(String(shotOutcome || ''));
    if (!supportsResult) {
      if (shotResult) setShotResult('');
      if (!touchedRoles?.shot_recovered_by && shotRecoveredBy !== NONE) setShotRecoveredBy(NONE);
      if (!touchedRoles?.shot_blocked_by && shotBlockedBy !== NONE) setShotBlockedBy(NONE);
      if (!touchedRoles?.shot_saved_by && shotSavedBy !== NONE) setShotSavedBy(NONE);
      return;
    }
    const requiresRecoveredBy =
      ['retained', 'opposition'].includes(String(shotResult || ''));
    if (!requiresRecoveredBy && !touchedRoles?.shot_recovered_by && shotRecoveredBy !== NONE) {
      setShotRecoveredBy(NONE);
    }
    if (shotOutcome !== 'blocked' && !touchedRoles?.shot_blocked_by && shotBlockedBy !== NONE) {
      setShotBlockedBy(NONE);
    }
    if (shotOutcome !== 'saved' && !touchedRoles?.shot_saved_by && shotSavedBy !== NONE) {
      setShotSavedBy(NONE);
    }
  }, [open, action, shotOutcome, shotResult, shotRecoveredBy, shotBlockedBy, shotSavedBy, touchedRoles, initialStat]);

  useEffect(() => {
    if (!open) return;
    if (initialStat) return;
    if (action !== 'shot') return;
    if (!['blocked', 'short', 'saved', 'post'].includes(String(shotOutcome || ''))) return;
    if (!['retained', 'opposition'].includes(String(shotResult || ''))) return;
    if (touchedRoles?.shot_recovered_by) return;
    const shooterSide = makeSelection(primaryPlayer, ctx).team_side;
    if (shooterSide !== 'home' && shooterSide !== 'away') return;
    const requiredTeam = shotResult === 'retained'
      ? shooterSide
      : (shooterSide === 'home' ? 'away' : 'home');
    const requiredValue = requiredTeam === 'away' ? TEAM_AWAY : TEAM_HOME;
    if (shotRecoveredBy !== requiredValue) setShotRecoveredBy(requiredValue);
  }, [open, action, shotOutcome, shotResult, shotRecoveredBy, primaryPlayer, touchedRoles, ctx, initialStat]);

  const isRoleFilled = (roleKey, value) => {
    if (!roleKey) return false;
    if (value && value !== NONE) return true;
    if (value === NONE) return !!touchedRoles?.[roleKey];
    return false;
  };

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
    if (action === 'foul') return ['foul_by', 'foul_on'];
    if (action === 'turnover') {
      if (turnoverType === 'foul') return ['foul_on', 'foul_by'];
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
      const base = passOutcome === 'turnover' ? ['pass_intended', 'passer'] : ['pass_intended', 'passer', 'pass_won_by'];
      if (passOutcome === 'turnover') return base.concat(turnoverType === 'foul' ? ['foul_on', 'foul_by'] : ['lost_by', 'forced_by', 'recovered_by']);
      if (passOutcome === 'foul') return base.concat(['foul_by', 'foul_on']);
      return base;
    }
    if (action === 'carry') {
      const base = ['carrier'].concat((carrierPressure === 'high' || takeOnStatus !== 'no') ? ['defender'] : []);
      if (carryOutcome === 'turnover') return base.concat(turnoverType === 'foul' ? ['foul_on', 'foul_by'] : ['lost_by', 'forced_by', 'recovered_by']);
      if (carryOutcome === 'foul') return base.concat(['foul_by', 'foul_on']);
      if (carryOutcome === 'dispossessed_retained') return base.concat(['recovered_by']);
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
    takeOnStatus,
    carrierPressure,
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
    if (k === 'pass_won_by') {
      const side = makeSelection(passIntendedRecipient, ctx).team_side || makeSelection(passer, ctx).team_side;
      return side === 'home' || side === 'away' ? side : null;
    }
    if (k === 'kickout_intended') return kickoutTeam === 'home' || kickoutTeam === 'away' ? kickoutTeam : null;
    if (k === 'defender' && action === 'carry') {
      const carrierSide = makeSelection(carrier, ctx).team_side;
      if (carrierSide === 'home') return 'away';
      if (carrierSide === 'away') return 'home';
    }
    if (k === 'recovered_by') {
      if (action === 'carry' && carryOutcome === 'dispossessed_retained') {
        const carrierSide = makeSelection(carrier, ctx).team_side;
        return carrierSide === 'home' || carrierSide === 'away' ? carrierSide : null;
      }
      const lostSide = makeSelection(lostBy, ctx).team_side;
      if (lostSide === 'home') return 'away';
      if (lostSide === 'away') return 'home';
      const forcedSide = makeSelection(forcedBy, ctx).team_side;
      return forcedSide === 'home' || forcedSide === 'away' ? forcedSide : null;
    }
    if (k === 'shot_recovered_by' && ['blocked', 'short', 'saved', 'post'].includes(String(shotOutcome || ''))) {
      const shooterSide = makeSelection(primaryPlayer, ctx).team_side;
      if (shooterSide !== 'home' && shooterSide !== 'away') return null;
      if (shotResult === 'retained') return shooterSide;
      if (shotResult === 'opposition') return shooterSide === 'home' ? 'away' : 'home';
    }
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
    if (!roleOrder.includes(activeRole)) {
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
    takeOnStatus,
    carrierPressure,
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

  useEffect(() => {
    if (!open) return;
    if (initialStat?.id) return;
    if (action !== 'pass') return;
    if (!activeRole) setActiveRole('pass_intended');
  }, [open, initialStat?.id, action, activeRole]);

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
      {liveSettingEnabled('showFoulCard') && <CardSwatches value={card} onChange={setCard} />}
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
      {liveSettingEnabled('showFoulCard') && <div className="pt-2">
        <CardSwatches value={card} onChange={setCard} />
      </div>}
    </div>
  );

  const turnoverRolesBlock = () => (
    <div className="grid grid-cols-2 gap-2">
      {roleButton('lost_by')}
      {roleButton('forced_by')}
      {turnoverType !== 'foul' && !liveMode && roleButton('recovered_by')}
    </div>
  );

  const turnoverFieldsBlock = () => (
    <div className="space-y-2">
      {liveSettingEnabled('showTurnoverType') && (
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
                { value: 'sideline_against', label: 'Sideline Against' },
              ].map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <YesNo label="Unforced" value={unforced} onChange={setUnforced} />
      {liveSettingEnabled('showTurnoverBroughtBackAdv') && <YesNo label="Brought Back - Adv." value={broughtBackAdv} onChange={setBroughtBackAdv} />}
    </div>
  );

  const turnoverPanel = ({ foulLayout = 'side' } = {}) => (
    <div className="border rounded-md p-2 bg-slate-50">
      {turnoverType === 'foul' && foulLayout === 'stack' ? (
        <div className="space-y-2">
          {turnoverFieldsBlock()}
          {foulPanel()}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 items-start">
          <div>{turnoverFieldsBlock()}</div>
          <div className="space-y-2">
            {turnoverType !== 'foul' && turnoverRolesBlock()}
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
    if (!liveMode && videoTimeInvalid) return false;
    // Minimal validation per action.
    if (action === 'shot') {
      if (!shotOutcome || !isRoleFilled('player', primaryPlayer)) return false;
      if (!shotBroughtBackAdv && shotRequiresResult(shotOutcome) && !shotResult) return false;
      return true;
    }
    if (action === 'foul') return isRoleFilled('foul_by', foulBy) && isRoleFilled('foul_on', foulOn) && !!foulType;
    if (action === 'turnover') {
      if (!turnoverType && liveSettingEnabled('showTurnoverType')) return false;
      if (turnoverType === 'foul') {
        return isRoleFilled('foul_by', foulBy)
          && isRoleFilled('foul_on', foulOn)
          && !!foulType;
      }
      if (liveMode) return isRoleFilled('lost_by', lostBy) && isRoleFilled('forced_by', forcedBy);
      return isRoleFilled('lost_by', lostBy) && isRoleFilled('forced_by', forcedBy) && isRoleFilled('recovered_by', recoveredBy);
    }
    if (action === 'throw_in') {
      if (!throwOutcome) return false;
      if (throwOutcome === 'foul') return isRoleFilled('foul_by', foulBy) && isRoleFilled('foul_on', foulOn) && !!foulType;
      if (liveMode) return isRoleFilled('throw_won_by', wonBy) && (!liveSettingEnabled('showThrowInLostBy') || isRoleFilled('throw_lost_by', throwLostBy));
      if (throwOutcome === 'clean') return isRoleFilled('throw_won_by', wonBy) && isRoleFilled('throw_lost_by', throwLostBy);
      if (throwOutcome === 'break') return isRoleFilled('broken_by', brokenBy) && isRoleFilled('throw_won_by', wonBy) && isRoleFilled('throw_lost_by', throwLostBy);
      return false;
    }
    if (action === 'kickout') {
      if (!kickoutOutcome) return false;
      if (kickoutOutcome === 'foul') return isRoleFilled('foul_by', foulBy) && isRoleFilled('foul_on', foulOn) && !!foulType;
      if (liveMode) return isRoleFilled('kickout_won_by', kickoutWonBy) && (!liveSettingEnabled('showKickoutLostBy') || isRoleFilled('kickout_lost_by', kickoutLostBy));
      if (kickoutOutcome === 'clean') return isRoleFilled('kickout_won_by', kickoutWonBy) && isRoleFilled('kickout_lost_by', kickoutLostBy);
      if (kickoutOutcome === 'break') return isRoleFilled('kickout_broken_by', kickoutBrokenBy) && isRoleFilled('kickout_won_by', kickoutWonBy) && isRoleFilled('kickout_lost_by', kickoutLostBy);
      return true; // sideline outcomes
    }
    if (action === 'carry') {
      if (!isRoleFilled('carrier', carrier) || !carryOutcome) return false;
      if (carryOutcome === 'turnover') {
        if (!turnoverType) return false;
        if (turnoverType === 'foul') return isRoleFilled('foul_by', foulBy) && isRoleFilled('foul_on', foulOn) && !!foulType;
        return isRoleFilled('lost_by', lostBy) && isRoleFilled('forced_by', forcedBy) && isRoleFilled('recovered_by', recoveredBy);
      }
      if (carryOutcome === 'foul') return isRoleFilled('foul_by', foulBy) && isRoleFilled('foul_on', foulOn) && !!foulType;
      if (carryOutcome === 'dispossessed_retained') return isRoleFilled('recovered_by', recoveredBy);
      return true;
    }
    if (action === 'pass') {
      if (!isRoleFilled('passer', passer) || !passOutcome) return false;
      if (passOutcome === 'turnover') {
        if (!turnoverType) return false;
        if (turnoverType === 'foul') return isRoleFilled('foul_by', foulBy) && isRoleFilled('foul_on', foulOn) && !!foulType;
        return isRoleFilled('lost_by', lostBy) && isRoleFilled('forced_by', forcedBy) && isRoleFilled('recovered_by', recoveredBy);
      }
      if (passOutcome === 'foul') return isRoleFilled('foul_by', foulBy) && isRoleFilled('foul_on', foulOn) && !!foulType;
      return true;
    }
    return false;
  };

  const submit = () => {
    if (!canSubmit()) return;
    const effectiveTurnoverType = turnoverType || (liveMode && liveModeSettings?.showTurnoverType === false ? 'tackle' : '');

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
        intended_recipient: liveMode ? { kind: 'none' } : sel(intendedRecipient),
        outcome: kickoutOutcome,
        won_by: sel(kickoutWonBy),
        lost_by: sel(kickoutLostBy),
        broken_by: liveMode ? { kind: 'none' } : sel(kickoutBrokenBy),
        mark: liveMode ? false : !!kickoutMark,
        press: kickoutPress || '',
      };
      if (kickoutOutcome === 'foul') {
        extra.foul = { foul_by: sel(foulBy), foul_on: sel(foulOn), foul_type: foulType, card };
      }
    } else if (action === 'foul') {
      actingSide = makeSelection(foulOn, ctx).team_side || makeSelection(foulBy, ctx).team_side || 'unknown';
      primary = makeSelection(foulOn, ctx).kind !== 'none' ? makeSelection(foulOn, ctx) : makeSelection(foulBy, ctx);
      extra.foul = { foul_by: sel(foulBy), foul_on: sel(foulOn), foul_type: foulType, card };
    } else if (action === 'turnover') {
      const foulOnSel = sel(foulOn);
      const foulBySel = sel(foulBy);
      const forced = effectiveTurnoverType === 'foul' ? foulOnSel : sel(forcedBy);
      const lost = effectiveTurnoverType === 'foul' ? foulBySel : sel(lostBy);
      actingSide = lost.team_side || forced.team_side || 'unknown';
      primary = lost.kind !== 'none' ? lost : forced;
      extra.turnover = {
        turnover_type: effectiveTurnoverType,
        lost_by: lost,
        forced_by: forced,
        recovered_by: effectiveTurnoverType === 'foul' || liveMode ? forced : sel(recoveredBy),
        unforced: !!unforced,
        brought_back_adv: !!broughtBackAdv,
      };
      if (effectiveTurnoverType === 'foul') {
        extra.foul = { foul_by: sel(foulBy), foul_on: sel(foulOn), foul_type: foulType, card };
      }
    } else if (action === 'throw_in') {
      actingSide = makeSelection(wonBy, ctx).team_side || makeSelection(brokenBy, ctx).team_side || 'unknown';
      primary = makeSelection(wonBy, ctx);
      extra.throw_in = {
        outcome: throwOutcome,
        won_by: sel(wonBy),
        lost_by: sel(throwLostBy),
        broken_by: liveMode ? { kind: 'none' } : sel(brokenBy),
      };
      if (throwOutcome === 'foul') {
        extra.foul = { foul_by: sel(foulBy), foul_on: sel(foulOn), foul_type: foulType, card };
      }
    } else if (action === 'shot') {
      actingSide = makeSelection(primaryPlayer, ctx).team_side || 'unknown';
      primary = makeSelection(primaryPlayer, ctx);
      extra.shot = {
        player: primary,
        shot_type: shotType,
        situation: shotSituation,
        method: shotMethod,
        pressure: shotPressure,
        outcome: shotOutcome,
        result: shotResult,
        recovered_by: liveMode ? { kind: 'none' } : sel(shotRecoveredBy),
        blocked_by: sel(shotBlockedBy),
        saved_by: sel(shotSavedBy),
        brought_back_adv: !!shotBroughtBackAdv,
      };
    } else if (action === 'carry') {
      actingSide = makeSelection(carrier, ctx).team_side || 'unknown';
      primary = makeSelection(carrier, ctx);
      extra.carry = {
        carrier: sel(carrier),
        pressure_on_carrier: carrierPressure,
        take_on: takeOnStatus || 'no',
        defender: sel(defender),
        solo_plus_go: !!soloPlusGo,
        outcome: carryOutcome,
      };
      if (carryOutcome === 'dispossessed_retained') {
        extra.carry.recovered_by = sel(recoveredBy);
      }
      if (carryOutcome === 'turnover') {
        const foulOnSel = sel(foulOn);
        const foulBySel = sel(foulBy);
        const lost = effectiveTurnoverType === 'foul' ? foulBySel : sel(lostBy);
        const forced = effectiveTurnoverType === 'foul' ? foulOnSel : sel(forcedBy);
        extra.turnover = { turnover_type: effectiveTurnoverType, lost_by: lost, forced_by: forced, recovered_by: effectiveTurnoverType === 'foul' ? forced : sel(recoveredBy), unforced: !!unforced };
        extra.turnover.brought_back_adv = !!broughtBackAdv;
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
        accuracy: passAccuracy || '+',
        pressure_on_passer: passPressure,
        outcome: passOutcome,
        won_by: sel(passWonBy),
        deadball: !!deadball,
      };
      if (passOutcome === 'turnover') {
        const foulOnSel = sel(foulOn);
        const foulBySel = sel(foulBy);
        const lost = effectiveTurnoverType === 'foul' ? foulBySel : sel(lostBy);
        const forced = effectiveTurnoverType === 'foul' ? foulOnSel : sel(forcedBy);
        extra.turnover = { turnover_type: effectiveTurnoverType, lost_by: lost, forced_by: forced, recovered_by: effectiveTurnoverType === 'foul' ? forced : sel(recoveredBy), unforced: !!unforced };
        extra.turnover.brought_back_adv = !!broughtBackAdv;
      }
      if (passOutcome === 'foul') extra.foul = { foul_by: sel(foulBy), foul_on: sel(foulOn), foul_type: foulType, card };
    }

    if (liveMode) extra.live_mode = true;

    onClose?.();
    onSubmit?.({
      stat_type: action,
      is_pass: isDrag,
      team_side: actingSide,
      counter_attack: !!counterAttack,
      time_s: liveMode ? null : (Number.isFinite(parsedVideoTimeS) ? parsedVideoTimeS : null),
      normalized_time_s: liveMode
        ? (Number.isFinite(liveNormalizedTimeS) ? liveNormalizedTimeS : (Number.isFinite(fallbackInitialNormalizedTimeS) ? fallbackInitialNormalizedTimeS : null))
        : (Number.isFinite(normalizedVideoTimeS) ? normalizedVideoTimeS : null),
      primary_player: primary,
      extra,
    });
    setTimeout(() => onClose?.(), 0);
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
                  if (r === 'defender' && restrict) return 'Defender must be on the opposite team';
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
                  <Buttons label="Shot Type" value={shotType} onChange={(value) => { setShotType(value); setShotTypeTouched(true); }} options={[{ value: 'point', label: '1 Point' }, { value: '2_point', label: '2 Point' }, { value: 'goal', label: 'Goal' }]} />
                  <div className={liveMode ? "space-y-2" : "grid sm:grid-cols-2 gap-2"}>
                    {!liveMode && (
                    <div className="space-y-2">
                      <Label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">Situation</Label>
                      <Select value={shotSituation} onValueChange={setShotSituation}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select..." /></SelectTrigger>
                        <SelectContent>
                          {['play', 'free_ground', 'free_hands', '45', 'penalty', 'mark'].map((v) => <SelectItem key={v} value={v}>{toTitleCase(v)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    )}
                    {liveSettingEnabled('showShotMethod') && <Buttons label="Method" value={shotMethod} onChange={setShotMethod} options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }, { value: 'hand', label: 'Hand' }]} />}
                  </div>
                  {liveSettingEnabled('showShotPressure') && <Buttons label="Pressure" value={shotPressure} onChange={setShotPressure} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Med' }, { value: 'high', label: 'High' }]} />}
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
                  {!liveMode && <YesNo label="Set Defence" value={counterAttack} onChange={setCounterAttack} />}
                  {renderTimeBlock()}
                  {liveSettingEnabled('showShotBroughtBackAdv') && <YesNo label="Brought Back - Adv." value={shotBroughtBackAdv} onChange={setShotBroughtBackAdv} />}
                </>
              )}

              {action === 'kickout' && !isDrag && (
                <>
                  <Buttons label="Team" value={kickoutTeam} onChange={setKickoutTeam} options={[{ value: 'home', label: 'Home' }, { value: 'away', label: 'Away' }]} />
                  <Buttons
                    label="Outcome"
                    value={kickoutOutcome}
                    onChange={(v) => {
                        setKickoutOutcome(v);
                        if (v === 'sideline_against' || v === 'sideline_for') {
                          setTouchedRoles((prev) => {
                            const next = { ...(prev || {}) };
                            delete next.kickout_won_by;
                            delete next.kickout_lost_by;
                            return next;
                          });
                        }
                      }}
                    options={[
                      { value: 'clean', label: 'Clean' },
                      { value: 'break', label: 'Break' },
                      { value: 'foul', label: 'Foul' },
                      { value: 'sideline_for', label: 'Line For' },
                      { value: 'sideline_against', label: 'Line Against' },
                    ]}
                  />
                  {!liveMode && <YesNo label="Mark" value={kickoutMark} onChange={setKickoutMark} />}
                  {liveSettingEnabled('showKickoutPress') && <Buttons
                    label="Press"
                    value={kickoutPress}
                    onChange={setKickoutPress}
                    options={[
                      { value: 'm2m', label: 'M2M' },
                      { value: 'zonal', label: 'Zonal' },
                      { value: 'conceded', label: 'Conceded' },
                    ]}
                  />}
                  {renderTimeBlock()}
                </>
              )}

              {action === 'foul' && !isDrag && (
                <>
                  {foulFieldsBlock()}
                  {!liveMode && <YesNo label="Set Defence" value={counterAttack} onChange={setCounterAttack} />}
                  {renderTimeBlock()}
                </>
              )}

              {action === 'turnover' && !isDrag && (
                <>
                  {turnoverFieldsBlock()}
                  {!liveMode && <YesNo label="Set Defence" value={counterAttack} onChange={setCounterAttack} />}
                  {renderTimeBlock()}
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
                  {!liveMode && <YesNo label="Set Defence" value={counterAttack} onChange={setCounterAttack} />}
                  {renderTimeBlock()}
                </div>
              )}

              {action === 'carry' && isDrag && (
                <>
                  <Buttons label="Pressure on Carrier" value={carrierPressure} onChange={setCarrierPressure} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Med' }, { value: 'high', label: 'High' }]} />
                  <Buttons label="Take On" value={takeOnStatus} onChange={setTakeOnStatus} options={[{ value: 'no', label: 'No' }, { value: 'completed', label: 'Completed' }, { value: 'failed', label: 'Failed' }]} />
                  <YesNo label="Solo & Go" value={soloPlusGo} onChange={setSoloPlusGo} />
                  <div className="space-y-2">
                    <Label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">Outcome</Label>
                    <Select value={carryOutcome} onValueChange={setCarryOutcome}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select outcome..." /></SelectTrigger>
                      <SelectContent>
                        {['completed', 'turnover', 'foul', 'dispossessed_retained', 'turned_back', 'sideline_for', 'sideline_against', '45_for', '45_against', 'goal_kick_for', 'goal_kick_against'].map((v) => (
                          <SelectItem key={v} value={v}>{toTitleCase(v)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {/* Defence set doesn't need to live at the very bottom for pass/carry */}
                  <YesNo label="Set Defence" value={counterAttack} onChange={setCounterAttack} />
                  {renderTimeBlock()}
                </>
              )}

              {action === 'pass' && isDrag && (
                <>
                  <Buttons
                    label="Method"
                    value={passMethod}
                    onChange={setPassMethod}
                    options={[
                      { value: 'left', label: 'Left' },
                      { value: 'right', label: 'Right' },
                      { value: 'hand', label: 'Hand' },
                    ]}
                  />
                  <Buttons
                    label="Accuracy"
                    value={passAccuracy}
                    onChange={setPassAccuracy}
                    options={[
                      { value: '--', label: '--', tone: 'red' },
                      { value: '-', label: '-', tone: 'yellow' },
                      { value: '+', label: '+', tone: 'green' },
                      { value: '++', label: '++', tone: 'blue' },
                    ]}
                  />
                  <Buttons label="Pressure on Passer" value={passPressure} onChange={setPassPressure} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Med' }, { value: 'high', label: 'High' }]} />
                  <div className="space-y-2">
                    <Label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">Outcome</Label>
                    <Select value={passOutcome} onValueChange={setPassOutcome}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select outcome..." /></SelectTrigger>
                      <SelectContent>
                        {['completed', 'broken', 'turnover', 'foul', 'sideline_for', 'sideline_against', '45_for', '45_against', 'goal_kick_for', 'goal_kick_against'].map((v) => (
                          <SelectItem key={v} value={v}>{toTitleCase(v)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <YesNo label="Deadball" value={deadball} onChange={setDeadball} />
                  {/* Defence set doesn't need to live at the very bottom for pass/carry */}
                  <YesNo label="Set Defence" value={counterAttack} onChange={setCounterAttack} />
                  {renderTimeBlock()}
                </>
              )}
            </div>

            <div className="space-y-2">
              {action === 'shot' && !isDrag && roleButton('player')}
              {action === 'shot' && !isDrag && ['short', 'post', 'saved', 'blocked'].includes(shotOutcome) && (
                <Buttons label="Result" value={shotResult} onChange={setShotResult} options={[{ value: 'retained', label: 'Retained' }, { value: 'opposition', label: 'Opposition' }, { value: '45', label: '45' }, { value: 'wide', label: 'Wide' }]} />
              )}
              {action === 'shot' && !isDrag && !liveMode && (shotResult === 'retained' || shotResult === 'opposition') && (
                roleButton('shot_recovered_by')
              )}
              {action === 'shot' && !isDrag && liveSettingEnabled('showShotBlockedSavedBy') && shotOutcome === 'blocked' && (
                roleButton('shot_blocked_by')
              )}
              {action === 'shot' && !isDrag && liveSettingEnabled('showShotBlockedSavedBy') && shotOutcome === 'saved' && (
                roleButton('shot_saved_by')
              )}

              {action === 'kickout' && !isDrag && (
                <>
                  {!liveMode && roleButton('kickout_intended')}
                  {(liveMode && kickoutOutcome && kickoutOutcome !== 'foul') && (
                    <div className="grid grid-cols-2 gap-2">
                      {roleButton('kickout_won_by')}
                      {liveSettingEnabled('showKickoutLostBy') && roleButton('kickout_lost_by')}
                    </div>
                  )}
                  {(!liveMode && kickoutOutcome === 'clean') && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        {roleButton('kickout_won_by')}
                        {roleButton('kickout_lost_by')}
                      </div>
                    </>
                  )}
                  {(!liveMode && kickoutOutcome === 'break') && (
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
                  {(liveMode && throwOutcome && throwOutcome !== 'foul') && (
                    <div className="grid grid-cols-2 gap-2">
                      {roleButton('throw_won_by')}
                      {liveSettingEnabled('showThrowInLostBy') && roleButton('throw_lost_by')}
                    </div>
                  )}
                  {(!liveMode && throwOutcome === 'clean') && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        {roleButton('throw_won_by')}
                        {roleButton('throw_lost_by')}
                      </div>
                    </>
                  )}
                  {(!liveMode && throwOutcome === 'break') && (
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

              {action === 'foul' && !isDrag && foulRolesBlock()}

              {action === 'turnover' && !isDrag && (
                <div className="space-y-2">
                  {turnoverType !== 'foul' && turnoverRolesBlock()}
                  {turnoverType === 'foul' && foulPanel()}
                </div>
              )}

              {action === 'carry' && isDrag && (
                <>
                  {(carrierPressure === 'high' || takeOnStatus !== 'no') ? (
                    <div className="grid grid-cols-2 gap-2">
                      {roleButton('carrier')}
                      {roleButton('defender')}
                    </div>
                  ) : (
                    roleButton('carrier')
                  )}
                  {carryOutcome === 'turnover' && turnoverPanel({ foulLayout: 'stack' })}
                  {carryOutcome === 'foul' && foulPanel()}
                  {carryOutcome === 'dispossessed_retained' && roleButton('recovered_by')}
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

          {!liveMode && (
          <div className="pt-2 border-t border-slate-200">
            <div className="grid grid-cols-3 gap-2">
              <CustomFieldInput label="Custom 1" config={customFields?.custom_1} value={custom1} onChange={setCustom1} />
              <CustomFieldInput label="Custom 2" config={customFields?.custom_2} value={custom2} onChange={setCustom2} />
              <CustomFieldInput label="Custom 3" config={customFields?.custom_3} value={custom3} onChange={setCustom3} />
            </div>
          </div>
          )}
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
                  if (r === 'defender' && restrict) return 'Defender must be on the opposite team';
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

