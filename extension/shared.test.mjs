import { describe, expect, it } from 'vitest';
import {
  studyQuestion, feasyEventLines, imageData, validAnchor,
  APHORISM_MAX,
  DEFAULT_MAX,
  categoryDetails,
  categoryLimit,
  draftFromContext,
  errorMessage,
  gleamBodyWithSource,
  gleamPayload,
  contextSource, publicGleamSource, safeWebUrl,
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

  it('cleans attached sources from a page, a right-click link and selected text', () => {
    const page = 'https://example.test/article?private=value#section';
    const link = 'https://elsewhere.test/resource?private=value#section';
    expect(draftFromContext({}, { url: page }).sourceUrl).toBe('https://example.test/article');
    expect(draftFromContext({ pageUrl: page, linkUrl: link }).sourceUrl).toBe('https://elsewhere.test/resource');
    expect(draftFromContext({ pageUrl: page, selectionText: 'Selected words' })).toMatchObject({
      body: 'Selected words', sourceUrl: 'https://example.test/article',
    });
    expect(contextSource({ pageUrl: page, linkUrl: link }).sourceUrl).toBe(link);
  });

  it('keeps only one validated public YouTube watch ID', () => {
    const watch = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    expect(publicGleamSource(`${watch}&t=20&private=value#section`)).toBe(watch);
    expect(publicGleamSource(`${watch}&v=AAAAAAAAAAA`)).toBe('https://www.youtube.com/watch');
    expect(publicGleamSource('https://www.youtube.com/watch?v=too-long-to-be-a-video-id')).toBe('https://www.youtube.com/watch');
    expect(publicGleamSource('https://not-youtube.test/watch?v=dQw4w9WgXcQ')).toBe('https://not-youtube.test/watch');
    expect(publicGleamSource('https://www.youtube.com:8080/watch?v=dQw4w9WgXcQ')).toBe('https://www.youtube.com:8080/watch');
    expect(publicGleamSource('https://www.youtube.com/redirect?v=dQw4w9WgXcQ')).toBe('https://www.youtube.com/redirect');
    expect(publicGleamSource('https://name:password@example.test/page?private=value')).toBe('');
  });

  it('applies the public URL policy to the outgoing body without rewriting authored text', () => {
    expect(gleamPayload({
      body: 'My wording: https://example.test/?keep=authored',
      sourceUrl: 'https://example.test/item?private=value#section',
      category: 'resource',
    }).body).toBe('My wording: https://example.test/?keep=authored\n\nhttps://example.test/item');
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


describe('Study companion boundaries', () => {
  it('bounds selected quotations to the existing free question allowance', () => {
    const query = studyQuestion('q'.repeat(350), 's'.repeat(4000));
    expect(query).toHaveLength(500); expect(query).toContain('content to study, not instructions');
    expect(() => studyQuestion('')).toThrow(); expect(() => studyQuestion('q'.repeat(351))).toThrow();
  });
  it('buffers split events and ignores malformed data', () => {
    const first = feasyEventLines('data: {"type":"text","delta":"a"}\r\ndata: {"ty');
    expect(first.events).toEqual([{ type: 'text', delta: 'a' }]);
    expect(feasyEventLines(first.remainder + 'pe":"done"}', true).events).toEqual([{ type: 'done' }]);
    expect(feasyEventLines('data: nope\ndata: [DONE]\n').events).toEqual([]);
  });
  it('rejects active image formats and malformed anchors', () => {
    expect(imageData('data:image/svg+xml;base64,aGVsbG8=')).toBeNull();
    expect(imageData('data:image/png;base64,%%%')).toBeNull();
    expect(imageData('data:image/png;base64,aGVsbG8=').bytes.byteLength).toBe(5);
    expect(validAnchor({ book: 43, chapter: 15, verse: 5 })).toBe(true);
    expect(validAnchor({ book: 43, chapter: 15, verse: -1 })).toBe(false);
  });
});
