(() => {
    const BUTTON_CLASS = 'igd-post-inline-download';
    const DOWNLOAD_ALL_BUTTON_CLASS = 'igd-post-inline-download-all';
    const OWN_BUTTONS = `.${BUTTON_CLASS}, .${DOWNLOAD_ALL_BUTTON_CLASS}`;
    let updateQueued = false;

    function isSupportedView() {
        return window.location.pathname === '/' || IG_POST_REGEX.test(window.location.pathname);
    }

    function isVisible(element) {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }

    // Icon geometry is independent of Instagram's translated accessibility labels.
    // Keep the label fallback for older icon variants.
    function isShareIcon(icon) {
        const path = icon.querySelector('path')?.getAttribute('d') ?? '';
        return path.startsWith('M13.973 20.046') || ['Share', 'Share Post'].includes(icon.getAttribute('aria-label'));
    }

    function findPostActionTargets() {
        const targets = [];
        const handledRoots = new Set();
        for (const icon of document.querySelectorAll('svg[aria-label]')) {
            if (!isShareIcon(icon) || !isVisible(icon)) continue;
            const shareButton = icon.closest('button, [role="button"]');
            if (!shareButton) continue;
            const root = getPostRoot(shareButton);
            if (handledRoots.has(root) || (root === document && !IG_POST_REGEX.test(location.pathname))) continue;

            // Stop at the innermost horizontal action group. The outer grid has
            // a separate Save cell: inserting a new child there creates a new row.
            let container = shareButton.parentElement;
            while (container && container !== root && container !== document.body) {
                const style = getComputedStyle(container);
                if (style.display === 'grid' || style.display === 'inline-grid') break;
                const icons = [...container.querySelectorAll('svg[aria-label]')].filter(
                    (item) => !item.closest(OWN_BUTTONS),
                );
                if (
                    ['flex', 'inline-flex'].includes(style.display) &&
                    ['row', 'row-reverse'].includes(style.flexDirection) &&
                    icons.length >= 3 &&
                    icons.length <= 6
                ) {
                    handledRoots.add(root);
                    targets.push({ actionsContainer: container, shareButton });
                    break;
                }
                container = container.parentElement;
            }
        }
        return targets;
    }

    function findDirectChild(container, descendant) {
        let child = descendant;
        while (child?.parentElement && child.parentElement !== container) child = child.parentElement;
        return child?.parentElement === container ? child : null;
    }

    function getPostRoot(shareButton) {
        return shareButton.closest('article') ?? document;
    }

    function extractShortcode(href) {
        const path = new URL(href, window.location.origin).pathname;
        const match = path.match(/\/(?:p|tv|reel|reels)\/([A-Za-z0-9_-]+)/);
        if (!match || ['audio', 'liked_by'].includes(match[1])) return '';
        return match[1];
    }

    function getPostShortcode(root) {
        if (root === document) return window.location.pathname.match(IG_POST_REGEX)?.[2] ?? '';

        const links = [...root.querySelectorAll('a[href]')];
        const postLink = links.find((link) => /\/p\/[A-Za-z0-9_-]+/.test(link.getAttribute('href') ?? ''));
        if (postLink) return extractShortcode(postLink.getAttribute('href'));

        for (const mediaLink of links) {
            const href = mediaLink.getAttribute('href') ?? '';
            if (!/\/(?:tv|reel|reels)\/[A-Za-z0-9_-]+/.test(href)) continue;
            const shortcode = extractShortcode(href);
            if (shortcode) return shortcode;
        }

        return window.location.pathname.match(IG_POST_REGEX)?.[2] ?? '';
    }

    function isCarouselPost(root) {
        const activeSlide = root.querySelector('button[aria-current="step"]');
        if (getSlideButtons(activeSlide).length > 1) return true;

        const media = [...root.querySelectorAll('img, video')]
            .filter(isVisible)
            .map((element) => element.getBoundingClientRect())
            .filter((rect) => rect.width >= 200 && rect.height >= 200 && rect.bottom > 0 && rect.top < innerHeight);
        if (!media.length) return false;

        const largestArea = Math.max(...media.map((rect) => rect.width * rect.height));
        const mainMedia = media.filter((rect) => rect.width * rect.height >= largestArea * 0.65);
        const controls = [...root.querySelectorAll('button, [role="button"]')].filter((element) => {
            if (!isVisible(element) || element.closest(`.${BUTTON_CLASS}, .${DOWNLOAD_ALL_BUTTON_CLASS}`)) return false;
            const rect = element.getBoundingClientRect();
            if (rect.width > 64 || rect.height > 64) return false;
            return mainMedia.some((mediaRect) => {
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;
                const nearHorizontalEdge =
                    Math.abs(centerX - mediaRect.left) <= 48 || Math.abs(centerX - mediaRect.right) <= 48;
                const nearVerticalCenter =
                    Math.abs(centerY - (mediaRect.top + mediaRect.height / 2)) <= mediaRect.height * 0.25;
                return nearHorizontalEdge && nearVerticalCenter;
            });
        });

        return controls.some((control) => {
            const rect = control.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            return mainMedia.some(
                (mediaRect) =>
                    centerX >= mediaRect.left &&
                    centerX <= mediaRect.right &&
                    centerY >= mediaRect.top &&
                    centerY <= mediaRect.bottom,
            );
        });
    }

    function getSlideButtons(activeSlide) {
        if (!activeSlide) return [];
        let container = activeSlide.parentElement;
        while (container && container !== document.body) {
            const buttons = [...container.querySelectorAll('button')].filter((button) => {
                const rect = button.getBoundingClientRect();
                return isVisible(button) && rect.width <= 32 && rect.height <= 32;
            });
            if (buttons.length > 1 && buttons.length <= 20 && buttons.includes(activeSlide)) return buttons;
            container = container.parentElement;
        }
        return [];
    }

    function getCurrentPostMediaIndex(root) {
        const activeSlide = root.querySelector('button[aria-current="step"]');
        const slideButtons = getSlideButtons(activeSlide);
        const activeIndex = slideButtons.indexOf(activeSlide);
        if (activeIndex >= 0) return activeIndex;

        const urlIndex = Number(new URL(window.location.href).searchParams.get('img_index'));
        return Number.isInteger(urlIndex) && urlIndex > 0 ? urlIndex - 1 : 0;
    }

    function createPostDownloadButton({ downloadAll, root, shortcode }) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = downloadAll ? DOWNLOAD_ALL_BUTTON_CLASS : BUTTON_CLASS;
        button.dataset.postShortcode = shortcode;
        button.title = downloadAll ? 'Download all post media as ZIP' : 'Download current post media';
        button.setAttribute(
            'aria-label',
            downloadAll ? 'Download all post media as ZIP' : 'Download current post media',
        );
        button.innerHTML = downloadAll
            ? `<svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24">
                    <path d="M4 4h16v4H4zM5 8h14v12H5zM12 10v6m0 0 3-3m-3 3-3-3" />
               </svg>`
            : `<svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24">
                    <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 19h14" />
               </svg>`;
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            downloadInlineMedia({
                button,
                type: 'post',
                downloadAll,
                index: downloadAll ? 0 : getCurrentPostMediaIndex(root),
                shortcode,
            });
        });
        return button;
    }

    function findOwnButton(container, className) {
        return [...container.children].find((element) => element.classList.contains(className)) ?? null;
    }

    function syncPostDownloadButtons() {
        const activeButtons = new Set();
        const existingButtons = document.querySelectorAll(`.${BUTTON_CLASS}, .${DOWNLOAD_ALL_BUTTON_CLASS}`);
        if (!isSupportedView() || !downloadUiPreferences.shows('inline')) {
            existingButtons.forEach((button) => button.remove());
            return;
        }

        const handledContainers = new Set();
        for (const { actionsContainer, shareButton } of findPostActionTargets()) {
            if (!actionsContainer || handledContainers.has(actionsContainer)) continue;
            handledContainers.add(actionsContainer);

            const shareItem = findDirectChild(actionsContainer, shareButton);
            const root = getPostRoot(shareButton);
            const shortcode = getPostShortcode(root);
            if (!shareItem || !shortcode) continue;

            let singleButton = findOwnButton(actionsContainer, BUTTON_CLASS);
            if (!singleButton || singleButton.dataset.postShortcode !== shortcode) {
                singleButton?.remove();
                singleButton = createPostDownloadButton({ downloadAll: false, root, shortcode });
            }
            activeButtons.add(singleButton);

            let downloadAllButton = findOwnButton(actionsContainer, DOWNLOAD_ALL_BUTTON_CLASS);
            if (isCarouselPost(root)) {
                if (!downloadAllButton || downloadAllButton.dataset.postShortcode !== shortcode) {
                    downloadAllButton?.remove();
                    downloadAllButton = createPostDownloadButton({ downloadAll: true, root, shortcode });
                }
                activeButtons.add(downloadAllButton);
                if (shareItem.nextElementSibling !== downloadAllButton) {
                    shareItem.insertAdjacentElement('afterend', downloadAllButton);
                }
                if (downloadAllButton.nextElementSibling !== singleButton) {
                    downloadAllButton.insertAdjacentElement('afterend', singleButton);
                }
            } else {
                downloadAllButton?.remove();
                if (shareItem.nextElementSibling !== singleButton) {
                    shareItem.insertAdjacentElement('afterend', singleButton);
                }
            }
        }

        existingButtons.forEach((button) => {
            if (!activeButtons.has(button)) button.remove();
        });
    }

    function queueUpdate() {
        if (updateQueued) return;
        updateQueued = true;
        requestAnimationFrame(() => {
            updateQueued = false;
            // Our insertions must not schedule another layout pass.
            observer.disconnect();
            try {
                syncPostDownloadButtons();
            } finally {
                observePage();
            }
        });
    }

    const observer = new MutationObserver((records) => {
        if (records.some((record) => !record.target.closest?.(OWN_BUTTONS))) queueUpdate();
    });
    function observePage() {
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['aria-current'],
        });
    }
    observePage();
    window.addEventListener('downloadUiModeChange', queueUpdate);
    navigation.addEventListener('navigate', queueUpdate);
    queueUpdate();
})();
