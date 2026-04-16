# JumpKey: Lazy YouTube Browsing

<p align="center">
  <a href="https://edenware.app/jumpkey" target="_blank">
    <img src="https://edenware.app/jumpkey/files/icon128.png" alt="Megacubo logo" title="JumpKey logo" />
  </a>
</p>

> Press **Y**. That's it. Instant jump to your next video.

JumpKey is a browser extension that transforms YouTube into an endless lazy browsing experience. Open multiple videos, press Y, and jump between them instantly. Your queue auto-fills with new content—perfect for researchers, creators, and anyone who loves mindless YouTube binge sessions.

## 🚀 Features

- ⏭️ **One-key skipping** — Press Y to instantly jump to the next video
- 🛋️ **Pure lazy browsing** — No UI clutter, no interruptions, just watching
- ♾️ **Auto-refilling queue** — Queue fills with new videos as you watch—never runs out
- 🎬 **YouTube Shorts support** — Works with both regular videos and Shorts
- ⌨️ **Customizable hotkey** — Change from Y to any key you prefer
- 🔒 **100% local & private** — All data stored locally, zero tracking, zero cloud sync
- 🌓 **Dark mode support** — Seamless light/dark theme detection

## 📦 Installation

### Chrome, Edge, Opera
1. Install from the Chrome Web Store: [JumpKey for YouTube](https://chromewebstore.google.com/detail/jumpkey-for-youtube/fieibhknplgoddlbohblahfcojhgbpfg)
2. Click Add to Chrome / Add to Edge
3. Pin the extension if you like

### Local unpacked install
1. Download [JumpKey.zip](https://github.com/EdenwareApps/JumpKey/releases)
2. Unzip to a folder
3. Open `chrome://extensions`
4. Enable "Developer mode" (top right)
5. Click "Load unpacked" and select the folder

### Firefox
1. Download [JumpKey-firefox.zip](https://github.com/EdenwareApps/JumpKey/releases)
2. Unzip to a folder
3. Open `about:debugging#/runtime/this-firefox`
4. Click "Load Temporary Add-on" and select `manifest.json`

## 🎮 How to Use

### Basic Usage
1. Open 3+ YouTube videos in different tabs
2. While watching any video, **press Y**
3. Jump to the next open video instantly
4. Keep pressing Y to cycle through your queue
5. At the end, new videos auto-appear—endless browsing

### Queue Management
- **Open Queue** — Click extension icon to see all videos (optional)
- **Remove** — Click × to remove a video permanently
- **Snooze** — Hide a video for 10 seconds (useful to skip)
- **Unsnooze** — Bring back snoozed videos

### Customize Hotkey
1. Right-click extension icon → **Options**
2. Set your preferred hotkey (Y is default)
3. Save and return to YouTube
4. Your new hotkey works immediately

## 🛡️ Privacy

**Zero data collection.** JumpKey:
- ✅ Stores everything locally (chrome.storage)
- ✅ Never sends data to any server
- ✅ No analytics, no tracking, no ads
- ✅ Works completely offline
- ✅ Open source—inspect the code yourself

## 🔧 Development

### Project Structure
```
JumpKey/
├── manifest.json          # Extension configuration
├── background.js          # Service worker
├── popup.html/js/css      # Queue UI
├── options.html/js/css    # Settings page
├── welcome.html/js        # First install page
├── content-video.js       # YouTube tab detector
├── icons/                 # Extension icons
├── _locales/              # Translations (en, es, pt, zh_CN)
└── scripts/               # Build scripts
```

### Build
```bash
npm install
npm run package        # Build Chrome version (dist/JumpKey.zip)
npm run package:firefox  # Build Firefox version (dist/JumpKey-firefox.zip)
```

## 🌍 Translations

JumpKey supports:
- 🇬🇧 English
- 🇪🇸 Spanish
- 🇵🇹 Portuguese
- 🇨🇳 Chinese (Simplified)

Contributions welcome! Edit files in `_locales/[lang]/messages.json`

## 📝 License

**AGPL-3.0-or-later** — See [LICENSE](LICENSE) for details.

This ensures that derivative works remain open source. Freedom for all. 🔓

## 🙏 Support

- 🐛 Found a bug? [Create an issue](https://github.com/EdenwareApps/JumpKey/issues)
- 💡 Have an idea? [Start a discussion](https://github.com/EdenwareApps/JumpKey/discussions)
- 💝 Love JumpKey? [Become a sponsor](https://github.com/sponsors/EdenwareApps)

## 🎬 Community

Made by [@EdenwareApps](https://github.com/EdenwareApps) with ❤️

**Other projects you might like:**
- [Megacubo](https://github.com/EdenwareApps/Megacubo) — IPTV streaming app (550+ ⭐)
- [Snapcover](https://edenware.app/snapcover) — Hide apps and windows instantly with a single shortcut.
- [Vimer](https://github.com/EdenwareApps/Vimer) — AI audio/video editor

---

**Press Y. Enjoy lazy YouTube browsing.** 🛋️⏭️
