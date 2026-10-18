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
  ];
  return Object.fromEntries(
    keys.filter((k) => item && Object.hasOwn(item, k)).map((k) => [k, item[k]]),
  );
}
