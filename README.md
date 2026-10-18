# Feason Chrome extension

Source for **Feason — Study & Share**, a dependency-free Manifest V3 companion for Scripture lookup, Feasy with citations, a private reading inbox, biblical word study, and thoughtful Gleams beside any page.

## Privacy boundary

This repository contains only the browser client. It does not contain Feason's server implementation, production credentials, user data, database schema, moderation system, or operational configuration.

The key in `extension/manifest.json` is Chrome's public extension identity key. It fixes the development extension ID and cannot sign packages, authenticate to Feason, or access private data. Runtime authentication tokens are issued by `https://www.feason.com`, stored in Chrome extension-local storage, and removed on sign-out or an unauthorized response.

## Develop

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select the `extension/` directory.

Use Node 24 or later. Run the synthetic unit, popup/worker lifecycle, and release-package tests with:

```sh
npm ci
npm test
```

Package the self-contained extension with:

```sh
npm run extension:package -- /tmp/feason-extension-1.4.0.zip
```

Version 1.4 matches the iOS Gleam composer and keeps sign-in, posting, and drafts intact across popup closure. Fonts and their licenses are bundled locally. See `extension/README.md` for installation, packaging, and Chrome Web Store notes.

## Security

Do not place Feason credentials, reviewer accounts, production responses, or user content in issues or fixtures. See `SECURITY.md` for private reporting.

## Trademark

The source code is MIT licensed. The Feason name and logos identify the official Feason service and are not licensed for confusing or misleading use. See `TRADEMARKS.md`.

Version 1.4 adds explicit page-reference scanning, exact-source highlights, full-library search, address-bar lookup, timestamped YouTube notes, and reviewed Flock study packs. Page scanning is local and runs only after an explicit action; the only new permission is `scripting`, with no new host access.
