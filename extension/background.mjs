import { draftFromContext } from './shared.mjs';

const MENU_IDS = {
  page: 'feason-post-page',
  link: 'feason-post-link',
  selection: 'feason-post-selection',
};

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

  try {
    await chrome.action.openPopup();
  } catch {
    await chrome.windows.create({
      url: chrome.runtime.getURL('popup.html'),
      type: 'popup',
      width: 420,
      height: 650,
    });
  }
});
