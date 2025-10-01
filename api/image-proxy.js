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
    const imageBuffer = await fetchImage(url);

    // 이미지 타입 감지
    let contentType = 'image/jpeg';
    if (url.includes('.png')) contentType = 'image/png';
    else if (url.includes('.gif')) contentType = 'image/gif';
    else if (url.includes('.webp')) contentType = 'image/webp';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // 1일 캐시
    res.status(200).send(imageBuffer);
  } catch (error) {
    console.error('Error fetching image:', error);
    res.status(500).json({
      error: 'Failed to fetch image',
      errorMessage: error.message
    });
  }
};

function fetchImage(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
    const protocol = urlObj.protocol === 'https:' ? https : http;

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Referer': urlObj.origin,
        'Accept-Encoding': 'identity'
      },
      timeout: 10000
    };

    protocol.get(options, (response) => {
      // 리다이렉트 처리
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          const absoluteUrl = redirectUrl.startsWith('http')
            ? redirectUrl
            : `${urlObj.protocol}//${urlObj.hostname}${redirectUrl}`;

          response.destroy();
          return fetchImage(absoluteUrl).then(resolve).catch(reject);
        }
      }

      const chunks = [];

      response.on('data', (chunk) => {
        chunks.push(chunk);
      });

      response.on('end', () => {
        resolve(Buffer.concat(chunks));
      });

      response.on('error', (error) => {
        reject(error);
      });
    }).on('error', (error) => {
      reject(error);
    }).on('timeout', () => {
      reject(new Error('Request timeout'));
    });
  });
}
