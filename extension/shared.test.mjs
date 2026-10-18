import { describe, expect, it } from 'vitest';
import {
  APHORISM_MAX,
  DEFAULT_MAX,
  categoryDetails,
  categoryLimit,
  draftFromContext,
  errorMessage,
  gleamBodyWithSource,
  gleamPayload,
  safeWebUrl,
  textLimitWithSource,
} from './shared.mjs';

describe('Chrome Gleam helpers', () => {
  it('uses the same category limits as the Gleam API', () => {
    expect(categoryLimit('reflection')).toBe(DEFAULT_MAX);
    expect(categoryLimit('aphorism')).toBe(APHORISM_MAX);
    expect(categoryDetails('unknown').key).toBe('reflection');
  });

  it('builds a resource draft from the current page', () => {
    expect(draftFromContext({}, { title: 'Grace', url: 'https://example.com/grace' })).toEqual({
      body: '',
      category: 'resource',
      sourceUrl: 'https://example.com/grace',
      sourceTitle: 'Grace',
    });
  });

  it('keeps selected text in the editor and its source outside the editor', () => {
    const draft = draftFromContext(
      { selectionText: 'a'.repeat(3000), pageUrl: 'https://example.com/article' },
      { title: 'Article' },
    );

    expect(draft.body.length).toBe(textLimitWithSource('resource', draft.sourceUrl));
    expect(draft.body.endsWith('…')).toBe(true);
    expect(draft.body).not.toContain(draft.sourceUrl);
  });

  it('attaches the source only when building the API body', () => {
    expect(gleamBodyWithSource('Worth carrying', 'https://example.com/grace', 'resource')).toBe(
      'Worth carrying\n\nhttps://example.com/grace',
    );
    expect(gleamBodyWithSource('', 'https://example.com/grace', 'resource')).toBe(
      'https://example.com/grace',
    );
  });

  it('does not attach privileged browser pages', () => {
    expect(safeWebUrl('chrome://extensions')).toBe('');
    expect(draftFromContext({}, { url: 'chrome://extensions' }).body).toBe('');
  });

  it('does not silently truncate a draft when changing categories', () => {
    const body = 'a'.repeat(300);
    expect(gleamBodyWithSource(body, '', 'aphorism')).toBe(body);
    expect(() => gleamPayload({ body, category: 'aphorism' })).toThrow('too long');
    expect(gleamPayload({ body, category: 'reflection' }).body).toBe(body);
  });

  it('validates the full body including its attached URL', () => {
    expect(() => gleamPayload({ body: 'a'.repeat(230), sourceUrl: 'https://example.com/article', category: 'aphorism' })).toThrow('too long');
    expect(() => gleamPayload({ body: '', sourceUrl: `https://example.com/${'a'.repeat(240)}`, category: 'aphorism' })).toThrow('too long');
  });

  it('includes only aphorism attribution in the API payload', () => {
    const draft = { body: 'A little light.', attribution: ' A writer ', category: 'aphorism' };
    expect(gleamPayload(draft)).toEqual({ body: draft.body, category: 'aphorism', aphorism_attribution: 'A writer' });
    expect(gleamPayload({ ...draft, category: 'reflection' })).toEqual({ body: draft.body, category: 'reflection' });
  });

  it('labels a context-menu link with its own domain instead of the surrounding page title', () => {
    expect(draftFromContext({ linkUrl: 'https://example.org/article' }, { url: 'https://example.com/', title: 'Unrelated page' }).sourceTitle).toBe('example.org');
    expect(safeWebUrl('https://user:password@example.com/')).toBe('');
  });

  it('surfaces API errors without exposing response internals', () => {
    expect(errorMessage(400, { error: 'Gleam body is required' })).toBe('Gleam body is required');
    expect(errorMessage(500, { stack: 'secret' })).toBe('Couldn’t post your gleam. Please try again.');
  });
});
