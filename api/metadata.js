const https = require('https');
const http = require('http');
const zlib = require('zlib');

// JSON 가져오기 헬퍼 함수
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;

    protocol.get(url, (response) => {
      let data = '';
      response.on('data', (chunk) => data += chunk);
      response.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Invalid JSON response'));
        }
      });
      response.on('error', reject);
    }).on('error', reject);
  });
}

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
      errorMessage: error.message,
      title: null,
      description: null,
      image: null
    });
  }
};

function fetchMetadata(url, redirectCount = 0) {
  return new Promise(async (resolve, reject) => {
    // 무한 리다이렉트 방지 (최대 5번)
    if (redirectCount > 5) {
      return reject(new Error('Too many redirects'));
    }

    // YouTube 특수 처리 - oEmbed API 사용
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      try {
        const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
        const oembedData = await fetchJson(oembedUrl);

        const videoIdMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
        const videoId = videoIdMatch ? videoIdMatch[1] : null;

        return resolve({
          title: oembedData.title || null,
          description: oembedData.author_name ? `${oembedData.author_name}` : null,
          image: videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : (oembedData.thumbnail_url || null)
        });
      } catch (oembedError) {
        // oEmbed 실패 시 일반 로직으로 fallback
        console.log('YouTube oEmbed failed, falling back to regular fetch:', oembedError.message);
      }
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
      timeout: 12000
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

      // GZIP 압축 해제 처리
      let stream = response;
      const encoding = response.headers['content-encoding'];

      if (encoding === 'gzip') {
        stream = response.pipe(zlib.createGunzip());
      } else if (encoding === 'deflate') {
        stream = response.pipe(zlib.createInflate());
      } else if (encoding === 'br') {
        stream = response.pipe(zlib.createBrotliDecompress());
      }

      let data = '';

      stream.on('data', (chunk) => {
        data += chunk.toString('utf8');
        // 너무 큰 응답은 중단 (500KB까지)
        if (data.length > 500000) {
          stream.destroy();
          resolve(parseMetadata(data, url));
        }
      });

      stream.on('end', () => {
        resolve(parseMetadata(data, url));
      });

      stream.on('error', (error) => {
        reject(error);
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
    // 1. JSON-LD (Schema.org) 파싱 - 최우선
    const jsonLdMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    if (jsonLdMatches) {
      for (const match of jsonLdMatches) {
        try {
          const jsonContent = match.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '');
          const jsonData = JSON.parse(jsonContent);

          // @graph 배열 처리
          const items = jsonData['@graph'] ? jsonData['@graph'] : [jsonData];

          for (const item of items) {
            const type = item['@type'];
            if (!type) continue;

            // NewsArticle, Article, BlogPosting 등
            if (type.includes('Article') || type.includes('BlogPosting') || type.includes('NewsArticle')) {
              if (!metadata.title && item.headline) {
                metadata.title = decodeHtml(item.headline);
              }
              if (!metadata.description && item.description) {
                metadata.description = decodeHtml(item.description);
              }
              if (!metadata.image && item.image) {
                const img = Array.isArray(item.image) ? item.image[0] : item.image;
                metadata.image = typeof img === 'string' ? img : (img.url || img['@id']);
              }
            }

            // Product
            if (type.includes('Product')) {
              if (!metadata.title && item.name) {
                metadata.title = decodeHtml(item.name);
              }
              if (!metadata.description && item.description) {
                metadata.description = decodeHtml(item.description);
              }
              if (!metadata.image && item.image) {
                const img = Array.isArray(item.image) ? item.image[0] : item.image;
                metadata.image = typeof img === 'string' ? img : (img.url || img['@id']);
              }
            }

            // VideoObject
            if (type.includes('VideoObject')) {
              if (!metadata.title && item.name) {
                metadata.title = decodeHtml(item.name);
              }
              if (!metadata.description && item.description) {
                metadata.description = decodeHtml(item.description);
              }
              if (!metadata.image && item.thumbnailUrl) {
                const img = Array.isArray(item.thumbnailUrl) ? item.thumbnailUrl[0] : item.thumbnailUrl;
                metadata.image = typeof img === 'string' ? img : (img.url || img['@id']);
              }
            }
          }
        } catch (jsonError) {
          // JSON 파싱 실패는 무시하고 다음 시도
        }
      }
    }

    // 2. YouTube 특수 처리
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      const videoIdMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
      if (videoIdMatch && !metadata.image) {
        const videoId = videoIdMatch[1];
        metadata.image = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
      }
    }

    // 3. Open Graph 메타데이터 (속성 순서 무관하게 매칭, 따옴표 안의 모든 내용 포함)
    const ogImageMatch = html.match(/<meta\s+(?:[^>]*?\s+)?property=["']og:image["']\s+(?:[^>]*?\s+)?content="([^"]*)"/i)
                      || html.match(/<meta\s+(?:[^>]*?\s+)?property=["']og:image["']\s+(?:[^>]*?\s+)?content='([^']*)'/i)
                      || html.match(/<meta\s+(?:[^>]*?\s+)?content="([^"]*)"\s+(?:[^>]*?\s+)?property=["']og:image["']/i)
                      || html.match(/<meta\s+(?:[^>]*?\s+)?content='([^']*)'\s+(?:[^>]*?\s+)?property=["']og:image["']/i);
    if (ogImageMatch && !metadata.image) {
      metadata.image = ogImageMatch[1];
    }

    const ogTitleMatch = html.match(/<meta\s+(?:[^>]*?\s+)?property=["']og:title["']\s+(?:[^>]*?\s+)?content="([^"]*)"/i)
                      || html.match(/<meta\s+(?:[^>]*?\s+)?property=["']og:title["']\s+(?:[^>]*?\s+)?content='([^']*)'/i)
                      || html.match(/<meta\s+(?:[^>]*?\s+)?content="([^"]*)"\s+(?:[^>]*?\s+)?property=["']og:title["']/i)
                      || html.match(/<meta\s+(?:[^>]*?\s+)?content='([^']*)'\s+(?:[^>]*?\s+)?property=["']og:title["']/i);
    if (ogTitleMatch && !metadata.title) {
      metadata.title = decodeHtml(ogTitleMatch[1]);
    }

    const ogDescMatch = html.match(/<meta\s+(?:[^>]*?\s+)?property=["']og:description["']\s+(?:[^>]*?\s+)?content="([^"]*)"/i)
                     || html.match(/<meta\s+(?:[^>]*?\s+)?property=["']og:description["']\s+(?:[^>]*?\s+)?content='([^']*)'/i)
                     || html.match(/<meta\s+(?:[^>]*?\s+)?content="([^"]*)"\s+(?:[^>]*?\s+)?property=["']og:description["']/i)
                     || html.match(/<meta\s+(?:[^>]*?\s+)?content='([^']*)'\s+(?:[^>]*?\s+)?property=["']og:description["']/i);
    if (ogDescMatch && !metadata.description) {
      metadata.description = decodeHtml(ogDescMatch[1]);
    }

    // 4. Twitter Cards (속성 순서 무관하게 매칭, 따옴표 안의 모든 내용 포함)
    const twitterImageMatch = html.match(/<meta\s+(?:[^>]*?\s+)?name=["']twitter:image["']\s+(?:[^>]*?\s+)?content="([^"]*)"/i)
                            || html.match(/<meta\s+(?:[^>]*?\s+)?name=["']twitter:image["']\s+(?:[^>]*?\s+)?content='([^']*)'/i)
                            || html.match(/<meta\s+(?:[^>]*?\s+)?content="([^"]*)"\s+(?:[^>]*?\s+)?name=["']twitter:image["']/i)
                            || html.match(/<meta\s+(?:[^>]*?\s+)?content='([^']*)'\s+(?:[^>]*?\s+)?name=["']twitter:image["']/i);
    if (twitterImageMatch && !metadata.image) {
      metadata.image = twitterImageMatch[1];
    }

    const twitterTitleMatch = html.match(/<meta\s+(?:[^>]*?\s+)?name=["']twitter:title["']\s+(?:[^>]*?\s+)?content="([^"]*)"/i)
                           || html.match(/<meta\s+(?:[^>]*?\s+)?name=["']twitter:title["']\s+(?:[^>]*?\s+)?content='([^']*)'/i)
                           || html.match(/<meta\s+(?:[^>]*?\s+)?content="([^"]*)"\s+(?:[^>]*?\s+)?name=["']twitter:title["']/i)
                           || html.match(/<meta\s+(?:[^>]*?\s+)?content='([^']*)'\s+(?:[^>]*?\s+)?name=["']twitter:title["']/i);
    if (twitterTitleMatch && !metadata.title) {
      metadata.title = decodeHtml(twitterTitleMatch[1]);
    }

    const twitterDescMatch = html.match(/<meta\s+(?:[^>]*?\s+)?name=["']twitter:description["']\s+(?:[^>]*?\s+)?content="([^"]*)"/i)
                          || html.match(/<meta\s+(?:[^>]*?\s+)?name=["']twitter:description["']\s+(?:[^>]*?\s+)?content='([^']*)'/i)
                          || html.match(/<meta\s+(?:[^>]*?\s+)?content="([^"]*)"\s+(?:[^>]*?\s+)?name=["']twitter:description["']/i)
                          || html.match(/<meta\s+(?:[^>]*?\s+)?content='([^']*)'\s+(?:[^>]*?\s+)?name=["']twitter:description["']/i);
    if (twitterDescMatch && !metadata.description) {
      metadata.description = decodeHtml(twitterDescMatch[1]);
    }

    // 5. 일반 메타 태그
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch && !metadata.title) {
      let title = decodeHtml(titleMatch[1].trim());
      // YouTube의 경우 " - YouTube" 제거
      if ((url.includes('youtube.com') || url.includes('youtu.be')) && title.endsWith(' - YouTube')) {
        title = title.slice(0, -10).trim();
      }
      metadata.title = title;
    }

    const descMatch = html.match(/<meta\s+(?:[^>]*?\s+)?name=["']description["']\s+(?:[^>]*?\s+)?content="([^"]*)"/i)
                   || html.match(/<meta\s+(?:[^>]*?\s+)?name=["']description["']\s+(?:[^>]*?\s+)?content='([^']*)'/i)
                   || html.match(/<meta\s+(?:[^>]*?\s+)?content="([^"]*)"\s+(?:[^>]*?\s+)?name=["']description["']/i)
                   || html.match(/<meta\s+(?:[^>]*?\s+)?content='([^']*)'\s+(?:[^>]*?\s+)?name=["']description["']/i);
    if (descMatch && !metadata.description) {
      metadata.description = decodeHtml(descMatch[1]);
    }

  } catch (error) {
    console.error('Parse error:', error);
  }

  // 디버깅: 파싱 실패 시 HTML 일부 포함
  if (!metadata.title) {
    metadata.debug = {
      htmlLength: html.length,
      htmlPreview: html.substring(0, 1000),
      hasTitleTag: html.includes('<title'),
      hasOgTitle: html.includes('og:title'),
      hasJsonLd: html.includes('application/ld+json')
    };
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
