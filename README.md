# lb-upload-standalone

Bunランタイム上で動作するHonoベースの高性能ファイルアップロードサーバー。FiveMリソースおよびDockerコンテナとして利用可能で、日付ベースの自動フォルダ整理機能を搭載。

## 機能概要

- ⚡ **高速**: Bunランタイムによる高速実行
- 📁 **自動整理**: 日付フォルダによるファイル自動分類
- 🔍 **MIME解析**: file-typeライブラリによる正確なファイル種別判定
- 🔒 **セキュリティ**: API認証・オリジン制限・ファイル種別制限
- 🐳 **Docker対応**: 本番環境・開発環境両対応
- 📊 **Discord連携**: Webhookによるアップロード通知
- 🎮 **FiveM対応**: プレイヤーメタデータ処理機能

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

2. Docker Compose でサーバーを起動
```bash
docker-compose up -d
# または
bun run docker:prod
```

#### 開発環境（ローカルビルド）

```bash
# 開発用docker-composeを使用（ローカルビルド）
docker-compose -f docker-compose.dev.yml up -d
# または
bun run docker:dev
```

3. サーバーが起動していることを確認
```bash
curl http://localhost:30121/health
```

### 利用可能なエンドポイント

- `GET /health` - ヘルスチェック
- `POST /upload/` - ファイルアップロード
- `GET /uploads/:dateFolder/:filename` - 日付フォルダ内のファイル取得
- `GET /uploads/:filename` - 直接ファイル取得（後方互換性）

### ファイルアップロード例

```bash
# 基本的なアップロード
curl -X POST \
  -F "file=@example.jpg" \
  http://localhost:30121/upload/

# API認証付きアップロード
curl -X POST \
  -H "Authorization: your_api_key" \
  -F "file=@example.jpg" \
  http://localhost:30121/upload/

# FiveMプレイヤーメタデータ付きアップロード
curl -X POST \
  -H "player-metadata: {\"identifier\":\"license:abc123\",\"name\":\"Player1\"}" \
  -F "file=@example.jpg" \
  http://localhost:30121/upload/
```

### 日付フォルダ機能

アップロードされたファイルは自動的に日付フォルダに整理されます：

- **フォルダ形式**: `YYYY-MM-DD` (例: `2025-10-16`)
- **URL例**: `http://localhost:30121/uploads/2025-10-16/ab9c2b65-a053-412c-b1d1-b1c241c14591.webp`
- **自動作成**: 日付フォルダは必要に応じて自動生成されます

### アップロード成功時のレスポンス例

```json
{
  "success": true,
  "filename": "ab9c2b65-a053-412c-b1d1-b1c241c14591.webp",
  "link": "http://localhost:30121/uploads/2025-10-16/ab9c2b65-a053-412c-b1d1-b1c241c14591.webp",
  "dateFolder": "2025-10-16",
  "relativePath": "2025-10-16/ab9c2b65-a053-412c-b1d1-b1c241c14591.webp",
  "size": 12345,
  "type": "image/webp",
  "clientType": "image/webp",
  "mimeTypeChanged": false,
  "playerMetadata": {
    "identifier": "license:abc123",
    "name": "Player1"
  }
}
```

## 設定

すべての設定は環境変数で管理されます。`.env.example`を参考に設定してください：

```bash
# .envファイルを作成
cp .env.example .env
```

### 主要な環境変数

| 変数名 | デフォルト値 | 説明 |
|--------|-------------|------|
| `PORT` | 30121 | サーバーポート |
| `BASE_URL` | 自動設定 | ベースURL（アップロード後のURLに使用） |
| `UPLOAD_PATH` | ./uploads | アップロードディレクトリ |
| `MAX_FILE_SIZE_MB` | 50 | 最大ファイルサイズ(MB) |
| `ALLOWED_MIMES` | audio/mpeg,video/mp4,image/jpeg... | 許可MIMEタイプ（カンマ区切り） |
| `API_KEY` | なし | APIキー認証（設定時は Authorization ヘッダーが必要） |
| `DISCORD_WEBHOOK` | なし | Discord Webhook URL |
| `REQUIRE_ORIGIN` | なし | 許可オリジン（カンマ区切り） |
| `CORS_ORIGIN` | なし | CORS許可オリジン（カンマ区切り） |
| `CORS_MAX_AGE` | 86400 | CORSキャッシュ時間(秒) |
| `DEBUG` | false | デバッグモード |

### 対応ファイル形式

デフォルトで以下のファイル形式に対応：

#### 音声
- MP3 (`audio/mpeg`)
- OGG (`audio/ogg`)
- Opus (`audio/opus`)
- WebM Audio (`audio/webm`)
- WAV (`audio/wav`)

#### 動画
- MP4 (`video/mp4`)
- WebM (`video/webm`)
- MPEG (`video/mpeg`)
- OGV (`video/ogg`)
- VP9コーデック対応

#### 画像
- JPEG (`image/jpeg`)
- PNG (`image/png`)
- WebP (`image/webp`)
- GIF (`image/gif`)

## ミドルウェア機能

- **タイムスタンプ付きログ**: すべてのリクエストが詳細にログ出力
- **ETAGサポート**: キャッシュ効率化のためのETagヘッダー自動生成
- **CORSサポート**: 柔軟なクロスオリジンリクエスト制御
- **エラーハンドリング**: 統一されたエラーレスポンス形式
- **ファイル内容解析**: クライアント提供MIMEタイプの検証と修正

## Discord連携

DISCORD_WEBHOOK環境変数を設定することで、ファイルアップロード時にDiscordに通知を送信できます：

- **通知内容**: ファイル名、日付フォルダ、ファイルサイズ、MIMEタイプ
- **プレイヤー情報**: FiveMプレイヤーメタデータが含まれる場合は追加表示
- **直接リンク**: アップロードしたファイルへの直接リンクも送信

## データの永続化

アップロードしたファイルは設定されたディレクトリに保存され、Docker Compose設定により永続化されます。日付フォルダ構造により整理されるため、長期運用でも管理しやすくなっています。

## Docker管理コマンド

### ログの確認
```bash
docker-compose logs -f lb-upload-server
```

### サーバーの停止
```bash
# 本番環境
docker-compose down
# または
bun run docker:prod-down

# 開発環境
docker-compose -f docker-compose.dev.yml down
# または
bun run docker:dev-down
```

### Dockerイメージについて

#### GitHubビルド済みイメージ（推奨）
- イメージ: `ghcr.io/noflm/lb-upload-standalon:main`
- 自動ビルド: GitHub Actionsで自動的にビルド・公開
- 利点: ダウンロードが高速、一貫性のあるビルド環境

#### ローカルビルド
- 開発やカスタマイズが必要な場合に使用
- `docker-compose.dev.yml`でローカルビルドを実行

## スタンドアローンバイナリ実行

### Linux用バイナリファイルのダウンロード

GitHubリリースページから、お使いの環境に合わせたバイナリファイルをダウンロードできます：

- **x64 (標準)**: `lb-upload-standalone-linux` - 最新のx64プロセッサ向け
- **x64 (ベースライン)**: `lb-upload-standalone-linux-baseline` - 古いx64プロセッサ向け
- **ARM64**: `lb-upload-standalone-linux-arm64` - ARM64プロセッサ向け

### 使用方法

```bash
# リリースページからバイナリをダウンロード
wget https://github.com/noflm/lb-upload-standalon/releases/latest/download/lb-upload-standalone-linux

# 実行権限を付与
chmod +x lb-upload-standalone-linux

# 環境変数を設定（.envファイルまたは直接指定）
export PORT=30121
export UPLOAD_PATH=./uploads
export MAX_FILE_SIZE_MB=50

# サーバーを起動
./lb-upload-standalone-linux
```

### systemdサービスとして実行

```bash
# サービスファイルを作成
sudo nano /etc/systemd/system/lb-upload.service
```

```ini
[Unit]
Description=LB Upload Server
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/your/directory
ExecStart=/path/to/lb-upload-standalone-linux
Environment=PORT=30121
Environment=UPLOAD_PATH=./uploads
Environment=MAX_FILE_SIZE_MB=50
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
# サービスを有効化・開始
sudo systemctl enable lb-upload.service
sudo systemctl start lb-upload.service

# ステータス確認
sudo systemctl status lb-upload.service
```

## 開発

### ローカル開発（Bun使用）

```bash
# 依存関係のインストール
bun install

# 開発サーバーの起動（ホットリロード付き）
bun run dev

# 本番サーバーの起動
bun run start
```

### ビルド

```bash
# JavaScriptバンドルの生成
bun run build

# プラットフォーム別実行可能ファイルの生成
bun run build:linux-x64          # 標準x64バイナリ
bun run build:linux-x64-baseline # ベースラインx64バイナリ
bun run build:linux-arm64        # ARM64バイナリ
```

### 型チェック

```bash
# TypeScript型チェック
bun run check
```

## FiveM統合

このサーバーはFiveMリソースとしても利用可能です。プレイヤーメタデータを `player-metadata` ヘッダーに含めることで、アップロード履歴にプレイヤー情報を記録できます。

## ライセンス

MIT License - 詳細は[LICENSE](LICENSE)ファイルを参照してください。