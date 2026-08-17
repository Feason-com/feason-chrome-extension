import { describe, expect, it } from 'vitest';
import {
  APHORISM_MAX,
  DEFAULT_MAX,
  categoryDetails,
  categoryLimit,
  draftFromContext,
  errorMessage,
  gleamBodyWithSource,
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

  it('surfaces API errors without exposing response internals', () => {
    expect(errorMessage(400, { error: 'Gleam body is required' })).toBe('Gleam body is required');
    expect(errorMessage(500, { stack: 'secret' })).toBe('Couldn’t post your gleam. Please try again.');
  });
});
