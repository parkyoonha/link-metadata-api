const https = require('https');
const http = require('http');

module.exports = async (req, res) => {
  // CORS 헤더 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  try {
    const metadata = await fetchMetadata(url);
    res.status(200).json(metadata);
  } catch (error) {
    console.error('Error fetching metadata:', error);
    res.status(500).json({
      error: 'Failed to fetch metadata',
      title: null,
      description: null,
      image: null
    });
  }
};

function fetchMetadata(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    // 무한 리다이렉트 방지 (최대 5번)
    if (redirectCount > 5) {
      return reject(new Error('Too many redirects'));
    }

    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
    const protocol = urlObj.protocol === 'https:' ? https : http;

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 8000
    };

    protocol.get(options, (response) => {
      // 리다이렉트 처리 (301, 302, 303, 307, 308)
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          // 상대 경로면 절대 경로로 변환
          const absoluteUrl = redirectUrl.startsWith('http')
            ? redirectUrl
            : `${urlObj.protocol}//${urlObj.hostname}${redirectUrl}`;

          response.destroy(); // 현재 연결 종료
          return fetchMetadata(absoluteUrl, redirectCount + 1)
            .then(resolve)
            .catch(reject);
        }
      }

      let data = '';

      response.on('data', (chunk) => {
        data += chunk;
        // 너무 큰 응답은 중단 (100KB까지만)
        if (data.length > 100000) {
          response.destroy();
          resolve(parseMetadata(data, url));
        }
      });

      response.on('end', () => {
        resolve(parseMetadata(data, url));
      });
    }).on('error', (error) => {
      reject(error);
    }).on('timeout', () => {
      reject(new Error('Request timeout'));
    });
  });
}

function parseMetadata(html, url) {
  const metadata = {
    title: null,
    description: null,
    image: null
  };

  try {
    // YouTube 특수 처리
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      const videoIdMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
      if (videoIdMatch) {
        const videoId = videoIdMatch[1];
        metadata.image = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
      }
    }

    // Open Graph 이미지
    const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
    if (ogImageMatch && !metadata.image) {
      metadata.image = ogImageMatch[1];
    }

    // Twitter 이미지
    const twitterImageMatch = html.match(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i);
    if (twitterImageMatch && !metadata.image) {
      metadata.image = twitterImageMatch[1];
    }

    // 메타데이터 이미지가 없으면 null 유지 (Flutter 앱에서 텍스트 썸네일 표시)

    // Open Graph 제목
    const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
    if (ogTitleMatch) {
      metadata.title = decodeHtml(ogTitleMatch[1]);
    }

    // Twitter 제목
    const twitterTitleMatch = html.match(/<meta\s+name=["']twitter:title["']\s+content=["']([^"']+)["']/i);
    if (twitterTitleMatch && !metadata.title) {
      metadata.title = decodeHtml(twitterTitleMatch[1]);
    }

    // 일반 title 태그
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch && !metadata.title) {
      metadata.title = decodeHtml(titleMatch[1]);
    }

    // Open Graph 설명
    const ogDescMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
    if (ogDescMatch) {
      metadata.description = decodeHtml(ogDescMatch[1]);
    }

    // Meta description
    const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
    if (descMatch && !metadata.description) {
      metadata.description = decodeHtml(descMatch[1]);
    }

  } catch (error) {
    console.error('Parse error:', error);
  }

  return metadata;
}

function decodeHtml(text) {
  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&#x27;': "'",
    '&apos;': "'"
  };

  return text.replace(/&[^;]+;/g, (match) => entities[match] || match);
}
