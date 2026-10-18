// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { findPageReferences, sourceHref, sourcePageUrl, omniboxDestination, escapeSuggestion, pageSnapshot } from './library.mjs';
const books = JSON.parse(readFileSync('extension/books.json', 'utf8'));
beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { vi.unstubAllGlobals(); });

it('finds canonical references, aliases, and numbered books without duplicate or malformed verses', () => {
  const found = findPageReferences('Read Jn. 15:1–5, Psalm 23 and 1 John 4:8. John 15:1-5 again. John 0:2, Luke 999:1, John 3:0.', books);
  expect(found.map((r: { reference: string }) => r.reference)).toEqual(['John 15:1–5', 'Psalms 23', '1 John 4:8']);
});
it('bounds page scanning and accepts books from the full existing reader catalog', () => {
  expect(findPageReferences('Tobit 4:7', books)[0].reference).toBe('Tobit 4:7');
  expect(findPageReferences(' '.repeat(100000) + 'John 3:16', books)).toEqual([]);
});
it('checks actual WEB chapter and verse endpoints, including translation omissions', () => {
  const invalid = 'John 100, Jude 20, John 3:100, John 3:16-100, Luke 17:36, Acts 8:37, Baruch 6:1, Psalms 151:1.';
  expect(findPageReferences(invalid, books)).toEqual([]);
  const valid = 'John 21:25, Jude 1:25, Psalms 119:176, Luke 17:35-37, Sirach 51:30, Tobit 14:15.';
  expect(findPageReferences(valid, books).map((r: {reference: string}) => r.reference)).toEqual([
    'John 21:25', 'Jude 1:25', 'Psalms 119:176', 'Luke 17:35–37', 'Sirach 51:30', 'Tobit 14:15',
  ]);
});
it('routes accepted address-bar queries locally and escapes suggestion markup', () => {
  expect(omniboxDestination('John 15:5', books)).toEqual({ tool: 'study', text: 'John 15:5' });
  expect(omniboxDestination('word agape', books)).toEqual({ tool: 'lexicon', text: 'agape' });
  expect(omniboxDestination('find hope', books)).toEqual({ tool: 'inbox', query: 'hope' });
  expect(escapeSuggestion('<match>&')).toBe('&lt;match&gt;&amp;');
});
it('links back to an exact quotation and keeps video timestamps on the verified video host', () => {
  expect(sourceHref({ url: 'https://example.org/source', locator: { exact: 'Faith-hope', prefix: '', suffix: '' } })).toContain('#:~:text=Faith%2Dhope');
  expect(sourcePageUrl('https://youtu.be/abcdefghijk?t=6')).toBe('https://www.youtube.com/watch?v=abcdefghijk');
  expect(sourceHref({ url: 'https://www.youtube.com/watch?v=abcdefghijk', mediaSeconds: 125 })).toContain('t=125s');
  expect(sourceHref({ url: 'javascript:alert(1)' })).toBe('');
});
it('captures a selected quotation with context and ignores hidden, editable, and navigation text when scanning', () => {
  document.body.innerHTML = '<nav>John 1:1</nav><article><p>Before. <em>Remain in my love.</em> After.</p><p hidden>John 2:1</p><textarea>John 3:1</textarea></article>';
  const text = document.querySelector('em')!.firstChild!;
  const range = document.createRange(); range.selectNodeContents(text);
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  const page = pageSnapshot('capture');
  expect(page.locator).toMatchObject({ exact: 'Remain in my love.' });
  const scanned = pageSnapshot('scan');
  expect(scanned.text).toContain('Remain in my love.');
  expect(scanned.text).not.toMatch(/John [123]:1/);
});
it('restores a quotation across inline nodes, skips ambiguous duplicates, and never alters page text', () => {
  document.body.innerHTML = '<article><p>His faith<em>fulness</em> is good.</p><p>Repeated quote.</p><p>Repeated quote.</p></article>';
  const before = document.body.textContent;
  const set = vi.fn();
  vi.stubGlobal('CSS', { highlights: { set, delete: vi.fn() } });
  vi.stubGlobal('Highlight', class { ranges: Range[]; constructor(...ranges: Range[]) { this.ranges = ranges; } });
  const result = pageSnapshot('restore', [{ exact: 'His faithfulness is good.', prefix: '', suffix: '' }, { exact: 'Repeated quote.', prefix: '', suffix: '' }]);
  expect(result).toEqual({ matched: 1, total: 2 });
  expect(set.mock.calls[0][1].ranges[0].toString()).toBe('His faithfulness is good.');
  expect(document.body.textContent).toBe(before);
});
it('does not restore highlights after the target page changed', () => {
  expect(() => pageSnapshot('restore', [], 'https://different.example/')).toThrow('page changed');
});

it('runs as a standalone serialized Chrome function and captures only real YouTube playback times', () => {
  document.body.innerHTML = '<article><video></video><p>A study</p></article>';
  const video = document.querySelector('video')!;
  Object.defineProperty(video, 'currentTime', { value: 125.8, configurable:true });
  const context = {document, window, NodeFilter, getComputedStyle, URL, location:{href:'https://www.youtube.com/watch?v=abcdefghijk'}};
  const snapshot = () => runInNewContext(`(${pageSnapshot.toString()})('capture')`, context);
  expect(snapshot()).toMatchObject({mediaSeconds:125});
  context.location.href = 'https://youtube.com.evil.example/watch?v=abcdefghijk';
  expect(snapshot().mediaSeconds).toBeNull();
  context.location.href = 'https://www.youtube.com/watch?v=abcdefghijk';
  Object.defineProperty(video,'currentTime',{value:90000,configurable:true});
  expect(snapshot().mediaSeconds).toBeNull();
});

it('can scan or clear highlights even when the current selection is too long to save', () => {
  document.body.innerHTML = '<p>' + 'x'.repeat(4500) + '</p>';
  const range=document.createRange(); range.selectNodeContents(document.querySelector('p')!);
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  vi.stubGlobal('CSS', {highlights:{delete:vi.fn()}});
  expect(()=>pageSnapshot('scan')).not.toThrow();
  expect(()=>pageSnapshot('clear')).not.toThrow();
  expect(()=>pageSnapshot('capture')).toThrow('shorter quotation');
});
