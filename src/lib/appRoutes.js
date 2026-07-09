export const PUBLIC_LANDING_PATH = '/';
export const VIEWER_DASHBOARD_PATH = '/my-stats';
export const ANALYST_DASHBOARD_PATH = '/dashboard';

export function normalizeAppPath(path = '/') {
  const text = String(path || '').trim();
  if (!text) return '/';
  return text.startsWith('/') ? text : `/${text}`;
}

export function buildMatchSharePath(code = '') {
  return `/share/match/${encodeURIComponent(String(code || '').trim())}`;
}

export function buildTeamSharePath(code = '') {
  return `/share/team/${encodeURIComponent(String(code || '').trim())}`;
}

export function buildHashRouteUrl(path = '/') {
  const normalized = normalizeAppPath(path);
  if (typeof window === 'undefined') return normalized;
  return `${window.location.origin}${window.location.pathname}#${normalized}`;
}
