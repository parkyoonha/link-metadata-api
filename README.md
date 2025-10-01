# Link Metadata API

메모 앱을 위한 링크 메타데이터 추출 API

## 배포 방법 (Vercel)

### 1. Vercel 계정 만들기
- https://vercel.com 접속
- GitHub 계정으로 로그인

### 2. GitHub에 코드 업로드
```bash
cd /c/workspace/memo/link-metadata-api
git init
git add .
git commit -m "Initial commit"
git branch -M main
# GitHub에서 새 repository 만들고
git remote add origin https://github.com/your-username/link-metadata-api.git
git push -u origin main
```

### 3. Vercel에서 배포
1. Vercel 대시보드에서 "New Project" 클릭
2. GitHub repository 선택
3. "Deploy" 클릭
4. 배포 완료! URL 복사 (예: `https://link-metadata-api.vercel.app`)

### 4. Flutter 앱에서 사용
배포된 URL을 Flutter 앱의 `memo_provider.dart`에서 사용:
```dart
final apiUrl = 'https://your-api.vercel.app/api/metadata?url=$encodedUrl';
```

## API 사용법

**Endpoint:** `/api/metadata`

**Parameters:**
- `url` (required): 메타데이터를 가져올 URL

**Example:**
```
GET /api/metadata?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

**Response:**
```json
{
  "title": "Rick Astley - Never Gonna Give You Up",
  "description": "Official video description",
  "image": "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg"
}
```

## 로컬 테스트

Vercel CLI로 로컬에서 테스트:
```bash
npm install -g vercel
cd /c/workspace/memo/link-metadata-api
vercel dev
```

브라우저에서 테스트:
```
http://localhost:3000/api/metadata?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ
```
