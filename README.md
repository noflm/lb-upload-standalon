# lb-upload-standalone

A standalone file upload server built with Hono that works both as a FiveM resource and as a Docker container with Bun runtime.

## Docker で実行

### 前提条件
- Docker と Docker Compose がインストールされていること

### クイックスタート

#### 本番環境（GitHubビルド済みイメージ使用）

1. リポジトリをクローンまたはダウンロード
```bash
git clone https://github.com/noflm/lb-upload-standalon.git
cd lb-upload-standalon
```

2. Docker Compose でサーバーを起動（GitHubビルド済みイメージ）
```bash
docker-compose up -d
# または
npm run docker:prod
```

#### 開発環境（ローカルビルド）

```bash
# 開発用docker-composeを使用（ローカルビルド + デバッグモード）
docker-compose -f docker-compose.dev.yml up -d
# または
npm run docker:dev
```

3. サーバーが起動していることを確認
```bash
curl http://localhost:30121/health
```

### 利用可能なエンドポイント

- `GET /health` - ヘルスチェック
- `POST /upload` - ファイルアップロード
- `GET /uploads/:dateFolder/:filename` - アップロードしたファイルの取得（日付フォルダ対応）
- `GET /uploads/:filename` - 従来形式（後方互換性）

### ファイルアップロード例

```bash
curl -X POST \
  -F "file=@example.jpg" \
  http://localhost:30121/upload
```

### 日付フォルダ機能

アップロードされたファイルは自動的に日付フォルダに整理されます：

- **フォルダ形式**: `YYYY-MM-DD` (例: `2025-10-14`)
- **URL例**: `http://localhost:30121/uploads/2025-10-14/ab9c2b65-a053-412c-b1d1-b1c241c14591.webp`
- **自動作成**: 日付フォルダは必要に応じて自動生成されます

### アップロード成功時のレスポンス例

```json
{
  "success": true,
  "filename": "ab9c2b65-a053-412c-b1d1-b1c241c14591.webp",
  "url": "http://localhost:30121/uploads/2025-10-14/ab9c2b65-a053-412c-b1d1-b1c241c14591.webp",
  "dateFolder": "2025-10-14",
  "relativePath": "2025-10-14/ab9c2b65-a053-412c-b1d1-b1c241c14591.webp",
  "size": 12345,
  "type": "image/webp"
}
```

### 設定

すべての設定は環境変数で管理されます。`.env.example`を参考に設定してください：

```bash
# .envファイルを作成
cp .env.example .env
```

#### 主要な環境変数

| 変数名 | デフォルト値 | 説明 |
|--------|-------------|------|
| `PORT` | 30121 | サーバーポート |
| `BIND_ADDRESS` | 0.0.0.0 | バインドアドレス |
| `UPLOAD_PATH` | ./uploads | アップロードディレクトリ |
| `MAX_FILE_SIZE_MB` | 50 | 最大ファイルサイズ(MB) |
| `ALLOWED_MIMES` | audio/mpeg,video/mp4,image/jpeg... | 許可MIMEタイプ |
| `API_KEY` | なし | APIキー認証 |
| `DISCORD_WEBHOOK` | なし | Discord通知URL |
| `REQUIRE_ORIGIN` | なし | 許可オリジン |
| `CORS_ORIGIN` | なし | CORS許可オリジン |
| `CORS_MAX_AGE` | 86400 | CORSキャッシュ時間(秒) |
| `DEBUG` | false | デバッグモード |

### ミドルウェア機能

- **ログ出力**: すべてのリクエストが詳細にログ出力されます
- **ETAGサポート**: キャッシュ効率化のためのETagヘッダー自動生成
- **CORSサポート**: クロスオリジンリクエストの制御
- **エラーハンドリング**: 統一されたエラーレスポンス

### データの永続化

アップロードしたファイルは `./uploads` ディレクトリに保存され、Docker Compose設定により永続化されます。

### ログの確認

```bash
docker-compose logs -f lb-upload-server
```

### サーバーの停止

```bash
# 本番環境
docker-compose down

# 開発環境
docker-compose -f docker-compose.dev.yml down
```

### Dockerイメージについて

#### GitHubビルド済みイメージ（推奨）
- イメージ: `ghcr.io/noflm/lb-upload-standalon:latest`
- 自動ビルド: GitHub Actionsで自動的にビルド・公開
- 利点: ダウンロードが高速、一貫性のあるビルド環境

#### ローカルビルド
- 開発やカスタマイズが必要な場合に使用
- `docker-compose.dev.yml`でローカルビルドを実行

## 開発

### ローカル開発（Bun使用）

```bash
# 依存関係のインストール
bun install

# 開発サーバーの起動
bun run server.ts
```

### ビルド

```bash
# esbuildでバンドル
bun run build
```

## ライセンス

MIT License - 詳細は[LICENSE](LICENSE)ファイルを参照してください。