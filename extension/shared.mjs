export const FEASON_ORIGIN = 'https://www.feason.com';
export const DEFAULT_MAX = 2026;
export const APHORISM_MAX = 240;
export const ATTRIBUTION_MAX = 80;

export const CATEGORIES = [
  { key: 'reflection', label: 'Reflection', placeholder: 'Share a reflection…', blessing: 'Reflection posted.' },
  { key: 'prayer', label: 'Prayer', placeholder: 'Offer a prayer…', blessing: 'Your prayer is lifted.' },
  { key: 'question', label: 'Question', placeholder: 'Ask a question…', blessing: 'A good question asked.' },
  { key: 'praise', label: 'Praise', placeholder: 'Lift up a praise…', blessing: 'Your praise resounds.' },
  { key: 'resource', label: 'Resource', placeholder: 'Add a thought to this resource…', blessing: 'A gift for the fellowship.' },
  { key: 'aphorism', label: 'Aphorism', placeholder: 'Say it in one line…', blessing: 'A line worth keeping.' },
];

export function categoryDetails(key) {
  return CATEGORIES.find((category) => category.key === key) || CATEGORIES[0];
}

export function categoryLimit(key) {
  return key === 'aphorism' ? APHORISM_MAX : DEFAULT_MAX;
}

export function safeWebUrl(value) {
  try {
    const url = new URL(value || '');
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

export function textLimitWithSource(category, source) {
  const limit = categoryLimit(category);
  return source ? Math.max(0, limit - source.length - 2) : limit;
}

function fitTextForSource(text, source) {
  const cleanText = (text || '').trim();
  const room = textLimitWithSource(source ? 'resource' : 'reflection', source);
  if (!cleanText || room <= 0) return '';
  const excerpt = cleanText.length > room
    ? `${cleanText.slice(0, Math.max(0, room - 1)).trimEnd()}…`
    : cleanText;
  return excerpt;
}

export function gleamBodyWithSource(text, source, category = 'reflection') {
  const cleanText = (text || '').trim();
  const cleanSource = safeWebUrl(source);
  if (!cleanSource) return cleanText.slice(0, categoryLimit(category));
  if (!cleanText) return cleanSource.length <= categoryLimit(category) ? cleanSource : '';

  const room = textLimitWithSource(category, cleanSource);
  if (room <= 0) return '';
  return `${cleanText.slice(0, room).trimEnd()}\n\n${cleanSource}`;
}

export function draftFromContext(info = {}, tab = {}) {
  const pageUrl = safeWebUrl(info.pageUrl || tab.url);
  const linkUrl = safeWebUrl(info.linkUrl);
  const source = linkUrl || pageUrl;
  const selection = typeof info.selectionText === 'string' ? info.selectionText : '';
  const body = fitTextForSource(selection, source);

  return {
    body,
    category: source ? 'resource' : 'reflection',
    sourceUrl: source,
    sourceTitle: (tab.title || '').trim(),
  };
}

export function errorMessage(status, payload) {
  if (status === 401) return 'Your Feason sign-in has expired. Sign in again to post.';
  if (payload && typeof payload.error === 'string') return payload.error;
  if (status === 429) return 'Posting too quickly. Please wait a moment.';
  return 'Couldn’t post your gleam. Please try again.';
}
