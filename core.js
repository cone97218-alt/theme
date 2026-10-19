// 独立自包含的核心下载、URL 提取与替换逻辑

const EXT_REGEX = /\.(png|jpe?g|webp|gif|bmp|jfif)(?:\?.*)?$/i;
const CSS_URL_REGEX = /url\(\s*(['"]?)(https?:\/\/[^'"\)\s]+)\1\s*\)/gi;

/**
 * 健壮获取请求头（包含 CSRF Token 与认证），适应 SillyTavern 全版本与扩展环境
 */
export async function getSafeHeaders(options = {}) {
    let headers = {};

    // 1. 尝试从 SillyTavern 全局上下文获取
    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
        try {
            const ctx = SillyTavern.getContext();
            if (typeof ctx?.getRequestHeaders === 'function') {
                headers = ctx.getRequestHeaders(options) || {};
            }
        } catch (e) {}
    }

    // 2. 尝试从 /script.js 导入
    if (!headers['X-CSRF-Token'] && !headers['x-csrf-token']) {
        try {
            const mod = await import('/script.js');
            if (typeof mod?.getRequestHeaders === 'function') {
                headers = mod.getRequestHeaders(options) || {};
            }
        } catch (e) {}
    }

    // 3. 兜底尝试请求 /csrf-token
    if (!headers['X-CSRF-Token'] && !headers['x-csrf-token']) {
        try {
            const res = await fetch('/csrf-token');
            if (res.ok) {
                const data = await res.json();
                if (data.token) {
                    headers['X-CSRF-Token'] = data.token;
                }
            }
        } catch (e) {}
    }

    // 补齐 Content-Type
    if (!options.omitContentType && !headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
    }

    return headers;
}

function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}

function detectFormat(url, contentType) {
    const cleanUrl = url.split('?')[0].split('#')[0];
    const match = cleanUrl.match(EXT_REGEX);
    if (match && match[1]) {
        let ext = match[1].toLowerCase();
        if (ext === 'jpeg') ext = 'jpg';
        return ext;
    }
    if (contentType) {
        if (contentType.includes('png')) return 'png';
        if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
        if (contentType.includes('webp')) return 'webp';
        if (contentType.includes('gif')) return 'gif';
        if (contentType.includes('bmp')) return 'bmp';
    }
    return 'png';
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export function extractImageUrls(cssText) {
    if (!cssText || typeof cssText !== 'string') return [];
    const urls = new Set();
    let match;
    const regex = new RegExp(CSS_URL_REGEX.source, 'gi');
    while ((match = regex.exec(cssText)) !== null) {
        const rawUrl = match[2];
        const lower = rawUrl.toLowerCase();
        // 排除字体文件与 css 样式引用
        if (lower.includes('.woff') || lower.includes('.ttf') || lower.includes('.otf') || lower.includes('result.css')) {
            continue;
        }
        urls.add(rawUrl);
    }
    return [...urls];
}

export async function checkFileExists(localPath) {
    try {
        const res = await fetch(localPath, { method: 'HEAD' });
        return res.ok;
    } catch {
        return false;
    }
}

export async function downloadAndSaveImage(remoteUrl, logger = console.log) {
    try {
        const urlObj = new URL(remoteUrl);
        const rawName = urlObj.pathname.split('/').pop() || 'image';
        const rawBase = rawName.split('.')[0] || 'img';
        const hash = simpleHash(remoteUrl);

        const safeBase = rawBase.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '_').slice(0, 30);
        let format = detectFormat(remoteUrl, null);
        let filename = `${safeBase}_${hash}.${format}`;
        const localTargetPath = `/user/images/themes/${filename}`;

        const alreadyExists = await checkFileExists(localTargetPath);
        if (alreadyExists) {
            logger(`[已跳过] 本地已存在该图片: ${filename}`, 'info');
            return localTargetPath;
        }

        let buffer = null;
        let contentType = null;

        // 策略 1：前端直接抓取（对允许 CORS 的图床直接完成，速度最快）
        try {
            const res = await fetch(remoteUrl);
            if (res.ok) {
                buffer = await res.arrayBuffer();
                contentType = res.headers.get('content-type');
            }
        } catch (corsErr) {
            // 前端 CORS 限制导致 Failed to fetch，进入后续策略
        }

        // 策略 2：通过酒馆同源代理 /api/search/visit 抓取（绕过浏览器 CORS 跨域拦截）
        if (!buffer || buffer.byteLength === 0) {
            try {
                const headers = await getSafeHeaders();
                const proxyRes = await fetch('/api/search/visit', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({
                        url: remoteUrl,
                        html: false,
                    }),
                });
                if (proxyRes.ok) {
                    buffer = await proxyRes.arrayBuffer();
                    contentType = proxyRes.headers.get('content-type');
                }
            } catch (proxyErr) {
                // 代理请求失败
            }
        }

        const headers = await getSafeHeaders();

        // 如果已获取到图片二进制数据，则上传保存到 /user/images/themes/
        if (buffer && buffer.byteLength > 0) {
            if (contentType) {
                format = detectFormat(remoteUrl, contentType);
                filename = `${safeBase}_${hash}.${format}`;
            }
            const base64Data = arrayBufferToBase64(buffer);

            const uploadRes = await fetch('/api/images/upload', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    image: base64Data,
                    format: format,
                    filename: filename,
                    ch_name: 'themes',
                }),
            });

            if (!uploadRes.ok) {
                const errText = await uploadRes.text();
                throw new Error(`上传本地失败: ${errText}`);
            }

            const data = await uploadRes.json();
            let finalPath = data.path;
            if (finalPath.startsWith('public/')) {
                finalPath = '/' + finalPath.slice('public/'.length);
            } else if (!finalPath.startsWith('/')) {
                finalPath = '/' + finalPath;
            }

            logger(`[成功转存] ${filename}`, 'success');
            return finalPath;
        }

        // 策略 3：由酒馆后端 /api/images/upload 服务端直接依据 url 下载并落盘
        const directUploadRes = await fetch('/api/images/upload', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                url: remoteUrl,
                format: format,
                filename: filename,
                ch_name: 'themes',
            }),
        });

        if (directUploadRes.ok) {
            const data = await directUploadRes.json();
            let finalPath = data.path;
            if (finalPath.startsWith('public/')) {
                finalPath = '/' + finalPath.slice('public/'.length);
            } else if (!finalPath.startsWith('/')) {
                finalPath = '/' + finalPath;
            }
            logger(`[成功转存] ${filename}`, 'success');
            return finalPath;
        }

        throw new Error('下载失败: 目标图床未配置 CORS 且代理通道未返回数据');
    } catch (err) {
        logger(`[下载失败] ${remoteUrl} (${err.message})`, 'error');
        throw err;
    }
}

export function replaceThemeUrls(themeObj, urlMap) {
    if (!themeObj || !themeObj.custom_css) return themeObj;

    let updatedCss = themeObj.custom_css;
    for (const [remoteUrl, localPath] of urlMap.entries()) {
        updatedCss = updatedCss.split(remoteUrl).join(localPath);
    }

    return {
        ...themeObj,
        custom_css: updatedCss,
    };
}

export async function saveThemeToServer(themeObj) {
    if (!themeObj || !themeObj.name) return false;
    try {
        const headers = await getSafeHeaders();
        const res = await fetch('/api/themes/save', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(themeObj),
        });
        return res.ok;
    } catch (err) {
        console.error('[Theme Localizer] 保存主题失败:', err);
        return false;
    }
}
