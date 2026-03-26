# JumpKey for YouTube

<p align="center">
  <img src="https://edenware.app/jumpkey/files/icon128.png" alt="JumpKey for YouTube icon" />
</p>

Chrome/Edge/Opera extension to quickly jump between YouTube videos (including Shorts and regular watch pages) using a single, configurable shortcut and multiple selectable sources.

## What it does

- Quickly jumps between YouTube videos (Shorts and regular videos) using configurable keyboard shortcuts.
- Supports multiple sources (open Shorts tabs, open watch/playback tabs, Liked videos, Watch Later). Sources are configurable in `Options` and can be enabled/disabled.
- Allows like/dislike via shortcuts.
- Extracts tags from watched videos to build a local history for filtering and automatic skipping.

## Default shortcuts

-- `Y` -> Pick Random (main shortcut that selects a candidate from enabled sources)
- `+` -> Like only
- `-` -> Dislike only

All shortcuts are editable in `Options`.

### `Y` — YouTube shortcut for Pick Random

The `Y` shortcut (Y for YouTube) selects a candidate according to the configured source priority in `Options`. Typical sources include:

- Open Shorts tabs
- Open watch/playback tabs
- Watch Later (if enabled)
- Liked videos (if enabled — default off)

When Liked videos is enabled, the extension keeps a local cache of the liked playlist (IDs + titles) and picks from that cache. If the chosen video is already open in another tab, that tab will be focused instead of opening a duplicate.

If no candidate is available in any source, the behavior falls back to the configured "When no videos are available" destination (for example: `/shorts`, `home`, or `subscriptions`).

## Installation (developer mode)

1. Open `chrome://extensions/` (or `edge://extensions/`).
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the project folder.
5. Pin the extension in the toolbar for quick access.

## Options

In `options.html` you can configure:

- Fullscreen behavior when switching tabs.
- Which sources to use for selection (Watch Later, Shorts tabs, Watch tabs, Liked videos).
- Enable/disable Liked videos as a source (default: disabled).
- Source priority order.
- Theme and shortcut assignments.

## Popup

The popup (`popup.html`) lists detected videos/tabs, includes a real-time filter input, and provides quick actions to open a specific tab or pick a random video via the header button.

## Localization

The project is English-first and localized. Supported locales:

- `en`
- `pt`
- `es`
- `zh_CN`

Translation keys used by the UI are focused on navigation and tag management.

## Privacy

All data is stored locally in the browser:

- Settings and shortcuts: `chrome.storage.sync`
- History/tags and caches: `chrome.storage.local`

There is no external backend collecting user data.

> YouTube is a trademark of Google LLC.
> This extension is not affiliated with or endorsed by Google.

## Permissions (`manifest.json`)

- `tabs`: query, focus, update and close tabs
- `storage`: persist settings and history
- `scripting`: content interactions/injections
- `system.display`: fullscreen control
- `host_permissions` for `youtube.com`

## Project structure

- `background.js` -> service worker (switching logic, sources, badge, Watch Later cache)
- `content-video.js` -> video page logic (expanded modes, tag extraction, messaging)
- `content-listing.js` -> thumbnail listing interactions
- `popup.html` / `popup.js` -> quick UI and filtering
- `options.html` / `options.js` -> configuration UI

## License

- This project is released under the `Apache-2.0` license. See `LICENSE` and `NOTICE` for details.

Implementation notes:

- The content scripts are split into two files: `content-video.js` handles video-centric features and utilities, while `content-listing.js` is responsible for listing and tab-related interactions. Shared helper functions are declared in a common file.

## Checklist for Chrome Web Store

- [ ] Prepare ZIP package for upload with all required files included.
- [ ] Update Privacy Policy (short, local data only, no backend, using `chrome.storage`).
- [ ] Add screenshots (recommended >= 1280×800, minimum 640×400).
- [ ] Ensure no inline scripts or remote code evaluation (no `eval`, `new Function`, `fetch`+`eval`).
- [ ] Validate permissions and justify them in the listing (especially `system.display`).

### Onboarding / fullscreen (opt-in)

- [x] Welcome page (`welcome.html` / `welcome.js`) explaining fullscreen and user consent.
- [x] `background.js` opens onboarding on first install (`chrome.runtime.onInstalled`).
- [x] Save user preference in `chrome.storage.sync` (e.g., `enableFullscreen: true/false`).
- [x] `system.display` only used when `enableFullscreen` is enabled.
- [x] Document in README and Privacy Policy that fullscreen is optional and user-controlled.

- [ ] Test the full flow: install, onboarding, enable/disable fullscreen, publish to Chrome Web Store.
