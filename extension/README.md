# Feason — Post a Gleam

A Manifest V3 Chrome extension that posts to Feason's existing Gleam API from
the toolbar, the `Command/Ctrl + Shift + G` shortcut, or a page/link/selection
context menu.

## Local installation

1. Open `chrome://extensions`, enable **Developer mode**, and choose
   **Load unpacked**.
2. Select this `extension` directory.
3. Pin **Feason — Post a Gleam** and sign in from its popup.

The manifest's public key gives unpacked builds the stable extension ID
`pmdfpoeningpholpemfjffidcibhchao`, which is the development ID accepted by
the auth route. No private key or Feason credential is bundled.

## Chrome Web Store release

Chrome Web Store assigns the production extension ID. After the first package
upload:

1. Create an ID-reservation package at version `0.0.1` without the development
   key:

   ```sh
   cd extension && zip -r /tmp/feason-extension-0.0.1.zip .
   ```

2. Upload it as a draft, then copy the public key shown in the listing's
   **Package** tab into `manifest.json`.
3. Set `FEASON_CHROME_EXTENSION_ID` in the Feason deployment to the listing ID.
4. Build the final package, verify its unpacked ID matches the listing, then
   upload it:

   ```sh
   cd extension && zip -r /tmp/feason-extension-1.0.0.zip .
   ```

Store copy, permission justifications, privacy disclosure, and reviewer steps
live in `STORE_LISTING.md`.

The server accepts exactly one configured `chromiumapp.org` callback. Do not
replace it with a caller-provided redirect URL.

## Verification

From this repository's root:

```sh
npm install
npm test
```

The extension is static and has no separate dependency install or compile step.
