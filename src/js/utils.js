function saveFile(blob, fileName) {
    const a = document.createElement('a');
    a.download = fileName;
    a.href = URL.createObjectURL(blob);
    a.click();
    URL.revokeObjectURL(a.href);
}

function setButtonProgress(button, percent) {
    const value = Math.max(0, Math.min(100, Number(percent) || 0));
    if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent;
    button.classList.add('loading');
    button.classList.add('progressing');
    button.disabled = true;
    button.style.setProperty('--download-progress', `${value}%`);
    button.textContent = `${Math.round(value)}%`;
    button.setAttribute('aria-busy', 'true');
    button.setAttribute('aria-label', `${button.dataset.defaultLabel} ${Math.round(value)}%`);
}

function resetButtonProgress(button) {
    button.classList.remove('loading');
    button.classList.remove('progressing');
    button.disabled = false;
    button.style.removeProperty('--download-progress');
    button.textContent = button.dataset.defaultLabel;
    button.removeAttribute('aria-busy');
    button.removeAttribute('aria-label');
}

function setGroupDownloadProgress(activeButton, percent) {
    document.querySelectorAll('.group-download-media > button').forEach((button) => {
        button.disabled = true;
    });
    setButtonProgress(activeButton, percent);
}

function resetGroupDownloadState() {
    document.querySelectorAll('.group-download-media > button').forEach(resetButtonProgress);
}

/**
 * The Instagram backend determines the maximum image resolution to return
 * based on the `wd` and `dpr` cookies.
 */
function setPreferredMediaResolutionCookies() {
    // 3840 × 2160
    const width = 3840 / 2;
    const height = 2160 / 2 - 100;
    const dpr = 2; // device pixel ratio
    Cookies.set('wd', `${width}x${height}`);
    Cookies.set('dpr', dpr);
}

function getFetchOptions() {
    return {
        headers: {
            // Hardcode variable: a="129477";f.ASBD_ID=a in JS, can be remove
            // 'x-asbd-id': '129477',
            'x-csrftoken': Cookies.get('csrftoken'),
            'x-ig-app-id': '936619743392459',
            'x-ig-www-claim': sessionStorage.getItem('www-claim-v2'),
            // 'x-instagram-ajax': '1006598911',
            'x-requested-with': 'XMLHttpRequest',
        },
        referrer: window.location.href,
        referrerPolicy: 'strict-origin-when-cross-origin',
        method: 'GET',
        mode: 'cors',
        credentials: 'include',
    };
}

function getValueByKey(obj, key) {
    if (typeof obj !== 'object' || obj === null) return null;
    const stack = [obj];
    const visited = new Set();
    while (stack.length) {
        const current = stack.pop();
        if (visited.has(current)) continue;
        visited.add(current);
        try {
            if (current[key] !== undefined) return current[key];
        } catch (error) {
            if (error.name === 'SecurityError') continue;
            console.log(error);
        }
        for (const value of Object.values(current)) {
            if (typeof value === 'object' && value !== null) {
                stack.push(value);
            }
        }
    }
    return null;
}

function resetDownloadState() {
    const DOWNLOAD_BUTTON = document.querySelector('.download-button');
    resetButtonProgress(DOWNLOAD_BUTTON);
}

async function fetchProgressiveMediaBlob(url, onProgress) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Media download failed (${response.status})`);
    const total = Number(response.headers.get('content-length') || 0);
    if (!response.body) {
        const blob = await response.blob();
        onProgress?.({ stage: 'Downloading', percent: 100 });
        return blob;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    let lastPercent = -1;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.byteLength;
        if (total) {
            const percent = Math.min(100, Math.round((loaded / total) * 100));
            if (percent !== lastPercent) {
                lastPercent = percent;
                onProgress?.({ stage: 'Downloading', percent });
            }
        }
    }
    onProgress?.({ stage: 'Downloading', percent: 100 });
    return new Blob(chunks, { type: response.headers.get('content-type') || '' });
}

// Track fallback metadata per download without changing the cached DASH item.
const progressiveFallbackBlobs = new WeakSet();

async function fetchBestMediaBlob(item, onProgress) {
    if (item.isVideo && videoDownloadPreferences.usesProgressive()) {
        return fetchProgressiveMediaBlob(item.url, onProgress);
    }
    if (item.isVideo && item.dash) {
        const allowFallback = videoDownloadPreferences.fallbackEnabled;
        try {
            return await muxDashMedia(item.dash, onProgress);
        } catch (error) {
            // Do not continue after cancellation or make another request on rate limits.
            if (
                !allowFallback ||
                error.name === 'AbortError' ||
                error.status === 429 ||
                /\(429\)/.test(error.message || '')
            ) {
                throw error;
            }
            onProgress?.({ stage: 'Downloading progressive fallback', percent: 0 });
            const blob = await fetchProgressiveMediaBlob(item.url, onProgress);
            progressiveFallbackBlobs.add(blob);
            return blob;
        }
    }
    return fetchProgressiveMediaBlob(item.url, onProgress);
}

const inlineDownloadProgressState = new Map();

function getInlineDownloadButtons(button, operationKey) {
    const buttons = button ? [button] : [];
    if (!operationKey) return buttons;

    for (const candidate of document.querySelectorAll('[data-download-operation-key]')) {
        if (candidate.dataset.downloadOperationKey === operationKey && !buttons.includes(candidate)) {
            buttons.push(candidate);
        }
    }
    return buttons;
}

function applyInlineDownloadProgress(button, percent) {
    const value = Math.max(0, Math.min(100, Number(percent) || 0));
    button.classList.add('igd-inline-downloading');
    button.disabled = true;
    button.style.setProperty('--inline-download-progress', `${value}%`);
    button.setAttribute('aria-busy', 'true');
    button.setAttribute('aria-valuenow', Math.round(value));
}

function clearInlineDownloadProgress(button) {
    button.classList.remove('igd-inline-downloading');
    button.disabled = false;
    button.style.removeProperty('--inline-download-progress');
    button.removeAttribute('aria-busy');
    button.removeAttribute('aria-valuenow');
}

function setInlineDownloadProgress(button, percent, operationKey = button?.dataset.downloadOperationKey || '') {
    const value = Math.max(0, Math.min(100, Number(percent) || 0));
    if (operationKey) inlineDownloadProgressState.set(operationKey, value);
    for (const candidate of getInlineDownloadButtons(button, operationKey)) {
        applyInlineDownloadProgress(candidate, value);
    }
}

function restoreInlineDownloadProgress(button) {
    const operationKey = button?.dataset.downloadOperationKey || '';
    if (!operationKey || !inlineDownloadProgressState.has(operationKey)) return;
    applyInlineDownloadProgress(button, inlineDownloadProgressState.get(operationKey));
}

function resetInlineDownloadProgress(button, operationKey = button?.dataset.downloadOperationKey || '') {
    const buttons = getInlineDownloadButtons(button, operationKey);
    if (operationKey) inlineDownloadProgressState.delete(operationKey);
    for (const candidate of buttons) clearInlineDownloadProgress(candidate);
}

function getDownloadFilenameScope(data) {
    if (Object.values(DOWNLOAD_FILENAME_SCOPES).includes(data?.type)) return data.type;
    if (Object.values(DOWNLOAD_FILENAME_SCOPES).includes(appState.currentDisplay)) return appState.currentDisplay;
    return DOWNLOAD_FILENAME_SCOPES.POST;
}

function getDownloadFilenameValues(data, item, useContainerId = false) {
    const timestamp = item?.takenAt ?? data?.date;
    const usesProgressive = item?.isVideo && videoDownloadPreferences.usesProgressive();
    const width = Number((usesProgressive ? item?.progressiveWidth : item?.width) || 0);
    const height = Number((usesProgressive ? item?.progressiveHeight : item?.height) || 0);
    const bitrate = Number(usesProgressive ? 0 : item?.videoBitrate || 0);
    const codec = String(usesProgressive ? 'h264' : item?.videoCodec || '').toLowerCase();
    let friendlyCodec = '';
    if (codec.startsWith('vp09') || codec.startsWith('vp9')) friendlyCodec = 'VP9';
    else if (codec.startsWith('av01') || codec.startsWith('av1')) friendlyCodec = 'AV1';
    else if (codec.startsWith('avc1') || codec.startsWith('avc3') || codec.startsWith('h264')) friendlyCodec = 'H264';
    else if (codec.startsWith('hev1') || codec.startsWith('hvc1') || codec.startsWith('hevc')) friendlyCodec = 'HEVC';
    else if (codec) friendlyCodec = codec.split('.')[0].toUpperCase();

    return {
        original_filename: item?.originalFilename || data?.media?.[0]?.originalFilename || '',
        username: data?.user?.username || '',
        date: downloadFilenamePreferences.formatDate(timestamp),
        title: data?.title || '',
        id: String((useContainerId ? data?.id : item?.id) || data?.id || ''),
        resolution: width && height ? `${width}x${height}` : '',
        video_bitrate:
            bitrate >= 1000000
                ? `${Number((bitrate / 1000000).toFixed(1))}Mbps`
                : bitrate
                  ? `${Math.round(bitrate / 1000)}kbps`
                  : '',
        video_codec: friendlyCodec,
    };
}

function resolveMediaFormatFromContentType(contentType) {
    const mimeType = String(contentType || '')
        .split(';')[0]
        .trim()
        .toLowerCase();
    const formats = {
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/pjpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/avif': 'avif',
        'image/heic': 'heic',
        'image/heif': 'heif',
        'image/gif': 'gif',
        'video/mp4': 'mp4',
        'video/quicktime': 'mov',
    };
    return formats[mimeType] || null;
}

function getMediaFileName(data, item, blob) {
    if (progressiveFallbackBlobs.has(blob)) {
        item = {
            ...item,
            width: item.progressiveWidth || 0,
            height: item.progressiveHeight || 0,
            videoBitrate: 0,
            videoCodec: '',
        };
    }
    const scope = getDownloadFilenameScope(data);
    const values = getDownloadFilenameValues(data, item);
    const baseName = downloadFilenamePreferences.formatMedia(scope, values);
    const format = resolveMediaFormatFromContentType(blob?.type) || item.format;
    return `${baseName}.${format}`;
}

function getArchiveFileName(data, item = data?.media?.[0]) {
    const baseName = downloadFilenamePreferences.formatArchive(
        getDownloadFilenameScope(data),
        getDownloadFilenameValues(data, item, true),
    );
    return `${baseName}.zip`;
}

function getUniqueArchiveEntryName(fileName, usedNames) {
    let candidate = fileName;
    let suffix = 2;
    const dotIndex = fileName.lastIndexOf('.');
    const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
    const extension = dotIndex > 0 ? fileName.slice(dotIndex) : '';
    while (usedNames.has(candidate.toLowerCase())) candidate = `${baseName}_${suffix++}${extension}`;
    usedNames.add(candidate.toLowerCase());
    return candidate;
}

function getMediaId(value) {
    return String(value ?? '').match(/^\d+/)?.[0] ?? '';
}

function getMediaCacheId(mediaUrl) {
    if (!mediaUrl || mediaUrl.startsWith('blob:')) return '';
    try {
        let cacheKey = new URL(mediaUrl).searchParams.get('ig_cache_key') || '';
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                cacheKey = decodeURIComponent(cacheKey);
            } catch {
                break;
            }
        }
        return atob(cacheKey).match(/\d{10,}/)?.[0] ?? '';
    } catch {
        return '';
    }
}

function getMediaUrlPath(mediaUrl) {
    if (!mediaUrl || mediaUrl.startsWith('blob:')) return '';
    try {
        return new URL(mediaUrl).pathname;
    } catch {
        return '';
    }
}

function findMediaByRenderedUrl(data, mediaUrl) {
    const selectedCacheId = getMediaCacheId(mediaUrl);
    if (selectedCacheId) {
        const mediaByCacheId = data.media.find((item) =>
            [item.url, item.previewUrl].some(
                (candidateUrl) =>
                    getMediaId(item.id) === selectedCacheId || getMediaCacheId(candidateUrl) === selectedCacheId,
            ),
        );
        if (mediaByCacheId) return mediaByCacheId;
    }

    const selectedPath = getMediaUrlPath(mediaUrl);
    if (!selectedPath) return null;
    return (
        data.media.find((item) =>
            [item.url, item.previewUrl].some((candidateUrl) => getMediaUrlPath(candidateUrl) === selectedPath),
        ) ?? null
    );
}

async function saveMedia(data, item) {
    const button = document.querySelector('.download-button');
    const report = createDownloadReport();
    setDownloadReportMedia(report, data, [item]);
    try {
        const result = await fetchMediaWithRecovery(item, ({ percent }) => setButtonProgress(button, percent), report);
        saveFile(result.blob, getMediaFileName(data, result.item, result.blob));
        recordDownloadedItem(report, result);
        report.saved = true;
    } catch (error) {
        console.log(error);
        if (isDownloadRateLimited(error)) report.stopped = true;
        report.errors.push(error.message || 'Download failed.');
    } finally {
        showDownloadReport(report);
        resetDownloadState();
    }
}

async function saveAllSelected() {
    const { data } = appState;
    const button = document.querySelector('.all-download-button');
    const media = [...appState.selected].map((index) => data.media[index]);
    const report = createDownloadReport(media.length);
    setDownloadReportMedia(report, data, media);
    setGroupDownloadProgress(button, 0);
    try {
        for (let index = 0; index < media.length; index++) {
            try {
                const result = await fetchMediaWithRecovery(
                    media[index],
                    ({ percent }) => {
                        setGroupDownloadProgress(button, ((index + percent / 100) / media.length) * 100);
                    },
                    report,
                );
                saveFile(result.blob, getMediaFileName(data, result.item, result.blob));
                recordDownloadedItem(report, result);
                report.saved = true;
            } catch (error) {
                if (error.name === 'AbortError') throw error;
                report.skipped++;
                report.skippedIds.push(getDownloadReportLabel(report, media[index]));
                report.errors.push(getDownloadReportLabel(report, media[index]) + ': ' + error.message);
                console.log(error);
                if (isDownloadRateLimited(error)) {
                    report.stopped = true;
                    break;
                }
            }
            setGroupDownloadProgress(button, ((index + 1) / media.length) * 100);
        }
    } catch (error) {
        console.log(error);
        report.errors.push(error.message || 'Download interrupted.');
    } finally {
        showDownloadReport(report);
        resetGroupDownloadState();
    }
}

async function saveZip() {
    const button = document.querySelector('.zip-download-button');
    const data = appState.data;
    const selected = [...appState.selected];
    const media = selected.map((index) => data.media[index]);
    const report = createDownloadReport();
    setGroupDownloadProgress(button, 0);
    try {
        const files = await collectDownloadFiles(
            data,
            media,
            (percent) => setGroupDownloadProgress(button, percent),
            report,
        );
        if (!files.length) return;
        setGroupDownloadProgress(button, 96);
        const blob = await createZip(files);
        setGroupDownloadProgress(button, 100);
        saveFile(blob, getArchiveFileName(data, media[0]));
        report.saved = true;
        // Retain the selection after a partial download so it can be retried.
        if (!report.skipped && !report.stopped) {
            selected.forEach((index) => appState.selected.delete(index));
        }
        updateSelectedMedia();
    } catch (error) {
        console.log(error);
        report.errors.push(error.message || 'Could not finish the ZIP download.');
    } finally {
        showDownloadReport(report);
        resetGroupDownloadState();
    }
}

function shouldDownload() {
    if (window.location.pathname === '/' && appState.getFieldChange() !== 'none') {
        return appState.getFieldChange();
    }
    appState.setCurrentShortcode();
    appState.setCurrentUsername();
    appState.setCurrentHightlightsId();
    function getCurrentPage() {
        const currentPath = window.location.pathname;
        if (currentPath.match(IG_POST_REGEX)) return 'post';
        if (currentPath.match(IG_STORY_REGEX)) {
            if (currentPath.match(IG_HIGHLIGHT_REGEX)) return 'highlights';
            return 'stories';
        }
        if (currentPath === '/') return 'post';
        return 'none';
    }
    const currentPage = getCurrentPage();
    const valueChange = appState.getFieldChange();
    if (['highlights', 'stories', 'post'].includes(currentPage)) {
        if (currentPage === valueChange) return valueChange;
        if (appState.currentDisplay !== currentPage) return currentPage;
    }
    return 'none';
}

function setDownloadState(state = 'ready') {
    const DOWNLOAD_BUTTON = document.querySelector('.download-button');
    const MEDIA_CONTAINER = document.querySelector('.media-container');
    const options = {
        ready() {
            DOWNLOAD_BUTTON.classList.add('loading');
            DOWNLOAD_BUTTON.textContent = 'Loading...';
            DOWNLOAD_BUTTON.disabled = true;
            MEDIA_CONTAINER.replaceChildren();
        },
        fail() {
            resetDownloadState();
        },
        success() {
            DOWNLOAD_BUTTON.disabled = false;
            appState.setPreviousValues();
            const photosArray = MEDIA_CONTAINER.querySelectorAll('img , video');
            let loadedPhotos = 0;
            function countLoaded() {
                loadedPhotos++;
                if (loadedPhotos === photosArray.length) resetDownloadState();
            }
            photosArray.forEach((media) => {
                if (media.tagName === 'IMG') {
                    media.addEventListener('load', countLoaded);
                    media.addEventListener('error', countLoaded);
                } else {
                    media.addEventListener('loadeddata', countLoaded);
                    media.addEventListener('abort', countLoaded);
                }
            });
        },
    };
    options[state]();
}

async function handleDownload(e) {
    e.preventDefault();
    e.stopPropagation();
    exitSelectMode();
    let data = null;
    const DISPLAY_CONTAINER = document.querySelector('.display-container');
    const option = shouldDownload();
    requestAnimationFrame(() => {
        DISPLAY_CONTAINER.classList.remove('hide');
        updateButtonVisibility();
    });
    if (option === 'none') return;
    setDownloadState('ready');
    option === 'post' ? (data = await downloadPostPhotos()) : (data = await downloadStoryPhotos(option));
    if (!data) return setDownloadState('fail');
    appState.currentDisplay = option;
    renderMedia(data);
}

function updateButtonVisibility() {
    const DISPLAY_CONTAINER = document.querySelector('.display-container');
    const GROUP_DOWNLOAD_MEDIA = document.querySelector('.group-download-media');
    const DOWNLOAD_BUTTON = document.querySelector('.download-button');
    const panelHidden = DISPLAY_CONTAINER.classList.contains('hide');
    const panelDisabled = !downloadUiPreferences.shows('panel');
    const isZipSelecting = appState.isSelecting && appState.selected.size > 0 && !panelHidden;
    GROUP_DOWNLOAD_MEDIA.classList.toggle('hide', appState.extensionHidden || panelDisabled || !isZipSelecting);
    DOWNLOAD_BUTTON.classList.toggle('hide', appState.extensionHidden || panelDisabled || isZipSelecting);
}

function updateSelectedMedia() {
    const TITLE_CONTAINER = document.querySelector('.title-container').firstElementChild;
    const DISPLAY_CONTAINER = document.querySelector('.display-container');
    if (appState.isSelecting) {
        TITLE_CONTAINER.textContent = `Selected ${appState.selected.size} / ${appState.data?.media.length ?? 0}`;
    }
    updateButtonVisibility();
    DISPLAY_CONTAINER.querySelectorAll('.media-item').forEach((media, index) => {
        media.parentElement.querySelector('.overlay').classList.toggle('checked', appState.selected.has(index));
    });
}

function exitSelectMode() {
    const TITLE_CONTAINER = document.querySelector('.title-container').firstElementChild;
    const DISPLAY_CONTAINER = document.querySelector('.display-container');
    if (!appState.isSelecting && appState.selected.size === 0) return;
    appState.isSelecting = false;
    appState.selected.clear();
    TITLE_CONTAINER.textContent = 'Media';
    TITLE_CONTAINER.title = APP_NAME;
    DISPLAY_CONTAINER.querySelectorAll('.overlay').forEach((element) => {
        element.classList.remove('show');
        element.classList.remove('checked');
    });
    updateSelectedMedia();
}

function renderMedia(data) {
    const TITLE_CONTAINER = document.querySelector('.title-container').firstElementChild;
    const MEDIA_CONTAINER = document.querySelector('.media-container');
    MEDIA_CONTAINER.replaceChildren();
    appState.data = data;
    if (!data) {
        updateSelectedMedia();
        return;
    }
    const fragment = document.createDocumentFragment();
    data.media.forEach((item, index) => {
        const itemDate = new Date(item.takenAt * 1000).toISOString().split('T')[0];
        const attributes = {
            class: 'media-item',
            src: item.url,
            title: `${data.user.username} | ${item.id} | ${itemDate}`,
            controls: '',
            // Chrome's native download button bypasses saveMedia and fetches the
            // signed CDN url directly, which the CDN rejects.
            controlslist: 'nodownload',
            'data-format': item.format,
        };
        const ITEM_TEMPLATE = `<div>
				${item.isVideo ? `<video></video>` : '<img/>'}
				<div class="overlay">✔</div>
			</div>`;
        const itemDOM = new DOMParser().parseFromString(ITEM_TEMPLATE, 'text/html').body.firstElementChild;
        const media = itemDOM.querySelector('img, video');
        Object.keys(attributes).forEach((key) => {
            if (item.isVideo) media.setAttribute(key, attributes[key]);
            else if (key !== 'controls' && key !== 'controlslist') media.setAttribute(key, attributes[key]);
        });
        media.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (appState.isSelecting) {
                appState.toggleSelected(index);
                updateSelectedMedia();
            } else {
                saveMedia(data, item);
            }
        });
        fragment.appendChild(itemDOM);
    });
    MEDIA_CONTAINER.appendChild(fragment);
    TITLE_CONTAINER.textContent = 'Media';
    TITLE_CONTAINER.title = APP_NAME;
    updateSelectedMedia();
    setDownloadState('success');
}

function handleLongClick(element, shortClickHandler, longClickHandler, delay = 400) {
    element.addEventListener('mousedown', (e) => {
        if (e.button === 2) return;
        let count = 0;
        const intervalId = setInterval(() => {
            count = count + 10;
            if (count >= delay) {
                clearInterval(intervalId);
                longClickHandler();
            }
        }, 10);
        element.addEventListener(
            'mouseup',
            () => {
                clearInterval(intervalId);
                if (count < delay) shortClickHandler();
            },
            { once: true },
        );
    });
}

function isValidJson(string) {
    try {
        JSON.parse(string);
        return true;
    } catch {
        return false;
    }
}

function resolveMediaFormat(mediaUrl) {
    try {
        const pathname = new URL(mediaUrl).pathname;
        const filename = pathname.split('/').pop() || '';
        const match = filename.match(/\.([a-z0-9]+)$/i);
        return match ? match[1].toLowerCase() : null;
    } catch {
        return null;
    }
}

function getFbDtsg() {
    for (const script of document.scripts) {
        const text = script.textContent || '';

        const match =
            text.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"/) || text.match(/"dtsg":\s*\{\s*"token":"([^"]+)"/);

        if (match) {
            return match[1];
        }
    }

    return null;
}
