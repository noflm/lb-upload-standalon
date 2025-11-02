import { Hono, Context } from 'hono'
import { logger } from 'hono/logger'
import { etag } from 'hono/etag'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/bun'
import { appendTrailingSlash } from 'hono/trailing-slash'
import { v4 as uuid } from 'uuid'
import { fileTypeFromBuffer } from 'file-type'


const getEnv = (key: string, defaultValue: string = ''): string => {
    return Bun.env[key] ?? defaultValue
}

const getEnvBoolean = (key: string, defaultValue: boolean): boolean => {
    const value = getEnv(key)
    if (!value) return defaultValue
    return value.toLowerCase() === 'true'
}

const getEnvNumber = (key: string, defaultValue: number): number => {
    const value = getEnv(key)
    if (!value) return defaultValue
    const parsed = parseInt(value, 10)
    return isNaN(parsed) ? defaultValue : parsed
}

const getEnvArray = (key: string, defaultValue: string[]): string[] => {
    const value = getEnv(key)
    if (!value) return defaultValue
    return value.split(',').map((item: string) => item.trim()).filter((item: string) => item.length > 0)
}

// ファイル操作（最適化済み）
const bunFile = {
    write: async (filePath: string, data: Uint8Array): Promise<void> => {
        await Bun.write(filePath, data)
    },
    exists: async (filePath: string): Promise<boolean> => {
        return await Bun.file(filePath).exists()
    },
    mkdir: async (dirPath: string): Promise<void> => {
        await Bun.write(`${dirPath}/.bunkeep`, '')
        await Bun.file(`${dirPath}/.bunkeep`).exists() // ディレクトリ作成を確実にする
    }
}

// ファイル解析とMIME処理
interface FileAnalysisResult {
    mimeType: string
    extension: string
}

async function analyzeFileContent(buffer: Uint8Array): Promise<FileAnalysisResult | null> {
    try {
        const fileType = await fileTypeFromBuffer(buffer)
        if (fileType) {
            return {
                mimeType: fileType.mime,
                extension: fileType.ext
            }
        }
    } catch (error) {
        console.error('File type detection failed:', error)
    }
    
    return null
}



// 従来のMIME処理（フォールバック用）
function getFileExtensionFromMime(mimeType: string): string | null {
    // コーデック情報を含むMIMEタイプを正規化
    const normalizedMimeType = mimeType.split(';')[0].trim()
    
    const mimeMap: Record<string, string> = {
        'audio/mpeg': 'mp3',
        'audio/ogg': 'ogg',
        'audio/opus': 'opus',
        'audio/webm': 'weba',
        'audio/wav': 'wav',
        'video/mp4': 'mp4',
        'video/webm': 'webm',
        'video/mpeg': 'mpeg',
        'video/ogg': 'ogv',
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif'
    }
    
    return mimeMap[normalizedMimeType] || null
}


const app = new Hono({ strict: true })

app.use(appendTrailingSlash())

// ミドルウェアの設定
// カスタムログフォーマット
app.use('*', logger((message: string, ...rest: any[]) => {
    const timestamp = new Date().toISOString()
    console.log(`[${timestamp}] ${message}`, ...rest)
}))

// ETagミドルウェア（キャッシュ効率化）
app.use('*', etag())

// CORSミドルウェア（環境変数で設定可能）
const corsOrigins = getEnv('CORS_ORIGIN')
app.use('*', cors({
    origin: corsOrigins ? getEnvArray('CORS_ORIGIN', []) : '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    maxAge: getEnvNumber('CORS_MAX_AGE', 86400) // 24時間
}))

// エラーハンドリングミドルウェア
app.onError((err: Error, c: Context) => {
    console.error(`[ERROR] ${err.message}`, err.stack)
    return c.json({ 
        error: 'Internal Server Error',
        message: getEnvBoolean('DEBUG', false) ? err.message : 'An error occurred'
    }, 500)
})

const MB = 1024 * 1024

type Config = {
    UploadPath: string
    DiscordWebhook: string | false
    Security: {
        ApiKey: string | false
        RequireOrigin: string[] | false
    }
    Limits: {
        FileSize: number | false
        Mimes: string[] | false
    },
    AppServer: {
        Port: number
    }
}

// 環境変数から設定を読み込み
const config: Config = {
    UploadPath: getEnv('UPLOAD_PATH', './uploads'),
    DiscordWebhook: getEnv('DISCORD_WEBHOOK') || false,
    Security: {
        ApiKey: getEnv('API_KEY') || false,
        RequireOrigin: getEnv('REQUIRE_ORIGIN') ? getEnvArray('REQUIRE_ORIGIN', []) : false
    },
    Limits: {
        FileSize: getEnvNumber('MAX_FILE_SIZE_MB', 50),
        Mimes: getEnvArray('ALLOWED_MIMES', [
            'audio/mpeg',
            'audio/ogg',
            'audio/opus',
            'audio/webm',
            'audio/wav',
            'video/mp4',
            'video/webm',
            'video/mpeg',
            'video/ogg',
            // VP9コーデック対応
            'video/webm; codecs="vp9"',
            'video/mp4; codecs="vp09"',
            'video/mp4; codecs="vp9"',
            'image/jpeg',
            'image/png',
            'image/webp',
            'image/gif'
        ])
    },
    AppServer: {
        Port: getEnvNumber('PORT', 30121),
    }
}

// アップロードディレクトリの設定
const uploadPath = config.UploadPath
let baseUrl: string = getEnv('BASE_URL')

// Bunネイティブの初期化処理
async function initializeApp() {
    // アップロードディレクトリを作成（Bunネイティブ）
    if (!(await bunFile.exists(uploadPath))) {
        await bunFile.mkdir(uploadPath)
    }
}

// トップレベルでの初期化
await initializeApp()

// 日付フォルダを取得する関数
function getDateFolder(): string {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

// 日付フォルダのパスを作成し、存在しない場合は作成する関数（Bunネイティブ）
async function ensureDateFolder(basePath: string, dateFolder: string): Promise<string> {
    const fullPath = `${basePath}/${dateFolder}`
    if (!(await bunFile.exists(fullPath))) {
        await bunFile.mkdir(fullPath)
    }
    return fullPath
}

// プレイヤーメタデータを取得する関数
function getPlayerMetadata(c: Context): { identifier: string, name: string } | null {
    const playerMetadata = c.req.header('player-metadata')
    if (!playerMetadata) return null
    
    try {
        const parsed = JSON.parse(playerMetadata)
        if (parsed.identifier && parsed.name) {
            return {
                identifier: parsed.identifier,
                name: parsed.name
            }
        }
    } catch (error) {
        console.error('Failed to parse player metadata:', error)
    }
    
    return null
}

// ヘルスチェックエンドポイント
app.get('/health', (c: Context) => {
    return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.post('/upload/', async (c: Context) => {
    try {
        const body = await c.req.parseBody()
        const file = body['file'] as File

        if (!file) {
            return c.json({ error: 'No file uploaded' }, 400)
        }

        const { Security, Limits } = config
        const { ApiKey: apiKey, RequireOrigin: requireOrigin } = Security
        const { Mimes: mimes, FileSize: fileSize } = Limits

        // ファイルの内容とメタデータを取得
        const buffer = new Uint8Array(await file.arrayBuffer())
        const clientMimeType = file.type
        const fileSize_bytes = file.size
        const contentType = c.req.header('content-type')

        if (fileSize && fileSize_bytes > fileSize * MB) {
            return c.json({ error: 'File is too large' }, 413)
        }

        let actualMimeType: string
        let extension: string
        
        // audio/oggの場合はバイパスしてそのまま使用
        if (clientMimeType === 'audio/ogg') {
            actualMimeType = 'audio/ogg'
            extension = 'opus'
            console.log(`Bypassing file analysis for audio/ogg - keeping original type`)
        } else {
            // ファイル内容を解析して正確なMIMEタイプと拡張子を判定
            const analysisResult = await analyzeFileContent(buffer)
            
            if (analysisResult) {
                // ファイル解析結果を使用
                actualMimeType = analysisResult.mimeType
                extension = analysisResult.extension
                console.log(`File analysis result - Detected: ${actualMimeType} (.${extension})`)
            } else {
                // フォールバック: クライアント提供のMIMEタイプを使用
                actualMimeType = clientMimeType
                const fallbackExtension = getFileExtensionFromMime(clientMimeType)
                
                if (!fallbackExtension) {
                    return c.json({ error: 'Unsupported file type' }, 400)
                }
                
                extension = fallbackExtension
                console.log(`Using fallback - Client MIME: ${actualMimeType} (.${extension})`)
            }
        }

        // MIMEタイプの検証（解析結果またはクライアント提供の値で検証）
        if (mimes && mimes.length > 0) {
            const isAllowed = mimes.some(allowedMime => {
                // 完全一致をチェック
                if (allowedMime === actualMimeType) return true
                
                // ベースMIMEタイプが一致するかチェック（コーデック情報を除く）
                const baseMimeType = actualMimeType.split(';')[0].trim()
                const allowedBaseMimeType = allowedMime.split(';')[0].trim()
                
                return baseMimeType === allowedBaseMimeType
            })
            
            if (!isAllowed) {
                return c.json({ 
                    error: 'Unallowed file type',
                    detectedType: actualMimeType,
                    clientType: clientMimeType
                }, 415)
            }
        }

        if (!extension || !buffer) {
            return c.json({ error: 'Invalid file type' }, 400)
        }

        if (apiKey && apiKey !== c.req.header('authorization')) {
            return c.json({ error: 'Invalid API key' }, 401)
        }

        if (requireOrigin) {
            const origin = c.req.header('origin')
            if (!origin || !requireOrigin.includes(origin)) {
                return c.json({ error: 'Invalid origin' }, 403)
            }
        }

        // ベースURLを動的に設定
        if (!baseUrl) {
            const host = c.req.header('host') || `localhost:${config.AppServer.Port}`
            const protocol = c.req.header('x-forwarded-proto') || 'http'
            baseUrl = `${protocol}://${host}`
        }

        // プレイヤーメタデータを取得
        const playerMetadata = getPlayerMetadata(c)
        
        // 日付フォルダを取得・作成
        const dateFolder = getDateFolder()
        const dateFolderPath = await ensureDateFolder(uploadPath, dateFolder)
        
        const filename = `${uuid()}.${extension}`
        const relativePath = `${dateFolder}/${filename}`
        const url = `${baseUrl}/uploads/${relativePath}`

        // ファイルを保存（日付フォルダ内）- Bunネイティブ最適化
        await bunFile.write(`${dateFolderPath}/${filename}`, buffer)

        // Discord webhookを送信（バックグラウンドで実行）
        if (config.DiscordWebhook) {
            let embedFields = [
                {
                    name: "File Name",
                    value: filename,
                    inline: false,
                },
                {
                    name: "Date Folder",
                    value: dateFolder,
                    inline: false,
                },
                {
                    name: "File Size",
                    value: `${(buffer.length / (1024 * 1024)).toFixed(2)} MB`,
                    inline: false,
                },
                {
                    name: "MIME Type",
                    value: actualMimeType,
                    inline: false,
                },
            ]

            // プレイヤーメタデータがある場合は追加
            if (playerMetadata) {
                embedFields.push(
                    {
                        name: "Player(ID)",
                        value: `${playerMetadata.name} (${playerMetadata.identifier})`,
                        inline: false,
                    }
                )
            }

            const embedWebhookPayload = {
                username: 'LB Phone - Upload',
                avatar_url: 'https://github.com/lbphone.png',
                embeds: [{
                    title: "📁 File Upload",
                    fields: embedFields,
                    url: url,
                    color: playerMetadata ? 0x00ff00 : 0x0099ff, // 緑（プレイヤー情報あり）または青
                    timestamp: new Date().toISOString(),
                }]
            }
            const urlWebhookPayload = {
                username: 'LB Phone - Upload',
                avatar_url: 'https://github.com/lbphone.png',
                content: `${url}`
            }

            // webhookを順次送信
            try {
                await fetch(config.DiscordWebhook, {
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    method: 'POST',
                    body: JSON.stringify(embedWebhookPayload)
                })
                
                await fetch(config.DiscordWebhook, {
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    method: 'POST',
                    body: JSON.stringify(urlWebhookPayload)
                })
            } catch (err: any) {
                console.error('Discord webhook failed:', err)
            }
        }

        return c.json({ 
            success: true,
            filename,
            link: url,
            dateFolder,
            relativePath,
            size: buffer.length,
            type: actualMimeType,
            clientType: clientMimeType,
            mimeTypeChanged: clientMimeType !== actualMimeType,
            playerMetadata: playerMetadata || undefined
        })

    } catch (error) {
        console.error('Upload error:', error)
        return c.json({ error: 'Internal server error' }, 500)
    }
})

// UUIDファイル名からフルパスへのリダイレクト処理
app.get('/uploads/:filename', async (c: Context) => {
    const filename = c.req.param('filename')
    
    // ファイル名のパターンをチェック（UUID形式）
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.\w+$/i
    if (!uuidPattern.test(filename)) {
        // UUID形式でない場合は次のハンドラーへ
        return c.notFound()
    }
    
    // uploadsディレクトリ内の日付フォルダを走査
    try {
        const uploadsDir = uploadPath
        const entries = await Array.fromAsync(new Bun.Glob('*').scan({ cwd: uploadsDir, onlyFiles: false }))
        
        for (const entry of entries) {
            // 日付フォルダのパターンをチェック（YYYY-MM-DD形式）
            const dateFolderPattern = /^\d{4}-\d{2}-\d{2}$/
            if (!dateFolderPattern.test(entry)) continue
            
            // ファイルが存在するかチェック
            const filePath = `${uploadsDir}/${entry}/${filename}`
            if (await bunFile.exists(filePath)) {
                // リダイレクト先のURIを構築
                const redirectUri = `/uploads/${entry}/${filename}`
                return c.redirect(redirectUri, 301) // 永続的リダイレクト
            }
        }
        
        // ファイルが見つからない場合
        return c.json({ error: 'File not found' }, 404)
    } catch (error) {
        console.error('Error searching for file:', error)
        return c.json({ error: 'Internal server error' }, 500)
    }
})

// 静的ファイル配信
app.get('/uploads/*', serveStatic({ 
    root: uploadPath,
    rewriteRequestPath: (path: string) => {
        // /uploads/path を適切なパスに変換
        return path.replace(/^\/uploads\//, '')
    }
}))

// 静的ファイル用のHTTPヘッダー
app.use('/uploads/*', async (c: Context, next) => {
    await next()
    // レスポンスヘッダーを最適化
    c.res.headers.set('Cache-Control', 'public, max-age=15724800, immutable') // 6ヶ月キャッシュ
    c.res.headers.set('X-Content-Type-Options', 'nosniff')
    c.res.headers.set('Accept-Ranges', 'bytes')
})

// Bunサーバーの最適化設定
export default {
    fetch: app.fetch,
    port: config.AppServer.Port,
    development: getEnvBoolean('DEBUG', false),
    lowMemoryMode: false,
}

    
