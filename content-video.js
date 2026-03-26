// SVGs idênticos aos da extensão youtube-like-dislike-shortcut, tamanho padrão do YouTube (96x96)
const SVG_LIKE = `<svg width="96" height="96" viewBox="0 0 24 24" focusable="false" xmlns="http://www.w3.org/2000/svg"><path fill="white" d="M3,11h3v10H3V11z M18.77,11h-4.23l1.52-4.94C16.38,5.03,15.54,4,14.38,4c-0.58,0-1.14,0.24-1.52,0.65L7,11v10h10.43 c1.06,0,1.98-0.67,2.19-1.61l1.34-6C21.23,12.15,20.18,11,18.77,11z"/></svg>`;
const SVG_DISLIKE = `<svg width="96" height="96" viewBox="0 0 24 24" focusable="false" xmlns="http://www.w3.org/2000/svg"><path fill="white" d="M17,4h-1H6.57C5.5,4,4.59,4.67,4.38,5.61l-1.34,6C2.77,12.85,3.82,14,5.23,14h4.23l-1.52,4.94C7.62,19.97,8.46,21,9.62,21 c0.58,0,1.14-0.24,1.52-0.65L17,14h4V4H17z M10.4,19.67C10.21,19.88,9.92,20,9.62,20c-0.26,0-0.5-0.11-0.63-0.3 c-0.07-0.1-0.15-0.26-0.09-0.47l1.52-4.94l0.4-1.29H9.46H5.23c-0.41,0-0.77-0.28-0.86-0.68l1.34-6C5.81,5.15,6.16,5,6.57,5H16v8.59 l-4.08,4.43C11.7,18.21,11.07,18.44,10.4,19.67z"/></svg>`;

function showIndicator(isLike) {
  if (typeof(window.findPlayerContainer) !== 'function' && typeof(window.findPlayerContainer) === 'function') {
    window.findPlayerContainer = findPlayerContainer;
  }
  let player = findPlayerContainer();
  const usePageOverlay = !player;
  if (usePageOverlay) {
    // Some YouTube layouts (watch pages) may not expose a stable player container,
    // so fall back to a fixed overlay in the viewport.
    player = document.body;
  }

  let overlay = player.querySelector('.jumpkey-thumb-indicator');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'jumpkey-thumb-indicator';
    overlay.style.position = usePageOverlay ? 'fixed' : 'absolute';
    overlay.style.left = '50%';
    overlay.style.top = '50%';
    overlay.style.transform = 'translate(-50%, -50%)';
    overlay.style.zIndex = '9999';
    overlay.style.pointerEvents = 'none';
    overlay.style.transition = 'opacity 0.3s';
    overlay.style.opacity = '0';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.padding = '2.5%';
    overlay.style.borderRadius = '50%';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
    player.appendChild(overlay);
  }
  overlay.innerHTML = isLike ? SVG_LIKE : SVG_DISLIKE;
  overlay.style.opacity = '1';

  // Remove após 900ms
  setTimeout(() => {
    overlay.style.opacity = '0';
    setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 350);
  }, 900);
}

// ==== GARANTE VARIÁVEIS GLOBAIS NO TOPO ====
let outOfMemoryCheckTimeout;
const jumpKeyGlobalState = window.__jumpKeyGlobalState || (window.__jumpKeyGlobalState = {
  initialized: false,
  keydownHandler: null,
  storageHandler: null,
  popstateHandler: null,
  hashchangeHandler: null,
  pagehideHandler: null,
  ytNavigationHandler: null,
  resizeHandler: null,
  fullscreenchangeHandler: null,
  DOMContentLoadedHandler: null,
  loadHandler: null,
  cssObserver: null,
  videoObserver: null
});

let lastAppliedExpandedAt = 0;
let shortsModeActive = false;
let longVideoModeActive = false;
let fullscreenExitValidation = null;
let customStyle = null;
let longVideoStyle = null;
let observedRootNode = null;
let blockedTags = window.__jumpKeyBlockedTags || (window.__jumpKeyBlockedTags = []);
let currentVideoId = null;
let pendingVideoReportTimeout = null;
let pendingVideoReportRaf = null;

console.log('[JumpKey] ========== CONTENT SCRIPT LOADED ==========');
console.log('[JumpKey] URL:', window.location.href);
console.log('[JumpKey] document.readyState:', document.readyState);

// ========== ESC para sair do fullscreen da janela ==========
function handleEscToExitFullscreen(event) {
  if (event.key === 'Escape' && !isInputElement(document.activeElement)) {
    try {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch((e) => {
          console.warn('[JumpKey] Error exiting native fullscreen:', e);
        });
      } else if (isLikelyWindowFullscreen()) {
        // Se a janela já está em tamanho fullscreen (F11/local), sair
        if (chrome.windows && chrome.windows.getCurrent && chrome.windows.update) {
          chrome.windows.getCurrent((win) => {
            if (win && win.state && win.state !== 'normal') {
              chrome.windows.update(win.id, { state: 'normal' }, (updated) => {
                if (chrome.runtime.lastError) {
                  console.warn('[JumpKey] Falha ao restaurar janela normal:', chrome.runtime.lastError);
                } else {
                  console.log('[JumpKey] Janela restaurada para normal após ESC');
                }
              });
            }
          });
        }
      }
    } catch (e) {
      console.warn('[JumpKey] handleEscToExitFullscreen fallback error:', e);
    }

    // Restaurar janela maximizada ao sair do fullscreen nativo
    if (document.fullscreenElement === null) {
      try {
        chrome.windows && chrome.windows.getCurrent && chrome.windows.update && chrome.windows.getCurrent((win) => {
          if (win && win.state !== 'maximized') {
            chrome.windows.update(win.id, { state: 'maximized' });
            console.log('[JumpKey] Janela restaurada para maximizada após ESC/fullscreen');
          }
        });
      } catch (e) {
        console.warn('[JumpKey] Falha ao restaurar janela maximizada:', e);
      }
    }
  }
}

// Adiciona o listener apenas uma vez
if (!jumpKeyGlobalState.keydownHandlerEscFullscreen) {
  jumpKeyGlobalState.keydownHandlerEscFullscreen = handleEscToExitFullscreen;
  document.addEventListener('keydown', handleEscToExitFullscreen, true);
}

if (jumpKeyGlobalState.initialized) {
  console.warn('[JumpKey] Duplicate content script init detected; cleaning old listeners/observers.');
  
  // Cleanup old listeners to prevent accumulation
  if (jumpKeyGlobalState.resizeHandler) {
    window.removeEventListener('resize', jumpKeyGlobalState.resizeHandler);
  }
  if (jumpKeyGlobalState.fullscreenchangeHandler) {
    document.removeEventListener('fullscreenchange', jumpKeyGlobalState.fullscreenchangeHandler);
  }
  if (jumpKeyGlobalState.DOMContentLoadedHandler) {
    window.removeEventListener('DOMContentLoaded', jumpKeyGlobalState.DOMContentLoadedHandler);
  }
  if (jumpKeyGlobalState.loadHandler) {
    window.removeEventListener('load', jumpKeyGlobalState.loadHandler);
  }
  if (jumpKeyGlobalState.keydownHandler) {
    document.removeEventListener('keydown', jumpKeyGlobalState.keydownHandler);
  }
  if (jumpKeyGlobalState.popstateHandler) {
    window.removeEventListener('popstate', jumpKeyGlobalState.popstateHandler);
  }
  if (jumpKeyGlobalState.hashchangeHandler) {
    window.removeEventListener('hashchange', jumpKeyGlobalState.hashchangeHandler);
  }
  if (jumpKeyGlobalState.ytNavigationHandler) {
    window.removeEventListener('yt-navigate-finish', jumpKeyGlobalState.ytNavigationHandler);
  }
  if (jumpKeyGlobalState.pagehideHandler) {
    window.removeEventListener('pagehide', jumpKeyGlobalState.pagehideHandler);
  }
  if (jumpKeyGlobalState.cssObserver) {
    jumpKeyGlobalState.cssObserver.disconnect();
  }
  if (jumpKeyGlobalState.videoObserver) {
    jumpKeyGlobalState.videoObserver.disconnect();
  }
  if (jumpKeyGlobalState.watchObserver) {
    try { jumpKeyGlobalState.watchObserver.disconnect(); } catch (e) {}
    jumpKeyGlobalState.watchObserver = null;
  }
  if (jumpKeyGlobalState.watchInterval) {
    try { clearInterval(jumpKeyGlobalState.watchInterval); } catch (e) {}
    jumpKeyGlobalState.watchInterval = null;
  }
  
  // Cleanup pending timeouts
  if (pendingVideoReportTimeout) {
    clearTimeout(pendingVideoReportTimeout);
    pendingVideoReportTimeout = null;
  }
  if (pendingVideoReportRaf) {
    cancelAnimationFrame(pendingVideoReportRaf);
    pendingVideoReportRaf = null;
  }
  if (fullscreenExitValidation) {
    clearTimeout(fullscreenExitValidation);
    fullscreenExitValidation = null;
  }
  if (outOfMemoryCheckTimeout) {
    clearTimeout(outOfMemoryCheckTimeout);
    outOfMemoryCheckTimeout = null;
  }
}

jumpKeyGlobalState.initialized = true;

function isInputElement(element) {
  if (!element || !element.tagName) {
    return false;
  }

  const tagName = element.tagName.toLowerCase();
  const isEditable = element.isContentEditable;
  const isInput = tagName === 'input' || tagName === 'textarea';
  const isSelect = tagName === 'select';

  return isInput || isEditable || isSelect;
}

// ícone em data URL (24x24) usado pelo CRX original para o overlay de Shorts
const ICON_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAEE0lEQVR4Aa3By4uddx3H8ffn9zznas7MdDJRImZCQzXYTaBQK0IR1xIFBf8FXYgLV4pFvEREd6VQ6oW4aFcFseBCcKUWK8WA1pqkCIoR2iZN0jMznjOZ8zy/3/fjOSeXTp2pN3y9xD67b7ypvYuXRvXlVzZ05cq6oqwymY40mx3RdNJ1p9u1hFIKSmnodqfR709YW90uo9Wb+YFTN3qPPDIebR4P7hBzky9+6dE0Hj+Wrl//kCaTVYGwUUpgwAES+xkQ4jZjbovhcOKNjd+Wzc3Hjpz76gva+ua3N/vP/+YyuQxBgFkyb5FYsjmUAIn9NOhtz86ePV3Xv3/50w4PrcSCELIBc4/NAWLJCEssiTmxUO01q+nChU/UtOW0zZJsZPNvSZg5sSSMESDuCoR2Jg8mcjnOnGxk878SIBtsFsxc055IynlDgGz+H8ScDQhKvCfJXsNmaTTibQYDOt/5Bjq5yX9DLBgi1pPWVo9wR3rwNOljj6K1Ve5KDz9E94dPUH/+szAagYSZE//EHBBxJOnEiUF64BQM+ixo/T7Shx9Gp9+POh2WqorqU2fpPv190ic/DnXF4QyYBdkQflcC9zQYoPceh+EQJBb07g30wQ+wn1ZGdL7wOXpPPU566AzvzIAhSjeRS2LBoLoGJe5JicPo/pN0v3uO7te/go5tcCiDZw2JOduAAfMfm0yJly/i8RYHGBwGk+owkQDZHGQOiKD87OfkHz2Dt7Y5lMEGo1KHNRMGhAGxT5j94qU/kp/8AfHnv/CODAZsEUFblxy7JEgBMgiz4Os34PVrLPjqNfL3zhO/eoElcQixYEMYophSYlq3jSckE5NbaLILJYjfvYS2tqHXJZ9/mvLsT6BpuEsIMyfuEDZzIgxRTNsUcrBT7413t2avvU7d7hJ/3yXtTUkyCdCsIT/zLOJfsDBzhjCUYtpZ0OwFoTSuxxf+dL0Tmd6gIrdjuv2KuiOqWiRBwhiQeIuNuc2ADREi56BtgnavsHerwKC+WU/b9Gr/Vqa0QZ4Vck90uolOR1S1qCqRZCQQtxmBwIYwRIHcmtyapgmaveBWK1In/bWeVsOLzKY4Z2ImSle0HdGpRd2BqhJVJVICiXsMREAElGxKNm1r2ta0LexEj2Hd/0Pd++iZH9947sVzK+10fZgz0QS5Fm0FdSWqClIFKQkJJMBgwAERphQoBdoCe1GxEz2a/vDa+06tPCfmfvGZr52ZXnr1y2U8+Uh5c+d4h6g7Kegm00mmSqZKIBlJGDAiLFqL7ERbEo1TqVaGV/tr/V+u37/2rTM/ffyS2Kf8+kVeu3yle/X5SxvNK387FtlHc1NWyV4ht70opUopUVdkUjVTlaZVim3165uDE0ffOHZy7cbRrWuz3vknuesfnG0T';
const VIDEO_REPORT_DEBOUNCE_MS = 150;
const DEFAULT_SETTINGS = {
  customShortcuts: {
    switchRandom: ['y'],
    likeOnly: ['+'],
    dislikeOnly: ['-']
  }
};
let customShortcuts = { ...DEFAULT_SETTINGS.customShortcuts };

// Start checking for Out of Memory errors after all variables are initialized
scheduleOutOfMemoryCheck();

// Auto report duration when a YouTube video page loads or navigates
window.addEventListener('load', () => {
  setTimeout(() => {
    reportDurationToBackground();
  }, 800);
});

window.addEventListener('yt-navigate-finish', () => {
  setTimeout(() => {
    reportDurationToBackground();
  }, 800);
});

window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    reportCurrentVideo();
    reportDurationToBackground();
  }
});

// In case the page transitions via History API without events, poll occasionally.
let __jumpkey_lastLocation = window.location.href;
setInterval(() => {
  if (window.location.href !== __jumpkey_lastLocation) {
    __jumpkey_lastLocation = window.location.href;
    reportDurationToBackground();
  }
}, 1200);

function extractVideoId(url) {
  const match = url.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// ============================================================
// 🧠 SISTEMA ROBUSTO DE EXTRAÇÃO DE TAGS
// Combina 3 métodos para máxima confiabilidade
// ============================================================

/**
 * MÉTODO 1: Extrai tags do ytInitialPlayerResponse (mais confiável)
 * ✅ Não depende do DOM
 * ✅ Funciona em vídeos normais
 * ⚠️ Em Shorts às vezes não vem preenchido
 */
function getTagsFromPlayerResponse() {
  try {
    const data = window.ytInitialPlayerResponse;
    const keywords = data?.videoDetails?.keywords || [];
    return keywords.map(t => t.toLowerCase());
  } catch (error) {
    console.warn('[JumpKey] Error extracting ytInitialPlayerResponse tags:', error);
    return [];
  }
}

/**
 * MÉTODO 2: Extrai tags da meta tag keywords (simples e estável)
 * ✅ Funciona inclusive em Shorts
 * ✅ Muito estável
 */
function getMetaKeywords() {
  try {
    const meta = document.querySelector('meta[name="keywords"]');
    if (!meta || !meta.content) return [];
    return meta.content
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(t => t.length > 0);
  } catch (error) {
    console.warn('[JumpKey] Error extracting meta keywords:', error);
    return [];
  }
}

/**
 * MÉTODO EXTRA: Extrai nome do canal atual como tag
 */
function getChannelName() {
  try {
    const selectors = [
      'ytd-video-owner-renderer #channel-name a',
      'ytd-video-owner-renderer a#author-text',
      '#owner-name a',
      'yt-formatted-string.ytd-channel-name-renderer a',
      'ytd-channel-name a'
    ];

    for (const selector of selectors) {
      const elem = document.querySelector(selector);
      const text = elem?.textContent || elem?.innerText;
      if (text && typeof text === 'string') {
        const clean = text.trim().toLowerCase();
        if (clean.length > 0) {
          return clean;
        }
      }
    }

    return null;
  } catch (error) {
    console.warn('[JumpKey] Error extracting channel name:', error);
    return null;
  }
}

/**
 * MÉTODO 3: Extrai hashtags da descrição (essencial para Shorts)
 * ✅ Muitos Shorts dependem de hashtags
 * ✅ Funciona bem em diferentes contextos
 */
function getHashtagsFromDescription() {
  try {
    const hashtags = [];
    
    // Tenta múltiplos seletores para descrição (Shorts vs vídeos normais)
    const descriptionSelectors = [
      'yt-attributed-string[split-lines]',
      '#description-text',
      '#description',
      'ytd-video-secondary-info-renderer #description'
    ];


    for (const selector of descriptionSelectors) {
      const elements = document.querySelectorAll(selector);
      elements.forEach((elem) => {
        const text = elem.textContent || elem.innerText;
        if (typeof text === 'string') {
          const foundHashtags = text.match(/#\w+/g);
          if (foundHashtags) {
            hashtags.push(...foundHashtags);
          }
        }
      });
    }

    return hashtags;
  } catch (error) {
    console.warn('[JumpKey] Error extracting hashtags from description:', error);
    return [];
  }
}

/**
 * Combina todas as fontes de tags (player response, meta keywords, hashtags)
 * e retorna uma lista deduplicada e normalizada (lowercase, trimmed).
 */
function extractAllTags() {
  try {
    const fromPlayer = Array.isArray(getTagsFromPlayerResponse()) ? getTagsFromPlayerResponse() : [];
    const fromMeta = Array.isArray(getMetaKeywords()) ? getMetaKeywords() : [];
    const fromDesc = Array.isArray(getHashtagsFromDescription()) ? getHashtagsFromDescription() : [];
    const channelName = getChannelName();

    const all = [...fromPlayer, ...fromMeta, ...fromDesc, ...(channelName ? [channelName] : [])]
      .map(t => (typeof t === 'string' ? t.trim().toLowerCase() : ''))
      .filter(Boolean);

    return Array.from(new Set(all));
  } catch (e) {
    console.warn('[JumpKey] extractAllTags error:', e);
    return [];
  }
}

window.extractAllTags = extractAllTags;

/**
 * 📊 Sistema de score de tags (registra frequência)
 * Útil para criar buscas dinâmicas baseadas em preferências
 */
function scoreTags(tags) {
  try {
    const store = JSON.parse(localStorage.getItem('sr_tag_scores') || '{}');

    tags.forEach(tag => {
      store[tag] = (store[tag] || 0) + 1;
    });

    localStorage.setItem('sr_tag_scores', JSON.stringify(store));

    // Log apenas das top 10 tags a cada 20 registros
    const totalScores = Object.values(store).reduce((a, b) => a + b, 0);
    if (totalScores % 20 === 0) {
      const topTags = Object.entries(store)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
      console.log('[JumpKey] Top 10 tags:', topTags);
    }
  } catch (error) {
    console.warn('[JumpKey] Error scoring tags:', error);
  }
}

/**
 * 🔍 Obtém tags mais populares do histórico
 */
function getTopTags(limit = 10) {
  try {
    const store = JSON.parse(localStorage.getItem('sr_tag_scores') || '{}');
    return Object.entries(store)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([tag]) => tag);
  } catch (error) {
    console.warn('[JumpKey] Error getting top tags:', error);
    return [];
  }
}

// Mantém compatibilidade com código existente
function extractHashtagsFromDescription() {
  return extractAllTags();
}

// ============================================================
// 🎲 FUNÇÕES UTILITÁRIAS PARA MOTOR DOPAMINÉRGICO
// ============================================================

/**
 * 🔗 Gera URL de busca do YouTube baseada em tags
 * Útil para criar buscas dinâmicas personalizadas
 */
function generateSearchUrl(tags, maxTags = 3) {
  if (!Array.isArray(tags) || tags.length === 0) {
    return null;
  }

  const searchTags = tags.slice(0, maxTags);
  const query = searchTags.join('+');
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

/**
 * 🎯 Gera URL de busca baseada nas tags mais populares
 * Combina as tags mais assistidas para encontrar conteúdo similar
 */
function generateSmartSearchUrl(limit = 3) {
  const topTags = getTopTags(limit);
  return generateSearchUrl(topTags);
}

/**
 * 🧹 Limpa dados de score de tags (útil para reset)
 */
function clearTagScores() {
  try {
    localStorage.removeItem('sr_tag_scores');
    console.log('[JumpKey] Tag scores cleared');
    return true;
  } catch (error) {
    console.warn('[JumpKey] Error clearing tag scores:', error);
    return false;
  }
}

/**
 * 📈 Exporta estatísticas de tags
 * Retorna objeto com métricas úteis
 */
function getTagStats() {
  try {
    const store = JSON.parse(localStorage.getItem('sr_tag_scores') || '{}');
    const entries = Object.entries(store);
    const total = entries.reduce((sum, [, count]) => sum + count, 0);
    
    return {
      totalTags: entries.length,
      totalViews: total,
      topTags: entries
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([tag, count]) => ({ tag, count, percentage: ((count / total) * 100).toFixed(1) })),
      averagePerTag: entries.length > 0 ? (total / entries.length).toFixed(2) : 0
    };
  } catch (error) {
    console.warn('[JumpKey] Error getting tag stats:', error);
    return null;
  }
}

function getVideoTitle() {
  const titleElement = document.querySelector('yt-formatted-string.title');
  return titleElement ? titleElement.textContent : 'Unknown';
}

async function reportCurrentVideo() {
  if (!chrome.runtime?.id) {
    return;
  }

  if (document.visibilityState !== 'visible') {
    return;
  }

  const url = window.location.href;
  const videoId = extractVideoId(url);

  if (!videoId || videoId === currentVideoId) {
    return;
  }

  currentVideoId = videoId;

  // 🎯 Usa o novo sistema robusto de extração de tags
  const extractTagsFn = typeof extractAllTags === 'function'
    ? extractAllTags
    : (typeof window.extractAllTags === 'function' ? window.extractAllTags : null);
  const tags = extractTagsFn ? extractTagsFn() : [];
  const title = getVideoTitle();

  // 📊 Registra tags para sistema de score
  if (tags.length > 0) {
    scoreTags(tags);
  }

  console.log('[JumpKey] Current video:', { videoId, title, tags });

  chrome.runtime.sendMessage(
    { action: 'saveVideoToHistory', videoId, title, tags },
    (response) => {
      if (chrome.runtime.lastError) {
      console.warn('[JumpKey] Message error:', chrome.runtime.lastError);
      } else {
      console.log('[JumpKey] Video saved:', response);
      }
    }
  );

  // Attach ended listener on long videos to optionally remove from Watch Later
  try {
    const videoEl = document.querySelector('video.html5-main-video');
    if (videoEl && !videoEl.__srEndedHooked) {
      videoEl.__srEndedHooked = true;
      videoEl.addEventListener('ended', () => {
        try {
          console.log('[JumpKey] Video ended event detected for', videoId);
          // Check user setting before requesting removal
          chrome.storage.sync.get({ autoRemoveWatchedFromWatchLater: true }, (items) => {
            if (chrome.runtime.lastError) {
              console.warn('[JumpKey] Storage get error:', chrome.runtime.lastError);
              return;
            }
            if (items.autoRemoveWatchedFromWatchLater) {
              chrome.runtime.sendMessage({ action: 'removeFromYoutubeWatchLater', videoId }, (resp) => {
                if (chrome.runtime.lastError) {
                  console.warn('[JumpKey] removeFromYoutubeWatchLater message error:', chrome.runtime.lastError);
                } else {
                  console.log('[JumpKey] Request to remove from Watch Later sent:', resp);
                }
              });
            }
          });
        } catch (e) {
          console.warn('[JumpKey] ended handler error:', e);
        }
      });
      console.log('[JumpKey] Attached ended listener to video element');
    }
  } catch (e) {
    console.warn('[JumpKey] Error attaching ended listener:', e);
  }

  // 🚫 Verifica se o vídeo tem tags bloqueadas
  if (blockedTags.length > 0 && tags.length > 0) {
    const hasBlockedTag = tags.some((tag) => blockedTags.includes(tag));
    if (hasBlockedTag) {
      console.log('[JumpKey] Current video has blocked tag, skipping...', tags);
      chrome.runtime.sendMessage({ action: 'switchShorts' }, (response) => {
          if (chrome.runtime.lastError) {
          console.warn('[JumpKey] Skip message error:', chrome.runtime.lastError);
        }
      });
    }
  }
}

function scheduleReportCurrentVideo(delay = VIDEO_REPORT_DEBOUNCE_MS) {
  if (!isShortsPage()) {
    return;
  }

  if (pendingVideoReportTimeout) {
    return;
  }

  pendingVideoReportTimeout = setTimeout(() => {
    pendingVideoReportTimeout = null;
    reportCurrentVideo();
  }, delay);
}

function queueReportCurrentVideo() {
  if (!isShortsPage()) {
    return;
  }

  if (pendingVideoReportRaf) {
    return;
  }

  pendingVideoReportRaf = requestAnimationFrame(() => {
    pendingVideoReportRaf = null;
    scheduleReportCurrentVideo();
  });
}

async function refreshBlockedTags() {
  chrome.runtime.sendMessage({ action: 'getBlockedTags' }, (response) => {
    if (response && response.blockedTags) {
      // Only log if tags changed
      const tagsChanged = JSON.stringify(blockedTags) !== JSON.stringify(response.blockedTags);
      blockedTags = response.blockedTags;
      window.__jumpKeyBlockedTags = blockedTags;
      if (tagsChanged) {
        console.log('[JumpKey] Blocked tags updated:', blockedTags);
      }
    }
  });
}

function getCurrentVideoId() {
  const url = window.location.href;
  const shortsMatch = url.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
  if (shortsMatch && shortsMatch[1]) return shortsMatch[1];
  const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]+)/);
  if (watchMatch && watchMatch[1]) return watchMatch[1];
  return null;
}

async function queryDuration() {
  try {
    const video = document.querySelector('video');
    if (video && Number.isFinite(video.duration) && video.duration > 0) {
      return Number(video.duration);
    }

    if (window.ytInitialPlayerResponse?.videoDetails?.lengthSeconds) {
      const val = Number(window.ytInitialPlayerResponse.videoDetails.lengthSeconds);
      if (Number.isFinite(val) && val > 0) return val;
    }

    if (window.ytplayer?.config?.args?.length_seconds) {
      const val = Number(window.ytplayer.config.args.length_seconds);
      if (Number.isFinite(val) && val > 0) return val;
    }

    const mmeta = document.querySelector('meta[itemprop="duration"]');
    if (mmeta && mmeta.content) {
      const pt = mmeta.content;
      let sec = 0;
      const h = pt.match(/(\d+)H/);
      if (h) sec += parseInt(h[1], 10) * 3600;
      const m = pt.match(/(\d+)M/);
      if (m) sec += parseInt(m[1], 10) * 60;
      const s = pt.match(/(\d+(?:\.\d+)?)S/);
      if (s) sec += Math.floor(parseFloat(s[1]));
      if (Number.isFinite(sec) && sec > 0) return sec;
    }
  } catch (err) {
    console.warn('[JumpKey] queryDuration failed:', err);
  }
  return null;
}

async function reportDurationToBackground() {
  const videoId = getCurrentVideoId();
  if (!videoId) return;

  let duration = null;
  const start = Date.now();
  while (Date.now() - start < 1600) {
    duration = await queryDuration();
    if (duration && duration > 0) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  if (duration && duration > 0) {
    console.log('[JumpKey] reportVideoDuration emitting', { videoId, duration });
    chrome.runtime.sendMessage({ action: 'reportVideoDuration', videoId, duration });
  } else {
    console.log('[JumpKey] reportVideoDuration no duration available yet', { videoId, duration });
  }
}

function loadShortcutSettings() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
    if (chrome.runtime.lastError) {
      console.warn('[JumpKey] Failed to load shortcut settings:', chrome.runtime.lastError);
      return;
    }

    customShortcuts = items.customShortcuts || { ...DEFAULT_SETTINGS.customShortcuts };
    console.log('[JumpKey] Custom shortcuts loaded:', customShortcuts);
  });
}

function isShortsPage() {
  try {
    return window.location.hostname.includes('youtube.com') && window.location.pathname.startsWith('/shorts');
  } catch (error) {
    return /\/shorts(?:\/?$|\?)/.test(window.location.href);
  }
}

function getRateButtons() {
  // Specific selectors based on working extension patterns
  const containerSelectors = [
    // Regular video selectors
    'ytd-watch-flexy:not([hidden]) #top-level-buttons-computed yt-smartimation',
    'ytd-page-manager ytd-segmented-like-dislike-button-renderer yt-smartimation',
    '#top-level-buttons-computed li:has(ytd-segmented-like-dislike-button-renderer)',
    // Shorts selectors
    'reel-action-bar-view-model',
    'ytd-reel-video-renderer[is-active] #like-button',
    // Mobile fallback
    'ytm-shorts-video-renderer li:has(button[aria-label*="like" i])'
  ];

  for (const selector of containerSelectors) {
    const container = document.querySelector(selector);
    if (container) {
      const buttons = [...container.querySelectorAll('button')];
      if (buttons.length >= 2) {
        return buttons;
      }
    }
  }

  return [];
}

function getIsButtonActive(button) {
  return button?.getAttribute('aria-pressed') === 'true';
}

function normalizeLabelText(value) {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function matchActionByAriaLabel(actionType, button) {
  const label = normalizeLabelText(button?.getAttribute('aria-label'));
  if (!label) {
    return false;
  }

  const likeKeywords = ['like', 'gostei', 'me gusta', 'curtir', 'curti', '赞', '喜歡', '喜欢'];
  const dislikeKeywords = ['dislike', 'nao gostei', 'não gostei', 'no me gusta', 'nao curti', 'não curti', '不喜歡', '不喜欢'];

  if (actionType === 'like') {
    const isLike = likeKeywords.some((keyword) => label.includes(normalizeLabelText(keyword)));
    const isDislike = dislikeKeywords.some((keyword) => label.includes(normalizeLabelText(keyword)));
    return isLike && !isDislike;
  }

  return dislikeKeywords.some((keyword) => label.includes(normalizeLabelText(keyword)));
}

function findActionButton(actionType) {
  const buttons = getRateButtons();
  if (buttons.length === 0) {
    return null;
  }

  // 1) Prefer aria-label matching (multilingual)
  for (const button of buttons) {
    if (matchActionByAriaLabel(actionType, button)) {
      return button;
    }
  }

  // 2) Positional fallback: first is like, second is dislike
  if (actionType === 'like' && buttons[0]) {
    return buttons[0];
  }
  if (actionType === 'dislike' && buttons[1]) {
    return buttons[1];
  }

  return null;
}

function applyReactionIfNeeded(actionType) {
  const button = findActionButton(actionType);
  if (!button) {
    console.log(`[JumpKey] ${actionType} button not found`);
    return;
  }

  // Exibe o indicador visual
  if (actionType === 'like') showIndicator(true);
  if (actionType === 'dislike') showIndicator(false);

  // Only click if button is not already active
  if (!getIsButtonActive(button)) {
    button.click();
    button.blur();
    console.log(`[JumpKey] ${actionType} applied`);
  } else {
    console.log(`[JumpKey] ${actionType} already active, skipping`);
  }
}

function switchShorts() {
  try {
    if (!chrome.runtime?.id) {
      console.warn('[JumpKey] Runtime not available yet');
      return;
    }

    chrome.runtime.sendMessage({ action: 'switchShorts' }, () => {
        if (chrome.runtime.lastError) {
        console.warn('[JumpKey] Message error (extension may have reloaded):', chrome.runtime.lastError);
      }
    });
  } catch (error) {
    console.error('[JumpKey] Error sending message:', error);
  }
}

function detectAndReloadOutOfMemory() {
  // Check for "Out of Memory" error message on page
  const pageText = document.documentElement.innerText || '';
  const hasMemoryError = pageText.includes('Out of Memory');
  const isBrowserErrorPage = window.location.protocol === 'chrome-error:' || window.location.href.startsWith('chrome-error://');

  if (hasMemoryError && isBrowserErrorPage) {
    console.log('[JumpKey] Detected Out of Memory error, reloading page...');
    window.location.reload();
    return true;
  }
  
  return false;
}

function scheduleOutOfMemoryCheck() {
  if (outOfMemoryCheckTimeout) {
    clearTimeout(outOfMemoryCheckTimeout);
  }
  
  outOfMemoryCheckTimeout = setTimeout(() => {
    if (detectAndReloadOutOfMemory()) {
      return;
    }
    // Check again in 5 seconds
    scheduleOutOfMemoryCheck();
  }, 5000);
}

function findPrimaryVideoElement() {
  const selectors = [
    'video.html5-main-video',
    'ytd-reel-video-renderer video',
    'video'
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element instanceof HTMLVideoElement) {
      return element;
    }
  }

  return null;
}

function fadeOutCurrentVideoAudio(durationMs = 400, steps = 10) {
  return new Promise((resolve) => {
    const video = findPrimaryVideoElement();

    if (!video) {
      console.log('[JumpKey] fadeOutAudio: no video element found, skipping fade');
      resolve({ status: 'no-video' });
      return;
    }

    const safeDuration = Math.max(50, Number(durationMs) || 250);
    const safeSteps = Math.max(2, Number(steps) || 10);
    const initialVolume = Math.max(0, Math.min(1, Number(video.volume)));
    const stepInterval = Math.max(10, Math.floor(safeDuration / safeSteps));

    if (video.muted || initialVolume <= 0.001) {
      video.muted = true;
      video.volume = 0;
      resolve({ status: 'already-muted' });
      return;
    }

    let currentStep = 0;

    const intervalId = setInterval(() => {
      currentStep += 1;
      const progress = currentStep / safeSteps;
      const nextVolume = Math.max(0, initialVolume * (1 - progress));

      video.volume = nextVolume;

      if (currentStep >= safeSteps || nextVolume <= 0.001) {
        clearInterval(intervalId);
        video.volume = 0;
        video.muted = true;
        resolve({ status: 'faded' });
      }
    }, stepInterval);
  });
}

function preserveFullscreenDuringSwitch(durationMs = 5000) {
  try {
    window.__jumpKeyPreserveFullscreen = true;
    setTimeout(() => {
      window.__jumpKeyPreserveFullscreen = false;
    }, durationMs);
  } catch (e) {
    // ignore
  }
}

function handleShortcutCommand(command) {
  if (command === 'switchRandom') {
    preserveFullscreenDuringSwitch();
    switchShortsRandom();
    return;
  }

  if (command === 'likeOnly') {
    applyReactionIfNeeded('like');
    return;
  }

  if (command === 'dislikeOnly') {
    applyReactionIfNeeded('dislike');
  }
}

function isExtensionContextValid() {
  try {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

function switchShortsRandom() {
  if (!isExtensionContextValid()) {
    console.warn('[JumpKey] Extension context invalidated; reloading content script context');
    setTimeout(() => {
      window.location.reload();
    }, 80);
    return;
  }

  chrome.runtime.sendMessage({ action: 'switchRandom' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('[JumpKey] Error:', chrome.runtime.lastError.message);
      if (chrome.runtime.lastError.message && chrome.runtime.lastError.message.includes('Extension context invalidated')) {
        setTimeout(() => {
          window.location.reload();
        }, 80);
      }
    }
  });
}

function getShortcutCommand(event) {
  const key = event.key;
  const code = event.code;

  let pressedKey = key;
  if (code && code.startsWith('Arrow')) {
    pressedKey = code;
  } else if (code === 'NumpadAdd') {
    pressedKey = '+';
  } else if (code === 'NumpadSubtract') {
    pressedKey = '-';
  }

  pressedKey = pressedKey.toLowerCase();

  for (const [action, keys] of Object.entries(customShortcuts)) {
    const normalizedKeys = keys.map((k) => k.toLowerCase());
    if (normalizedKeys.includes(pressedKey)) {
      return action;
    }
  }

  return null;
}

function isLikelyWindowFullscreen() {
  const tolerance = 48; // Tolerance for taskbars and small variations
  const matchesAvail =
    window.innerWidth >= (screen.availWidth - tolerance) &&
    window.innerHeight >= (screen.availHeight - tolerance);
  const matchesScreen =
    window.innerWidth >= (screen.width - tolerance) &&
    window.innerHeight >= (screen.height - tolerance);

  return matchesAvail || matchesScreen;
}

// shared utilities moved from listing script

function createJumpKeyButton(options = {}) {
  // Disabled: return an inert, non-interactive placeholder to avoid inserting the Watch Later UI
  const placeholder = document.createElement('span');
  placeholder.className = 'jumpkey-btn-deprecated';
  placeholder.style.display = 'none';
  return placeholder;
}

function getVideoIdFromElement(el) {
  if (!el) return null;

  // 1) direct anchors inside the thumb
  const linkSelectors = ['a#thumbnail', 'a#video-title', 'a[href*="/watch" i]', 'a[href*="/shorts" i]', 'a.yt-simple-endpoint'];
  for (const sel of linkSelectors) {
    const anchor = el.querySelector(sel) || el.closest('ytd-video-renderer')?.querySelector(sel);
    if (anchor) {
      const href = anchor.href || anchor.getAttribute && anchor.getAttribute('href');
      if (href) {
        const abs = href.startsWith('/') ? (window.location.origin + href) : href;
        const m = abs.match(/[?&]v=([^&]+)/) || abs.match(/\/shorts\/([^/?]+)/);
        if (m && m[1]) return m[1];
      }
    }
  }

  // 2) data attributes on elements (many renderers include data-video-id)
  const dataVid = el.querySelector('[data-video-id]')?.getAttribute('data-video-id') || el.getAttribute('data-video-id') || el.dataset?.videoId;
  if (dataVid) return dataVid;

  // 3) try to find any anchor ancestor with a href containing watch or shorts
  const anc = el.closest && el.closest('a[href*="/watch" i], a[href*="/shorts" i]');
  if (anc) {
    const href = anc.href || anc.getAttribute('href');
    if (href) {
      const abs = href.startsWith('/') ? (window.location.origin + href) : href;
      const m = abs.match(/[?&]v=([^&]+)/) || abs.match(/\/shorts\/([^/?]+)/);
      if (m && m[1]) return m[1];
    }
  }

  // 4) fallback: look for 'href' attributes inside the thumb text nodes
  const anyAnchor = el.querySelector('a[href]');
  if (anyAnchor) {
    const href = anyAnchor.href || anyAnchor.getAttribute('href');
    if (href) {
      const abs = href.startsWith('/') ? (window.location.origin + href) : href;
      const m = abs.match(/[?&]v=([^&]+)/) || abs.match(/\/shorts\/([^/?]+)/);
      if (m && m[1]) return m[1];
    }
  }

  return null;
}

function safeSendMessage(msg, cb) {
    try {
      if (!chrome || !chrome.runtime || !chrome.runtime.id) {
      console.warn('[JumpKey] Runtime indisponível — ignorando sendMessage:', msg);
      if (typeof cb === 'function') cb({ skipped: true });
      return;
    }

    chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) {
        console.warn('[JumpKey] sendMessage lastError:', chrome.runtime.lastError, 'msg:', msg);
        if (typeof cb === 'function') cb({ error: chrome.runtime.lastError });
        return;
      }
      if (typeof cb === 'function') cb(resp);
    });
  } catch (err) {
    console.warn('[JumpKey] sendMessage exception:', err, 'msg:', msg);
    if (typeof cb === 'function') cb({ error: err.message });
  }
}

function showThumbToast(thumb, text = 'Saved') {
  try {
    if (!thumb) return;
    const container = thumb.querySelector('yt-thumbnail-bottom-overlay-view-model') || thumb.querySelector('#dismissible') || thumb;
    const toast = document.createElement('div');
    toast.className = 'sr-thumb-toast';
    toast.textContent = text;
    toast.style.cssText = 'position:absolute;left:6px;bottom:36px;z-index:10000;background:rgba(0,0,0,0.85);color:white;padding:6px 8px;border-radius:6px;font-size:12px;pointer-events:none;opacity:0;transition:opacity .18s ease,transform .18s ease;transform:translateY(6px);';
    // ensure container is positioned
    try { if (getComputedStyle(container).position === 'static') container.style.position = 'relative'; } catch (e) {}
    container.appendChild(toast);
    // trigger fade-in
    requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateY(0)'; });
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(6px)';
      setTimeout(() => { try { toast.remove(); } catch (e) {} }, 220);
    }, 1400);
  } catch (err) {
    console.warn('[JumpKey] showThumbToast failed:', err);
  }
}

// end of content-video.js (listing-specific logic has been moved to content-listing.js)

// Defensive listener: ignore messages from stale operations (opId) and
// handle a small set of control actions used by the background script.
try {
  chrome.runtime && chrome.runtime.onMessage && chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      // If message carries an opId, accept it when it's newer than last seen.
      if (msg && msg.opId) {
        const _parseTs = (id) => {
          try { return parseInt(String(id).split('-')[0], 10) || 0; } catch (e) { return 0; }
        };
        const incomingTs = _parseTs(msg.opId);
        const currentTs = window.__jumpKeyLastOpId ? _parseTs(window.__jumpKeyLastOpId) : 0;
        console.log('[JumpKey] recv message opId', msg.opId, 'incomingTs', incomingTs, 'currentOpId', window.__jumpKeyLastOpId, 'currentTs', currentTs, 'at', Date.now());
        if (currentTs && incomingTs < currentTs) {
          console.log('[JumpKey] Ignoring older opId', msg.opId, 'current', window.__jumpKeyLastOpId);
          if (typeof sendResponse === 'function') sendResponse(false);
          return;
        }
        // update to newest op id
        window.__jumpKeyLastOpId = msg.opId;
      }

      if (!msg || !msg.action) return;

      if (msg.action === 'fadeOutAudio') {
        fadeOutCurrentVideoAudio(msg.durationMs, msg.steps).then((res) => {
          try { if (typeof sendResponse === 'function') sendResponse({ ok: true, result: res }); } catch (e) {}
        }).catch((e) => { try { if (typeof sendResponse === 'function') sendResponse({ ok: false, error: String(e) }); } catch (e) {} });
        return true; // async
      }

      if (msg.action === 'setReelFullscreen' || msg.action === 'setLongVideoFullscreen') {
        try { preserveFullscreenDuringSwitch(); } catch (e) {}
        if (typeof sendResponse === 'function') sendResponse({ ok: true });
        return;
      }

      // helper: get duration in secondes from video element / ytInitialPlayerResponse / meta duration
      async function queryDuration() {
        try {
          const video = document.querySelector('video');
          if (video && Number.isFinite(video.duration) && video.duration > 0) {
            return Number(video.duration);
          }

          if (window.ytInitialPlayerResponse?.videoDetails?.lengthSeconds) {
            const val = Number(window.ytInitialPlayerResponse.videoDetails.lengthSeconds);
            if (Number.isFinite(val) && val > 0) return val;
          }

          if (window.ytplayer?.config?.args?.length_seconds) {
            const val = Number(window.ytplayer.config.args.length_seconds);
            if (Number.isFinite(val) && val > 0) return val;
          }

          const mmeta = document.querySelector('meta[itemprop="duration"]');
          if (mmeta && mmeta.content) {
            const pt = mmeta.content;
            let sec = 0;
            const h = pt.match(/(\d+)H/);
            if (h) sec += parseInt(h[1], 10) * 3600;
            const m = pt.match(/(\d+)M/);
            if (m) sec += parseInt(m[1], 10) * 60;
            const s = pt.match(/(\d+(?:\.\d+)?)S/);
            if (s) sec += Math.floor(parseFloat(s[1]));
            if (Number.isFinite(sec) && sec > 0) return sec;
          }
        } catch (err) {
          console.warn('[JumpKey] queryDuration failed:', err);
        }
        return null;
      }

      if (msg.action === 'getVideoDuration') {
        (async () => {
          let duration = null;
          try {
            const start = Date.now();
            do {
              duration = await queryDuration();
              if (duration && duration > 0) break;
              // retry for up to ~1200ms
              await new Promise((r) => setTimeout(r, 200));
            } while (Date.now() - start < 1200);
          } catch (e) {
            console.warn('[JumpKey] getVideoDuration content-script failed:', e);
          }

          if (typeof sendResponse === 'function') {
            sendResponse({ ok: true, duration: duration || null });
          }
        })();

        return true;
      }

      if (msg.action === 'advanceToNextShort') {
        try {
          // Try multiple selectors to find a clickable anchor inside the active reel renderer
          const selectors = [
            'ytd-reel-video-renderer[is-active] a#thumbnail',
            'ytd-reel-video-renderer[is-active] a',
            'ytd-reel-video-renderer[is-active] ytd-thumbnail a#thumbnail',
            'ytd-reel-video-renderer[is-active] a[href*="/watch"]',
            'ytd-reel-video-renderer[is-active] a[href*="/shorts"]',
            'ytd-reel-video-renderer a#thumbnail',
            'a#thumbnail',
            'ytd-reel-video-renderer a'
          ];

          function findNextAnchor() {
            for (const s of selectors) {
              const el = document.querySelector(s);
              if (el) return el;
            }
            return null;
          }

          const nextAnchor = findNextAnchor();
          console.log('[JumpKey] advanceToNextShort received; nextAnchor=', !!nextAnchor, 'opId=', msg.opId, 'at', Date.now());

          if (nextAnchor && typeof nextAnchor.click === 'function') {
            nextAnchor.click();
            console.log('[JumpKey] advanceToNextShort clicked nextAnchor at', Date.now(), 'opId=', msg.opId);
            if (typeof sendResponse === 'function') sendResponse(true);
            return true;
          }

          // If anchor not found yet, set up a short-lived MutationObserver to catch when it appears
          const observerRoot = document.querySelector('ytd-reel-video-renderer[is-active]') || document.body;
          let observer;
          let responded = false;

          const tryClickAndRespond = () => {
            try {
              const found = findNextAnchor();
              if (found && typeof found.click === 'function') {
                found.click();
                console.log('[JumpKey] advanceToNextShort MutationObserver clicked anchor at', Date.now(), 'opId=', msg.opId);
                if (!responded && typeof sendResponse === 'function') sendResponse(true);
                responded = true;
                if (observer) try { observer.disconnect(); } catch (e) {}
                return true;
              }
            } catch (e) {
              console.warn('[JumpKey] advanceToNextShort tryClickAndRespond failed:', e);
            }
            return false;
          };

          // Quick attempt before attaching observer
          if (tryClickAndRespond()) {
            return true;
          }

          try {
            observer = new MutationObserver(() => { tryClickAndRespond(); });
            observer.observe(observerRoot, { childList: true, subtree: true });
          } catch (e) {
            console.warn('[JumpKey] Failed to create MutationObserver for advanceToNextShort:', e);
          }

          // As a fallback, dispatch synthetic keyboard events (ArrowRight, then 'l')
          const dispatchKey = (key, code) => {
            try {
              const kd = new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true });
              document.dispatchEvent(kd);
              const ku = new KeyboardEvent('keyup', { key, code, bubbles: true, cancelable: true });
              document.dispatchEvent(ku);
              console.log('[JumpKey] advanceToNextShort dispatched key', key, 'at', Date.now(), 'opId=', msg.opId);
            } catch (e) {
              console.warn('[JumpKey] advanceToNextShort dispatchKey failed:', e);
            }
          };

          try {
            // dispatch ArrowRight first (common forward), then 'l' as long/shortcut alternative
            dispatchKey('ArrowRight', 'ArrowRight');
            dispatchKey('l', 'KeyL');
            if (!responded && typeof sendResponse === 'function') sendResponse(true);
            responded = true;
          } catch (e) {
            console.warn('[JumpKey] advanceToNextShort keyboard fallback failed:', e);
          }

          // Ensure observer cleans up after 800ms
          setTimeout(() => { try { if (observer) observer.disconnect(); } catch (e) {} }, 800);
          return true; // keep channel open for async observer
        } catch (e) {
          console.warn('[JumpKey] advanceToNextShort failed unexpected:', e);
        }
        if (typeof sendResponse === 'function') sendResponse(false);
        return;
      }
    } catch (e) {
      console.warn('[JumpKey] runtime.onMessage handler error:', e);
      if (typeof sendResponse === 'function') sendResponse(false);
    }
  });
} catch (e) {
  // no-op if runtime not available
}

/**
 * Auto-detecta o container do player+UI a partir do <video> real.
 * Sobe na hierarquia do DOM até encontrar um container típico do player.
 * Retorna o elemento do container ou null se não encontrar.
 */
function findPlayerContainer() {
  const video = findPrimaryVideoElement();
  if (!video) return null;

  let el = video.parentElement;
  while (el && el !== document.body) {
    // Critérios: id ou classe com 'player', ou presença de UI típica
    if (
      (el.id && el.id.includes('player')) ||
      (el.className && el.className.toString().includes('player')) ||
      el.querySelector('.ytp-chrome-bottom, .ytp-chrome-top, .ytp-play-button')
    ) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}
