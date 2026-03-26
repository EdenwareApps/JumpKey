console.log('[JumpKey Popup] Initializing popup');

// Calculate and set max height based on screen availability
function setPopupMaxHeight() {
  // Get available screen height, minus safe margins for taskbars/UI
  const availableHeight = screen.availHeight - 80; // 80px safety margin
  
  // Cap at reasonable limits: min 400px, max 700px
  const maxHeight = Math.max(400, Math.min(availableHeight, 700));
  
  console.log('[JumpKey Popup] Setting max height:', maxHeight, 'px (available:', screen.availHeight, 'px)');
  
  // Set CSS custom property
  document.documentElement.style.setProperty('--popup-max-height', maxHeight + 'px');
}

// Set height on load
setPopupMaxHeight();

// Apply theme
function applyTheme(theme) {
  const root = document.documentElement;
  
  if (theme === 'light' || theme === 'dark') {
    root.setAttribute('data-theme', theme);
  } else {
    root.removeAttribute('data-theme');
  }
}

// Load and apply theme
chrome.storage.sync.get({ theme: 'auto' }, (items) => {
  applyTheme(items.theme);
});

// Translation function
function getMessageWithFallback(messageKey) {
  const value = chrome.i18n.getMessage(messageKey);
  return value || messageKey;
}

// Apply translations to all elements with data-i18n
function applyTranslations() {
  const localizedElements = document.querySelectorAll('[data-i18n]');
  
  localizedElements.forEach((element) => {
    const messageKey = element.getAttribute('data-i18n');
    const message = getMessageWithFallback(messageKey);
    
    if (element.children.length === 0) {
      element.textContent = message;
    } else {
      element.innerHTML = message;
    }
  });

  const titleElements = document.querySelectorAll('[data-i18n-title]');
  titleElements.forEach((element) => {
    const messageKey = element.getAttribute('data-i18n-title');
    const message = getMessageWithFallback(messageKey);
    element.setAttribute('title', message);
  });

  const ariaLabelElements = document.querySelectorAll('[data-i18n-aria-label]');
  ariaLabelElements.forEach((element) => {
    const messageKey = element.getAttribute('data-i18n-aria-label');
    const message = getMessageWithFallback(messageKey);
    element.setAttribute('aria-label', message);
  });

  const placeholderElements = document.querySelectorAll('[data-i18n-placeholder]');
  placeholderElements.forEach((element) => {
    const messageKey = element.getAttribute('data-i18n-placeholder');
    const message = getMessageWithFallback(messageKey);
    element.setAttribute('placeholder', message);
  });
}

// Apply translations when DOM is ready
applyTranslations();

function extractVideoId(url) {
  if (url.includes('/shorts/')) {
    const match = url.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  } else if (url.includes('/watch?')) {
    const match = url.match(/[?&]v=([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }
  return null;
}

function getVideoThumbnailUrl(videoId) {
  if (!videoId) return null;
  return `https://img.youtube.com/vi/${videoId}/default.jpg`;
}

function tagsToText(tags) {
  if (!Array.isArray(tags) || tags.length === 0) {
    return 'No tags';
  }

  return tags.map((tag) => `#${tag}`).join(' ');
}

function formatDuration(durationSec) {
  if (!Number.isFinite(Number(durationSec)) || durationSec <= 0) return '';
  const total = Math.round(durationSec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function getDurationSortValue(item) {
  if (item && Number.isFinite(Number(item.duration)) && Number(item.duration) > 0) {
    return Number(item.duration);
  }
  if (item && item.isShort) {
    return 2 * 60; // Short fallback 2:00
  }
  return 20 * 60; // Long fallback 20:00
}

// Save scroll position to storage
function saveScrollPosition() {
  const container = document.getElementById('videosList');
  if (container) {
    const scrollTop = container.scrollTop;
      chrome.storage.local.set({ popupScrollPosition: scrollTop }, () => {
      console.log('[JumpKey Popup] Saved scroll position:', scrollTop);
    });
  }
}

// Restore scroll position from storage
function restoreScrollPosition() {
  chrome.storage.local.get({ popupScrollPosition: 0 }, (items) => {
    const container = document.getElementById('videosList');
    if (container && items.popupScrollPosition > 0) {
      // Use requestAnimationFrame to ensure DOM is fully rendered
        requestAnimationFrame(() => {
        container.scrollTop = items.popupScrollPosition;
        console.log('[JumpKey Popup] Restored scroll position:', items.popupScrollPosition);
      });
    }
  });
}

let allVideoItems = [];
let popupHiddenVideos = {};
let popupSnoozedVideos = {};
const POPUP_HIDE_DURATION_MS = 60 * 60 * 1000; // 1 hour

function normalizeText(s) {
  return (s || '').toString().toLowerCase();
}

function applyFilter(items, filterText) {
  if (!filterText) return items;
  const q = filterText.trim().toLowerCase();
  return items.filter((it) => {
    const title = normalizeText(it.title || (it.url || ''));
    const tags = Array.isArray(it.tags) ? it.tags.join(' ') : '';
    const vid = (it.videoId || '').toString().toLowerCase();
    return title.includes(q) || tags.toLowerCase().includes(q) || vid.includes(q);
  });
}

function cleanExpiredPopupState() {
  const now = Date.now();
  let changed = false;

  for (const [id, expires] of Object.entries(popupHiddenVideos)) {
    if (expires && expires <= now) {
      delete popupHiddenVideos[id];
      changed = true;
    }
  }

  for (const [id, expires] of Object.entries(popupSnoozedVideos)) {
    if (expires && expires <= now) {
      delete popupSnoozedVideos[id];
      changed = true;
    }
  }

  if (changed) {
    chrome.storage.local.set({
      popupHiddenVideos,
      popupSnoozedVideos
    }, () => {
      console.log('[JumpKey Popup] Cleaned expired hidden/snoozed videos');
    });
  }
}

function loadPopupState() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ popupHiddenVideos: {}, popupSnoozedVideos: {} }, (items) => {
      popupHiddenVideos = items.popupHiddenVideos || {};
      popupSnoozedVideos = items.popupSnoozedVideos || {};
      cleanExpiredPopupState();
      resolve();
    });
  });
}

function isVideoHidden(videoId) {
  if (!videoId) return false;
  const now = Date.now();
  if (popupHiddenVideos[videoId] && popupHiddenVideos[videoId] > now) return true;
  return false;
}

function setVideoHidden(videoId, durationMs = POPUP_HIDE_DURATION_MS) {
  if (!videoId) return;
  const expires = Date.now() + durationMs;
  popupHiddenVideos[videoId] = expires;
  chrome.storage.local.set({ popupHiddenVideos }, () => {
    console.log('[JumpKey Popup] Video hidden until', new Date(expires), videoId);
    // Sync snooze with background so random source selection skips this for the same period
    chrome.runtime.sendMessage({ action: 'popupSnoozeVideo', videoId, expires }, (resp) => {
      if (chrome.runtime.lastError) {
        console.warn('[JumpKey Popup] popupSnoozeVideo sendMessage error:', chrome.runtime.lastError);
      } else {
        console.log('[JumpKey Popup] popupSnoozeVideo response:', resp);
      }
    });
    renderVideosList(allVideoItems, null, document.getElementById('filterInput')?.value || '');
  });
}

function snoozeVideo(videoId, durationMs = POPUP_HIDE_DURATION_MS) {
  if (!videoId) return;
  const expires = Date.now() + durationMs;
  popupSnoozedVideos[videoId] = expires;
  chrome.storage.local.set({ popupSnoozedVideos }, () => {
    console.log('[JumpKey Popup] Video snoozed until', new Date(expires), videoId);
    renderVideosList(allVideoItems, null, document.getElementById('filterInput')?.value || '');
  });
}

function renderVideosList(videoItems, activeTabId, filterText = '') {
  const filteredItems = applyFilter(videoItems, filterText);
  const container = document.getElementById('videosList');

  // Sort by snoozed (last) and then by duration to mirror background selection priority
  const sortedItems = filteredItems.slice().sort((a, b) => {
    const aSnoozed = Boolean(a.videoId && popupSnoozedVideos[a.videoId] && popupSnoozedVideos[a.videoId] > Date.now());
    const bSnoozed = Boolean(b.videoId && popupSnoozedVideos[b.videoId] && popupSnoozedVideos[b.videoId] > Date.now());
    if (aSnoozed !== bSnoozed) return aSnoozed ? 1 : -1;

    const da = getDurationSortValue(a);
    const db = getDurationSortValue(b);
    if (da !== db) return da - db;
    return 0;
  });

  if (videoItems.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No videos open yet</p>
        <p style="font-size: 12px; margin-top: 8px; color: #666;">Open some Shorts or videos to start</p>
      </div>
    `;
    return;
  }

  if (filteredItems.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No videos match the filter</p>
      </div>
    `;
    return;
  }

  container.innerHTML = sortedItems
    .map((item, index) => {
      const itemNumber = index + 1;
      const isWatchLaterItem = item.source === 'watch-later';
      const isLikedItem = item.source === 'liked-videos';
      const videoId = (isWatchLaterItem || isLikedItem) ? item.videoId : extractVideoId(item.url);
      if (videoId && isVideoHidden(videoId)) {
        return '';
      }
      const thumbnailUrl = getVideoThumbnailUrl(videoId);
      const isExternalSourceItem = isWatchLaterItem || isLikedItem;
      const isActive = !isExternalSourceItem && item.id === activeTabId;
      const numberBadge = `<span class="video-number">${itemNumber}</span>`;
      const itemId = isWatchLaterItem
        ? `wl-${videoId}`
        : isLikedItem
          ? `ll-${videoId}`
          : String(item.id);
      const itemTitle = item.title || (isWatchLaterItem
        ? `Watch Later • ${videoId}`
        : isLikedItem
          ? `Liked Videos • ${videoId}`
          : 'Untitled');
      const tagsText = tagsToText(item.tags);
      const sourceBadge = isWatchLaterItem
        ? '<span class="video-source">Watch Later</span>'
        : isLikedItem
          ? '<span class="video-source">Liked Videos</span>'
          : '';
      const snoozeExpiry = item.videoId ? popupSnoozedVideos[item.videoId] : null;
      const isSnoozed = Boolean(snoozeExpiry && snoozeExpiry > Date.now());
      const snoozedBadge = isSnoozed ? `<span class="video-snoozed">Snoozed</span>` : '';
      const durationText = (Number.isFinite(Number(item.duration)) && item.duration > 0)
        ? formatDuration(item.duration)
        : 'N/A';
      const durationBadge = `<span class="video-duration">${durationText}</span>`;
      
      return `
        <div class="video-item ${isActive ? 'active' : ''}" data-item-id="${itemId}" data-source="${isWatchLaterItem ? 'watch-later' : isLikedItem ? 'liked-videos' : 'tab'}" data-video-id="${videoId || ''}" data-tab-id="${isExternalSourceItem ? '' : item.id}">
          ${numberBadge}
          <div class="video-thumbnail ${!thumbnailUrl ? 'error' : ''}">
            ${thumbnailUrl 
              ? `<img src="${thumbnailUrl}" alt="thumbnail">` 
              : '<span>▶️</span>'
            }
          </div>
          <div class="video-actions">
            <button class="action-snooze" title="Adiar 1 hora">⏰</button>
            ${isSnoozed ? '<button class="action-unsnooze" title="Remover adiamento">↺</button>' : ''}
            <button class="action-remove" title="Remover">×</button>
          </div>
          <div class="video-info">
            <div class="video-title">${escapeHtml(itemTitle)}</div>
            ${durationBadge} ${snoozedBadge}
            <div class="video-tags">${escapeHtml(tagsText)}</div>
            ${sourceBadge}
          </div>
        </div>
      `;
    })
    .filter(Boolean)
    .join('');

  // Attach image error handlers and click handlers
  container.querySelectorAll('.video-item').forEach((item) => {
    // Handle image load errors
    const img = item.querySelector('img');
    if (img) {
      img.addEventListener('error', () => {
        img.style.display = 'none';
      });
    }

    // Handle click to switch tab (or actions)
    item.addEventListener('click', (e) => {
      const actionRemove = e.target.closest('.action-remove');
      if (actionRemove) {
        e.stopPropagation();
        const videoId = item.dataset.videoId;
        const tabId = parseInt(item.dataset.tabId, 10);
        const source = item.dataset.source;
        if (source === 'tab' && tabId) {
          chrome.tabs.remove(tabId, () => {
            if (chrome.runtime.lastError) {
              console.warn('[JumpKey Popup] Failed to close tab:', chrome.runtime.lastError);
            }
            loadVideos();
          });
        } else if (videoId) {
          setVideoHidden(videoId);
        }
        return;
      }

      const actionSnooze = e.target.closest('.action-snooze');
      if (actionSnooze) {
        e.stopPropagation();
        const videoId = item.dataset.videoId;
        if (videoId) {
          snoozeVideo(videoId);
        }
        return;
      }

      const actionUnsnooze = e.target.closest('.action-unsnooze');
      if (actionUnsnooze) {
        e.stopPropagation();
        const videoId = item.dataset.videoId;
        if (videoId) {
          delete popupSnoozedVideos[videoId];
          chrome.storage.local.set({ popupSnoozedVideos }, () => {
            chrome.runtime.sendMessage({ action: 'popupSnoozeVideo', videoId, expires: 0 }, () => {});
            renderVideosList(allVideoItems, activeTabId, document.getElementById('filterInput')?.value || '');
          });
        }
        return;
      }

      const source = item.dataset.source;
      const videoId = item.dataset.videoId;
      const tabId = parseInt(item.dataset.tabId, 10);

      if ((source === 'watch-later' || source === 'liked-videos') && videoId) {
        chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${videoId}`, active: true });
        window.close();
        return;
      }

      console.log('[JumpKey Popup] ========== CLICK HANDLER ==========');
        console.log('[JumpKey Popup] Switching to tab:', tabId);
        console.log('[JumpKey Popup] chrome.tabs:', typeof chrome.tabs);
      
      // Get the tab details to pass to background for full switch flow
      chrome.tabs.get(tabId, (tab) => {
        console.log('[JumpKey Popup] chrome.tabs.get callback');
        if (chrome.runtime.lastError) {
          console.error('[JumpKey Popup] Error getting tab:', chrome.runtime.lastError);
          console.error('[JumpKey Popup] Error details:', chrome.runtime.lastError.message);
          return;
        }
        
        console.log('[JumpKey Popup] Got tab details:', tab.id, tab.url);
        console.log('[JumpKey Popup] Tab object:', tab);
        
        // Send switch request to background (includes fullscreen logic)
        // Use only tabId to avoid serializing large tab objects from popup context
        console.log('[JumpKey Popup] About to send switchToTab message with tabId:', tab.id);
        chrome.runtime.sendMessage(
          { action: 'switchToTab', targetTabId: tab.id },
          (response) => {
            console.log('[JumpKey Popup] sendMessage callback received');
            if (chrome.runtime.lastError) {
              console.warn('[JumpKey Popup] Message error:', chrome.runtime.lastError);
              console.warn('[JumpKey Popup] Error details:', chrome.runtime.lastError.message);
            } else {
              console.log('[JumpKey Popup] Switch response received:', response);
              // Close popup after initiating switch
              console.log('[JumpKey Popup] Closing popup');
              window.close();
            }
          }
        );
      });
    });
  });
  
  // Restore scroll position after rendering
  restoreScrollPosition();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function queryTabs(queryInfo) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(tabs || []);
    });
  });
}

async function loadVideos() {
  try {
    await loadPopupState();

    const [shortTabs, watchTabs, activeTabs, settings, localData] = await Promise.all([
      queryTabs({ url: ['https://*.youtube.com/shorts/*', 'https://youtube.com/shorts/*'] }),
      queryTabs({ url: ['https://*.youtube.com/watch*', 'https://youtube.com/watch*'] }),
      queryTabs({ active: true, currentWindow: true }),
      new Promise((resolve) => chrome.storage.sync.get({ sourceWatchLater: true, sourceLikedVideos: false, sourceShortsTabs: true, sourceWatchTabs: true }, resolve)),
      new Promise((resolve) => chrome.storage.local.get({ wlCache: { videoIds: [], videos: [], lastSync: 0 }, likedCache: { videoIds: [], videos: [], lastSync: 0 }, videoHistory: [], videoDurations: {} }, resolve))
    ]);

    const wlVideos = Array.isArray(localData?.wlCache?.videos)
      ? localData.wlCache.videos
      : Array.isArray(localData?.wlCache?.videoIds)
        ? localData.wlCache.videoIds.map((videoId) => ({ videoId, title: `Watch Later • ${videoId}`, tags: [] }))
        : [];

    const historyEntries = Array.isArray(localData?.videoHistory) ? localData.videoHistory : [];
    const tagsByVideoId = new Map();
    const titleByVideoId = new Map();
    const durationByVideoId = new Map();

    // prefer explicit videoDurations map from storage (background already fills this key)
    if (localData?.videoDurations && typeof localData.videoDurations === 'object') {
      for (const [videoId, dur] of Object.entries(localData.videoDurations)) {
        if (videoId && Number.isFinite(Number(dur)) && dur > 0) {
          durationByVideoId.set(videoId, Number(dur));
        }
      }
    }

    // fallback: cache entries may include duration property too
    const wlDurations = Array.isArray(localData?.wlCache?.videos) ? localData.wlCache.videos : [];
    const likedDurations = Array.isArray(localData?.likedCache?.videos) ? localData.likedCache.videos : [];
    for (const entry of [...wlDurations, ...likedDurations]) {
      if (entry?.videoId && Number.isFinite(Number(entry.duration)) && entry.duration > 0) {
        durationByVideoId.set(entry.videoId, Number(entry.duration));
      }
    }

    for (const entry of historyEntries) {
      if (!entry?.videoId) {
        continue;
      }

      if (!tagsByVideoId.has(entry.videoId)) {
        tagsByVideoId.set(entry.videoId, Array.isArray(entry.tags) ? entry.tags : []);
      }

      if (!titleByVideoId.has(entry.videoId) && entry.title) {
        titleByVideoId.set(entry.videoId, entry.title);
      }
    }

    const tabsById = new Map();

    [...shortTabs, ...watchTabs].forEach((tab) => {
      if (!tab?.id) {
        return;
      }

      const url = tab.url || '';
      const isWatchWithVideoId = url.includes('youtube.com/watch') && url.includes('v=');
      const isShort = url.includes('youtube.com/shorts/');

      if ((isShort && settings.sourceShortsTabs) || (isWatchWithVideoId && settings.sourceWatchTabs)) {
        tabsById.set(tab.id, tab);
      }
    });

    const videoTabs = Array.from(tabsById.values()).map((tab) => {
      const videoId = extractVideoId(tab.url || '');
      const isShort = (tab.url || '').includes('/shorts/');
      return {
        ...tab,
        source: 'tab',
        videoId,
        isShort,
        tags: videoId ? (tagsByVideoId.get(videoId) || []) : [],
        duration: videoId ? durationByVideoId.get(videoId) || null : null
      };
    });

    const openVideoIds = new Set(videoTabs.map((tab) => extractVideoId(tab.url)).filter(Boolean));
    const watchLaterItems = settings.sourceWatchLater
      ? wlVideos
          .filter((video) => video?.videoId && !openVideoIds.has(video.videoId))
          .map((video) => ({
            source: 'watch-later',
            videoId: video.videoId,
            title: video.title || titleByVideoId.get(video.videoId) || `Watch Later • ${video.videoId}`,
            tags: Array.isArray(video.tags) && video.tags.length > 0
              ? video.tags
              : (tagsByVideoId.get(video.videoId) || []),
            duration: Number.isFinite(Number(video.duration)) && video.duration > 0 ? Number(video.duration) : durationByVideoId.get(video.videoId) || null
          }))
      : [];

    const likedVideos = Array.isArray(localData?.likedCache?.videos)
      ? localData.likedCache.videos
      : Array.isArray(localData?.likedCache?.videoIds)
        ? localData.likedCache.videoIds.map((videoId) => ({ videoId, title: `Liked Videos • ${videoId}`, tags: [] }))
        : [];

    const likedItems = settings.sourceLikedVideos
      ? likedVideos
          .filter((video) => video?.videoId && !openVideoIds.has(video.videoId))
          .map((video) => ({
            source: 'liked-videos',
            videoId: video.videoId,
            title: video.title || titleByVideoId.get(video.videoId) || `Liked Videos • ${video.videoId}`,
            tags: Array.isArray(video.tags) && video.tags.length > 0
              ? video.tags
              : (tagsByVideoId.get(video.videoId) || []),
            duration: Number.isFinite(Number(video.duration)) && video.duration > 0 ? Number(video.duration) : durationByVideoId.get(video.videoId) || null
          }))
      : [];

    const videoItems = [...videoTabs, ...watchLaterItems, ...likedItems];

    // Sort queue by duration (with fallback values no-duration == short 2m / long 20m)
    videoItems.sort((a, b) => {
      const da = getDurationSortValue(a);
      const db = getDurationSortValue(b);
      return da - db;
    });

    // cache globally for filtering
    allVideoItems = videoItems;
    const activeTabId = activeTabs[0]?.id || null;

    console.log('[JumpKey Popup] Found video items:', videoItems.length);
    console.log('[JumpKey Popup] Active tab:', activeTabId);

    // initial render without filter
    renderVideosList(allVideoItems, activeTabId, document.getElementById('filterInput')?.value || '');
  } catch (error) {
    console.error('[JumpKey Popup] Error querying tabs:', error);
  }
}

// Options button - open in new tab
document.getElementById('optionsBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
});

const headerRandomBtn = document.getElementById('headerRandomBtn');
if (headerRandomBtn) {
  headerRandomBtn.addEventListener('click', () => {
    headerRandomBtn.disabled = true;
    chrome.runtime.sendMessage({ action: 'switchRandomFromPopup' }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[JumpKey Popup] Error triggering random switch:', chrome.runtime.lastError.message);
      }
      window.close();
    });
  });
}

// Filter input: realtime filtering
const filterInput = document.getElementById('filterInput');
if (filterInput) {
  filterInput.addEventListener('input', (e) => {
    const q = e.target.value;
    // re-render using cached items
    renderVideosList(allVideoItems, null, q);
  });
}

// Save scroll position when user scrolls
const videosList = document.getElementById('videosList');
let scrollTimeout;
videosList.addEventListener('scroll', () => {
  // Debounce to avoid excessive storage writes
  clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    saveScrollPosition();
  }, 150);
});

// Load videos on popup open
loadVideos();
