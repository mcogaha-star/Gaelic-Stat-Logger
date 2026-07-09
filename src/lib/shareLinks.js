import { createPageUrl } from '@/utils';

export function buildStatShareLink(code) {
  const safeCode = String(code || '').trim().toUpperCase();
  if (!safeCode) return '';
  const route = createPageUrl(`StatShare?code=${encodeURIComponent(safeCode)}`);
  if (typeof window === 'undefined') return route;
  return `${window.location.origin}${window.location.pathname}#${route}`;
}

export function extractShareCodeFromInput(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';

  const fromParams = (text) => {
    const query = text.includes('?') ? text.slice(text.indexOf('?') + 1) : text;
    try {
      return new URLSearchParams(query).get('code') || '';
    } catch {
      return '';
    }
  };

  try {
    const parsed = new URL(raw);
    const directCode = parsed.searchParams.get('code');
    if (directCode) return directCode.trim().toUpperCase();
    if (parsed.hash) {
      const hashCode = fromParams(parsed.hash.replace(/^#\/?/, ''));
      if (hashCode) return hashCode.trim().toUpperCase();
    }
  } catch {
    // Raw codes and hash fragments are handled below.
  }

  const explicitCode = fromParams(raw);
  if (explicitCode) return explicitCode.trim().toUpperCase();

  const codeMatch = raw.match(/(?:^|[?&#/])code=([^&#\s]+)/i);
  if (codeMatch?.[1]) return decodeURIComponent(codeMatch[1]).trim().toUpperCase();

  return raw.replace(/[^a-z0-9_-]/gi, '').toUpperCase();
}
