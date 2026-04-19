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

// ====================== 工具函数：从URL提取域名作为Referer ======================
function getReferer(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.origin;
    } catch (e) {
        return 'https://www.google.com';
    }
}

// ====================== 工具函数：检查浏览器是否存在 ======================
function checkBrowserExists(browser) {
    const paths = {
        edge: [
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
        ],
        chrome: [
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        ]
    };
    
    if (!paths[browser]) return false;
    return paths[browser].some(p => fs.existsSync(p));
}

// ====================== 工具函数：构建yt-dlp通用参数（安全模式） ======================
function buildYtDlpArgs(url, useCookies = true) {
    const referer = getReferer(url);
    const args = [
        '--no-warnings',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
        '--referer', referer,
        '--retries', '3',
        '--no-check-certificate',
        '--ignore-errors'
    ];
    
    if (useCookies) {
        const browsers = [];
        if (checkBrowserExists('edge')) browsers.push('edge:all');
        if (checkBrowserExists('chrome')) browsers.push('chrome:all');
        
        if (browsers.length > 0) {
            args.push('--cookies-from-browser', browsers.join(','));
        }
    }
    
    return args;
}

// ====================== 工具函数：检查是否是cookies相关错误 ======================
function isCookiesError(err) {
    return err.includes('DPAPI') || 
           err.includes('Failed to decrypt') || 
           err.includes('could not find') ||
           err.includes('cookies database') ||
           err.includes('Cookie');
}

// ====================== 新增接口：打开下载目录（修复路径和窗口置顶问题） ======================
app.post('/open-dir', (req, res) => {
    try {
        // 修复1：使用正确的命令格式打开下载目录
        // explorer.exe /select,"文件路径" 会打开文件夹并定位到指定路径（优先置顶）
        // 先确保路径转义正确
        const escapedDir = DOWNLOAD_DIR.replace(/\\/g, '\\\\');
        // 执行打开目录命令
        const proc = spawn('explorer.exe', [DOWNLOAD_DIR], {
            detached: true,
            stdio: 'ignore',
            windowsHide: false, // 确保窗口不隐藏
            shell: true // 使用系统shell执行，保证命令正确解析
        });
        // 确保进程独立运行，不阻塞Node服务
        proc.unref();
        res.json({ success: true, path: DOWNLOAD_DIR });
    } catch (e) {
        console.error('打开下载目录失败:', e);
        res.json({ success: false, error: e.message });
    }
});

// ====================== /check-exist ======================
app.post('/check-exist', (req, res) => {
    const { url, height } = req.body;
    if (!url || !height) return res.json({ exists: false });
    const { execSync } = require('child_process');
    let videoInfo = null;
    try {
        // 先尝试带cookies
        const args = buildYtDlpArgs(url, true);
        args.push('-J', url);
        const output = execSync(`"${YTDLP}" ${args.map(a => `"${a}"`).join(' ')}`, { stdio: ['ignore', 'pipe', 'ignore'] });
        videoInfo = JSON.parse(output.toString());
    } catch (e) {
        // cookies错误，尝试不带cookies
        try {
            const args = buildYtDlpArgs(url, false);
            args.push('-J', url);
            const output = execSync(`"${YTDLP}" ${args.map(a => `"${a}"`).join(' ')}`, { stdio: ['ignore', 'pipe', 'ignore'] });
            videoInfo = JSON.parse(output.toString());
        } catch (e2) {
            return res.json({ exists: false });
        }
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
    if (bytes === 0 || !bytes || bytes < 0) return 'Unknown size';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}
function parseProgressLine(line) {
    const regex = /\[download\]\s*(\d+\.?\d*)%\s*of\s*([\d.]+)([KMG]i?B)\s*(?:at\s*([\d.]+)([KMG]i?B\/s)\s*)?ETA\s*(\d+:\d+)/;
    const match = line.match(regex);
    if (!match) return null;
    const percent = parseFloat(match[1]);
    const totalSizeNum = parseFloat(match[2]);
    const totalUnit = match[3].replace(/iB/g, 'B');
    const speedNum = match[4] ? parseFloat(match[4]) : 0;
    const speedUnit = match[5] ? match[5].replace(/iB/g, 'B') : 'B/s';
    const eta = match[6];
    const currentSizeNum = totalSizeNum * (percent / 100);
    const currentSize = `${currentSizeNum.toFixed(2)} ${totalUnit}`;
    const totalSize = `${totalSizeNum.toFixed(2)} ${totalUnit}`;
    const speed = speedNum > 0 ? `${speedNum.toFixed(2)} ${speedUnit}` : '---';
    return { percent, currentSize, totalSize, speed, eta };
}
// ====================== /info ======================
app.post('/info', (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'Missing URL' });
    
    // 先尝试带cookies
    const args = buildYtDlpArgs(url, true);
    args.push('-J', url);
    
    const proc = spawn(YTDLP, args);
    let out = '', err = '';
    
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    
    proc.on('close', (code) => {
        if (code !== 0) {
            // 检测到cookies错误，自动重试不带cookies
            if (isCookiesError(err)) {
                console.log('[!] Cookies error detected, retrying without cookies...');
                const argsNoCookies = buildYtDlpArgs(url, false);
                argsNoCookies.push('-J', url);
                
                const proc2 = spawn(YTDLP, argsNoCookies);
                let out2 = '', err2 = '';
                
                proc2.stdout.on('data', (d) => { out2 += d.toString(); });
                proc2.stderr.on('data', (d) => { err2 += d.toString(); });
                
                proc2.on('close', (code2) => {
                    if (code2 !== 0) {
                        let errorMsg = 'Parsing failed';
                        if (err2.includes('Unsupported URL')) {
                            errorMsg = 'This URL is not supported';
                        } else if (err2.includes('Sign in') || err2.includes('login')) {
                            errorMsg = 'This video requires login';
                        } else if (err2.includes('age')) {
                            errorMsg = 'This video has age restrictions';
                        }
                        return res.status(500).json({ error: errorMsg, details: err2 });
                    }
                    
                    try {
                        const info = JSON.parse(out2);
                        const formats = info.formats || [];
                        const videoMap = new Map();
                        formats.forEach(f => {
                            if (f.height && f.vcodec !== 'none' && (f.ext === 'mp4' || f.ext === 'm4s' || f.ext === 'webm')) {
                                const key = `${f.height}p`;
                                const size = f.filesize || f.filesize_approx || 0;
                                if (!videoMap.has(key) || (size > (videoMap.get(key).filesize || 0))) {
                                    videoMap.set(key, { ...f });
                                }
                            }
                        });
                        const audioFormats = formats.filter(f => f.acodec !== 'none' && (f.ext === 'm4a' || f.ext === 'webm' || f.ext === 'mp3'));
                        let bestAudioSize = 0;
                        if (audioFormats.length > 0) {
                            bestAudioSize = audioFormats.reduce((a, b) => (a.size || 0) > (b.size || 0) ? a : b).size || 0;
                        }
                        const resultFormats = [];
                        videoMap.forEach(v => {
                            const videoSize = v.filesize || v.filesize_approx || 0;
                            const totalSize = videoSize + bestAudioSize;
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
                        res.status(500).json({ error: 'Parsing failed', details: e.message });
                    }
                });
                return;
            }
            
            let errorMsg = 'Parsing failed';
            if (err.includes('Unsupported URL')) {
                errorMsg = 'This URL is not supported';
            } else if (err.includes('Sign in') || err.includes('login')) {
                errorMsg = 'This video requires login';
            } else if (err.includes('age')) {
                errorMsg = 'This video has age restrictions';
            }
            return res.status(500).json({ error: errorMsg, details: err });
        }
        
        try {
            const info = JSON.parse(out);
            const formats = info.formats || [];
            const videoMap = new Map();
            formats.forEach(f => {
                if (f.height && f.vcodec !== 'none' && (f.ext === 'mp4' || f.ext === 'm4s' || f.ext === 'webm')) {
                    const key = `${f.height}p`;
                    const size = f.filesize || f.filesize_approx || 0;
                    if (!videoMap.has(key) || (size > (videoMap.get(key).filesize || 0))) {
                        videoMap.set(key, { ...f });
                    }
                }
            });
            const audioFormats = formats.filter(f => f.acodec !== 'none' && (f.ext === 'm4a' || f.ext === 'webm' || f.ext === 'mp3'));
            let bestAudioSize = 0;
            if (audioFormats.length > 0) {
                bestAudioSize = audioFormats.reduce((a, b) => (a.size || 0) > (b.size || 0) ? a : b).size || 0;
            }
            const resultFormats = [];
            videoMap.forEach(v => {
                const videoSize = v.filesize || v.filesize_approx || 0;
                const totalSize = videoSize + bestAudioSize;
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
            res.status(500).json({ error: 'Parsing failed', details: e.message });
        }
    });
});
// ====================== /download ======================
app.post('/download', (req, res) => {
    const { url, format_id, height } = req.body;
    if (!url || !format_id || !height) return res.status(400).json({ error: 'Missing parameters' });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    
    // 先尝试带cookies
    const argsInfo = buildYtDlpArgs(url, true);
    argsInfo.push('-J', url);
    const infoProc = spawn(YTDLP, argsInfo);
    let infoOut = '';
    let infoErr = '';
    
    const startTime = new Date();
    const startStr = `[${startTime.getHours().toString().padStart(2, '0')}:${startTime.getMinutes().toString().padStart(2, '0')}:${startTime.getSeconds().toString().padStart(2, '0')}]`;
    res.write(JSON.stringify({
        type: "progress",
        progress: 0,
        stage: "📊 Analyzing video file",
        speed: "---",
        size: "0 MB / 0 MB",
        eta: "---",
        log: `${startStr} 📊 Analyzing video file`,
        isLive: false
    }) + '\n');
    infoProc.stdout.on('data', d => infoOut += d.toString());
    infoProc.stderr.on('data', d => infoErr += d.toString());
    infoProc.on('close', code => {
        let useCookies = true;
        
        if (code !== 0) {
            // 检测到cookies错误，自动重试不带cookies
            if (isCookiesError(infoErr)) {
                console.log('[!] Cookies error detected, retrying without cookies...');
                useCookies = false;
                const argsInfoNoCookies = buildYtDlpArgs(url, false);
                argsInfoNoCookies.push('-J', url);
                
                const infoProc2 = spawn(YTDLP, argsInfoNoCookies);
                infoOut = '';
                infoErr = '';
                
                infoProc2.stdout.on('data', d => infoOut += d.toString());
                infoProc2.stderr.on('data', d => infoErr += d.toString());
                
                infoProc2.on('close', code2 => {
                    if (code2 !== 0) {
                        const now = new Date();
                        const timeStr = `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}]`;
                        let errorMsg = 'Failed to get video info';
                        res.write(JSON.stringify({ 
                            type: 'error', 
                            message: errorMsg,
                            log: `${timeStr} ❌ ${errorMsg}`
                        }) + '\n');
                        return res.end();
                    }
                    
                    proceedWithDownload(infoOut, useCookies);
                });
                return;
            }
            
            const now = new Date();
            const timeStr = `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}]`;
            let errorMsg = 'Failed to get video info';
            res.write(JSON.stringify({ 
                type: 'error', 
                message: errorMsg,
                log: `${timeStr} ❌ ${errorMsg}`
            }) + '\n');
            return res.end();
        }
        
        proceedWithDownload(infoOut, useCookies);
        
        function proceedWithDownload(videoInfoJson, useCookies) {
            try {
                const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
                const videoInfo = JSON.parse(videoInfoJson);
                const title = getSafeName(videoInfo.title);
                const outputPath = getUniquePath(today, height, title, 'mp4');
                currentOutputPath = outputPath;
                const dlArgs = buildYtDlpArgs(url, useCookies);
                dlArgs.push(
                    '--ffmpeg-location', FFMPEG,
                    '-f', `${format_id}+bestaudio/best`,
                    '--merge-output-format', 'mp4',
                    '-o', outputPath,
                    '--newline',
                    '--progress',
                    url
                );
                const proc = spawn(YTDLP, dlArgs);
                currentDownloadProc = proc;
                const PHASE = { ANALYSIS: 0, VIDEO: 1, AUDIO: 2, MERGE: 3, DONE: 4 };
                let currentPhase = PHASE.ANALYSIS;
                let videoDone = false;
                let audioDone = false;
                let downloadError = '';
                setTimeout(() => {
                    if (currentPhase === PHASE.ANALYSIS) {
                        currentPhase = PHASE.VIDEO;
                        const now = new Date();
                        const timeStr = `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}]`;
                        res.write(JSON.stringify({
                            type: "progress",
                            progress: 0,
                            stage: "📥 Starting video download",
                            speed: "---",
                            size: "---",
                            eta: "---",
                            log: `${timeStr} 📥 Starting video download`,
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
                                    stage: "✅ File analysis complete",
                                    speed: "---",
                                    size: "---",
                                    eta: "---",
                                    log: `${timeStr} ✅ File analysis complete`,
                                    isLive: false
                                }) + '\n');
                            }
                            if (currentPhase === PHASE.VIDEO) {
                                if (progress.percent >= 100 && !videoDone) {
                                    videoDone = true;
                                    res.write(JSON.stringify({
                                        type: "progress",
                                        progress: 100,
                                        stage: "✅ Video download complete",
                                        speed: "---",
                                        size: "---",
                                        eta: "---",
                                        log: `${timeStr} ✅ Video download complete`,
                                        isLive: false
                                    }) + '\n');
                                    currentPhase = PHASE.AUDIO;
                                    res.write(JSON.stringify({
                                        type: "progress",
                                        progress: 0,
                                        stage: "🎵 Preparing audio download...",
                                        speed: "---",
                                        size: "---",
                                        eta: "---",
                                        log: `${timeStr} 🎵 Preparing audio download...`,
                                        isLive: true
                                    }) + '\n');
                                } else {
                                    res.write(JSON.stringify({
                                        type: "progress",
                                        progress: progress.percent,
                                        stage: "📥 Downloading video",
                                        speed: progress.speed,
                                        size: `${progress.currentSize}/${progress.totalSize}`,
                                        eta: progress.eta,
                                        log: `${timeStr} 📥 Downloading video | ${progress.percent.toFixed(1)}% | Speed: ${progress.speed} | Size: ${progress.currentSize}/${progress.totalSize} | ETA: ${progress.eta}`,
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
                                        stage: "✅ Audio download complete",
                                        speed: "---",
                                        size: "---",
                                        eta: "---",
                                        log: `${timeStr} ✅ Audio download complete`,
                                        isLive: false
                                    }) + '\n');
                                    currentPhase = PHASE.MERGE;
                                    res.write(JSON.stringify({
                                        type: "progress",
                                        progress: 0,
                                        stage: "⚙️ Preparing to merge audio and video",
                                        speed: "---",
                                        size: "---",
                                        eta: "---",
                                        log: `${timeStr} ⚙️ Preparing to merge audio and video`,
                                        isLive: false
                                    }) + '\n');
                                    res.write(JSON.stringify({
                                        type: "progress",
                                        progress: 99,
                                        stage: "⚙️ Merging audio and video",
                                        speed: "---",
                                        size: "---",
                                        eta: "---",
                                        log: `${timeStr} ⚙️ Merging audio and video`,
                                        isLive: true
                                    }) + '\n');
                                } else {
                                    res.write(JSON.stringify({
                                        type: "progress",
                                        progress: progress.percent,
                                        stage: "🎵 Downloading audio",
                                        speed: progress.speed,
                                        size: `${progress.currentSize}/${progress.totalSize}`,
                                        eta: progress.eta,
                                        log: `${timeStr} 🎵 Downloading audio | ${progress.percent.toFixed(1)}% | Speed: ${progress.speed} | Size: ${progress.currentSize}/${progress.totalSize} | ETA: ${progress.eta}`,
                                        isLive: true
                                    }) + '\n');
                                }
                            }
                        }
                        if ((line.includes('Merger') || line.includes('ffmpeg') || line.includes('Merging')) && currentPhase === PHASE.MERGE) {
                            res.write(JSON.stringify({
                                type: "progress",
                                progress: 99,
                                stage: "⚙️ Merging audio and video",
                                speed: "---",
                                size: "---",
                                eta: "---",
                                log: `${timeStr} ⚙️ Merging audio and video`,
                                isLive: true
                            }) + '\n');
                        }
                    });
                });
                proc.stderr.on('data', (d) => {
                    downloadError += d.toString();
                });
                proc.on('close', (code) => {
                    currentDownloadProc = null;
                    currentOutputPath = null;
                    const now = new Date();
                    const timeStr = `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}]`;
                    
                    if (code !== 0) {
                        let errorMsg = 'Download failed';
                        res.write(JSON.stringify({ 
                            type: 'error', 
                            message: errorMsg,
                            log: `${timeStr} ❌ ${errorMsg}`
                        }) + '\n');
                        return res.end();
                    }
                    
                    res.write(JSON.stringify({
                        type: "progress",
                        progress: 100,
                        stage: "✅ Download complete",
                        speed: "---",
                        size: "---",
                        eta: "---",
                        log: `${timeStr} ✅ Download complete`,
                        isLive: false
                    }) + '\n');
                    res.end();
                });
            } catch (e) {
                res.write(JSON.stringify({ type: "error", log: `[ERROR] Failed to generate filename: ${e.message}` }) + '\n');
                res.end();
            }
        }
    });
});

// ====================== 启动服务（无任何输出） ======================
const server = app.listen(PORT, () => {
    // 完全移除服务启动时的控制台输出，不再显示端口和下载目录提示
});
server.on('error', (err) => {
    console.error('Server startup failed:', err);
});
