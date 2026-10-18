// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Changes = Record<string, { oldValue?: unknown; newValue?: unknown }>;
type StorageListener = (changes: Changes, area: string) => void;
type MessageListener = (message: unknown, sender: { id: string; url: string }, reply: (value: unknown) => void) => boolean;
const extensionId = 'omkblpgeonilpgkdgieiingkigkhhfhn';
const extensionUrl = `chrome-extension://${extensionId}/popup.html`;
const html = readFileSync(resolve('extension/popup.html'), 'utf8');

function harness() {
  const listeners = new Set<StorageListener>();
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  const storage = (data: Record<string, unknown>, area: string) => ({
    get: vi.fn(async (keys: string | string[]) => Object.fromEntries((typeof keys === 'string' ? [keys] : keys).map((key) => [key, data[key]]))),
    set: vi.fn(async (values: Record<string, unknown>) => {
      const changes = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { oldValue: data[key], newValue: value }]));
      Object.assign(data, values);
      listeners.forEach((listener) => listener(changes, area));
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      const changes: Changes = {};
      for (const key of typeof keys === 'string' ? [keys] : keys) { changes[key] = { oldValue: data[key] }; delete data[key]; }
      listeners.forEach((listener) => listener(changes, area));
    }),
  });
  let messageListener: MessageListener;
  const onMessage = vi.fn((listener: MessageListener) => { messageListener = listener; });
  const send = (message: unknown, sender = { id: extensionId, url: extensionUrl }) => new Promise<unknown>((resolve, reject) => {
    if (!messageListener(message, sender, resolve)) reject(new Error('No receiver'));
  });
  const chrome = {
    runtime: { id: extensionId, getURL: (path: string) => `chrome-extension://${extensionId}/${path}`, onMessage: { addListener: onMessage }, onInstalled: { addListener: vi.fn() }, sendMessage: vi.fn(send) },
    storage: { local: storage(local, 'local'), session: storage(session, 'session'), onChanged: { addListener: (listener: StorageListener) => listeners.add(listener) } },
    identity: {
      getRedirectURL: () => `https://${extensionId}.chromiumapp.org/feason-auth`,
      launchWebAuthFlow: vi.fn(async ({ url }: { url: string }) => `https://${extensionId}.chromiumapp.org/feason-auth?state=${new URL(url).searchParams.get('state')}&token=synthetic-token`),
    },
    tabs: { query: vi.fn(async () => [{ title: 'A useful article', url: 'https://example.com/article' }]), create: vi.fn() },
    action: { openPopup: vi.fn(async () => undefined) },
    windows: { create: vi.fn(async () => undefined), getCurrent: vi.fn(async () => ({ id: 7 })) },
    sidePanel: { open: vi.fn(async () => undefined) },
    contextMenus: { removeAll: vi.fn(), create: vi.fn(), onClicked: { addListener: vi.fn() } },
  };
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ id: 'synthetic-gleam' }), { status: 200 }));
  vi.stubGlobal('chrome', chrome);
  vi.stubGlobal('fetch', fetchMock);
  return { chrome, local, session, send, fetchMock, listeners };
}

const input = () => document.getElementById('body') as HTMLTextAreaElement;
const postButton = () => document.getElementById('postButton') as HTMLButtonElement;
const view = () => document.body.dataset.view;
const click = (id: string) => (document.getElementById(id) as HTMLButtonElement).click();
function type(text: string) { input().value = text; input().dispatchEvent(new Event('input')); }
function category(name: string) { (document.querySelector(`[data-category="${name}"].category-chip`) as HTMLButtonElement).click(); }
function submit() { document.getElementById('composer')!.dispatchEvent(new Event('submit', { cancelable: true })); }
async function loadPopup() {
  document.open(); document.write(html); document.close();
  await import('./popup.mjs');
  await vi.waitFor(() => expect(view()).not.toBe('loading'));
}

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('Chrome extension auth and posting lifecycle', () => {
  it('completes sign-in in the worker after the popup receiver is gone', async () => {
    const h = harness();
    await import('./background.mjs');
    let finish: (value: string) => void = () => undefined;
    h.chrome.identity.launchWebAuthFlow.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const completion = h.send({ type: 'feason:sign-in' });
    await vi.waitFor(() => expect(h.chrome.identity.launchWebAuthFlow).toHaveBeenCalledOnce());
    // No popup is mounted or listening when Chrome completes the flow.
    const start = new URL(h.chrome.identity.launchWebAuthFlow.mock.calls[0][0].url);
    expect(start.searchParams.get('extension_id')).toBe(extensionId);
    finish(`https://${extensionId}.chromiumapp.org/feason-auth?state=${start.searchParams.get('state')}&token=synthetic-token`);
    expect(await completion).toEqual({ ok: true });
    expect(h.local.feasonAuthToken).toBe('synthetic-token');
    expect(h.session.feasonAuthState).toBeUndefined();
    await loadPopup();
    expect(view()).toBe('composer');
  });

  it('rejects an unexpected identity callback and permits retry after cancellation', async () => {
    const h = harness();
    await import('./background.mjs');
    h.chrome.identity.launchWebAuthFlow.mockResolvedValueOnce('https://example.com/?state=bad&token=synthetic-token');
    expect(await h.send({ type: 'feason:sign-in' })).toMatchObject({ ok: false });
    expect(h.local.feasonAuthToken).toBeUndefined();
    expect(await h.send({ type: 'feason:sign-in' })).toEqual({ ok: true });
  });

  it('receives sign-in completion while the popup is still initializing', async () => {
    const h = harness();
    await import('./background.mjs');
    let finishRead: (value: Record<string, unknown>) => void = () => undefined;
    h.chrome.storage.local.get.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
    const opening = loadPopup();
    await vi.waitFor(() => expect(h.chrome.storage.local.get).toHaveBeenCalled());
    await h.send({ type: 'feason:sign-in' });
    finishRead({});
    await opening;
    expect(view()).toBe('composer');
    expect(postButton().disabled).toBe(false);
  });

  it('uses the window fallback when Chrome cannot open the toolbar popup', async () => {
    const h = harness();
    await import('./background.mjs');
    h.chrome.action.openPopup.mockRejectedValueOnce(new Error('Unavailable'));
    const handler = h.chrome.contextMenus.onClicked.addListener.mock.calls[0][0];
    await handler({ menuItemId: 'feason-post-selection', selectionText: 'Selected words.', pageUrl: 'https://example.org/source' }, { title: 'Source' });
    expect(h.session.pendingGleamDraft).toMatchObject({ body: 'Selected words.', sourceUrl: 'https://example.org/source' });
    expect(h.chrome.windows.create).toHaveBeenCalledWith({ url: extensionUrl, type: 'popup', width: 420, height: 650 });
  });

  it('accepts commands only from this extension’s composer', async () => {
    const h = harness();
    await import('./background.mjs');
    await expect(h.send({ type: 'feason:sign-in' }, { id: extensionId, url: 'https://example.com/' })).rejects.toThrow('No receiver');
    expect(h.chrome.identity.launchWebAuthFlow).not.toHaveBeenCalled();
  });

  it('keeps a URL-only resource post enabled and records its receipt across popup closure', async () => {
    const h = harness();
    h.local.feasonAuthToken = 'synthetic-token';
    await import('./background.mjs');
    await loadPopup();
    expect(postButton().disabled).toBe(false);
    submit();
    await vi.waitFor(() => expect(view()).toBe('success'));
    expect(h.fetchMock).toHaveBeenCalledOnce();
    const options = h.fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(options.body as string)).toEqual({ body: 'https://example.com/article', category: 'resource' });
    expect(options.headers).toMatchObject({ Authorization: 'Bearer synthetic-token' });
    expect(h.session.gleamDraft).toBeNull();
    click('viewGleamButton');
    expect(h.chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://www.feason.com/gleams/synthetic-gleam' });
  });

  it('restores an edited draft and attribution without truncating on a category change', async () => {
    const h = harness();
    h.local.feasonAuthToken = 'synthetic-token';
    h.session.gleamDraft = { body: 'a'.repeat(300), category: 'reflection', attribution: 'A writer' };
    await import('./background.mjs');
    await loadPopup();
    category('aphorism');
    expect(input().value).toHaveLength(300);
    expect(postButton().disabled).toBe(true);
    expect(document.getElementById('limitMessage')?.textContent).toContain('over the limit');
    category('reflection');
    expect(input().value).toHaveLength(300);
    expect(postButton().disabled).toBe(false);
    type('A little light.');
    category('aphorism');
    submit();
    await vi.waitFor(() => expect(view()).toBe('success'));
    expect(JSON.parse((h.fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ body: 'A little light.', category: 'aphorism', aphorism_attribution: 'A writer' });
  });

  it('removes the current page from both the visible attachment and the actual post', async () => {
    const h = harness();
    h.local.feasonAuthToken = 'synthetic-token';
    await import('./background.mjs');
    await loadPopup();
    click('removeSourceButton');
    expect((document.getElementById('sourceCard') as HTMLElement).hidden).toBe(true);
    expect(postButton().disabled).toBe(true);
    type('A reflection without a link.');
    submit();
    await vi.waitFor(() => expect(view()).toBe('success'));
    expect(JSON.parse((h.fetchMock.mock.calls[0][1] as RequestInit).body as string).body).toBe('A reflection without a link.');
  });

  it('keeps the draft on a 401 and restores the composer after reauthentication', async () => {
    const h = harness();
    h.local.feasonAuthToken = 'expired-synthetic-token';
    h.fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await import('./background.mjs');
    await loadPopup();
    type('Do not lose this reflection.');
    submit();
    await vi.waitFor(() => expect(view()).toBe('sign-in'));
    expect(h.local.feasonAuthToken).toBeUndefined();
    expect(h.session.gleamDraft).toMatchObject({ body: 'Do not lose this reflection.' });
    click('signInButton');
    await vi.waitFor(() => expect(view()).toBe('composer'));
    expect(input().value).toBe('Do not lose this reflection.');
    expect(postButton().disabled).toBe(false);
  });

  it('allows retry after rate limiting and never retries a failed request automatically', async () => {
    const h = harness();
    h.local.feasonAuthToken = 'synthetic-token';
    h.fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Wait a moment.' }), { status: 429 }));
    await import('./background.mjs');
    await loadPopup();
    type('Keep this draft.');
    submit();
    await vi.waitFor(() => expect(document.getElementById('statusMessage')?.textContent).toContain('Wait a moment.'));
    expect(postButton().disabled).toBe(false);
    expect(h.fetchMock).toHaveBeenCalledOnce();
    expect(input().value).toBe('Keep this draft.');
  });

  it('deduplicates in-flight posts and completes them with no popup mounted', async () => {
    const h = harness();
    h.local.feasonAuthToken = 'synthetic-token';
    await import('./background.mjs');
    let finish: (response: Response) => void = () => undefined;
    h.fetchMock.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const message = { type: 'feason:post', draft: { body: 'A little light.', category: 'reflection' } };
    const first = h.send(message);
    const second = h.send(message);
    await vi.waitFor(() => expect(h.fetchMock).toHaveBeenCalledOnce());
    finish(new Response(JSON.stringify({ id: 'synthetic-gleam' }), { status: 200 }));
    await Promise.all([first, second]);
    await loadPopup();
    expect(view()).toBe('success');
  });

  it('recovers an interrupted worker post without leaving the composer disabled', async () => {
    const h = harness();
    h.local.feasonAuthToken = 'synthetic-token';
    h.session.gleamDraft = { body: 'An interrupted post.', category: 'reflection' };
    h.session.feasonPostState = { status: 'pending', category: 'reflection' };
    await import('./background.mjs');
    await loadPopup();
    expect(postButton().disabled).toBe(false);
    expect(document.getElementById('statusMessage')?.textContent).toContain('check your Gleams');
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('consumes a new context-menu draft ahead of an older success screen', async () => {
    const h = harness();
    h.local.feasonAuthToken = 'synthetic-token';
    h.session.feasonPostState = { status: 'success', id: 'older', category: 'prayer' };
    h.session.pendingGleamDraft = { body: 'Selected text.', sourceUrl: 'https://example.org/source', category: 'resource', sourceTitle: 'Source' };
    await import('./background.mjs');
    await loadPopup();
    expect(view()).toBe('composer');
    expect(input().value).toBe('Selected text.');
    expect(h.session.pendingGleamDraft).toBeUndefined();
    expect(h.session.feasonPostState).toBeUndefined();
    expect(h.session.gleamDraft).toMatchObject({ body: 'Selected text.' });
  });

  it('clears credentials and session drafts when signing out', async () => {
    const h = harness();
    h.local.feasonAuthToken = 'synthetic-token';
    await import('./background.mjs');
    await loadPopup();
    type('A private unsent draft.');
    await vi.waitFor(() => expect(h.session.gleamDraft).toMatchObject({ body: 'A private unsent draft.' }));
    click('accountButton');
    await vi.waitFor(() => expect(view()).toBe('sign-in'));
    expect(h.local.feasonAuthToken).toBeUndefined();
    expect(h.session.gleamDraft).toBeUndefined();
    expect(input().value).toBe('');
  });
});


describe('Study companion tools', () => {
  it('opens the side panel in the context-menu gesture without transmitting selected text', async () => {
    const h = harness();
    await import('./background.mjs');
    const handler = h.chrome.contextMenus.onClicked.addListener.mock.calls[0][0];
    await handler({ menuItemId: 'feason-ask', selectionText: 'Words worth considering.', pageUrl: 'https://example.com/article' }, { title: 'Article', windowId: 7 });
    expect(h.chrome.sidePanel.open).toHaveBeenCalledWith({ windowId: 7 });
    expect(h.session.feasonSelection).toMatchObject({ tool: 'feasy', text: 'Words worth considering.' });
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('looks up a passage, copies it, and attaches its first verse to the actual post', async () => {
    const h = harness(); h.local.feasonAuthToken = 'synthetic-token';
    await import('./background.mjs'); await loadPopup();
    h.fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ reference: 'John 15:1–5', verses: [{ verse: 1, text: 'I am the true vine.' }], anchor: { book: 43, chapter: 15, verse: 1 }, href: '/scripture/john/15#verse-1' })));
    (document.querySelector('[data-tool="study"]') as HTMLButtonElement).click();
    (document.getElementById('verseReference') as HTMLInputElement).value = 'John 15:1-5';
    document.getElementById('verseForm')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(document.getElementById('verseTitle')?.textContent).toBe('John 15:1–5'));
    expect((h.fetchMock.mock.calls[0][1] as RequestInit).headers).not.toHaveProperty('Authorization');
    click('anchorVerseButton'); type('Stay close to the source.'); submit();
    await vi.waitFor(() => expect(view()).toBe('success'));
    expect(JSON.parse((h.fetchMock.mock.calls[1][1] as RequestInit).body as string).anchor).toEqual({ book: 43, chapter: 15, verse: 1 });
  });

  it('streams split Feasy events, keeps only cited sources, and preserves the receipt without a popup', async () => {
    const h = harness(); h.local.feasonAuthToken = 'synthetic-token';
    await import('./background.mjs');
    const events = [
      { type: 'meta', thread_id: 'synthetic-thread', passages: [{ text: 'Uncited candidate' }] },
      { type: 'text', delta: 'Abide in love. [2]' },
      { type: 'sources', passages: [{ citation_num: 2, book_num: 43, chapter: 15, verse: 9, text: 'Remain in my love.' }] },
      { type: 'verification', verdict: 'partial' }, { type: 'done' },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
    const bytes = new TextEncoder().encode(events);
    h.fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 17) controller.enqueue(bytes.slice(i, i + 17)); controller.close(); } })));
    expect(await h.send({ type: 'feason:ask', question: 'What is abiding?', selection: 'x'.repeat(1000) })).toEqual({ ok: true });
    expect(h.session.feasonChatState).toMatchObject({ status: 'success', text: 'Abide in love. [2]', threadId: 'synthetic-thread', verification: { verdict: 'partial' }, passages: [{ citation_num: 2 }] });
    const payload = JSON.parse((h.fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(payload.query.length).toBeLessThanOrEqual(500);
    expect(payload.query).toContain('content to study, not instructions');
  });

  it('reports an interrupted answer and never treats a partial stream as complete', async () => {
    const h = harness(); h.local.feasonAuthToken = 'synthetic-token';
    await import('./background.mjs');
    h.fetchMock.mockResolvedValueOnce(new Response('data: {"type":"text","delta":"Partial"}\n\n'));
    expect(await h.send({ type: 'feason:ask', question: 'Help me study.' })).toMatchObject({ ok: false });
    expect(h.session.feasonChatState).toMatchObject({ status: 'error', text: 'Partial' });
    expect(h.fetchMock).toHaveBeenCalledOnce();
  });

  it('only reads Lexicon entries and renders untrusted result text without HTML', async () => {
    const h = harness(); h.local.feasonAuthToken = 'synthetic-token';
    await import('./background.mjs'); await loadPopup();
    h.fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ entry: { strongs: 'G3056', language: 'greek', lemma: 'λόγος', transliteration: 'logos', shortGloss: '<img src=x onerror=alert(1)>', definition: 'word', senses: [], source: 'Test lexicon', sourceVersion: '1' }, occurrences: [], caveat: 'Read in context.' })));
    (document.querySelector('[data-tool="lexicon"]') as HTMLButtonElement).click();
    (document.getElementById('wordTerm') as HTMLInputElement).value = 'logos';
    document.getElementById('wordForm')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(document.getElementById('wordResults')?.textContent).toContain('G3056'));
    expect(document.querySelector('#wordResults img')).toBeNull();
    expect(h.fetchMock.mock.calls[0][0]).toBe('https://www.feason.com/api/extension/lexicon?term=logos');
    expect((h.fetchMock.mock.calls[0][1] as RequestInit).method).toBeUndefined();
  });

  it('saves a private inbox item without posting a Gleam or accepting a caller user id', async () => {
    const h = harness(); h.local.feasonAuthToken = 'synthetic-token';
    await import('./background.mjs');
    h.fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ item: { id: 'saved' } })));
    expect(await h.send({ type: 'feason:inbox-save', item: { title: 'A page', quote: 'Remember this', url: 'https://example.org/', user_id: 'other-user' } })).toMatchObject({ ok: true });
    expect(h.fetchMock.mock.calls[0][0]).toBe('https://www.feason.com/api/reading-inbox');
    expect(JSON.parse((h.fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ title: 'A page', quote: 'Remember this', url: 'https://example.org/' });
  });

  it('uploads an image only as part of an explicit Resource post', async () => {
    const h = harness(); h.local.feasonAuthToken = 'synthetic-token';
    await import('./background.mjs');
    h.fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ url: 'https://example.org/image.png' })));
    await h.send({ type: 'feason:post', draft: { body: 'A resource.', category: 'resource', image: 'data:image/png;base64,aGVsbG8=', anchor: { book: 43, chapter: 15, verse: 5 } } });
    expect(h.fetchMock.mock.calls[0][0]).toBe('https://www.feason.com/api/gleams/upload');
    expect((h.fetchMock.mock.calls[0][1] as RequestInit).body).toBeInstanceOf(FormData);
    const post = JSON.parse((h.fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(post).toMatchObject({ image_url: 'https://example.org/image.png', anchor: { book: 43, chapter: 15, verse: 5 } });
  });

  it('clears study context and aborted Feasy results on sign-out', async () => {
    const h = harness(); h.local.feasonAuthToken = 'synthetic-token';
    h.session.companionDraft = { question: 'Private draft' }; h.session.feasonSelection = { text: 'Private selection' };
    await import('./background.mjs');
    await h.send({ type: 'feason:sign-out' });
    expect(h.session.companionDraft).toBeUndefined(); expect(h.session.feasonSelection).toBeUndefined();
  });
});


it('rejects a delayed private response after the credential changes', async () => {
  const h = harness(); h.local.feasonAuthToken = 'synthetic-token';
  await import('./background.mjs');
  let finish: (response: Response) => void = () => undefined;
  h.fetchMock.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = h.send({ type: 'feason:inbox-list' });
  await vi.waitFor(() => expect(h.fetchMock).toHaveBeenCalledOnce());
  await h.send({ type: 'feason:sign-out' });
  finish(Response.json({ items: [{ title: 'Private' }] }));
  expect(await pending).toMatchObject({ ok: false, error: expect.stringContaining('account changed') });
});

it('accepts the fixed side-panel document and rejects other extension pages', async () => {
  const h = harness(); await import('./background.mjs');
  expect(await h.send({ type: 'feason:status' }, { id: extensionId, url: extensionUrl + '?surface=sidepanel' })).toMatchObject({ chatting: false });
  await expect(h.send({ type: 'feason:status' }, { id: extensionId, url: extensionUrl + '?other=1' })).rejects.toThrow('No receiver');
});


it('shares edits between the popup and sidebar without retaining an accepted post in either composer', async () => {
  const h = harness(); h.local.feasonAuthToken = 'synthetic-token';
  await import('./background.mjs'); await loadPopup();
  await h.chrome.storage.session.set({ gleamDraft: { body: 'An edit from the other panel.', category: 'reflection', editorId: 'other-panel' } });
  expect(input().value).toBe('An edit from the other panel.');
  submit(); await vi.waitFor(() => expect(view()).toBe('success'));
  (document.querySelector('[data-tool="gleam"]') as HTMLButtonElement).click();
  expect(input().value).toBe(''); expect(postButton().disabled).toBe(true);
  expect(h.fetchMock).toHaveBeenCalledOnce();
});

it('loads Today with partial service failures using read-only requests', async () => {
  const h = harness(); h.local.feasonAuthToken = 'synthetic-token'; await import('./background.mjs');
  h.fetchMock.mockImplementation(async url => String(url).endsWith('/api/memorize/summary') ? Response.json({ error: 'Unavailable' }, { status: 503 }) : Response.json({ ref: 'John 15:5', text: 'I am the vine.' }));
  expect(await h.send({ type: 'feason:today' })).toMatchObject({ ok: true, data: { verse: { ref: 'John 15:5' }, reviews: { error: 'Unavailable' } } });
  expect(h.fetchMock.mock.calls).toHaveLength(5);
  expect(h.fetchMock.mock.calls.every(c => !(c[1] as RequestInit).method)).toBe(true);
});
it('keeps practice private regardless of a caller-supplied achievement setting', async () => {
  const h = harness(); h.local.feasonAuthToken = 'synthetic-token'; await import('./background.mjs');
  await h.send({ type: 'feason:practice-grade', id: '11111111-1111-4111-8111-111111111111', grade: 'good', publishAchievement: true });
  expect(JSON.parse((h.fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ grade: 'good', publishAchievement: false });
});
it('passes only the library edit contract and clears library drafts and exports on sign-out', async () => {
  const h = harness(); h.local.feasonAuthToken = 'synthetic-token'; await import('./background.mjs');
  h.session.libraryDraft = { note: 'private' }; h.session.studyExport = 'Private export'; h.local.feasonPlayback = { position: 42 };
  await h.send({ type: 'feason:inbox-edit', item: { id: 'id', revision: 2, kind: 'workspace', note: 'Edited', user_id: 'other', embedding: [1], encrypted_body: 'never' } });
  expect(JSON.parse((h.fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ id: 'id', revision: 2, kind: 'workspace', note: 'Edited' });
  await h.send({ type: 'feason:sign-out' });
  expect(h.session.libraryDraft).toBeUndefined(); expect(h.session.studyExport).toBeUndefined(); expect(h.local.feasonPlayback).toBeUndefined();
});

it('clears another account’s drafts before exposing the new signed-in account', async () => {
  const h = harness();
  const token = (sub: string) => `e30.${btoa(JSON.stringify({ sub }))}.signature`;
  h.local.feasonAuthToken = token('account-a'); h.session.gleamDraft = { body: 'Account A private draft' }; h.session.libraryDraft = { note: 'Account A private note' };
  await import('./background.mjs');
  h.chrome.identity.launchWebAuthFlow.mockImplementationOnce(async ({ url }) => `https://${extensionId}.chromiumapp.org/feason-auth?state=${new URL(url).searchParams.get('state')}&token=${token('account-b')}`);
  expect(await h.send({ type: 'feason:sign-in' })).toMatchObject({ ok: true });
  expect(h.session.gleamDraft).toBeUndefined(); expect(h.session.libraryDraft).toBeUndefined(); expect(h.local.feasonDraftOwner).toBe('account-b');
});
