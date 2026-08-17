# Chrome Web Store listing

## Name

Feason — Post a Gleam

## Summary

Share a reflection, prayer, question, praise, or resource to Feason from any tab.

## Detailed description

Share what you are reading without leaving the page.

Feason — Post a Gleam lets signed-in Feason members post a reflection, prayer,
question, praise, aphorism, or resource from the Chrome toolbar, a keyboard
shortcut, or the page context menu.

When you explicitly open or invoke the extension, it can attach the current
page, a link, or selected text to your Gleam. The page URL stays separate from
the Gleam text so you remain in control of what you post.

The extension does not monitor your browsing in the background.

## Single purpose

Let signed-in Feason members compose and post a Gleam from the current Chrome
tab.

## URLs

- Homepage: https://www.feason.com
- Privacy policy: https://www.feason.com/privacy
- Support: https://www.feason.com/contact

## Permission justifications

- `activeTab`: reads the current page URL and title only after the user opens or
  explicitly invokes the extension, so the page can be offered as an optional
  source for the Gleam.
- `contextMenus`: provides explicit Post to Feason actions for a page, link, or
  text selection.
- `identity`: opens the Feason authorization flow and receives its callback
  through Chrome Identity.
- `storage`: stores the Feason authentication token and short-lived composer
  state locally in Chrome.
- `https://www.feason.com/*`: connects only to Feason to authenticate the member
  and submit the Gleam they chose to post.

## Privacy disclosure

The extension accesses the current page URL and title only when the user opens
or invokes the extension. It accesses selected text only when the user chooses
a Feason context-menu action. It sends only content the user chooses to post to
https://www.feason.com. An authentication token is stored locally in Chrome
storage to keep the user signed in. Feason does not sell extension data, use it
for advertising, or collect browsing history in the background.

## Reviewer instructions

1. Open any ordinary HTTPS webpage.
2. Select the Feason extension from the Chrome toolbar.
3. Choose Sign in to Feason.
4. Sign in with the reviewer account supplied privately in the dashboard.
5. Enter a short Gleam and choose a category.
6. Confirm the page source is displayed separately from the text field.
7. Select Post Gleam.
8. Follow the success link to view the published Gleam on Feason.

The extension can also be invoked with Command+Shift+G on macOS,
Ctrl+Shift+G on other platforms, or from the page context menu.
