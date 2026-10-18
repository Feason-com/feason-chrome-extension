import {
  CATEGORIES, FEASON_ORIGIN, categoryDetails, categoryLimit, draftFromContext,
  gleamPayload, safeWebUrl, textLimitWithSource,
} from './shared.mjs';

const elements = Object.fromEntries([
  'accountButton', 'anotherButton', 'attribution', 'attributionRow', 'body', 'cancelButton',
  'categoryList', 'characterCount', 'composer', 'draftStatus', 'kindLabel', 'limitMessage',
  'loadingView', 'openFeasonButton', 'postButton', 'removeSourceButton', 'signInButton',
  'signInError', 'signInView', 'sourceCard', 'sourceDomain', 'sourceTitle', 'statusMessage',
  'successTitle', 'successView', 'viewGleamButton',
].map((id) => [id, document.getElementById(id)]));

let signedIn = false;
let signingIn = false;
let posting = false;
let ready = false;
let category = 'reflection';
let draft = { body: '', category, sourceUrl: '', sourceTitle: '', attribution: '' };
let lastPostedId = '';
let draftWrites = Promise.resolve();
const initialStorageChanges = [];

function setView(name) {
  document.body.dataset.view = name;
  for (const [view, element] of [
    ['loading', elements.loadingView], ['sign-in', elements.signInView],
    ['composer', elements.composer], ['success', elements.successView],
  ]) element.hidden = name !== view;
  if (name === 'composer') elements.categoryList.querySelector('[aria-checked="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

function snapshotDraft() {
  return { ...draft, body: elements.body.value, category, attribution: elements.attribution.value };
}

function saveDraft() {
  const value = snapshotDraft();
  draftWrites = draftWrites.then(() => chrome.storage.session.set({ gleamDraft: value })).then(() => {
    elements.draftStatus.textContent = 'Draft saved for this session.';
  }).catch(() => {
    elements.draftStatus.textContent = 'Couldn’t save this draft. Keep the composer open.';
  });
  return draftWrites;
}

function renderCategories() {
  elements.categoryList.replaceChildren();
  for (const item of CATEGORIES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'category-chip';
    button.dataset.category = item.key;
    button.textContent = item.label;
    button.setAttribute('role', 'radio');
    button.addEventListener('click', () => chooseCategory(item.key, true));
    button.addEventListener('keydown', (event) => {
      const index = CATEGORIES.findIndex((entry) => entry.key === category);
      const next = { ArrowRight: (index + 1) % CATEGORIES.length, ArrowLeft: (index + CATEGORIES.length - 1) % CATEGORIES.length, Home: 0, End: CATEGORIES.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      chooseCategory(CATEGORIES[next].key, true);
      elements.categoryList.children[next].focus();
    });
    elements.categoryList.append(button);
  }
}

function chooseCategory(nextCategory, persist = false) {
  if (posting && persist) return;
  category = categoryDetails(nextCategory).key;
  const details = categoryDetails(category);
  document.body.dataset.category = category;
  elements.kindLabel.textContent = `GLEAM · ${details.label.toUpperCase()}`;
  elements.body.placeholder = details.placeholder;
  elements.attributionRow.hidden = category !== 'aphorism';
  for (const chip of elements.categoryList.children) {
    const selected = chip.dataset.category === category;
    chip.classList.toggle('selected', selected);
    chip.setAttribute('aria-checked', String(selected));
    chip.tabIndex = selected ? 0 : -1;
    if (selected) chip.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
  updateForm();
  if (persist) { elements.statusMessage.textContent = ''; void saveDraft(); }
}

function updateForm() {
  const limit = textLimitWithSource(category, draft.sourceUrl);
  const count = elements.body.value.length;
  elements.body.maxLength = limit;
  elements.characterCount.textContent = `${count.toLocaleString('en-US')} / ${limit.toLocaleString('en-US')}`;
  elements.characterCount.classList.toggle('near-limit', limit - count <= 40);
  let error = '';
  try { gleamPayload(snapshotDraft()); } catch (failure) { error = failure.message; }
  const tooLong = count > limit || safeWebUrl(draft.sourceUrl).length > categoryLimit(category);
  elements.limitMessage.textContent = tooLong ? `This ${categoryDetails(category).label.toLowerCase()} is over the limit. Shorten the text or remove the attached page.` : '';
  elements.body.setAttribute('aria-invalid', String(tooLong));
  elements.postButton.disabled = posting || Boolean(error) || tooLong || !signedIn;
  elements.postButton.querySelector('.post-label').textContent = posting ? 'Posting…' : 'Post';
  elements.composer.setAttribute('aria-busy', String(posting));
  elements.body.readOnly = posting;
  elements.attribution.disabled = posting;
  elements.removeSourceButton.disabled = posting;
  elements.accountButton.disabled = posting;
  elements.cancelButton.disabled = posting;
  for (const chip of elements.categoryList.children) chip.disabled = posting;
}

function renderDraft(nextDraft) {
  draft = {
    body: typeof nextDraft?.body === 'string' ? nextDraft.body : '',
    category: categoryDetails(nextDraft?.category).key,
    sourceUrl: safeWebUrl(nextDraft?.sourceUrl),
    sourceTitle: typeof nextDraft?.sourceTitle === 'string' ? nextDraft.sourceTitle : '',
    attribution: typeof nextDraft?.attribution === 'string' ? nextDraft.attribution : '',
  };
  elements.body.value = draft.body;
  elements.attribution.value = draft.attribution;
  elements.sourceCard.hidden = !draft.sourceUrl;
  if (draft.sourceUrl) {
    elements.sourceTitle.textContent = draft.sourceTitle || 'Attached page';
    elements.sourceDomain.textContent = new URL(draft.sourceUrl).hostname;
    elements.sourceCard.title = draft.sourceUrl;
  }
  chooseCategory(draft.category);
}

function renderAuthState(state) {
  signingIn = state?.status === 'pending';
  elements.signInButton.disabled = signingIn;
  elements.signInButton.textContent = signingIn ? 'Finish signing in…' : 'Sign in to Feason ↗';
  elements.signInError.textContent = state?.error || '';
}

function renderPostState(state, running = true) {
  posting = state?.status === 'pending' && running;
  if (state?.status === 'success') {
    lastPostedId = state.id;
    chooseCategory(state.category);
    elements.successTitle.textContent = categoryDetails(state.category).blessing;
    setView('success');
    elements.successTitle.focus();
  } else if (state?.status === 'error' || (state?.status === 'pending' && !running)) {
    const error = state.error || 'Posting was interrupted. Open Feason to check your Gleams before posting again.';
    elements.statusMessage.className = 'message error';
    elements.statusMessage.textContent = error;
    if (state.code === 401) {
      elements.signInError.textContent = error;
      setView('sign-in');
    }
  } else if (posting) {
    elements.statusMessage.className = 'message';
    elements.statusMessage.textContent = 'Posting your Gleam…';
  }
  updateForm();
}

async function signIn() {
  if (signingIn) return;
  await saveDraft();
  renderAuthState({ status: 'pending' });
  try {
    const result = await chrome.runtime.sendMessage({ type: 'feason:sign-in' });
    if (!result?.ok) renderAuthState({ error: result?.error || 'Couldn’t sign in. Please try again.' });
  } catch {
    renderAuthState({ error: 'Couldn’t start sign-in. Reopen the extension and try again.' });
  }
}

async function postGleam(event) {
  event.preventDefault();
  if (elements.postButton.disabled || posting || !signedIn) return;
  posting = true;
  updateForm();
  await draftWrites;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'feason:post', draft: snapshotDraft() });
    const { feasonPostState } = await chrome.storage.session.get('feasonPostState');
    if (result?.ok) renderPostState(feasonPostState);
    else renderPostState({ status: 'error', error: result?.error || 'Couldn’t post your Gleam.', code: result?.status });
  } catch {
    renderPostState({ status: 'error', error: 'Couldn’t confirm your post. Open Feason to check your Gleams before posting again.' });
  }
}

async function postAnother() {
  await chrome.storage.session.remove('feasonPostState');
  lastPostedId = '';
  renderDraft({});
  elements.statusMessage.textContent = '';
  await saveDraft();
  setView(signedIn ? 'composer' : 'sign-in');
  elements.body.focus();
}

async function signOut() {
  elements.accountButton.disabled = true;
  await draftWrites;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'feason:sign-out' });
    if (!result?.ok) throw new Error('Sign-out did not finish. Try again.');
    signedIn = false;
    renderDraft({});
    elements.statusMessage.textContent = '';
    setView('sign-in');
  } catch (error) {
    elements.statusMessage.className = 'message error';
    elements.statusMessage.textContent = error.message;
  } finally { elements.accountButton.disabled = false; }
}

function applyStorageChanges(changes, area) {
  if (area === 'local' && changes.feasonAuthToken) {
    signedIn = Boolean(changes.feasonAuthToken.newValue);
    if (signedIn) {
      renderAuthState();
      elements.statusMessage.textContent = '';
      setView('composer');
      elements.body.focus();
    } else setView('sign-in');
    updateForm();
  }
  if (area === 'session' && changes.feasonAuthState) renderAuthState(changes.feasonAuthState.newValue);
  if (area === 'session' && changes.feasonPostState?.newValue) renderPostState(changes.feasonPostState.newValue);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (!ready) initialStorageChanges.push([changes, area]);
  else applyStorageChanges(changes, area);
});

elements.body.addEventListener('input', () => { elements.statusMessage.textContent = ''; updateForm(); void saveDraft(); });
elements.attribution.addEventListener('input', () => { updateForm(); void saveDraft(); });
elements.composer.addEventListener('submit', postGleam);
elements.composer.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); elements.composer.requestSubmit(); }
});
elements.signInButton.addEventListener('click', signIn);
elements.accountButton.addEventListener('click', signOut);
elements.anotherButton.addEventListener('click', postAnother);
elements.cancelButton.addEventListener('click', async () => { await saveDraft(); window.close(); });
elements.removeSourceButton.addEventListener('click', () => {
  draft.sourceUrl = '';
  draft.sourceTitle = '';
  elements.sourceCard.hidden = true;
  updateForm();
  void saveDraft();
  elements.body.focus();
});
elements.openFeasonButton.addEventListener('click', () => chrome.tabs.create({ url: `${FEASON_ORIGIN}/` }));
elements.viewGleamButton.addEventListener('click', () => {
  const path = lastPostedId ? `/gleams/${encodeURIComponent(lastPostedId)}` : '/gleams';
  chrome.tabs.create({ url: `${FEASON_ORIGIN}${path}` });
});

async function initialize() {
  renderCategories();
  const [stored, session, tabs, worker] = await Promise.all([
    chrome.storage.local.get('feasonAuthToken'),
    chrome.storage.session.get(['gleamDraft', 'pendingGleamDraft', 'feasonPostState', 'feasonAuthState']),
    chrome.tabs.query({ active: true, currentWindow: true }),
    chrome.runtime.sendMessage({ type: 'feason:status' }),
  ]);
  signedIn = Boolean(stored.feasonAuthToken);
  const pending = session.pendingGleamDraft && !worker.posting;
  renderDraft(pending ? session.pendingGleamDraft : session.gleamDraft || draftFromContext({}, tabs[0] || {}));
  if (pending) {
    await saveDraft();
    await chrome.storage.session.remove(['pendingGleamDraft', 'feasonPostState']);
  }
  setView(signedIn ? 'composer' : 'sign-in');
  renderAuthState(worker.signingIn ? { status: 'pending' } : session.feasonAuthState?.status === 'error' ? session.feasonAuthState : undefined);
  if (!pending && session.feasonPostState) renderPostState(session.feasonPostState, worker.posting);
  ready = true;
  for (const [changes, area] of initialStorageChanges.splice(0)) applyStorageChanges(changes, area);
  if (document.body.dataset.view === 'composer') { await saveDraft(); elements.body.focus(); }
}

initialize().catch(() => {
  setView('sign-in');
  renderAuthState({ error: 'Couldn’t open the composer. Reload the extension and try again.' });
});
