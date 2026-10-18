import { beforeEach, expect, it, vi } from "vitest";
import {
  checkRecall,
  createOfflineLibrary,
  downloadedPassage,
  studyMarkdown,
  CACHE_NAME,
  OFFLINE_LIMIT,
} from "./library.mjs";
const full = {
  reference: "John 15",
  anchor: { book: 43, chapter: 15, verse: 1 },
  href: "/scripture/john/15#verse-1",
  verses: [
    { verse: 1, text: "I am the vine." },
    { verse: 2, text: "Remain in my love." },
  ],
  translation: "WEB",
};
it("checks recalled words while ignoring punctuation, case, and accents", () => {
  expect(checkRecall("I AM, the vine!", "I am the vine.").exact).toBe(true);
  expect(checkRecall("I the vine", "I am the vine.")).toMatchObject({
    exact: false,
    entered: 3,
    total: 4,
  });
});
it("reads a downloaded chapter or valid verse range without inventing missing verses", () => {
  expect(downloadedPassage("John 15:2", full)).toMatchObject({
    offline: true,
    verses: [{ verse: 2 }],
    anchor: { verse: 2 },
  });
  expect(downloadedPassage("John 15:2-1", full)).toBeNull();
  expect(downloadedPassage("John 15:3", full)).toBeNull();
  expect(downloadedPassage("John 16", full)).toBeNull();
});
it("exports sources and only explicitly included notes, and omits incomplete AI answers", () => {
  const item = {
    kind: "page",
    title: "A page",
    url: "https://example.org/",
    quote: "A quote",
    note: "Private note",
    reference: "John 15",
    wordTerms: ["G3306"],
  };
  expect(studyMarkdown([item])).toContain("Source: <https://example.org/>");
  expect(studyMarkdown([item])).not.toContain("Private note");
  expect(studyMarkdown([item], true, true)).toContain("Private note");
  expect(studyMarkdown([item], false, true)).toContain("original context");
  expect(
    studyMarkdown([], false, false, full, {
      status: "pending",
      text: "Incomplete",
    }),
  ).not.toContain("Incomplete");
});
beforeEach(() => {
  vi.unstubAllGlobals();
});
function offlineHarness() {
  const store: Record<string, unknown> = {},
    entries = new Map<string, Response>();
  const cache = {
    put: vi.fn(async (key: string, response: Response) => {
      entries.set(key, response.clone());
    }),
    match: vi.fn(async (key: string) => entries.get(key)?.clone()),
    delete: vi.fn(async (key: string) => entries.delete(key)),
  };
  vi.stubGlobal("caches", { open: vi.fn(async () => cache) });
  vi.stubGlobal("chrome", {
    runtime: { getURL: (p: string) => `chrome-extension://id/${p}` },
    storage: {
      local: {
        get: async (k: string) => ({ [k]: store[k] }),
        set: async (v: object) => {
          Object.assign(store, v);
        },
      },
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json([{ number: 43, name: "John" }])),
  );
  const publicFetch = vi.fn(async (path: string) =>
    path.includes("/audio")
      ? new Response(new Uint8Array([1, 2, 3]), {
          headers: { "Content-Type": "audio/mpeg" },
        })
      : Response.json(full),
  );
  return {
    store,
    entries,
    cache,
    publicFetch,
    library: createOfflineLibrary(publicFetch),
  };
}
it("downloads only a full public chapter and its fixed audio URL, supports offline ranges, and removes both", async () => {
  const h = offlineHarness();
  await h.library.save("John 15:2");
  expect(h.publicFetch.mock.calls.map((c) => c[0])).toContain(
    "/api/extension/passage?reference=John%2015",
  );
  expect(h.publicFetch.mock.calls.map((c) => c[0])).toContain(
    "/api/extension/audio?book=43&chapter=15",
  );
  expect(h.entries.size).toBe(2);
  expect((await h.library.find("John 15:2")).offline).toBe(true);
  expect(await h.library.list()).toMatchObject([
    { reference: "John 15", audio: true },
  ]);
  await h.library.remove("43-15");
  expect(h.entries.size).toBe(0);
  expect(await h.library.list()).toEqual([]);
  expect(CACHE_NAME).toBe("feason-scripture-v1");
});
it("rejects an eleventh chapter and does not claim a failed cache write succeeded", async () => {
  const h = offlineHarness();
  h.store.feasonDownloads = Array.from({ length: OFFLINE_LIMIT }, (_, n) => ({
    key: `1-${n}`,
    bytes: 1,
  }));
  await expect(h.library.save("John 15")).rejects.toThrow("10 chapters");
  h.store.feasonDownloads = [];
  h.cache.put.mockRejectedValueOnce(new Error("Quota exceeded"));
  await expect(h.library.save("John 15")).rejects.toThrow("Quota exceeded");
  expect(await h.library.list()).toEqual([]);
});
