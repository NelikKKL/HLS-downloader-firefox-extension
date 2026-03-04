// Хранилище обнаруженных видео
const detectedVideos = new Map();

// Перехват M3U8 запросов
browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = details.url;
    
    // Фильтруем M3U8 и манифесты
    if (isHLSUrl(url)) {
      const tabId = details.tabId;
      
      if (!detectedVideos.has(tabId)) {
        detectedVideos.set(tabId, new Map());
      }
      
      const videos = detectedVideos.get(tabId);
      
      // Извлекаем качество из URL если есть
      const quality = extractQuality(url);
      
      videos.set(url, {
        url: url,
        type: 'm3u8',
        quality: quality,
        timestamp: Date.now(),
        title: null
      });
      
      // Уведомляем content script
      browser.tabs.sendMessage(tabId, {
        action: 'videoDetected',
        url: url,
        quality: quality
      }).catch(() => {});
    }
  },
  { urls: ["<all_urls>"] },
  []
);

// Перехват заголовков для получения названия видео
browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (isHLSUrl(details.url)) {
      const contentType = details.responseHeaders.find(
        h => h.name.toLowerCase() === 'content-type'
      );
      
      if (contentType && contentType.value.includes('mpegurl')) {
        console.log('HLS stream confirmed:', details.url);
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// Очистка при закрытии вкладки
browser.tabs.onRemoved.addListener((tabId) => {
  detectedVideos.delete(tabId);
});

// Получение заголовка страницы
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.title && detectedVideos.has(tabId)) {
    const videos = detectedVideos.get(tabId);
    videos.forEach(video => {
      if (!video.title) {
        video.title = changeInfo.title;
      }
    });
  }
});

// Обработка сообщений
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch(request.action) {
    case 'getVideos':
      const tabId = request.tabId;
      const videos = detectedVideos.get(tabId) || new Map();
      sendResponse({ 
        videos: Array.from(videos.values()),
        count: videos.size
      });
      break;
      
    case 'openDownloader':
      openDownloaderPage(request.videoUrl, request.title);
      break;
      
    case 'downloadSegment':
      // Проксирование запросов для обхода CORS
      return downloadSegment(request.url);
  }
});

function isHLSUrl(url) {
  const patterns = [
    /\.m3u8/i,
    /\.m3u/i,
    /manifest.*\.json/i,
    /master.*\.m3u8/i,
    /index.*\.m3u8/i,
    /playlist.*\.m3u8/i,
    /hls/i,
    /dash/i
  ];
  
  return patterns.some(pattern => pattern.test(url));
}

function extractQuality(url) {
  const patterns = [
    /(\d{3,4})p/i,
    /(\d{3,4})x(\d{3,4})/,
    /_(\d{3,4})_/,
    /-(\d{3,4})-/,
    /\/(\d{3,4})\//,
    /high/i,
    /medium/i,
    /low/i,
    /hd/i,
    /sd/i
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1] ? match[1] + 'p' : match[0];
    }
  }
  
  return 'auto';
}

function openDownloaderPage(url, title) {
  const params = new URLSearchParams({
    url: url,
    title: title || 'video'
  });
  
  const downloaderUrl = browser.runtime.getURL('downloader/downloader.html') + 
                       '?' + params.toString();
  
  browser.tabs.create({ url: downloaderUrl });
}

async function downloadSegment(url) {
  try {
    const response = await fetch(url, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer'
    });
    
    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    
    return {
      success: true,
      data: Array.from(new Uint8Array(arrayBuffer)),
      size: arrayBuffer.byteLength
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}
