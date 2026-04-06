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

const YTDLP = path.join(__dirname, 'yt-dlp.exe');
const FFMPEG = findFFmpeg();

function findFFmpeg() {
    const paths = [
        path.join(__dirname, 'ffmpeg.exe'),
        path.join(__dirname, 'bin', 'ffmpeg.exe'),
        path.join(__dirname, 'ffmpeg', 'bin', 'ffmpeg.exe')
    ];
    for (const p of paths) if (fs.existsSync(p)) return p;
    return null;
}

if (!fs.existsSync(YTDLP)) {
    console.error('❌ yt-dlp.exe does not exist');
    process.exit(1);
}
if (!FFMPEG) {
    console.error('❌ ffmpeg.exe does not exist');
    process.exit(1);
}

function getSafeName(name) {
    return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function getUniquePath(today, height, title, ext = 'mp4') {
    let counter = 0;
    let finalPath = path.join(DOWNLOAD_DIR, `${today}_${height}P_${title}.${ext}`);
    while (fs.existsSync(finalPath)) {
        counter++;
        finalPath = path.join(DOWNLOAD_DIR, `${today}_${height}P_${title} (${counter}).${ext}`);
    }
    return finalPath;
}

let currentDownloadProc = null;
let currentOutputPath = null;

// ====================== /check-exist ======================
app.post('/check-exist', (req, res) => {
    const { url, height } = req.body;
    if (!url || !height) return res.json({ exists: false });
    const { execSync } = require('child_process');
    let videoInfo = null;
    try {
        const output = execSync(`"${YTDLP}" -J --no-warnings "${url}"`, { stdio: ['ignore', 'pipe', 'ignore'] });
        videoInfo = JSON.parse(output.toString());
    } catch (e) {
        return res.json({ exists: false });
    }
    try {
        const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const title = getSafeName(videoInfo.title);
        const basePath = path.join(DOWNLOAD_DIR, `${today}_${height}P_${title}.mp4`);
        res.json({ exists: fs.existsSync(basePath) });
    } catch (e) {
        res.json({ exists: false });
    }
});

function formatBytes(bytes) {
    if (bytes === 0 || !bytes) return '0 MB';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function parseProgressLine(line) {
    const regex = /\[download\]\s*(\d+\.?\d*)%\s*of\s*([\d.]+)([KMG]i?B)\s*at\s*([\d.]+)([KMG]i?B\/s)\s*ETA\s*(\d+:\d+)/;
    const match = line.match(regex);
    if (!match) return null;

    const percent = parseFloat(match[1]);
    const totalSizeNum = parseFloat(match[2]);
    const totalUnit = match[3].replace(/iB/g, 'B');
    const speedNum = parseFloat(match[4]);
    const speedUnit = match[5].replace(/iB/g, 'B');
    const eta = match[6];

    const currentSizeNum = totalSizeNum * (percent / 100);
    const currentSize = `${currentSizeNum.toFixed(2)} ${totalUnit}`;
    const totalSize = `${totalSizeNum.toFixed(2)} ${totalUnit}`;
    const speed = `${speedNum.toFixed(2)} ${speedUnit}`;

    return { percent, currentSize, totalSize, speed, eta };
}

// ====================== /info ======================
app.post('/info', (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: '缺少URL' });
    
    const args = [
        '--no-warnings',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
        '--referer', 'https://www.bilibili.com/',
        '-J',
        url
    ];
    
    const proc = spawn(YTDLP, args);
    let out = '', err = '';
    
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    
    proc.on('close', (code) => {
        if (code !== 0) {
            return res.status(500).json({ error: '解析失败', details: err });
        }
        try {
            const info = JSON.parse(out);
            const formats = info.formats || [];

            const videoMap = new Map();
            formats.forEach(f => {
                if (f.height && f.vcodec !== 'none' && (f.ext === 'mp4' || f.ext === 'm4s')) {
                    const key = `${f.height}p`;
                    const size = f.filesize || f.filesize_approx || 0;
                    if (!videoMap.has(key) || (size > (videoMap.get(key).filesize || 0))) {
                        videoMap.set(key, { ...f });
                    }
                }
            });

            const audioFormats = formats.filter(f => f.acodec !== 'none' && f.ext === 'm4a');
            let bestAudioSize = 0;
            if (audioFormats.length > 0) {
                bestAudioSize = audioFormats.reduce((a, b) => (a.size || 0) > (b.size || 0) ? a : b).size || 0;
            }

            const resultFormats = [];
            videoMap.forEach(v => {
                const totalSize = (v.filesize || v.filesize_approx || 0) + bestAudioSize;
                resultFormats.push({
                    ...v,
                    totalSize: totalSize,
                    totalSizeText: formatBytes(totalSize)
                });
            });

            res.json({
                title: info.title,
                duration: info.duration,
                formats: resultFormats.sort((a, b) => b.height - a.height)
            });
        } catch (e) {
            res.status(500).json({ error: '解析失败', details: e.message });
        }
    });
});

// ====================== /download ======================
app.post('/download', (req, res) => {
    const { url, format_id, height } = req.body;
    if (!url || !format_id || !height) return res.status(400).json({ error: '缺少参数' });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    const argsInfo = [
        '--no-warnings',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
        '--referer', 'https://www.bilibili.com/',
        '-J', url
    ];
    const infoProc = spawn(YTDLP, argsInfo);
    let infoOut = '';
    
    const startTime = new Date();
    const startStr = `[${startTime.getHours().toString().padStart(2, '0')}:${startTime.getMinutes().toString().padStart(2, '0')}:${startTime.getSeconds().toString().padStart(2, '0')}]`;
    res.write(JSON.stringify({
        type: "progress",
        progress: 0,
        stage: "📊 正在分析视频文件",
        speed: "---",
        size: "0 MB / 0 MB",
        eta: "---",
        log: `${startStr} 📊 正在分析视频文件`,
        isLive: false
    }) + '\n');

    infoProc.stdout.on('data', d => infoOut += d.toString());
    infoProc.on('close', code => {
        if (code !== 0) return res.write(JSON.stringify({ type: 'error', message: '❌ 获取视频信息失败' }) + '\n'), res.end();
        try {
            const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
            const videoInfo = JSON.parse(infoOut);
            const title = getSafeName(videoInfo.title);
            const outputPath = getUniquePath(today, height, title, 'mp4');
            currentOutputPath = outputPath;

            const dlArgs = [
                '--no-warnings',
                '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
                '--referer', 'https://www.bilibili.com/',
                '--ffmpeg-location', FFMPEG,
                '-f', `${format_id}+bestaudio[ext=m4a]/best`,
                '--merge-output-format', 'mp4',
                '-o', outputPath,
                '--newline',
                '--progress',
                url
            ];

            const proc = spawn(YTDLP, dlArgs);
            currentDownloadProc = proc;

            const PHASE = { ANALYSIS: 0, VIDEO: 1, AUDIO: 2, MERGE: 3, DONE: 4 };
            let currentPhase = PHASE.ANALYSIS;
            let videoDone = false;
            let audioDone = false;

            setTimeout(() => {
                if (currentPhase === PHASE.ANALYSIS) {
                    currentPhase = PHASE.VIDEO;
                    const now = new Date();
                    const timeStr = `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}]`;
                    res.write(JSON.stringify({
                        type: "progress",
                        progress: 0,
                        stage: "📥 开始下载视频文件",
                        speed: "---",
                        size: "---",
                        eta: "---",
                        log: `${timeStr} 📥 开始下载视频文件`,
                        isLive: false
                    }) + '\n');
                }
            }, 800);

            proc.stdout.on('data', (data) => {
                const lines = data.toString().split('\n').filter(l => l.trim());
                lines.forEach(line => {
                    const now = new Date();
                    const timeStr = `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}]`;
                    
                    if (line.includes('[download]')) {
                        const progress = parseProgressLine(line);
                        if (!progress) return;

                        if (currentPhase === PHASE.ANALYSIS) {
                            currentPhase = PHASE.VIDEO;
                            res.write(JSON.stringify({
                                type: "progress",
                                progress: 0,
                                stage: "✅ 文件分析完成",
                                speed: "---",
                                size: "---",
                                eta: "---",
                                log: `${timeStr} ✅ 文件分析完成`,
                                isLive: false
                            }) + '\n');
                        }

                        if (currentPhase === PHASE.VIDEO) {
                            if (progress.percent >= 100 && !videoDone) {
                                videoDone = true;
                                res.write(JSON.stringify({
                                    type: "progress",
                                    progress: 100,
                                    stage: "✅ 视频文件下载完成",
                                    speed: "---",
                                    size: "---",
                                    eta: "---",
                                    log: `${timeStr} ✅ 视频文件下载完成`,
                                    isLive: false
                                }) + '\n');
                                currentPhase = PHASE.AUDIO;
                                res.write(JSON.stringify({
                                    type: "progress",
                                    progress: 0,
                                    stage: "🎵 准备下载音频...",
                                    speed: "---",
                                    size: "---",
                                    eta: "---",
                                    log: `${timeStr} 🎵 准备下载音频...`,
                                    isLive: true
                                }) + '\n');
                            } else {
                                res.write(JSON.stringify({
                                    type: "progress",
                                    progress: progress.percent,
                                    stage: "📥 下载视频文件中",
                                    speed: progress.speed,
                                    size: `${progress.currentSize}/${progress.totalSize}`,
                                    eta: progress.eta,
                                    log: `${timeStr} 📥 下载视频文件中 | ${progress.percent.toFixed(1)}% | 速度: ${progress.speed} | 大小: ${progress.currentSize}/${progress.totalSize} | 剩余: ${progress.eta}`,
                                    isLive: true
                                }) + '\n');
                            }
                        }

                        if (currentPhase === PHASE.AUDIO) {
                            if (progress.percent >= 100 && !audioDone) {
                                audioDone = true;
                                res.write(JSON.stringify({
                                    type: "progress",
                                    progress: 100,
                                    stage: "✅ 音频文件下载完成",
                                    speed: "---",
                                    size: "---",
                                    eta: "---",
                                    log: `${timeStr} ✅ 音频文件下载完成`,
                                    isLive: false
                                }) + '\n');
                                currentPhase = PHASE.MERGE;
                                res.write(JSON.stringify({
                                    type: "progress",
                                    progress: 0,
                                    stage: "⚙️ 准备合并音频及视频文件",
                                    speed: "---",
                                    size: "---",
                                    eta: "---",
                                    log: `${timeStr} ⚙️ 准备合并音频及视频文件`,
                                    isLive: false
                                }) + '\n');
                                res.write(JSON.stringify({
                                    type: "progress",
                                    progress: 99,
                                    stage: "⚙️ 合并音频及视频文件中",
                                    speed: "---",
                                    size: "---",
                                    eta: "---",
                                    log: `${timeStr} ⚙️ 合并音频及视频文件中`,
                                    isLive: true
                                }) + '\n');
                            } else {
                                res.write(JSON.stringify({
                                    type: "progress",
                                    progress: progress.percent,
                                    stage: "🎵 下载音频文件中",
                                    speed: progress.speed,
                                    size: `${progress.currentSize}/${progress.totalSize}`,
                                    eta: progress.eta,
                                    log: `${timeStr} 🎵 下载音频文件中 | ${progress.percent.toFixed(1)}% | 速度: ${progress.speed} | 大小: ${progress.currentSize}/${progress.totalSize} | 剩余: ${progress.eta}`,
                                    isLive: true
                                }) + '\n');
                            }
                        }
                    }

                    if ((line.includes('Merger') || line.includes('ffmpeg') || line.includes('Merging')) && currentPhase === PHASE.MERGE) {
                        res.write(JSON.stringify({
                            type: "progress",
                            progress: 99,
                            stage: "⚙️ 合并音频及视频文件中",
                            speed: "---",
                            size: "---",
                            eta: "---",
                            log: `${timeStr} ⚙️ 合并音频及视频文件中`,
                            isLive: true
                        }) + '\n');
                    }
                });
            });

            proc.stderr.on('data', () => {});

            proc.on('close', (code) => {
                currentDownloadProc = null;
                currentOutputPath = null;

                const now = new Date();
                const timeStr = `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}]`;

                res.write(JSON.stringify({
                    type: "progress",
                    progress: 100,
                    stage: "✅ 已完成下载",
                    speed: "---",
                    size: "---",
                    eta: "---",
                    log: `${timeStr} ✅ 已完成下载`,
                    isLive: false
                }) + '\n');

                res.end();
            });
        } catch (e) {
            res.write(JSON.stringify({ type: "error", log: "[ERROR] 生成文件名失败" }) + '\n');
            res.end();
        }
    });
});

// ====================== 启动服务（无任何提示） ======================
const server = app.listen(PORT, () => {
    // 所有提示信息已移至 start.bat，这里不再输出任何内容
});

server.on('error', (err) => {
    console.error('Server startup failed:', err);
});
