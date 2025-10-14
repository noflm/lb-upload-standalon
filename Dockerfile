# Bunランタイムを使用
FROM oven/bun:canary-alpine

# 作業ディレクトリを設定
WORKDIR /app

# package.jsonとbun.lockbをコピー（依存関係のインストール用）
COPY package.json ./
COPY bun.lockb* ./

# 依存関係をインストール
RUN bun install --frozen-lockfile

# ソースコードをコピー
COPY . .

# アップロードディレクトリを作成
RUN mkdir -p uploads

# 環境変数のデフォルト値を設定
ENV PORT=30121
ENV BIND_ADDRESS=0.0.0.0
ENV UPLOAD_PATH=./uploads
ENV MAX_FILE_SIZE_MB=50

# ポートを公開
EXPOSE $PORT

# Bunでサーバーを実行
CMD ["bun", "run", "server.ts"]