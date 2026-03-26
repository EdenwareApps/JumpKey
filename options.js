const DEFAULT_SETTINGS = {
  fullscreenOnSwitch: false,
  useWatchLater: true,
  useLikedVideos: false,
  sourceWatchLater: true,
  sourceLikedVideos: false,
  sourceShortsTabs: true,
  sourceWatchTabs: true,
  syncToYoutubeWatchLater: true,
  autoRemoveWatchedFromWatchLater: true,
  emptyDestination: 'shorts',
  theme: 'auto',
  customShortcuts: {
    switchRandom: ['y'],
    likeOnly: ['+'],
    dislikeOnly: ['-']
  }
};

const SUPPORTED_LOCALES = ['en', 'pt', 'es', 'zh_CN'];
const LOCALE_TO_LANG_TAG = {
  en: 'en',
  pt: 'pt-BR',
  es: 'es',
  zh_CN: 'zh-CN'
};

const FALLBACK_MESSAGES = {
  extName: 'JumpKey',
  optionsPageTitle: 'JumpKey Options',
  optionsSubtitle: 'Options',
  fullscreenOptionLabel: 'Enter fullscreen and focus the video when switching tabs',
  optionsHint: 'Note: This uses browser window fullscreen and hides other UI with CSS.',
  shortcutsHeader: 'Keyboard Shortcuts',
  shortcutHint: 'Click a field and press a key to customize. You can assign multiple keys to an action.',
  switchActionLabel: 'Switch only:',
  likeSwitchActionLabel: 'Like only:',
  dislikeSwitchActionLabel: 'Dislike only:',
  addKeyBtn: '+ Add key',
  historyExportImportHeader: 'Export/Import Video Queue',
  historyExportImportDescription: 'Export and import playback history queue + options as JSON. Import merges entries by video ID.',
  historyJsonLabel: 'JSON',
  exportHistoryBtn: 'Export JSON',
  importHistoryBtn: 'Import JSON (merge)',
  historyImportStatusReady: 'Ready',
  historyImportStatusSuccess: 'Import successful',
  historyImportStatusError: 'Import error',
  themeLabel: 'Theme:',
  themeAuto: 'Auto (System)',
  themeLight: 'Light',
  themeDark: 'Dark'
};

function detectPreferredLocale() {
  const candidates = [
    chrome.i18n?.getUILanguage?.(),
    ...(Array.isArray(navigator.languages) ? navigator.languages : []),
    navigator.language
  ]
    .filter(Boolean)
    .map((lang) => String(lang).toLowerCase().replace('_', '-'));

  for (const lang of candidates) {
    if (lang.startsWith('pt')) {
      return 'pt';
    }

    if (lang.startsWith('es')) {
      return 'es';
    }

    if (lang.startsWith('zh')) {
      return 'zh_CN';
    }

    if (lang.startsWith('en')) {
      return 'en';
    }
  }

  return 'en';
}

function getMessageWithFallback(messageKey) {
  const value = chrome.i18n.getMessage(messageKey);
  if (value) {
    return value;
  }

  return FALLBACK_MESSAGES[messageKey] || '';
}

function applyLocalization() {
  const preferredLocale = detectPreferredLocale();
  const locale = SUPPORTED_LOCALES.includes(preferredLocale) ? preferredLocale : 'en';
  document.documentElement.lang = LOCALE_TO_LANG_TAG[locale] || 'en';

  const localizedElements = document.querySelectorAll('[data-i18n]');
  localizedElements.forEach((element) => {
    const messageKey = element.getAttribute('data-i18n');
    if (!messageKey) {
      return;
    }

    const message = getMessageWithFallback(messageKey);
    if (!message) {
      return;
    }

    if (element.tagName.toLowerCase() === 'title') {
      document.title = message;
      return;
    }

    element.textContent = message;
  });
}

function applyTheme(theme) {
  const root = document.documentElement;
  
  if (theme === 'light' || theme === 'dark') {
    root.setAttribute('data-theme', theme);
  } else {
    root.removeAttribute('data-theme');
  }
}

function loadSettings() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
    if (chrome.runtime.lastError) {
      console.error('Failed to load settings:', chrome.runtime.lastError);
      return;
    }

    const checkbox = document.getElementById('fullscreenSwitch');
    if (checkbox) {
      checkbox.checked = Boolean(items.fullscreenOnSwitch);
    }

    const sourceWatchLater = document.getElementById('sourceWatchLater');
    if (sourceWatchLater) {
      sourceWatchLater.checked = Boolean(items.sourceWatchLater);
    }

    const sourceShortsTabs = document.getElementById('sourceShortsTabs');
    if (sourceShortsTabs) {
      sourceShortsTabs.checked = Boolean(items.sourceShortsTabs);
    }

    const sourceWatchTabs = document.getElementById('sourceWatchTabs');
    if (sourceWatchTabs) {
      sourceWatchTabs.checked = Boolean(items.sourceWatchTabs);
    }

    const sourceLikedVideos = document.getElementById('sourceLikedVideos');
    if (sourceLikedVideos) {
      sourceLikedVideos.checked = Boolean(items.sourceLikedVideos);
    }

    const syncToYoutubeWatchLater = document.getElementById('syncToYoutubeWatchLater');
    if (syncToYoutubeWatchLater) {
      syncToYoutubeWatchLater.checked = Boolean(items.syncToYoutubeWatchLater);
    }

    const autoRemoveWatchedFromWatchLater = document.getElementById('autoRemoveWatchedFromWatchLater');
    if (autoRemoveWatchedFromWatchLater) {
      autoRemoveWatchedFromWatchLater.checked = (typeof items.autoRemoveWatchedFromWatchLater === 'undefined') ? true : Boolean(items.autoRemoveWatchedFromWatchLater);
    }

    const emptyDestinationSelect = document.getElementById('emptyDestinationSelect');
    if (emptyDestinationSelect) {
      emptyDestinationSelect.value = items.emptyDestination || 'shorts';
    }

    const themeSelect = document.getElementById('themeSelect');
    if (themeSelect) {
      themeSelect.value = items.theme || 'auto';
      applyTheme(items.theme || 'auto');
    }

    renderCustomShortcuts(items.customShortcuts || DEFAULT_SETTINGS.customShortcuts);
  });
}

function setSyncPlaylistsStatus(message, isError = false) {
  const statusEl = document.getElementById('syncPlaylistsStatus');
  if (!statusEl) return;
  statusEl.textContent = message || '';
  statusEl.style.color = isError ? 'var(--danger)' : 'var(--text)';
}

function syncPlaylists(forceConfirm = false) {
  setSyncPlaylistsStatus(getMessageWithFallback('syncPlaylistsStatusChecking') || 'Checking playlist sync...');

  chrome.runtime.sendMessage({ action: 'syncPlaylists', confirmed: forceConfirm }, (response) => {
    if (chrome.runtime.lastError) {
      setSyncPlaylistsStatus(`Error: ${chrome.runtime.lastError.message}`, true);
      return;
    }

    if (!response) {
      setSyncPlaylistsStatus('No response from background script', true);
      return;
    }

    if (response.confirmationNeeded) {
      const confirmationText = getMessageWithFallback('syncPlaylistsConfirm') || 'Do you want to sync Watch Later and Liked videos now?';
      const accepted = confirm(confirmationText);
      if (!accepted) {
        setSyncPlaylistsStatus(getMessageWithFallback('syncPlaylistsCancelled') || 'Playlist sync cancelled.');
        return;
      }
      syncPlaylists(true);
      return;
    }

    if (!response.success) {
      setSyncPlaylistsStatus(`${getMessageWithFallback('syncPlaylistsFailed') || 'Playlist sync failed:'} ${response.message || 'unknown error'}`, true);
      return;
    }

    const result = response.result || {};
    if (result.watchLater == null && result.liked == null) {
      setSyncPlaylistsStatus(getMessageWithFallback('syncPlaylistsNoSource') || 'No sync sources enabled. Update settings and try again.', true);
      return;
    }

    setSyncPlaylistsStatus(getMessageWithFallback('syncPlaylistsDone') || 'Playlist sync complete.');
  });
}

function getDisplayKeyName(key) {
  const keyMap = {
    ArrowRight: '→',
    ArrowLeft: '←',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ' ': 'Space',
    Enter: '⏎'
  };
  
  return keyMap[key] || key.toUpperCase();
}

function renderCustomShortcuts(shortcuts) {
  const actions = [
    { key: 'switchRandom', containerId: 'switchRandomBindings', btnId: 'addSwitchRandomKey' },
    { key: 'likeOnly', containerId: 'likeSwitchBindings', btnId: 'addLikeSwitchKey' },
    { key: 'dislikeOnly', containerId: 'dislikeSwitchBindings', btnId: 'addDislikeSwitchKey' }
  ];

  actions.forEach(({ key, containerId, btnId }) => {
    const container = document.getElementById(containerId);
    const btn = document.getElementById(btnId);
    if (!container || !btn) return;

    const keys = shortcuts[key] || [];
    container.innerHTML = keys
      .map(
        (k) => `
      <span class="key-badge" data-action="${key}" data-key="${k}">
        ${getDisplayKeyName(k)}
        <button type="button" class="key-badge-remove" title="Remove">×</button>
      </span>
    `
      )
      .join('');

    container.querySelectorAll('.key-badge-remove').forEach((removeBtn) => {
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        const badge = e.currentTarget.parentElement;
        if (!badge) return;
        const action = badge.getAttribute('data-action');
        const keyToRemove = badge.getAttribute('data-key');
        removeCustomKey(action, keyToRemove);
      };
    });

    btn.onclick = () => {
      startKeyCapture(key);
    };
  });
}

function startKeyCapture(actionKey) {
  const actions = {
    switchRandom: 'addSwitchRandomKey',
    likeOnly: 'addLikeSwitchKey',
    dislikeOnly: 'addDislikeSwitchKey'
  };

  const btnId = actions[actionKey];
  const btn = document.getElementById(btnId);
  if (!btn) return;

  btn.classList.add('listening');
  btn.disabled = true;
  btn.textContent = getMessageWithFallback('listeningMsg') || 'Press a key...';

  const handleKeyCapture = (event) => {
    event.preventDefault();
    event.stopPropagation();

    let capturedKey = event.key;
    
    if (event.code && event.code.startsWith('Arrow')) {
      capturedKey = event.code;
    } else if (event.code === 'NumpadAdd') {
      capturedKey = '+';
    } else if (event.code === 'NumpadSubtract') {
      capturedKey = '-';
    }

    document.removeEventListener('keydown', handleKeyCapture, true);
    btn.classList.remove('listening');
    btn.disabled = false;
    btn.textContent = getMessageWithFallback('addKeyBtn') || '+ Add key';

    addCustomKey(actionKey, capturedKey);
  };

  document.addEventListener('keydown', handleKeyCapture, true);
}

function addCustomKey(actionKey, key) {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
    const shortcuts = items.customShortcuts || { ...DEFAULT_SETTINGS.customShortcuts };
    
    if (!Array.isArray(shortcuts[actionKey])) {
      shortcuts[actionKey] = [];
    }

    if (!shortcuts[actionKey].includes(key)) {
      shortcuts[actionKey].push(key);
    }

    chrome.storage.sync.set({ customShortcuts: shortcuts }, () => {
      renderCustomShortcuts(shortcuts);
    });
  });
}

function removeCustomKey(actionKey, key) {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
    const shortcuts = items.customShortcuts || { ...DEFAULT_SETTINGS.customShortcuts };
    
    if (Array.isArray(shortcuts[actionKey])) {
      shortcuts[actionKey] = shortcuts[actionKey].filter((k) => k !== key);
    }

    chrome.storage.sync.set({ customShortcuts: shortcuts }, () => {
      renderCustomShortcuts(shortcuts);
    });
  });
}

function saveSettings() {
  const checkbox = document.getElementById('fullscreenSwitch');
  const sourceWatchLater = document.getElementById('sourceWatchLater');
  const sourceShortsTabs = document.getElementById('sourceShortsTabs');
  const sourceWatchTabs = document.getElementById('sourceWatchTabs');
  const sourceLikedVideos = document.getElementById('sourceLikedVideos');
  const emptyDestinationSelect = document.getElementById('emptyDestinationSelect');
  const themeSelect = document.getElementById('themeSelect');
  if (!checkbox || !sourceWatchLater || !sourceShortsTabs || !sourceWatchTabs || !sourceLikedVideos || !emptyDestinationSelect || !themeSelect) {
    return;
  }

  const hasAnySourceEnabled = sourceWatchLater.checked || sourceShortsTabs.checked || sourceWatchTabs.checked || sourceLikedVideos.checked;
  if (!hasAnySourceEnabled) {
    sourceShortsTabs.checked = true;
  }

  const theme = themeSelect.value;
  applyTheme(theme);

  chrome.storage.sync.set(
    {
      fullscreenOnSwitch: checkbox.checked,
      useWatchLater: sourceWatchLater.checked,
      sourceWatchLater: sourceWatchLater.checked,
      sourceShortsTabs: sourceShortsTabs.checked,
      sourceWatchTabs: sourceWatchTabs.checked,
      sourceLikedVideos: sourceLikedVideos.checked,
      syncToYoutubeWatchLater: (document.getElementById('syncToYoutubeWatchLater') && document.getElementById('syncToYoutubeWatchLater').checked) || false,
      autoRemoveWatchedFromWatchLater: (document.getElementById('autoRemoveWatchedFromWatchLater') && document.getElementById('autoRemoveWatchedFromWatchLater').checked) || false,
      emptyDestination: emptyDestinationSelect.value,
      theme: theme
    },
    () => {
    if (chrome.runtime.lastError) {
      console.error('Failed to save settings:', chrome.runtime.lastError);
    }
    }
  );
}

function setHistoryImportStatus(text, isError = false) {
  const statusEl = document.getElementById('historyImportStatus');
  if (!statusEl) return;
  statusEl.textContent = text || '';
  statusEl.style.color = isError ? 'var(--danger)' : 'var(--text)';
}

function exportHistoryQueue() {
  setHistoryImportStatus(getMessageWithFallback('historyImportStatusReady') || 'Ready');
  chrome.runtime.sendMessage({ action: 'exportVideoQueue' }, (response) => {
    if (chrome.runtime.lastError) {
      setHistoryImportStatus(getMessageWithFallback('historyImportStatusError') + ': ' + chrome.runtime.lastError.message, true);
      return;
    }

    if (!response || !response.ok || !response.data) {
      setHistoryImportStatus(getMessageWithFallback('historyImportStatusError') + ': ' + (response?.error || 'unknown'), true);
      return;
    }

    try {
      const text = JSON.stringify(response.data, null, 2);
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `jumpkey-history-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setHistoryImportStatus('Export completed');
    } catch (e) {
      setHistoryImportStatus(getMessageWithFallback('historyImportStatusError') + ': ' + (e && e.message ? e.message : String(e)), true);
    }
  });
}

function importHistoryQueue() {
  const fileInput = document.getElementById('historyJsonFileInput');
  if (!fileInput) {
    setHistoryImportStatus(getMessageWithFallback('historyImportStatusError') + ': file input missing', true);
    return;
  }

  fileInput.value = '';

  fileInput.onchange = () => {
    const file = fileInput.files?.[0];
    if (!file) {
      setHistoryImportStatus(getMessageWithFallback('historyImportStatusError') + ': no file selected', true);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      let payload;
      try {
        payload = JSON.parse(reader.result);
      } catch (e) {
        setHistoryImportStatus(getMessageWithFallback('historyImportStatusError') + ': invalid JSON', true);
        return;
      }

      chrome.runtime.sendMessage({ action: 'importVideoQueue', payload }, (response) => {
        if (chrome.runtime.lastError) {
          setHistoryImportStatus(getMessageWithFallback('historyImportStatusError') + ': ' + chrome.runtime.lastError.message, true);
          return;
        }

        if (!response || !response.ok) {
          setHistoryImportStatus(getMessageWithFallback('historyImportStatusError') + ': ' + (response?.error || 'unknown'), true);
          return;
        }

        setHistoryImportStatus(getMessageWithFallback('historyImportStatusSuccess') + ` (added: ${response.added || 0}, updated: ${response.updated || 0})`);
      });
    };
    reader.onerror = () => {
      setHistoryImportStatus(getMessageWithFallback('historyImportStatusError') + ': file read error', true);
    };

    reader.readAsText(file);
  };

  fileInput.click();

  chrome.runtime.sendMessage({ action: 'importVideoQueue', payload }, (response) => {
    if (chrome.runtime.lastError) {
      setHistoryImportStatus(getMessageWithFallback('historyImportStatusError') + ': ' + chrome.runtime.lastError.message, true);
      return;
    }

    if (!response || !response.ok) {
      setHistoryImportStatus(getMessageWithFallback('historyImportStatusError') + ': ' + (response?.error || 'unknown'), true);
      return;
    }

    setHistoryImportStatus(getMessageWithFallback('historyImportStatusSuccess') + ` (added: ${response.added || 0}, updated: ${response.updated || 0})`);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  applyLocalization();
  loadSettings();

  const checkbox = document.getElementById('fullscreenSwitch');
  if (checkbox) {
    checkbox.addEventListener('change', saveSettings);
  }

  const sourceWatchLater = document.getElementById('sourceWatchLater');
  if (sourceWatchLater) {
    sourceWatchLater.addEventListener('change', saveSettings);
  }

  const sourceShortsTabs = document.getElementById('sourceShortsTabs');
  if (sourceShortsTabs) {
    sourceShortsTabs.addEventListener('change', saveSettings);
  }

  const sourceWatchTabs = document.getElementById('sourceWatchTabs');
  if (sourceWatchTabs) {
    sourceWatchTabs.addEventListener('change', saveSettings);
  }

  const sourceLikedVideos = document.getElementById('sourceLikedVideos');
  if (sourceLikedVideos) {
    sourceLikedVideos.addEventListener('change', saveSettings);
  }

  const syncToYoutubeWatchLater = document.getElementById('syncToYoutubeWatchLater');
  if (syncToYoutubeWatchLater) {
    syncToYoutubeWatchLater.addEventListener('change', saveSettings);
  }

  const autoRemoveWatchedFromWatchLater = document.getElementById('autoRemoveWatchedFromWatchLater');
  if (autoRemoveWatchedFromWatchLater) {
    autoRemoveWatchedFromWatchLater.addEventListener('change', saveSettings);
  }

  const bulkAddWatchLaterBtn = document.getElementById('bulkAddWatchLaterBtn');
  const bulkWatchLaterTextarea = document.getElementById('bulkWatchLaterTextarea');
  const bulkAddStatus = document.getElementById('bulkAddStatus');
  if (bulkAddWatchLaterBtn && bulkWatchLaterTextarea) {
    bulkAddWatchLaterBtn.addEventListener('click', () => {
      const text = bulkWatchLaterTextarea.value || '';
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const ids = lines.map((l) => {
        // extract video id from URL or assume it's an id
        const m = l.match(/[?&]v=([a-zA-Z0-9_-]{6,})/) || l.match(/\/shorts\/([a-zA-Z0-9_-]{6,})/) || l.match(/^([a-zA-Z0-9_-]{6,})$/);
        return m ? m[1] : null;
      }).filter(Boolean);

      if (ids.length === 0) {
        if (bulkAddStatus) bulkAddStatus.textContent = 'No valid video IDs found';
        return;
      }

      if (bulkAddStatus) bulkAddStatus.textContent = `Adding ${ids.length} videos to Watch Later...`;
      chrome.runtime.sendMessage({ action: 'bulkAddToYoutubeWatchLater', videoIds: ids }, (resp) => {
        if (chrome.runtime.lastError) {
          if (bulkAddStatus) bulkAddStatus.textContent = `Error: ${chrome.runtime.lastError.message}`;
        } else if (resp && resp.status === 'started') {
          if (bulkAddStatus) bulkAddStatus.textContent = `Started adding ${ids.length} videos. Check console for progress.`;
        } else {
          if (bulkAddStatus) bulkAddStatus.textContent = `Background response: ${JSON.stringify(resp)}`;
        }
      });
    });
  }

  const syncPlaylistsBtn = document.getElementById('syncPlaylistsBtn');
  if (syncPlaylistsBtn) {
    syncPlaylistsBtn.addEventListener('click', () => {
      syncPlaylists(false);
    });
  }

  const showOnboardingBtn = document.getElementById('showOnboardingBtn');
  if (showOnboardingBtn) {
    showOnboardingBtn.addEventListener('click', () => {
      try {
        chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html'), active: true });
      } catch (err) {
        console.warn('[JumpKey Options] Failed to open onboarding page:', err);
      }
    });
  }

  const exportHistoryBtn = document.getElementById('exportHistoryBtn');
  if (exportHistoryBtn) {
    exportHistoryBtn.addEventListener('click', exportHistoryQueue);
  }

  const importHistoryBtn = document.getElementById('importHistoryBtn');
  if (importHistoryBtn) {
    importHistoryBtn.addEventListener('click', importHistoryQueue);
  }
});
