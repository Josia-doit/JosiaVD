const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

function findFFmpeg() {
    const paths = [
        path.join(__dirname, 'ffmpeg.exe'),
        path.join(__dirname, 'bin', 'ffmpeg.exe'),
        path.join(__dirname, 'ffmpeg', 'bin', 'ffmpeg.exe')
    ];
    for (const p of paths) if (fs.existsSync(p)) return p;
    return null;
}

const YTDLP_PATH = path.join(__dirname, 'yt-dlp.exe');
const FFMPEG_PATH = findFFmpeg();

if (!fs.existsSync(YTDLP_PATH)) {
    console.error('❌ 错误：未找到yt-dlp.exe');
    process.exit(1);
}

// 针对B站的专属修复：强制B站Referer + 专属UA
function getYT_DLP_Args(url, isDownload = false, format_id = null) {
    const isBilibili = url.includes('bilibili.com');
    
    // 基础参数
    const baseArgs = [
        '--js-runtimes', 'node',
        '--no-warnings',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
        '--referer', isBilibili ? 'https://www.bilibili.com/' : url,
        '--add-header', 'Origin: ' + (isBilibili ? 'https://www.bilibili.com' : new URL(url).origin)
    ];

    // 解析/下载分支
    if (isDownload) {
        return [
            ...baseArgs,
            '-f', format_id,
            '-o', path.join(DOWNLOAD_DIR, '%(title)s.%(ext)s'),
            '--newline',
            '--progress',
            ...(FFMPEG_PATH ? ['--ffmpeg-location', FFMPEG_PATH] : []),
            url
        ];
    } else {
        return [
            ...baseArgs,
            '-J',
            url
        ];
    }
}

app.post('/info', (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: '缺少URL参数' });

    const args = getYT_DLP_Args(url, false);
    const ytdlp = spawn(YTDLP_PATH, args);
    let output = '';
    let errorOutput = '';

    ytdlp.stdout.on('data', (data) => output += data.toString());
    ytdlp.stderr.on('data', (data) => errorOutput += data.toString());

    ytdlp.on('close', (code) => {
        if (code !== 0) {
            return res.status(500).json({
                error: '解析失败',
                details: errorOutput
            });
        }

        try {
            const info = JSON.parse(output);
            const formats = info.formats || [];
            const uniqueFormats = new Map();

            formats.forEach(f => {
                if (f.height && f.vcodec !== 'none' && f.ext) {
                    const key = `${f.height}p`;
                    if (!uniqueFormats.has(key) || (f.filesize || 0) > (uniqueFormats.get(key).filesize || 0)) {
                        uniqueFormats.set(key, {
                            height: f.height,
                            format_id: f.format_id,
                            ext: f.ext,
                            resolution: `${f.width}x${f.height}`,
                            fps: f.fps || 0
                        });
                    }
                }
            });

            const sortedFormats = Array.from(uniqueFormats.values()).sort((a, b) => b.height - a.height);

            res.json({
                title: info.title,
                duration: info.duration,
                formats: sortedFormats
            });
        } catch (e) {
            res.status(500).json({
                error: '解析失败',
                details: errorOutput || e.message
            });
        }
    });
});

app.post('/download', (req, res) => {
    const { url, format_id } = req.body;
    if (!url || !format_id) return res.status(400).json({ error: '缺少参数' });

    const args = getYT_DLP_Args(url, true, format_id);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    const ytdlp = spawn(YTDLP_PATH, args);

    ytdlp.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(l => l.trim());
        lines.forEach(line => {
            const progressMatch = line.match(/(\d+\.\d+)%/);
            if (progressMatch) {
                const progress = parseFloat(progressMatch[1]) / 100;
                res.write(JSON.stringify({
                    type: 'progress',
                    progress: progress,
                    status: line.trim()
                }) + '\n');
            }
        });
    });

    ytdlp.stderr.on('data', (data) => {
        res.write(JSON.stringify({
            type: 'error',
            message: data.toString().trim()
        }) + '\n');
    });

    ytdlp.on('close', (code) => {
        if (code === 0) {
            res.write(JSON.stringify({
                type: 'success',
                message: '下载完成'
            }) + '\n');
        } else {
            res.write(JSON.stringify({
                type: 'error',
                message: '下载失败'
            }) + '\n');
        }
        res.end();
    });
});

app.listen(PORT, () => {
    console.log(`🚀 服务启动：http://localhost:${PORT}`);
    console.log(`📂 下载目录：${DOWNLOAD_DIR}`);
});
