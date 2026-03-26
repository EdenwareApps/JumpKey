// ==== GARANTE VARIÁVEIS GLOBAIS NO TOPO ====
(() => {
  'use strict';
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
  let listingLastAppliedExpandedAt = 0;
  let listingShortsModeActive = false;
  let listingLongVideoModeActive = false;
  let listingFullscreenExitValidation = null;
  let listingCustomStyle = null;
  let listingLongVideoStyle = null;
  let listingObservedRootNode = null;
  let pendingShortsModeReapplyTimeout = null;
  let listingApplyInProgress = false;

  // ...existing code...
  const WATCH_LOC_SELECTORS = [
    'ytd-rich-item-renderer',
    'ytd-playlist-video-renderer',
    'ytd-notification-renderer',
    'ytd-search ytd-video-renderer',
    '.ytp-endscreen-content .ytp-videowall-still',
    '.ytp-fullscreen-grid .ytp-modern-videowall-still',
    'ytd-watch-metadata #top-level-buttons-computed'
  ].join(', ');

  function parseDurationTextSync(durationText) {
    if (!durationText || typeof durationText !== 'string') return null;
    const cleaned = durationText.trim();
    if (!cleaned) return null;
    const parts = cleaned.split(':').map(p => Number(p.replace(/[^0-9]/g, '')));
    if (parts.some(p => Number.isNaN(p))) return null;
    let seconds = 0;
    if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
    else if (parts.length === 1) seconds = parts[0];
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  }

  function getTextSync(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value.simpleText === 'string') return value.simpleText;
    if (Array.isArray(value.runs)) return value.runs.map(run => run?.text || '').join('').trim();
    return '';
  }

  async function extractPlaylistVideosForSync() {
    const videos = [];
    const seen = new Set();

    const addVideo = (videoId, title, durationSec) => {
      if (!videoId || seen.has(videoId)) return;
      seen.add(videoId);
      videos.push({
        videoId,
        title: title || 'Unknown',
        tags: [],
        duration: Number.isFinite(Number(durationSec)) && durationSec > 0 ? Number(durationSec) : null
      });
    };

    try {
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent || '';
        if (!text.includes('ytInitialData')) continue;

        const regexes = [
          /var ytInitialData\s*=\s*({[\s\S]*?});/,
          /window\[\"ytInitialData\"\]\s*=\s*({[\s\S]*?});/
        ];

        for (const regex of regexes) {
          const match = text.match(regex);
          if (!match || !match[1]) continue;
          let data = null;
          try { data = JSON.parse(match[1]); } catch (e) { continue; }

          const contents = data?.contents?.twoColumnBrowseResultsRenderer?.tabs;
          if (!Array.isArray(contents)) continue;

          for (const tab of contents) {
            const sectionContents = tab?.tabRenderer?.content?.sectionListRenderer?.contents || [];
            for (const section of sectionContents) {
              const items = section?.itemSectionRenderer?.contents || [];
              for (const item of items) {
                const listItems = item?.playlistVideoListRenderer?.contents || [];
                for (const entry of listItems) {
                  const renderer = entry?.playlistVideoRenderer;
                  const durationText = renderer?.lengthText?.simpleText || (renderer?.lengthText?.runs ? renderer.lengthText.runs.map(r => r.text).join('').trim() : '');
                  const parsedDuration = parseDurationTextSync(durationText);
                  const videoId = renderer?.videoId;
                  addVideo(videoId, getTextSync(renderer?.title), parsedDuration);
                }
              }
            }
          }
        }
      }

      if (videos.length === 0) {
        const videoElements = document.querySelectorAll('ytd-playlist-video-renderer');
        for (const el of videoElements) {
          const link = el.querySelector('a#video-title');
          if (!link || !link.href) continue;
          const match = link.href.match(/[?&]v=([^&]+)/);
          if (match && match[1]) {
            const durationElem = el.querySelector('ytd-thumbnail-overlay-time-status-renderer span') || el.querySelector('span.ytd-thumbnail-overlay-time-status-renderer');
            const durationText = durationElem ? (durationElem.textContent || '').trim() : '';
            const parsedDuration = parseDurationTextSync(durationText);
            addVideo(match[1], (link.textContent || '').trim(), parsedDuration);
          }
        }
      }

      if (videos.length > 0) {
        return { success: true, videos, method: 'content-listing-extract' };
      }

      return { success: false, error: 'No videos found in playlist' };
    } catch (err) {
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  }

  async function maybeSendPlaylistSyncData() {
    try {
      if (window.__jumpKeyPlaylistSyncSent) return;
      const url = new URL(window.location.href);
      let source = url.searchParams.get('jumpkey_sync');
      if (!source && url.hash) {
        const hashMatch = url.hash.match(/(?:#|&)?jumpkey_sync=([^&]+)/);
        source = hashMatch ? decodeURIComponent(hashMatch[1]) : null;
      }
      if (!source || (source !== 'watchLater' && source !== 'liked')) return;
      window.__jumpKeyPlaylistSyncSent = true;

      const payload = await extractPlaylistVideosForSync();
      payload.action = 'playlistSyncData';
      payload.source = source;

      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[JumpKey][SYNC] playlist sync message failed:', chrome.runtime.lastError);
        } else {
          console.log('[JumpKey][SYNC] playlist sync message response:', response);
        }
      });
    } catch (e) {
      console.warn('[JumpKey][SYNC] maybeSendPlaylistSyncData failed:', e);
    }
  }

  maybeSendPlaylistSyncData();
  window.addEventListener('popstate', maybeSendPlaylistSyncData);
  window.addEventListener('yt-navigate-finish', maybeSendPlaylistSyncData);
  setTimeout(maybeSendPlaylistSyncData, 2800);

  // compute classes for a given thumbnail element; mimics the CRX bundle's logic
  function getButtonClasses(node) {
    const classes = ['jumpkey-btn', 'watch-later-btn'];
    const tag = node.tagName;
    if (tag === 'YTD-RICH-ITEM-RENDERER' || tag === 'YTD-VIDEO-RENDERER' || tag === 'YTD-GRID-VIDEO-RENDERER') {
      classes.push('in-thumbnail');
    }
    if (tag === 'YTD-PLAYLIST-VIDEO-RENDERER') {
      classes.push('in-playlist');
    }
    if (tag === 'YTD-NOTIFICATION-RENDERER') {
      classes.push('in-notification');
      if (node.offsetHeight < 100) classes.push('spaced');
    }
    if (node.classList.contains('ytp-videowall-still')) {
      classes.push('in-endscreen-suggested');
    }
    if (node.classList.contains('ytp-modern-videowall-still')) {
      classes.push('in-mod-endscreen-suggested');
    }
    if (node.id === 'top-level-buttons-computed') {
      classes.push('in-video-detail');
    }
    try {
      const theme = window.ytcfg?.get('INNERTUBE_CONTEXT')?.client?.userInterfaceTheme;
      if (theme === 'USER_INTERFACE_THEME_DARK') classes.push('dark');
      if (theme === 'USER_INTERFACE_THEME_LIGHT') classes.push('light');
    } catch (e) {
      // ignore
    }
    return classes.join(' ');
  }

  // if we later obtain the icon data URL after buttons were already inserted,
  // replace text-only buttons with the image
  function refreshButtonsWithIcon(iconDataUrl) {
    if (!iconDataUrl) return;
    document.querySelectorAll('.jumpkey-btn').forEach((btn) => {
      if (!btn.querySelector('img')) {
        try {
          const img = document.createElement('img');
          img.src = iconDataUrl;
          img.alt = 'Salvar para assistir mais tarde';
          img.style.pointerEvents = 'none';
          img.style.width = '100%';
          img.style.height = '100%';
          img.style.objectFit = 'contain';
          btn.textContent = '';
          btn.appendChild(img);
        } catch (e) {
          // ignore
        }
      }
    });
  }

  // createJumpKeyButton implementation lives in content-video.js

  function populateAnchorOnButton(btn, targetElem) {
    // tenta encontrar um <a> com link de vídeo dentro do target
    try {
      const link = targetElem.querySelector('a') || targetElem.closest('a');
      if (link && link.href) btn.__jumpkey_anchor_href = link.href;
    } catch (e) {
      // ignore
    }
  }

  // YouTube video IDs are 11 characters of [A-Za-z0-9_-].
  // the site’s own watch‑later buttons carry data-video-id attributes
  // matching this pattern; use as a sanity check so we don't grab "any
  // old button" that happens to sprout a similar attribute.
  function isLikelyYoutubeVideoId(id) {
    return typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id);
  }

  function handleFullscreenExit() {
    // pause the expensive mutation observer while we're dealing with a
    // fullscreen change; a couple of seconds is enough to ride out the
    // page’s re-layout.
    try {
      if (jumpKeyGlobalState) {
        jumpKeyGlobalState.insertionPauseUntil = Date.now() + 1500;
      }
    } catch (e) {
      // ignore
    }

    // When a switch is requested via shortcut, YouTube may briefly exit
    // document fullscreen during navigation. Don't remove expanded mode while
    // that's happening.
    if (window.__jumpKeyPreserveFullscreen) {
      console.log('[JumpKey][DEBUG] handleFullscreenExit: preserveFullscreen active, skipping removal.');
      return;
    }

    if (!listingShortsModeActive && !listingLongVideoModeActive) {
      clearTimeout(listingFullscreenExitValidation);
      listingFullscreenExitValidation = null;
      console.log('[JumpKey][DEBUG] handleFullscreenExit: Nenhum modo expandido ativo, nada a remover.');
      return;
    }

    if (listingLongVideoModeActive) {
      console.log('[JumpKey][DEBUG] handleFullscreenExit: Modo expandido longo ativo, não removendo.');
      return;
    }

    // Não remove se ainda está em fullscreen
    if (document.fullscreenElement) {
      clearTimeout(listingFullscreenExitValidation);
      listingFullscreenExitValidation = null;
      console.log('[JumpKey][DEBUG] handleFullscreenExit: Ainda em fullscreen, não removendo modo expandido.');
      return;
    }

    // Verifica se a janela saiu do fullscreen
    if (!isLikelyWindowFullscreen()) {
      // Se aplicou expandido recentemente, evita falso positivo
      try {
        if (listingLastAppliedExpandedAt && (Date.now() - listingLastAppliedExpandedAt) < 2000) {
          console.log('[JumpKey][DEBUG] handleFullscreenExit: Remoção ignorada, dentro do período de tolerância após expandido.');
          return;
        }
      } catch (e) {
        console.log('[JumpKey][DEBUG] handleFullscreenExit: Erro ao checar tolerância:', e);
      }
      // Se não há validação pendente, inicia uma
      if (!listingFullscreenExitValidation) {
        console.log('[JumpKey][DEBUG] handleFullscreenExit: Possível saída de fullscreen detectada, aguardando validação (2s)...');
        listingFullscreenExitValidation = setTimeout(() => {
          // Checa novamente após 2 segundos
          if (!isLikelyWindowFullscreen()) {
            console.log('[JumpKey][DEBUG] handleFullscreenExit: Confirmado saída de fullscreen após 2 checagens, removendo modo expandido.');

            // Corrige tamanho da janela para 100% (caso tenha ficado em 50%)
            try {
              if (window.outerWidth && window.screen && window.screen.availWidth) {
                // Só ajusta se a janela está menor que 90% da largura disponível
                if (window.outerWidth < window.screen.availWidth * 0.9) {
                  window.resizeTo(window.screen.availWidth, window.outerHeight);
                  console.log('[JumpKey][DEBUG] handleFullscreenExit: resizeTo aplicado para restaurar largura total da janela:', window.outerWidth, window.outerHeight);
                } else {
                  console.log('[JumpKey][DEBUG] handleFullscreenExit: largura da janela já está ok:', window.outerWidth);
                }
              } else {
                console.log('[JumpKey][DEBUG] handleFullscreenExit: Não foi possível obter dimensões da janela para resize.');
              }
            } catch (e) {
              console.log('[JumpKey][DEBUG] handleFullscreenExit: Erro ao tentar resizeTo:', e);
            }

            if (listingShortsModeActive) {
              removerModoExpandido();
              console.log('[JumpKey][DEBUG] handleFullscreenExit: Modo shorts expandido removido.');
            }

            if (listingLongVideoModeActive) {
              removerModoExpandidoLongo();
              console.log('[JumpKey][DEBUG] handleFullscreenExit: Modo long video expandido removido.');
            }
          } else {
            console.log('[JumpKey][DEBUG] handleFullscreenExit: Falso alarme, voltou para fullscreen durante validação.');
          }
          listingFullscreenExitValidation = null;
        }, 2000);
      }
    } else {
      // Se voltou para fullscreen, cancela validação
      if (listingFullscreenExitValidation) {
        clearTimeout(listingFullscreenExitValidation);
        listingFullscreenExitValidation = null;
        console.log('[JumpKey][DEBUG] handleFullscreenExit: Validação cancelada, voltou para fullscreen.');
      }
    }
  }

  function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve) => {
      const el = document.querySelector(selector);
      if (el) {
        resolve(el);
        return;
      }

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });

      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  async function advanceToNextShort(maxAttempts = 8, intervalMs = 140) {
    const selectors = [
      'button[aria-label*="Próximo vídeo" i]',
      'button[aria-label*="próximo" i]',
      'button[aria-label*="Next video" i]',
      'ytd-shorts button.yt-spec-button-shape-next[aria-label]'
    ];

    const findButton = () => {
      for (const selector of selectors) {
        const button = document.querySelector(selector);
        if (!button) continue;
        const disabled = button.disabled || button.getAttribute('aria-disabled') === 'true';
        if (!disabled) {
          return button;
        }
      }
      return null;
    };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const nextButton = findButton();
      if (nextButton) {
        nextButton.click();
        console.log('[JumpKey] advanceToNextShort: next button clicked on attempt', attempt);
        return { status: 'advanced', attempt };
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    console.warn('[JumpKey] advanceToNextShort: next button not found');
    return { status: 'not-found' };
  }

  function needsExpandedModeRefresh() {
    if (!listingShortsModeActive || !isShortsPage()) {
      return false;
    }

    if (!document.getElementById('js-shorts-fullscreen-fix')) {
      return true;
    }

    const app = document.querySelector('ytd-app');
    if (app && !app.hasAttribute('masthead-hidden')) {
      return true;
    }

    const shortsContainer = document.querySelector('ytd-shorts');
    if (shortsContainer) {
      if (shortsContainer.style.width !== '100vw' || shortsContainer.style.height !== '100vh') {
        return true;
      }
    }

    return false;
  }

  function aplicarModoExpandido(options = {}) {
    const {
      source = 'unknown',
      force = false,
      preserveActivationTimestamp = false
    } = options;

    if (listingApplyInProgress && !force) {
      console.log('[JumpKey] aplicarModoExpandido ignored (apply already in progress) source:', source);
      return;
    }

    if (!force && listingShortsModeActive && !needsExpandedModeRefresh()) {
      return;
    }

    listingApplyInProgress = true;
    try {
      console.log('[JumpKey] Starting aplicarModoExpandido');

    const styleNode = document.getElementById('js-shorts-fullscreen-fix');
    if (!styleNode) {
      listingCustomStyle = document.createElement('style');
      listingCustomStyle.id = 'js-shorts-fullscreen-fix';
      listingCustomStyle.textContent = `
      /* Prevent body scroll during expanded mode */
      body {
        overflow: hidden !important;
      }

      /* 1. Hide Header, Sidebar, Search Bar e Masthead */
      #masthead-container, 
      ytd-masthead,
      ytd-mini-guide-renderer, 
      #guide {
        display: none !important;
      }

      /* 2. Zero spaces and force container to viewport size */
      ytd-app {
        --ytd-masthead-height: 0px !important;
        --ytd-persistent-guide-width: 0px !important;
      }
      ytd-shorts {
        --ytd-shorts-player-height: 100vh;
        --ytd-shorts-player-width: 100vw;
      }

      #page-manager.ytd-app, 
      ytd-shorts, 
      #contentContainer.ytd-shorts, 
      ytd-shorts #shorts-container.ytd-shorts {
        margin-top: 0 !important;
        padding: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
      }

      /* 3. Expand Renderer and Video */
      ytd-reel-video-renderer, 
      .video-container.ytd-reel-video-renderer,
      #player-container.ytd-reel-video-renderer {
        width: 100% !important;
        height: 100% !important;
        max-width: none !important;
        max-height: none !important;
      }

      /* force the actual player and video tag to expand as well; YouTube
         frequently applies inline width/height, so we need !important rules */
      .html5-video-player,
      .html5-video-player .html5-video-container,
      .html5-video-player .html5-main-video {
        width: 100vw !important;
        height: 100vh !important;
        max-width: 100% !important;
        max-height: none !important;
      }

      .ytp-fit-cover-video .html5-main-video {
          width: calc((100vh - 6px) * var(--ytd-shorts-player-ratio)) !important;
          height: calc(100vh - 6px) !important;
      }

      ytd-reel-video-renderer {
          --ytd-shorts-player-height: calc(100vh - 6px) !important;
          --ytd-shorts-player-width: min(calc((100vh - 6px) * var(--ytd-shorts-player-ratio-default, var(--ytd-shorts-player-ratio))), calc(100vw - var(--ytd-current-guide-width) - 52px)) !important;
      }
    `;
      document.head.appendChild(listingCustomStyle);
      console.log('[JumpKey] CSS applied (style id:', listingCustomStyle.id, ', length:', (listingCustomStyle.textContent || '').length, ')');

      // Monitor head to detect if the style is removed by page scripts
      try {
        const headObserver = new MutationObserver((records) => {
          for (const rec of records) {
            for (const node of rec.removedNodes) {
              if (node && node.id === 'js-shorts-fullscreen-fix') {
                console.warn('[JumpKey] CSS node was removed from head by page.');
              }
            }
          }
        });
        headObserver.observe(document.head, { childList: true });
        // disconnect after 30s to avoid leaking observers
        setTimeout(() => headObserver.disconnect(), 30000);
      } catch (err) {
        console.warn('[JumpKey] Failed to attach head observer:', err);
      }
    } else {
      listingCustomStyle = styleNode;
    }

    // Apply attributes on ytd-app
    const app = document.querySelector('ytd-app');
    if (app) {
      app.setAttribute('masthead-hidden', '');
      app.removeAttribute('mini-guide-visible');
      console.log('[JumpKey] aplicarModoExpandido - ytd-app attributes updated');
    } else {
      console.warn('[JumpKey] ytd-app not found when applying expanded mode');
    }

    // Force hide visible elements
    const masterheadContainer = document.getElementById('masthead-container');
    if (masterheadContainer) {
      masterheadContainer.style.display = 'none';
      console.log('[JumpKey] masthead-container hidden');
    }

    // Force ytd-shorts to fill viewport
    const shortsContainer = document.querySelector('ytd-shorts');
    if (shortsContainer) {
      shortsContainer.style.width = '100vw';
      shortsContainer.style.height = '100vh';
      shortsContainer.style.margin = '0';
      shortsContainer.style.padding = '0';
      console.log('[JumpKey] ytd-shorts forced to 100vw x 100vh');
    }

    const wasShortsModeActive = listingShortsModeActive;
    listingShortsModeActive = true;
    listingLongVideoModeActive = false;
    if (!wasShortsModeActive && !preserveActivationTimestamp) {
      listingLastAppliedExpandedAt = Date.now();
    }
    try {
      if (window.location.hostname.includes('youtube.com') && /^\/shorts\/?$/.test(window.location.pathname)) {
        console.log('[JumpKey] Expanded mode applied on Shorts home (/shorts without video ID)');
      }
    } catch (error) {
      // ignore logging guard errors
    }
    // Diagnóstico: loga estado de fullscreen e dimensões
    try {
      const availW = screen.availWidth, availH = screen.availHeight;
      const winW = window.innerWidth, winH = window.innerHeight;
      const scrW = screen.width, scrH = screen.height;
      const likelyFS = isLikelyWindowFullscreen ? isLikelyWindowFullscreen() : 'n/a';
      console.log('[JumpKey][DIAG] Fullscreen check após aplicar modo expandido:', {
        isLikelyWindowFullscreen: likelyFS,
        windowInner: { w: winW, h: winH },
        screenAvail: { w: availW, h: availH },
        screen: { w: scrW, h: scrH },
        documentFullscreenElement: !!document.fullscreenElement
      });
    } catch (e) {
      console.warn('[JumpKey][DIAG] Erro ao logar diagnóstico de fullscreen:', e);
    }
      console.log('[JumpKey] aplicarModoExpandido completed');
    } finally {
      listingApplyInProgress = false;
    }
  }

  function removerModoExpandido() {
    listingShortsModeActive = false;
    listingLastAppliedExpandedAt = 0;

    const styleNode = document.getElementById('js-shorts-fullscreen-fix');
    if (styleNode) {
      styleNode.remove();
      listingCustomStyle = null;
      console.log('[JumpKey] Removed custom style tag');
    }

    // Force remove any inline styles that might persist
    document.body.style.removeProperty('overflow');

    // Explicitly restore header visibility - use requestAnimationFrame to ensure it happens after YouTube's event handlers
    const forceRestoreUI = () => {
      const masterheadContainer = document.getElementById('masthead-container');
      if (masterheadContainer) {
        // Remove ALL inline styles to let YouTube's default styling take over
        masterheadContainer.removeAttribute('style');
        //masterheadContainer.style.setProperty('position', 'static', 'important');      
        masterheadContainer.style.setProperty('display', 'block', 'important');
        console.log('[JumpKey] masthead-container inline styles removed');
      }

      // Restore guide/sidebar visibility
      const guide = document.getElementById('guide');
      if (guide) {
        guide.removeAttribute('style');
        console.log('[JumpKey] guide inline styles removed');
      }

      const miniGuide = document.querySelector('ytd-mini-guide-renderer');
      if (miniGuide) {
        miniGuide.removeAttribute('style');
        console.log('[JumpKey] mini-guide inline styles removed');
      }

      const app = document.querySelector('ytd-app');
      if (app) {
        // Remove all masthead-related attributes
        app.removeAttribute('masthead-hidden');
        app.removeAttribute('opened');
        app.removeAttribute('mini-guide-visible');

        // Reset CSS variables to defaults
        app.style.removeProperty('--ytd-masthead-height');
        app.style.removeProperty('--ytd-persistent-guide-width');

        console.log('[JumpKey] ytd-app attributes and CSS variables reset');
      }
    };

    // Execute immediately
    forceRestoreUI();

    // And again after YouTube's event handlers run
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        forceRestoreUI();
        console.log('[JumpKey] UI restoration forced after YouTube event queue');
      });
    });

    const selectorsToReset = [
      'ytd-shorts',
      '#page-manager.ytd-app',
      'ytd-reel-video-renderer',
      '.video-container.ytd-reel-video-renderer',
      '#player-container.ytd-reel-video-renderer',
      '#shorts-container.ytd-shorts',
      '#contentContainer.ytd-shorts'
    ];

    selectorsToReset.forEach(sel => {
      const el = document.querySelector(sel);
      if (el) {
        el.style.removeProperty('width');
        el.style.removeProperty('height');
        el.style.removeProperty('margin-top');
        el.style.removeProperty('margin');
        el.style.removeProperty('padding');
        el.style.removeProperty('--ytd-shorts-player-height');
        el.style.removeProperty('--ytd-shorts-player-width');
        el.style.removeProperty('max-width');
        el.style.removeProperty('max-height');
      }
    });

    const longVideoCleanupSelectors = [
      '#full-bleed-container.ytd-watch-flexy',
      '.jumpkey-long-expanded'
    ];

    const inlinePropsToClear = [
      'position',
      'top',
      'left',
      'right',
      'bottom',
      'width',
      'height',
      'margin',
      'padding',
      'min-width',
      'min-height',
      'max-width',
      'max-height',
      'z-index',
      'object-fit'
    ];

    longVideoCleanupSelectors.forEach((sel) => {
      const el = document.querySelector(sel);
      if (el) {
        inlinePropsToClear.forEach((prop) => el.style.removeProperty(prop));
        el.classList.remove('jumpkey-long-expanded');
      }
    });

    const mediaElements = document.querySelectorAll(`${longVideoCleanupSelectors.join(', ')} video, ${longVideoCleanupSelectors.join(', ')} .html5-main-video`);
    mediaElements.forEach((media) => {
      inlinePropsToClear.forEach((prop) => media.style.removeProperty(prop));
    });

    console.log('[JumpKey] removerModoExpandido completed, triggering resize');
    window.dispatchEvent(new Event('resize'));
  }

  function aplicarModoExpandidoLongo() {
    // Detecta o container do player+UI automaticamente
    const playerContainer = typeof findPlayerContainer === 'function' ? findPlayerContainer() : null;
    if (!playerContainer) {
      console.warn('[JumpKey] Player container não encontrado, fallback para #full-bleed-container');
    }

    // Remove estilo antigo se existir
    if (listingLongVideoStyle) {
      listingLongVideoStyle.remove();
      listingLongVideoStyle = null;
    }

    // Cria novo estilo para o container detectado
    listingLongVideoStyle = document.createElement('style');
    listingLongVideoStyle.id = 'js-long-video-fullscreen-fix';
    let selector = playerContainer ? '' : '#full-bleed-container.ytd-watch-flexy';
    if (playerContainer) {
      // Adiciona uma classe temporária para garantir seleção única
      playerContainer.classList.add('jumpkey-long-expanded');
      selector = '.jumpkey-long-expanded';
    }
    listingLongVideoStyle.textContent = `
    body {
      overflow: hidden !important;
    }
    ytd-masthead {
      display: none !important;
    }
    ${selector} {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      margin: 0 !important;
      padding: 0 !important;
      max-width: none !important;
      max-height: none !important;
      z-index: 999999 !important;
      background: #000 !important;
    }
    #below, #secondary {
      display: none !important;
    }
    ${selector} video, ${selector} .html5-main-video {
      width: 100vw !important;
      height: 100vh !important;
      max-width: 100vw !important;
      max-height: 100vh !important;
      object-fit: contain !important;
      background: #000 !important;
    }
    ${selector} video {
      left: 0 !important;
    }
  `;
    document.head.appendChild(listingLongVideoStyle);

    listingLongVideoModeActive = true;
    listingShortsModeActive = false;
    listingLastAppliedExpandedAt = Date.now();
    console.log('[JumpKey] aplicarModoExpandidoLongo - mode activated at', listingLastAppliedExpandedAt, 'selector:', selector);
  }

  function removerModoExpandidoLongo() {
    listingLongVideoModeActive = false;
    listingLastAppliedExpandedAt = 0;

    const styleNode = document.getElementById('js-long-video-fullscreen-fix');
    if (styleNode) {
      styleNode.remove();
      listingLongVideoStyle = null;
    }

    const shortsStyle = document.getElementById('js-shorts-fullscreen-fix');
    if (shortsStyle) {
      shortsStyle.remove();
      listingCustomStyle = null;
    }

    // Restore body overflow
    document.body.style.removeProperty('overflow');

    // Restore UI elements - use requestAnimationFrame to ensure it happens after YouTube's event handlers
    const forceRestoreUI = () => {
      const masterheadContainer = document.getElementById('masthead-container');
      if (masterheadContainer) {
        masterheadContainer.removeAttribute('style');
        //masterheadContainer.style.setProperty('position', 'static', 'important');
        masterheadContainer.style.setProperty('display', 'block', 'important');
      }

      const guide = document.getElementById('guide');
      if (guide) {
        guide.removeAttribute('style');
      }

      const miniGuide = document.querySelector('ytd-mini-guide-renderer');
      if (miniGuide) {
        miniGuide.removeAttribute('style');
      }

      const app = document.querySelector('ytd-app');
      if (app) {
        app.removeAttribute('masthead-hidden');
        app.removeAttribute('opened');
        app.removeAttribute('mini-guide-visible');
        app.style.removeProperty('--ytd-masthead-height');
        app.style.removeProperty('--ytd-persistent-guide-width');
      }
    };

    // Execute immediately
    forceRestoreUI();

    // And again after YouTube's event handlers run
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        forceRestoreUI();
      });
    });

    console.log('[JumpKey] Long video fullscreen mode removed, body overflow restored');

    window.dispatchEvent(new Event('resize'));
  }

  async function setReelFullscreen(enabled) {
    console.log('[JumpKey] ========== setReelFullscreen called with enabled:', enabled, '==========');

    // return an object describing what we tried; callers expect a promise
    if (enabled) {
      try {
        // When switching tabs, the page may not yet have fully initialized.
        // Wait for the shorts container to exist before applying expanded mode.
        const shortsRoot = await waitForElement('ytd-shorts', 2000);
        if (!shortsRoot) {
          console.warn('[JumpKey] setReelFullscreen: shorts container not found, will retry later');
          // Schedule a retry after a short delay in case it appears soon.
          setTimeout(() => {
            try {
              if (isShortsPage()) {
                aplicarModoExpandido({ source: 'setReelFullscreen-retry', force: true });
                console.log('[JumpKey] Expanded mode applied on retry');
              }
            } catch (err) {
              console.warn('[JumpKey] Retry applying expanded mode failed:', err);
            }
          }, 300);
          return { status: 'deferred', reason: 'shorts-not-ready' };
        }

        aplicarModoExpandido({ source: 'setReelFullscreen', force: true });
        console.log('[JumpKey] Expanded mode applied');
        return { status: 'applied', method: 'expanded-mode' };
      } catch (err) {
        console.warn('[JumpKey] Error applying expanded mode:', err);
        return { status: 'error', error: err.message };
      }
    } else {
      try {
        removerModoExpandido();
        console.log('[JumpKey] Expanded mode removed');
        return { status: 'removed' };
      } catch (err) {
        console.warn('[JumpKey] Error removing expanded mode:', err);
        return { status: 'error', error: err.message };
      }
    }
  }

  // Handle Escape key: exit native fullscreen and remove any expanded modes
  async function handleEscapeKey() {
    try {
      console.log('[JumpKey] Escape pressed - attempting to exit fullscreen/expanded mode');

      // Exit Document fullscreen if active
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
          console.log('[JumpKey] Exited document fullscreen');
        }
      } catch (err) {
        console.warn('[JumpKey] Failed to exit document fullscreen:', err);
      }

      // Remove expanded modes applied by the extension
      if (listingShortsModeActive) {
        try {
          removerModoExpandido();
          console.log('[JumpKey] Removed shorts expanded mode via Escape');
        } catch (e) {
          console.warn('[JumpKey] Error removing shorts expanded mode:', e);
        }
      }

      if (listingLongVideoModeActive) {
        try {
          removerModoExpandidoLongo();
          console.log('[JumpKey] Removed long video expanded mode via Escape');
        } catch (e) {
          console.warn('[JumpKey] Error removing long video expanded mode:', e);
        }
      }

      // Garante que a janela saia do fullscreen (não só o documento)
      try {
        if (chrome && chrome.windows && chrome.windows.getCurrent && chrome.windows.update) {
          chrome.windows.getCurrent((win) => {
            if (win && win.state === 'fullscreen') {
              // Prefer maximizing instead of normalizing to avoid ending up in a half-width window.
              chrome.windows.update(win.id, { state: 'maximized' }, () => {
                console.log('[JumpKey][DEBUG] handleEscapeKey: chrome.windows.update chamado para sair do fullscreen (maximized):', win.id);
              });
            } else {
              console.log('[JumpKey][DEBUG] handleEscapeKey: Janela não está em fullscreen (estado atual):', win && win.state);
            }
          });
        }
      } catch (e) {
        console.log('[JumpKey][DEBUG] handleEscapeKey: Erro ao tentar sair do fullscreen da janela:', e);
      }

      try {
        if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ action: 'exitFullscreenWindow' }, (resp) => {
            if (chrome.runtime.lastError) {
              console.debug('[JumpKey] exitFullscreenWindow lastError:', chrome.runtime.lastError && chrome.runtime.lastError.message);
            } else {
              console.log('[JumpKey] background exit fullscreen response:', resp);
            }
          });
        }
      } catch (e) {
        // ignore
      }

    } catch (err) {
      console.error('[JumpKey] handleEscapeKey error:', err);
    }
  }

  if (typeof chrome !== 'undefined' && chrome.runtime) {
    console.log('[JumpKey] Registering message listener');

    const messageHandler = (message, sender, sendResponse) => {
      try {
        console.log('[JumpKey] ===== MESSAGE RECEIVED =====');
        console.log('[JumpKey] Message action:', message?.action);
        console.log('[JumpKey] Full message:', message);
        console.log('[JumpKey] Sender tab:', sender.tab?.id);

        // quick ping for background to check if content is ready
        if (message.action === 'ping') {
          console.log('[JumpKey] Received ping from background, responding pong');
          sendResponse({ status: 'pong' });
          return false;
        }

        // 🏷️ Tag-related actions (synchronous responses)
        if (message.action === 'getTagStats') {
          console.log('[JumpKey] ACTION: getTagStats detected');
          const stats = getTagStats();
          sendResponse({ status: 'success', data: stats });
          return false;
        } else if (message.action === 'getTopTags') {
          console.log('[JumpKey] ACTION: getTopTags detected');
          const limit = message.limit || 10;
          const topTags = getTopTags(limit);
          sendResponse({ status: 'success', data: topTags });
          return false;
        } else if (message.action === 'clearTagScores') {
          console.log('[JumpKey] ACTION: clearTagScores detected');
          const result = clearTagScores();
          sendResponse({ status: result ? 'success' : 'error' });
          return false;
        } else if (message.action === 'generateSmartSearchUrl') {
          console.log('[JumpKey] ACTION: generateSmartSearchUrl detected');
          const limit = message.limit || 3;
          const url = generateSmartSearchUrl(limit);
          sendResponse({ status: 'success', data: url });
          return false;
        } else if (message.action === 'getCurrentTags') {
          console.log('[JumpKey] ACTION: getCurrentTags detected');
          const extractTagsFn = typeof extractAllTags === 'function'
            ? extractAllTags
            : (typeof window.extractAllTags === 'function' ? window.extractAllTags : null);
          const tags = extractTagsFn ? extractTagsFn() : [];
          sendResponse({ status: 'success', data: tags });
          return false;
        } else if (message.action === 'setReelFullscreen') {
          console.log('[JumpKey] ACTION: setReelFullscreen detected');
          // Asynchronous - return true
          setReelFullscreen(Boolean(message.enabled))
            .then((result) => {
              sendResponse({ status: 'processed', result });
            })
            .catch((err) => {
              console.warn('[JumpKey] setReelFullscreen failed:', err);
              sendResponse({ status: 'error', error: err && err.message });
            });
          return true;
        } else if (message.action === 'advanceToNextShort') {
          console.log('[JumpKey] ACTION: advanceToNextShort detected');
          const maxAttempts = Number.isFinite(Number(message.maxAttempts)) ? Number(message.maxAttempts) : undefined;
          const intervalMs = Number.isFinite(Number(message.intervalMs)) ? Number(message.intervalMs) : undefined;
          advanceToNextShort(maxAttempts, intervalMs)
            .then((result) => {
              sendResponse({ status: 'processed', result });
            })
            .catch((err) => {
              console.warn('[JumpKey] advanceToNextShort failed:', err);
              sendResponse({ status: 'error', error: err && err.message });
            });
          return true;
        } else if (message.action === 'fadeOutAudio') {
          console.log('[JumpKey] ACTION: fadeOutAudio detected');
          // Asynchronous - return true
          fadeOutCurrentVideoAudio(message.durationMs, message.steps)
            .then((result) => {
              sendResponse({ status: 'processed', result });
            })
            .catch((error) => {
              console.warn('[JumpKey] fadeOutAudio failed:', error);
              sendResponse({ status: 'error' });
            });
          return true;
        } else if (message.action === 'setLongVideoFullscreen') {
          console.log('[JumpKey] ACTION: setLongVideoFullscreen detected');
          // Asynchronous - return true
          if (message.enabled) {
            // don't leave shorts mode hanging if it was active
            removerModoExpandido();

            const attemptApplyLongFullscreen = (attemptsLeft = 3, delayMs = 300) => {
              return waitForElement('#full-bleed-container.ytd-watch-flexy', 2000).then((container) => {
                if (container) {
                  aplicarModoExpandidoLongo();
                  sendResponse({ status: 'processed', result: 'applied' });
                  return true;
                }

                if (attemptsLeft > 0) {
                  console.log('[JumpKey] setLongVideoFullscreen: container not found, retrying...', attemptsLeft);
                  return new Promise((resolve) => {
                    setTimeout(() => resolve(attemptApplyLongFullscreen(attemptsLeft - 1, delayMs)), delayMs);
                  });
                }

                sendResponse({ status: 'error', error: 'container-not-found' });
                return false;
              });
            };

            attemptApplyLongFullscreen().catch((e) => sendResponse({ status: 'error', error: e && e.message }));
            return true;
          } else {
            removerModoExpandidoLongo();
            console.log('[JumpKey] Long video fullscreen mode removed');
            sendResponse({ status: 'processed', result: 'removed' });
            return false;
          }
        }

        sendResponse({ status: 'ignored' });
        return false;
      } catch (error) {
        console.error('[JumpKey] Error handling message:', error);
        sendResponse({ status: 'error' });
        return false;
      }
    };

    try {
      chrome.runtime.onMessage.addListener(messageHandler);
      console.log('[JumpKey] Message listener registered successfully');
    } catch (err) {
      console.error('[JumpKey] Error registering message listener:', err);
    }

    // Check if expanded mode should be applied on load
    // (in case of already loaded page or reload)
    if (jumpKeyGlobalState.DOMContentLoadedHandler) {
      window.removeEventListener('DOMContentLoaded', jumpKeyGlobalState.DOMContentLoadedHandler);
    }

    jumpKeyGlobalState.DOMContentLoadedHandler = () => {
      console.log('[JumpKey] DOMContentLoaded event fired');

      // Check for Out of Memory error on page load
      if (detectAndReloadOutOfMemory()) {
        return;
      }

      if (listingShortsModeActive) {
        console.log('[JumpKey] Replicating shorts mode on DOMContentLoaded');
        setTimeout(() => aplicarModoExpandido({ source: 'DOMContentLoaded', preserveActivationTimestamp: true }), 100);
      }
    };

    window.addEventListener('DOMContentLoaded', jumpKeyGlobalState.DOMContentLoadedHandler);
  }

  // Manage resize and fullscreenchange listeners to avoid accumulation
  if (jumpKeyGlobalState.resizeHandler) {
    window.removeEventListener('resize', jumpKeyGlobalState.resizeHandler);
  }

  jumpKeyGlobalState.resizeHandler = handleFullscreenExit;

  window.addEventListener('resize', jumpKeyGlobalState.resizeHandler);

  if (jumpKeyGlobalState.fullscreenchangeHandler) {
    document.removeEventListener('fullscreenchange', jumpKeyGlobalState.fullscreenchangeHandler);
  }

  jumpKeyGlobalState.fullscreenchangeHandler = handleFullscreenExit;

  document.addEventListener('fullscreenchange', jumpKeyGlobalState.fullscreenchangeHandler);

  // Reapply expanded mode when page loads if necessary
  if (jumpKeyGlobalState.loadHandler) {
    window.removeEventListener('load', jumpKeyGlobalState.loadHandler);
  }

  jumpKeyGlobalState.loadHandler = () => {
    console.log('[JumpKey] Load event fired');

    // Check for Out of Memory error on page load
    if (detectAndReloadOutOfMemory()) {
      return;
    }

    if (listingShortsModeActive) {
      console.log('[JumpKey] Shorts mode active, replicating...');
      aplicarModoExpandido({ source: 'load', preserveActivationTimestamp: true });
    }
    if (listingLongVideoModeActive) {
      console.log('[JumpKey] Long video mode active, replicating...');
      aplicarModoExpandidoLongo();
    }
  };

  window.addEventListener('load', jumpKeyGlobalState.loadHandler);

  window.addEventListener('focus', () => {
    if (!isLikelyWindowFullscreen()) {
      return;
    }

    if (isShortsPage()) {
      const shortsContainer = document.querySelector('ytd-shorts');
      if (shortsContainer && (!listingShortsModeActive || needsExpandedModeRefresh())) {
        console.log('[JumpKey] focus on fullscreen-sized window with shorts canvas; applying expanded mode');
        aplicarModoExpandido({ source: 'windowFocusFullscreen', force: true });
      }
    } else {
      const longContainer = document.querySelector('#full-bleed-container.ytd-watch-flexy, #player-container-outer');
      if (longContainer && !listingLongVideoModeActive) {
        console.log('[JumpKey] focus on fullscreen-sized window with long video; applying expanded mode');
        aplicarModoExpandidoLongo();
      }
    }
  });

  // Also monitors document changes to reapply CSS if removed
  const cssObserver = new MutationObserver(() => {
    if (listingShortsModeActive && !document.getElementById('js-shorts-fullscreen-fix')) {
      console.log('[JumpKey] Expanded mode CSS was removed, replicating...');
      listingCustomStyle = null;
      aplicarModoExpandido();
    }
    if (listingLongVideoModeActive && !document.getElementById('js-long-video-fullscreen-fix')) {
      console.log('[JumpKey] Long video CSS was removed, replicating...');
      listingLongVideoStyle = null;
      aplicarModoExpandidoLongo();
    }
  });

  if (jumpKeyGlobalState.cssObserver) {
    jumpKeyGlobalState.cssObserver.disconnect();
  }

  jumpKeyGlobalState.cssObserver = cssObserver;

  if (document.head) {
    cssObserver.observe(document.head, {
      childList: true,
      subtree: false
    });
  }

  refreshBlockedTags();
  // Removed unnecessary setInterval - storage.onChanged below already monitors changes
  loadShortcutSettings();

  if (chrome.storage && chrome.storage.onChanged) {
    if (jumpKeyGlobalState.storageHandler) {
      chrome.storage.onChanged.removeListener(jumpKeyGlobalState.storageHandler);
    }

    jumpKeyGlobalState.storageHandler = (changes, areaName) => {
      if (areaName === 'sync' && changes.customShortcuts) {
        loadShortcutSettings();
      }

      if (areaName === 'local' && changes.blockedTags) {
        console.log('[JumpKey] Blocked tags changed, reloading...');
        refreshBlockedTags();
      }
    };

    chrome.storage.onChanged.addListener(jumpKeyGlobalState.storageHandler);
  }

  function getVideoObservationRoot() {
    const shortsContainer = document.querySelector('ytd-shorts #shorts-container');
    if (shortsContainer) {
      return shortsContainer;
    }

    const shortsElement = document.querySelector('ytd-shorts');
    if (shortsElement) {
      return shortsElement;
    }

    return document.body;
  }

  function disconnectVideoObserver() {
    if (jumpKeyGlobalState.videoObserver) {
      jumpKeyGlobalState.videoObserver.disconnect();
      jumpKeyGlobalState.videoObserver = null;
    }
    listingObservedRootNode = null;
  }

  let pendingExpandedModeReapplyTimeout = null;

  function deferExpandedModeReapply(delay = 160) {
    if (!listingShortsModeActive || !isShortsPage()) {
      return;
    }

    if (!needsExpandedModeRefresh()) {
      return;
    }

    if (pendingExpandedModeReapplyTimeout) {
      return;
    }

    pendingExpandedModeReapplyTimeout = setTimeout(() => {
      pendingExpandedModeReapplyTimeout = null;

      if (!listingShortsModeActive || !isShortsPage()) {
        return;
      }

      try {
        aplicarModoExpandido({ source: 'navigation-mutation', preserveActivationTimestamp: true });
      } catch (error) {
        console.warn('[JumpKey] Failed to reapply expanded mode after navigation:', error);
      }
    }, delay);
  }

  function ensureVideoObserver() {
    if (!isShortsPage()) {
      disconnectVideoObserver();
      return;
    }

    const nextRoot = getVideoObservationRoot();
    if (!nextRoot) {
      return;
    }

    if (jumpKeyGlobalState.videoObserver && listingObservedRootNode === nextRoot) {
      return;
    }

    disconnectVideoObserver();

    const observer = new MutationObserver(() => {
      queueReportCurrentVideo();
      deferExpandedModeReapply();
    });

    observer.observe(nextRoot, {
      childList: true,
      subtree: true,
      characterData: false,
      attributes: false
    });

    jumpKeyGlobalState.videoObserver = observer;
    listingObservedRootNode = nextRoot;
  }

  ensureVideoObserver();

  scheduleReportCurrentVideo(0);

  if (jumpKeyGlobalState.popstateHandler) {
    window.removeEventListener('popstate', jumpKeyGlobalState.popstateHandler);
  }

  jumpKeyGlobalState.popstateHandler = () => {
    ensureVideoObserver();
    scheduleReportCurrentVideo(0);
    deferExpandedModeReapply(0);
  };

  window.addEventListener('popstate', jumpKeyGlobalState.popstateHandler);

  if (jumpKeyGlobalState.hashchangeHandler) {
    window.removeEventListener('hashchange', jumpKeyGlobalState.hashchangeHandler);
  }

  jumpKeyGlobalState.hashchangeHandler = () => {
    ensureVideoObserver();
    scheduleReportCurrentVideo(0);
    deferExpandedModeReapply(0);
  };

  window.addEventListener('hashchange', jumpKeyGlobalState.hashchangeHandler);

  if (jumpKeyGlobalState.ytNavigationHandler) {
    window.removeEventListener('yt-navigate-finish', jumpKeyGlobalState.ytNavigationHandler);
  }

  jumpKeyGlobalState.ytNavigationHandler = () => {
    // Navigation completed - stop preserving fullscreen state (if it was set)
    try {
      window.__jumpKeyPreserveFullscreen = false;
    } catch (e) {
      // ignore
    }

    ensureVideoObserver();
    scheduleReportCurrentVideo(0);
    deferExpandedModeReapply(0);
  };

  window.addEventListener('yt-navigate-finish', jumpKeyGlobalState.ytNavigationHandler);

  if (typeof chrome !== 'undefined' && chrome.runtime) {
    if (jumpKeyGlobalState.keydownHandler) {
      document.removeEventListener('keydown', jumpKeyGlobalState.keydownHandler);
    }

    jumpKeyGlobalState.keydownHandler = (event) => {
      // Always allow Escape to exit fullscreen/expanded mode, even when inputs are focused
      try {
        if (event.key === 'Escape' || event.key === 'Esc') {
          event.preventDefault();
          handleEscapeKey();
          return;
        }
      } catch (e) {
        // ignore
      }

      const activeElement = document.activeElement;

      // 1) Handle seekbar focus edge case: allow shortcuts even quando seekbar tem foco.
      const isSeekbarElement = (el) => {
        if (!el || !(el instanceof Element)) return false;
        return ['INPUT', 'DIV', 'SPAN', 'PROGRESS'].includes(el.tagName) &&
               (el.classList.contains('ytp-progress-bar') || el.classList.contains('ytp-time-slider') || el.id === 'progress');
      };

      if (isSeekbarElement(activeElement)) {
        activeElement.blur();
      }

      if (isInputElement(activeElement)) {
        return;
      }

      if (event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }

      const command = getShortcutCommand(event);
      if (!command) {
        return;
      }

      event.preventDefault();
      handleShortcutCommand(command);
    };

    document.addEventListener('keydown', jumpKeyGlobalState.keydownHandler);
  }

  if (jumpKeyGlobalState.pagehideHandler) {
    window.removeEventListener('pagehide', jumpKeyGlobalState.pagehideHandler);
  }

  jumpKeyGlobalState.pagehideHandler = () => {
    if (listingFullscreenExitValidation) {
      clearTimeout(listingFullscreenExitValidation);
      listingFullscreenExitValidation = null;
    }

    if (pendingVideoReportTimeout) {
      clearTimeout(pendingVideoReportTimeout);
      pendingVideoReportTimeout = null;
    }

    if (pendingVideoReportRaf) {
      cancelAnimationFrame(pendingVideoReportRaf);
      pendingVideoReportRaf = null;
    }

    if (pendingShortsModeReapplyTimeout) {
      clearTimeout(pendingShortsModeReapplyTimeout);
      pendingShortsModeReapplyTimeout = null;
    }

    cssObserver.disconnect();
    disconnectVideoObserver();
  };

  window.addEventListener('pagehide', jumpKeyGlobalState.pagehideHandler);

  // -----------------------------
  // Save to Watch Later UI helpers
  // -----------------------------

  // Keep track of last menu-trigger videoId (set when user clicks the 3-dot button)
  window.__srLastMenuVideoId = window.__srLastMenuVideoId || null;

  // getVideoIdFromElement is available from content-video.js (shared helper)

  // Safe runtime messaging to handle background/service-worker reloads
  // safeSendMessage is defined in content-video.js (shared helper)

  // showThumbToast available through shared utilities in content-video.js

  // Expor funções utilitárias globais para DevTools
  try {
    if (typeof findPlayerContainer === 'function') {
      window.findPlayerContainer = findPlayerContainer;
    }
    if (typeof aplicarModoExpandidoLongo === 'function') {
      window.aplicarModoExpandidoLongo = aplicarModoExpandidoLongo;
    }
    if (typeof removerModoExpandidoLongo === 'function') {
      window.removerModoExpandidoLongo = removerModoExpandidoLongo;
    }
    if (typeof aplicarModoExpandido === 'function') {
      window.aplicarModoExpandido = aplicarModoExpandido;
    }
    if (typeof removerModoExpandido === 'function') {
      window.removerModoExpandido = removerModoExpandido;
    }
  } catch (e) {
    // ignore
  }
})();


