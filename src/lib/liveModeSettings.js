export const DEFAULT_LIVE_MODE_SETTINGS = {
  showShotSituation: true,
  showShotMethod: true,
  showShotPressure: true,
  showShotBlockedSavedBy: true,
  showKickoutBrokenBy: true,
  showKickoutPress: false,
  showKickoutLostBy: true,
  showTurnoverType: true,
  showTurnoverBroughtBackAdv: true,
  showFoulCard: true,
  showThrowInBrokenBy: true,
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
