# Feason Chrome extension

Source for **Feason — Post a Gleam**, a dependency-free Manifest V3 extension for sharing a reflection, prayer, question, praise, or resource to Feason from any tab.

## Privacy boundary

This repository contains only the browser client. It does not contain Feason's server implementation, production credentials, user data, database schema, moderation system, or operational configuration.

The key in `extension/manifest.json` is Chrome's public extension identity key. It fixes the development extension ID and cannot sign packages, authenticate to Feason, or access private data. Runtime authentication tokens are issued by `https://www.feason.com`, stored in Chrome extension-local storage, and removed on sign-out or an unauthorized response.

## Develop

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select the `extension/` directory.

Run the synthetic unit tests with:

```sh
npm install
npm test
```

See `extension/README.md` for packaging and Chrome Web Store notes.

## Security

Do not place Feason credentials, reviewer accounts, production responses, or user content in issues or fixtures. See `SECURITY.md` for private reporting.

## Trademark

The source code is MIT licensed. The Feason name and logos identify the official Feason service and are not licensed for confusing or misleading use. See `TRADEMARKS.md`.
