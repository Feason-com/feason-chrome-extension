# Chrome Web Store listing (prepared copy; submission is separate)

## Name

Feason — Study & Share

## Summary

Keep Scripture, Feasy, biblical words, your private reading inbox, and the Gleam composer beside the page you’re reading.

## Detailed description

Make a little room for Scripture in your browser.

Open Feason’s persistent side panel to look up a Bible chapter or verse range,
copy a passage, or attach its first verse to a Gleam. Select text and choose
“Ask Feasy about this” to prepare a question. Nothing is sent to Feasy until you
press Ask. Answers include the passages actually cited and a grounding-check
status; read those passages in context, because Feasy can make mistakes.

Keep a page or quotation in your private Feason reading inbox, organized into collections with tags, annotations, and Scripture references.
Continue on Feason’s website or with the companion iOS update. Explore biblical lemmas, transliterations,
or Strong’s codes without automatically saving an entry or publishing a post.

Compose reflections, prayers, questions, praise, resources, or aphorisms in a
composer inspired by the iOS app. Add a verse anchor, attach an image to a
Resource, and preview before posting. The worker preserves receipts and drafts
across popup closure.

The extension does not scan pages or monitor browsing in the background.

## Single purpose

Bring Feason’s Scripture study and thoughtful sharing tools into an explicitly
invoked browser companion.

## URLs

- Homepage: https://www.feason.com/chrome-extension
- Privacy policy: https://www.feason.com/privacy
- Support: https://www.feason.com/contact

## Permission justifications

- `activeTab`: reads the active tab’s URL and title after the member invokes the
  extension, offering the page as an optional Gleam source or inbox item.
- `contextMenus`: lets the member explicitly select a page, link, quotation,
  reference, or word to prepare a Feason study or sharing action.
- `identity`: opens Feason’s authorization flow and validates its callback.
- `sidePanel`: keeps Feason’s study tools available beside the current page.
- `storage`: stores the account credential locally; drafts, selected text,
  image previews, and the current Feasy result remain in browser session storage.
- `https://www.feason.com/*`: authenticates and connects to Feason’s existing
  Scripture, word, conversation, private inbox, image-upload, and Gleam services.

No content scripts, browsing-history permission, remote runtime code, third-party
host permissions, or background page-content collection are used.

## Privacy disclosure

The active page URL and title are read when the member opens or invokes the
extension. Selected text is supplied by an explicit context-menu action and
stays in session storage until the member asks Feasy, saves privately, or posts.
Feasy receives a question and bounded selection excerpt under the account’s
existing allowance. Feasy conversations and private inbox items are saved to
the signed-in Feason account. Inbox items are private, not encrypted journal
entries. Images upload only when the member posts a Resource. Sign-out clears
local credentials and session drafts/context. Feason does not sell extension
data, use it for advertising, or collect browsing history in the background.

## Reviewer instructions

Use a reviewer account supplied privately in the store dashboard. Do not place
credentials in source code or public issues.

1. Open an ordinary HTTPS page and invoke Feason from the toolbar; sign in.
2. Choose Keep open to open the persistent side panel; switch between tabs.
3. In Scripture, look up John 15:1–5, copy it, and anchor its first verse to a Gleam.
4. Select a short quotation, right-click Ask Feasy, then explicitly press Ask.
   Inspect the answer, cited passages, and grounding status.
5. Save a page in Inbox; verify it at https://www.feason.com/reading-inbox and
   remove the item. Saving must not publish a Gleam.
6. Look up G3056 in Words; inspect source provenance and Scripture links.
7. In Gleam, choose Resource, add a small PNG, preview, then explicitly post.
   Follow the success link to verify the Gleam. Remove the reviewer post afterward.
8. Close/reopen the popup with a draft, and verify sign-out clears session data.

Command+Shift+G (macOS), Ctrl+Shift+G, and the context menu also open the extension.
The download page currently offers a developer installation; a Web Store listing
must be uploaded, reviewed, and verified separately.

## Version 1.3 review additions

- Today: daily verse, reading resume, review count, and active reading plans.
- Library: collections, private annotations, tags, Scripture links, and revision conflicts.
- Studies: save and reopen a passage, owned Feasy conversation, source, word studies, and notes.
- Practice: add a short passage, type recall, reveal, and grade. These reviews never publish achievements.
- Offline: explicitly download up to 10 WEB chapters and recordings, 150 MB total. Play at 0.75–2× and resume position. Remove text and audio together.
- Export: sourced Markdown or Print / Save PDF. Private notes are excluded unless selected.
- Onboarding: open Today, expand Getting started, and follow the three steps.

Only public Scripture and audio are cached persistently for offline use. Library data
requires the account and a connection. Playback position is local and clears on sign-out.
No additional permissions, hosts, remote code, telemetry, or page collection are added.

For review: create and rename a collection; save a page with annotations; edit it on
web and verify a stale extension edit is rejected. Save/reopen a workspace. Add a verse
to Practice and record a review, verifying no Gleam was created. Download a WEB chapter,
go offline, read and listen, then remove the download. Export with notes unchecked and
checked, inspecting the resulting sheet. Sign out and confirm the export view clears.
