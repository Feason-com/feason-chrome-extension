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
