
import { Hono, Context } from 'hono'
import { logger } from 'hono/logger'
import { etag } from 'hono/etag'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { writeFile, readFile } from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import { v4 as uuid } from 'uuid'
import mime from 'mime'
import fetch, { Headers } from 'node-fetch'
import path from 'path'

// Bun/Node.js互換のグローバル宣言
declare global {
    var Bun: {
        env: Record<string, string | undefined>
    } | undefined
    var process: {
        env: Record<string, string | undefined>
    } | undefined
}

// 環境変数から設定を読み込み（Bun互換）
const getEnv = (key: string, defaultValue: string = ''): string => {
    return Bun?.env?.[key] ?? process?.env?.[key] ?? defaultValue
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



const app = new Hono()

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
        BindAddress: string
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
            'video/mp4',
            'video/webm',
            'video/mpeg',
            'video/ogg',
            'image/jpeg',
            'image/png',
            'image/webp'
        ])
    },
    AppServer: {
        Port: getEnvNumber('PORT', 30121),
        BindAddress: getEnv('BIND_ADDRESS', '0.0.0.0')
    }
}

// アップロードディレクトリの設定
const uploadPath = config.UploadPath
let baseUrl: string = getEnv('BASE_URL')

// アップロードディレクトリを作成
if (!existsSync(uploadPath)) {
    mkdirSync(uploadPath, { recursive: true })
}

// 日付フォルダを取得する関数
function getDateFolder(): string {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

// 日付フォルダのパスを作成し、存在しない場合は作成する関数
function ensureDateFolder(basePath: string, dateFolder: string): string {
    const fullPath = path.join(basePath, dateFolder)
    if (!existsSync(fullPath)) {
        mkdirSync(fullPath, { recursive: true })
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

app.post('/lb-upload/', async (c: Context) => {
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
        const mimetype = file.type
        const fileSize_bytes = file.size

        if (mimes && !mimes.includes(mimetype)) {
            return c.json({ error: 'Unallowed mime type' }, 415)
        }

        if (fileSize && fileSize_bytes > fileSize * MB) {
            return c.json({ error: 'File is too large' }, 413)
        }

        const extension = mime.getExtension(mimetype)

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
        const dateFolderPath = ensureDateFolder(uploadPath, dateFolder)
        
        const filename = `${uuid()}.${extension}`
        const relativePath = `${dateFolder}/${filename}`
        const url = `${baseUrl}/uploads/${relativePath}`

        // ファイルを保存（日付フォルダ内）
        await writeFile(path.join(dateFolderPath, filename), buffer)

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
                    value: mimetype,
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

            fetch(config.DiscordWebhook, {
                headers: new Headers({
                    'Content-Type': 'application/json'
                }),
                method: 'POST',
                body: JSON.stringify(embedWebhookPayload)
            }).catch((err: any) => console.error('Discord webhook failed:', err))
            fetch(config.DiscordWebhook, {
                headers: new Headers({
                    'Content-Type': 'application/json'
                }),
                method: 'POST',
                body: JSON.stringify(urlWebhookPayload)
            }).catch((err: any) => console.error('Discord webhook failed:', err))
        }

        return c.json({ 
            success: true,
            filename,
            link: url,
            dateFolder,
            relativePath,
            size: buffer.length,
            type: mimetype,
            playerMetadata: playerMetadata || undefined
        })

    } catch (error) {
        console.error('Upload error:', error)
        return c.json({ error: 'Internal server error' }, 500)
    }
})

// 静的ファイル配信（日付フォルダ対応）
app.get('/uploads/:dateFolder/:file', async (c: Context) => {
    const dateFolder = c.req.param('dateFolder')
    const filename = c.req.param('file')
    const filePath = path.join(uploadPath, dateFolder, filename)
    
    try {
        if (!existsSync(filePath)) {
            return c.json({ error: 'File not found' }, 404)
        }
        
        const fileBuffer = await readFile(filePath)
        const mimeType = mime.getType(filePath) || 'application/octet-stream'
        
        return new Response(new Uint8Array(fileBuffer), {
            status: 200,
            headers: {
                'Cache-Control': 'public, max-age=15724800, immutable',
                'Content-Type': mimeType,
            }
        })
    } catch (error) {
        console.error('File serve error:', error)
        return c.json({ error: 'Internal server error' }, 500)
    }
})

// メタデータファイル取得エンドポイント
app.get('/uploads/:dateFolder/:file/metadata', async (c: Context) => {
    const dateFolder = c.req.param('dateFolder')
    const filename = c.req.param('file')
    const metadataPath = path.join(uploadPath, dateFolder, `${filename}.meta.json`)
    
    try {
        if (!existsSync(metadataPath)) {
            return c.json({ error: 'Metadata not found' }, 404)
        }
        
        const metadataContent = await readFile(metadataPath, 'utf-8')
        const metadata = JSON.parse(metadataContent)
        
        return c.json(metadata)
    } catch (error) {
        console.error('Metadata read error:', error)
        return c.json({ error: 'Internal server error' }, 500)
    }
})

// 後方互換性のため、日付フォルダなしのパスも対応（既存ファイル用）
app.get('/uploads/:file', async (c: Context) => {
    const filename = c.req.param('file')
    const filePath = path.join(uploadPath, filename)
    
    try {
        if (!existsSync(filePath)) {
            return c.json({ error: 'File not found' }, 404)
        }
        
        const fileBuffer = await readFile(filePath)
        const mimeType = mime.getType(filePath) || 'application/octet-stream'
        
        return new Response(new Uint8Array(fileBuffer), {
            status: 200,
            headers: {
                'Cache-Control': 'public, max-age=15724800, immutable',
                'Content-Type': mimeType,
            }
        })
    } catch (error) {
        console.error('File serve error:', error)
        return c.json({ error: 'Internal server error' }, 500)
    }
})

// サーバー起動関数
async function startServer() {
    console.log(`Upload API Server starting on port ${config.AppServer.Port}`)
    console.log(`Upload directory: ${uploadPath}`)
    console.log(`Base URL: ${baseUrl}`)

    // スタンドアロンサーバーとして起動
    serve({
        fetch: app.fetch,
        port: config.AppServer.Port,
        hostname: config.AppServer.BindAddress,
    })

    console.log(`🚀 Server is running on http://${config.AppServer.BindAddress}:${config.AppServer.Port}`)
}

// サーバー起動
startServer().catch(console.error)
