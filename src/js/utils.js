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

async function fetchBestMediaBlob(item, onProgress) {
    if (item.isVideo && videoDownloadPreferences.usesProgressive()) {
        return fetchProgressiveMediaBlob(item.url, onProgress);
    }
    if (item.isVideo && item.dash) return muxDashMedia(item.dash, onProgress);
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

async function getInlineDownloadData(type, shortcode) {
    if (type === 'post') {
        if (shortcode) return downloadPostPhotos(shortcode);
        appState.setCurrentShortcode();
        return downloadPostPhotos();
    }
    if (type === 'highlights') {
        appState.setCurrentHightlightsId();
        return downloadStoryPhotos('highlights');
    }
    appState.setCurrentUsername();
    return downloadStoryPhotos('stories');
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

function resolveSelectedStoryMedia(data, selection) {
    if (!selection?.stable) return null;

    const selectedMediaId = getMediaId(selection.mediaId);
    if (selectedMediaId) {
        const mediaById = data.media.find((item) => getMediaId(item.id) === selectedMediaId);
        if (mediaById) return mediaById;
    }

    const selectedCacheId = getMediaCacheId(selection.sourceUrl);
    if (selectedCacheId) {
        const mediaByCacheId = data.media.find(
            (item) => getMediaId(item.id) === selectedCacheId || getMediaCacheId(item.url) === selectedCacheId,
        );
        if (mediaByCacheId) return mediaByCacheId;
    }

    const selectedPath = getMediaUrlPath(selection.sourceUrl);
    if (selectedPath) {
        const mediaByUrl = data.media.find((item) => getMediaUrlPath(item.url) === selectedPath);
        if (mediaByUrl) return mediaByUrl;
    }

    const index = Number(selection.index);
    const itemCount = Number(selection.itemCount);
    if (
        selection.indexConfident &&
        Number.isInteger(index) &&
        index >= 0 &&
        index < data.media.length &&
        itemCount === data.media.length
    ) {
        return data.media[index];
    }

    return null;
}

function resolveSelectedPostMedia(data, selection, shortcode) {
    if (!selection?.stable || selection.shortcode !== shortcode) return null;

    let mediaBySource = null;
    const selectedCacheId = getMediaCacheId(selection.sourceUrl);
    if (selectedCacheId) {
        mediaBySource = data.media.find(
            (item) => getMediaId(item.id) === selectedCacheId || getMediaCacheId(item.url) === selectedCacheId,
        );
    }

    if (!mediaBySource) {
        const selectedPath = getMediaUrlPath(selection.sourceUrl);
        if (selectedPath) {
            mediaBySource = data.media.find((item) => getMediaUrlPath(item.url) === selectedPath) ?? null;
        }
    }

    const index = Number(selection.index);
    const itemCount = Number(selection.itemCount);
    const mediaByIndex =
        selection.indexConfident &&
        Number.isInteger(index) &&
        index >= 0 &&
        index < data.media.length &&
        itemCount === data.media.length
            ? data.media[index]
            : null;

    // Both signals should agree. Abort safely if Instagram is still transitioning between slides.
    if (mediaBySource && mediaByIndex && mediaBySource !== mediaByIndex) return null;

    return mediaByIndex ?? mediaBySource;
}

async function downloadInlineMedia({
    button,
    type,
    downloadAll = false,
    index = 0,
    selection = null,
    shortcode,
    operationKey = '',
}) {
    if (button.disabled) return;
    setInlineDownloadProgress(button, 0, operationKey);
    try {
        const data = await getInlineDownloadData(type, shortcode);
        if (!data?.media?.length) throw new Error('No downloadable media found');

        if (!downloadAll) {
            let item = null;
            if (type === 'stories' || type === 'highlights') item = resolveSelectedStoryMedia(data, selection);
            else if (type === 'post') item = resolveSelectedPostMedia(data, selection, shortcode);
            else item = data.media[Math.min(Math.max(index, 0), data.media.length - 1)];
            if (!item) throw new Error('Unable to identify the currently displayed media safely');
            const blob = await fetchBestMediaBlob(item, ({ percent }) =>
                setInlineDownloadProgress(button, percent, operationKey),
            );
            setInlineDownloadProgress(button, 100, operationKey);
            saveFile(blob, getMediaFileName(data, item, blob));
            return;
        }

        const files = [];
        const usedNames = new Set();
        let processed = 0;
        for (const item of data.media) {
            const blob = await fetchBestMediaBlob(item, ({ percent }) => {
                setInlineDownloadProgress(button, ((processed + percent / 100) / data.media.length) * 95, operationKey);
            });
            files.push({ title: getUniqueArchiveEntryName(getMediaFileName(data, item, blob), usedNames), data: blob });
            processed++;
            setInlineDownloadProgress(button, (processed / data.media.length) * 95, operationKey);
        }

        setInlineDownloadProgress(button, 96, operationKey);
        const zip = await createZip(files);
        setInlineDownloadProgress(button, 100, operationKey);
        saveFile(zip, getArchiveFileName(data));
    } catch (error) {
        console.log(error);
    } finally {
        setTimeout(() => resetInlineDownloadProgress(button, operationKey), 300);
    }
}

async function saveMedia(data, item) {
    const DOWNLOAD_BUTTON = document.querySelector('.download-button');
    try {
        setButtonProgress(DOWNLOAD_BUTTON, 0);
        const blob = await fetchBestMediaBlob(item, ({ percent }) => {
            setButtonProgress(DOWNLOAD_BUTTON, percent);
        });
        saveFile(blob, getMediaFileName(data, item, blob));
    } catch (error) {
        console.log(error);
    } finally {
        resetDownloadState();
    }
}

async function saveAllSelected() {
    const { data } = appState;
    const ACTIVE_BUTTON = document.querySelector('.all-download-button');
    const total = appState.selected.size;
    let processed = 0;
    setGroupDownloadProgress(ACTIVE_BUTTON, 0);
    for (const index of appState.selected) {
        const item = data.media[index];
        try {
            const blob = await fetchBestMediaBlob(item, ({ percent }) => {
                setGroupDownloadProgress(ACTIVE_BUTTON, ((processed + percent / 100) / total) * 100);
            });
            saveFile(blob, getMediaFileName(data, item, blob));
        } catch (error) {
            console.log(error);
        } finally {
            processed++;
            setGroupDownloadProgress(ACTIVE_BUTTON, (processed / total) * 100);
        }
    }
    resetGroupDownloadState();
}

async function saveZip() {
    const ACTIVE_BUTTON = document.querySelector('.zip-download-button');
    setGroupDownloadProgress(ACTIVE_BUTTON, 0);
    const media = Array.from(appState.selected).map((index) => ({ item: appState.data.media[index] }));
    const zipFileName = getArchiveFileName(appState.data, media[0]?.item);
    async function fetchSelectedMedia() {
        let processed = 0;
        const results = [];
        const usedNames = new Set();
        for (const mediaItem of media) {
            const blob = await fetchBestMediaBlob(mediaItem.item, ({ percent }) => {
                const downloadPercent = ((processed + percent / 100) / media.length) * 95;
                setGroupDownloadProgress(ACTIVE_BUTTON, downloadPercent);
            });
            results.push({
                title: getUniqueArchiveEntryName(getMediaFileName(appState.data, mediaItem.item, blob), usedNames),
                data: blob,
            });
            processed++;
            setGroupDownloadProgress(ACTIVE_BUTTON, (processed / media.length) * 95);
        }
        return results;
    }
    try {
        const data = await fetchSelectedMedia();
        setGroupDownloadProgress(ACTIVE_BUTTON, 96);
        const blob = await createZip(data);
        setGroupDownloadProgress(ACTIVE_BUTTON, 100);
        saveFile(blob, zipFileName);
        appState.selected.clear();
        updateSelectedMedia();
        resetGroupDownloadState();
    } catch (error) {
        console.log(error);
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
