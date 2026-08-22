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
    if (item.isVideo && item.dash) return muxDashMedia(item.dash, onProgress);
    return fetchProgressiveMediaBlob(item.url, onProgress);
}

async function saveMedia(item, fileName) {
    const DOWNLOAD_BUTTON = document.querySelector('.download-button');
    try {
        setButtonProgress(DOWNLOAD_BUTTON, 0);
        const blob = await fetchBestMediaBlob(item, ({ percent }) => {
            setButtonProgress(DOWNLOAD_BUTTON, percent);
        });
        saveFile(blob, fileName);
    } catch (error) {
        console.log(error);
    } finally {
        resetDownloadState();
    }
}

async function saveAllSelected() {
    const { data } = appState;
    const ACTIVE_BUTTON = document.querySelector('.all-download-button');
    const date = new Date(data.date * 1000).toISOString().split('T')[0];
    const total = appState.selected.size;
    let processed = 0;
    setGroupDownloadProgress(ACTIVE_BUTTON, 0);
    for (const index of appState.selected) {
        const item = data.media[index];
        try {
            const blob = await fetchBestMediaBlob(item, ({ percent }) => {
                setGroupDownloadProgress(ACTIVE_BUTTON, ((processed + percent / 100) / total) * 100);
            });
            const title = `${data.user.username} | ${item.id} | ${date}`;
            saveFile(blob, title.replaceAll(' | ', '_') + `.${item.format}`);
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
    const date = new Date(appState.data.date * 1000).toISOString().split('T')[0];
    const media = Array.from(appState.selected).map((index) => {
        const item = appState.data.media[index];
        return {
            title: `${appState.data.user.username}_${item.id}_${date}`,
            format: item.format,
            item,
        };
    });
    const zipFileName = `${media[0].title}.zip`;
    async function fetchSelectedMedia() {
        let processed = 0;
        const results = [];
        for (const mediaItem of media) {
            const blob = await fetchBestMediaBlob(mediaItem.item, ({ percent }) => {
                const downloadPercent = ((processed + percent / 100) / media.length) * 95;
                setGroupDownloadProgress(ACTIVE_BUTTON, downloadPercent);
            });
            results.push({
                title: `${mediaItem.title}.${mediaItem.format}`,
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
    const isZipSelecting = appState.isSelecting && appState.selected.size > 0 && !panelHidden;
    GROUP_DOWNLOAD_MEDIA.classList.toggle('hide', appState.extensionHidden || !isZipSelecting);
    DOWNLOAD_BUTTON.classList.toggle('hide', appState.extensionHidden || isZipSelecting);
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
    const date = new Date(data.date * 1000).toISOString().split('T')[0];
    data.media.forEach((item, index) => {
        const attributes = {
            class: 'media-item',
            src: item.url,
            title: `${data.user.username} | ${item.id} | ${date}`,
            controls: '',
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
            else if (key !== 'controls') media.setAttribute(key, attributes[key]);
        });
        media.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (appState.isSelecting) {
                appState.toggleSelected(index);
                updateSelectedMedia();
            } else {
                const filename = media.title.replaceAll(' | ', '_') + `.${item.format}`;
                saveMedia(item, filename);
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
