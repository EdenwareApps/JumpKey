(() => {
  if (window.__jumpKeyDurationWorkerInstalled) {
    return;
  }
  window.__jumpKeyDurationWorkerInstalled = true;

  const WORKER_TITLE = 'JumpKey Queue Sync';
  const WORKER_SUBTITLE = 'Syncing library records in the background';

  function applyWorkerPresentation() {
    try {
      document.title = WORKER_TITLE;

      let metaDesc = document.querySelector('meta[name="description"]');
      if (!metaDesc) {
        metaDesc = document.createElement('meta');
        metaDesc.setAttribute('name', 'description');
        document.head.appendChild(metaDesc);
      }
      metaDesc.setAttribute('content', WORKER_SUBTITLE);

      let favicon = document.querySelector('link[rel="icon"]');
      if (!favicon) {
        favicon = document.createElement('link');
        favicon.setAttribute('rel', 'icon');
        document.head.appendChild(favicon);
      }
      const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='%231f2937'/><path d='M18 22h28v6H18zm0 10h20v6H18zm0 10h28v6H18z' fill='%23f3f4f6'/></svg>";
      favicon.setAttribute('href', `data:image/svg+xml,${encodeURIComponent(svg)}`);
    } catch (err) {
      console.warn('[JumpKey Worker] Failed to apply worker presentation:', err);
    }
  }

  applyWorkerPresentation();

  let ytApiPromise = null;
  let isProcessing = false;

  function loadYouTubeIframeAPI() {
    if (window.YT && window.YT.Player) {
      return Promise.resolve();
    }

    if (ytApiPromise) {
      return ytApiPromise;
    }

    ytApiPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
      if (!existingScript) {
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
        script.onerror = () => reject(new Error('Failed to load YouTube IFrame API'));
        document.head.appendChild(script);
      }

      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting YouTube IFrame API'));
      }, 10000);

      const previousReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        clearTimeout(timeout);
        if (typeof previousReady === 'function') {
          try {
            previousReady();
          } catch (_) {}
        }
        resolve();
      };

      if (window.YT && window.YT.Player) {
        clearTimeout(timeout);
        resolve();
      }
    });

    return ytApiPromise;
  }

  async function getYouTubeDurationLight(videoId) {
    if (!videoId) return null;
    await loadYouTubeIframeAPI();

    return new Promise((resolve) => {
      const container = document.createElement('div');
      container.style.cssText = 'position:fixed; left:-10000px; top:-10000px; width:1px; height:1px; overflow:hidden; opacity:0; pointer-events:none;';
      document.body.appendChild(container);

      let finished = false;
      let player = null;

      const finish = (duration) => {
        if (finished) return;
        finished = true;

        try {
          if (player && typeof player.destroy === 'function') {
            player.destroy();
          }
        } catch (_) {}

        try {
          if (container && container.parentNode) {
            container.parentNode.removeChild(container);
          }
        } catch (_) {}

        resolve(Number.isFinite(Number(duration)) && Number(duration) > 0 ? Number(duration) : null);
      };

      player = new YT.Player(container, {
        width: 1,
        height: 1,
        videoId,
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          playsinline: 1,
          rel: 0
        },
        events: {
          onReady: async (event) => {
            const direct = Number(event?.target?.getDuration?.() || 0);
            if (direct > 0) {
              finish(direct);
              return;
            }

            setTimeout(() => {
              const delayed = Number(event?.target?.getDuration?.() || 0);
              finish(delayed > 0 ? delayed : null);
            }, 700);
          },
          onError: () => finish(null)
        }
      });

      setTimeout(() => finish(null), 7000);
    });
  }

  async function processVideoIds(videoIds) {
    const ids = Array.isArray(videoIds)
      ? videoIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];

    const results = {};
    for (const videoId of ids) {
      const duration = await getYouTubeDurationLight(videoId);
      results[videoId] = duration;

      if (Number.isFinite(Number(duration)) && Number(duration) > 0) {
        chrome.runtime.sendMessage({
          action: 'reportVideoDuration',
          videoId,
          duration: Number(duration),
          source: 'duration-worker'
        }, () => {
          if (chrome.runtime.lastError) {
            console.warn('[JumpKey Worker] reportVideoDuration error:', chrome.runtime.lastError.message);
          }
        });
      }

      await new Promise((res) => setTimeout(res, 120));
    }

    return results;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.action) {
      return false;
    }

    if (message.action === 'durationWorkerPing') {
      sendResponse({ ok: true, title: document.title, busy: isProcessing });
      return false;
    }

    if (message.action === 'durationWorkerProcess') {
      if (isProcessing) {
        sendResponse({ ok: false, error: 'busy' });
        return false;
      }

      isProcessing = true;
      (async () => {
        try {
          const results = await processVideoIds(message.videoIds || []);
          sendResponse({ ok: true, results });
        } catch (err) {
          sendResponse({ ok: false, error: err?.message || String(err) });
        } finally {
          isProcessing = false;
        }
      })();

      return true;
    }

    return false;
  });

  console.log('[JumpKey Worker] Duration worker ready:', WORKER_TITLE);
})();
