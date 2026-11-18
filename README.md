# Boardwise

A private, offline-first infinite whiteboard that runs entirely in your browser.
No account, no server, no analytics, no third-party fonts. Your boards live in your browser's own storage (IndexedDB) and never leave your device unless you export them, sync them to a folder you chose, or connect to a collaborator yourself.

React 18 + Vite, plain JavaScript, canvas rendering. Installable as a PWA and fully usable offline.

## Features

**Canvas** – infinite pan and zoom (10–400 %), fit to content, reset, minimap, backgrounds (plain, dots, grid, lines), light/dark/system theme, snap to grid, autosave with a "Saved" indicator, crash recovery from a rolling backup copy, and drawing that stays smooth with 2,000+ objects (culling, path caching and a low-detail mode when zoomed far out).

**Tools** – select (move, resize, rotate, group, lock, z-order, align, distribute, duplicate, copy/paste even across boards), pen / highlighter / eraser with pressure and smoothing, optional on-device "ink to shape", eight shapes, connectors that stay attached when shapes move, text, sticky notes (7 colours) with a sortable notes grid, images, frames, tables, checklists, stamps and a laser pointer.

**Productivity** – unlimited undo/redo that survives reloads, 9 templates, search, present mode (frame by frame), comments, board list with thumbnails, folders and favourites, timer, dot voting.

**Data** – export PNG, SVG, PDF (one page per frame), JSON and Markdown; import JSON, images, SVG, text and CSV; full backup and restore. Everything imported is validated and cleaned (SVG and HTML are sanitised, oversize or malformed files are rejected with a clear message).

**Optional extras** (off until you use them, clearly labelled in the app)
- *Sync with a folder* (Home → settings menu): two-way sync of boards as `<id>.boardwise.json` files using the File System Access API (Chrome, Edge and other Chromium browsers). If a board changed in both places, the newer edit is kept and the older one is saved as a version you can restore as a copy.
- *Live collaboration* (board → File menu): peer-to-peer over WebRTC with Yjs. You exchange two copy-paste codes by any channel you like; there is no signalling server.

**Accessibility and languages** – fully keyboard operable, command palette (Ctrl/Cmd+K), shortcuts dialog (`?`), screen-reader announcements, WCAG AA contrast, reduced-motion support, touch and responsive layouts. Languages: English, Español, Français, Deutsch, Português, हिन्दी, العربية (RTL) and עברית (RTL). The core interface is translated in every language; less common strings (for example some template sample text, long help texts and the collaboration and sync dialogs) fall back to English.

## Keyboard shortcuts

`Ctrl` is `⌘` on macOS.

| Tools | | Editing | |
|---|---|---|---|
| V select | H hand | Ctrl+Z / Ctrl+Shift+Z undo / redo | Ctrl+A select all |
| P pen | L highlighter | Ctrl+C / X / V copy / cut / paste | Ctrl+D duplicate |
| E eraser | N sticky note | Delete remove | Enter edit text |
| T text | R rectangle | Ctrl+G / Ctrl+Shift+G group / ungroup | Ctrl+Shift+L lock |
| O ellipse | D diamond | Ctrl+] / Ctrl+[ bring to front / send to back | Arrows nudge (Shift = 10) |
| A arrow | C connector | Tab next object | Esc deselect / cancel |
| F frame | B table | **View** | |
| K checklist | S stamp | Space+drag pan | + / − zoom |
| Z laser | M comment | 0 zoom 100 % | Shift+1 fit, Shift+2 fit selection |
| I image | | **App** | Ctrl+K palette, Ctrl+F search, ? shortcuts |

## Privacy

- All board data stays in your browser (IndexedDB). Preferences (theme, language, last tool colours) use `localStorage`. If your browser blocks storage, the app says so and keeps boards in memory only; export a backup to keep your work.
- The built app makes **no network requests** other than loading its own files. A strict Content-Security-Policy (`connect-src 'self'`, no external scripts, fonts or images) is added at build time.
- There is no telemetry, analytics or third-party font. Everything works offline once loaded.
- Pasted HTML is reduced to plain text; imported SVG is rebuilt from an allow-list of elements and attributes; imported JSON is rebuilt object by object with limits.
- Live collaboration is the only feature that connects to another device. By default it uses **no** STUN or TURN server, so both people must be able to reach each other directly (same network or machine). You may type a STUN server address yourself; that is the only way a third party would ever be contacted. Anyone you give a code to can join, and joining merges their board into yours, so only share codes with people you trust.
- Folder sync only touches the folder you pick. Boardwise never uploads it anywhere; whatever else syncs that folder (for example your own cloud drive) is your choice.

## Run it

```bash
npm install
npm run dev          # development server
npm run build        # production build in dist/
npm run preview      # serve dist/ on http://localhost:4173
```

## Tests

```bash
npm test             # unit tests (Vitest): geometry, hit-testing, history, import/export, sanitising, storage, ops, search, i18n, Yjs binding, folder sync …
npm run build        # the browser tests run against dist/, so build first
npm run test:e2e     # end-to-end tests in a real browser (Puppeteer)
npm run test:a11y    # axe-core accessibility checks on the main screens and dialogs
npm run test:perf    # 2,000-object performance checks
npm run audit:prod   # npm audit for production dependencies
```

The browser tests use Chrome or Chromium. Set `CHROME_PATH` if it is not at `/usr/bin/google-chrome`. Add `?e2e` to the URL (or set `localStorage['boardwise.debug']='1'`) to expose the test hook `window.__bw`; it is off otherwise.

## Deploy to GitHub Pages

1. **Create a repository** on GitHub (for example `boardwise`) and push this project to the `main` branch.
2. **Enable Pages**: in the repository go to *Settings → Pages* and set *Source* to **GitHub Actions**.
3. **Keep the workflow**: `.github/workflows/deploy.yml` is already in the project. On every push to `main` it installs, runs the unit tests and the production audit, builds with `VITE_BASE=/<repository-name>/`, and publishes `dist/`.
4. **Open the site** at `https://<your-user>.github.io/<repository-name>/` once the *Deploy to GitHub Pages* run finishes (*Actions* tab).

Notes:
- The app uses hash routes (`#/b/<id>`), so no server rewrite rules are needed and deep links survive a refresh.
- For a user/organisation site (`<user>.github.io`) or a custom domain served from the root, build with `VITE_BASE=/` instead (edit the `env:` line in the workflow).
- To build by hand for a sub-path: `VITE_BASE=/boardwise/ npm run build`, then publish `dist/`.
- The service worker precaches the app, so after the first visit it works offline. New deployments update automatically on the next visit.

## Known limits

- **Ink to text** (handwriting recognition) is not built. It needs a recognition model, which would conflict with "no network and nothing to download"; "ink to shape" is available instead and runs on your device.
- Folder sync needs the File System Access API (Chromium browsers). It syncs when you press *Sync now*; it does not watch the folder in the background, and the browser asks you to re-allow access after a restart.
- Live collaboration is peer to peer with manual codes: collaborators see each other's pointers and names, but there are no rooms or chat. Everyone who is connected needs to stay online; after a disconnect you reconnect with a new code exchange; boards are merged by object, so something deleted on one side while apart can reappear.
- Translations cover the core interface; see the note above for what falls back to English.
- Very large images are downscaled on import to keep boards fast and within storage limits.
