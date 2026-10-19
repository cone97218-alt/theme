import {
    getSafeHeaders,
    extractImageUrls,
    downloadAndSaveImage,
    replaceThemeUrls,
    saveThemeToServer,
} from './core.js';

let isProcessing = false;

// 安全获取酒馆已保存的主题列表
export async function getAllThemesSafe() {
    try {
        const headers = await getSafeHeaders();
        const res = await fetch('/api/settings/get', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({}),
        });
        if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.themes) && data.themes.length > 0) {
                return data.themes;
            }
        }
    } catch (e) {
        console.warn('[Theme Localizer] 从 API 获取主题列表失败:', e);
    }

    if (window.themes && Array.isArray(window.themes)) {
        return window.themes;
    }
    return [];
}

// 获取当前正在使用的主题完整对象
export async function getCurrentThemeSafe() {
    const curName = document.querySelector('#themes')?.value || '';
    const allThemes = await getAllThemesSafe();
    const found = allThemes.find(t => t && t.name === curName);

    const curCss = document.getElementById('custom-style')?.innerHTML || $('#customCSS').val() || '';

    if (found) {
        return {
            ...found,
            custom_css: curCss || found.custom_css,
        };
    }

    return {
        name: curName || '当前主题',
        custom_css: curCss,
    };
}

// 日志输出辅助函数
function appendLog(message, type = 'info', $container = null) {
    const $target = $container ? $container.find('#til-log') : $('#til-log');
    if (!$target.length) return;

    $target.show();
    const timeStr = new Date().toLocaleTimeString();
    const $item = $('<div></div>')
        .addClass(`til-log-item til-log-${type}`)
        .text(`[${timeStr}] ${message}`);

    $target.append($item);
    $target.scrollTop($target[0].scrollHeight);
}

// 进度条辅助函数
function updateProgress(current, total, $container = null) {
    const $bar = $container ? $container.find('#til-progress-bar') : $('#til-progress-bar');
    const $fill = $container ? $container.find('#til-progress-fill') : $('#til-progress-fill');
    if (!$bar.length || !$fill.length) return;

    if (total === 0) {
        $bar.hide();
        $fill.css('width', '0%');
        return;
    }

    $bar.show();
    const percent = Math.round((current / total) * 100);
    $fill.css('width', `${percent}%`);
}

// 扫描所有主题中的外链图片
export async function scanThemes($container = null) {
    appendLog('开始扫描已保存的主题外链...', 'info', $container);

    const themeList = await getAllThemesSafe();
    let remoteThemesCount = 0;
    let totalRemoteUrls = 0;
    const themeUrlMap = new Map();

    for (const theme of themeList) {
        if (!theme || !theme.custom_css) continue;
        const urls = extractImageUrls(theme.custom_css);
        if (urls.length > 0) {
            remoteThemesCount++;
            totalRemoteUrls += urls.length;
            themeUrlMap.set(theme.name || '未命名主题', urls);
        }
    }

    const $ctx = $container || $(document);
    $ctx.find('#til-total-themes').text(themeList.length);
    $ctx.find('#til-remote-themes').text(remoteThemesCount);
    $ctx.find('#til-remote-images').text(totalRemoteUrls);

    if (remoteThemesCount === 0) {
        appendLog('扫描完毕：未在任何主题中发现网络外链！所有资源已是本地状态。', 'success', $container);
        if (window.toastr) toastr.info('所有主题资源均已本地化', '扫描完成');
    } else {
        appendLog(`扫描完毕：共有 ${remoteThemesCount} 个主题包含网络外链，涉及 ${totalRemoteUrls} 处图片引用。`, 'warn', $container);
        for (const [name, urls] of themeUrlMap.entries()) {
            appendLog(`• [${name}] 发现 ${urls.length} 处外链引用`, 'info', $container);
        }
        if (window.toastr) toastr.warning(`发现 ${remoteThemesCount} 个主题含有外链图片，建议转存！`, '扫描完成');
    }

    return themeUrlMap;
}

// 执行转存任务
export async function localizeThemes(targetThemes, isCurrentOnly = false, $container = null) {
    if (isProcessing) {
        if (window.toastr) toastr.warning('已有转存任务正在运行中，请稍候...', '请等待');
        return;
    }

    isProcessing = true;
    const $ctx = $container || $(document);
    $ctx.find('#til-btn-scan, #til-btn-localize-current, #til-btn-localize-all').prop('disabled', true);

    try {
        appendLog(`===== 开始执行转存任务 (${isCurrentOnly ? '仅当前主题' : '所有主题'}) =====`, 'info', $container);

        const allUrlsToDownload = new Set();
        for (const theme of targetThemes) {
            if (!theme || !theme.custom_css) continue;
            const urls = extractImageUrls(theme.custom_css);
            urls.forEach(u => allUrlsToDownload.add(u));
        }

        const urlList = [...allUrlsToDownload];
        if (urlList.length === 0) {
            appendLog('所选主题中没有需要转存的网络图片。', 'info', $container);
            if (window.toastr) toastr.info('所选主题无需转存', '完成');
            return;
        }

        appendLog(`共需处理 ${urlList.length} 张不重复图片，开始逐一下载并转存到本地 (/user/images/themes/)...`, 'info', $container);

        const downloadedMap = new Map();
        let currentProgress = 0;
        updateProgress(0, urlList.length, $container);

        for (let i = 0; i < urlList.length; i++) {
            const url = urlList[i];
            try {
                const localPath = await downloadAndSaveImage(url, (msg, type) => appendLog(msg, type, $container));
                downloadedMap.set(url, localPath);
            } catch (err) {
                appendLog(`跳过该图片替换: ${url}`, 'warn', $container);
            }
            currentProgress++;
            updateProgress(currentProgress, urlList.length, $container);
        }

        appendLog('图片本地转存完成，开始更新主题 CSS 路径...', 'info', $container);

        let savedCount = 0;
        const curSelectedTheme = $('#themes').val();

        for (const theme of targetThemes) {
            if (!theme || !theme.custom_css) continue;
            const originalCss = theme.custom_css;
            const updatedTheme = replaceThemeUrls(theme, downloadedMap);

            if (updatedTheme.custom_css !== originalCss) {
                // 如果是正在激活的主题，实时刷新界面样式
                if (isCurrentOnly || theme.name === curSelectedTheme) {
                    const styleEl = document.getElementById('custom-style');
                    if (styleEl) {
                        styleEl.innerHTML = updatedTheme.custom_css;
                    }
                    $('#customCSS').val(updatedTheme.custom_css);
                }

                const ok = await saveThemeToServer(updatedTheme);
                if (ok) {
                    savedCount++;
                    appendLog(`✓ 成功更新并落盘主题: [${theme.name || '当前主题'}]`, 'success', $container);
                } else {
                    appendLog(`✗ 主题落盘保存失败: [${theme.name || '当前主题'}]`, 'error', $container);
                }
            }
        }

        appendLog(`===== 全部完成！成功转存并更新了 ${savedCount} 个主题 =====`, 'success', $container);
        if (window.toastr) toastr.success(`转存完成！已更新 ${savedCount} 个主题的本地资源。`, '本地化成功');

        await scanThemes($container);

    } catch (err) {
        console.error('[Theme Image Localizer] 错误:', err);
        appendLog(`处理异常: ${err.message}`, 'error', $container);
        if (window.toastr) toastr.error(`处理过程中出错: ${err.message}`, '错误');
    } finally {
        isProcessing = false;
        $ctx.find('#til-btn-scan, #til-btn-localize-current, #til-btn-localize-all').prop('disabled', false);
        setTimeout(() => updateProgress(0, 0, $container), 2500);
    }
}

// 弹窗 HTML 模板
function getModalHtml() {
    return `
    <div class="til-root til-modal-content" id="til-modal-content">
        <div class="til-modal-title-row">
            <h3>
                <span>美化图床本地化控制面板</span>
            </h3>
        </div>
        <p class="til-desc">
            扫描酒馆所有已保存的主题美化，将 CSS 中的外链图床资源一键转存至本地目录（<code>/user/images/themes/</code>）并自动替换为绝对路径，彻底告别外链失效与加载延迟。
        </p>

        <div class="til-stat-box" id="til-stats">
            <div class="til-stat-item">
                <span class="til-stat-label">已保存主题</span>
                <span class="til-stat-val" id="til-total-themes">-</span>
            </div>
            <div class="til-stat-item">
                <span class="til-stat-label">含外链主题</span>
                <span class="til-stat-val" id="til-remote-themes" style="color: #f59e0b;">-</span>
            </div>
            <div class="til-stat-item">
                <span class="til-stat-label">发现外链图片</span>
                <span class="til-stat-val" id="til-remote-images" style="color: #60a5fa;">-</span>
            </div>
        </div>

        <div class="til-progress-bar-bg" id="til-progress-bar">
            <div class="til-progress-bar-fill" id="til-progress-fill"></div>
        </div>

        <div class="til-actions">
            <button id="til-btn-scan" class="menu_button til-btn til-btn-secondary" title="检查所有主题中的网络图片链接">
                <i class="fa-solid fa-magnifying-glass"></i> 扫描外链
            </button>
            <button id="til-btn-localize-current" class="menu_button til-btn til-btn-secondary" title="仅转存当前正在使用的主题">
                <i class="fa-solid fa-file-arrow-down"></i> 转存当前主题
            </button>
            <button id="til-btn-localize-all" class="menu_button til-btn til-btn-primary" title="一键转存全部主题的外链图片并保存本地">
                <i class="fa-solid fa-download"></i> 一键转存所有主题
            </button>
        </div>

        <div class="til-log-box" id="til-log"></div>
    </div>
    `;
}

// 弹出酒馆原生风格的控制面板（相对于 ST 界面，非浏览器弹窗）
export async function openModal() {
    const $content = $(getModalHtml());

    // 绑定内部交互事件
    $content.find('#til-btn-scan').on('click', () => scanThemes($content));

    $content.find('#til-btn-localize-current').on('click', async () => {
        const curTheme = await getCurrentThemeSafe();
        await localizeThemes([curTheme], true, $content);
    });

    $content.find('#til-btn-localize-all').on('click', async () => {
        const themeList = await getAllThemesSafe();
        await localizeThemes(themeList, false, $content);
    });

    // 获取 SillyTavern 原生 callGenericPopup
    let popupFn = null;
    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
        try {
            popupFn = SillyTavern.getContext().callGenericPopup;
        } catch (e) {}
    }

    if (!popupFn) {
        try {
            const popupMod = await import('/scripts/popup.js');
            popupFn = popupMod?.callGenericPopup;
        } catch (e) {}
    }

    if (popupFn) {
        // 使用酒馆原生弹窗组件（POPUP_TYPE.TEXT = 1）
        popupFn($content, 1, '', {
            okButton: '关闭',
            cancelButton: false,
            wider: true,
            large: false,
            allowVerticalScrolling: true,
            allowHorizontalScrolling: false,
        });
    } else {
        // 兜底备用：若无法调用原生 popup，挂载到酒馆主界面容器中
        const $overlay = $('<div class="til-root" style="position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center;"></div>');
        const $box = $('<div style="background:var(--SmartThemeBlurTintColor,#222);border:1px solid var(--SmartThemeBorderColor,#444);border-radius:10px;padding:20px;max-width:600px;width:90%;"></div>');
        const $closeBtn = $('<button class="menu_button til-btn til-btn-secondary" style="margin-top:12px;float:right;">关闭</button>');
        $closeBtn.on('click', () => $overlay.remove());
        $box.append($content).append($closeBtn);
        $overlay.append($box);
        $('body').append($overlay);
    }

    // 弹窗打开后自动执行一次扫描
    scanThemes($content);
}

// 移除魔法棒按钮注入（满足需求 3：只保留设置面板，删去魔法棒注入）
function cleanupMenuEntry() {
    $('#til-menu-entry').remove();
    $('#extensionsMenu [data-til-entry]').remove();
}

// 注入到拓展设置面板（Extensions Settings Panel）
function injectSettingsDrawer() {
    const $existing = $('#til-extension-settings');

    const drawerHtml = `
    <div id="til-extension-settings" class="inline-drawer extension_container til-root">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>美化图床本地化</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content" style="display: none;">
            <div class="til-panel">
                <p class="til-desc">
                    一键扫描已保存的酒馆美化主题，自动将 CSS 中的网络图片下载存放到本地（<code>/user/images/themes/</code>）并替换为本地绝对路径，彻底解决图床失效与加载缓慢问题。
                </p>
                <div class="til-actions">
                    <button id="til-drawer-open-btn" class="menu_button til-btn til-btn-primary" style="width: 100%; justify-content: center;">
                        <i class="fa-solid fa-window-restore"></i> 打开本地化控制面板
                    </button>
                </div>
            </div>
        </div>
    </div>
    `;

    const targets = [
        $('#extensions_settings'),
        $('#extensions_settings2'),
        $('#rm_extensions_block .extensions_block'),
        $('#rm_extensions_block'),
    ];

    for (const target of targets) {
        if (target.length > 0) {
            if ($existing.length > 0) {
                // 如果已存在，移动到底部
                target.append($existing);
            } else {
                target.append(drawerHtml);
                $('#til-drawer-open-btn').off('click').on('click', () => openModal());
            }
            break;
        }
    }
}

function mountExtension() {
    cleanupMenuEntry();
    injectSettingsDrawer();
}

export async function init() {
    mountExtension();
}

// 自动检测挂载与定时防脱卸检查
if (typeof jQuery !== 'undefined') {
    jQuery(() => {
        mountExtension();
        setInterval(mountExtension, 1500);
    });
} else {
    window.addEventListener('DOMContentLoaded', () => {
        mountExtension();
        setInterval(mountExtension, 1500);
    });
}
