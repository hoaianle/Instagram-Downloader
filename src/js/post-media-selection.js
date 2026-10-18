// Shared post selection primitives; view-specific entry points live in download-views/.
const postMediaSelection = (() => {
    const BUTTON_CLASS = 'igd-post-inline-download';
    const DOWNLOAD_ALL_BUTTON_CLASS = 'igd-post-inline-download-all';
    function isVisible(element) {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
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

    function getUrlCarouselIndex(shortcode) {
        const match = window.location.pathname.match(IG_POST_REGEX);
        if (!match || match[2] !== shortcode) return -1;
        const value = Number(new URL(window.location.href).searchParams.get('img_index'));
        return Number.isInteger(value) && value > 0 ? value - 1 : -1;
    }

    function getCarouselTrackIndex(media, shortcode) {
        const slide = media?.closest('li');
        if (!slide) return -1;

        const match = slide.style.transform.match(/translateX\((-?[\d.]+)px\)/);
        const slideWidth =
            slide.firstElementChild?.getBoundingClientRect().width || slide.getBoundingClientRect().width;
        if (!match || !Number.isFinite(slideWidth) || slideWidth <= 0) return -1;

        const position = Math.abs(Number(match[1])) / slideWidth;
        const index = Math.round(position);
        if (!Number.isFinite(position) || Math.abs(position - index) > 0.01) return -1;

        // The URL alone may be stale after SPA navigation, so only trust it when
        // the rendered carousel track independently reports the same index.
        return getUrlCarouselIndex(shortcode) === index ? index : -1;
    }

    function getCurrentPostMediaState(root, currentMedia, shortcode) {
        const activeSlide = root.querySelector('button[aria-current="step"]');
        const slideButtons = getSlideButtons(activeSlide);
        const activeIndex = slideButtons.indexOf(activeSlide);
        if (activeIndex >= 0) {
            return { index: activeIndex, itemCount: slideButtons.length, indexConfident: true, indexSource: 'steps' };
        }

        if (!isCarouselPost(root)) {
            return { index: 0, itemCount: 1, indexConfident: true, indexSource: 'single' };
        }

        const trackIndex = getCarouselTrackIndex(currentMedia, shortcode);
        if (trackIndex >= 0) {
            return { index: trackIndex, itemCount: 0, indexConfident: true, indexSource: 'track' };
        }

        return { index: -1, itemCount: 0, indexConfident: false, indexSource: 'none' };
    }

    function getVisiblePostMedia(root) {
        const getClippedVisibleArea = (media) => {
            const rect = media.getBoundingClientRect();
            let left = Math.max(rect.left, 0);
            let top = Math.max(rect.top, 0);
            let right = Math.min(rect.right, innerWidth);
            let bottom = Math.min(rect.bottom, innerHeight);

            let container = media.parentElement;
            while (container && root.contains(container)) {
                const style = getComputedStyle(container);
                const containerRect = container.getBoundingClientRect();
                if (['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowX)) {
                    left = Math.max(left, containerRect.left);
                    right = Math.min(right, containerRect.right);
                }
                if (['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowY)) {
                    top = Math.max(top, containerRect.top);
                    bottom = Math.min(bottom, containerRect.bottom);
                }
                if (right <= left || bottom <= top) return 0;
                if (container === root) break;
                container = container.parentElement;
            }

            return Math.max(0, right - left) * Math.max(0, bottom - top);
        };

        const candidates = [...root.querySelectorAll('img, video')]
            .map((media) => {
                const rect = media.getBoundingClientRect();
                return { media, rect, visibleArea: getClippedVisibleArea(media) };
            })
            .filter(({ rect, visibleArea }) => rect.width >= 200 && rect.height >= 200 && visibleArea > 0)
            .sort((first, second) => second.visibleArea - first.visibleArea);
        return candidates[0]?.media ?? null;
    }

    function readPostSelection(root) {
        const shortcode = getPostShortcode(root);
        const currentMedia = getVisiblePostMedia(root);
        const mediaState = getCurrentPostMediaState(root, currentMedia, shortcode);
        return {
            shortcode,
            sourceUrl: currentMedia?.currentSrc || currentMedia?.src || '',
            posterUrl: currentMedia instanceof HTMLVideoElement ? currentMedia.poster || '' : '',
            ...mediaState,
        };
    }

    function postSelectionsMatch(first, second) {
        return (
            first.shortcode === second.shortcode &&
            first.sourceUrl === second.sourceUrl &&
            first.posterUrl === second.posterUrl &&
            first.index === second.index &&
            first.itemCount === second.itemCount &&
            first.indexSource === second.indexSource
        );
    }

    async function getStablePostSelection(root) {
        /**
         * During navigation, Instagram can update the URL, carousel/progress indicators, and visible media across separate render frames.
         * Retry briefly until two consecutive reads agree instead of failing on the first transitional frame.
         */
        let previous = readPostSelection(root);
        for (let attempt = 0; attempt < 5; attempt++) {
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const current = readPostSelection(root);
            if (postSelectionsMatch(previous, current)) {
                return {
                    ...current,
                    stable: true,
                    indexConfident: previous.indexConfident && current.indexConfident,
                };
            }
            previous = current;
        }
        return {
            ...previous,
            stable: false,
            indexConfident: false,
        };
    }

    return { getPostShortcode, isCarouselPost, getStablePostSelection };
})();

function resolveSelectedPostMedia(data, selection, shortcode) {
    if (!selection || selection.shortcode !== shortcode) return null;

    const mediaBySource =
        findMediaByRenderedUrl(data, selection.sourceUrl) ?? findMediaByRenderedUrl(data, selection.posterUrl);
    if (mediaBySource) return mediaBySource;

    if (!selection.stable) return null;

    const index = Number(selection.index);
    const itemCount = Number(selection.itemCount);
    const indexMatchesMedia = selection.indexSource === 'track' || itemCount === data.media.length;
    const mediaByIndex =
        selection.indexConfident &&
        Number.isInteger(index) &&
        index >= 0 &&
        index < data.media.length &&
        indexMatchesMedia
            ? data.media[index]
            : null;

    return mediaByIndex;
}
