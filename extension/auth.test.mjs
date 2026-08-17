import { describe, expect, it } from 'vitest';
import { extensionIdFromRedirect } from './auth.mjs';

describe('extensionIdFromRedirect', () => {
  it('reads a Chrome extension ID from its identity redirect', () => {
    expect(extensionIdFromRedirect(
      'https://omkblpgeonilpgkdgieiingkigkhhfhn.chromiumapp.org/feason-auth',
    )).toBe('omkblpgeonilpgkdgieiingkigkhhfhn');
  });

  it('rejects non-Chrome redirect origins', () => {
    expect(extensionIdFromRedirect('https://example.com/feason-auth')).toBe('');
    expect(extensionIdFromRedirect('not a url')).toBe('');
  });
});
