import { describe, expect, it } from 'vitest';
import { authTokenFromCallback, extensionIdFromRedirect } from './auth.mjs';

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

describe('authTokenFromCallback', () => {
  const redirect = 'https://omkblpgeonilpgkdgieiingkigkhhfhn.chromiumapp.org/feason-auth';
  it('accepts the expected redirect and state', () => {
    expect(authTokenFromCallback(`${redirect}?state=expected&token=synthetic-token`, redirect, 'expected')).toBe('synthetic-token');
  });
  it.each([
    'https://example.com/feason-auth?state=expected&token=synthetic-token',
    `${redirect}/other?state=expected&token=synthetic-token`,
    `${redirect}?state=wrong&token=synthetic-token`,
    `${redirect}?state=expected&state=other&token=synthetic-token`,
    `${redirect}?state=expected&token=one&token=two`,
    `${redirect}?state=expected`,
    `${redirect}?state=expected&token=synthetic-token#fragment`,
    'not a URL',
  ])('rejects an invalid callback without saving its credential', (callback) => {
    expect(() => authTokenFromCallback(callback, redirect, 'expected')).toThrow();
  });
});
