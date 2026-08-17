import {
  ATTRIBUTION_MAX,
  CATEGORIES,
  FEASON_ORIGIN,
  categoryDetails,
  draftFromContext,
  errorMessage,
  gleamBodyWithSource,
  textLimitWithSource,
} from './shared.mjs';
import { extensionIdFromRedirect } from './auth.mjs';

const elements = {
  accountButton: document.querySelector('#accountButton'),
  anotherButton: document.querySelector('#anotherButton'),
  attribution: document.querySelector('#attribution'),
  attributionRow: document.querySelector('#attributionRow'),
  body: document.querySelector('#body'),
  categoryList: document.querySelector('#categoryList'),
  characterCount: document.querySelector('#characterCount'),
  composer: document.querySelector('#composer'),
  kindLabel: document.querySelector('#kindLabel'),
  postButton: document.querySelector('#postButton'),
  signInButton: document.querySelector('#signInButton'),
  signInError: document.querySelector('#signInError'),
  signInView: document.querySelector('#signInView'),
  sourceCard: document.querySelector('#sourceCard'),
  sourceTitle: document.querySelector('#sourceTitle'),
  statusMessage: document.querySelector('#statusMessage'),
  successTitle: document.querySelector('#successTitle'),
  successView: document.querySelector('#successView'),
  viewGleamButton: document.querySelector('#viewGleamButton'),
};

let authToken = '';
let category = 'reflection';
let draft = { body: '', category: 'reflection', sourceUrl: '', sourceTitle: '' };
let lastPostedId = '';
let posting = false;

function setView(name) {
  document.body.dataset.view = name;
  elements.signInView.hidden = name !== 'sign-in';
  elements.composer.hidden = name !== 'composer';
  elements.successView.hidden = name !== 'success';
  elements.accountButton.hidden = name === 'sign-in';
}

function renderCategories() {
  elements.categoryList.replaceChildren();
  for (const item of CATEGORIES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'category-chip';
    button.dataset.category = item.key;
    button.textContent = item.label;
    button.setAttribute('role', 'option');
    button.addEventListener('click', () => chooseCategory(item.key));
    elements.categoryList.append(button);
  }
}

function chooseCategory(nextCategory) {
  category = categoryDetails(nextCategory).key;
  const details = categoryDetails(category);
  const limit = textLimitWithSource(category, draft.sourceUrl);
  document.body.dataset.category = category;
  elements.kindLabel.textContent = `GLEAM · ${details.label.toUpperCase()}`;
  elements.body.placeholder = details.placeholder;
  elements.body.maxLength = limit;
  if (elements.body.value.length > limit) elements.body.value = elements.body.value.slice(0, limit);
  elements.attributionRow.hidden = category !== 'aphorism';
  if (category !== 'aphorism') elements.attribution.value = '';
  for (const chip of elements.categoryList.children) {
    const selected = chip.dataset.category === category;
    chip.classList.toggle('selected', selected);
    chip.setAttribute('aria-selected', String(selected));
  }
  updateForm();
}

function updateForm() {
  const limit = textLimitWithSource(category, draft.sourceUrl);
  const count = elements.body.value.length;
  elements.characterCount.textContent = `${count} / ${limit}`;
  elements.characterCount.classList.toggle('near-limit', limit - count <= 40);
  const validAttribution = elements.attribution.value.trim().length <= ATTRIBUTION_MAX;
  const postBody = gleamBodyWithSource(elements.body.value, draft.sourceUrl, category);
  elements.postButton.disabled = posting || !postBody || count > limit || !validAttribution;
}

function renderDraft(nextDraft) {
  draft = nextDraft;
  elements.body.value = draft.body || '';
  chooseCategory(draft.category || 'reflection');

  if (draft.sourceUrl) {
    elements.sourceTitle.textContent = draft.sourceTitle || 'Attached page';
    elements.sourceCard.hidden = false;
  } else {
    elements.sourceCard.hidden = true;
  }
  updateForm();
}

async function currentDraft() {
  const stored = await chrome.storage.session.get('pendingGleamDraft');
  if (stored.pendingGleamDraft) {
    await chrome.storage.session.remove('pendingGleamDraft');
    return stored.pendingGleamDraft;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return draftFromContext({}, tab || {});
}

function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

async function signIn() {
  elements.signInButton.disabled = true;
  elements.signInButton.textContent = 'Opening Feason…';
  elements.signInError.textContent = '';
  try {
    const state = randomState();
    const extensionId = extensionIdFromRedirect(chrome.identity.getRedirectURL('feason-auth'));
    if (!extensionId) throw new Error('Feason could not identify this extension.');
    const start = new URL('/api/auth/extension/start', FEASON_ORIGIN);
    start.searchParams.set('state', state);
    start.searchParams.set('extension_id', extensionId);
    const result = await chrome.identity.launchWebAuthFlow({
      url: start.toString(),
      interactive: true,
    });
    if (!result) throw new Error('Feason did not finish signing in.');

    const callback = new URL(result);
    if (callback.searchParams.get('state') !== state) throw new Error('Feason returned an invalid sign-in.');
    const token = callback.searchParams.get('token');
    if (!token) throw new Error('Feason did not return a sign-in token.');

    authToken = token;
    await chrome.storage.local.set({ feasonAuthToken: token });
    setView('composer');
    elements.body.focus();
  } catch (error) {
    elements.signInError.textContent = error instanceof Error ? error.message : 'Couldn’t sign in to Feason.';
  } finally {
    elements.signInButton.disabled = false;
    elements.signInButton.textContent = 'Sign in to Feason';
  }
}

async function signOut() {
  authToken = '';
  await chrome.storage.local.remove('feasonAuthToken');
  setView('sign-in');
}

async function postGleam(event) {
  event.preventDefault();
  if (elements.postButton.disabled || !authToken) return;

  posting = true;
  updateForm();
  elements.statusMessage.className = 'message';
  elements.statusMessage.textContent = 'Posting your gleam…';
  const postLabel = elements.postButton.querySelector('.post-label');
  postLabel.textContent = 'Posting…';

  try {
    const payload = {
      body: gleamBodyWithSource(elements.body.value, draft.sourceUrl, category),
      category,
    };
    const attribution = elements.attribution.value.trim();
    if (category === 'aphorism' && attribution) payload.aphorism_attribution = attribution;

    const response = await fetch(`${FEASON_ORIGIN}/api/gleams`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401) {
        authToken = '';
        await chrome.storage.local.remove('feasonAuthToken');
      }
      throw Object.assign(new Error(errorMessage(response.status, data)), { status: response.status });
    }

    lastPostedId = typeof data?.id === 'string' ? data.id : '';
    await chrome.storage.local.set({ lastGleamCategory: category });
    elements.successTitle.textContent = categoryDetails(category).blessing;
    setView('success');
  } catch (error) {
    const unauthorized = error && error.status === 401;
    elements.statusMessage.className = 'message error';
    elements.statusMessage.textContent = error instanceof Error ? error.message : 'Couldn’t post your gleam.';
    if (unauthorized) {
      elements.signInError.textContent = elements.statusMessage.textContent;
      setView('sign-in');
    }
  } finally {
    posting = false;
    postLabel.textContent = 'Post Gleam';
    updateForm();
  }
}

function postAnother() {
  lastPostedId = '';
  draft = { body: '', category: 'reflection', sourceUrl: '', sourceTitle: '' };
  elements.body.value = '';
  elements.attribution.value = '';
  elements.sourceCard.hidden = true;
  elements.statusMessage.textContent = '';
  chooseCategory('reflection');
  setView('composer');
  elements.body.focus();
}

async function initialize() {
  renderCategories();
  const [stored, initialDraft] = await Promise.all([
    chrome.storage.local.get('feasonAuthToken'),
    currentDraft(),
  ]);
  authToken = stored.feasonAuthToken || '';
  renderDraft(initialDraft);
  setView(authToken ? 'composer' : 'sign-in');
  if (authToken) elements.body.focus();
}

elements.body.addEventListener('input', updateForm);
elements.attribution.addEventListener('input', updateForm);
elements.composer.addEventListener('submit', postGleam);
elements.signInButton.addEventListener('click', signIn);
elements.accountButton.addEventListener('click', signOut);
elements.anotherButton.addEventListener('click', postAnother);
elements.viewGleamButton.addEventListener('click', () => {
  const path = lastPostedId ? `/gleams/${lastPostedId}` : '/gleams';
  chrome.tabs.create({ url: `${FEASON_ORIGIN}${path}` });
});

initialize().catch((error) => {
  setView('sign-in');
  elements.signInError.textContent = error instanceof Error ? error.message : 'Couldn’t open the composer.';
});
