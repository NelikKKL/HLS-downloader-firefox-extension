(function() {
  'use strict';
  
  const detectedUrls = new Set();
  
  // Перехват нативного HLS
  interceptNativeHLS();
  
  // Перехват Hls.js
  interceptHlsJs();
  
  // Перехват Video.js
  interceptVideoJs();
  
  // Перехват Plyr
  interceptPlyr();
  
  // Перехват нативных video элементов
  interceptVideoElements();
  
  // Периодическая проверка
  setInterval(scanForVideos, 2000);
  
  function interceptNativeHLS() {
    // Перехват src у video элементов
    const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      get: function() {
        return originalDescriptor.get.call(this);
      },
      set: function(value) {
        if (value && (value.includes('.m3u8') || value.includes('application/x-mpegURL'))) {
          notifyBackground(value, 'native');
        }
        return originalDescriptor.set.call(this, value);
      }
    });
  }
  
  function interceptHlsJs() {
    if (window.Hls) {
      patchHlsConstructor(window.Hls);
    } else {
      Object.defineProperty(window, 'Hls', {
        get: function() {
          return window._Hls;
        },
        set: function(HlsClass) {
          window._Hls = HlsClass;
          patchHlsConstructor(HlsClass);
        }
      });
    }
  }
  
  function patchHlsConstructor(Hls) {
    const OriginalHls = Hls;
    
    window.Hls = class extends OriginalHls {
      constructor(config) {
        super(config);
        
        this.on(OriginalHls.Events.MANIFEST_LOADED, (event, data) => {
          if (data.url) {
            notifyBackground(data.url, 'hls.js');
          }
        });
        
        this.on(OriginalHls.Events.LEVEL_LOADED, (event, data) => {
          if (data.details && data.details.fragments) {
            // Сохраняем информацию о фрагментах
            window.__hlsFragments = data.details.fragments;
          }
        });
      }
      
      loadSource(url) {
        notifyBackground(url, 'hls.js');
        return super.loadSource(url);
      }
    };
    
    // Копируем статические свойства
    Object.setPrototypeOf(window.Hls, OriginalHls);
    Object.keys(OriginalHls).forEach(key => {
      window.Hls[key] = OriginalHls[key];
    });
  }
  
  function interceptVideoJs() {
    if (window.videojs) {
      patchVideoJs();
    } else {
      Object.defineProperty(window, 'videojs', {
        get: function() {
          return window._videojs;
        },
        set: function(vjs) {
          window._videojs = vjs;
          patchVideoJs();
        }
      });
    }
  }
  
  function patchVideoJs() {
    const originalVideojs = window.videojs;
    
    window.videojs = function(id, options, ready) {
      const player = originalVideojs.apply(this, arguments);
      
      player.ready(() => {
        const tech = player.tech({ IWillNotUseThisInPlugins: true });
        
        if (tech) {
          // VHS (Video.js HTTP Streaming)
          if (tech.vhs) {
            tech.vhs.on('manifestloaded', (event, data) => {
              if (data && data.uri) {
                notifyBackground(data.uri, 'video.js');
              }
            });
          }
          
          // HLS
          if (tech.hls) {
            tech.hls.on('manifestloaded', (event, data) => {
              if (data && data.uri) {
                notifyBackground(data.uri, 'video.js');
              }
            });
          }
        }
      });
      
      return player;
    };
  }
  
  function interceptPlyr() {
    if (window.Plyr) {
      const originalSetup = window.Plyr.setup;
      
      window.Plyr.setup = function(target, options) {
        const instances = originalSetup.apply(this, arguments);
        
        instances.forEach(player => {
          if (player.media && player.media.src) {
            notifyBackground(player.media.src, 'plyr');
          }
        });
        
        return instances;
      };
    }
  }
  
  function interceptVideoElements() {
    // Наблюдатель за новыми video элементами
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.tagName === 'VIDEO') {
            checkVideoSource(node);
          }
          
          if (node.querySelectorAll) {
            node.querySelectorAll('video').forEach(checkVideoSource);
          }
        });
      });
    });
    
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
    
    // Проверяем существующие
    document.querySelectorAll('video').forEach(checkVideoSource);
  }
  
  function checkVideoSource(video) {
    // Прямой src
    if (video.src && video.src.includes('.m3u8')) {
      notifyBackground(video.src, 'video-element');
    }
    
    // Source элементы
    video.querySelectorAll('source').forEach(source => {
      if (source.src && source.src.includes('.m3u8')) {
        notifyBackground(source.src, 'video-source');
      }
    });
    
    // data-src (lazy loading)
    if (video.dataset.src && video.dataset.src.includes('.m3u8')) {
      notifyBackground(video.dataset.src, 'video-data');
    }
  }
  
  function scanForVideos() {
    // Ищем в network через performance API
    if (performance.getEntriesByType) {
      const entries = performance.getEntriesByType('resource');
      
      entries.forEach(entry => {
        if (entry.name && entry.name.includes('.m3u8')) {
          notifyBackground(entry.name, 'performance-api');
        }
      });
    }
    
    // Ищем в document
    const scripts = document.querySelectorAll('script');
    scripts.forEach(script => {
      const text = script.textContent;
      if (text) {
        const matches = text.match(/https?:\/\/[^\s"']+\.m3u8/g);
        if (matches) {
          matches.forEach(url => notifyBackground(url, 'script-parse'));
        }
      }
    });
  }
  
  function notifyBackground(url, source) {
    if (!url || detectedUrls.has(url)) return;
    
    // Нормализуем URL
    try {
      const urlObj = new URL(url, window.location.href);
      url = urlObj.href;
    } catch (e) {
      return;
    }
    
    detectedUrls.add(url);
    
    browser.runtime.sendMessage({
      action: 'videoDetected',
      url: url,
      source: source,
      pageUrl: window.location.href,
      pageTitle: document.title
    }).catch(() => {});
  }
  
  // Слушаем сообщения от background
  browser.runtime.onMessage.addListener((request) => {
    if (request.action === 'ping') {
      return Promise.resolve({ status: 'ok' });
    }
  });
})();
