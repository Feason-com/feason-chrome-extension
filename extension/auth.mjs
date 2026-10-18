const EXTENSION_ID_RE = /^[a-p]{32}$/;

export function extensionIdFromRedirect(redirectUrl) {
  try {
    const redirect = new URL(redirectUrl);
    if (redirect.protocol !== 'https:' || !redirect.hostname.endsWith('.chromiumapp.org')) return '';
    const id = redirect.hostname.slice(0, -'.chromiumapp.org'.length);
    return EXTENSION_ID_RE.test(id) ? id : '';
  } catch {
    return '';
  }
}

export function authTokenFromCallback(result, redirectUrl, state) {
  const expected = new URL(redirectUrl);
  let callback;
  try {
    callback = new URL(result);
  } catch {
    throw new Error('Feason did not finish signing in.');
  }
  if (!extensionIdFromRedirect(redirectUrl)
    || callback.origin !== expected.origin
    || callback.pathname !== expected.pathname
    || callback.username || callback.password || callback.hash
    || callback.searchParams.getAll('state').length !== 1
    || callback.searchParams.get('state') !== state) {
    throw new Error('Feason returned an invalid sign-in.');
  }
  const tokens = callback.searchParams.getAll('token');
  if (tokens.length !== 1 || !tokens[0]) throw new Error('Feason did not return a sign-in token.');
  return tokens[0];
}
