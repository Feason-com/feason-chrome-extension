import { initializeCompanion } from './companion.mjs';
import {
  CATEGORIES, FEASON_ORIGIN, categoryDetails, categoryLimit, draftFromContext,
  gleamPayload, safeWebUrl, textLimitWithSource, studyQuestion, imageData,
} from './shared.mjs';

const elements = Object.fromEntries([
  'accountButton', 'anotherButton', 'attribution', 'attributionRow', 'body', 'cancelButton',
  'categoryList', 'characterCount', 'composer', 'draftStatus', 'kindLabel', 'limitMessage',
  'loadingView', 'openFeasonButton', 'postButton', 'removeSourceButton', 'signInButton',
  'signInError', 'signInView', 'sourceCard', 'sourceDomain', 'sourceTitle', 'statusMessage',
  'successTitle', 'successView', 'viewGleamButton',
  'companionHeader', 'toolNavigation', 'openPanelButton', 'workspace', 'selectionCard', 'selectionText', 'clearSelectionButton',
  'studyTool', 'verseForm', 'verseReference', 'verseStatus', 'verseResult', 'verseTitle', 'verseText', 'copyVerseButton', 'anchorVerseButton', 'readChapterButton',
  'feasyTool', 'feasyForm', 'feasyQuestion', 'feasyContextNote', 'askFeasyButton', 'feasyStatus', 'feasyResult', 'feasyAnswer', 'feasySources', 'feasyVerification', 'continueFeasyButton', 'newQuestionButton',
  'inboxTool', 'inboxForm', 'inboxTitle', 'inboxUrl', 'inboxQuote', 'saveInboxButton', 'inboxStatus', 'inboxItems', 'refreshInboxButton', 'moreInboxButton', 'openInboxButton',
  'pageTool', 'todayTool', 'practiceTool', 'workspacesTool', 'lexiconTool', 'wordForm', 'wordTerm', 'wordStatus', 'wordResults', 'wordCaveat', 'openLexiconButton',
  'imageControls', 'imageInput', 'imagePreview', 'gleamImage', 'removeImageButton', 'anchorLabel', 'chooseAnchorButton', 'removeAnchorButton',
  'previewButton', 'previewDialog', 'previewCategory', 'previewBody', 'previewAttribution', 'previewImage', 'previewAnchor', 'confirmPreviewButton', 'closePreviewButton',
].map((id) => [id, document.getElementById(id)]));

const editorId = crypto.randomUUID();
let signedIn = false;
let accountEpoch = 0;
let signingIn = false;
let posting = false;
let preparingImage = false;
let ready = false;
let category = 'reflection';
let draft = { body: '', category, sourceUrl: '', sourceTitle: '', attribution: '' };
let lastPostedId = '';
let draftWrites = Promise.resolve();
let companionWrites = Promise.resolve();
const initialStorageChanges = [];
let currentTool = 'gleam';
let selection = null;
let currentPassage = null;
let currentChat = null;
let companion;
let browserWindowId;
let books = [];
let booksLoading;
document.body.dataset.surface = new URLSearchParams(location.search).get('surface') === 'sidepanel' ? 'sidepanel' : 'popup';

function setView(name) {
  document.body.dataset.view = name;
  for (const [view, element] of [
    ['loading', elements.loadingView], ['sign-in', elements.signInView],
    ['composer', elements.composer], ['success', elements.successView],
    ['workspace', elements.workspace],
  ]) element.hidden = name !== view;
  elements.companionHeader.hidden = elements.toolNavigation.hidden = name === 'loading' || name === 'sign-in';
  if (name === 'composer') elements.categoryList.querySelector('[aria-checked="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

function snapshotDraft() {
  return { ...draft, body: elements.body.value, category, attribution: elements.attribution.value };
}

function saveDraft() {
  const value = snapshotDraft();
  draftWrites = draftWrites.then(() => chrome.storage.session.set({ gleamDraft: { ...value, editorId } })).then(() => {
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
  elements.imageControls.hidden = category !== 'resource';
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
  elements.postButton.disabled = posting || preparingImage || Boolean(error) || tooLong || !signedIn;
  elements.postButton.querySelector('.post-label').textContent = posting ? 'Posting…' : 'Post';
  elements.composer.setAttribute('aria-busy', String(posting));
  elements.body.readOnly = posting;
  elements.attribution.disabled = posting;
  elements.removeSourceButton.disabled = posting;
  elements.accountButton.disabled = posting;
  elements.cancelButton.disabled = posting;
  elements.previewButton.disabled = elements.postButton.disabled;
  elements.imageInput.disabled = posting || preparingImage;
  for (const chip of elements.categoryList.children) chip.disabled = posting;
}

function renderDraft(nextDraft) {
  draft = {
    body: typeof nextDraft?.body === 'string' ? nextDraft.body : '',
    category: categoryDetails(nextDraft?.category).key,
    sourceUrl: safeWebUrl(nextDraft?.sourceUrl),
    sourceTitle: typeof nextDraft?.sourceTitle === 'string' ? nextDraft.sourceTitle : '',
    attribution: typeof nextDraft?.attribution === 'string' ? nextDraft.attribution : '',
    image: typeof nextDraft?.image === 'string' && imageData(nextDraft.image) ? nextDraft.image : '',
    anchor: nextDraft?.anchor || null,
    anchorLabel: typeof nextDraft?.anchorLabel === 'string' ? nextDraft.anchorLabel : '',
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
  renderAttachments();
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
    renderDraft({ category: state.category });
    currentTool = 'gleam';
    document.body.dataset.tool = 'gleam';
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
  await Promise.all([draftWrites, companionWrites, companion.flush()]);
  try {
    const result = await chrome.runtime.sendMessage({ type: 'feason:sign-out' });
    if (!result?.ok) throw new Error('Sign-out did not finish. Try again.');
    signedIn = false;
    selection = null; currentChat = null; companion.reset();
    applySelection(null); renderChat(null);
    for (const input of [elements.feasyQuestion, elements.verseReference, elements.wordTerm, elements.inboxTitle, elements.inboxUrl, elements.inboxQuote]) input.value = '';
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
    accountEpoch++;
    signedIn = Boolean(changes.feasonAuthToken.newValue);
    companion.reset(true); currentPassage = null;
    elements.inboxItems.replaceChildren(); elements.wordResults.replaceChildren(); elements.verseResult.hidden = true;
    renderChat(null);
    if (signedIn) {
      renderAuthState();
      elements.statusMessage.textContent = '';
      setTool(currentTool);
      elements.body.focus();
    } else setView('sign-in');
    updateForm();
  }
  if (area === 'session' && changes.feasonAccountReset) {
    companion.reset(); renderDraft({}); selection = null; currentPassage = null;
    for (const input of [elements.feasyQuestion, elements.verseReference, elements.wordTerm, elements.inboxTitle, elements.inboxUrl, elements.inboxQuote]) input.value = '';
  }
  if (area === 'session' && !posting && changes.gleamDraft?.newValue?.editorId && changes.gleamDraft.newValue.editorId !== editorId) {
    renderDraft(changes.gleamDraft.newValue);
    elements.draftStatus.textContent = 'Draft updated in your other Feason panel.';
  }
  if (area === 'session' && changes.feasonAuthState) renderAuthState(changes.feasonAuthState.newValue);
  if (area === 'session' && changes.feasonPostState?.newValue) renderPostState(changes.feasonPostState.newValue);
  if (area === 'session' && changes.feasonChatState) renderChat(changes.feasonChatState.newValue);
  if (area === 'session' && changes.feasonSelection) applySelection(changes.feasonSelection.newValue);
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
elements.cancelButton.addEventListener('click', async () => { await saveDraft(); if (document.body.dataset.surface === 'sidepanel') setTool('study'); else window.close(); });
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

function setTool(name) {
  currentTool = ['today', 'page', 'practice', 'workspaces', 'study', 'feasy', 'inbox', 'lexicon', 'gleam'].includes(name) ? name : 'gleam';
  document.body.dataset.tool = currentTool;
  for (const button of elements.toolNavigation.querySelectorAll('button')) button.setAttribute('aria-current', button.dataset.tool === currentTool ? 'page' : 'false');
  for (const tool of ['today', 'page', 'practice', 'workspaces', 'study', 'feasy', 'inbox', 'lexicon']) elements[`${tool}Tool`].hidden = tool !== currentTool;
  setView(!signedIn ? 'sign-in' : currentTool === 'gleam' ? 'composer' : 'workspace');
  if (signedIn) companion?.open(currentTool);
}

function renderAttachments() {
  elements.imagePreview.hidden = !draft.image;
  if (draft.image) elements.gleamImage.src = draft.image;
  else elements.gleamImage.removeAttribute('src');
  elements.anchorLabel.textContent = draft.anchor ? draft.anchorLabel || 'Scripture verse attached' : '';
  elements.removeAnchorButton.hidden = !draft.anchor;
}

function saveCompanionDraft() {
  const value = {
    question: elements.feasyQuestion.value, reference: elements.verseReference.value, term: elements.wordTerm.value,
    title: elements.inboxTitle.value, url: elements.inboxUrl.value, quote: elements.inboxQuote.value,
  };
  companionWrites = companionWrites.then(() => chrome.storage.session.set({ companionDraft: value })).catch(() => {});
  return companionWrites;
}

function applySelection(value) {
  selection = value;
  elements.selectionCard.hidden = !value?.text;
  elements.selectionText.textContent = value?.text || '';
  elements.feasyContextNote.textContent = value?.text ? 'Your question and a short excerpt of the selection will be sent when you ask.' : '';
  if (!value) return;
  if (value.tool === 'study') elements.verseReference.value = String(value.text || '').slice(0, 120);
  if (value.tool === 'lexicon') elements.wordTerm.value = String(value.text || '').slice(0, 100);
  if (value.tool === 'feasy' && !elements.feasyQuestion.value) elements.feasyQuestion.value = 'How does this relate to Scripture?';
  if (value.tool === 'inbox') {
    companion.startInboxContext(value);
    elements.inboxTitle.value = String(value.title || '').slice(0, 200);
    elements.inboxUrl.value = safeWebUrl(value.url);
    elements.inboxQuote.value = String(value.text || '').slice(0, 4000);
  }
  if (value.tool === 'inbox' && typeof value.query === 'string') companion.searchLibrary(value.query);
  setTool(value.tool);
  void saveCompanionDraft();
}

async function command(type, values = {}) {
  const epoch = accountEpoch;
  const result = await chrome.runtime.sendMessage({ type: `feason:${type}`, ...values });
  if (epoch !== accountEpoch) throw new Error('Your sign-in changed. Choose the action again when ready.');
  if (!result?.ok) throw new Error(result?.error || 'Couldn’t complete that action. Please try again.');
  return result.data;
}

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function feasonLink(label, path) {
  const link = node('a', label);
  link.href = `${FEASON_ORIGIN}${path.startsWith('/') && !path.startsWith('//') ? path : '/'}`;
  link.target = '_blank'; link.rel = 'noopener noreferrer';
  return link;
}
function openPath(path) { void chrome.tabs.create({ url: `${FEASON_ORIGIN}${path}` }); }

async function lookupPassage(event) {
  event?.preventDefault();
  const button = elements.verseForm.querySelector('button');
  button.disabled = true; elements.verseStatus.textContent = 'Opening Scripture…';
  try {
    const data = await command('passage', { reference: elements.verseReference.value });
    currentPassage = data;
    elements.verseTitle.textContent = data.reference;
    elements.verseText.replaceChildren(...data.verses.map(verse => {
      const paragraph = node('p');
      paragraph.append(node('sup', String(verse.verse)), document.createTextNode(` ${verse.text}`));
      return paragraph;
    }));
    elements.verseResult.hidden = false;
    elements.verseStatus.textContent = data.offline ? 'Reading your downloaded chapter offline.' : '';
    void saveCompanionDraft();
  } catch (error) { elements.verseStatus.textContent = error.message; }
  finally { button.disabled = false; }
}

function loadBooks() {
  booksLoading ??= fetch(chrome.runtime.getURL('books.json')).then(response => response.json()).then(data => { books = data; }).catch(() => {});
  return booksLoading;
}

function renderChat(state) {
  currentChat = state || null;
  elements.askFeasyButton.disabled = state?.status === 'pending';
  elements.newQuestionButton.disabled = state?.status === 'pending';
  elements.feasyResult.hidden = !state?.text;
  elements.feasyAnswer.textContent = state?.text || '';
  elements.feasyStatus.textContent = state?.status === 'pending' ? 'Feasy is thinking with Scripture…' : state?.error || '';
  elements.feasySources.replaceChildren();
  for (const passage of state?.passages || []) {
    const book = books.find(entry => entry.number === passage.book_num);
    const source = node('article', '', 'feasy-source');
    const label = `[${passage.citation_num}] ${book?.name || `Book ${passage.book_num}`} ${passage.chapter}:${passage.verse}`;
    source.append(book ? feasonLink(label, `/scripture/${book.slug}/${Number(passage.chapter)}#verse-${Number(passage.verse)}`) : node('strong', label), node('p', passage.text));
    elements.feasySources.append(source);
  }
  if (state?.passages?.length && !books.length) void loadBooks().then(() => { if (currentChat === state && books.length) renderChat(state); });
  const verdict = state?.verification?.verdict;
  const labels = { verified: 'Scripture grounding checked.', partial: 'Some claims need closer review. Read the cited passages in context.', unverified: 'This answer’s claims were not supported by its cited passages. Check Scripture before relying on it.', skipped: 'Grounding check unavailable. Read the cited passages in context.' };
  elements.feasyVerification.textContent = labels[verdict] || (state?.status === 'success' ? 'Read the cited passages in context; Feasy can make mistakes.' : '');
  elements.continueFeasyButton.hidden = !state?.threadId;
}

async function askQuestion(event) {
  event.preventDefault();
  if (elements.askFeasyButton.disabled) return;
  try {
    studyQuestion(elements.feasyQuestion.value, selection?.text);
    elements.askFeasyButton.disabled = true;
    elements.feasyStatus.textContent = 'Feasy is thinking with Scripture…';
    await saveCompanionDraft();
    await command('ask', { question: elements.feasyQuestion.value, selection: selection?.text || '', threadId: currentChat?.threadId || '' });
  } catch (error) { elements.feasyStatus.textContent = error.message; }
  finally { elements.askFeasyButton.disabled = false; }
}

async function lookupWord(event, term = elements.wordTerm.value) {
  event?.preventDefault();
  const button = elements.wordForm.querySelector('button'); button.disabled = true;
  elements.wordStatus.textContent = 'Looking up this word…';
  elements.wordResults.replaceChildren(); elements.wordCaveat.textContent = '';
  try {
    const data = await command('word', { term });
    const entries = data.entry ? [data.entry] : data.matches || [];
    for (const entry of entries) {
      const card = node('article', '', 'study-result word-entry');
      card.append(node('p', `${entry.language} · ${entry.strongs}`, 'eyebrow'), node('h2', entry.lemma), node('p', entry.transliteration, 'transliteration'), node('p', entry.shortGloss), node('p', entry.definition));
      for (const sense of entry.senses || []) card.append(node('p', `${sense.sense}${sense.refs?.length ? ` · ${sense.refs.join(', ')}` : ''}`, 'field-note'));
      if (!data.entry) {
        const choose = node('button', 'Explore this entry →', 'text-button'); choose.type = 'button';
        choose.addEventListener('click', () => { elements.wordTerm.value = entry.strongs; void lookupWord(null, entry.strongs); }); card.append(choose);
      }
      card.append(node('p', `Lexicon: ${entry.source} · ${entry.sourceVersion}`, 'field-note'));
      elements.wordResults.append(card);
    }
    if (data.occurrences?.length) {
      const refs = node('div', '', 'word-occurrences'); refs.append(node('h2', 'In Scripture'));
      for (const occurrence of data.occurrences) refs.append(feasonLink(occurrence.label, occurrence.href));
      elements.wordResults.append(refs);
    }
    if (data.provenance) {
      elements.wordResults.append(node('p', `Text: ${data.provenance.text}. Tagging: ${data.provenance.tagging}. ${data.provenance.license}.`, 'field-note'));
      const sourceUrl = safeWebUrl(data.provenance.url);
      if (sourceUrl) { const source = node('a', 'View corpus source ↗'); source.href = sourceUrl; source.target = '_blank'; source.rel = 'noopener noreferrer'; elements.wordResults.append(source); }
    }
    elements.wordCaveat.textContent = data.caveat || '';
    elements.wordStatus.textContent = entries.length ? '' : data.reason || 'No entry found. Try a lemma, transliteration, or Strong’s code.';
    void saveCompanionDraft();
  } catch (error) { elements.wordStatus.textContent = error.message; }
  finally { button.disabled = false; }
}

for (const button of elements.toolNavigation.querySelectorAll('button')) button.addEventListener('click', () => setTool(button.dataset.tool));
for (const input of [elements.feasyQuestion, elements.verseReference, elements.wordTerm, elements.inboxTitle, elements.inboxUrl, elements.inboxQuote]) input.addEventListener('input', () => void saveCompanionDraft());
elements.openPanelButton.addEventListener('click', () => { void chrome.sidePanel.open({ windowId: browserWindowId }).catch(() => { elements.statusMessage.textContent = 'Open the Feason side panel from Chrome’s toolbar.'; }); });
elements.clearSelectionButton.addEventListener('click', () => { applySelection(null); void chrome.storage.session.remove('feasonSelection'); });
elements.verseForm.addEventListener('submit', lookupPassage);
elements.feasyForm.addEventListener('submit', askQuestion);

elements.wordForm.addEventListener('submit', lookupWord);


elements.openInboxButton.addEventListener('click', () => openPath('/reading-inbox'));
elements.openLexiconButton.addEventListener('click', () => openPath('/lexicon'));
elements.continueFeasyButton.addEventListener('click', () => { if (currentChat?.threadId) openPath(`/intelligence?razon=${encodeURIComponent(currentChat.threadId)}`); });
elements.newQuestionButton.addEventListener('click', async () => { if (elements.askFeasyButton.disabled) return; await chrome.storage.session.remove('feasonChatState'); renderChat(null); elements.feasyQuestion.value = ''; void saveCompanionDraft(); elements.feasyQuestion.focus(); });
elements.copyVerseButton.addEventListener('click', async () => {
  if (!currentPassage) return;
  try { await navigator.clipboard.writeText(`${currentPassage.verses.map(verse => `${verse.verse} ${verse.text}`).join('\n')}\n— ${currentPassage.reference} (WEB)`); elements.verseStatus.textContent = 'Passage copied.'; }
  catch { elements.verseStatus.textContent = 'Couldn’t copy automatically. You can select and copy the passage.'; }
});
elements.readChapterButton.addEventListener('click', () => { if (currentPassage) openPath(currentPassage.href); });
elements.anchorVerseButton.addEventListener('click', () => { if (!currentPassage || posting) return; draft.anchor = currentPassage.anchor; draft.anchorLabel = `${currentPassage.reference.split(':')[0]}:${currentPassage.anchor.verse}`; renderAttachments(); void saveDraft(); setTool('gleam'); });
elements.chooseAnchorButton.addEventListener('click', () => { if (!posting) { setTool('study'); elements.verseReference.focus(); } });
elements.removeAnchorButton.addEventListener('click', () => { if (posting) return; draft.anchor = null; draft.anchorLabel = ''; renderAttachments(); void saveDraft(); });
elements.removeImageButton.addEventListener('click', () => { if (posting) return; draft.image = ''; elements.imageInput.value = ''; renderAttachments(); void saveDraft(); });
elements.imageInput.addEventListener('change', async () => {
  const file = elements.imageInput.files[0];
  if (!file || posting) return;
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > 5 * 1024 * 1024) { elements.statusMessage.textContent = 'Choose a JPEG, PNG, WebP, or GIF up to 5 MB.'; elements.imageInput.value = ''; return; }
  preparingImage = true; updateForm();
  const epoch = accountEpoch;
  try {
    const image = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    if (epoch !== accountEpoch) return;
    if (!imageData(image)) throw new Error('Unsupported image');
    draft.image = image; renderAttachments(); await saveDraft(); elements.statusMessage.textContent = 'Image ready. It uploads only when you post a Resource.';
  } catch { elements.statusMessage.textContent = 'Couldn’t read this image. Please choose another.'; }
  finally { preparingImage = false; updateForm(); }
});
elements.previewButton.addEventListener('click', () => {
  if (elements.previewButton.disabled) return;
  const payload = gleamPayload(snapshotDraft());
  elements.previewCategory.textContent = categoryDetails(category).label.toUpperCase();
  elements.previewBody.textContent = payload.body;
  elements.previewAttribution.textContent = payload.aphorism_attribution ? `— ${payload.aphorism_attribution}` : '';
  elements.previewAnchor.textContent = draft.anchor ? `Anchored to ${draft.anchorLabel || 'Scripture'}` : '';
  elements.previewImage.hidden = category !== 'resource' || !draft.image;
  if (draft.image) elements.previewImage.src = draft.image;
  elements.previewDialog.showModal();
});
elements.closePreviewButton.addEventListener('click', () => elements.previewDialog.close());
elements.confirmPreviewButton.addEventListener('click', () => { elements.previewDialog.close(); elements.composer.requestSubmit(); });

companion = initializeCompanion({ command, node, openPath, setTool, clearInboxDraft: saveCompanionDraft, capturePage: async () => { const epoch = accountEpoch; const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); if (epoch !== accountEpoch) throw new Error('Your sign-in changed. Choose the page again.'); const url = safeWebUrl(tab?.url); if (!url) throw new Error('Open Feason from the toolbar or right-click the page to use it here.'); return { title: String(tab.title || '').slice(0, 200), url }; }, passage: () => currentPassage, books: () => books, chat: () => currentChat, restoreChat: state => { renderChat(state); void chrome.storage.session.set({ feasonChatState: state }); }, lookup: async reference => { elements.verseReference.value = reference; setTool('study'); await lookupPassage(); } });

async function initialize() {
  renderCategories();
  const [stored, session, tabs, worker] = await Promise.all([
    chrome.storage.local.get('feasonAuthToken'),
    chrome.storage.session.get(['gleamDraft', 'pendingGleamDraft', 'feasonPostState', 'feasonAuthState', 'feasonChatState', 'feasonSelection', 'companionDraft']),
    chrome.tabs.query({ active: true, currentWindow: true }),
    chrome.runtime.sendMessage({ type: 'feason:status' }),
  ]);
  signedIn = Boolean(stored.feasonAuthToken);
  browserWindowId = (await chrome.windows.getCurrent?.())?.id;
  elements.openPanelButton.hidden = !chrome.sidePanel || !Number.isInteger(browserWindowId) || document.body.dataset.surface === 'sidepanel';
  const pending = session.pendingGleamDraft && !worker.posting;
  renderDraft(pending ? session.pendingGleamDraft : session.gleamDraft || draftFromContext({}, tabs[0] || {}));
  if (pending) {
    await saveDraft();
    await chrome.storage.session.remove(['pendingGleamDraft', 'feasonPostState']);
  }
  const savedTools = session.companionDraft || {};
  elements.feasyQuestion.value = savedTools.question || '';
  elements.verseReference.value = savedTools.reference || '';
  elements.wordTerm.value = savedTools.term || '';
  elements.inboxTitle.value = savedTools.title || tabs[0]?.title || '';
  elements.inboxUrl.value = safeWebUrl(savedTools.url || tabs[0]?.url);
  elements.inboxQuote.value = savedTools.quote || '';
  currentTool = pending ? 'gleam' : document.body.dataset.surface === 'sidepanel' ? 'study' : 'gleam';
  setTool(currentTool);
  if (session.feasonSelection) applySelection(session.feasonSelection);
  if (session.feasonChatState) renderChat(session.feasonChatState.status === 'pending' && !worker.chatting ? { ...session.feasonChatState, status: 'error', error: 'The conversation was interrupted. You can ask again when ready.' } : session.feasonChatState);
  renderAuthState(worker.signingIn ? { status: 'pending' } : session.feasonAuthState?.status === 'error' ? session.feasonAuthState : undefined);
  if (!pending && currentTool === 'gleam' && session.feasonPostState) renderPostState(session.feasonPostState, worker.posting);
  ready = true;
  for (const [changes, area] of initialStorageChanges.splice(0)) applyStorageChanges(changes, area);
  if (document.body.dataset.view === 'composer') { await saveDraft(); elements.body.focus(); }
}

initialize().catch(() => {
  setView('sign-in');
  renderAuthState({ error: 'Couldn’t open the composer. Reload the extension and try again.' });
});
