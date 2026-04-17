export const DEFAULT_LIVE_MODE_SETTINGS = {
  showShotMethod: true,
  showShotPressure: true,
  showShotBlockedSavedBy: true,
  showShotBroughtBackAdv: true,
  showKickoutPress: true,
  showKickoutLostBy: true,
  showTurnoverType: true,
  showTurnoverBroughtBackAdv: true,
  showFoulCard: true,
  showThrowInLostBy: true,
  showTemporarySub: true,
};

export function parseLiveModeSettings(raw) {
  if (!raw) return DEFAULT_LIVE_MODE_SETTINGS;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return DEFAULT_LIVE_MODE_SETTINGS;
    return { ...DEFAULT_LIVE_MODE_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_LIVE_MODE_SETTINGS;
  }
}
