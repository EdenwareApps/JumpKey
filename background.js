const SHORTS_QUERY = [
  "https://*.youtube.com/shorts/*",
  "https://youtube.com/shorts/*"
];

const LONG_VIDEO_QUERY = [
  "https://*.youtube.com/watch*",
  "https://youtube.com/watch*"
];

const SHORTS_HOME = "https://www.youtube.com/shorts";
const YOUTUBE_HOME = "https://www.youtube.com/";
const YOUTUBE_SUBSCRIPTIONS = "https://www.youtube.com/feed/subscriptions";
const WATCH_LATER_PLAYLIST = "https://www.youtube.com/playlist?list=WL";
const LIKED_VIDEOS_PLAYLIST = "https://www.youtube.com/playlist?list=LL";
const DURATION_WORKER_PAGE_URL = 'https://edenware.app/jumpkey/yd.html';
const DEFAULT_NEW_TAB_PAGE = getDefaultNewTabPageURL();
const MAX_HISTORY_ENTRIES = 2000;
const MAX_TAB_LOAD_CHECKS = 20;
const BADGE_UPDATE_DEBOUNCE_MS = 250;
const WL_CACHE_MIN_VIDEOS = 10;
const WL_CACHE_REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const WL_SEEN_VIDEOS_KEY = 'wlSeenVideos';
const WL_SEEN_RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const LIKED_SEEN_VIDEOS_KEY = 'likedSeenVideos';
const LIKED_CACHE_REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const HOME_CACHE_KEY = 'homeCache';
const HOME_SEEN_VIDEOS_KEY = 'homeSeenVideos';
const HOME_CACHE_REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const HOME_CACHE_MIN_VIDEOS = 10;
const VIDEO_DURATION_KEY = 'videoDurations';
const DURATION_FETCH_RETRY_MS = 30 * 60 * 1000; // wait 30 minutes before retrying the same missing duration
const lastDurationFetchAttemptById = new Map();
const lastLoadedTabUrlById = new Map();
let lastSyncMissingDurationsAt = 0; // timestamp of last missing duration sync task
const fullscreenRestoreStateByWindowId = new Map();
const windowsBeingRestored = new Set();
const pendingFullscreenWindowIds = new Set();
const windowOperationLocks = new Map();

// Cross-window focus suppression (avoid accidental focus return to old window)
let focusChangeSuppression = {
  oldWindowId: null,
  targetWindowId: null,
  expiresAt: 0
};

// Track last known window bounds/state to support restoring after fullscreen
const windowLastInfoById = new Map();

// Tab sync state for auto playlist sync tabs (opened by background sync)
const autoSyncPlaylistTabs = new Map(); // tabId => 'watchLater' | 'liked'
const playlistSyncWaiters = new Map(); // key tabId:source => resolver
const PLAYLIST_SYNC_PARAM_NAME = 'jumpkey_sync';
const PLAYLIST_SYNC_CONFIRM_KEY = 'playlistSyncConfirmed';

const DEFAULT_SETTINGS = {
  fullscreenOnSwitch: false,
  useWatchLater: true,
  useLikedVideos: false,
  sourceWatchLater: true,
  sourceLikedVideos: false,
  sourceShortsTabs: true,
  sourceWatchTabs: true,
  sourceHomeVideos: false,
  sourceHomeShorts: true,
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

function openWelcomePage() {
  try {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html'), active: true });
  } catch (err) {
    console.warn('[JumpKey BG] Failed to open welcome page:', err);
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details && details.reason === 'install') {
    openWelcomePage();
  }
});

function isShortsUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }
  return /^https:\/\/[^/]*youtube\.com\/shorts\/.+/.test(url);
}

function isLongVideoUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }
  return /^https:\/\/[^/]*youtube\.com\/watch\?/.test(url);
}
function isYoutubeUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }
  return /^https:\/\/[^/]*youtube\.com\//.test(url);
}

function getEmptyDestinationUrl(emptyDestination) {
  switch (emptyDestination) {
    case 'home':
      return YOUTUBE_HOME;
    case 'subscriptions':
      return YOUTUBE_SUBSCRIPTIONS;
    case 'watch-later':
      return WATCH_LATER_PLAYLIST;
    case 'shorts':
    default:
      return SHORTS_HOME;
  }
}

function getDurationSortValueForSwitch(item) {
  if (item && Number.isFinite(Number(item.duration)) && Number(item.duration) > 0) {
    return Number(item.duration);
  }

  const isShort = Boolean(
    (item && item.isShort) ||
    (item && item.type === 'short') ||
    (item && item.tab && isShortsUrl(item.tab.url))
  );

  if (isShort) {
    return 2 * 60;
  }
  return 20 * 60;
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

function updateTab(tabId, updateProperties) {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, updateProperties, (tab) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(tab);
    });
  });
}

function focusWindow(windowId) {
  return new Promise((resolve, reject) => {
    chrome.windows.update(windowId, { focused: true }, (win) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(win);
    });
  });
}

function getWindow(windowId) {
  return new Promise((resolve, reject) => {
    chrome.windows.get(windowId, (win) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(win);
    });
  });
}

function getTab(tabId) {
  return new Promise((resolve, reject) => {
    try {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve(tab);
      });
    } catch (err) {
      reject(err);
    }
  });
}

async function saveWindowBoundsBeforeFullscreen(windowId) {
  try {
    const currentWindow = await getWindow(windowId);
    if (!currentWindow || currentWindow.state === 'fullscreen') {
      return;
    }

    // Save whether window was maximized or normal, and the dimensions
    fullscreenRestoreStateByWindowId.set(windowId, {
      state: currentWindow.state === 'maximized' ? 'maximized' : 'normal',
      left: currentWindow.left,
      top: currentWindow.top,
      width: currentWindow.width,
      height: currentWindow.height
    });
  } catch (error) {
    console.warn('[JumpKey BG] Failed to save window bounds before fullscreen:', error);
  }
}

function restoreWindowAfterFullscreen(windowId) {
  console.log('[JumpKey BG] restoreWindowAfterFullscreen called for windowId:', windowId);

  const savedState = fullscreenRestoreStateByWindowId.get(windowId);
  if (!savedState || windowsBeingRestored.has(windowId)) {
    return;
  }

  windowsBeingRestored.add(windowId);

  let updateInfo;
  const availWidth = (typeof screen !== 'undefined' && screen.availWidth) ? screen.availWidth : 1920;
  const availHeight = (typeof screen !== 'undefined' && screen.availHeight) ? screen.availHeight : 1080;
  if (savedState.state === 'maximized') {
    updateInfo = {
      state: 'maximized'
    };
  } else {
    // Clamp dimensions to available screen size
    updateInfo = {
      state: 'normal',
      left: savedState.left,
      top: savedState.top,
      width: Math.min(savedState.width, availWidth),
      height: Math.min(savedState.height, availHeight)
    };
  }

  // Add delay to ensure the browser finishes transition before maximizing
  setTimeout(() => {
    chrome.windows.update(windowId, updateInfo, () => {
      if (chrome.runtime.lastError) {
        console.warn('[JumpKey BG] Failed to restore window after fullscreen:', chrome.runtime.lastError);
      }
      fullscreenRestoreStateByWindowId.delete(windowId);
      windowsBeingRestored.delete(windowId);
    });
  }, 250); // 250ms de delay
}

function removeTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.remove(tabId, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve();
    });
  });
}

async function ensureTabIsLoaded(tabId) {
  return new Promise((resolve) => {
    const checkTab = (attempt = 0) => {
      if (attempt >= MAX_TAB_LOAD_CHECKS) {
        console.warn('[JumpKey BG] Timeout waiting for tab load');
        resolve(false);
        return;
      }

      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          console.log('[JumpKey BG] Error checking tab:', chrome.runtime.lastError);
          resolve(false);
          return;
        }

        const tabUrl = typeof tab.url === 'string' ? tab.url : '';
        console.log('[JumpKey BG] Tab status:', tab.status, 'URL:', tabUrl);

        // If asleep or with error, reload
        if (tab.status === 'unloaded' || tabUrl.includes('chrome-error://') || tabUrl.includes('about:blank')) {
          console.log('[JumpKey BG] Tab asleep or with error, reloading...');
          chrome.tabs.reload(tabId, () => {
            if (chrome.runtime.lastError) {
              console.warn('[JumpKey BG] Error reloading tab:', chrome.runtime.lastError);
              resolve(false);
              return;
            }
            // Wait a bit and check again
            setTimeout(() => checkTab(attempt + 1), 1500);
          });
          return;
        }

        // If complete, resolve
        if (tab.status === 'complete') {
          const lastUrl = lastLoadedTabUrlById.get(tabId);
          if (tabUrl !== lastUrl) {
            console.log('[JumpKey BG] Tab loaded successfully', tabUrl);
            if (tabUrl) lastLoadedTabUrlById.set(tabId, tabUrl);
          }
          resolve(true);
          return;
        }

        if (lastLoadedTabUrlById.has(tabId) && tabUrl !== lastLoadedTabUrlById.get(tabId)) {
          lastLoadedTabUrlById.delete(tabId);
        }

        // If loading, wait a bit longer
        console.log('[JumpKey BG] Tab still loading, waiting...');
        setTimeout(() => checkTab(attempt + 1), 500);
      });
    };

    checkTab();
  });
}

async function sendMessageToTab(tabId, message, retries = 3) {
  console.log(`[JumpKey BG] ========== SENDING MESSAGE ==========`);
  console.log(`[JumpKey BG] Tab ID: ${tabId}`);
  console.log(`[JumpKey BG] Message:`, JSON.stringify(message));
  console.log(`[JumpKey BG] Retries: ${retries}`);
  try {
    try {
      const tabInfo = await getTab(tabId).catch(e => null);
      if (tabInfo) {
        console.log('[JumpKey BG] Target tab info before messaging:', { id: tabInfo.id, status: tabInfo.status, active: tabInfo.active, audible: tabInfo.audible, url: tabInfo.url });
      } else {
        console.log('[JumpKey BG] Could not retrieve tab info before messaging');
      }
    } catch (err) {
      console.warn('[JumpKey BG] getTab failed before sendMessage:', err);
    }

    return await new Promise((resolve) => {
      const attempt = (retriesLeft) => {
        console.log(`[JumpKey BG] Send attempt (${3 - retriesLeft + 1}/3)...`);
        chrome.tabs.sendMessage(tabId, message, (response) => {
          if (chrome.runtime.lastError) {
            const errorMsg = chrome.runtime.lastError.message || JSON.stringify(chrome.runtime.lastError);
            const isContextInvalidated = (typeof errorMsg === 'string' && errorMsg.includes('Extension context invalidated'));
            if (isContextInvalidated) {
              console.warn(`[JumpKey BG] Extension context invalidated for tab ${tabId}, aborting message send.`);
              resolve(false);
              return;
            }
            console.warn(`[JumpKey BG] ERROR sending message: ${errorMsg}`);
            if (retriesLeft > 0) {
              console.log(`[JumpKey BG] Waiting 200ms before retrying...`);
              setTimeout(() => attempt(retriesLeft - 1), 200);
            } else {
              console.error(`[JumpKey BG] CRITICAL FAILURE: Message not sent after ${retries} attempts`);
              resolve(false);
            }
          } else {
            console.log(`[JumpKey BG] ✓ SUCCESS: Message sent to tab ${tabId}`);
            try {
              console.log(`[JumpKey BG] Response: ${JSON.stringify(response)}`);
            } catch (err) {
              console.log('[JumpKey BG] Response (non-serializable):', response);
            }
            if (response === undefined || response === null) {
              resolve(true);
            } else {
              resolve(response);
            }
          }
        });
      };
      attempt(retries);
    });
  } catch (err) {
    console.error('[JumpKey BG] Unexpected error in sendMessageToTab:', err);
    return false;
  }
}

function getSettings() {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(items);
    });
  });
}

function getCurrentActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError || !Array.isArray(tabs) || tabs.length === 0) {
        resolve(null);
      } else {
        resolve(tabs[0]);
      }
    });
  });
}

function restoreActiveTab(tab) {
  if (!tab || !tab.id) return;
  chrome.tabs.update(tab.id, { active: true }, () => {
    if (chrome.runtime.lastError) {
      console.warn('[JumpKey BG] Failed to restore active tab:', chrome.runtime.lastError);
    }
  });
}

function getPlaylistSyncConfirmation() {
  return new Promise((resolve) => {
    chrome.storage.local.get([PLAYLIST_SYNC_CONFIRM_KEY], (result) => {
      if (chrome.runtime.lastError) {
        console.warn('[JumpKey BG] Error reading playlist sync confirmation:', chrome.runtime.lastError);
        resolve(false);
        return;
      }
      resolve(Boolean(result[PLAYLIST_SYNC_CONFIRM_KEY]));
    });
  });
}

function setPlaylistSyncConfirmation(value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [PLAYLIST_SYNC_CONFIRM_KEY]: Boolean(value) }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[JumpKey BG] Error setting playlist sync confirmation:', chrome.runtime.lastError);
      }
      resolve();
    });
  });
}

async function closeStalePlaylistSyncTabs() {
  try {
    const tabs = await queryTabs({ url: ['https://www.youtube.com/playlist?list=WL*', 'https://www.youtube.com/playlist?list=LL*'] });
    for (const tab of tabs) {
      if (!tab || !tab.id || !tab.url) continue;
      if (tab.url.includes(`${PLAYLIST_SYNC_PARAM_NAME}=watchLater`) || tab.url.includes(`${PLAYLIST_SYNC_PARAM_NAME}=liked`)) {
        console.log('[JumpKey BG] Closing stale playlist sync tab:', tab.id, tab.url);
        await removeTab(tab.id).catch((err) => {
          console.warn('[JumpKey BG] Failed to remove stale sync tab:', tab.id, err);
        });
      }
    }
  } catch (err) {
    console.warn('[JumpKey BG] closeStalePlaylistSyncTabs failed:', err);
  }
}

// ============================================================
// 🎬 WATCH LATER CACHE MANAGEMENT
// ============================================================

/**
 * Get Watch Later video cache from storage
 * @returns {Promise<{videoIds: string[], videos: Array<{videoId: string, title: string, tags: string[]}>, lastSync: number}>}
 */
function getWatchLaterCache() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['wlCache'], (result) => {
      if (chrome.runtime.lastError) {
        console.warn('[JumpKey BG] Error getting WL cache:', chrome.runtime.lastError);
        resolve({ videoIds: [], videos: [], lastSync: 0 });
        return;
      }
      const rawCache = result.wlCache || {};
      const rawVideos = Array.isArray(rawCache.videos)
        ? rawCache.videos
        : Array.isArray(rawCache.videoIds)
          ? rawCache.videoIds.map((videoId) => ({ videoId, title: 'Unknown', tags: [] }))
          : [];

      const normalizedVideos = [];
      const seenVideoIds = new Set();

      for (const item of rawVideos) {
        if (!item) {
          continue;
        }

        const videoId = typeof item === 'string' ? item : item.videoId;
        if (!videoId || seenVideoIds.has(videoId)) {
          continue;
        }

        seenVideoIds.add(videoId);
        normalizedVideos.push({
          videoId,
          title: typeof item === 'string' ? 'Unknown' : (item.title || 'Unknown'),
          tags: Array.isArray(item.tags) ? item.tags : [],
          duration: Number.isFinite(Number(item.duration)) ? Number(item.duration) : null,
          isShort: typeof item === 'object' ? Boolean(item.isShort) : false
        });
      }

      resolve({
        videoIds: normalizedVideos.map((video) => video.videoId),
        videos: normalizedVideos,
        lastSync: Number(rawCache.lastSync) || 0
      });
    });
  });
}

/**
 * Save Watch Later video cache to storage
 * @param {Array<{videoId: string, title?: string, tags?: string[]}>|string[]} videos - Array of video IDs or video objects
 */
function setWatchLaterCache(videos) {
  return new Promise((resolve) => {
    const sourceVideos = Array.isArray(videos) ? videos : [];
    const normalizedVideos = [];
    const seenVideoIds = new Set();

    for (const item of sourceVideos) {
      if (!item) {
        continue;
      }

      const videoId = typeof item === 'string' ? item : item.videoId;
      if (!videoId || seenVideoIds.has(videoId)) {
        continue;
      }

      seenVideoIds.add(videoId);
      normalizedVideos.push({
        videoId,
        title: typeof item === 'string' ? 'Unknown' : (item.title || 'Unknown'),
        tags: Array.isArray(item.tags) ? item.tags : [],
        duration: Number.isFinite(Number(item.duration)) ? Number(item.duration) : null,
        isShort: typeof item === 'object' ? Boolean(item.isShort) : false
      });
    }

    const cache = {
      videoIds: normalizedVideos.map((video) => video.videoId),
      videos: normalizedVideos,
      lastSync: Date.now()
    };
    chrome.storage.local.set({ wlCache: cache }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[JumpKey BG] Error saving WL cache:', chrome.runtime.lastError);
      }
      console.log('[JumpKey BG] WL cache saved:', cache.videoIds.length, 'videos');
      resolve();
    });
  });
}

function getLikedVideosCache() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['likedCache'], (result) => {
      if (chrome.runtime.lastError) {
        console.warn('[JumpKey BG] Error getting liked cache:', chrome.runtime.lastError);
        resolve({ videoIds: [], videos: [], lastSync: 0 });
        return;
      }

      const rawCache = result.likedCache || {};
      const rawVideos = Array.isArray(rawCache.videos)
        ? rawCache.videos
        : [];

      const normalizedVideos = [];
      const seenVideoIds = new Set();

      for (const item of rawVideos) {
        if (!item || !item.videoId || seenVideoIds.has(item.videoId)) {
          continue;
        }

        seenVideoIds.add(item.videoId);
        normalizedVideos.push({
          videoId: item.videoId,
          title: item.title || 'Unknown',
          tags: Array.isArray(item.tags) ? item.tags : [],
          duration: Number.isFinite(Number(item.duration)) ? Number(item.duration) : null
        });
      }

      resolve({
        videoIds: normalizedVideos.map((video) => video.videoId),
        videos: normalizedVideos,
        lastSync: Number(rawCache.lastSync) || 0
      });
    });
  });
}

function setLikedVideosCache(videos) {
  return new Promise((resolve) => {
    const sourceVideos = Array.isArray(videos) ? videos : [];
    const normalizedVideos = [];
    const seenVideoIds = new Set();

    for (const item of sourceVideos) {
      if (!item) {
        continue;
      }

      const videoId = typeof item === 'string' ? item : item.videoId;
      if (!videoId || seenVideoIds.has(videoId)) {
        continue;
      }

      seenVideoIds.add(videoId);
      normalizedVideos.push({
        videoId,
        title: typeof item === 'string' ? 'Unknown' : (item.title || 'Unknown'),
        tags: Array.isArray(item.tags) ? item.tags : [],
        duration: Number.isFinite(Number(item.duration)) ? Number(item.duration) : null,
        isShort: typeof item === 'object' ? Boolean(item.isShort) : false
      });
    }

    const cache = {
      videoIds: normalizedVideos.map((video) => video.videoId),
      videos: normalizedVideos,
      lastSync: Date.now()
    };

    chrome.storage.local.set({ likedCache: cache }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[JumpKey BG] Error saving liked cache:', chrome.runtime.lastError);
      }
      console.log('[JumpKey BG] Liked cache saved:', cache.videoIds.length, 'videos');
      resolve();
    });
  });
}

async function needsLikedCacheRefresh() {
  const cache = await getLikedVideosCache();

  if (cache.videoIds.length === 0) {
    return true;
  }

  const timeSinceLastSync = Date.now() - cache.lastSync;
  return timeSinceLastSync > LIKED_CACHE_REFRESH_INTERVAL;
}

function getDurationForSort(video) {
  if (video && Number.isFinite(Number(video.duration)) && Number(video.duration) > 0) {
    return Number(video.duration);
  }

  const isShort = video && Boolean(video.isShort);
  return isShort ? 2 * 60 : 20 * 60;
}

async function getRandomLikedVideoFromCache(excludeIds = new Set()) {
  const cache = await getLikedVideosCache();
  if (!cache.videos.length) return null;

  const globalSeen = await getAllSeenVideoIds();
  let availableVideos = cache.videos.filter((v) => v && v.videoId && !globalSeen.has(v.videoId) && !excludeIds.has(v.videoId));

  if (availableVideos.length === 0) {
    // Reset seen liked videos so we can reuse the list
    console.log('[JumpKey BG] No unseen liked videos left — resetting seen liked list');
    await setSeenLikedVideos({});
    availableVideos = cache.videos.filter((v) => v && v.videoId && !excludeIds.has(v.videoId));
  }

  if (availableVideos.length === 0) return null;

  const snoozedIds = await getPopupSnoozedVideoIds();

  // Prefer non-snoozed + shortest by duration
  availableVideos.sort((a, b) => {
    const aSnoozed = snoozedIds.has(a.videoId);
    const bSnoozed = snoozedIds.has(b.videoId);
    if (aSnoozed !== bSnoozed) return aSnoozed ? 1 : -1;
    const da = getDurationForSort(a);
    const db = getDurationForSort(b);
    if (da !== db) return da - db;
    return 0;
  });

  // Always pick the shortest candidate after sorting
  const chosen = availableVideos[0];

  if (chosen && chosen.videoId) {
    await markLikedVideoAsSeen(chosen.videoId);
    if (chosen.duration) await storeVideoDuration(chosen.videoId, chosen.duration);
  }

  return chosen || null;
}

function getPlaylistExtractionFunction() {
  return async () => {
    const getText = (value) => {
      if (!value) return '';
      if (typeof value === 'string') return value;
      if (typeof value.simpleText === 'string') return value.simpleText;
      if (Array.isArray(value.runs)) {
        return value.runs.map((run) => run?.text || '').join('').trim();
      }
      return '';
    };

    const videos = [];
    const seen = new Set();
    const addVideo = (videoId, title, durationSec, isShort = false) => {
      if (!videoId || seen.has(videoId)) {
        return;
      }
      seen.add(videoId);
      videos.push({
        videoId,
        title: title || 'Unknown',
        duration: Number.isFinite(Number(durationSec)) && durationSec > 0 ? Number(durationSec) : null,
        isShort: Boolean(isShort)
      });
    };

    try {
      // Try to progressively scroll playlist container to load more items
      try {
        const container = document.querySelector('ytd-playlist-video-list-renderer, ytd-section-list-renderer, ytd-item-section-renderer, #contents');
        if (container) {
          for (let i = 0; i < 25; i++) {
            try { container.scrollTop = container.scrollHeight; } catch (e) { break; }
            // give time for lazy load
            await new Promise((r) => setTimeout(r, 400));
          }
        }
      } catch (e) {
        // ignore scroll failures
      }
      // Method 1: JSON data embedded in page scripts
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent || '';
        if (!text.includes('ytInitialData')) {
          continue;
        }

        const regexes = [
          /var ytInitialData\s*=\s*({[\s\S]*?});/,
          /window\["ytInitialData"\]\s*=\s*({[\s\S]*?});/
        ];

        for (const regex of regexes) {
          const match = text.match(regex);
          if (!match || !match[1]) {
            continue;
          }

          const data = JSON.parse(match[1]);
          const contents = data?.contents?.twoColumnBrowseResultsRenderer?.tabs;
          if (!Array.isArray(contents)) {
            continue;
          }

          for (const tab of contents) {
            const sectionContents = tab?.tabRenderer?.content?.sectionListRenderer?.contents || [];
            for (const section of sectionContents) {
              const items = section?.itemSectionRenderer?.contents || [];
              for (const item of items) {
                const listItems = item?.playlistVideoListRenderer?.contents || [];
                for (const entry of listItems) {
                  const renderer = entry?.playlistVideoRenderer;
                  const title = getText(renderer?.title);
                  const durationText = renderer?.lengthText?.simpleText || (renderer?.lengthText?.runs ? renderer.lengthText.runs.map((r) => r.text).join('').trim() : '');
                  const parsedDuration = parseDurationText(durationText);
                  const videoUrl = renderer?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url || '';
                  const isShort = videoUrl.includes('/shorts/');
                  addVideo(renderer?.videoId, title, parsedDuration, isShort);
                }
              }
            }
          }
        }
      }

      // Method 2: DOM fallback
      const videoElements = document.querySelectorAll('ytd-playlist-video-renderer');
      for (const el of videoElements) {
        const link = el.querySelector('a#video-title');
        if (!link || !link.href) {
          continue;
        }

        const watchMatch = link.href.match(/[?&]v=([^&]+)/);
        const shortsMatch = link.href.match(/\/shorts\/([^/?&]+)/);
        const videoId = watchMatch?.[1] || shortsMatch?.[1] || null;

        if (videoId) {
          const durationElem = el.querySelector('ytd-thumbnail-overlay-time-status-renderer span') || el.querySelector('span.ytd-thumbnail-overlay-time-status-renderer');
          const durationText = durationElem ? (durationElem.textContent || '').trim() : '';
          const parsedDuration = parseDurationText(durationText);
          const isShort = link.href.includes('/shorts/');
          const title = (link.textContent || '').trim();
          addVideo(videoId, title, parsedDuration, isShort);
        }
      }

      if (videos.length > 0) {
        return { success: true, videos, method: 'ytInitialData/DOM' };
      }

      return { success: false, error: 'No videos found' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };
}

function generatePlaylistSyncKey(tabId, source) {
  return `${tabId}:${source}`;
}

function waitForPlaylistSyncData(tabId, source, timeoutMs = 14000) {
  const key = generatePlaylistSyncKey(tabId, source);
  return new Promise((resolve) => {
    if (playlistSyncWaiters.has(key)) {
      playlistSyncWaiters.delete(key);
    }

    const timer = setTimeout(() => {
      if (playlistSyncWaiters.has(key)) {
        playlistSyncWaiters.delete(key);
      }
      resolve(null);
    }, timeoutMs);

    playlistSyncWaiters.set(key, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function cleanupSeenWLVideos(seenVideos, now = Date.now()) {
  const source = seenVideos && typeof seenVideos === 'object' ? seenVideos : {};
  const cleaned = {};

  for (const [videoId, timestamp] of Object.entries(source)) {
    if (!videoId) {
      continue;
    }

    const parsedTimestamp = Number(timestamp);
    if (Number.isFinite(parsedTimestamp) && parsedTimestamp > 0 && (now - parsedTimestamp) <= WL_SEEN_RETENTION_MS) {
      cleaned[videoId] = parsedTimestamp;
    }
  }

  return cleaned;
}

function getSeenWLVideos() {
  return new Promise((resolve) => {
    chrome.storage.local.get([WL_SEEN_VIDEOS_KEY], (result) => {
      if (chrome.runtime.lastError) {
        console.warn('[JumpKey BG] Error getting seen WL videos:', chrome.runtime.lastError);
        resolve({});
        return;
      }

      const cleaned = cleanupSeenWLVideos(result[WL_SEEN_VIDEOS_KEY]);
      resolve(cleaned);
    });
  });
}

function setSeenWLVideos(seenVideos) {
  return new Promise((resolve) => {
    const cleaned = cleanupSeenWLVideos(seenVideos);
    chrome.storage.local.set({ [WL_SEEN_VIDEOS_KEY]: cleaned }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[JumpKey BG] Error saving seen WL videos:', chrome.runtime.lastError);
      }
      resolve(cleaned);
    });
  });
}

async function markWLVideoAsSeen(videoId) {
  if (!videoId) {
    return;
  }

  const seen = await getSeenWLVideos();
  seen[videoId] = Date.now();
  await setSeenWLVideos(seen);
}

function cleanupSeenLikedVideos(seenVideos, now = Date.now()) {
  const source = seenVideos && typeof seenVideos === 'object' ? seenVideos : {};
  const cleaned = {};

  for (const [videoId, timestamp] of Object.entries(source)) {
    if (!videoId) continue;
    const parsedTimestamp = Number(timestamp);
    if (Number.isFinite(parsedTimestamp) && parsedTimestamp > 0 && (now - parsedTimestamp) <= WL_SEEN_RETENTION_MS) {
      cleaned[videoId] = parsedTimestamp;
    }
  }

  return cleaned;
}

function getSeenLikedVideos() {
  return new Promise((resolve) => {
    chrome.storage.local.get([LIKED_SEEN_VIDEOS_KEY], (result) => {
      if (chrome.runtime.lastError) {
        console.warn('[JumpKey BG] Error getting seen liked videos:', chrome.runtime.lastError);
        resolve({});
        return;
      }

      const cleaned = cleanupSeenLikedVideos(result[LIKED_SEEN_VIDEOS_KEY]);
      resolve(cleaned);
    });
  });
}

function setSeenLikedVideos(seenVideos) {
  return new Promise((resolve) => {
    const cleaned = cleanupSeenLikedVideos(seenVideos);
    chrome.storage.local.set({ [LIKED_SEEN_VIDEOS_KEY]: cleaned }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[JumpKey BG] Error saving seen liked videos:', chrome.runtime.lastError);
      }
      resolve(cleaned);
    });
  });
}

async function markLikedVideoAsSeen(videoId) {
  if (!videoId) return;
  const seen = await getSeenLikedVideos();
  seen[videoId] = Date.now();
  await setSeenLikedVideos(seen);
}

// ==============================
// Home feed random videos cache
// ==============================

function getHomeCache() {
  return new Promise((resolve) => {
    chrome.storage.local.get([HOME_CACHE_KEY], (result) => {
      if (chrome.runtime.lastError) {
        console.warn('[JumpKey BG] Error getting Home cache:', chrome.runtime.lastError);
        resolve({ videoIds: [], videos: [], lastSync: 0 });
        return;
      }

      const rawCache = result[HOME_CACHE_KEY] || {};
      const rawVideos = Array.isArray(rawCache.videos) ? rawCache.videos : [];
      const normalizedVideos = [];
      const seenVideoIds = new Set();

      for (const item of rawVideos) {
        if (!item) continue;
        const videoId = typeof item === 'string' ? item : item.videoId;
        if (!videoId || seenVideoIds.has(videoId)) continue;
        seenVideoIds.add(videoId);
        normalizedVideos.push({
          videoId,
          title: typeof item === 'string' ? 'Unknown' : (item.title || 'Unknown'),
          tags: Array.isArray(item.tags) ? item.tags : [],
          duration: Number.isFinite(Number(item.duration)) ? Number(item.duration) : null,
          isShort: typeof item === 'object' ? Boolean(item.isShort) : false
        });
      }

      resolve({ videoIds: normalizedVideos.map(v => v.videoId), videos: normalizedVideos, lastSync: Number(rawCache.lastSync) || 0 });
    });
  });
}

function setHomeCache(videos) {
  return new Promise((resolve) => {
    const sourceVideos = Array.isArray(videos) ? videos : [];
    const normalizedVideos = [];
    const seenVideoIds = new Set();

    for (const item of sourceVideos) {
      if (!item) continue;
      const videoId = typeof item === 'string' ? item : item.videoId;
      if (!videoId || seenVideoIds.has(videoId)) continue;
      seenVideoIds.add(videoId);
      normalizedVideos.push({
        videoId,
        title: typeof item === 'string' ? 'Unknown' : (item.title || 'Unknown'),
        tags: Array.isArray(item.tags) ? item.tags : [],
        duration: Number.isFinite(Number(item.duration)) ? Number(item.duration) : null
      });
    }

    const cache = { videoIds: normalizedVideos.map(v => v.videoId), videos: normalizedVideos, lastSync: Date.now() };
    chrome.storage.local.set({ [HOME_CACHE_KEY]: cache }, () => {
      if (chrome.runtime.lastError) console.warn('[JumpKey BG] Error saving Home cache:', chrome.runtime.lastError);
      console.log('[JumpKey BG] Home cache saved:', cache.videoIds.length, 'videos');
      resolve();
    });
  });
}

function getSeenHomeVideos() {
  return new Promise((resolve) => {
    chrome.storage.local.get([HOME_SEEN_VIDEOS_KEY], (result) => {
      if (chrome.runtime.lastError) {
        console.warn('[JumpKey BG] Error getting seen Home videos:', chrome.runtime.lastError);
        resolve({});
        return;
      }
      const cleaned = cleanupSeenWLVideos(result[HOME_SEEN_VIDEOS_KEY]);
      resolve(cleaned);
    });
  });
}

function setSeenHomeVideos(seenVideos) {
  return new Promise((resolve) => {
    const cleaned = cleanupSeenWLVideos(seenVideos);
    chrome.storage.local.set({ [HOME_SEEN_VIDEOS_KEY]: cleaned }, () => {
      if (chrome.runtime.lastError) console.warn('[JumpKey BG] Error saving seen Home videos:', chrome.runtime.lastError);
      resolve(cleaned);
    });
  });
}

async function markHomeVideoAsSeen(videoId) {
  if (!videoId) return;
  const seen = await getSeenHomeVideos();
  seen[videoId] = Date.now();
  await setSeenHomeVideos(seen);
}

async function needsHomeCacheRefresh() {
  const cache = await getHomeCache();
  if (cache.videoIds.length === 0) return true;
  const timeSinceLastSync = Date.now() - cache.lastSync;
  return timeSinceLastSync > HOME_CACHE_REFRESH_INTERVAL;
}

// Popup snoozed videos (temporary suppression during popup session)
const POPUP_SNOOZED_KEY = 'popupSnoozedVideos';

function cleanupPopupSnoozedVideos(data = {}) {
  const now = Date.now();
  const result = {};
  for (const [videoId, expiry] of Object.entries(data || {})) {
    if (!videoId) continue;
    const parsed = Number(expiry);
    if (Number.isFinite(parsed) && parsed > now) {
      result[videoId] = parsed;
    }
  }
  return result;
}

function getPopupSnoozedVideos() {
  return new Promise((resolve) => {
    chrome.storage.local.get([POPUP_SNOOZED_KEY], (result) => {
      if (chrome.runtime.lastError) {
        console.warn('[JumpKey BG] Error getting popup snoozed videos:', chrome.runtime.lastError);
        resolve({});
        return;
      }
      const raw = result[POPUP_SNOOZED_KEY] || {};
      const cleaned = cleanupPopupSnoozedVideos(raw);
      // Persist cleanup
      if (Object.keys(cleaned).length !== Object.keys(raw).length) {
        chrome.storage.local.set({ [POPUP_SNOOZED_KEY]: cleaned });
      }
      resolve(cleaned);
    });
  });
}

function setPopupSnoozedVideo(videoId, expiresAt) {
  if (!videoId) return Promise.resolve();
  return new Promise((resolve) => {
    getPopupSnoozedVideos().then((current) => {
      const updated = { ...current, [videoId]: expiresAt };
      chrome.storage.local.set({ [POPUP_SNOOZED_KEY]: updated }, () => {
        if (chrome.runtime.lastError) {
          console.warn('[JumpKey BG] Error saving popup snoozed videos:', chrome.runtime.lastError);
        }
        resolve();
      });
    });
  });
}

async function findTabForVideo(videoId) {
  if (!videoId) return null;
  const tabs = await new Promise((res) => chrome.tabs.query({ url: ['*://*.youtube.com/*', '*://youtube.com/*'] }, (t) => res(t || [])));
  for (const tab of tabs || []) {
    if (!tab || !tab.url) continue;
    if (tab.url.indexOf(`watch?v=${videoId}`) !== -1 || tab.url.indexOf(`/shorts/${videoId}`) !== -1) {
      return tab;
    }
  }
  return null;
}

async function ensureTemporaryTabForVideo(videoId) {
  if (!videoId) return { tabId: null, created: false };
  const existing = await findTabForVideo(videoId);
  if (existing && existing.id) {
    return { tabId: existing.id, created: false };
  }

  const created = await new Promise((res) => chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${videoId}`, active: false }, res));
  if (!created || !created.id) {
    return { tabId: null, created: false };
  }
  await sleep(1200);
  await ensureTabIsLoaded(created.id).catch(() => false);
  return { tabId: created.id, created: true };
}

async function createDurationWorkerTab() {
  const existingWorkerTabs = await new Promise((res) => chrome.tabs.query({ url: [`${DURATION_WORKER_PAGE_URL}*`] }, (tabs) => res(tabs || [])));
  if (existingWorkerTabs.length && existingWorkerTabs[0] && existingWorkerTabs[0].id) {
    return existingWorkerTabs[0].id;
  }

  const tab = await new Promise((res) => chrome.tabs.create({ url: DURATION_WORKER_PAGE_URL, active: false, muted: true }, res));
  if (!tab || !tab.id) return null;
  await sleep(1200);
  await ensureTabIsLoaded(tab.id).catch(() => false);
  return tab.id;
}

async function processDurationsWithLightWorker(tabId, videoIds) {
  if (!tabId || !Array.isArray(videoIds) || !videoIds.length) {
    return null;
  }

  const ping = await sendMessageToTab(tabId, { action: 'durationWorkerPing' }, 2);
  if (!ping || ping === false || ping.ok !== true) {
    console.warn('[JumpKey BG] duration worker ping failed:', ping);
    return null;
  }
  console.log('[JumpKey BG] duration worker ping ok');

  const response = await sendMessageToTab(tabId, { action: 'durationWorkerProcess', videoIds }, 2);
  if (!response || response === false || response.ok !== true || !response.results) {
    console.warn('[JumpKey BG] duration worker process failed:', response);
    return null;
  }

  return response.results;
}

async function syncMissingDurationsViaYoutubePages(videoIds) {
  let fetched = 0;

  for (const videoId of videoIds) {
    try {
      console.log(`[JumpKey BG] syncMissingDurations fallback: processing ${videoId}`);
      const { tabId, created } = await ensureTemporaryTabForVideo(videoId);
      if (!tabId) {
        console.warn('[JumpKey BG] syncMissingDurations fallback: no tab created for', videoId);
        lastDurationFetchAttemptById.set(videoId, Date.now());
        continue;
      }

      const loaded = await ensureTabIsLoaded(tabId);
      if (!loaded) {
        console.warn('[JumpKey BG] syncMissingDurations fallback: tab did not load', tabId, videoId);
        if (created) await removeTab(tabId);
        lastDurationFetchAttemptById.set(videoId, Date.now());
        continue;
      }

      const duration = await getDurationFromTab({ id: tabId, url: `https://www.youtube.com/watch?v=${videoId}` });
      console.log(`[JumpKey BG] syncMissingDurations fallback: duration for ${videoId} = ${duration}`);
      if (duration && duration > 0) {
        await storeVideoDuration(videoId, duration);
        fetched += 1;
        lastDurationFetchAttemptById.delete(videoId);
      } else {
        lastDurationFetchAttemptById.set(videoId, Date.now());
      }

      if (created) {
        await removeTab(tabId);
      }
    } catch (err) {
      console.warn('[JumpKey BG] syncMissingDurations fallback error for', videoId, err);
      lastDurationFetchAttemptById.set(videoId, Date.now());
    }

    await sleep(250);
  }

  return fetched;
}

async function ensureTabForVideo(videoId) {
  if (!videoId) return null;
  const existing = await findTabForVideo(videoId);
  if (existing && existing.id) return existing.id;

  const created = await new Promise((res) => chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${videoId}`, active: false }, res));
  await sleep(1200);
  await ensureTabIsLoaded(created.id).catch(() => false);
  return created.id;
}

async function getRandomHomeVideoFromCache(excludeIds = new Set()) {
  const cache = await getHomeCache();
  if (!cache.videos.length) return null;

  const globalSeen = await getAllSeenVideoIds();
  let availableVideos = cache.videos.filter((v) => v && v.videoId && !globalSeen.has(v.videoId) && !excludeIds.has(v.videoId));

  if (availableVideos.length === 0) {
    console.log('[JumpKey BG] No unseen Home videos left — resetting seen Home list');
    await setSeenHomeVideos({});
    availableVideos = cache.videos.filter((v) => v && v.videoId && !excludeIds.has(v.videoId));
  }
  if (availableVideos.length === 0) {
    console.log('[JumpKey BG] Home cache still has no eligible videos after reset');
    return null;
  }

  const snoozedIds = await getPopupSnoozedVideoIds();

  availableVideos.sort((a, b) => {
    const aSnoozed = snoozedIds.has(a.videoId);
    const bSnoozed = snoozedIds.has(b.videoId);
    if (aSnoozed !== bSnoozed) return aSnoozed ? 1 : -1;
    const da = getDurationForSort(a);
    const db = getDurationForSort(b);
    if (da !== db) return da - db;
    return 0;
  });

  const chosen = availableVideos[0];

  if (!chosen || !chosen.videoId) return null;

  await markHomeVideoAsSeen(chosen.videoId);
  const remaining = cache.videos.filter(v => v.videoId !== chosen.videoId);
  await setHomeCache(remaining);
  if (remaining.length < HOME_CACHE_MIN_VIDEOS) {
    setTimeout(() => syncHomeRandom(true), 1000);
  }

  if (chosen.duration) await storeVideoDuration(chosen.videoId, chosen.duration);
  return chosen;
}

async function syncHomeRandom(background = false) {
  try {
    if (!background) console.log('[JumpKey BG] Starting Home feed sync...');
    const tab = await new Promise((resolve) => {
      chrome.tabs.create({ url: YOUTUBE_HOME, active: false }, resolve);
    });
    await new Promise(res => setTimeout(res, 3000));
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: getPlaylistExtractionFunction() });
    await removeTab(tab.id);
    if (results && results[0] && results[0].result) {
      const result = results[0].result;
      if (result.success && Array.isArray(result.videos) && result.videos.length > 0) {
        await setHomeCache(result.videos);
        console.log('[JumpKey BG] ✓ Home sync successful:', result.videos.length, 'videos extracted using', result.method);
        return true;
      }
      console.warn('[JumpKey BG] ✗ Home sync failed:', result.error);
      return false;
    }
    console.warn('[JumpKey BG] ✗ Home sync failed: No results');
    return false;
  } catch (error) {
    console.error('[JumpKey BG] Error syncing Home feed:', error);
    return false;
  }
}

/**
 * Get a random video from WL cache and remove it
 * @returns {Promise<string|null>} Video ID or null if cache is empty
 */
async function getRandomVideoFromWLCache(excludeIds = new Set()) {
  const cache = await getWatchLaterCache();
  
  if (cache.videoIds.length === 0) {
    console.log('[JumpKey BG] WL cache is empty');
    return null;
  }

  const globalSeen = await getAllSeenVideoIds();
  let availableVideos = cache.videos.filter((video) => video && video.videoId && !globalSeen.has(video.videoId) && !excludeIds.has(video.videoId));

  if (availableVideos.length === 0) {
    console.log('[JumpKey BG] WL cache has only recently seen videos (90 days), resetting seen stores to allow a new cycle');
    await setSeenWLVideos({});
    availableVideos = cache.videos.filter((video) => video && video.videoId && !excludeIds.has(video.videoId));
  }

  if (availableVideos.length === 0) {
    console.log('[JumpKey BG] WL cache still has no eligible videos after reset, giving up');
    return null;
  }

  const snoozedIds = await getPopupSnoozedVideoIds();

  availableVideos.sort((a, b) => {
    const aSnoozed = snoozedIds.has(a.videoId);
    const bSnoozed = snoozedIds.has(b.videoId);
    if (aSnoozed !== bSnoozed) return aSnoozed ? 1 : -1;
    const da = getDurationForSort(a);
    const db = getDurationForSort(b);
    if (da !== db) return da - db;
    return 0;
  });

  const selected = availableVideos[0];
  const videoId = selected.videoId;

  const remainingVideos = cache.videos.filter((video) => video.videoId !== videoId);
  await setWatchLaterCache(remainingVideos);
  await markWLVideoAsSeen(videoId);

  if (selected.duration) await storeVideoDuration(videoId, selected.duration);

  console.log('[JumpKey BG] Got WL video by shortest/weighted:', videoId, '- Remaining:', remainingVideos.length);

  if (remainingVideos.length < WL_CACHE_MIN_VIDEOS) {
    console.log('[JumpKey BG] WL cache running low, triggering background sync...');
    setTimeout(() => syncWatchLater(true), 1000);
  }

  return videoId;
}

/**
 * Check if WL cache needs refresh
 * @returns {Promise<boolean>}
 */
async function needsWLCacheRefresh() {
  const cache = await getWatchLaterCache();
  
  // Refresh if empty or too old
  if (cache.videoIds.length === 0) {
    return true;
  }
  
  const timeSinceLastSync = Date.now() - cache.lastSync;
  if (timeSinceLastSync > WL_CACHE_REFRESH_INTERVAL) {
    console.log('[JumpKey BG] WL cache is old (', Math.floor(timeSinceLastSync / 1000 / 60 / 60), 'hours), needs refresh');
    return true;
  }
  
  return false;
}

/**
 * Sync Watch Later playlist by opening tab in background and extracting video IDs
 * @param {boolean} background - If true, runs silently without user notification
 */
async function syncWatchLater(background = false) {
  let previousTab = null;
  let tab = null;

  try {
    previousTab = await getCurrentActiveTab();
    const settings = await getSettings();
    if (!settings.sourceWatchLater) {
      if (!background) {
        console.log('[JumpKey BG] sourceWatchLater disabled — skipping Watch Later sync');
      }
      return false;
    }

    if (!background) {
      console.log('[JumpKey BG] Starting Watch Later sync...');
    }
    
    // Create hidden tab with WL playlist and a fingerprint so content script can answer quickly
    // use hash fragment for JumpKey sync marker to avoid YouTube redirection stripping query params
    const syncTabUrl = WATCH_LATER_PLAYLIST + `#${PLAYLIST_SYNC_PARAM_NAME}=watchLater`;
    tab = await new Promise((resolve) => {
      chrome.tabs.create({
        url: syncTabUrl,
        active: false
      }, resolve);
    });

    if (tab && tab.id) {
      autoSyncPlaylistTabs.set(tab.id, 'watchLater');
    }

    let result = null;

    if (tab && tab.id) {
      const syncMessage = await waitForPlaylistSyncData(tab.id, 'watchLater', 12000);
      if (syncMessage && syncMessage.success && Array.isArray(syncMessage.videos)) {
        result = { success: true, videos: syncMessage.videos, method: syncMessage.method || 'content-script' };
      } else {
        console.log('[JumpKey BG] Watch Later auto-sync not available or timeout, falling back to script injection');
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const injectResults = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: getPlaylistExtractionFunction()
        });

        if (injectResults && injectResults[0] && injectResults[0].result) {
          result = injectResults[0].result;
        }
      }
    }

    // Process results
    if (result && result.success) {
      const videos = Array.isArray(result.videos) ? result.videos : [];
      const seenWLVideos = await getSeenWLVideos();
      const seenIds = new Set(Object.keys(seenWLVideos));
      const uniqueVideos = [];
      const uniqueIds = new Set();

      for (const video of videos) {
        const videoId = video?.videoId;
        if (!videoId || uniqueIds.has(videoId)) {
          continue;
        }
        uniqueIds.add(videoId);
        uniqueVideos.push({
          videoId,
          title: video.title || 'Unknown',
          tags: Array.isArray(video.tags) ? video.tags : [],
          duration: Number.isFinite(Number(video.duration)) && video.duration > 0 ? Number(video.duration) : null
        });
      }

      const filteredVideos = uniqueVideos.filter((video) => !seenIds.has(video.videoId));
      await setWatchLaterCache(filteredVideos);
      console.log('[JumpKey BG] ✓ WL sync successful:', videos.length, 'videos extracted using', result.method, '| available after 90d filter:', filteredVideos.length);
      return true;
    }

    console.warn('[JumpKey BG] ✗ WL sync failed: No results');
    return false;
  } catch (error) {
    console.error('[JumpKey BG] Error syncing Watch Later:', error);
    return false;
  } finally {
    if (tab && tab.id) {
      autoSyncPlaylistTabs.delete(tab.id);
      await removeTab(tab.id).catch((err) => {
        console.warn('[JumpKey BG] Failed to close watch later sync tab:', err);
      });
    }
    if (previousTab && previousTab.id && (!tab || tab.id !== previousTab.id)) {
      restoreActiveTab(previousTab);
    }
  }
}

async function syncLikedVideos(background = false) {
  let previousTab = null;
  let tab = null;

  try {
    previousTab = await getCurrentActiveTab();
    const settings = await getSettings();
    if (!settings.sourceLikedVideos) {
      if (!background) {
        console.log('[JumpKey BG] sourceLikedVideos disabled — skipping Liked Videos sync');
      }
      return false;
    }

    if (!background) {
      console.log('[JumpKey BG] Starting Liked Videos sync...');
    }

    // use hash fragment for JumpKey sync marker to avoid YouTube redirection stripping query params
    const syncTabUrl = LIKED_VIDEOS_PLAYLIST + `#${PLAYLIST_SYNC_PARAM_NAME}=liked`;
    tab = await new Promise((resolve) => {
      chrome.tabs.create({
        url: syncTabUrl,
        active: false
      }, resolve);
    });

    if (tab && tab.id) {
      autoSyncPlaylistTabs.set(tab.id, 'liked');
    }

    let result = null;

    if (tab && tab.id) {
      const syncMessage = await waitForPlaylistSyncData(tab.id, 'liked', 12000);
      if (syncMessage && syncMessage.success && Array.isArray(syncMessage.videos)) {
        result = { success: true, videos: syncMessage.videos, method: syncMessage.method || 'content-script' };
      } else {
        console.log('[JumpKey BG] Liked auto-sync not available or timeout, falling back to script injection');
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const injectResults = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: getPlaylistExtractionFunction()
        });

        if (injectResults && injectResults[0] && injectResults[0].result) {
          result = injectResults[0].result;
        }
      }
    }

    if (result && result.success && Array.isArray(result.videos) && result.videos.length > 0) {
      await setLikedVideosCache(result.videos);
      console.log('[JumpKey BG] ✓ Liked sync successful:', result.videos.length, 'videos extracted using', result.method);
      return true;
    }

    console.warn('[JumpKey BG] ✗ Liked sync failed: No results');
    return false;
  } catch (error) {
    console.error('[JumpKey BG] Error syncing Liked Videos:', error);
    return false;
  } finally {
    if (tab && tab.id) {
      autoSyncPlaylistTabs.delete(tab.id);
      await removeTab(tab.id).catch((err) => {
        console.warn('[JumpKey BG] Failed to close liked sync tab:', err);
      });
    }
    if (previousTab && previousTab.id && (!tab || tab.id !== previousTab.id)) {
      restoreActiveTab(previousTab);
    }
  }
}

async function setWindowState(windowId, state) {
  console.log('[JumpKey BG] setWindowState - windowId:', windowId, 'requested state:', state);
  if (state === 'fullscreen') {
    pendingFullscreenWindowIds.add(windowId);
    await saveWindowBoundsBeforeFullscreen(windowId);
  }
  return new Promise((resolve, reject) => {
    const updateProps = state === 'fullscreen' ? { state, focused: true } : { state };
    chrome.windows.update(windowId, updateProps, (win) => {
      if (chrome.runtime.lastError) {
        console.warn('[JumpKey BG] setWindowState failed:', chrome.runtime.lastError);
        if (state === 'fullscreen') {
          pendingFullscreenWindowIds.delete(windowId);
        }
        reject(chrome.runtime.lastError);
        return;
      }
      if (state === 'fullscreen') {
        pendingFullscreenWindowIds.delete(windowId);
      }
      console.log('[JumpKey BG] setWindowState result:', { id: win?.id, state: win?.state, focused: win?.focused });
      resolve(win);
    });
  });
}

// Função robusta para fullscreen: só faz retry se state for 'fullscreen'
async function setWindowStateWithRetry(windowId, state, maxRetries = 2, intervalMs = 200) {
  if (state !== 'fullscreen') {
    return await setWindowState(windowId, state);
  }
  let lastWindow = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    lastWindow = await setWindowState(windowId, state);
    console.log('[JumpKey BG] setWindowStateWithRetry attempt', attempt + 1, 'stateResult:', lastWindow && lastWindow.state);
    if (lastWindow && lastWindow.state === state) {
      if (attempt > 0) {
        console.log(`[JumpKey BG] Fullscreen succeeded after retry #${attempt}`);
      }
      return lastWindow;
    }
    if (attempt < maxRetries) {
      console.warn(`[JumpKey BG] Fullscreen not active (attempt ${attempt + 1}), retrying in ${intervalMs}ms...`);
      await new Promise(res => setTimeout(res, intervalMs));
    }
  }
  console.warn('[JumpKey BG] Fullscreen did not activate after retries - last state:', lastWindow && lastWindow.state);
  return lastWindow;
}

async function attemptVisibleFullscreen(windowId) {
  console.log('[JumpKey BG] attemptVisibleFullscreen start for windowId:', windowId);
  try {
    const currentWindow = await getWindow(windowId);
    if (currentWindow && currentWindow.state === 'fullscreen') {
      try {
        await focusWindow(windowId);
      } catch (e) {
        // ignore
      }
      console.log('[JumpKey BG] attemptVisibleFullscreen: already fullscreen', { windowId, state: currentWindow.state });
      return currentWindow;
    }

    // Try a quick maximize -> fullscreen toggle to work around some window managers
    try {
      await setWindowState(windowId, 'maximized');
    } catch (e) {
      console.warn('[JumpKey BG] attemptVisibleFullscreen: maximize failed', e);
    }
    // small pause
    await new Promise(res => setTimeout(res, 120));
    try {
      await setWindowStateWithRetry(windowId, 'fullscreen');
    } catch (e) {
      console.warn('[JumpKey BG] attemptVisibleFullscreen: second fullscreen failed', e);
    }
    // give window manager a moment
    await new Promise(res => setTimeout(res, 150));
    try {
      await focusWindow(windowId);
    } catch (e) {
      // ignore
    }
    const finalWindow = await getWindow(windowId);
    console.log('[JumpKey BG] attemptVisibleFullscreen final window state:', { id: finalWindow?.id, state: finalWindow?.state });
    return finalWindow;
  } catch (err) {
    console.warn('[JumpKey BG] attemptVisibleFullscreen failed:', err);
    return null;
  }
}

const BROWSER = (typeof browser !== 'undefined') ? browser : chrome;

function getDefaultNewTabPageURL() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent.toLowerCase() : '';
  if (ua.includes('firefox')) {
    return 'about:newtab';
  }
  if (ua.includes('edg/') || ua.includes('edge/')) {
    return 'edge://newtab';
  }
  return 'chrome://newtab';
}

function getDisplaysInfo() {
  // Chrome/Edge: use system.display for multi-monitor.
  if (BROWSER.system && BROWSER.system.display && BROWSER.system.display.getInfo) {
    return new Promise((resolve, reject) => {
      try {
        BROWSER.system.display.getInfo((displays) => {
          if (BROWSER.runtime.lastError) {
            reject(BROWSER.runtime.lastError);
            return;
          }
          resolve(displays || []);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // Firefox or fallback path: use screen and current window info.
  return new Promise(async (resolve) => {
    let bounds = {
      left: 0,
      top: 0,
      width: window.screen?.availWidth || window.screen?.width || 1920,
      height: window.screen?.availHeight || window.screen?.height || 1080
    };

    try {
      const win = await new Promise((resolveWin, rejectWin) => {
        BROWSER.windows.getCurrent({ populate: false }, (w) => {
          if (BROWSER.runtime && BROWSER.runtime.lastError) {
            rejectWin(BROWSER.runtime.lastError);
            return;
          }
          resolveWin(w);
        });
      });

      if (win && typeof win.left === 'number' && typeof win.top === 'number' && typeof win.width === 'number' && typeof win.height === 'number') {
        bounds = {
          left: win.left,
          top: win.top,
          width: win.width,
          height: win.height
        };
      }
    } catch (_err) {
      // keep default screen bounds if no window info available
    }

    resolve([{ id: 'fallback', bounds, isPrimary: true }]);
  });
}

function updateWindowBounds(windowId, left, top, width, height) {
  return new Promise((resolve, reject) => {
    try {
      chrome.windows.update(windowId, { state: 'normal', left, top, width, height }, (w) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve(w);
      });
    } catch (err) {
      reject(err);
    }
  });
}

async function attemptFullscreenByBounds(windowId) {
  try {
    const displays = await getDisplaysInfo();
    if (!Array.isArray(displays) || displays.length === 0) {
      console.warn('[JumpKey BG] No displays found for bounds fallback');
      return null;
    }

    const win = await getWindow(windowId);
    if (!win) return null;

    const centerX = (typeof win.left === 'number' ? win.left : 0) + Math.floor((win.width || 0) / 2);
    const centerY = (typeof win.top === 'number' ? win.top : 0) + Math.floor((win.height || 0) / 2);

    let target = displays.find(d => (
      centerX >= d.bounds.left && centerX < d.bounds.left + d.bounds.width &&
      centerY >= d.bounds.top && centerY < d.bounds.top + d.bounds.height
    ));

    if (!target) {
      target = displays.find(d => d.isPrimary) || displays[0];
    }

    const b = target.bounds || { left: 0, top: 0, width: 800, height: 600 };

    console.log('[JumpKey BG] attemptFullscreenByBounds: targeting display', { id: target.id, bounds: b });

    // Set window to cover the display bounds
    const updated = await updateWindowBounds(windowId, b.left, b.top, b.width, b.height);
    console.log('[JumpKey BG] attemptFullscreenByBounds updated window:', { id: updated?.id, state: updated?.state });
    try {
      await focusWindow(windowId);
    } catch (e) {
      // ignore
    }
    return updated;
    } catch (err) {
    console.warn('[JumpKey BG] attemptFullscreenByBounds failed:', err);
    return null;
  }
}

chrome.windows.onBoundsChanged.addListener((win) => {
  if (!win || win.id == null) {
    return;
  }

  // Keep a rolling view of the previous window bounds/state to capture fullscreen transitions
  const prevInfo = windowLastInfoById.get(win.id);
  if (prevInfo && prevInfo.state !== 'fullscreen' && win.state === 'fullscreen') {
    // When the window enters fullscreen, save the bounds/state it had immediately before.
    if (!fullscreenRestoreStateByWindowId.has(win.id)) {
      fullscreenRestoreStateByWindowId.set(win.id, {
        state: prevInfo.state === 'maximized' ? 'maximized' : 'normal',
        left: prevInfo.left,
        top: prevInfo.top,
        width: prevInfo.width,
        height: prevInfo.height
      });
      console.log('[JumpKey BG] Saved window bounds before fullscreen (boundsChanged):', { windowId: win.id, prevInfo });
    }
  }

  windowLastInfoById.set(win.id, {
    state: win.state,
    left: win.left,
    top: win.top,
    width: win.width,
    height: win.height
  });

  if (pendingFullscreenWindowIds.has(win.id)) {
    if (win.state === 'fullscreen') {
      pendingFullscreenWindowIds.delete(win.id);
    }
    return;
  }

  if (!fullscreenRestoreStateByWindowId.has(win.id)) {
    return;
  }

  if (win.state === 'fullscreen') {
    return;
  }

  restoreWindowAfterFullscreen(win.id);
});

chrome.windows.onRemoved.addListener((windowId) => {
  // Clean up any stored state for windows that are closed.
  windowLastInfoById.delete(windowId);
  fullscreenRestoreStateByWindowId.delete(windowId);
  pendingFullscreenWindowIds.delete(windowId);
  windowsBeingRestored.delete(windowId);

  if (focusChangeSuppression.oldWindowId === windowId) {
    focusChangeSuppression.oldWindowId = null;
    focusChangeSuppression.targetWindowId = null;
    focusChangeSuppression.expiresAt = 0;
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  try {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      return;
    }

    const now = Date.now();
    if (focusChangeSuppression.oldWindowId != null && now < focusChangeSuppression.expiresAt) {
      if (windowId === focusChangeSuppression.oldWindowId && focusChangeSuppression.targetWindowId != null) {
        console.log('[JumpKey BG] Suppressed accidental focus to old window:', windowId, '-> redirecting to:', focusChangeSuppression.targetWindowId);
        await focusWindow(focusChangeSuppression.targetWindowId).catch((err) => {
          console.warn('[JumpKey BG] Failed to enforce target window focus:', err);
        });
        return;
      }
    }

    if (now >= focusChangeSuppression.expiresAt) {
      focusChangeSuppression.oldWindowId = null;
      focusChangeSuppression.targetWindowId = null;
      focusChangeSuppression.expiresAt = 0;
    }
  } catch (err) {
    console.warn('[JumpKey BG] onFocusChanged handler encountered error:', err);
  }
});

const VIDEO_HISTORY_KEY = 'videoHistory';

function getVideoHistory() {
  return new Promise((resolve) => {
    chrome.storage.local.get([VIDEO_HISTORY_KEY], (result) => {
      resolve(result[VIDEO_HISTORY_KEY] || []);
    });
  });
}

function getVideoDurations() {
  return new Promise((resolve) => {
    chrome.storage.local.get([VIDEO_DURATION_KEY], (result) => {
      const durations = result[VIDEO_DURATION_KEY] || {};
      resolve(durations);
    });
  });
}

function setVideoDurations(durationMap) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [VIDEO_DURATION_KEY]: durationMap || {} }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[JumpKey BG] Error setting video durations:', chrome.runtime.lastError);
      }
      resolve();
    });
  });
}

async function getVideoDuration(videoId) {
  if (!videoId) return null;
  const durations = await getVideoDurations();
  const d = Number(durations[videoId]);
  return Number.isFinite(d) && d > 0 ? d : null;
}

async function storeVideoDuration(videoId, durationSec) {
  if (!videoId || !Number.isFinite(durationSec) || durationSec <= 0) return;
  const durations = await getVideoDurations();
  if (durations[videoId] && Number(durations[videoId]) > 0) {
    // keep existing duration if already present
    return;
  }
  durations[videoId] = Number(durationSec);
  await setVideoDurations(durations);
  console.log(`[JumpKey BG] Stored video duration: ${videoId} = ${Number(durationSec)}s`);
}

function parseDurationText(durationText) {
  if (!durationText || typeof durationText !== 'string') return null;
  const cleaned = durationText.trim();
  if (!cleaned) return null;
  const parts = cleaned.split(':').map((p) => Number(p.replace(/[^0-9]/g, '')));
  if (parts.some((p) => Number.isNaN(p))) return null;
  let seconds = 0;
  if (parts.length === 3) {
    seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    seconds = parts[0] * 60 + parts[1];
  } else if (parts.length === 1) {
    seconds = parts[0];
  }
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function extractVideoIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const shortsMatch = url.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
  if (shortsMatch && shortsMatch[1]) return shortsMatch[1];
  const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]+)/);
  if (watchMatch && watchMatch[1]) return watchMatch[1];
  return null;
}

async function getDurationFromTab(tab) {
  if (!tab || !tab.id || !tab.url) return null;

  const videoId = extractVideoIdFromUrl(tab.url);
  if (videoId) {
    const cached = await getVideoDuration(videoId);
    if (cached) return cached;
  }

  // Ensure tab is fully loaded before messaging
  try {
    const tabInfo = await getTab(tab.id).catch(() => null);
    if (tabInfo && tabInfo.status !== 'complete') {
      const loaded = await ensureTabIsLoaded(tab.id);
      if (!loaded) {
        console.warn('[JumpKey BG] Tab not loaded for duration fetch:', tab.id, tab.url);
        return null;
      }
    }
  } catch (err) {
    console.warn('[JumpKey BG] Error while ensuring tab loaded', tab.id, err);
  }

  try {
    const durationResp = await sendMessageToTab(tab.id, { action: 'getVideoDuration' }, 3);

    if (durationResp && durationResp.ok && Number.isFinite(Number(durationResp.duration)) && durationResp.duration > 0) {
      const parsed = Number(durationResp.duration);
      if (videoId) {
        await storeVideoDuration(videoId, parsed);
      }
      return parsed;
    }

    // Try older response format/wrapper
    if (durationResp && durationResp.success === true && durationResp.response && Number.isFinite(Number(durationResp.response.duration)) && durationResp.response.duration > 0) {
      const parsed = Number(durationResp.response.duration);
      if (videoId) {
        await storeVideoDuration(videoId, parsed);
      }
      return parsed;
    }

    // If message endpoint not available, fallback to direct scripting
    if (durationResp === false) {
      const fallbackValue = await getDurationFromTabViaScripting(tab.id);
      if (Number.isFinite(Number(fallbackValue)) && fallbackValue > 0) {
        if (videoId) {
          await storeVideoDuration(videoId, Number(fallbackValue));
        }
        return Number(fallbackValue);
      }
    }
  } catch (err) {
    console.warn('[JumpKey BG] Error getting duration from tab', tab.id, err);
  }

  return null;
}

async function getVideoIdsFromCaches() {
  const [wlCacheObj, likedCacheObj, homeCacheObj] = await Promise.all([getWatchLaterCache(), getLikedVideosCache(), getHomeCache()]);
  const ids = new Set();

  const collect = (cacheObj) => {
    if (!cacheObj || !Array.isArray(cacheObj.videoIds)) return;
    cacheObj.videoIds.forEach((videoId) => {
      if (videoId) ids.add(videoId);
    });
  };

  collect(wlCacheObj);
  collect(likedCacheObj);
  collect(homeCacheObj);

  return ids;
}

async function getVideoIdsFromOpenTabs() {
  const tabs = await new Promise((res) => chrome.tabs.query({ url: ['*://*.youtube.com/*', '*://youtube.com/*'] }, (t) => res(t || [])));
  const ids = new Set();

  for (const tab of tabs) {
    if (!tab || !tab.url) continue;
    const videoId = extractVideoIdFromUrl(tab.url);
    if (videoId) ids.add(videoId);
  }

  return ids;
}

async function getDurationFromTabViaScripting(tabId) {
  try {
    const results = await new Promise((resolve, reject) => {
      chrome.scripting.executeScript(
        {
          target: { tabId },
          func: () => {
            try {
              const videoEl = document.querySelector('video');
              if (videoEl && Number.isFinite(Number(videoEl.duration)) && videoEl.duration > 0) {
                return videoEl.duration;
              }

              if (window.yt && window.ytplayer && window.ytplayer.config && window.ytplayer.config.args && window.ytplayer.config.args.length_seconds) {
                const val = Number(window.ytplayer.config.args.length_seconds);
                if (Number.isFinite(val) && val > 0) {
                  return val;
                }
              }

              const meta = document.querySelector('meta[itemprop="duration"]');
              if (meta && meta.getAttribute('content')) {
                const match = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(meta.getAttribute('content'));
                if (match) {
                  const h = Number(match[1] || 0);
                  const m = Number(match[2] || 0);
                  const s = Number(match[3] || 0);
                  const total = h * 3600 + m * 60 + s;
                  if (Number.isFinite(total) && total > 0) return total;
                }
              }

              return null;
            } catch (e) {
              return null;
            }
          }
        },
        (injectionResults) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else if (!Array.isArray(injectionResults) || !injectionResults[0] || injectionResults[0].result == null) {
            resolve(null);
          } else {
            resolve(injectionResults[0].result);
          }
        }
      );
    });

    return Number.isFinite(Number(results)) ? Number(results) : null;
  } catch (err) {
    console.warn('[JumpKey BG] getDurationFromTabViaScripting failed:', err);
    return null;
  }
}

async function syncMissingDurations(options = {}) {
  const maxToFetch = Number.isFinite(Number(options.maxToFetch)) ? Number(options.maxToFetch) : 20;

  const minIntervalMs = 29 * 1000;
  const now = Date.now();
  if (!options.force && (now - lastSyncMissingDurationsAt) < minIntervalMs) {
    console.log('[JumpKey BG] syncMissingDurations skipped because last run was', (now - lastSyncMissingDurationsAt), 'ms ago; need at least', minIntervalMs, 'ms');
    return 0;
  }
  lastSyncMissingDurationsAt = now;

  const durationMap = await getVideoDurations();
  const existingIds = new Set([...await getVideoIdsFromCaches(), ...await getVideoIdsFromOpenTabs()]);

  const missingIds = [...existingIds].filter((videoId) => {
    const current = Number(durationMap[videoId]);
    if (Number.isFinite(current) && current > 0) {
      return false;
    }
    const lastAttempt = lastDurationFetchAttemptById.get(videoId);
    if (lastAttempt && (now - lastAttempt) < DURATION_FETCH_RETRY_MS) {
      return false;
    }
    return true;
  });

  console.log('[JumpKey BG] syncMissingDurations: missing videoIds count=', missingIds.length, 'maxToFetch=', maxToFetch, 'pending=', missingIds.slice(0, 10));

  if (!missingIds.length) {
    console.info('[JumpKey BG] syncMissingDurations: no missing durations');
    return 0;
  }

  let fetched = 0;
  let workerTabId = null;
  let workerTabCreated = false;
  const targetIds = missingIds.slice(0, maxToFetch);

  try {
    workerTabId = await createDurationWorkerTab();
    workerTabCreated = Boolean(workerTabId);
    if (!workerTabId) {
      console.warn('[JumpKey BG] syncMissingDurations: failed to create duration worker tab');
      targetIds.forEach((videoId) => lastDurationFetchAttemptById.set(videoId, Date.now()));
      return 0;
    }

    const results = await processDurationsWithLightWorker(workerTabId, targetIds);
    if (!results || typeof results !== 'object') {
      console.warn('[JumpKey BG] syncMissingDurations: worker unavailable, falling back to YouTube page sync');
      fetched += await syncMissingDurationsViaYoutubePages(targetIds);
      return fetched;
    }

    for (const videoId of targetIds) {
      const duration = Number(results[videoId]);
      console.log(`[JumpKey BG] syncMissingDurations: worker result for ${videoId} = ${duration}`);
      if (Number.isFinite(duration) && duration > 0) {
        await storeVideoDuration(videoId, duration);
        fetched += 1;
        lastDurationFetchAttemptById.delete(videoId);
      } else {
        lastDurationFetchAttemptById.set(videoId, Date.now());
      }
    }
  } finally {
    if (workerTabCreated && workerTabId) {
      try {
        await removeTab(workerTabId);
      } catch (e) {
        console.warn('[JumpKey BG] Failed to remove duration worker tab:', e);
      }
    }
  }

  if (fetched > 0) {
    console.info(`[JumpKey BG] syncMissingDurations: updated ${fetched} durations`);
  }

  return fetched;
}

async function getPopupSnoozedVideoIds() {
  const data = await getPopupSnoozedVideos();
  const result = new Set();
  const now = Date.now();
  for (const [videoId, expires] of Object.entries(data || {})) {
    const e = Number(expires);
    if (videoId && Number.isFinite(e) && e > now) {
      result.add(videoId);
    }
  }
  return result;
}

function sortVideosByDurationAndSnooze(videos, snoozedIds) {
  return videos.slice().sort((a, b) => {
    const aSnoozed = snoozedIds.has(a.videoId);
    const bSnoozed = snoozedIds.has(b.videoId);
    if (aSnoozed !== bSnoozed) return aSnoozed ? 1 : -1;
    const da = getDurationForSort(a);
    const db = getDurationForSort(b);
    if (da !== db) return da - db;
    return 0;
  });
}

async function getAllSeenVideoIds() {
  const [wlSeen, likedSeen, homeSeen, history] = await Promise.all([getSeenWLVideos(), getSeenLikedVideos(), getSeenHomeVideos(), getVideoHistory()]);

  const seen = new Set();
  Object.keys(wlSeen || {}).forEach((id) => id && seen.add(id));
  Object.keys(likedSeen || {}).forEach((id) => id && seen.add(id));
  Object.keys(homeSeen || {}).forEach((id) => id && seen.add(id));

  if (Array.isArray(history)) {
    history.forEach((entry) => {
      if (entry && entry.videoId) seen.add(entry.videoId);
    });
  }

  return seen;
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// Ensure a tab for the given videoId is available (returns tabId)
async function ensureTabForVideo(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  // Try to find an existing tab with the same video
  const tabs = await new Promise((res) => chrome.tabs.query({ url: ['*://*.youtube.com/*', '*://youtube.com/*'] }, (t) => res(t || [])));
  for (const t of tabs) {
    try {
      if (t && t.url && t.url.indexOf(`watch?v=${videoId}`) !== -1) {
        return t.id;
      }
    } catch (e) { /* ignore */ }
  }

  // Otherwise create a new background tab (not active)
  const created = await new Promise((res) => chrome.tabs.create({ url, active: false }, (tab) => res(tab)));
  // Wait a bit for the tab to start loading
  await sleep(1200);
  // Ensure we wait for the page to actually finish loading before usage
  await ensureTabIsLoaded(created.id).catch(() => false);
  return created.id;
}

// Execute a small script in the youtube watch page to click the Save/Watch later UI
async function runScriptInTab(tabId, func, args = []) {
  return new Promise((resolve, reject) => {
    try {
      chrome.scripting.executeScript({ target: { tabId }, func, args }, (results) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve(results);
      });
    } catch (e) {
      reject(e);
    }
  });
}

// Attempts to add the video to YouTube Watch Later by toggling the Save menu
async function addToYoutubeWatchLater(videoId) {
  const { tabId, created } = await ensureTemporaryTabForVideo(videoId);
  if (!tabId) throw new Error('Unable to obtain tab for video ' + videoId);
  await waitForContentReady(tabId, 5000);

  const script = (targetVideoId) => {
    const selectors = [
      'ytd-toggle-button-renderer#top-level-buttons ytd-toggle-button-renderer#save-button',
      'yt-icon-button[aria-label="Save"]',
      'ytd-menu-renderer #button'
    ];

    function tryClick(elem) {
      if (!elem) return false;
      try { elem.click(); return true; } catch (e) { return false; }
    }

    // Try direct save button(s)
    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn && tryClick(btn)) {
        // try to find 'Watch later' checkbox in the popup
        setTimeout(() => {
          const menu = document.querySelector('ytd-popup-container') || document.querySelector('tp-yt-paper-listbox');
          if (menu) {
            const wlLabel = Array.from(menu.querySelectorAll('yt-formatted-string, span, tp-yt-paper-item')).find(n => /watch later/i.test((n.textContent||'').trim()));
            if (wlLabel) {
              const parent = wlLabel.closest('tp-yt-paper-item') || wlLabel.closest('tp-yt-paper-checkbox') || wlLabel.parentElement;
              if (parent && parent.click) parent.click();
            }
          }
        }, 600);
        return { status: 'clicked-save' };
      }
    }

    // Fallback: try to open the three-dot menu for the video renderer and click 'Save to Watch later'
    const menuButtons = document.querySelectorAll('ytd-menu-renderer[overlay-role] #button, ytd-menu-renderer #button');
    for (const b of menuButtons) {
      try { b.click(); } catch (e) { continue; }
      setTimeout(() => {
        const entries = document.querySelectorAll('tp-yt-paper-item, ytd-menu-service-item-renderer');
        for (const it of entries) {
          if (/watch later/i.test((it.textContent||'').trim())) {
            try { it.click(); } catch (e) {}
          }
        }
      }, 600);
      return { status: 'clicked-menu' };
    }

    return { status: 'not-found' };
  };

  try {
    await runScriptInTab(tabId, script, [videoId]);
  } finally {
    if (created) {
      await removeTab(tabId);
    }
  }
}

// Attempts to remove the video from YouTube Watch Later via the same menu logic
async function removeFromYoutubeWatchLater(videoId) {
  const { tabId, created } = await ensureTemporaryTabForVideo(videoId);
  if (!tabId) throw new Error('Unable to obtain tab for video ' + videoId);
  await waitForContentReady(tabId, 5000);

  const script = (targetVideoId) => {
    // Try to open save/menu and uncheck 'Watch later'
    const tryOpenAndToggle = () => {
      const saveBtn = document.querySelector('ytd-toggle-button-renderer#top-level-buttons ytd-toggle-button-renderer#save-button') || document.querySelector('yt-icon-button[aria-label="Save"]') || document.querySelector('ytd-menu-renderer #button');
      if (saveBtn) {
        try { saveBtn.click(); } catch (e) {}
      }
      setTimeout(() => {
        const menu = document.querySelector('ytd-popup-container') || document.querySelector('tp-yt-paper-listbox');
        if (menu) {
          const wlLabel = Array.from(menu.querySelectorAll('yt-formatted-string, span, tp-yt-paper-item')).find(n => /watch later/i.test((n.textContent||'').trim()));
          if (wlLabel) {
            const parent = wlLabel.closest('tp-yt-paper-item') || wlLabel.closest('tp-yt-paper-checkbox') || wlLabel.parentElement;
            if (parent && parent.click) parent.click();
          }
        }
      }, 600);
    };

    tryOpenAndToggle();
    return { status: 'requested' };
  };

  try {
    await runScriptInTab(tabId, script, [videoId]);
  } finally {
    if (created) {
      await removeTab(tabId);
    }
  }
}

async function waitForContentReady(tabId, timeoutMs = 2000, interval = 150) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const ok = await sendMessageToTab(tabId, { action: 'ping' }, 1);
      if (ok) return true;
    } catch (e) {
      // ignore and retry
    }
    await sleep(interval);
  }
  return false;
}

function saveVideoToHistory(videoId, title, tags) {
  return new Promise((resolve) => {
    chrome.storage.local.get([VIDEO_HISTORY_KEY], (result) => {
      const history = Array.isArray(result[VIDEO_HISTORY_KEY]) ? result[VIDEO_HISTORY_KEY] : [];
      const entry = {
        videoId,
        title: title || 'Unknown',
        tags: Array.isArray(tags) ? tags : [],
        timestamp: Date.now()
      };

      const filteredHistory = history.filter((item) => item && item.videoId !== videoId);
      filteredHistory.push(entry);
      const boundedHistory = filteredHistory.slice(-MAX_HISTORY_ENTRIES);

      chrome.storage.local.set({ [VIDEO_HISTORY_KEY]: boundedHistory }, resolve);
      console.log('[JumpKey BG] Video saved to history:', entry);
    });
  });
}

async function updateBadge() {
  try {
    const [shortTabs, watchTabs, wlCache, likedCache, settings] = await Promise.all([
      queryTabs({ url: SHORTS_QUERY }),
      queryTabs({ url: LONG_VIDEO_QUERY }),
      getWatchLaterCache(),
      getLikedVideosCache(),
      getSettings()
    ]);

    const tabItems = [];
    const tabVideoIds = new Set();

    if (settings.sourceShortsTabs) {
      for (const tab of shortTabs) {
        const match = (tab.url || '').match(/\/shorts\/([a-zA-Z0-9_-]+)/);
        if (!match || !match[1]) {
          continue;
        }

        const videoId = match[1];
        if (tabVideoIds.has(videoId)) {
          continue;
        }

        tabVideoIds.add(videoId);
        tabItems.push(videoId);
      }
    }

    if (settings.sourceWatchTabs) {
      for (const tab of watchTabs) {
        const match = (tab.url || '').match(/[?&]v=([a-zA-Z0-9_-]+)/);
        if (!match || !match[1]) {
          continue;
        }

        const videoId = match[1];
        if (tabVideoIds.has(videoId)) {
          continue;
        }

        tabVideoIds.add(videoId);
        tabItems.push(videoId);
      }
    }

    const watchLaterCount = settings.sourceWatchLater
      ? wlCache.videoIds.filter((videoId) => !tabVideoIds.has(videoId)).length
      : 0;

    const likedCount = settings.sourceLikedVideos
      ? likedCache.videoIds.filter((videoId) => !tabVideoIds.has(videoId)).length
      : 0;

    const count = tabItems.length + watchLaterCount + likedCount;
    
    if (count > 0) {
      await chrome.action.setBadgeText({ text: String(count) });
      await chrome.action.setBadgeBackgroundColor({ color: '#331122' });
      await chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch (error) {
    console.error('Error updating badge:', error);
  }
}

let badgeUpdateTimeout = null;

function scheduleBadgeUpdate(delay = BADGE_UPDATE_DEBOUNCE_MS) {
  if (badgeUpdateTimeout) {
    clearTimeout(badgeUpdateTimeout);
  }

  badgeUpdateTimeout = setTimeout(() => {
    badgeUpdateTimeout = null;
    updateBadge();
  }, delay);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    scheduleBadgeUpdate();
  }
});

chrome.tabs.onRemoved.addListener(() => {
  scheduleBadgeUpdate();
});

chrome.tabs.onCreated.addListener(() => {
  scheduleBadgeUpdate();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && (
    changes.sourceWatchLater ||
    changes.sourceShortsTabs ||
    changes.sourceWatchTabs
  )) {
    scheduleBadgeUpdate(0);
    return;
  }

  if (areaName === 'local' && changes.wlCache) {
    scheduleBadgeUpdate(0);
  }
});

function resolveVideoIdFromMessage(message) {
  const directId = message?.videoId;
  if (directId) {
    return directId;
  }

  const href = message?.href || message?.url || '';
  if (!href) {
    return null;
  }

  const watchMatch = href.match(/[?&]v=([^&]+)/);
  if (watchMatch && watchMatch[1]) {
    return watchMatch[1];
  }

  const shortsMatch = href.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
  if (shortsMatch && shortsMatch[1]) {
    return shortsMatch[1];
  }

  return null;
}

console.log('[JumpKey BG] Registering runtime.onMessage listener');

async function handleRuntimeMessage(message, sender, sendResponse) {
  if (!message || !message.action) {
    return false;
  }

  console.log('[JumpKey BG] ========== MESSAGE RECEIVED ==========');
  console.log('[JumpKey BG] Time:', new Date().toISOString());
  console.log('[JumpKey BG] Message action:', message?.action);
  console.log('[JumpKey BG] Full message:', message);
  console.log('[JumpKey BG] Sender tab:', sender?.tab?.id);
  console.log('[JumpKey BG] Sender URL:', sender?.url);
  
  if (message.action === 'playlistSyncData' && sender.tab && message.source) {
    const key = `${sender.tab.id}:${message.source}`;
    const resolver = playlistSyncWaiters.get(key);
    if (resolver) {
      playlistSyncWaiters.delete(key);
      resolver(message);
    }

    if (autoSyncPlaylistTabs.get(sender.tab.id) === message.source) {
      console.log('[JumpKey BG] Received playlist sync data from tab', sender.tab.id, 'source', message.source);
    }

    sendResponse({ status: 'received' });
    return true;
  }

  if (message.action === 'switchShorts' && sender.tab) {
    console.log('[JumpKey BG] Processing switchShorts action');
    handleSwitchShorts(sender.tab);
    sendResponse({ status: 'processed' });
    return true;
  }

  if (message.action === 'getSwitchQueue') {
    getSwitchQueue()
      .then((queue) => {
        console.log('[JumpKey BG] getSwitchQueue resolved, items:', (queue && queue.length) || 0);
        sendResponse({ ok: true, queue });
      })
      .catch((err) => {
        console.error('[JumpKey BG] getSwitchQueue failed:', err);
        sendResponse({ ok: false, error: err?.message || String(err) });
      });

    return true;
  }
  
  if (message.action === 'reportVideoDuration' && message.videoId && Number.isFinite(Number(message.duration)) && Number(message.duration) > 0) {
    console.log('[JumpKey BG] Processing reportVideoDuration action', message.videoId, message.duration);
    try {
      await storeVideoDuration(message.videoId, Number(message.duration));
      sendResponse({ status: 'processed', stored: true });
    } catch (err) {
      console.error('[JumpKey BG] reportVideoDuration store failed:', err);
      sendResponse({ status: 'error', error: err?.message || String(err) });
    }
    return true;
  }

  if (message.action === 'requestRestoreWindowAfterFullscreen') {
    try {
      const windowId = sender?.tab?.windowId;
      if (!windowId) {
        sendResponse({ ok: false, error: 'no_window_id' });
        return false;
      }
      restoreWindowAfterFullscreen(windowId);
      sendResponse({ ok: true, status: 'ok' });
    } catch (err) {
      console.warn('[JumpKey BG] requestRestoreWindowAfterFullscreen handler error:', err);
      sendResponse({ ok: false, status: 'error', error: err && err.message ? err.message : String(err) });
    }
    return false;
  }

  if (message.action === 'exitFullscreenWindow') {
    (async () => {
      try {
        const windowId = sender?.tab?.windowId;
        if (!windowId) {
          sendResponse({ ok: false, status: 'error', error: 'no_window_id' });
          return;
        }

        const savedState = fullscreenRestoreStateByWindowId.get(windowId);
        if (!savedState) {
          console.log('[JumpKey BG] exitFullscreenWindow: no saved window bounds, maximizing as fallback.');
          await setWindowStateWithRetry(windowId, 'maximized');
          sendResponse({ ok: true, status: 'ok', fallback: 'maximized' });
          return;
        }

        await setWindowStateWithRetry(windowId, 'normal');
        restoreWindowAfterFullscreen(windowId);
        sendResponse({ ok: true, status: 'ok' });
      } catch (err) {
        console.warn('[JumpKey BG] exitFullscreenWindow handler error:', err);
        sendResponse({ ok: false, status: 'error', error: err && err.message ? err.message : String(err) });
      }
    })();
    return true;
  }

  if (message.action === 'switchRandom' && sender.tab) {
    console.log('[JumpKey BG] Processing switchRandom action');
    handleSwitchShorts(sender.tab);
    sendResponse({ status: 'processed' });
  }

  if (message.action === 'switchRandomFromPopup') {
    console.log('[JumpKey BG] Processing switchRandomFromPopup action');
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        console.error('[JumpKey BG] Error querying active tab for popup switch:', chrome.runtime.lastError);
        sendResponse({ status: 'error', error: chrome.runtime.lastError.message });
        return;
      }

      const activeTab = Array.isArray(tabs) ? tabs[0] : null;
      handleSwitchShorts(activeTab)
        .then(() => sendResponse({ status: 'processed' }))
        .catch((error) => {
          console.error('[JumpKey BG] Error in switchRandomFromPopup:', error);
          sendResponse({ status: 'error', error: error?.message || 'Unknown error' });
        });
    });
    return true;
  }

  if (message.action === 'addToWatchLaterCache' && message.videoId) {
    const { videoId, title, tags } = message;
    (async () => {
      try {
        const cache = await getWatchLaterCache();
        const exists = cache.videoIds.includes(videoId);
        if (!exists) {
          const newItem = {
            videoId,
            title: title || `Watch Later • ${videoId}`,
            tags: Array.isArray(tags) ? tags : []
          };
          const newVideos = [newItem, ...cache.videos];
          await setWatchLaterCache(newVideos);
        }
        sendResponse({ status: 'ok', existed: exists });

        // If user wants sync to YouTube Watch Later, attempt to add there as well
        try {
          const settings = await new Promise((res) => chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => res(items)));
          if (settings && settings.syncToYoutubeWatchLater) {
            // best-effort, fire-and-forget
            addToYoutubeWatchLater(videoId).catch((e) => console.warn('[JumpKey BG] addToYoutubeWatchLater failed:', e));
          }
        } catch (e) {
          console.warn('[JumpKey BG] Error checking sync setting:', e);
        }
      } catch (err) {
        console.error('[JumpKey BG] Error adding to WL cache:', err);
        sendResponse({ status: 'error', error: err?.message || String(err) });
      }
    })();

    return true;
  }
  
  if (message.action === 'switchToTab' && (message.targetTab || message.targetTabId)) {
    console.log('[JumpKey BG] ======== SWITCHTOTAB HANDLER TRIGGERED ========');
    try {
      if (message.targetTabId) {
        console.log('[JumpKey BG] switchToTab received targetTabId:', message.targetTabId);
        chrome.tabs.get(message.targetTabId, (tab) => {
          if (chrome.runtime.lastError) {
            console.error('[JumpKey BG] Error fetching tab by id:', chrome.runtime.lastError);
            return;
          }
          console.log('[JumpKey BG] Fetched tab for switchToTab:', tab?.id, tab?.url);
          handleSwitchToTab(tab).catch((error) => {
            console.error('[JumpKey BG] Error in handleSwitchToTab:', error);
          });
        });
      } else {
        console.log('[JumpKey BG] switchToTab received full targetTab object');
        handleSwitchToTab(message.targetTab).catch((error) => {
          console.error('[JumpKey BG] Error in handleSwitchToTab:', error);
        });
      }
    } catch (err) {
      console.error('[JumpKey BG] Unexpected error handling switchToTab:', err);
    }
    sendResponse({ status: 'processing' });
    return true;
  }
  
  if (message.action === 'saveVideoToHistory') {
    const { videoId, title, tags } = message;
    if (!videoId) {
      sendResponse({ ok: false, status: 'error', error: 'no_video_id' });
      return true;
    }
    saveVideoToHistory(videoId, title, tags).then(() => {
      sendResponse({ ok: true, status: 'saved' });
    }).catch((err) => {
      sendResponse({ ok: false, status: 'error', error: err?.message || String(err) });
    });
    return true;
  }

  if (message.action === 'exportVideoQueue') {
    try {
      const history = await getVideoHistory();
      const settings = await new Promise((resolve) => {
        chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => resolve(items));
      });

      sendResponse({
        ok: true,
        status: 'ok',
        data: {
          version: 1,
          exportedAt: new Date().toISOString(),
          queue: history,
          options: settings
        }
      });
    } catch (err) {
      sendResponse({ ok: false, status: 'error', error: err?.message || String(err) });
    }
    return true;
  }

  if (message.action === 'importVideoQueue') {
    try {
      const payload = message.payload;
      if (!payload || !Array.isArray(payload.queue)) {
        sendResponse({ ok: false, status: 'error', error: 'invalid_export_payload' });
        return true;
      }

      const existing = await getVideoHistory();
      const existingMap = new Map(existing.filter((item) => item && item.videoId).map((item) => [item.videoId, item]));
      let added = 0;
      let updated = 0;

      for (const item of payload.queue) {
        if (!item || !item.videoId) continue;
        const normalized = {
          videoId: item.videoId,
          title: item.title || 'Unknown',
          tags: Array.isArray(item.tags) ? item.tags : [],
          timestamp: Number(item.timestamp) || Date.now()
        };
        const existingItem = existingMap.get(item.videoId);
        if (!existingItem) {
          existingMap.set(item.videoId, normalized);
          added += 1;
        } else if (normalized.timestamp > (existingItem.timestamp || 0)) {
          existingMap.set(item.videoId, normalized);
          updated += 1;
        }
      }

      let merged = Array.from(existingMap.values());
      merged.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      merged = merged.slice(-MAX_HISTORY_ENTRIES);

      await new Promise((resolve) => {
        chrome.storage.local.set({ [VIDEO_HISTORY_KEY]: merged }, () => resolve());
      });

      if (payload.options && typeof payload.options === 'object') {
        chrome.storage.sync.set(payload.options, () => {
          sendResponse({ ok: true, status: 'ok', added, updated, total: merged.length });
        });
      } else {
        sendResponse({ ok: true, status: 'ok', added, updated, total: merged.length });
      }
    } catch (err) {
      sendResponse({ ok: false, status: 'error', error: err?.message || String(err) });
    }
    return true;
  }

  // Bulk add request from options page
  if (message.action === 'bulkAddToYoutubeWatchLater' && Array.isArray(message.videoIds)) {
    const ids = message.videoIds.slice(0, 1000);
    // Start async process and return immediately
    (async () => {
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        try {
              console.log('[JumpKey BG] Bulk add - adding', id, `(${i+1}/${ids.length})`);
          await addToYoutubeWatchLater(id);
          // small throttle to avoid rate issues
          await sleep(900);
        } catch (e) {
              console.warn('[JumpKey BG] Bulk add failed for', id, e);
        }
      }
          console.log('[JumpKey BG] Bulk add completed');
    })();
    sendResponse({ status: 'started', count: ids.length });
    return true;
  }

  // Add single video to YouTube Watch Later (background-invoked)
  if (message.action === 'addToYoutubeWatchLater') {
    const vid = resolveVideoIdFromMessage(message);
    if (!vid) {
      sendResponse({ ok: false, status: 'error', error: 'no_video_id' });
      return true;
    }

    addToYoutubeWatchLater(vid)
      .then(() => sendResponse({ ok: true, status: 'ok' }))
      .catch((e) => sendResponse({ ok: false, status: 'error', error: String(e) }));
    return true;
  }

  if (message.action === 'popupSnoozeVideo' && message.videoId) {
    const expires = Number.isFinite(Number(message.expires)) && Number(message.expires) > Date.now() ? Number(message.expires) : (Date.now() + 60*60*1000);
    setPopupSnoozedVideo(message.videoId, expires).then(() => {
      sendResponse({ status: 'ok', expires });
    }).catch((err) => {
      console.warn('[JumpKey BG] popupSnoozeVideo failed', err);
      sendResponse({ status: 'error', error: String(err) });
    });
    return true;
  }

  // Remove a video from YouTube Watch Later
  if (message.action === 'removeFromYoutubeWatchLater') {
    const vid = resolveVideoIdFromMessage(message);
    if (!vid) {
      sendResponse({ ok: false, status: 'error', error: 'no_video_id' });
      return true;
    }

    (async () => {
      try {
        await removeFromYoutubeWatchLater(vid);

        // If configured, also remove from local WL cache
        try {
          const settings = await new Promise((res) => chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => res(items)));
          if (settings && settings.autoRemoveWatchedFromWatchLater) {
            const cache = await getWatchLaterCache();
            const remainingVideos = (cache.videos || []).filter((v) => v && v.videoId !== vid);
            await setWatchLaterCache(remainingVideos);
            console.log('[JumpKey BG] Removed video from local WL cache due to watched:', vid);
          }
        } catch (e) {
          console.warn('[JumpKey BG] Error while removing from local WL cache:', e);
        }

        sendResponse({ ok: true, status: 'ok' });
      } catch (e) {
        sendResponse({ ok: false, status: 'error', error: String(e) });
      }
    })();
    return true;
  }
  
  // 🎬 Unified playlist sync handler with single confirmation
  if (message.action === 'syncPlaylists') {
    const settings = await getSettings();
    const sources = [];
    if (settings.sourceWatchLater) sources.push('watchLater');
    if (settings.sourceLikedVideos) sources.push('liked');

    if (sources.length === 0) {
      sendResponse({ success: true, message: 'No sync sources enabled' });
      return true;
    }

    const confirmed = await getPlaylistSyncConfirmation();
    const force = Boolean(message.confirmed);

    if (!confirmed && !force) {
      sendResponse({
        success: false,
        confirmationNeeded: true,
        message: 'Confirme sincronização de playlists (Watch Later + Liked)',
        sources
      });
      return true;
    }

    if (!confirmed && force) {
      await setPlaylistSyncConfirmation(true);
    }

    const result = { watchLater: null, liked: null };
    if (settings.sourceWatchLater) {
      result.watchLater = await syncWatchLater(false).catch((err) => {
        console.warn('[JumpKey BG] syncWatchLater from syncPlaylists failed:', err);
        return false;
      });
    }
    if (settings.sourceLikedVideos) {
      result.liked = await syncLikedVideos(false).catch((err) => {
        console.warn('[JumpKey BG] syncLikedVideos from syncPlaylists failed:', err);
        return false;
      });
    }

    sendResponse({ success: true, result });
    return true;
  }

  // 🎬 Watch Later handlers
  if (message.action === 'syncWatchLater') {
    const confirmed = await getPlaylistSyncConfirmation();
    const force = Boolean(message.confirmed);
    if (!confirmed && !force) {
      sendResponse({ success: false, confirmationNeeded: true, message: 'Confirme sincronização de Watch Later' });
      return true;
    }
    if (!confirmed && force) {
      await setPlaylistSyncConfirmation(true);
    }

    console.log('[JumpKey BG] Manual Watch Later sync requested');
    syncWatchLater(false).then((success) => {
      getWatchLaterCache().then((cache) => {
        sendResponse({ 
          success, 
          videoCount: cache.videoIds.length,
          lastSync: cache.lastSync
        });
      });
    }).catch((error) => {
      console.error('[JumpKey BG] Error in syncWatchLater handler:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
  
  if (message.action === 'getWatchLaterStatus') {
    getWatchLaterCache().then((cache) => {
      sendResponse({
        videoCount: cache.videoIds.length,
        videoIds: cache.videoIds,
        videos: cache.videos,
        lastSync: cache.lastSync,
        needsRefresh: Date.now() - cache.lastSync > WL_CACHE_REFRESH_INTERVAL
      });
    }).catch((error) => {
      console.error('[JumpKey BG] Error in getWatchLaterStatus handler:', error);
      sendResponse({ videoCount: 0, videoIds: [], videos: [], lastSync: 0, needsRefresh: true });
    });
    return true;
  }

  if (message.action === 'syncMissingDurations') {
    syncMissingDurations().then((count) => {
      sendResponse({ status: 'ok', updated: count });
    }).catch((error) => {
      console.error('[JumpKey BG] Error in syncMissingDurations handler:', error);
      sendResponse({ status: 'error', error: String(error) });
    });
    return true;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleRuntimeMessage(message, sender, sendResponse).catch((err) => {
    console.error('[JumpKey BG] runtime.onMessage handler error:', err);
    try {
      sendResponse({ success: false, status: 'error', message: String(err) });
    } catch (sendErr) {
      console.error('[JumpKey BG] Failed to send error response:', sendErr);
    }
  });
  return true;
});

// On startup, try to sync any missing durations
(async () => {
  try {
    await syncMissingDurations({ maxToFetch: 25 });
  } catch (err) {
    console.warn('[JumpKey BG] startup maintenance failed:', err);
  }
})();

setInterval(() => {
  syncMissingDurations({ maxToFetch: 25 }).catch((err) => {
    console.warn('[JumpKey BG] periodic syncMissingDurations failed:', err);
  });
}, 10 * 60 * 1000); // every 10 minutes

async function handleSwitchToTab(targetTab) {
  try {
    console.log('[JumpKey BG] handleSwitchToTab called, targetTab:', targetTab?.id, targetTab?.url);
    
    if (!targetTab || !targetTab.id) {
      console.error('[JumpKey BG] No target tab available');
      return;
    }

    const settings = await getSettings();
    console.log('[JumpKey BG] handleSwitchToTab settings:', settings);
    const targetType = isShortsUrl(targetTab.url) ? 'short' : 'long';
    console.log('[JumpKey BG] Target type:', targetType);

    // Activate the target tab
    console.log('[JumpKey BG] Activating tab:', targetTab.id);
    await updateTab(targetTab.id, { active: true });

    if (targetTab.windowId != null) {
      console.log('[JumpKey BG] Focusing window:', targetTab.windowId);
      await focusWindow(targetTab.windowId);
    }

    // Apply fullscreen if enabled
    console.log('[JumpKey BG] fullscreenOnSwitch:', settings.fullscreenOnSwitch, 'windowId:', targetTab?.windowId);
    if (settings.fullscreenOnSwitch && targetTab.windowId != null) {
      console.log('[JumpKey BG] fullscreenOnSwitch ACTIVE - attempting to activate fullscreen');

      // Activate fullscreen ASAP: focus window/tab first, then set fullscreen immediately
      try {
        // ensure target tab is active and window focused
        console.log('[JumpKey BG] Ensuring tab active and window focused before fullscreen');
        await updateTab(targetTab.id, { active: true });
        await focusWindow(targetTab.windowId);
      } catch (err) {
        console.warn('[JumpKey BG] Error activating/focusing tab before fullscreen:', err);
      }

      // Ensures tab is loaded
      const isLoaded = await ensureTabIsLoaded(targetTab.id);
      if (isLoaded) {
        // Wait the content script to be ready before resizing to fullscreen
        const contentReady = await waitForContentReady(targetTab.id, 2000, 150);
        if (!contentReady) {
          console.warn('[JumpKey BG] Content script did not respond to ping before fullscreen');
        } else {
          console.log('[JumpKey BG] Content script ready before fullscreen');
        }
        console.log('[JumpKey BG] Activating window fullscreen...');
        // Let the browser render the newly activated tab before resizing the window
        await sleep(160);
        const newWindow = await setWindowStateWithRetry(targetTab.windowId, 'fullscreen');
        console.log('[JumpKey BG] Window after setWindowState:', newWindow && { id: newWindow.id, state: newWindow.state });
        // Try extra toggles to make fullscreen visible on some OS/window-managers
        if (!newWindow || newWindow.state !== 'fullscreen') {
          try {
            const vis = await attemptVisibleFullscreen(targetTab.windowId);
            if (vis) console.log('[JumpKey BG] attemptVisibleFullscreen result:', { id: vis.id, state: vis.state });
            if (!vis || vis.state !== 'fullscreen') {
              const byBounds = await attemptFullscreenByBounds(targetTab.windowId);
              if (byBounds) console.log('[JumpKey BG] attemptFullscreenByBounds result:', { id: byBounds.id, state: byBounds.state });
            }
          } catch (err) {
            console.warn('[JumpKey BG] attemptVisibleFullscreen errored:', err);
          }
        }
          // Small delay to let window manager and renderer stabilize before content checks
          await sleep(300);

          try {
        await focusWindow(targetTab.windowId);
        console.log('[JumpKey BG] Focused window after fullscreen:', targetTab.windowId);
      } catch (focusErr) {
        console.warn('[JumpKey BG] Failed to focus window after fullscreen:', focusErr);
      }

      // Short pause to let window manager settle, then notify content script
      await new Promise(resolve => setTimeout(resolve, 50));

      const fullscreenAction = targetType === 'long' ? 'setLongVideoFullscreen' : 'setReelFullscreen';
      console.log('[JumpKey BG] Sending message to tab:', targetTab.id, 'action:', fullscreenAction, 'enabled: true');
      const msgResult = await sendMessageToTab(targetTab.id, { action: fullscreenAction, enabled: true });

        // Fallback: if content script didn't apply fullscreen or to be more robust,
        // inject a small script that applies the expanded CSS directly in the page.
        try {
          console.log('[JumpKey BG] Injecting fallback fullscreen script into tab:', targetTab.id);
          await chrome.scripting.executeScript({
            target: { tabId: targetTab.id },
            func: (type) => {
              try {
                const id = 'js-shorts-fullscreen-fix';
                if (!document.getElementById(id)) {
                  const style = document.createElement('style');
                  style.id = id;
                  style.textContent = `
                    #masthead-container, ytd-mini-guide-renderer, #guide, .ytd-shorts-player-controls { display: none !important; }
                    ytd-shorts { --ytd-shorts-player-height: 100vh; --ytd-shorts-player-width: 100vw; }
                    ytd-reel-video-renderer, .video-container.ytd-reel-video-renderer, #player-container.ytd-reel-video-renderer { width: 100% !important; height: 100% !important; max-width: none !important; max-height: none !important; }
                    #page-manager.ytd-app, ytd-shorts, #contentContainer.ytd-shorts, ytd-shorts #shorts-container.ytd-shorts { margin-top: 0 !important; padding: 0 !important; width: 100vw !important; height: 100vh !important; }
                  `;
                  document.head && document.head.appendChild(style);
                }

                const app = document.querySelector('ytd-app');
                if (app) {
                  app.removeAttribute('opened');
                  app.removeAttribute('mini-guide-visible');
                  app.setAttribute('masthead-hidden', '');
                }
                const mast = document.getElementById('masthead-container');
                if (mast) mast.style.display = 'none';
              } catch (err) {
                // swallow
              }
            },
            args: [targetType]
          });
          console.log('[JumpKey BG] Fallback injection done');
        } catch (injectErr) {
          console.warn('[JumpKey BG] Fallback injection failed:', injectErr);
        }
      } else {
        console.error('[JumpKey BG] Failed to ensure tab was loaded');
      }
    } else {
      console.log('[JumpKey BG] fullscreenOnSwitch not active or windowId is null');
    }
  } catch (error) {
    console.error('[JumpKey BG] Error in handleSwitchToTab:', error);
  }
}

async function getSwitchQueue() {
  const settings = await getSettings();
  const tabs = await queryTabs({ active: true, currentWindow: true });
  const currentTab = Array.isArray(tabs) ? tabs[0] : null;

  const shortsTabs = await queryTabs({ url: SHORTS_QUERY });
  const otherShorts = shortsTabs.filter((tab) => tab.id !== currentTab?.id && tab.id != null);

  const longVideoTabs = await queryTabs({ url: LONG_VIDEO_QUERY });
  const otherLongVideos = longVideoTabs.filter((tab) => tab.id !== currentTab?.id && tab.id != null && isLongVideoUrl(tab.url) && !isShortsUrl(tab.url));

  const openCandidates = [];
  const openCandidateIds = new Set();

  if (settings.sourceShortsTabs) {
    for (const tab of otherShorts) {
      const videoId = extractVideoIdFromUrl(tab.url || '');
      if (!videoId || openCandidateIds.has(videoId)) continue;
      openCandidateIds.add(videoId);
      openCandidates.push({ tab, type: 'short' });
    }
  }

  if (settings.sourceWatchTabs) {
    for (const tab of otherLongVideos) {
      const videoId = extractVideoIdFromUrl(tab.url || '');
      if (!videoId || openCandidateIds.has(videoId)) continue;
      openCandidateIds.add(videoId);
      openCandidates.push({ tab, type: 'long' });
    }
  }

  const currentVideoId = extractVideoIdFromUrl(currentTab?.url || '');
  const durationsCached = await getVideoDurations();
  let candidatesWithMeta = openCandidates
    .map((item) => {
      const videoId = extractVideoIdFromUrl(item.tab.url || '');
      if (!videoId || videoId === currentVideoId) return null;

      return {
        id: item.tab.id,
        tab: item.tab,
        url: item.tab.url,
        source: 'tab',
        type: item.type,
        videoId,
        title: item.tab.title || `Open Tab • ${videoId}`,
        duration: Number.isFinite(Number(durationsCached[videoId])) && Number(durationsCached[videoId]) > 0
          ? Number(durationsCached[videoId])
          : null,
        isShort: item.type === 'short',
        audible: Boolean(item.tab.audible),
        lastAccessed: Number.isFinite(Number(item.tab.lastAccessed)) ? Number(item.tab.lastAccessed) : 0
      };
    })
    .filter(Boolean);

  const globallySeenVideoIds = await getAllSeenVideoIds();
  const freshCandidates = candidatesWithMeta.filter((item) => item && item.videoId && !globallySeenVideoIds.has(item.videoId));
  if (freshCandidates.length > 0) {
    candidatesWithMeta = freshCandidates;
  }

  candidatesWithMeta.sort((a, b) => {
    const da = getDurationSortValueForSwitch(a);
    const db = getDurationSortValueForSwitch(b);
    if (da !== db) return da - db;

    const audibleA = a.audible ? 0 : 1;
    const audibleB = b.audible ? 0 : 1;
    if (audibleA !== audibleB) return audibleA - audibleB;

    return b.lastAccessed - a.lastAccessed;
  });

  return candidatesWithMeta;
}

async function handleSwitchShorts(currentTab) {
  let __jj_lock_release;
  let __jj_windowKey;
  try {
    const opId = Date.now() + '-' + Math.random().toString(36).slice(2);
    console.log('[JumpKey BG] handleSwitchShorts called, currentTab:', currentTab?.id, currentTab?.url);
    console.log('[JumpKey BG] handleSwitchShorts opId:', opId);
    if (!currentTab || !currentTab.id) {
      console.error('No current tab available');
      chrome.tabs.create({ url: SHORTS_HOME, active: true });
      return;
    }

    // Acquire a simple per-window lock to avoid overlapping switch operations
    __jj_windowKey = currentTab?.windowId != null ? `w-${currentTab.windowId}` : `t-${currentTab.id}`;
    if (windowOperationLocks.has(__jj_windowKey)) {
      console.log('[JumpKey BG] Another operation in progress for window, waiting for it to finish before proceeding:', __jj_windowKey);
      try { await windowOperationLocks.get(__jj_windowKey); } catch (e) { /* ignore */ }
    }
    let __jj_res;
    const __jj_lock = new Promise((res) => { __jj_res = res; });
    __jj_lock_release = __jj_res;
    windowOperationLocks.set(__jj_windowKey, __jj_lock);

    const settings = await getSettings();
    
    console.log('[JumpKey BG] Settings:', settings);
    
    const currentIsShort = isShortsUrl(currentTab.url);
    const currentIsYoutube = isYoutubeUrl(currentTab.url);
    const currentVideoId = extractVideoIdFromUrl(currentTab.url);
    console.log('[JumpKey BG] Current tab is short:', currentIsShort);
    console.log('[JumpKey BG] Current tab is youtube:', currentIsYoutube);
    console.log('[JumpKey BG] Current video ID:', currentVideoId);
    
    const shortsTabs = await queryTabs({ url: SHORTS_QUERY });
    console.log('[JumpKey BG] Found shorts tabs:', shortsTabs.length);
    
    const otherShorts = shortsTabs.filter((tab) => tab.id !== currentTab.id && tab.id != null);
    const longVideoTabs = await queryTabs({ url: LONG_VIDEO_QUERY });
    const otherLongVideos = longVideoTabs.filter(
      (tab) => tab.id !== currentTab.id && tab.id != null && isLongVideoUrl(tab.url) && !isShortsUrl(tab.url)
    );

    const prioritizeAudibleTabs = (tabs) => {
      const sorted = [...tabs];
      sorted.sort((a, b) => {
        const audibleA = Boolean(a.audible);
        const audibleB = Boolean(b.audible);
        if (audibleA !== audibleB) {
          return audibleB ? 1 : -1;
        }

        const lastAccessedA = typeof a.lastAccessed === 'number' ? a.lastAccessed : 0;
        const lastAccessedB = typeof b.lastAccessed === 'number' ? b.lastAccessed : 0;
        return lastAccessedB - lastAccessedA;
      });
      return sorted;
    };

    const openCandidates = [];
    const openCandidateIds = new Set();

    if (settings.sourceShortsTabs) {
      for (const tab of otherShorts) {
        const videoId = extractVideoIdFromUrl(tab.url || '');
        if (!videoId || openCandidateIds.has(videoId)) continue;
        openCandidateIds.add(videoId);
        openCandidates.push({ tab, type: 'short' });
      }
    }
    if (settings.sourceWatchTabs) {
      for (const tab of otherLongVideos) {
        const videoId = extractVideoIdFromUrl(tab.url || '');
        if (!videoId || openCandidateIds.has(videoId)) continue;
        openCandidateIds.add(videoId);
        openCandidates.push({ tab, type: 'long' });
      }
    }

    let targetTab = null;
    let targetType = null;

    if (openCandidates.length > 0) {
      const seenVideoIds = new Set();
      const durationsCached = await getVideoDurations();

      const currentVideoId = extractVideoIdFromUrl(currentTab.url);
      const candidatesWithMeta = openCandidates
        .map((item) => {
          const videoId = extractVideoIdFromUrl(item.tab.url);
          if (!videoId || videoId === currentVideoId || seenVideoIds.has(videoId)) return null;
          seenVideoIds.add(videoId);

          const cachedDuration = Number.isFinite(Number(durationsCached[videoId])) && Number(durationsCached[videoId]) > 0
            ? Number(durationsCached[videoId])
            : null;

          return {
            ...item,
            videoId,
            duration: cachedDuration,
            audible: Boolean(item.tab.audible),
            lastAccessed: Number.isFinite(Number(item.tab.lastAccessed)) ? Number(item.tab.lastAccessed) : 0
          };
        })
        .filter(Boolean);

      if (candidatesWithMeta.length > 0) {
        const globallySeenVideoIds = await getAllSeenVideoIds();

        // In cross-window/tab switching, avoid repeating videos recently watched.
        const freshCandidates = candidatesWithMeta.filter((item) => {
          const videoId = item && item.videoId;
          if (!videoId) return false;
          if (globallySeenVideoIds.has(videoId)) {
            console.log('[JumpKey BG] Skipping already-seen video candidate:', videoId, 'tab:', item.tab?.id);
            return false;
          }
          return true;
        });

        if (freshCandidates.length > 0) {
          candidatesWithMeta.length = 0;
          candidatesWithMeta.push(...freshCandidates);
        }

        // Sort by duration (with fallback for unknown durations), then audible and recency.
        candidatesWithMeta.sort((a, b) => {
          const da = getDurationSortValueForSwitch(a);
          const db = getDurationSortValueForSwitch(b);
          if (da !== db) return da - db;

          const audibleA = a.audible ? 0 : 1;
          const audibleB = b.audible ? 0 : 1;
          if (audibleA !== audibleB) return audibleA - audibleB;

          return b.lastAccessed - a.lastAccessed;
        });

        if (candidatesWithMeta.length > 0) {
          targetTab = candidatesWithMeta[0].tab;
          targetType = candidatesWithMeta[0].type;
        }

        // Update duration cache async for candidates without known duration (no blocking path)
        (async () => {
          for (const candidate of candidatesWithMeta) {
            if (candidate.videoId && !candidate.duration) {
              try {
                const d = await getDurationFromTab(candidate.tab);
                if (d) {
                  await storeVideoDuration(candidate.videoId, d);
                }
              } catch (e) {
                console.warn('[JumpKey BG] Async duration fetch failed:', e);
              }
            }
          }
        })();
      }
    }

    if (targetTab) {

      if (currentIsYoutube) {
        const fadeDurationMs = 400;
        const fadeSteps = 10;
        const keepOldTabAlive = (currentTab.windowId != null && targetTab.windowId != null && currentTab.windowId !== targetTab.windowId);

        const mutePreviousTab = async () => {
          try {
            const existing = await getTab(currentTab.id).catch(() => null);
            if (!existing) {
              return;
            }
            await updateTab(currentTab.id, { muted: true });
            console.log('[JumpKey BG] Muted previous youtube tab:', currentTab.id);
          } catch (muteError) {
            console.warn('[JumpKey BG] Failed to mute previous tab:', muteError);
          }
        };

        // Schedule a tab-mute at the end of the fade-out (so the fade remains audible) only when we plan to close old tab.
        let fadeMuteTimer;
        if (!keepOldTabAlive) {
          fadeMuteTimer = setTimeout(() => {
            mutePreviousTab();
          }, fadeDurationMs + 50);
        }

        const fadeOutPromise = sendMessageToTab(currentTab.id, {
          action: 'fadeOutAudio',
          durationMs: fadeDurationMs,
          steps: fadeSteps,
          opId
        });

        // If fade-out fails (e.g. tab is too heavy / message can't be delivered), mute immediately only when tab will be closed.
        fadeOutPromise.then((success) => {
          if (!success) {
            if (fadeMuteTimer) {
              clearTimeout(fadeMuteTimer);
            }
            if (!keepOldTabAlive) {
              mutePreviousTab();
            }
          }
        });

        await updateTab(targetTab.id, { active: true });

        if (targetTab.windowId != null) {
          await focusWindow(targetTab.windowId);
        }

        if (settings.fullscreenOnSwitch && targetTab.windowId != null) {
          console.log('[JumpKey BG] fullscreenOnSwitch ACTIVE - attempting to activate fullscreen');
          const isLoaded = await ensureTabIsLoaded(targetTab.id);

          if (isLoaded) {
            const contentReady = await waitForContentReady(targetTab.id, 2000, 150);
            if (!contentReady) {
              console.warn('[JumpKey BG] Content script did not respond to ping before fullscreen');
            } else {
              console.log('[JumpKey BG] Content script ready before fullscreen');
            }

            await sleep(160);
            const newWindow = await setWindowStateWithRetry(targetTab.windowId, 'fullscreen');
            console.log('[JumpKey BG] Window after setWindowState:', newWindow && { id: newWindow.id, state: newWindow.state });
            if (!newWindow || newWindow.state !== 'fullscreen') {
              try {
                const vis = await attemptVisibleFullscreen(targetTab.windowId);
                if (vis) console.log('[JumpKey BG] attemptVisibleFullscreen result:', { id: vis.id, state: vis.state });
                if (!vis || vis.state !== 'fullscreen') {
                  const byBounds = await attemptFullscreenByBounds(targetTab.windowId);
                  if (byBounds) console.log('[JumpKey BG] attemptFullscreenByBounds result:', { id: byBounds.id, state: byBounds.state });
                }
              } catch (err) {
                console.warn('[JumpKey BG] attemptVisibleFullscreen errored:', err);
              }
            }

            try {
              await focusWindow(targetTab.windowId);
              console.log('[JumpKey BG] Focused window after fullscreen:', targetTab.windowId);
            } catch (focusErr) {
              console.warn('[JumpKey BG] Failed to focus window after fullscreen:', focusErr);
            }

            await sleep(300);

            const fullscreenAction = targetType === 'long' ? 'setLongVideoFullscreen' : 'setReelFullscreen';
            console.log('[JumpKey BG] Sending message to tab:', targetTab.id, 'action:', fullscreenAction, 'enabled: true', 'opId:', opId);
            await sendMessageToTab(targetTab.id, { action: fullscreenAction, enabled: true, opId });
          } else {
            console.error('[JumpKey BG] Failed to ensure tab was loaded');
          }
        } else {
          console.log('[JumpKey BG] fullscreenOnSwitch:', settings.fullscreenOnSwitch, 'windowId:', targetTab?.windowId);
        }

        // Close previous youtube tab when staying in same window; otherwise keep it alive and redirect to home.
        clearTimeout(fadeMuteTimer);

        const isCrossWindowSwitch =
          currentTab && targetTab &&
          typeof currentTab.windowId === 'number' &&
          typeof targetTab.windowId === 'number' &&
          currentTab.windowId !== targetTab.windowId;

        if (isCrossWindowSwitch) {
          console.log('[JumpKey BG] Cross-window switch detected: keeping previous tab open and navigating to default new tab page to avoid focus race:', currentTab.id);

          // Set suppression state before doing mutable operations.
          focusChangeSuppression.oldWindowId = currentTab.windowId;
          focusChangeSuppression.targetWindowId = targetTab.windowId;
          focusChangeSuppression.expiresAt = Date.now() + 5000; // 5s debounce

          // Mute and fade old tab audio immediately (before focus operations)
          try {
            await updateTab(currentTab.id, { muted: true });
            console.log('[JumpKey BG] Muted old cross-window tab immediately:', currentTab.id);
          } catch (muteErr) {
            console.warn('[JumpKey BG] Failed to mute old cross-window tab immediately:', muteErr);
          }

          try {
            await sendMessageToTab(currentTab.id, { action: 'fadeOutAudio', durationMs: 150, steps: 8, opId }, 1);
            console.log('[JumpKey BG] Requested fade out audio on old cross-window tab:', currentTab.id);
          } catch (_err) {
            // ignore silent failure; best effort.
          }

          // Unfullscreen the old window (if needed) to avoid the old focused fullscreen stealing focus.
          if (currentTab.windowId != null) {
            try {
              const oldWindow = await getWindow(currentTab.windowId);
              if (oldWindow && oldWindow.state === 'fullscreen') {
                console.log('[JumpKey BG] Unfullscreening old window before switching focus:', currentTab.windowId);
                await setWindowStateWithRetry(currentTab.windowId, 'normal');
              }
            } catch (err) {
              console.warn('[JumpKey BG] Could not unfullscreen old window:', err);
            }
          }

          // Ensure the target gets focus next, then nav old tab to the default new tab page.
          try {
            if (targetTab && targetTab.windowId != null) {
              await focusWindow(targetTab.windowId);
              await updateTab(targetTab.id, { active: true });
              await sleep(80);
              console.log('[JumpKey BG] Focused target window/tab before processing old tab:', targetTab.windowId, targetTab.id);
            }
          } catch (focusErr) {
            console.warn('[JumpKey BG] Failed to focus target tab/window before old tab redirect:', focusErr);
          }

          try {
            await updateTab(currentTab.id, { muted: true });
          } catch (muteError) {
            console.warn('[JumpKey BG] Failed to mute previous tab before redirect:', muteError);
          }

          try {
            await updateTab(currentTab.id, { url: DEFAULT_NEW_TAB_PAGE, active: false });
            console.log('[JumpKey BG] Previous tab redirected to default new tab page and inactive:', currentTab.id);
          } catch (err) {
            console.warn('[JumpKey BG] Failed to redirect previous tab to default new tab page:', err);
            try {
              await updateTab(currentTab.id, { url: DEFAULT_NEW_TAB_PAGE, active: false, muted: true });
            } catch (err2) {
              console.warn('[JumpKey BG] Fallback failed while redirecting previous tab:', err2);
            }
          }

          // Re-affirm focus on target after the old tab navigation to mitigate race
          try {
            await sleep(80);
            if (targetTab && targetTab.windowId != null) {
              await focusWindow(targetTab.windowId);
              console.log('[JumpKey BG] Re-focused target window after keeping old tab alive:', targetTab.windowId);
            }
            await updateTab(targetTab.id, { active: true });
            console.log('[JumpKey BG] Re-activated target tab after keeping old tab alive:', targetTab.id);
          } catch (focusErr) {
            console.warn('[JumpKey BG] Failed to re-focus target tab/window after old tab redirect:', focusErr);
          }

          // Final enforcement to catch any delayed focus race without blocking the switch.
          if (targetTab && targetTab.windowId != null) {
            setTimeout(async () => {
              try {
                const tabNow = await getTab(targetTab.id).catch(() => null);
                if (tabNow && !tabNow.active) {
                  await focusWindow(targetTab.windowId);
                  await updateTab(targetTab.id, { active: true });
                  console.log('[JumpKey BG] Final target focus enforcement after cross-window switch:', targetTab.windowId, targetTab.id);
                }
              } catch (enforceErr) {
                console.warn('[JumpKey BG] Final focus enforcement failed:', enforceErr);
              }
            }, 240);
          }

          // After a grace period, restore sound on old tab without changing focus.
          setTimeout(async () => {
            try {
              const tabNow = await getTab(currentTab.id).catch(() => null);
              if (tabNow && tabNow.id === currentTab.id && tabNow.url && tabNow.url.startsWith(YOUTUBE_HOME) && !tabNow.active) {
                await updateTab(currentTab.id, { muted: false });
                console.log('[JumpKey BG] Unmuted previous home tab after grace period:', currentTab.id);
              }
            } catch (unmuteErr) {
              console.warn('[JumpKey BG] Failed to unmute previous tab after grace period:', unmuteErr);
            }
          }, 5000);
        } else {
          console.log('[JumpKey BG] Closing previous youtube tab:', currentTab.id);
          try {
            const existing = await getTab(currentTab.id).catch(() => null);
            if (existing && existing.url === currentTab.url) {
              await removeTab(currentTab.id);
              console.log('[JumpKey BG] Previous tab closed:', currentTab.id);
            } else {
              console.warn('[JumpKey BG] Skipping close of previous tab due to mismatch or tab missing', { id: currentTab.id, existingUrl: existing?.url, expectedUrl: currentTab.url });
            }
          } catch (err) {
            console.warn('[JumpKey BG] Failed to remove previous tab:', err);
            try {
              await updateTab(currentTab.id, { muted: true, url: DEFAULT_NEW_TAB_PAGE });
              console.log('[JumpKey BG] Fallback: navigated previous tab to default new tab page and muted it:', currentTab.id);
            } catch (err2) {
              console.warn('[JumpKey BG] Fallback failed when trying to neutralize previous tab:', err2);
            }
          }
        }

        // Optional: log fade result when it completes, but don't block closure
        fadeOutPromise.then((fadeSucceeded) => {
          if (fadeSucceeded) {
            console.log('[JumpKey BG] Previous youtube tab audio faded out successfully (async):', currentTab.id);
          } else {
            console.warn('[JumpKey BG] Previous youtube tab fade-out failed (async):', currentTab.id);
          }
        });
      } else {
        await updateTab(targetTab.id, { active: true });

        if (targetTab.windowId != null) {
          await focusWindow(targetTab.windowId);
        }

        if (settings.fullscreenOnSwitch && targetTab.windowId != null) {
          console.log('[JumpKey BG] fullscreenOnSwitch ACTIVE - attempting to activate fullscreen');
          
          // Ensures tab is loaded
          const isLoaded = await ensureTabIsLoaded(targetTab.id);
          
          // Focus and activate tab/window first, then set fullscreen immediately
          try {
            await updateTab(targetTab.id, { active: true });
            await focusWindow(targetTab.windowId);
          } catch (err) {
            console.warn('[JumpKey BG] Error activating/focusing tab before fullscreen:', err);
          }

          console.log('[JumpKey BG] Activating (skipped) window fullscreen - using in-player fullscreen only');

          // Short pause and then notify content script
          // Small delay to reduce race where page still measures old window bounds
          await sleep(300);
          
          const fullscreenAction = targetType === 'long' ? 'setLongVideoFullscreen' : 'setReelFullscreen';
          console.log('[JumpKey BG] Sending message to tab:', targetTab.id, 'action:', fullscreenAction, 'enabled: true', 'opId:', opId);
          await sendMessageToTab(targetTab.id, { action: fullscreenAction, enabled: true, opId });
        
        } else {
          console.log('[JumpKey BG] fullscreenOnSwitch:', settings.fullscreenOnSwitch, 'windowId:', targetTab?.windowId);
        }
      }
    } else {
      // Fast-path: if we're already on Shorts and there are no other target tabs,
      // try to advance in-place immediately before any source/cache sync work.
      if (currentIsShort) {
        const advancedInPlaceFast = await sendMessageToTab(currentTab.id, {
          action: 'advanceToNextShort',
          maxAttempts: 3,
          intervalMs: 150,
          opId
        });

        if (advancedInPlaceFast) {
          console.log('[JumpKey BG] Fast-path advanced to next short in current tab');

          if (settings.fullscreenOnSwitch && currentTab.windowId != null) {
            await sleep(180);
            await sendMessageToTab(currentTab.id, { action: 'setReelFullscreen', enabled: true, opId });
          }

          setTimeout(updateBadge, 500);
          return;
        }

        console.warn('[JumpKey BG] Fast-path in-place advance failed; falling back to source selection flow');
      }

      // No other tabs found - randomly pick among enabled sources (Watch Later, Liked, Home), else fallback
      let targetUrl = getEmptyDestinationUrl(settings.emptyDestination);
      let isWatchLaterVideo = false;

      const enabledSources = [];
      if (settings.sourceWatchLater) enabledSources.push('watchLater');
      if (settings.sourceLikedVideos) enabledSources.push('liked');
      if (settings.sourceHomeVideos) enabledSources.push('homeVideos');
      if (settings.sourceHomeShorts) enabledSources.push('homeShorts');

      let selectedVideoObj = null;
      const openVideoIds = new Set(await getVideoIdsFromOpenTabs());

      // While we have enabled sources, pick one at random and try to get a video
      const sourcesPool = enabledSources.slice();
      while (sourcesPool.length > 0 && !selectedVideoObj) {
        const pickIndex = Math.floor(Math.random() * sourcesPool.length);
        const pick = sourcesPool.splice(pickIndex, 1)[0];
        try {
          if (pick === 'watchLater') {
            console.log('[JumpKey BG] Trying source: Watch Later');
            if (await needsWLCacheRefresh()) {
              console.log('[JumpKey BG] WL cache needs refresh, syncing...');
              await syncWatchLater(false).catch(() => {});
            }
            const vid = await getRandomVideoFromWLCache(openVideoIds);
            if (vid) {
            if (currentVideoId && vid === currentVideoId) {
              console.log('[JumpKey BG] Skipping Watch Later video because it is currently playing:', vid);
            } else {
              selectedVideoObj = { videoId: vid, url: `https://www.youtube.com/watch?v=${vid}` };
              isWatchLaterVideo = true;
              console.log('[JumpKey BG] Selected Watch Later video:', vid);
            }
          }
        } else if (pick === 'liked') {
            console.log('[JumpKey BG] Trying source: Liked Videos');
            if (await needsLikedCacheRefresh()) {
              console.log('[JumpKey BG] Liked cache needs refresh, syncing...');
              await syncLikedVideos(false).catch(() => {});
            }
            const liked = await getRandomLikedVideoFromCache(openVideoIds);
            if (liked && liked.videoId) {
              if (currentVideoId && liked.videoId === currentVideoId) {
                console.log('[JumpKey BG] Skipping liked video because it is currently playing:', liked.videoId);
              } else {
                selectedVideoObj = { videoId: liked.videoId, url: `https://www.youtube.com/watch?v=${liked.videoId}` };
                isWatchLaterVideo = true;
                console.log('[JumpKey BG] Selected Liked video:', liked.videoId);
              }
            }
          } else if (pick === 'homeVideos') {
            console.log('[JumpKey BG] Trying source: Home recommended videos');
            if (await needsHomeCacheRefresh()) {
              console.log('[JumpKey BG] Home cache needs refresh, syncing...');
              await syncHomeRandom(false).catch(() => {});
            }
            const homeVid = await getRandomHomeVideoFromCache(openVideoIds);
            if (homeVid && homeVid.videoId) {
              if (currentVideoId && homeVid.videoId === currentVideoId) {
                console.log('[JumpKey BG] Skipping home video because it is currently playing:', homeVid.videoId);
              } else {
                selectedVideoObj = { videoId: homeVid.videoId, url: `https://www.youtube.com/watch?v=${homeVid.videoId}` };
                isWatchLaterVideo = true;
                console.log('[JumpKey BG] Selected Home video:', homeVid.videoId);
              }
            }
          } else if (pick === 'homeShorts') {
            console.log('[JumpKey BG] Trying source: Home recommended shorts');
            if (await needsHomeCacheRefresh()) {
              console.log('[JumpKey BG] Home cache needs refresh, syncing...');
              await syncHomeRandom(false).catch(() => {});
            }
            const homeVid = await getRandomHomeShortFromCache(openVideoIds);
            if (homeVid && homeVid.videoId) {
              if (currentVideoId && homeVid.videoId === currentVideoId) {
                console.log('[JumpKey BG] Skipping home short because it is currently playing:', homeVid.videoId);
              } else {
                selectedVideoObj = { videoId: homeVid.videoId, url: `https://www.youtube.com/shorts/${homeVid.videoId}` };
                isWatchLaterVideo = false;
                console.log('[JumpKey BG] Selected Home short:', homeVid.videoId);
              }
            }
          }
        } catch (err) {
          console.warn('[JumpKey BG] Error trying source', pick, err);
        }
      }

      if (selectedVideoObj) {
        targetUrl = selectedVideoObj.url;
      } else {
        console.log('[JumpKey BG] No videos found from enabled sources, using configured fallback destination');
        targetUrl = getEmptyDestinationUrl(settings.emptyDestination);
        // If we're currently on a Shorts page, prefer navigating to /shorts (or advancing in-place)
        if (currentIsShort) {
          targetUrl = SHORTS_HOME;
          console.log('[JumpKey BG] Current tab is a Shorts page; forcing targetUrl to SHORTS_HOME to avoid navigating to home');
        }
      }

      // If fallback is /shorts and we are already on a Shorts tab, avoid a
      // pointless navigation/reload and just advance to the next short.
      if (!selectedVideoObj && currentIsShort && targetUrl === SHORTS_HOME) {
        // Try to advance in-place first (more attempts/time) before any navigation/closing.
        const advancedInPlace = await sendMessageToTab(currentTab.id, {
          action: 'advanceToNextShort',
          maxAttempts: 3,
          intervalMs: 150,
          opId
        });
        if (advancedInPlace) {
          console.log('[JumpKey BG] Advanced to next short in current tab instead of opening /shorts');

          if (settings.fullscreenOnSwitch && currentTab.windowId != null) {
            await sleep(180);
            await sendMessageToTab(currentTab.id, { action: 'setReelFullscreen', enabled: true, opId });
          }

          setTimeout(updateBadge, 500);
          return;
        }

        console.warn('[JumpKey BG] Failed to advance current short tab via message, attempting scripting.executeScript fallback');

        // As a stronger fallback, try to execute a script in the tab to click the next thumbnail/button
        try {
          if (chrome.scripting && chrome.scripting.executeScript) {
            const execResult = await chrome.scripting.executeScript({
              target: { tabId: currentTab.id },
              func: function () {
                try {
                  const sel = 'ytd-reel-video-renderer[is-active] a#thumbnail, ytd-reel-video-renderer[is-active] a';
                  const nextAnchor = document.querySelector(sel);
                  if (nextAnchor && typeof nextAnchor.click === 'function') {
                    nextAnchor.click();
                    return true;
                  }
                  const nextBtn = document.querySelector('button[aria-label*="Next" i]');
                  if (nextBtn && typeof nextBtn.click === 'function') {
                    nextBtn.click();
                    return true;
                  }
                } catch (e) {
                  // swallow
                }
                return false;
              }
            });

            if (Array.isArray(execResult) && execResult[0] && execResult[0].result) {
              console.log('[JumpKey BG] executeScript succeeded advancing to next short in current tab');
              setTimeout(updateBadge, 500);
              return;
            }
          }
        } catch (e) {
          console.warn('[JumpKey BG] scripting.executeScript fallback failed:', e);
        }

        console.warn('[JumpKey BG] All in-place advance attempts failed; will navigate current tab to /shorts as fallback');
      }

      // Avoid unnecessary navigation if the current tab already matches the target URL
      try {
        const currentCheck = await getTab(currentTab.id).catch(() => null);
        const currentUrlNow = currentCheck && typeof currentCheck.url === 'string' ? currentCheck.url : '';
        if (currentUrlNow === targetUrl) {
          console.log('[JumpKey BG] Current tab already at target URL, activating without navigation:', targetUrl);
          await updateTab(currentTab.id, { active: true });
        } else {
          await updateTab(currentTab.id, { url: targetUrl, active: true });
        }
      } catch (e) {
        console.warn('[JumpKey BG] Error while checking current tab before navigation:', e);
        await updateTab(currentTab.id, { url: targetUrl, active: true }).catch(() => {});
      }

      if (settings.fullscreenOnSwitch && currentTab.windowId != null) {
        console.log('[JumpKey BG] Activating window fullscreen after navigating to', isWatchLaterVideo ? 'Watch Later video' : 'SHORTS_HOME');

        const isLoaded = await ensureTabIsLoaded(currentTab.id);

        if (isLoaded) {
          // Focus and activate current tab/window first, then set fullscreen
          try {
            await updateTab(currentTab.id, { active: true });
            await focusWindow(currentTab.windowId);
          } catch (err) {
            console.warn('[JumpKey BG] Error activating/focusing current tab before fullscreen:', err);
          }

          console.log('[JumpKey BG] Activating fullscreen...');
          // Ensure content script ready on the destination page before fullscreen
          const contentReady = await waitForContentReady(currentTab.id, 2000, 150);
          if (!contentReady) console.warn('[JumpKey BG] Content script did not respond to ping before fullscreen');
          // Small pause so navigation/activation completes visually
          await sleep(160);
          const newWindow = await setWindowStateWithRetry(currentTab.windowId, 'fullscreen');
          console.log('[JumpKey BG] Window after setWindowState:', newWindow && { id: newWindow.id, state: newWindow.state });
          if (!newWindow || newWindow.state !== 'fullscreen') {
            try {
              const vis = await attemptVisibleFullscreen(currentTab.windowId);
              if (vis) console.log('[JumpKey BG] attemptVisibleFullscreen result:', { id: vis.id, state: vis.state });
              if (!vis || vis.state !== 'fullscreen') {
                const byBounds = await attemptFullscreenByBounds(currentTab.windowId);
                if (byBounds) console.log('[JumpKey BG] attemptFullscreenByBounds result:', { id: byBounds.id, state: byBounds.state });
              }
            } catch (err) {
              console.warn('[JumpKey BG] attemptVisibleFullscreen errored:', err);
            }
          }
          try {
            await focusWindow(currentTab.windowId);
            console.log('[JumpKey BG] Focused window after fullscreen:', currentTab.windowId);
          } catch (focusErr) {
            console.warn('[JumpKey BG] Failed to focus window after fullscreen:', focusErr);
          }

          // Short pause and then notify content script
          await new Promise(resolve => setTimeout(resolve, 50));

          console.log('[JumpKey BG] Sending fullscreen to current tab:', currentTab.id);
          // Allow window manager to settle before messaging content script
          await sleep(300);
          
          // Use appropriate fullscreen action based on content type
          const fullscreenAction = isWatchLaterVideo ? 'setLongVideoFullscreen' : 'setReelFullscreen';
          await sendMessageToTab(currentTab.id, { action: fullscreenAction, enabled: true, opId });
        }
      }
    }

    setTimeout(updateBadge, 500);
  } catch (error) {
    console.error('Error in handleSwitchShorts:', error);
  } finally {
    try { if (typeof __jj_lock_release === 'function') __jj_lock_release(); } catch (e) {}
    try { if (typeof __jj_windowKey !== 'undefined') windowOperationLocks.delete(__jj_windowKey); } catch (e) {}
  }
}

scheduleBadgeUpdate(0);

// ============================================================
// 🚀 STARTUP: Initialize Watch Later cache
// ============================================================
(async () => {
  try {
    const settings = await getSettings();

    await closeStalePlaylistSyncTabs();

    if (settings.sourceWatchLater) {
      console.log('[JumpKey BG] Checking Watch Later cache on startup...');
      
      const needsRefresh = await needsWLCacheRefresh();
        if (needsRefresh) {
        console.log('[JumpKey BG] Performing initial Watch Later sync...');
        // Delay to avoid competing with other startup tasks
        setTimeout(() => syncWatchLater(true), 3000);
      } else {
        const cache = await getWatchLaterCache();
        console.log('[JumpKey BG] Watch Later cache ready:', cache.videoIds.length, 'videos');
      }
    }

    console.log('[JumpKey BG] Checking Liked Videos cache on startup...');
    const likedNeedsRefresh = await needsLikedCacheRefresh();
    if (likedNeedsRefresh) {
      setTimeout(() => syncLikedVideos(true), 4500);
    } else {
      const likedCache = await getLikedVideosCache();
      console.log('[JumpKey BG] Liked cache ready:', likedCache.videoIds.length, 'videos');
    }
  } catch (error) {
    console.error('[JumpKey BG] Error initializing Watch Later:', error);
  }
})();
