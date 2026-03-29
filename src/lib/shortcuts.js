export const DEFAULT_SHORTCUTS = {
  stat_click: {
    shot: 's',
    kickout: 'k',
    turnover: 't',
    foul: 'f',
    defensive_contact: 'd',
    throw_in: 'i',
  },
  stat_drag: {
    pass: 'p',
    carry: 'c',
  },
  video: {
    toggle_play_pause: 'v',
    back_3: ',',
    forward_3: '.',
    back_10: 'j',
    forward_10: 'l',
    back_20: 'u',
    forward_20: 'o',
    slower: '[',
    faster: ']',
  },
};

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function mergeShortcutConfig(raw) {
  const parsed = isObject(raw) ? raw : {};
  return {
    stat_click: {
      ...DEFAULT_SHORTCUTS.stat_click,
      ...(isObject(parsed.stat_click) ? parsed.stat_click : {}),
    },
    stat_drag: {
      ...DEFAULT_SHORTCUTS.stat_drag,
      ...(isObject(parsed.stat_drag) ? parsed.stat_drag : {}),
    },
    video: {
      ...DEFAULT_SHORTCUTS.video,
      ...(isObject(parsed.video) ? parsed.video : {}),
    },
  };
}

export function parseShortcutConfig(raw) {
  if (!raw) return mergeShortcutConfig({});
  if (typeof raw === 'string') {
    try {
      return mergeShortcutConfig(JSON.parse(raw));
    } catch {
      return mergeShortcutConfig({});
    }
  }
  return mergeShortcutConfig(raw);
}

function normalizeKeyName(key) {
  const raw = String(key || '').trim();
  if (!raw) return '';
  if (raw === ' ') return 'space';
  const lower = raw.toLowerCase();
  if (lower === 'spacebar') return 'space';
  if (lower === 'esc') return 'escape';
  return lower;
}

export function normalizeShortcutText(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parts = raw
    .split('+')
    .map((part) => normalizeKeyName(part))
    .filter(Boolean);
  const modifiers = [];
  let main = '';
  for (const part of parts) {
    if (part === 'ctrl' || part === 'control') modifiers.push('ctrl');
    else if (part === 'alt') modifiers.push('alt');
    else if (part === 'shift') modifiers.push('shift');
    else if (part === 'meta' || part === 'cmd' || part === 'command') modifiers.push('meta');
    else main = part;
  }
  return [...new Set(modifiers), main].filter(Boolean).join('+');
}

export function eventMatchesShortcut(event, shortcutText) {
  const shortcut = normalizeShortcutText(shortcutText);
  if (!shortcut) return false;
  const parts = shortcut.split('+').filter(Boolean);
  const main = parts[parts.length - 1];
  const requiresCtrl = parts.includes('ctrl');
  const requiresAlt = parts.includes('alt');
  const requiresShift = parts.includes('shift');
  const requiresMeta = parts.includes('meta');

  if (!!event.ctrlKey !== requiresCtrl) return false;
  if (!!event.altKey !== requiresAlt) return false;
  if (!!event.shiftKey !== requiresShift) return false;
  if (!!event.metaKey !== requiresMeta) return false;

  return normalizeKeyName(event.key) === main;
}

export function prettyShortcut(shortcutText) {
  const normalized = normalizeShortcutText(shortcutText);
  if (!normalized) return 'Unset';
  return normalized
    .split('+')
    .map((part) => {
      if (part === 'ctrl') return 'Ctrl';
      if (part === 'alt') return 'Alt';
      if (part === 'shift') return 'Shift';
      if (part === 'meta') return 'Cmd';
      if (part === 'space') return 'Space';
      if (part === 'arrowleft') return 'Left';
      if (part === 'arrowright') return 'Right';
      if (part === 'arrowup') return 'Up';
      if (part === 'arrowdown') return 'Down';
      return part.length === 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('+');
}

export function isTypingTarget(target) {
  const tag = target?.tagName?.toLowerCase?.();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable === true;
}
