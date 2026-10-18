import { FEASON_ORIGIN, draftFromContext, errorMessage, gleamPayload } from './shared.mjs';
import { authTokenFromCallback, extensionIdFromRedirect } from './auth.mjs';

const MENU_IDS = {
  page: 'feason-post-page',
  link: 'feason-post-link',
  selection: 'feason-post-selection',
};

let signingIn;
let posting;

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
    const response = await fetch(`${FEASON_ORIGIN}/api/gleams`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${feasonAuthToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25_000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401) await chrome.storage.local.remove('feasonAuthToken');
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
  } catch {
    const error = 'Couldn’t confirm your post. Open Feason to check your Gleams before posting again.';
    await chrome.storage.session.set({ feasonPostState: { status: 'error', error } });
    return { ok: false, error };
  }
}

// Restrict commands to our own composer. No content script or external page
// can ask the worker to sign in, sign out, or publish.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) return false;
  let task;
  if (message?.type === 'feason:status') {
    task = Promise.resolve({ signingIn: Boolean(signingIn), posting: Boolean(posting) });
  } else if (message?.type === 'feason:sign-in') {
    signingIn ??= signIn().finally(() => { signingIn = undefined; });
    task = signingIn;
  } else if (message?.type === 'feason:post') {
    posting ??= postGleam(message.draft).finally(() => { posting = undefined; });
    task = posting;
  } else if (message?.type === 'feason:sign-out' && !signingIn && !posting) {
    task = (async () => {
      await chrome.storage.local.remove('feasonAuthToken');
      await chrome.storage.session.remove(['gleamDraft', 'pendingGleamDraft', 'feasonPostState', 'feasonAuthState']);
      return { ok: true };
    })();
  } else {
    return false;
  }
  task.then(sendResponse, () => sendResponse({ ok: false, error: 'Couldn’t complete that action. Reopen Feason and try again.' }));
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
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!Object.values(MENU_IDS).includes(String(info.menuItemId))) return;

  await chrome.storage.session.set({
    pendingGleamDraft: draftFromContext(info, tab || {}),
  });

  await openComposer();
});
