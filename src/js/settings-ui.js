(() => {
    const NAV_ITEM_CLASS = 'igd-settings-nav-item';
    const MODAL_CLASS = 'igd-settings-modal';
    const RESERVED_SIDEBAR_PATHS = new Set([
        '/',
        '/search/',
        '/explore/',
        '/explore/tags/',
        '/reels/',
        '/reels/tv/',
        '/direct/',
        '/direct/inbox/',
        '/accounts/',
        '/about/',
        '/developer/',
        '/legal/',
        '/challenge/',
    ]);
    const FILENAME_SCOPE_LABELS = Object.freeze({
        [DOWNLOAD_FILENAME_SCOPES.POST]: 'Posts',
        [DOWNLOAD_FILENAME_SCOPES.STORIES]: 'Stories',
        [DOWNLOAD_FILENAME_SCOPES.HIGHLIGHTS]: 'Highlights',
    });
    const FILENAME_PREVIEW_VALUES = Object.freeze({
        original_filename: 'instagram_media',
        username: 'username',
        title: 'Summer highlights',
        id: '123456789',
        resolution: '1080x1920',
        video_bitrate: '4.2Mbps',
        video_codec: 'VP9',
    });
    const FILENAME_PREVIEW_TIMESTAMP = Date.UTC(2026, 8, 17) / 1000;
    const DATE_FORMAT_EXAMPLES = Object.freeze({
        'YYYY-MM-DD': '2026-09-17',
        DD_MM_YYYY: '17_09_2026',
        MM_DD_YYYY: '09_17_2026',
        'MMM DD, YYYY': 'Sep 17, 2026',
    });
    let updateQueued = false;
    let initialized = false;

    function createTemplateToken(token) {
        const chip = document.createElement('div');
        chip.className = 'igd-template-token';
        if (DOWNLOAD_FILENAME_SINGLE_ONLY_TOKENS.includes(token)) {
            chip.classList.add('igd-template-token-single-only');
            chip.title = 'Used for single-file names only; omitted from the ZIP archive name';
        }
        chip.draggable = true;
        chip.dataset.token = token;
        chip.innerHTML = `<span>#${token}</span><button type="button" aria-label="Remove #${token}">&times;</button>`;
        return chip;
    }

    function renderFilenameRow(overlay, scope) {
        const row = overlay.querySelector(`.igd-template-row[data-scope="${scope}"]`);
        if (!row) return;
        row.replaceChildren(...downloadFilenamePreferences.get(scope).map(createTemplateToken));
        const singlePreview = overlay.querySelector(
            `.igd-template-preview[data-scope="${scope}"][data-kind="single"] code`,
        );
        const zipPreview = overlay.querySelector(
            `.igd-template-preview[data-scope="${scope}"][data-kind="archive"] code`,
        );
        const previewValues = {
            ...FILENAME_PREVIEW_VALUES,
            date: downloadFilenamePreferences.formatDate(FILENAME_PREVIEW_TIMESTAMP),
        };
        if (singlePreview) {
            singlePreview.textContent = `${downloadFilenamePreferences.formatMedia(scope, previewValues)}.jpg`;
        }
        if (zipPreview) {
            zipPreview.textContent = `${downloadFilenamePreferences.formatArchive(scope, previewValues)}.zip`;
        }
    }

    function bindFilenameBuilder(overlay) {
        let activeScope = DOWNLOAD_FILENAME_SCOPES.POST;
        let dragged = null;

        function selectScope(scope) {
            activeScope = scope;
            overlay.querySelectorAll('.igd-template-row').forEach((row) => {
                row.classList.toggle('igd-template-row-active', row.dataset.scope === scope);
            });
        }

        function saveTemplate(scope, template) {
            downloadFilenamePreferences.set(scope, template);
            renderFilenameRow(overlay, scope);
            selectScope(scope);
        }

        overlay.querySelectorAll('.igd-template-row').forEach((row) => {
            const scope = row.dataset.scope;
            row.addEventListener('pointerdown', () => selectScope(scope));
            row.addEventListener('dragstart', (event) => {
                const chip = event.target.closest('.igd-template-token');
                if (!chip) return;
                dragged = {
                    token: chip.dataset.token,
                    scope,
                    index: [...row.querySelectorAll('.igd-template-token')].indexOf(chip),
                };
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', chip.dataset.token);
            });
            row.addEventListener('dragover', (event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = dragged?.scope === scope ? 'move' : 'copy';
                row.classList.add('igd-template-row-dragover');
            });
            row.addEventListener('dragleave', (event) => {
                if (!row.contains(event.relatedTarget)) row.classList.remove('igd-template-row-dragover');
            });
            row.addEventListener('drop', (event) => {
                event.preventDefault();
                row.classList.remove('igd-template-row-dragover');
                const token = dragged?.token || event.dataTransfer.getData('text/plain');
                if (!DOWNLOAD_FILENAME_TOKENS.includes(token)) return;

                const template = downloadFilenamePreferences.get(scope);
                const hoveredChip = event.target.closest('.igd-template-token');
                let insertAt = hoveredChip
                    ? [...row.querySelectorAll('.igd-template-token')].indexOf(hoveredChip)
                    : template.length;
                if (
                    hoveredChip &&
                    event.clientX > hoveredChip.getBoundingClientRect().left + hoveredChip.offsetWidth / 2
                ) {
                    insertAt++;
                }
                const existingIndex = template.indexOf(token);
                if (existingIndex >= 0) {
                    template.splice(existingIndex, 1);
                    if (existingIndex < insertAt) insertAt--;
                }
                template.splice(Math.max(0, insertAt), 0, token);
                saveTemplate(scope, template);
                dragged = null;
            });
            row.addEventListener('dragend', () => {
                dragged = null;
                row.classList.remove('igd-template-row-dragover');
            });
            row.addEventListener('click', (event) => {
                const removeButton = event.target.closest('.igd-template-token button');
                if (!removeButton) return;
                const token = removeButton.closest('.igd-template-token').dataset.token;
                const template = downloadFilenamePreferences.get(scope).filter((item) => item !== token);
                if (template.length) saveTemplate(scope, template);
            });
        });

        overlay.querySelectorAll('.igd-template-palette-token').forEach((chip) => {
            chip.addEventListener('dragstart', (event) => {
                dragged = { token: chip.dataset.token, scope: null, index: -1 };
                event.dataTransfer.effectAllowed = 'copy';
                event.dataTransfer.setData('text/plain', chip.dataset.token);
            });
            chip.addEventListener('dragend', () => {
                dragged = null;
            });
            chip.addEventListener('click', () => {
                const template = downloadFilenamePreferences.get(activeScope);
                if (!template.includes(chip.dataset.token)) template.push(chip.dataset.token);
                saveTemplate(activeScope, template);
            });
        });

        overlay.querySelectorAll('.igd-template-reset').forEach((button) => {
            button.addEventListener('click', () => {
                downloadFilenamePreferences.reset(button.dataset.scope);
                renderFilenameRow(overlay, button.dataset.scope);
            });
        });

        const dateFormatSelect = overlay.querySelector('.igd-date-format-select');
        dateFormatSelect.value = downloadFilenamePreferences.dateFormat;
        dateFormatSelect.addEventListener('change', () => {
            downloadFilenamePreferences.setDateFormat(dateFormatSelect.value);
            Object.values(DOWNLOAD_FILENAME_SCOPES).forEach((scope) => renderFilenameRow(overlay, scope));
        });

        Object.values(DOWNLOAD_FILENAME_SCOPES).forEach((scope) => renderFilenameRow(overlay, scope));
        selectScope(activeScope);
    }

    function createSettingsModal() {
        const overlay = document.createElement('div');
        overlay.className = MODAL_CLASS;
        overlay.hidden = true;
        overlay.innerHTML = `
            <section class="igd-settings-dialog" dir="ltr" lang="en" role="dialog" aria-modal="true" aria-labelledby="igd-settings-title">
                <header class="igd-settings-header">
                    <div>
                        <h2 id="igd-settings-title">Instagram Downloader</h2>
                        <p>Customize your download experience</p>
                    </div>
                    <button type="button" class="igd-settings-close" aria-label="Close settings">&times;</button>
                </header>
                <div class="igd-settings-content">
                    <section class="igd-settings-section">
                        <h3>Download button style</h3>
                        <div class="igd-settings-options" role="radiogroup" aria-label="Download button style">
                            <label class="igd-settings-option">
                                <input type="radio" name="igd-download-ui-mode" value="inline">
                                <span class="igd-settings-radio"></span>
                                <span>
                                    <strong>Modern</strong>
                                    <small>Download buttons directly on posts and stories</small>
                                </span>
                            </label>
                            <label class="igd-settings-option">
                                <input type="radio" name="igd-download-ui-mode" value="panel">
                                <span class="igd-settings-radio"></span>
                                <span>
                                    <strong>Legacy</strong>
                                    <small>Classic Download button with the media panel</small>
                                </span>
                            </label>
                            <label class="igd-settings-option">
                                <input type="radio" name="igd-download-ui-mode" value="both">
                                <span class="igd-settings-radio"></span>
                                <span>
                                    <strong>Both</strong>
                                    <small>Show Modern and Legacy controls together</small>
                                </span>
                            </label>
                        </div>
                    </section>
                    <section class="igd-settings-section igd-filename-settings">
                        <h3>File name templates</h3>
                        <p class="igd-settings-help">Drag variables into a row or click one to add it to the active row. Underscores are added automatically; unavailable values are skipped.</p>
                        <label class="igd-date-format-setting">
                            <span>Date format</span>
                            <select class="igd-date-format-select" aria-label="Date format">
                                ${DOWNLOAD_DATE_FORMATS.map(
                                    (format) =>
                                        `<option value="${format}">${format} — ${DATE_FORMAT_EXAMPLES[format]}</option>`,
                                ).join('')}
                            </select>
                            <small>Uses the Instagram publication date</small>
                        </label>
                        <div class="igd-template-palette" aria-label="Available file name variables">
                            ${DOWNLOAD_FILENAME_TOKENS.map(
                                (token) =>
                                    `<button type="button" class="igd-template-palette-token${
                                        DOWNLOAD_FILENAME_SINGLE_ONLY_TOKENS.includes(token)
                                            ? ' igd-template-palette-token-single-only'
                                            : ''
                                    }" draggable="true" data-token="${token}" title="${
                                        DOWNLOAD_FILENAME_SINGLE_ONLY_TOKENS.includes(token)
                                            ? 'Used for single-file names only; omitted from the ZIP archive name'
                                            : ''
                                    }">#${token}</button>`,
                            ).join('')}
                        </div>
                        <p class="igd-template-scope-note"><strong>Single-file only:</strong> #original_filename, #resolution, #video_bitrate and #video_codec are used for individual media names (including files inside a ZIP), but are omitted from the ZIP archive name.</p>
                        <div class="igd-template-groups">
                            ${Object.entries(FILENAME_SCOPE_LABELS)
                                .map(
                                    ([scope, label]) => `
                                    <div class="igd-template-group">
                                        <div class="igd-template-label">
                                            <strong>${label}</strong>
                                            <button type="button" class="igd-template-reset" data-scope="${scope}">Reset</button>
                                        </div>
                                        <div class="igd-template-row" data-scope="${scope}" tabindex="0" aria-label="${label} file name template"></div>
                                        <div class="igd-template-previews">
                                            <div class="igd-template-preview" data-scope="${scope}" data-kind="single"><span>Single file</span><code></code></div>
                                            <div class="igd-template-preview" data-scope="${scope}" data-kind="archive"><span>ZIP archive</span><code></code></div>
                                        </div>
                                    </div>`,
                                )
                                .join('')}
                        </div>
                    </section>
                </div>
            </section>`;

        function closeModal() {
            overlay.hidden = true;
        }
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) closeModal();
        });
        overlay.querySelector('.igd-settings-close').addEventListener('click', closeModal);
        overlay.querySelectorAll('input[name="igd-download-ui-mode"]').forEach((input) => {
            input.addEventListener('change', () => downloadUiPreferences.setMode(input.value));
        });
        bindFilenameBuilder(overlay);
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !overlay.hidden) closeModal();
        });
        document.body.appendChild(overlay);
        return overlay;
    }

    function getSettingsModal() {
        return document.querySelector(`.${MODAL_CLASS}`) ?? createSettingsModal();
    }

    function openSettingsModal() {
        const modal = getSettingsModal();
        const selected = modal.querySelector(`input[value="${downloadUiPreferences.mode}"]`);
        if (selected) selected.checked = true;
        const dateFormatSelect = modal.querySelector('.igd-date-format-select');
        if (dateFormatSelect) dateFormatSelect.value = downloadFilenamePreferences.dateFormat;
        Object.values(DOWNLOAD_FILENAME_SCOPES).forEach((scope) => renderFilenameRow(modal, scope));
        modal.hidden = false;
        modal.querySelector('.igd-settings-close').focus();
    }

    function isSidebarProfileCandidate(link) {
        const rect = link.getBoundingClientRect();
        const nearViewportEdge = rect.left < 100 || window.innerWidth - rect.right < 100;
        if (!nearViewportEdge || rect.width < 40 || rect.height < 48) return false;
        if (link.origin !== window.location.origin) return false;
        const path = new URL(link.href).pathname;
        return !RESERVED_SIDEBAR_PATHS.has(path) && /^\/[A-Za-z0-9._]+\/?$/.test(path);
    }

    function findSidebarProfileLink() {
        const candidates = [...document.querySelectorAll('a[href]')].filter(isSidebarProfileCandidate);
        return candidates.find((link) => link.querySelector('img')) ?? candidates[0] ?? null;
    }

    function findNavigationContainer(profileLink) {
        let container = profileLink.parentElement;
        while (container && container !== document.body) {
            const rect = container.getBoundingClientRect();
            const nearViewportEdge = rect.left < 100 || window.innerWidth - rect.right < 100;
            if (container.children.length >= 5 && rect.height > 300 && nearViewportEdge) return container;
            container = container.parentElement;
        }
        return null;
    }

    function findDirectChild(container, descendant) {
        let child = descendant;
        while (child?.parentElement && child.parentElement !== container) child = child.parentElement;
        return child?.parentElement === container ? child : null;
    }

    function createSettingsNavItem() {
        const item = document.createElement('div');
        item.className = NAV_ITEM_CLASS;
        item.innerHTML = `
            <button type="button" class="igd-settings-nav-button" aria-label="Downloader settings" title="Downloader settings">
                <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24">
                    <path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h10M18 18h2"></path>
                    <circle cx="16" cy="6" r="2"></circle>
                    <circle cx="8" cy="12" r="2"></circle>
                    <circle cx="16" cy="18" r="2"></circle>
                </svg>
                <span>Downloader settings</span>
            </button>`;
        item.querySelector('button').addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            openSettingsModal();
        });
        return item;
    }

    function syncSettingsNavItem() {
        const existing = document.querySelector(`.${NAV_ITEM_CLASS}`);
        const profileLink = findSidebarProfileLink();
        const navigation = profileLink && findNavigationContainer(profileLink);
        const profileItem = navigation && findDirectChild(navigation, profileLink);
        if (!profileItem || !navigation) return;

        if (existing?.parentElement === navigation && profileItem.nextElementSibling === existing) return;
        existing?.remove();
        profileItem.insertAdjacentElement('afterend', createSettingsNavItem());
    }

    function queueUpdate() {
        if (updateQueued) return;
        updateQueued = true;
        requestAnimationFrame(() => {
            updateQueued = false;
            syncSettingsNavItem();
        });
    }

    function initializeSettingsUi() {
        if (initialized) return true;
        if (!document.body) return false;
        initialized = true;

        const observer = new MutationObserver(queueUpdate);
        observer.observe(document.body, { childList: true, subtree: true });
        window.navigation?.addEventListener('navigate', queueUpdate);
        window.addEventListener('downloadUiModeChange', () => {
            const modal = document.querySelector(`.${MODAL_CLASS}`);
            const selected = modal?.querySelector(`input[value="${downloadUiPreferences.mode}"]`);
            if (selected) selected.checked = true;
        });
        getSettingsModal();
        queueUpdate();
        return true;
    }

    if (!initializeSettingsUi()) {
        const startupObserver = new MutationObserver(() => {
            if (!initializeSettingsUi()) return;
            startupObserver.disconnect();
        });
        if (document.documentElement) startupObserver.observe(document.documentElement, { childList: true });
        document.addEventListener(
            'DOMContentLoaded',
            () => {
                initializeSettingsUi();
                startupObserver.disconnect();
            },
            { once: true },
        );
    }
})();
