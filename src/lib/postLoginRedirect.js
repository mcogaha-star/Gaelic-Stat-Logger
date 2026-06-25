const POST_LOGIN_REDIRECT_KEY = 'gaeliq_post_login_redirect';

export function setPostLoginRedirect(target) {
  const value = String(target || '').trim();
  if (!value) return;
  try {
    window.sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, value);
  } catch {}
}

export function peekPostLoginRedirect() {
  try {
    return window.sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY);
  } catch {
    return null;
  }
}

export function consumePostLoginRedirect() {
  try {
    const value = window.sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY);
    window.sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
    return value;
  } catch {
    return null;
  }
}

