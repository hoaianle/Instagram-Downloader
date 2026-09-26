(() => {
    const BUTTON_CLASS = 'igd-story-inline-download';
    const DOWNLOAD_ALL_BUTTON_CLASS = 'igd-story-inline-download-all';
    const STORY_PATH_PREFIX = '/stories/';
    let updateQueued = false;

    function isStoryView() {
        return window.location.pathname.startsWith(STORY_PATH_PREFIX);
    }

    function findLabelledStoryPlaybackButton() {
        const playbackIcon = document.querySelector('svg[aria-label="Play"], svg[aria-label="Pause"]');
        return playbackIcon?.closest('[role="button"]') ?? null;
    }

    function findDirectChild(container, descendant) {
        let child = descendant;
        while (child?.parentElement && child.parentElement !== container) child = child.parentElement;
        return child?.parentElement === container ? child : null;
    }

    function getToolbarButtons(toolbar) {
        const buttons = [];
        const seen = new Set();
        for (const icon of toolbar.querySelectorAll('svg[aria-label]')) {
            const button = icon.closest('button, [role="button"]');
            if (!button || seen.has(button) || button.closest(`.${BUTTON_CLASS}, .${DOWNLOAD_ALL_BUTTON_CLASS}`)) {
                continue;
            }
            const rect = button.getBoundingClientRect();
            if (rect.width <= 72 && rect.height <= 72 && rect.width > 0 && rect.height > 0) {
                seen.add(button);
                buttons.push(button);
            }
        }
        return buttons;
    }

    function findStoryControls() {
        const labelledPlaybackButton = findLabelledStoryPlaybackButton();
        const labelledWrapper = labelledPlaybackButton?.parentElement;
        const labelledToolbar = labelledWrapper?.parentElement;
        if (labelledToolbar && getStoryItemCount(labelledToolbar) > 0) {
            return {
                playbackButton: labelledPlaybackButton,
                playbackWrapper: labelledWrapper,
                toolbar: labelledToolbar,
            };
        }

        const nativeButtons = [...document.querySelectorAll('button, [role="button"]')];
        for (const nativeButton of nativeButtons) {
            let toolbar = nativeButton.parentElement;
            while (toolbar && toolbar !== document.body) {
                if (getStoryItemCount(toolbar) > 0) {
                    const toolbarButtons = getToolbarButtons(toolbar);
                    if (toolbarButtons.length >= 2) {
                        const playbackButton = toolbarButtons.at(-2);
                        const playbackWrapper = findDirectChild(toolbar, playbackButton);
                        if (playbackWrapper) return { playbackButton, playbackWrapper, toolbar };
                    }
                }
                toolbar = toolbar.parentElement;
            }
        }

        return { playbackButton: null, playbackWrapper: null, toolbar: null };
    }

    function getCurrentStoryIndex(toolbar) {
        const segments = [...(toolbar.previousElementSibling?.children ?? [])];
        const activeIndex = segments.findIndex((segment) => segment.childElementCount > 0);
        if (activeIndex >= 0) return activeIndex;

        const firstPendingIndex = segments.findIndex(
            (segment) => getComputedStyle(segment).backgroundColor !== 'rgb(255, 255, 255)',
        );
        return firstPendingIndex >= 0 ? firstPendingIndex : Math.max(segments.length - 1, 0);
    }

    function getStoryDownloadOperationKey(downloadAll) {
        const pathParts = window.location.pathname.split('/').filter(Boolean);
        const isHighlight = pathParts[1] === 'highlights';
        const storyOwner = isHighlight ? pathParts[2] : pathParts[1];
        const type = isHighlight ? 'highlights' : 'stories';
        return `${type}:${storyOwner || 'current'}:${downloadAll ? 'all' : 'single'}`;
    }

    function createStoryButton({ className, title, ariaLabel, icon, downloadAll }) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.title = title;
        button.setAttribute('aria-label', ariaLabel);
        button.innerHTML = icon;
        button.dataset.downloadOperationKey = getStoryDownloadOperationKey(downloadAll);
        restoreInlineDownloadProgress(button);
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const type = window.location.pathname.startsWith('/stories/highlights/') ? 'highlights' : 'stories';
            const index = downloadAll ? 0 : getCurrentStoryIndex(button.parentElement);
            const operationKey = getStoryDownloadOperationKey(downloadAll);
            button.dataset.downloadOperationKey = operationKey;
            downloadInlineMedia({ button, type, downloadAll, index, operationKey });
        });
        return button;
    }

    function createStoryDownloadButton() {
        return createStoryButton({
            className: BUTTON_CLASS,
            title: 'Download story',
            ariaLabel: 'Download story',
            downloadAll: false,
            icon: `
                <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20">
                    <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 19h14" />
                </svg>`,
        });
    }

    function createDownloadAllStoriesButton() {
        return createStoryButton({
            className: DOWNLOAD_ALL_BUTTON_CLASS,
            title: 'Download all stories as ZIP',
            ariaLabel: 'Download all stories as ZIP',
            downloadAll: true,
            icon: `
                <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20">
                    <path d="M4 4h16v4H4zM5 8h14v12H5zM12 10v6m0 0 3-3m-3 3-3-3" />
                </svg>`,
        });
    }

    function getStoryItemCount(toolbar) {
        const progressBar = toolbar.previousElementSibling;
        if (!progressBar) return 0;

        const { height } = progressBar.getBoundingClientRect();
        if (height <= 0 || height > 6) return 0;
        return progressBar.children.length;
    }

    function syncStoryDownloadButton() {
        let existingButton = document.querySelector(`.${BUTTON_CLASS}`);
        let existingDownloadAllButton = document.querySelector(`.${DOWNLOAD_ALL_BUTTON_CLASS}`);
        if (!isStoryView() || !downloadUiPreferences.shows('inline')) {
            existingButton?.remove();
            existingDownloadAllButton?.remove();
            return;
        }

        const { playbackButton, playbackWrapper, toolbar } = findStoryControls();
        if (!playbackButton || !playbackWrapper || !toolbar) return;

        if (existingButton?.parentElement !== toolbar) {
            existingButton?.remove();
            existingButton = createStoryDownloadButton();
            playbackWrapper.insertAdjacentElement('beforebegin', existingButton);
        }

        if (getStoryItemCount(toolbar) > 1) {
            if (existingDownloadAllButton?.parentElement !== toolbar) {
                existingDownloadAllButton?.remove();
                existingDownloadAllButton = createDownloadAllStoriesButton();
            }
            if (existingDownloadAllButton.nextElementSibling !== existingButton) {
                existingButton.insertAdjacentElement('beforebegin', existingDownloadAllButton);
            }
        } else {
            existingDownloadAllButton?.remove();
        }
    }

    function queueUpdate() {
        if (updateQueued) return;
        updateQueued = true;
        requestAnimationFrame(() => {
            updateQueued = false;
            syncStoryDownloadButton();
        });
    }

    const observer = new MutationObserver(queueUpdate);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('downloadUiModeChange', queueUpdate);
    navigation.addEventListener('navigate', queueUpdate);
    queueUpdate();
})();
