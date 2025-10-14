# lb-upload-standalone

A standalone file upload server built with Hono that works both as a FiveM resource and as a Docker container with Bun runtime.

## Docker で実行

### 前提条件
- Docker と Docker Compose がインストールされていること

### クイックスタート

1. リポジトリをクローンまたはダウンロード
```bash
git clone <repository-url>
cd lb-upload-standalone
```

2. Docker Compose でサーバーを起動
```bash
docker-compose up -d
```

3. サーバーが起動していることを確認
```bash
curl http://localhost:30121/health
```

### 利用可能なエンドポイント

- `GET /health` - ヘルスチェック
- `POST /upload` - ファイルアップロード
- `GET /uploads/:filename` - アップロードしたファイルの取得

### ファイルアップロード例

```bash
curl -X POST \
  -F "file=@example.jpg" \
  http://localhost:30121/upload
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
docker-compose down
```

## FiveM環境での実行

FiveM環境では、従来通りリソースとして動作します。

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

ISC