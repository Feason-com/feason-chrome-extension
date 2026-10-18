import { FEASON_ORIGIN, safeWebUrl } from "./shared.mjs";
export const OFFLINE_LIMIT = 10;
export const OFFLINE_BYTES = 150 * 1024 * 1024;
export const CACHE_NAME = "feason-scripture-v1";
export function recallWords(text) {
  return (
    String(text)
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) || []
  );
}
export function checkRecall(attempt, expected) {
  const a = recallWords(attempt),
    b = recallWords(expected);
  return {
    exact: a.join(" ") === b.join(" "),
    entered: a.length,
    total: b.length,
  };
}
export function studyMarkdown(
  items,
  includeNotes = false,
  discussion = false,
  passage = null,
  chat = null,
  books = [],
) {
  const clean = (s) =>
    String(s || "")
      .replace(/[\r\n]/g, " ")
      .replace(/[#*_`\[\]<>]/g, "");
  const parts = [
    "# Feason study sheet",
    "Scripture: World English Bible (public domain). Linked sources retain their own rights. Read cited passages in context.",
  ];
  if (passage)
    parts.push(
      `## ${clean(passage.reference)} (WEB)`,
      passage.verses.map((v) => `> ${v.verse} ${v.text}`).join("\n"),
      `Source: ${FEASON_ORIGIN}${passage.href}`,
    );
  if (chat?.status === "success") {
    parts.push(
      "## Feasy conversation",
      chat.text,
      "Feasy can make mistakes. Check its claims against Scripture.",
    );
    for (const p of chat.passages || []) {
      const book = books.find((b) => b.number === p.book_num);
      parts.push(
        `[${p.citation_num}] ${book?.name || `Book ${p.book_num}`} ${p.chapter}:${p.verse}\n> ${p.text}`,
      );
      if (book)
        parts.push(
          `Source: ${FEASON_ORIGIN}/scripture/${book.slug}/${p.chapter}?verse=${p.verse}`,
        );
    }
    if (chat.threadId)
      parts.push(
        `Conversation: ${FEASON_ORIGIN}/intelligence?razon=${chat.threadId}`,
      );
  }
  for (const item of items.filter((i) => i.kind !== "collection")) {
    parts.push(`## ${clean(item.title)}`);
    const url = safeWebUrl(item.url);
    if (url) parts.push(`Source: <${url}>`);
    if (item.reference) parts.push(`Scripture: ${clean(item.reference)}`);
    if (item.quote)
      parts.push(
        item.quote
          .split("\n")
          .map((s) => `> ${s}`)
          .join("\n"),
      );
    if (item.wordTerms?.length)
      parts.push(`Words: ${item.wordTerms.map(clean).join(", ")}`);
    if (item.threadId)
      parts.push(
        `Conversation: ${FEASON_ORIGIN}/intelligence?razon=${item.threadId}`,
      );
    if (includeNotes && item.note)
      parts.push(`### Private notes\n\n${item.note}`);
  }
  if (discussion)
    parts.push(
      "## Discuss\n\n1. What does this passage say in its original context?\n2. What questions remain, and which sources help us explore them?\n3. What faithful response might this invite today?",
    );
  return parts.join("\n\n") + "\n";
}
export function downloadedPassage(reference, full) {
  // Offline lookups use the downloaded chapter's canonical name, with an optional verse/range.
  const input = String(reference).trim().replace(/[–—]/g, "-");
  const base = full.reference.replace(/:\d+(?:-\d+)?$/, "");
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = input.match(
    new RegExp(`^${escaped}(?::(\\d+)(?:-(\\d+))?)?$`, "i"),
  );
  if (!match) return null;
  const start = match[1] ? Number(match[1]) : 1,
    end = Number(match[2] || match[1] || full.verses.at(-1).verse);
  if (
    end < start ||
    !full.verses.some((v) => v.verse === start) ||
    !full.verses.some((v) => v.verse === end)
  )
    return null;
  return {
    ...full,
    reference: input,
    verses: full.verses.filter((v) => v.verse >= start && v.verse <= end),
    anchor: { ...full.anchor, verse: start },
    href: full.href.replace(/#.*$/, `#verse-${start}`),
    offline: true,
  };
}
export function createOfflineLibrary(publicFetch) {
  let writes = Promise.resolve();
  const textKey = (key) => `${FEASON_ORIGIN}/offline/chapter/${key}`;
  const audioKey = (key) =>
    `${FEASON_ORIGIN}/api/extension/audio?book=${key.split("-")[0]}&chapter=${key.split("-")[1]}`;
  async function list() {
    return (
      (await chrome.storage.local.get("feasonDownloads")).feasonDownloads || []
    );
  }
  async function find(reference) {
    const cache = await caches.open(CACHE_NAME);
    for (const item of await list()) {
      const response = await cache.match(textKey(item.key));
      if (response) {
        const passage = downloadedPassage(reference, await response.json());
        if (passage) return passage;
      }
    }
    throw new Error(
      "Offline: download this chapter while connected, then use its full book name.",
    );
  }
  function save(reference, audio = true) {
    const task = writes.then(async () => {
      const full = await (
        await publicFetch(
          `/api/extension/passage?reference=${encodeURIComponent(reference)}`,
        )
      ).json();
      // Always download a complete chapter, even if a verse range was requested.
      const books = await (
        await fetch(chrome.runtime.getURL("books.json"))
      ).json();
      const book = books.find((b) => b.number === full.anchor.book);
      if (!book) throw new Error("Unknown chapter.");
      const chapter = full.anchor.chapter,
        key = `${book.number}-${chapter}`;
      const chapterData = await (
        await publicFetch(
          `/api/extension/passage?reference=${encodeURIComponent(`${book.name} ${chapter}`)}`,
        )
      ).json();
      const old = await list(),
        existing = old.find((i) => i.key === key);
      if (!existing && old.length >= OFFLINE_LIMIT)
        throw new Error(
          "Keep up to 10 chapters offline. Remove one before downloading another.",
        );
      const text = new Response(JSON.stringify(chapterData), {
        headers: { "Content-Type": "application/json" },
      });
      const audioResponse = audio
        ? await publicFetch(
            `/api/extension/audio?book=${book.number}&chapter=${chapter}`,
          )
        : null;
      if (
        Number(audioResponse?.headers.get("content-length")) >
        50 * 1024 * 1024
      )
        throw new Error("This recording is too large to download.");
      const bytes = audioResponse ? await audioResponse.arrayBuffer() : null;
      const size =
        (bytes?.byteLength || 0) +
        new TextEncoder().encode(JSON.stringify(chapterData)).byteLength;
      if (
        size > 50 * 1024 * 1024 ||
        old.filter((i) => i.key !== key).reduce((s, i) => s + i.bytes, 0) +
          size >
          OFFLINE_BYTES
      )
        throw new Error(
          "Offline storage is full (150 MB). Remove a download first.",
        );
      const cache = await caches.open(CACHE_NAME);
      try {
        await cache.put(textKey(key), text);
        if (bytes)
          await cache.put(
            audioKey(key),
            new Response(bytes, { headers: { "Content-Type": "audio/mpeg" } }),
          );
        else await cache.delete(audioKey(key));
        const record = {
          key,
          book: book.number,
          chapter,
          reference: `${book.name} ${chapter}`,
          bytes: size,
          audio: Boolean(bytes),
          downloadedAt: new Date().toISOString(),
        };
        await chrome.storage.local.set({
          feasonDownloads: [...old.filter((i) => i.key !== key), record],
        });
        return record;
      } catch (error) {
        await cache.delete(textKey(key));
        await cache.delete(audioKey(key));
        await chrome.storage.local.set({
          feasonDownloads: old.filter((i) => i.key !== key),
        });
        throw error;
      }
    });
    writes = task.catch(() => {});
    return task;
  }
  function remove(key) {
    const task = writes.then(async () => {
      if (!/^\d{1,3}-\d{1,3}$/.test(key)) throw new Error("Invalid chapter.");
      const cache = await caches.open(CACHE_NAME);
      await cache.delete(textKey(key));
      await cache.delete(audioKey(key));
      await chrome.storage.local.set({
        feasonDownloads: (await list()).filter((i) => i.key !== key),
      });
      return true;
    });
    writes = task.catch(() => {});
    return task;
  }
  return { list, find, save, remove };
}

export function libraryPayload(item) {
  const keys = [
    "id",
    "revision",
    "kind",
    "title",
    "url",
    "quote",
    "note",
    "tags",
    "reference",
    "collectionId",
    "threadId",
    "wordTerms",
    "locator",
    "mediaSeconds",
  ];
  return Object.fromEntries(
    keys.filter((k) => item && Object.hasOwn(item, k)).map((k) => [k, item[k]]),
  );
}


// Used locally after an explicit page action. No page body is sent to Feason.
export function findPageReferences(text, books) {
  const abbreviations = { 1: ['Gen'], 2: ['Ex', 'Exod'], 3: ['Lev'], 4: ['Num'], 5: ['Deut'], 6: ['Josh'], 7: ['Judg'], 9: ['1 Sam'], 10: ['2 Sam'], 11: ['1 Kgs'], 12: ['2 Kgs'], 13: ['1 Chr'], 14: ['2 Chr'], 19: ['Psalm', 'Ps', 'Psa'], 20: ['Prov'], 21: ['Eccl'], 22: ['Song of Songs', 'Song', 'Canticles'], 23: ['Isa'], 24: ['Jer'], 25: ['Lam'], 26: ['Ezek'], 27: ['Dan'], 40: ['Matt', 'Mt'], 41: ['Mk'], 42: ['Lk'], 43: ['Jn'], 44: ['Acts of the Apostles'], 45: ['Rom'], 46: ['1 Cor'], 47: ['2 Cor'], 48: ['Gal'], 49: ['Eph'], 50: ['Phil'], 51: ['Col'], 52: ['1 Thess'], 53: ['2 Thess'], 54: ['1 Tim'], 55: ['2 Tim'], 57: ['Philem'], 58: ['Heb'], 59: ['Jas'], 60: ['1 Pet'], 61: ['2 Pet'], 62: ['1 Jn'], 63: ['2 Jn'], 64: ['3 Jn'], 66: ['Rev'] };
  const aliases = books.flatMap(book => [book.name, ...(abbreviations[book.number] || [])].map(name => ({ name, book })));
  const names = aliases.sort((a, b) => b.name.length - a.name.length).map(a => a.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll(' ', '\\s+'));
  const pattern = new RegExp('\\b(' + names.join('|') + ')\\.?\\s+(\\d{1,3})(?::(\\d{1,3})(?:\\s*[-–—]\\s*(\\d{1,3}))?)?(?![\\d:])', 'gi');
  const found = new Map();
  for (const match of String(text).slice(0, 100000).matchAll(pattern)) {
    const book = aliases.find(a => a.name.toLowerCase() === match[1].replace(/\s+/g, ' ').toLowerCase())?.book;
    const chapter = Number(match[2]), first = Number(match[3]), end = Number(match[4]);
    const lastVerse = book?.verses?.[chapter - 1];
    const available = verse => verse >= 1 && verse <= lastVerse && !book.omittedVerses?.[chapter]?.includes(verse);
    if (!lastVerse || (match[3] && !available(first)) || (match[4] && (end < first || !available(end)))) continue;
    const reference = `${book.name} ${chapter}${match[3] ? ':' + first : ''}${match[4] ? '–' + end : ''}`;
    if (!found.has(reference)) found.set(reference, { reference, context: String(text).slice(Math.max(0, match.index - 45), match.index + match[0].length + 65).replace(/\s+/g, ' ').trim() });
    if (found.size >= 30) break;
  }
  return [...found.values()];
}

export function sourcePageUrl(value) {
  const safe = safeWebUrl(value);
  if (!safe) return '';
  const url = new URL(safe), host = url.hostname;
  const id = host === 'youtu.be' ? url.pathname.slice(1) : ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host) ? url.searchParams.get('v') || /^\/(?:shorts|live)\/([^/]+)/.exec(url.pathname)?.[1] : null;
  if (id && /^[\w-]{11}$/.test(id)) return `https://www.youtube.com/watch?v=${id}`;
  url.hash = ''; return url.toString();
}
export function sourceHref(item) {
  const safe = safeWebUrl(item.url);
  if (!safe) return '';
  const url = new URL(safe);
  if (item.mediaSeconds != null && sourcePageUrl(safe).startsWith('https://www.youtube.com/watch?v=')) {
    const video = new URL(sourcePageUrl(safe)); video.searchParams.set('t', `${item.mediaSeconds}s`); return video.toString();
  }
  if (item.locator?.exact) {
    const encode = s => encodeURIComponent(s).replace(/-/g, '%2D');
    const {exact, prefix, suffix} = item.locator;
    url.hash = `:~:text=${prefix ? encode(prefix) + '-,' : ''}${encode(exact)}${suffix ? ',-' + encode(suffix) : ''}`;
  }
  return url.toString();
}
export function videoTimestamp(seconds) {
  const n = Math.max(0, Math.floor(seconds));
  return n >= 3600 ? `${Math.floor(n / 3600)}:${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}` : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}
export function omniboxDestination(input, books) {
  const query = String(input).trim().slice(0, 200);
  if (/^word\s+/i.test(query)) return { tool: 'lexicon', text: query.replace(/^word\s+/i, '') };
  const reference = findPageReferences(query, books)[0];
  if (reference && !/^find\s+/i.test(query)) return { tool: 'study', text: reference.reference };
  return { tool: 'inbox', query: query.replace(/^find\s+/i, '') };
}
export function escapeSuggestion(text) {
  return String(text).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;'}[char]));
}

// Chrome serializes this function for chrome.scripting. Keep it self-contained.
export function pageSnapshot(action = 'scan', locators = [], expectedUrl = '') {
  if (expectedUrl && location.href.split('#')[0] !== expectedUrl.split('#')[0]) throw new Error('The page changed. Choose the action again.');
  if (action === 'clear') { CSS.highlights?.delete('feason-study'); document.getElementById('feason-study-highlight-style')?.remove(); return { matched: 0 }; }
  const normalize = text => String(text || '').replace(/\s+/g, ' ').trim();
  const ignored = 'script,style,noscript,textarea,input,select,button,[contenteditable],nav,header,footer,[hidden],[aria-hidden="true"]';
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode(node) {
    const parent = node.parentElement;
    if (!parent || parent.closest(ignored) || !node.textContent) return NodeFilter.FILTER_REJECT;
    const style = getComputedStyle(parent);
    return style.display === 'none' || style.visibility === 'hidden' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
  }});
  const nodes = []; let node, size = 0;
  while ((node = walker.nextNode()) && nodes.length < 5000 && size < 100000) { nodes.push(node); size += node.textContent.length; }
  const selection = window.getSelection();
  let locator = null;
  if (action === 'capture' && selection?.rangeCount && selection.toString().trim()) {
    const range = selection.getRangeAt(0), exact = selection.toString().trim();
    if (exact.length > 4000) throw new Error('Choose a shorter quotation (up to 4,000 characters).');
    if (!range.commonAncestorContainer.parentElement?.closest(ignored)) {
      const before = range.cloneRange(), after = range.cloneRange();
      before.selectNodeContents(document.body); before.setEnd(range.startContainer, range.startOffset);
      after.selectNodeContents(document.body); after.setStart(range.endContainer, range.endOffset);
      locator = { exact, prefix: normalize(before.toString()).slice(-64), suffix: normalize(after.toString()).slice(0, 64) };
    }
  }
  const url = new URL(location.href), host = url.hostname;
  const videoId = host === 'youtu.be' ? url.pathname.slice(1) : ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host) ? url.searchParams.get('v') || /^\/(?:shorts|live)\/([^/]+)/.exec(url.pathname)?.[1] : null;
  const video = videoId && /^[\w-]{11}$/.test(videoId) ? document.querySelector('video') : null;
  const mediaSeconds = video && Number.isFinite(video.currentTime) && video.currentTime >= 0 && video.currentTime <= 86400 ? Math.floor(video.currentTime) : null;
  if (action !== 'restore') return { url: location.href, title: document.title.slice(0, 200), locator, mediaSeconds, text: action === 'scan' ? nodes.map(n => n.textContent).join(' ').slice(0, 100000) : '' };
  if (!CSS.highlights || typeof Highlight === 'undefined') throw new Error('This browser cannot display page highlights. Open the saved source link instead.');
  const map = []; let text = '', previousBlock = null;
  for (const n of nodes) {
    const value = n.textContent;
    const block = n.parentElement.closest('p,div,section,article,li,h1,h2,h3,h4,h5,h6,blockquote,td,dd,dt');
    if (text && block !== previousBlock && !text.endsWith(' ')) { text += ' '; map.push({node:n, offset:0}); }
    previousBlock = block;
    for (let i = 0; i < value.length && text.length < 100000; i++) {
      const char = /\s/.test(value[i]) ? ' ' : value[i];
      if (char === ' ' && text.endsWith(' ')) continue;
      text += char; map.push({node:n, offset:i});
    }
  }
  const ranges = [];
  for (const saved of locators.slice(0, 200)) {
    const exact = normalize(saved.exact); if (!exact) continue;
    let start = text.indexOf(exact), match = -1, count = 0;
    while (start >= 0) {
      const prefix = normalize(saved.prefix), suffix = normalize(saved.suffix);
      if ((!prefix || text.slice(0, start).trimEnd().endsWith(prefix)) && (!suffix || text.slice(start + exact.length).trimStart().startsWith(suffix))) { match = start; count++; }
      start = text.indexOf(exact, start + exact.length);
    }
    // If page edits have moved the surrounding context, a unique quotation is still safe.
    if (!count && text.indexOf(exact) === text.lastIndexOf(exact)) { match = text.indexOf(exact); count = match >= 0 ? 1 : 0; }
    if (count !== 1 || !map[match] || !map[match + exact.length - 1]) continue;
    const range = document.createRange(), a = map[match], b = map[match + exact.length - 1];
    range.setStart(a.node, a.offset); range.setEnd(b.node, b.offset + 1); ranges.push(range);
  }
  CSS.highlights.set('feason-study', new Highlight(...ranges));
  let style = document.getElementById('feason-study-highlight-style');
  if (!style) { style = document.createElement('style'); style.id = 'feason-study-highlight-style'; document.head.append(style); }
  style.textContent = '::highlight(feason-study){background:#e3bd60;color:#172a22;}';
  ranges[0]?.startContainer.parentElement?.scrollIntoView?.({behavior:'smooth', block:'center'});
  return { matched: ranges.length, total: locators.length };
}
