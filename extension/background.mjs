import { FEASON_ORIGIN, draftFromContext, errorMessage, gleamPayload, studyQuestion, feasyEventLines, imageData } from './shared.mjs';
import { createOfflineLibrary, libraryPayload, pageSnapshot, findPageReferences, sourcePageUrl, omniboxDestination, escapeSuggestion } from './library.mjs';
import { authTokenFromCallback, extensionIdFromRedirect } from './auth.mjs';

const MENU_IDS = {
  page: 'feason-post-page',
  link: 'feason-post-link',
  selection: 'feason-post-selection',
};

let signingIn;
let posting;
let chatting;
let chatController;
let authGeneration = 0;
let verifiedToken = '', verifiedOwner = '', identityRequest;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.feasonAuthToken?.oldValue && changes.feasonAuthToken.newValue !== changes.feasonAuthToken.oldValue) {
    authGeneration++; chatController?.abort();
    void chrome.storage.session.remove(['feasonSelection', 'feasonChatState', 'studyExport']);
    void chrome.storage.local.remove('feasonPlayback');
  }
});

async function api(path, options = {}, publicRead = false) {
  const { feasonAuthToken: token } = await chrome.storage.local.get('feasonAuthToken');
  if (!token && !publicRead) throw Object.assign(new Error(errorMessage(401)), { status: 401 });
  if (!publicRead) await ensureAccount(token);
  const response = await fetch(`${FEASON_ORIGIN}${path}`, {
    ...options, credentials: 'omit', signal: options.signal || AbortSignal.timeout(25_000),
    headers: { ...(!publicRead ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  });
  if (!publicRead && (await chrome.storage.local.get('feasonAuthToken')).feasonAuthToken !== token) throw new Error('Your account changed. Reopen Feason to continue.');
  if (!response.ok) {
    if (response.status === 401) await expireCredential(token);
    const payload = await response.json().catch(() => null);
    throw Object.assign(new Error(errorMessage(response.status, payload)), { status: response.status });
  }
  return response;
}

async function accountOwner(token) {
  if (token === verifiedToken && verifiedOwner) return verifiedOwner;
  if (identityRequest?.token === token) return identityRequest.promise;
  const promise = (async () => {
    const response = await fetch(`${FEASON_ORIGIN}/api/extension/account`, {
      credentials: 'omit', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Object.assign(new Error(response.status === 401 ? errorMessage(401) : 'Could not verify your Feason account. Please try again.'), { status: response.status });
    const data = await response.json();
    if (typeof data.id !== 'string' || !data.id || data.id.length > 128) throw new Error('Could not verify your Feason account.');
    verifiedToken = token; verifiedOwner = data.id;
    return data.id;
  })();
  identityRequest = { token, promise };
  try { return await promise; } finally { if (identityRequest?.promise === promise) identityRequest = undefined; }
}
async function ensureAccount(token) {
  let owner;
  try { owner = await accountOwner(token); }
  catch (error) { if (error.status === 401) await expireCredential(token); throw error; }
  const current = await chrome.storage.local.get(['feasonAuthToken', 'feasonDraftOwner']);
  if (current.feasonAuthToken !== token) throw new Error('Your account changed. Reopen Feason to continue.');
  if (current.feasonDraftOwner && current.feasonDraftOwner !== owner) {
    await chrome.storage.session.remove(privateSessionKeys);
    await chrome.storage.session.set({ feasonAccountReset: Date.now() });
  }
  await chrome.storage.local.set({ feasonDraftOwner: owner });
}
async function expireCredential(token) {
  const current = await chrome.storage.local.get(['feasonAuthToken', 'feasonDraftOwner']);
  if (current.feasonAuthToken !== token) return;
  // Opaque JWE credentials cannot be decoded in the browser. Fail closed for
  // a legacy credential whose owner was never verified by the account endpoint.
  if (!current.feasonDraftOwner) await chrome.storage.local.set({ feasonDraftOwner: 'unverified-previous-account' });
  await chrome.storage.local.remove('feasonAuthToken');
}
const privateSessionKeys = ['gleamDraft', 'pendingGleamDraft', 'feasonPostState', 'feasonAuthState', 'feasonChatState', 'feasonSelection', 'companionDraft', 'libraryDraft', 'studyExport'];

async function jsonApi(path, options = {}, publicRead = false) {
  return (await api(path, options, publicRead)).json();
}

const offline = createOfflineLibrary(path => api(path, {}, true));
async function passage(reference) {
  try { return await jsonApi(`/api/extension/passage?reference=${encodeURIComponent(reference)}`, {}, true); }
  catch (error) { if (error.status && error.status < 500) throw error; return offline.find(reference); }
}
async function collections() {
  const generation = authGeneration, items = [];
  let cursor = null;
  do {
    const page = await jsonApi(`/api/reading-inbox?kind=collection${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    if (generation !== authGeneration) throw new Error('Your account changed. Reopen Feason to continue.');
    items.push(...page.items); cursor = page.nextCursor;
  } while (cursor);
  return { items };
}
async function today() {
  const paths = ['/api/daily-verse', '/api/scripture/resume', '/api/memorize/summary', '/api/reading-plans', '/api/reading-plans/completions'];
  const results = await Promise.allSettled(paths.map((p, i) => jsonApi(p, {}, i === 0 || i === 3)));
  const keys = ['verse', 'resume', 'reviews', 'plans', 'progress'];
  return Object.fromEntries(results.map((r, i) => [keys[i], r.status === 'fulfilled' ? r.value : { error: r.reason?.message || 'Temporarily unavailable.' }]));
}

async function askFeasy(message) {
  const query = studyQuestion(message.question, message.selection);
  const generation = authGeneration;
  chatController = new AbortController();
  const state = { status: 'pending', query, text: '', passages: [], threadId: '', verification: null };
  await chrome.storage.session.set({ feasonChatState: state });
  try {
    const response = await api('/api/razon/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.any([chatController.signal, AbortSignal.timeout(180_000)]),
      body: JSON.stringify({ query, ...(typeof message.threadId === 'string' && message.threadId ? { thread_id: message.threadId } : {}) }),
    });
    if (!response.body) throw new Error('Feasy did not return an answer.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', done = false;
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
      const parsed = feasyEventLines(buffer, chunk.done);
      buffer = parsed.remainder;
      for (const event of parsed.events) {
        if (event.type === 'text' && typeof event.delta === 'string') state.text += event.delta;
        if (event.type === 'meta') state.threadId = typeof event.thread_id === 'string' ? event.thread_id : '';
        if (event.type === 'sources' && Array.isArray(event.passages)) state.passages = event.passages;
        if (event.type === 'verification') state.verification = event;
        if (event.type === 'done') done = true;
        if (event.type === 'error') throw new Error(typeof event.message === 'string' ? event.message : 'Feasy could not finish this answer.');
      }
      if (generation !== authGeneration) { await reader.cancel(); return { ok: false, error: 'Signed out.' }; }
      await chrome.storage.session.set({ feasonChatState: { ...state } });
      if (chunk.done) break;
    }
    if (!done || !state.text) throw new Error('Feasy’s answer was interrupted. Please try again when you are ready.');
    state.status = 'success';
    await chrome.storage.session.set({ feasonChatState: state });
    return { ok: true };
  } catch (error) {
    if (generation === authGeneration) await chrome.storage.session.set({ feasonChatState: { ...state, status: 'error', error: error.message || 'Feasy is unavailable. Try again.' } });
    return { ok: false, error: error.message || 'Feasy is unavailable. Try again.' };
  } finally { chatController = undefined; }
}

async function openComposer() {
  try {
    await chrome.action.openPopup();
  } catch {
    // openPopup is generally available from Chrome 127. Older supported
    // versions, or a window with no toolbar, use the same UI in a small window.
    await chrome.windows.create({
      url: chrome.runtime.getURL('popup.html'),
      type: 'popup',
      width: 420,
      height: 650,
    });
  }
}

async function signIn() {
  await chrome.storage.session.set({ feasonAuthState: { status: 'pending' } });
  try {
    const redirect = chrome.identity.getRedirectURL('feason-auth');
    const extensionId = extensionIdFromRedirect(redirect);
    if (!extensionId) throw new Error('Feason could not identify this extension.');
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const state = btoa(String.fromCharCode(...bytes))
      .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
    const start = new URL('/api/auth/extension/start', FEASON_ORIGIN);
    start.searchParams.set('state', state);
    start.searchParams.set('extension_id', extensionId);

    // The worker owns the flow: opening the browser sign-in window closes a
    // toolbar popup and destroys its JavaScript context.
    const result = await chrome.identity.launchWebAuthFlow({ url: start.toString(), interactive: true });
    const token = authTokenFromCallback(result, redirect, state);
    const previous = await chrome.storage.local.get(['feasonAuthToken', 'feasonDraftOwner']);
    const owner = await accountOwner(token);
    const previousOwner = previous.feasonDraftOwner || (previous.feasonAuthToken ? await accountOwner(previous.feasonAuthToken).catch(() => 'unverified-previous-account') : null);
    if (previousOwner && owner !== previousOwner) {
      await chrome.storage.session.remove(privateSessionKeys);
      await chrome.storage.session.set({ feasonAccountReset: Date.now() });
    }
    if (owner) await chrome.storage.local.set({ feasonDraftOwner: owner });
    await chrome.storage.local.set({ feasonAuthToken: token });
    await chrome.storage.session.remove('feasonAuthState');
    try { await chrome.action.openPopup(); } catch { /* Reopen the toolbar to continue on older Chrome. */ }
    return { ok: true };
  } catch {
    const error = 'Sign-in did not finish. Your draft is saved; try signing in again.';
    await chrome.storage.session.set({ feasonAuthState: { status: 'error', error } });
    return { ok: false, error };
  }
}

async function postGleam(draft) {
  let payload;
  try {
    payload = gleamPayload(draft);
  } catch (error) {
    return { ok: false, error: error.message };
  }
  const { feasonAuthToken } = await chrome.storage.local.get('feasonAuthToken');
  if (!feasonAuthToken) return { ok: false, error: errorMessage(401), status: 401 };

  await chrome.storage.session.set({
    feasonPostState: { status: 'pending', category: payload.category, startedAt: Date.now() },
  });
  try {
    await ensureAccount(feasonAuthToken);
    if (payload.category === 'resource' && draft.image) {
      const image = imageData(draft.image);
      if (!image || image.bytes.byteLength > 5 * 1024 * 1024) throw new Error('Unsupported image');
      const form = new FormData();
      form.append('image', new Blob([image.bytes], { type: image.type }), `gleam.${image.type.split('/')[1]}`);
      const uploaded = await jsonApi('/api/gleams/upload', { method: 'POST', body: form });
      if (typeof uploaded.url !== 'string' || !uploaded.url.startsWith('https://')) throw new Error('Upload failed');
      payload.image_url = uploaded.url;
    }
    const response = await fetch(`${FEASON_ORIGIN}/api/gleams`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${feasonAuthToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25_000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401) await expireCredential(feasonAuthToken);
      const error = errorMessage(response.status, data);
      await chrome.storage.session.set({ feasonPostState: { status: 'error', error, code: response.status } });
      return { ok: false, error, status: response.status };
    }
    if (typeof data?.id !== 'string' || !data.id) throw new Error('Incomplete response');

    // Persist the receipt before touching the draft. A closed popup must not
    // offer the same post again after Feason has accepted it.
    await chrome.storage.session.set({
      feasonPostState: { status: 'success', id: data.id, category: payload.category },
      gleamDraft: null,
    });
    return { ok: true };
  } catch (failure) {
    const code = failure?.status;
    const error = code === 401 ? errorMessage(401) : 'Couldn’t confirm your post. Open Feason to check your Gleams before posting again.';
    await chrome.storage.session.set({ feasonPostState: { status: 'error', error, ...(code ? { code } : {}) } });
    return { ok: false, error, ...(code ? { status: code } : {}) };
  }
}

let bookMetadata;
async function localBooks() {
  bookMetadata ??= fetch(chrome.runtime.getURL('books.json')).then(r => r.json()).catch(error => { bookMetadata = undefined; throw error; });
  return bookMetadata;
}
async function activePage(action, locators = [], tab = null, expectedUrl = '') {
  if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!Number.isInteger(tab?.id) || !sourcePageUrl(tab.url || '')) throw new Error('Open a public webpage, then choose Feason from its toolbar or right-click menu.');
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pageSnapshot, args: [action, locators, expectedUrl] });
    if (!results?.[0]?.result) throw new Error('No page result');
    return { ...results[0].result, tabId: tab.id };
  } catch (error) {
    throw new Error(/shorter quotation|page changed|cannot display page highlights/i.test(error.message || '') ? error.message : 'Chrome could not read this page. Open Feason from that page’s toolbar or right-click menu and try again. Some browser pages and embedded documents cannot be scanned.');
  }
}
async function pageCommand(action) {
  const generation = authGeneration;
  const page = await activePage(action === 'capture' ? 'capture' : action === 'scan' ? 'scan' : 'source');
  if (action === 'scan') return { url: page.url, title: page.title, references: findPageReferences(page.text, await localBooks()) };
  if (action === 'restore') {
    const items = []; let cursor = null, pages = 0;
    do {
      const data = await jsonApi(`/api/reading-inbox?kind=page&source=${encodeURIComponent(sourcePageUrl(page.url))}${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
      if (generation !== authGeneration) throw new Error('Your account changed. Choose the page again.');
      items.push(...data.items.filter(item => item.locator)); cursor = data.nextCursor;
    } while (cursor && items.length < 200 && ++pages < 10);
    if (generation !== authGeneration) throw new Error('Your account changed. Choose the page again.');
    const restored = await activePage('restore', items.slice(0, 200).map(item => item.locator), {id:page.tabId, url:page.url}, page.url);
    return { ...restored, limited: Boolean(cursor) };
  }
  return page;
}

// Restrict commands to our own composer. No content script or external page
// can ask the worker to sign in, sign out, or publish.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || ![chrome.runtime.getURL('popup.html'), chrome.runtime.getURL('popup.html?surface=sidepanel')].includes(sender.url)) return false;
  let task;
  if (message?.type === 'feason:status') {
    task = Promise.resolve({ signingIn: Boolean(signingIn), posting: Boolean(posting), chatting: Boolean(chatting) });
  } else if (message?.type === 'feason:ask') {
    chatting ??= askFeasy(message).finally(() => { chatting = undefined; });
    task = chatting;
  } else if (message?.type === 'feason:passage') {
    task = passage(String(message.reference || '').slice(0, 120)).then(data => ({ ok: true, data }));
  } else if (message?.type === 'feason:word') {
    task = jsonApi(`/api/extension/lexicon?term=${encodeURIComponent(String(message.term || '').slice(0, 100))}`).then(data => ({ ok: true, data }));
  } else if (message?.type === 'feason:page' && ['scan', 'capture', 'restore', 'clear'].includes(message.action)) {
    task = (message.action === 'clear' ? activePage('clear') : pageCommand(message.action)).then(data => ({ok:true, data}));
  } else if (message?.type === 'feason:inbox-list') {
    const params = new URLSearchParams({ kind: 'all' });
    if (message.cursor) params.set('cursor', String(message.cursor).slice(0, 140));
    if (message.query) params.set('q', String(message.query).slice(0, 200));
    if (message.collection) params.set('collection', String(message.collection).slice(0, 36));
    task = jsonApi(`/api/reading-inbox?${params}`).then(data => ({ ok: true, data }));
  } else if (message?.type === 'feason:inbox-save') {
    task = jsonApi('/api/reading-inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(libraryPayload(message.item)) }).then(data => ({ ok: true, data }));
  } else if (message?.type === 'feason:collections') {
    task = collections().then(data => ({ ok: true, data }));
  } else if (message?.type === 'feason:inbox-edit') {
    task = jsonApi('/api/reading-inbox', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(libraryPayload(message.item)) }).then(data => ({ ok: true, data }));
  } else if (message?.type === 'feason:today') {
    task = today().then(data => ({ ok: true, data }));
  } else if (message?.type === 'feason:practice-list') {
    task = jsonApi('/api/memorize?scope=due').then(data => ({ ok: true, data }));
  } else if (message?.type === 'feason:practice-add') {
    task = jsonApi('/api/memorize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(message.card) }).then(data => ({ ok: true, data }));
  } else if (message?.type === 'feason:practice-grade' && /^[a-f0-9-]{36}$/i.test(message.id || '')) {
    task = jsonApi(`/api/memorize/${message.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grade: message.grade, publishAchievement: false }) }).then(data => ({ ok: true, data }));
  } else if (message?.type === 'feason:thread' && /^[a-f0-9-]{36}$/i.test(message.id || '')) {
    task = jsonApi(`/api/razon/threads/${message.id}`).then(data => ({ ok: true, data }));
  } else if (message?.type === 'feason:downloads') {
    task = offline.list().then(data => ({ ok: true, data }));
  } else if (message?.type === 'feason:download') {
    task = offline.save(String(message.reference || '').slice(0, 120), message.audio !== false).then(data => ({ ok: true, data }));
  } else if (message?.type === 'feason:download-remove') {
    task = offline.remove(message.key).then(data => ({ ok: true, data }));
  } else if (message?.type === 'feason:inbox-delete') {
    task = jsonApi('/api/reading-inbox', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: message.id }) }).then(data => ({ ok: true, data }));
  } else if (message?.type === 'feason:sign-in') {
    signingIn ??= signIn().finally(() => { signingIn = undefined; });
    task = signingIn;
  } else if (message?.type === 'feason:post') {
    posting ??= postGleam(message.draft).finally(() => { posting = undefined; });
    task = posting;
  } else if (message?.type === 'feason:sign-out' && !signingIn && !posting) {
    task = (async () => {
      authGeneration++;
      chatController?.abort();
      await chrome.storage.local.remove(['feasonAuthToken', 'feasonDraftOwner']);
      await chrome.storage.session.remove(['gleamDraft', 'pendingGleamDraft', 'feasonPostState', 'feasonAuthState', 'feasonChatState', 'feasonSelection', 'companionDraft', 'libraryDraft', 'studyExport']);
      await chrome.storage.local.remove('feasonPlayback');
      return { ok: true };
    })();
  } else {
    return false;
  }
  task.then(sendResponse, (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Couldn’t complete that action. Reopen Feason and try again.', status: error?.status }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_IDS.page,
      title: 'Post this page as a Gleam',
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: MENU_IDS.link,
      title: 'Post this link as a Gleam',
      contexts: ['link'],
    });
    chrome.contextMenus.create({
      id: MENU_IDS.selection,
      title: 'Post “%s” as a Gleam',
      contexts: ['selection'],
    });
    for (const [id, title, contexts] of [
      ['feason-ask', 'Ask Feasy about this…', ['selection']],
      ['feason-verse', 'Look up this Bible reference…', ['selection']],
      ['feason-word', 'Look up this biblical word…', ['selection']],
      ['feason-inbox', 'Keep in your private reading inbox…', ['page', 'link', 'selection']],
      ['feason-page', 'Find Scripture on this page…', ['page']],
      ['feason-highlight', 'Keep this highlight privately…', ['selection']],
      ['feason-video', 'Keep this video moment…', ['video']],
    ]) chrome.contextMenus.create({ id, title, contexts });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const tool = { 'feason-ask': 'feasy', 'feason-verse': 'study', 'feason-word': 'lexicon', 'feason-inbox': 'inbox', 'feason-highlight': 'inbox', 'feason-video': 'inbox', 'feason-page': 'page' }[String(info.menuItemId)];
  if (tool) {
    const context = draftFromContext(info, tab || {});
    const selection = { tool, text: String(info.selectionText || '').slice(0, 4000), url: context.sourceUrl, title: context.sourceTitle, nonce: Date.now() };
    // sidePanel.open must run in the context-menu gesture, before an await.
    const opening = chrome.sidePanel?.open({ windowId: tab?.windowId }).catch(() => openComposer()) || openComposer();
    if (['feason-highlight', 'feason-video'].includes(String(info.menuItemId))) {
      try {
        const page = await activePage('capture', [], tab);
        selection.locator = page.locator;
        selection.mediaSeconds = info.menuItemId === 'feason-video' ? page.mediaSeconds : null;
        selection.text = page.locator?.exact || selection.text;
      } catch { /* The selected text and source link still open as an unsaved draft. */ }
    }
    await Promise.all([chrome.storage.session.set({ feasonSelection: selection }), opening]);
    return;
  }
  if (!Object.values(MENU_IDS).includes(String(info.menuItemId))) return;

  await chrome.storage.session.set({
    pendingGleamDraft: draftFromContext(info, tab || {}),
  });

  await openComposer();
});


chrome.omnibox?.setDefaultSuggestion({ description: 'Study a passage, <match>word</match> term, or <match>find</match> your library' });
chrome.omnibox?.onInputChanged.addListener((text, suggest) => {
  // Local suggestions only. Typing never searches or sends private library data.
  const query = String(text).trim().slice(0, 200), escaped = escapeSuggestion(query);
  suggest(query ? [
    { content: query, description: `Open in Feason: <match>${escaped}</match>` },
    { content: `find ${query.replace(/^find\s+/i, '')}`, description: `Search your private library: ${escaped}` },
  ] : []);
});
chrome.omnibox?.onInputEntered.addListener(async (input, disposition) => {
  try {
    const destination = omniboxDestination(input, await localBooks());
    await chrome.storage.session.set({ feasonSelection: { ...destination, nonce: Date.now() } });
    const url = chrome.runtime.getURL('popup.html?surface=sidepanel');
    if (disposition === 'currentTab') await chrome.tabs.update({ url });
    else await chrome.tabs.create({ url, active: disposition !== 'newBackgroundTab' });
  } catch { await openComposer(); }
});
chrome.commands?.onCommand.addListener((name, tab) => {
  if (name !== 'feason-study-page') return;
  const opening = chrome.sidePanel?.open({ windowId: tab?.windowId }).catch(() => openComposer()) || openComposer();
  void Promise.all([opening, chrome.storage.session.set({ feasonSelection: {tool:'page', nonce:Date.now()} })]);
});
