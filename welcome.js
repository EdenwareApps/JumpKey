function getMessage(key, fallback) {
  if (typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getMessage === 'function') {
    const msg = chrome.i18n.getMessage(key);
    if (msg) return msg;
  }
  return fallback || '';
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
}

function applyLocalization() {
  setText('title', getMessage('welcomeTitle', 'Welcome to JumpKey'));
  setText(
    'description',
    getMessage(
      'welcomeDescription',
      'JumpKey can automatically enter fullscreen when switching videos. You can change this later in Options.'
    )
  );
  setText('note', getMessage('welcomeNote', 'You can change this later in Options.'));
  setText('enableBtn', getMessage('welcomeEnableBtn', 'Enable fullscreen'));
  setText('skipBtn', getMessage('welcomeSkipBtn', 'No thanks'));
  setText('openOptions', getMessage('welcomeOpenOptions', 'Open Options'));
  setText('footerText', getMessage('welcomeFooter', 'The setting is stored locally in your browser and can be changed at any time.'));
}

function closeTab() {
  // The page was opened by the extension; window.close() should work.
  window.close();
}

function openYoutubeHome() {
  try {
    chrome.tabs.create({ url: 'https://www.youtube.com/', active: true });
  } catch (err) {
    console.warn('[JumpKey Welcome] Failed to open YouTube home page:', err);
  }
}

function setFullscreenSetting(enabled) {
  const payload = {
    fullscreenOnSwitch: Boolean(enabled),
    welcomeComplete: true
  };
  chrome.storage.sync.set(payload, () => {
    // Best effort, open YouTube home and close the welcome tab.
    setTimeout(() => {
      openYoutubeHome();
      closeTab();
    }, 150);
  });
}

function openOptions() {
  if (chrome.runtime && typeof chrome.runtime.openOptionsPage === 'function') {
    chrome.runtime.openOptionsPage();
  }
}

function applyTheme(theme) {
  const body = document.body;
  if (!body) return;

  if (theme === 'dark') {
    body.setAttribute('data-theme', 'dark');
  } else if (theme === 'light') {
    body.setAttribute('data-theme', 'light');
  } else {
    body.removeAttribute('data-theme');
  }
}

function init() {
  applyLocalization();

  // Apply theme based on stored setting (auto / light / dark)
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get({ theme: 'auto' }, (items) => {
      applyTheme(items.theme);
    });
  }

  document.getElementById('enableBtn')?.addEventListener('click', () => setFullscreenSetting(true));
  document.getElementById('skipBtn')?.addEventListener('click', () => setFullscreenSetting(false));
  document.getElementById('openOptions')?.addEventListener('click', (e) => {
    e.preventDefault();
    openOptions();
  });
}

document.addEventListener('DOMContentLoaded', init);
