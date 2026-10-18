import { FEASON_ORIGIN, safeWebUrl } from "./shared.mjs";
import { CACHE_NAME, checkRecall, studyMarkdown, sourceHref, sourcePageUrl, videoTimestamp } from "./library.mjs";

export function initializeCompanion(ctx) {
  const $ = (id) => document.getElementById(id);
  const { command, node, openPath, setTool } = ctx;
  let draftWrites = Promise.resolve();
  let captured = null, searchTimer, packIds = new Set(), captureGeneration = 0;
  let libraryLoad = Promise.resolve();
  let items = [],
    collections = [],
    cursor = null,
    editing = null,
    editingWorkspace = null,
    reviews = [],
    reviewBusy = false,
    loading = false,
    epoch = 0,
    audioUrl = "",
    playbackKey = "",
    lastPositionWrite = 0,
    step = 0;
  const message = (id, error) => {
    $(id).textContent = error?.message || String(error || "");
  };
  const button = (label, action, style = "text-button") => {
    const b = node("button", label, style);
    b.type = "button";
    b.addEventListener("click", async () => {
      if (b.disabled) return;
      b.disabled = true;
      try {
        await action();
      } finally {
        b.disabled = false;
      }
    });
    return b;
  };
  const tryAction = (status, action) => async () => {
    try {
      await action();
    } catch (error) {
      message(status, error);
    }
  };
  function populateCollections() {
    for (const id of [
      "inboxCollection",
      "workspaceCollection",
      "libraryFilter",
    ]) {
      const select = $(id),
        previous = select.value;
      select.replaceChildren(
        new Option(id === "libraryFilter" ? "All saved pages" : "Unfiled", ""),
      );
      for (const c of collections) select.append(new Option(c.title, c.id));
      if (
        id !== "libraryFilter" &&
        previous &&
        !collections.some((c) => c.id === previous)
      )
        select.append(new Option("Earlier collection", previous));
      select.value =
        id === "libraryFilter" && !collections.some((c) => c.id === previous)
          ? ""
          : previous;
    }
  }
  function renderLibrary() {
    populateCollections();
    $("inboxItems").replaceChildren();
    $("savedWorkspaces").replaceChildren();
    $("collectionItems").replaceChildren();
    const pages = items.filter(i => i.kind !== "collection");
    for (const item of pages) {
      const card = node("article", "", "inbox-item"),
        url = sourceHref(item);
      const choose = node("label", "", "check-label"), check = document.createElement("input");
      check.type = "checkbox"; check.checked = packIds.has(item.id); check.disabled = !check.checked && packIds.size >= 10;
      check.addEventListener("change", () => { if (check.checked) packIds.add(item.id); else packIds.delete(item.id); renderLibrary(); void persistDraft(); });
      choose.append(check, document.createTextNode(" Include in Flock study pack")); card.append(choose);
      const link = node(url ? "a" : "h2", item.title);
      if (url) { link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; }
      card.append(node("p", item.kind === "workspace" ? "STUDY WORKSPACE" : url ? new URL(url).hostname : "SAVED PAGE", "eyebrow"), link);
      if (item.locator) card.append(node("p", "SAVED HIGHLIGHT · OPEN SOURCE TO RETURN", "field-note"));
      if (item.mediaSeconds != null) card.append(node("p", `VIDEO MOMENT · ${videoTimestamp(item.mediaSeconds)}`, "field-note"));
      if (item.quote) card.append(node("blockquote", item.quote));
      if (item.note) card.append(node("p", item.note, "library-note"));
      if (item.tags?.length)
        card.append(node("p", item.tags.join(" · "), "field-note"));
      const actions = node("div", "", "library-actions");
      actions.append(
        button("Edit notes & collection", () => item.kind === "workspace" ? editWorkspace(item) : editPage(item)),
        button(
          "Remove",
          tryAction("inboxStatus", () => remove(item)),
        ),
      );
      if (item.kind === "workspace") actions.append(button("Resume study", tryAction("inboxStatus", () => resume(item))));
      if (item.reference)
        actions.append(
          button(item.reference, () => ctx.lookup(item.reference)),
        );
      card.append(actions);
      $("inboxItems").append(card);
    }
    if (!pages.length)
      $("inboxItems").append(
        node("p", "Your saved pages will appear here.", "field-note"),
      );
    for (const item of items.filter((i) => i.kind === "workspace")) {
      const card = node("article", "", "inbox-item");
      card.append(
        node("p", "PRIVATE STUDY WORKSPACE", "eyebrow"),
        node("h2", item.title),
        node("p", item.note || item.reference),
      );
      const actions = node("div", "", "library-actions");
      actions.append(
        button(
          "Resume study",
          tryAction("workspaceStatus", () => resume(item)),
        ),
        button("Edit study", () => editWorkspace(item)),
        button(
          "Remove",
          tryAction("workspaceStatus", () => remove(item)),
        ),
      );
      card.append(actions);
      $("savedWorkspaces").append(card);
    }
    for (const item of collections) {
      const row = node("div");
      row.append(node("strong", item.title));
      row.append(
        button("Rename", () => {
          $("collectionTitle").value = item.title;
          $("collectionForm").dataset.editing = item.id;
          $("collectionTitle").focus();
        }),
        button(
          "Delete collection",
          tryAction("inboxStatus", async () => {
            if (
              confirm(
                "Delete this collection? Saved pages and studies will become unfiled.",
              )
            )
              await remove(item, false);
          }),
        ),
      );
      $("collectionItems").append(row);
    }
    $("moreInboxButton").hidden = !cursor;
    $("packSelection").textContent = `${packIds.size} / 10 sources selected for a Flock study pack.`;
    $("preparePack").disabled = !packIds.size;
  }
  async function loadLibrary(earlier = false, latest = false) {
    const loadingEpoch = epoch;
    if (loading) {
      if (!latest) return libraryLoad;
      await libraryLoad;
      if (epoch !== loadingEpoch) return;
      return loadLibrary(false, true);
    }
    let complete;
    libraryLoad = new Promise((resolve) => {
      complete = resolve;
    });
    loading = true;
    const query = $("librarySearch").value.trim(), collection = $("libraryFilter").value;
    message("inboxStatus", "Opening your private library…");
    try {
      const [data, folders] = await Promise.all([
        command("inbox-list", { cursor: earlier ? cursor : null, query, collection }),
        command("collections"),
      ]);
      if (loadingEpoch !== epoch || query !== $("librarySearch").value.trim() || collection !== $("libraryFilter").value) return;
      items = earlier
        ? [
            ...items,
            ...data.items.filter((i) => !items.some((old) => old.id === i.id)),
          ]
        : data.items;
      collections = folders.items;
      cursor = data.nextCursor;
      renderLibrary();
      message("inboxStatus", "");
    } catch (error) {
      if (loadingEpoch === epoch) {
        message("inboxStatus", error);
        message("workspaceStatus", error);
      }
    } finally {
      if (loadingEpoch === epoch) loading = false;
      complete();
    }
  }
  async function remove(item, ask = true) {
    if (ask && !confirm(`Remove “${item.title}” from your library?`)) return;
    const result = await command("inbox-delete", { id: item.id });
    if (!result.deleted)
      throw new Error("This item was not removed. Refresh your library.");
    packIds.delete(item.id);
    items = items.filter((i) => i.id !== item.id);
    collections = collections.filter((i) => i.id !== item.id);
    if (item.kind === "collection") {
      await loadLibrary(false, true);
    } else renderLibrary();
  }
  async function persistDraft() {
    const data = {
      editing,
      editingWorkspace,
      captured, packIds: [...packIds],
      note: $("inboxNote").value,
      reference: $("inboxReference").value,
      tags: $("inboxTags").value,
      collection: $("inboxCollection").value,
      workspaceTitle: $("workspaceTitle").value,
      workspaceNote: $("workspaceNote").value,
      workspaceCollection: $("workspaceCollection").value,
    };
    const writingEpoch = epoch;
    draftWrites = draftWrites
      .then(() => {
        if (writingEpoch === epoch)
          return chrome.storage.session.set({ libraryDraft: data });
      })
      .catch(() => {
        message(
          "inboxStatus",
          "Draft could not be saved. Keep this panel open.",
        );
      });
    await draftWrites;
  }
  function editPage(item) {
    captureGeneration++; editing = item;
    captured = { locator: item.locator, mediaSeconds: item.mediaSeconds, url: item.url };
    captureDetails();
    setTool("inbox");
    for (const [id, value] of Object.entries({
      inboxTitle: item.title,
      inboxUrl: item.url,
      inboxQuote: item.quote,
      inboxNote: item.note || "",
      inboxReference: item.reference || "",
      inboxTags: (item.tags || []).join(", "),
      inboxCollection: item.collectionId || "",
    }))
      $(id).value = value;
    $("saveInboxButton").textContent = "Save changes";
    $("cancelInboxEdit").hidden = false;
    $("inboxTitle").focus();
    void persistDraft();
  }
  function editWorkspace(item) {
    editingWorkspace = item;
    $("workspaceTitle").value = item.title;
    $("workspaceNote").value = item.note;
    $("workspaceCollection").value = item.collectionId || "";
    setTool("workspaces");
    updateContext();
    void persistDraft();
  }
  function updateContext() {
    const passage = ctx.passage(),
      chat = ctx.chat();
    $("workspaceContext").textContent = editingWorkspace
      ? `Editing “${editingWorkspace.title}”. Its saved passage, conversation, and words are kept.`
      : [
          passage?.reference,
          chat?.threadId ? "Current Feasy conversation" : "",
          $("wordTerm").value ? `Word: ${$("wordTerm").value}` : "",
        ]
          .filter(Boolean)
          .join(" · ") ||
        "Look up a passage, ask Feasy, or explore a word, then save your study here.";
  }
  async function resume(item) {
    if (item.reference) await ctx.lookup(item.reference);
    if (item.wordTerms?.[0]) $("wordTerm").value = item.wordTerms[0];
    if (item.threadId) {
      const data = await command("thread", { id: item.threadId }),
        answer = [...data.messages]
          .reverse()
          .find((m) => m.role === "assistant");
      ctx.restoreChat({
        status: "success",
        threadId: item.threadId,
        text: answer?.content || "",
        passages: answer?.passages || [],
        verification: answer?.verification || null,
      });
    } else ctx.restoreChat(null);
    editWorkspace(item);
    message(
      "workspaceStatus",
      "Study reopened. Scripture and Feasy are ready in their tabs.",
    );
  }
  function captureDetails() {
    $("captureDetails").textContent = [captured?.locator ? "Exact quotation saved with its surrounding context." : "", captured?.mediaSeconds != null ? `YouTube moment: ${videoTimestamp(captured.mediaSeconds)}. Open the saved source to resume here.` : ""].filter(Boolean).join(" ");
  }
  function startInboxContext(value = null) {
    captureGeneration++; editing = null; captured = value; captureDetails();
    for (const id of [
      "inboxNote",
      "inboxReference",
      "inboxTags",
      "inboxCollection",
    ])
      $(id).value = "";
    $("saveInboxButton").textContent = "Save privately";
    $("cancelInboxEdit").hidden = true;
  }
  const inboxValues = () => ({
    kind: "page",
    title: $("inboxTitle").value,
    url: $("inboxUrl").value,
    quote: $("inboxQuote").value,
    note: $("inboxNote").value,
    reference: $("inboxReference").value,
    tags: $("inboxTags")
      .value.split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    collectionId: $("inboxCollection").value || null,
    locator: captured?.locator?.exact === $("inboxQuote").value.trim() && sourcePageUrl(captured.url || "") === sourcePageUrl($("inboxUrl").value) ? captured.locator : null,
    mediaSeconds: captured?.mediaSeconds != null && sourcePageUrl(captured.url || "") === sourcePageUrl($("inboxUrl").value) ? captured.mediaSeconds : null,
  });
  $("useCurrentPageButton").addEventListener(
    "click",
    tryAction("inboxStatus", async () => {
      const page = await ctx.capturePage();
      startInboxContext();
      $("inboxTitle").value = page.title;
      $("inboxUrl").value = page.url;
      $("inboxQuote").value = "";
      await ctx.clearInboxDraft();
      await persistDraft();
    }),
  );
  $("inboxForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = $("saveInboxButton");
    if (b.disabled) return;
    const submitted = inboxValues(),
      item = { ...(editing || {}), ...submitted },
      savingEpoch = epoch;
    const fields = $("inboxForm").querySelectorAll("input, textarea, select");
    b.disabled = true;
    fields.forEach((field) => {
      field.disabled = true;
    });
    try {
      await persistDraft();
      await command(item.id ? "inbox-edit" : "inbox-save", { item });
      if (epoch !== savingEpoch) return;
      if (JSON.stringify(inboxValues()) === JSON.stringify(submitted)) {
        startInboxContext();
        for (const id of ["inboxTitle", "inboxUrl", "inboxQuote"])
          $(id).value = "";
        await ctx.clearInboxDraft();
        await persistDraft();
      }
      await loadLibrary(false, true);
      if (epoch === savingEpoch)
        message("inboxStatus", "Saved privately to your Feason account.");
    } catch (error) {
      if (epoch === savingEpoch) message("inboxStatus", error);
    } finally {
      b.disabled = false;
      fields.forEach((field) => {
        field.disabled = false;
      });
    }
  });
  $("cancelInboxEdit").addEventListener("click", () => {
    editing = null;
    for (const id of [
      "inboxTitle",
      "inboxUrl",
      "inboxQuote",
      "inboxNote",
      "inboxReference",
      "inboxTags",
    ])
      $(id).value = "";
    $("inboxCollection").value = "";
    $("saveInboxButton").textContent = "Save privately";
    $("cancelInboxEdit").hidden = true;
    void persistDraft();
  });
  $("collectionForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = $("collectionForm").querySelector("button");
    if (b.disabled) return;
    b.disabled = true;
    try {
      const old = collections.find(
        (i) => i.id === $("collectionForm").dataset.editing,
      );
      await command(old ? "inbox-edit" : "inbox-save", {
        item: { ...old, kind: "collection", title: $("collectionTitle").value },
      });
      $("collectionTitle").value = "";
      delete $("collectionForm").dataset.editing;
      await loadLibrary(false, true);
    } catch (error) {
      message("inboxStatus", error);
    } finally {
      b.disabled = false;
    }
  });
  $("libraryFilter").addEventListener("change", () => { cursor = null; void loadLibrary(false, true); });
  $("librarySearch").addEventListener("input", () => { clearTimeout(searchTimer); cursor = null; searchTimer = setTimeout(() => void loadLibrary(false, true), 300); });
  $("librarySearchForm").addEventListener("submit", e => { e.preventDefault(); clearTimeout(searchTimer); cursor = null; void loadLibrary(false, true); });
  $("preparePack").addEventListener("click", () => { if (packIds.size) openPath(`/reading-inbox/pack?items=${[...packIds].join(',')}`); });
  $("clearPack").addEventListener("click", () => { packIds.clear(); renderLibrary(); void persistDraft(); });
  $("refreshInboxButton").addEventListener("click", () => void loadLibrary());
  $("moreInboxButton").addEventListener("click", () => void loadLibrary(true));
  $("workspaceForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = $("workspaceForm").querySelector("button");
    if (b.disabled) return;
    b.disabled = true;
    try {
      await persistDraft();
      const p = ctx.passage(),
        chat = ctx.chat();
      const data = await command(
        editingWorkspace ? "inbox-edit" : "inbox-save",
        {
          item: {
            ...(editingWorkspace || {
              kind: "workspace",
              reference: p?.reference || "",
              threadId: chat?.threadId || null,
              url: p ? `${FEASON_ORIGIN}${p.href}` : "",
              wordTerms: $("wordTerm").value.trim()
                ? [$("wordTerm").value.trim()]
                : [],
            }),
            title: $("workspaceTitle").value,
            note: $("workspaceNote").value,
            collectionId: $("workspaceCollection").value || null,
          },
        },
      );
      editingWorkspace = data.item;
      await persistDraft();
      await loadLibrary(false, true);
      updateContext();
      message(
        "workspaceStatus",
        "Study saved. Resume it here, on the site, or on iPhone.",
      );
    } catch (error) {
      message("workspaceStatus", error);
    } finally {
      b.disabled = false;
    }
  });
  $("workspaceForm").append(
    button("Start a new workspace", () => {
      editingWorkspace = null;
      $("workspaceTitle").value = "";
      $("workspaceNote").value = "";
      $("workspaceCollection").value = "";
      updateContext();
      void persistDraft();
    }),
  );
  for (const id of [
    "inboxNote",
    "inboxReference",
    "inboxTags",
    "inboxCollection",
    "workspaceTitle",
    "workspaceNote",
    "workspaceCollection",
  ])
    $(id).addEventListener("input", () => void persistDraft());

  async function loadToday() {
    message("todayStatus", "Gathering today…");
    try {
      const data = await command("today");
      $("todayCards").replaceChildren();
      const card = (title, text, action) => {
        const c = node("article", "", "study-result");
        c.append(node("h2", title), node("p", text));
        if (action) c.append(action);
        $("todayCards").append(c);
        return c;
      };
      if (data.verse?.text) {
        const c = card(
          data.verse.ref,
          data.verse.text,
          button("Read this passage", () => ctx.lookup(data.verse.ref)),
        );
        c.querySelector("p").className = "verse-daily";
      } else
        card("Daily verse", data.verse?.error || "Temporarily unavailable.");
      if (data.resume?.bookSlug)
        card(
          "Continue reading",
          `${data.resume.bookName} ${data.resume.chapter}`,
          button("Resume chapter", () =>
            ctx.lookup(`${data.resume.bookName} ${data.resume.chapter}`),
          ),
        );
      else
        card(
          "Open Scripture",
          data.resume?.error ||
            "Begin with a passage and make a little room to read.",
          button("Read Scripture", () => setTool("study")),
        );
      card(
        "Your recall practice",
        data.reviews?.error ||
          `${data.reviews?.dueCount || 0} reviews due · ${data.reviews?.totalCount || 0} verses kept`,
        button("Practice now", () => setTool("practice")),
      );
      const plans = data.plans?.plans || [],
        active = (data.progress?.enrollments || []).filter(
          (e) => !e.completed_at,
        );
      if (data.progress?.error)
        card(
          "Reading plans",
          data.progress.error,
          button("Open your plans", () => openPath("/reading-plans")),
        );
      else if (!active.length)
        card(
          "A path through Scripture",
          "Choose a reading plan to begin a guided journey.",
          button("Explore reading plans", () => openPath("/reading-plans")),
        );
      for (const enrollment of active.slice(0, 3)) {
        const plan = plans.find((p) => p.slug === enrollment.plan_key),
          complete = new Set(
            (data.progress.completions || [])
              .filter((c) => c.plan_slug === enrollment.plan_key)
              .map((c) => c.day_number),
          );
        const next = plan
          ? Array.from({ length: plan.dayCount }, (_, i) => i + 1).find(
              (d) => !complete.has(d),
            )
          : null;
        card(
          plan?.title || "Your personal reading plan",
          next ? `Continue with day ${next}` : "Continue your reading journey.",
          button("Open plan", () =>
            openPath(
              plan
                ? `/reading-plans/${encodeURIComponent(plan.slug)}`
                : "/reading-plans",
            ),
          ),
        );
      }
      message("todayStatus", "");
    } catch (error) {
      message("todayStatus", error);
    }
  }
  $("refreshToday").addEventListener("click", () => void loadToday());
  $("companionSignOut").addEventListener("click", () =>
    $("accountButton").click(),
  );
  const onboarding = [
    [
      "Begin with a passage.",
      "Look up John 15:1–5 in Scripture. Add it to your memorization queue or download the chapter to read offline.",
      "Open Scripture",
      () => ctx.lookup("John 15:1-5"),
    ],
    [
      "Keep what matters.",
      "Save a page to your private library. Add notes, a Scripture reference, and a collection. Your library also opens on the site and iPhone.",
      "Open your library",
      () => setTool("inbox"),
    ],
    [
      "Gather a study.",
      "Ask Feasy, check its cited passages, then save a workspace. Export a study sheet when you are ready to share it.",
      "Gather your study",
      () => setTool("workspaces"),
    ],
  ];
  function showStep() {
    const value = onboarding[step % onboarding.length];
    $("onboardingStep").textContent =
      `${step + 1} / 3 · ${value[0]} ${value[1]}`;
    $("onboardingAction").textContent = value[2];
    $("onboardingNext").textContent = step === 2 ? "Finish setup" : "Next →";
  }
  $("onboardingAction").addEventListener("click", () =>
    onboarding[step % 3][3](),
  );
  $("onboardingNext").addEventListener("click", () => {
    if (step === 2) {
      $("onboarding").open = false;
      void chrome.storage.local.set({ feasonOnboardingDone: true });
    } else {
      step++;
      showStep();
    }
  });
  showStep();
  void chrome.storage.local.get("feasonOnboardingDone").then((v) => {
    $("onboarding").open = !v.feasonOnboardingDone;
  });

  function renderReview() {
    const card = reviews[0];
    $("practiceCard").hidden = !card;
    $("practiceText").hidden = true;
    $("practiceGrades").hidden = true;
    $("recallAttempt").value = "";
    message("recallFeedback", "");
    if (card) {
      $("practiceRef").textContent =
        `${card.ref_label} · ${card.translation || "Source text"}`;
      $("practiceText").textContent = card.text;
      message(
        "practiceStatus",
        `${reviews.length} reviews due in this session.`,
      );
    } else
      message(
        "practiceStatus",
        "Your reviews are complete for now. Add a passage from Scripture to keep practicing.",
      );
  }
  async function loadReviews() {
    try {
      reviews = await command("practice-list");
      renderReview();
    } catch (error) {
      message("practiceStatus", error);
    }
  }
  $("refreshPractice").addEventListener("click", () => void loadReviews());
  $("openMemorize").addEventListener("click", () => openPath("/memorize"));
  $("revealPractice").addEventListener("click", () => {
    if (!reviews[0]) return;
    const result = checkRecall($("recallAttempt").value, reviews[0].text);
    $("practiceText").hidden = false;
    $("practiceGrades").hidden = false;
    message(
      "recallFeedback",
      !$("recallAttempt").value.trim()
        ? "Read the text, then choose how it went."
        : result.exact
          ? "The words match. Choose how confidently you recalled them."
          : `You entered ${result.entered} words; the passage has ${result.total}. Compare it below, then choose how it went.`,
    );
  });
  for (const b of $("practiceGrades").querySelectorAll("button"))
    b.addEventListener("click", async () => {
      if (reviewBusy || !reviews[0]) return;
      reviewBusy = true;
      for (const grade of $("practiceGrades").querySelectorAll("button"))
        grade.disabled = true;
      try {
        await command("practice-grade", {
          id: reviews[0].id,
          grade: b.dataset.grade,
        });
        reviews.shift();
        renderReview();
      } catch (error) {
        reviews = [];
        $("practiceCard").hidden = true;
        message(
          "practiceStatus",
          `${error.message} Refresh your queue before reviewing again.`,
        );
      } finally {
        reviewBusy = false;
        for (const grade of $("practiceGrades").querySelectorAll("button"))
          grade.disabled = false;
      }
    });
  $("memorizePassage").addEventListener(
    "click",
    tryAction("verseStatus", async () => {
      const p = ctx.passage();
      if (!p) throw new Error("Look up a passage first.");
      const slug = p.href.split("/")[2];
      await command("practice-add", {
        card: {
          ref_book_slug: slug,
          ref_chapter: p.anchor.chapter,
          ref_verse_start: p.verses[0].verse,
          ref_verse_end: p.verses.at(-1).verse,
          text: p.verses.map((v) => v.text).join(" "),
          translation: "WEB",
        },
      });
      message(
        "verseStatus",
        "Added to your memorization queue. Open Practice to begin.",
      );
    }),
  );

  async function downloads() {
    try {
      const list = await command("downloads");
      $("downloadedChapters").replaceChildren();
      for (const item of list) {
        const row = node("div");
        row.append(
          node(
            "strong",
            `${item.reference} · ${(item.bytes / 1024 / 1024).toFixed(1)} MB${item.audio ? " · audio" : ""}`,
          ),
        );
        row.append(
          button("Read", () => ctx.lookup(item.reference)),
          button(
            "Remove download",
            tryAction("downloadStatus", async () => {
              await command("download-remove", { key: item.key });
              await downloads();
            }),
          ),
        );
        $("downloadedChapters").append(row);
      }
    } catch (error) {
      message("downloadStatus", error);
    }
  }
  $("downloadChapter").addEventListener("click", async () => {
    const b = $("downloadChapter");
    if (b.disabled) return;
    b.disabled = true;
    message("downloadStatus", "Downloading the complete chapter…");
    try {
      const p = ctx.passage();
      if (!p) throw new Error("Look up a passage first.");
      await command("download", {
        reference: p.reference,
        audio: $("downloadAudio").checked,
      });
      message("downloadStatus", "Chapter downloaded. It is available offline.");
      await downloads();
    } catch (error) {
      message("downloadStatus", error);
    } finally {
      b.disabled = false;
    }
  });
  $("refreshDownloads").addEventListener("click", () => void downloads());
  async function listen() {
    const p = ctx.passage();
    if (!p) throw new Error("Look up a passage first.");
    const key = `${p.anchor.book}-${p.anchor.chapter}`,
      path = `${FEASON_ORIGIN}/api/extension/audio?book=${p.anchor.book}&chapter=${p.anchor.chapter}`;
    const currentEpoch = epoch;
    const cached =
      typeof caches !== "undefined"
        ? await (await caches.open(CACHE_NAME)).match(path)
        : null;
    const blob = cached ? await cached.blob() : null;
    if (currentEpoch !== epoch) return;
    $("chapterAudio").pause();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = blob ? URL.createObjectURL(blob) : "";
    playbackKey = key;
    $("audioTitle").textContent =
      `${p.reference.split(":")[0]} · RECORDED WEB AUDIO`;
    $("chapterAudio").src = audioUrl || path;
    $("audioPlayer").hidden = false;
    const state = (await chrome.storage.local.get("feasonPlayback"))
      .feasonPlayback?.[key];
    if (currentEpoch !== epoch) return;
    $("audioSpeed").value = String(state?.speed || 1);
    $("chapterAudio").playbackRate = Number($("audioSpeed").value);
    $("chapterAudio").addEventListener(
      "loadedmetadata",
      () => {
        if (
          playbackKey === key &&
          state?.position &&
          state.position < $("chapterAudio").duration - 2
        )
          $("chapterAudio").currentTime = state.position;
      },
      { once: true },
    );
    message(
      "audioStatus",
      cached
        ? "Playing your offline recording."
        : "Streaming the recorded chapter. Download it for offline listening.",
    );
    try {
      await $("chapterAudio").play();
    } catch {
      message(
        "audioStatus",
        "Press Play to listen. If offline, download this chapter’s audio while connected.",
      );
    }
  }
  $("listenPassage").addEventListener(
    "click",
    tryAction("verseStatus", listen),
  );
  $("chapterAudio").addEventListener("error", () =>
    message(
      "audioStatus",
      "The recording could not load. Check your connection or download it again.",
    ),
  );
  async function savePosition() {
    if (!playbackKey) return;
    const currentEpoch = epoch,
      snapshot = {
        position: $("chapterAudio").currentTime || 0,
        speed: $("chapterAudio").playbackRate,
      };
    const stored =
      (await chrome.storage.local.get("feasonPlayback")).feasonPlayback || {};
    if (currentEpoch !== epoch) return;
    await chrome.storage.local.set({
      feasonPlayback: { ...stored, [playbackKey]: snapshot },
    });
  }
  $("audioSpeed").addEventListener("change", () => {
    $("chapterAudio").playbackRate = Number($("audioSpeed").value);
    void savePosition();
  });
  $("chapterAudio").addEventListener("pause", () => void savePosition());
  $("chapterAudio").addEventListener("timeupdate", () => {
    if (Date.now() - lastPositionWrite > 5000) {
      lastPositionWrite = Date.now();
      void savePosition();
    }
  });

  function exportText() {
    return studyMarkdown(
      $("exportScope").value === "library"
        ? items
        : $("exportNotes").checked && $("workspaceNote").value
          ? [
              {
                kind: "workspace",
                title: $("workspaceTitle").value || "Current study notes",
                note: $("workspaceNote").value,
              },
            ]
          : [],
      $("exportNotes").checked,
      $("exportDiscussion").checked,
      $("exportScope").value === "current" ? ctx.passage() : null,
      $("exportScope").value === "current" ? ctx.chat() : null,
      ctx.books(),
    );
  }
  $("exportMarkdown").addEventListener("click", () => {
    const url = URL.createObjectURL(
        new Blob([exportText()], { type: "text/markdown;charset=utf-8" }),
      ),
      a = node("a");
    a.href = url;
    a.download = "Feason-study.md";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message(
      "exportStatus",
      "Markdown prepared from the items currently loaded.",
    );
  });
  $("exportPrint").addEventListener("click", async () => {
    await chrome.storage.session.set({ studyExport: exportText() });
    void chrome.tabs.create({ url: chrome.runtime.getURL("print.html") });
  });
  async function usePageCapture(video) {
    const captureEpoch = epoch, page = await command("page", {action:"capture"});
    if (captureEpoch !== epoch) return;
    if (video && page.mediaSeconds == null) throw new Error("Open a YouTube video, begin playback, then keep this moment.");
    if (!video && !page.locator) throw new Error("Select the text on the page first, then choose Keep selected text.");
    startInboxContext({ ...page, mediaSeconds: video ? page.mediaSeconds : null });
    $("inboxTitle").value = page.title; $("inboxUrl").value = page.url; $("inboxQuote").value = page.locator?.exact || "";
    setTool("inbox"); await ctx.clearInboxDraft(); await persistDraft();
    message("inboxStatus", "Add a note or collection, then choose Save privately.");
  }
  for (const [id, video] of [["captureHighlight", false], ["captureVideo", true]]) $(id).addEventListener("click", tryAction("pageStatus", () => usePageCapture(video)));
  $("scanPage").addEventListener("click", tryAction("pageStatus", async () => {
    const scanEpoch = epoch, b = $("scanPage"); if (b.disabled) return; b.disabled = true;
    message("pageStatus", "Looking for Bible references in this page…");
    try {
      const data = await command("page", {action:"scan"}); if (epoch !== scanEpoch) return;
      $("pageReferences").replaceChildren();
      for (const entry of data.references) {
        const card = node("article", "", "study-result");
        card.append(node("h2", entry.reference), node("p", entry.context, "field-note"), button("Read passage", tryAction("pageStatus", () => ctx.lookup(entry.reference)), "secondary-button"));
        $("pageReferences").append(card);
      }
      message("pageStatus", data.references.length ? `${data.references.length} reference${data.references.length === 1 ? '' : 's'} found in ${data.title || 'this page'}. Choose a passage to read.` : "No references found in the readable text. You can still look up a reference in Scripture.");
    } finally { b.disabled = false; }
  }));
  $("restoreHighlights").addEventListener("click", tryAction("pageStatus", async () => {
    const restoreEpoch = epoch, data = await command("page", {action:"restore"}); if (epoch !== restoreEpoch) return;
    message("pageStatus", `${data.matched} of ${data.total} saved highlights found on this page. Unmatched or repeated quotations stay in your library; changed pages may need a source link.${data.limited ? " Showing the first 200 saved highlights from this page." : ""}`);
  }));
  $("clearHighlights").addEventListener("click", tryAction("pageStatus", async () => { await command("page", {action:"clear"}); message("pageStatus", "Page highlights cleared. Your saved library items are kept."); }));
  const readingEpoch = epoch, readingCapture = captureGeneration;
  void chrome.storage.session.get("libraryDraft").then((data) => {
    if (readingEpoch !== epoch || readingCapture !== captureGeneration) return;
    const d = data.libraryDraft;
    if (!d) return;
    captured = d.captured || null; captureDetails();
    packIds = new Set((d.packIds || []).filter(id => /^[a-f0-9-]{36}$/i.test(id)).slice(0, 10));
    editing = d.editing;
    editingWorkspace = d.editingWorkspace;
    for (const [id, value] of Object.entries({
      inboxNote: d.note,
      inboxReference: d.reference,
      inboxTags: d.tags,
      workspaceTitle: d.workspaceTitle,
      workspaceNote: d.workspaceNote,
    }))
      $(id).value = value || "";
    if (editing) {
      $("saveInboxButton").textContent = "Save changes";
      $("cancelInboxEdit").hidden = false;
    }
  });
  return {
    startInboxContext,
    searchLibrary(query) { $("librarySearch").value = String(query).slice(0, 200); cursor = null; },
    flush() {
      return draftWrites;
    },
    open(tool) {
      if (tool === "today") void loadToday();
      if (tool === "practice") void loadReviews();
      if (tool === "inbox" || tool === "workspaces") {
        void loadLibrary();
        updateContext();
      }
      if (tool === "study") void downloads();
    },
    reset(preserveDraft = false) {
      epoch++;
      clearTimeout(searchTimer); captureGeneration++;
      if (!preserveDraft) { packIds.clear(); captured = null; }
      $("librarySearch").value = ""; $("libraryFilter").value = "";
      $("pageReferences").replaceChildren(); $("pageStatus").textContent = ""; captureDetails();
      loading = false;
      reviews = [];
      items = [];
      collections = [];
      cursor = null;
      if (!preserveDraft) editing = editingWorkspace = null;
      playbackKey = "";
      $("chapterAudio").pause();
      $("chapterAudio").removeAttribute("src");
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      audioUrl = "";
      for (const id of [
        "todayCards",
        "savedWorkspaces",
        "collectionItems",
        "inboxItems",
      ])
        $(id).replaceChildren();
      if (!preserveDraft)
        for (const id of [
          "inboxNote",
          "inboxReference",
          "inboxTags",
          "workspaceTitle",
          "workspaceNote",
        ])
          $(id).value = "";
      $("practiceCard").hidden = true;
      $("audioPlayer").hidden = true;
      $("cancelInboxEdit").hidden = !editing;
      $("saveInboxButton").textContent = editing
        ? "Save changes"
        : "Save privately";
    },
  };
}
