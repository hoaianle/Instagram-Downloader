(() => {
    const IG_POST_REGEX_MAIN = /\/(p|tv|reel|reels)\/([A-Za-z0-9_-]*)(\/?)/;
    let nextContainerId = 0;

    // Full teardown on every SPA navigation, before the per-context handlers
    // further down re-observe for whatever the new URL actually needs.
    // Registered first so it runs before their own 'navigate' listeners
    // (listeners fire in registration order for the same target/type). The
    // functions/observers referenced here are only *called* once 'navigate'
    // actually fires, by which point the whole script below has finished
    // initializing them.
    navigation.addEventListener('navigate', () => {
        feedObserver.disconnect();
        feedIntersectionObserver.disconnect();
        gridObserver.disconnect();
        gridIntersectionObserver.disconnect();
        reelsObserver.disconnect();
        storiesObserver.disconnect();
        window.removeEventListener('scroll', debouncedFeedScan);
    });
    /** containerId => the button element, so results can update it */
    const buttonRegistry = new Map();

    function createDownloadButton() {
        const button = document.createElement('button');
        button.className = 'igd-media-download-btn';
        button.type = 'button';
        button.title = 'Download';
        button.innerHTML =
            '<svg viewBox="0 0 24 24"><path d="M12 3v10.5m0 0-4-4m4 4 4-4M5 19h14" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        return button;
    }

    function setButtonState(button, state) {
        button.classList.remove('igd-loading', 'igd-success', 'igd-error');
        if (state !== 'idle') button.classList.add(`igd-${state}`);
    }

    function requestDownload(button, detailWithoutId) {
        const containerId = `igd-${nextContainerId++}`;
        buttonRegistry.set(containerId, button);
        setButtonState(button, 'loading');
        window.dispatchEvent(
            new CustomEvent('mediaOverlayDownload', {
                detail: { containerId, ...detailWithoutId },
            }),
        );
    }

    window.addEventListener('mediaOverlayDownloadResult', (e) => {
        const { containerId, status } = e.detail;
        const button = buttonRegistry.get(containerId);
        if (!button) return;
        setButtonState(button, status);
        setTimeout(() => setButtonState(button, 'idle'), 1500);
        buttonRegistry.delete(containerId);
    });

    /**
     * Removes any previously-attached anchor/button inside `scopeEl` other
     * than `keepAnchor`. Needed because the "best" media element can change
     * across rescans of the same scope (e.g. a story's real video mounts a
     * moment after its avatar was the only thing rendered yet, or Instagram
     * swaps the DOM node for a new carousel slide) - without this, the old,
     * now-wrong anchor would keep its button forever since attaching is
     * normally a one-time, idempotent operation per container.
     */
    function cleanupStaleAnchors(scopeEl, keepAnchor) {
        scopeEl.querySelectorAll('.igd-media-anchor').forEach((el) => {
            if (el === keepAnchor) return;
            el.classList.remove('igd-media-anchor');
            const staleBtn = el.querySelector(':scope > .igd-media-download-btn');
            if (staleBtn) staleBtn.remove();
        });
    }

    /**
     * Attaches a download button to `mediaContainer` (the element that gets
     * position:relative so the button anchors top-left of the media, not the
     * page) unless one is already attached.
     *
     * `resolveDetail` is called at click time (not attach time) so it always
     * reflects the currently-visible slide/frame.
     */
    function attachOverlayButton(mediaContainer, resolveDetail, extraButtonClass) {
        if (mediaContainer.querySelector(':scope > .igd-media-download-btn')) return;
        mediaContainer.classList.add('igd-media-anchor');
        const button = createDownloadButton();
        if (extraButtonClass) button.classList.add(extraButtonClass);
        button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const detail = resolveDetail();
            if (!detail) return;
            requestDownload(button, detail);
        });
        mediaContainer.appendChild(button);
    }

    /**
     * Finds the currently-visible media element inside `scopeEl` for a
     * non-carousel post/frame (single image/video). Picks the largest
     * rendered `<img>`/`<video>`, which reliably beats small decorative
     * images (e.g. the poster's avatar) - safe here specifically because
     * there's only ever one real piece of media to find.
     */
    function findActiveMediaElement(scopeEl) {
        const candidates = Array.from(scopeEl.querySelectorAll('video, img'));
        let best = null;
        let bestArea = 0;
        candidates.forEach((el) => {
            const rect = el.getBoundingClientRect();
            const area = rect.width * rect.height;
            if (area > bestArea) {
                bestArea = area;
                best = el;
            }
        });
        return best;
    }

    /**
     * Finds the currently-active slide's media element for a carousel post.
     * Instagram can render several neighboring slides at full natural size
     * simultaneously (just translated out of the visible clipping area), so
     * "largest rendered area" alone can't tell them apart - only the slide
     * whose `<li>` sits at `transform: translateX(0` is actually the one on
     * screen. Falls back to `findActiveMediaElement` for non-carousel posts
     * (no `<ul>` at all).
     */
    function findActiveSlideMediaElement(scopeEl) {
        const ul = scopeEl.querySelector('ul');
        if (ul) {
            const activeLi = Array.from(ul.querySelectorAll('li')).find((li) =>
                (li.getAttribute('style') || '').includes('translateX(0'),
            );
            const mediaEl = activeLi ? activeLi.querySelector('img, video') : null;
            if (mediaEl) return mediaEl;
        }
        return findActiveMediaElement(scopeEl);
    }

    /**
     * Carousel dot indicators (aria-label="Go to slide N") expose an
     * absolute, 0-indexed slide position via `aria-current="step"` on the
     * active one - this is a more reliable index source than inferring it
     * from `<li>` transforms, which can go stale immediately after the user
     * advances the carousel (Instagram doesn't always re-render `<li>`
     * offsets synchronously with the click). Not every context renders
     * these dots (e.g. the dedicated post page doesn't), so callers must
     * still fall back to `findActiveSlideMediaElement`'s pk-based guess.
     */
    function resolveDotIndex(scopeEl) {
        const dots = Array.from(scopeEl.querySelectorAll('button[aria-label^="Go to slide"]'));
        if (dots.length === 0) return null;
        const activeIndex = dots.findIndex((dot) => dot.getAttribute('aria-current') === 'step');
        return activeIndex === -1 ? null : activeIndex;
    }

    /**
     * Instagram wraps media in several layers of zero/near-zero-width
     * carousel-transform divs. Walk up from `startEl`'s parent until finding
     * an ancestor that's both sized like the visible media AND not the
     * `<img>`/`<video>` itself - those are replaced elements that never
     * render appended child nodes, so an anchor on the media tag directly
     * would leave the button in the DOM but permanently invisible.
     */
    function findSizedAnchor(startEl) {
        let el = startEl.parentElement;
        for (let i = 0; i < 8 && el; i++) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 10 && rect.height > 10) return el;
            el = el.parentElement;
        }
        return startEl.parentElement || startEl;
    }

    /**
     * Dedicated post/reel page (/p/:code, /reel/:code, /tv/:code, /reels/:code)
     * and the post modal opened from feed/grid/explore both expose the current
     * post's shortcode directly in the URL, so no ReactFiber lookup is needed
     * to identify which post is showing.
     */
    function scanPostPageOrModal() {
        const match = window.location.pathname.match(IG_POST_REGEX_MAIN);
        if (!match) return;
        const shortcode = match[2];
        const dialog = document.querySelector('div[role="dialog"]');
        const scope = dialog || document.querySelector('main');
        if (!scope) return;
        const mediaEl = findActiveSlideMediaElement(scope);
        if (!mediaEl) return;
        const anchor = findSizedAnchor(mediaEl);
        cleanupStaleAnchors(scope, anchor);
        attachOverlayButton(anchor, () => {
            const dotIndex = resolveDotIndex(scope);
            return {
                kind: 'post',
                shortcode,
                mediaId: dotIndex === null ? getValueByKey(findActiveSlideMediaElement(scope), 'pk') : null,
                index: dotIndex === null ? 0 : dotIndex,
            };
        });
    }

    const postPageObserver = new MutationObserver(scanPostPageOrModal);
    postPageObserver.observe(document.body, { childList: true, subtree: true });
    scanPostPageOrModal();

    /**
     * Home feed: unlike the dedicated page/modal, the URL stays "/" no matter
     * which post is showing, so each article's shortcode has to come from its
     * own ReactFiber (same lookup home-scroll-handler.js already relies on).
     */
    function scanPostArticle(article) {
        const postInfo = getValueByKey(article, 'queryReference');
        if (!postInfo || !postInfo.code) return;
        const mediaEl = findActiveSlideMediaElement(article);
        if (!mediaEl) return;
        const anchor = findSizedAnchor(mediaEl);
        cleanupStaleAnchors(article, anchor);
        attachOverlayButton(anchor, () => {
            const dotIndex = resolveDotIndex(article);
            return {
                kind: 'post',
                shortcode: postInfo.code,
                mediaId: dotIndex === null ? getValueByKey(findActiveSlideMediaElement(article), 'pk') : null,
                index: dotIndex === null ? 0 : dotIndex,
            };
        });
    }

    function debounce(fn, delay) {
        let timeoutId;
        return (...args) => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => fn(...args), delay);
        };
    }

    // Feed can accumulate hundreds of loaded posts as the user scrolls, so
    // only attach buttons to articles near the viewport (±1 screen), and
    // never re-run the full-post detection logic for ones far off-screen.
    const feedIntersectionObserver = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) scanPostArticle(entry.target);
            });
        },
        { rootMargin: '100% 0px 100% 0px' },
    );

    function observeNewArticles(main) {
        main.querySelectorAll('article').forEach((article) => {
            if (article.dataset.igdObserved) {
                // Already tracked: re-scan directly rather than waiting on
                // another intersection change, since Instagram can replace
                // the carousel's active <li>/media node (e.g. on slide
                // navigation) without the article itself entering/leaving
                // the viewport, which would otherwise leave the button gone.
                scanPostArticle(article);
                return;
            }
            article.dataset.igdObserved = 'true';
            feedIntersectionObserver.observe(article);
        });
    }

    function scanFeedArticles() {
        const main = document.querySelector('main');
        if (!main) return;
        observeNewArticles(main);
    }

    const debouncedFeedScan = debounce(scanFeedArticles, Math.floor(1000 / 60));
    const feedObserver = new MutationObserver(debouncedFeedScan);

    function startFeedScan() {
        const main = document.querySelector('main');
        if (!main) return;
        feedObserver.observe(main, { childList: true, subtree: true });
        window.addEventListener('scroll', debouncedFeedScan);
        scanFeedArticles();
    }

    function stopFeedScan() {
        feedObserver.disconnect();
        window.removeEventListener('scroll', debouncedFeedScan);
    }

    navigation.addEventListener('navigate', (e) => {
        const url = new URL(e.destination.url);
        if (url.pathname === '/') startFeedScan();
        else stopFeedScan();
    });
    if (window.location.pathname === '/') startFeedScan();

    /**
     * Profile grid & Explore grid: thumbnails are plain <a href="/.../p/:code/">
     * links with no visible carousel navigation, so the shortcode comes
     * straight from the href and the download is always the cover (index 0).
     */
    function extractShortcodeFromHref(href) {
        const match = new URL(href, window.location.origin).pathname.match(IG_POST_REGEX_MAIN);
        return match ? match[2] : null;
    }

    function attachGridLink(link) {
        const shortcode = extractShortcodeFromHref(link.href);
        if (!shortcode) return;
        if (!link.querySelector('img, video')) return;
        attachOverlayButton(link, () => ({
            kind: 'post',
            shortcode,
            mediaId: null,
            index: 0,
        }));
    }

    const gridIntersectionObserver = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) attachGridLink(entry.target);
            });
        },
        { rootMargin: '100% 0px 100% 0px' },
    );

    function scanGridLinks() {
        document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]').forEach((link) => {
            if (link.dataset.igdObserved) return;
            link.dataset.igdObserved = 'true';
            gridIntersectionObserver.observe(link);
        });
    }

    const gridObserver = new MutationObserver(debounce(scanGridLinks, Math.floor(1000 / 60)));
    gridObserver.observe(document.body, { childList: true, subtree: true });
    scanGridLinks();

    /**
     * Reels scroller (/reels/:code): always a single video, no carousel, so
     * the index is always 0. Identified the same way reels-scroll-handler.js
     * already does, via the PolarisClipsViewer_media_identifier fiber key.
     */
    function scanReelsPlayers() {
        document.querySelectorAll('main > div > div').forEach((reelContainer) => {
            const identifier = getValueByKey(reelContainer, 'PolarisClipsViewer_media_identifier');
            if (!identifier || !identifier.code) return;
            const video = reelContainer.querySelector('video');
            if (!video) return;
            attachOverlayButton(video.parentElement, () => ({
                kind: 'post',
                shortcode: identifier.code,
                mediaId: null,
                index: 0,
            }));
        });
    }

    const reelsObserver = new MutationObserver(debounce(scanReelsPlayers, Math.floor(1000 / 60)));

    navigation.addEventListener('navigate', (e) => {
        const url = new URL(e.destination.url);
        if (url.pathname.match(/\/(reels)\/([A-Za-z0-9_-]*)(\/?)/)) {
            reelsObserver.observe(document.body, { childList: true, subtree: true });
            scanReelsPlayers();
        } else {
            reelsObserver.disconnect();
        }
    });
    if (window.location.pathname.match(/\/(reels)\/([A-Za-z0-9_-]*)(\/?)/)) {
        reelsObserver.observe(document.body, { childList: true, subtree: true });
        scanReelsPlayers();
    }

    /**
     * Stories & Highlights: Instagram updates the URL to
     * /stories/:username/:framePk/ as you move between frames of the same
     * story, so (unlike posts) the active frame's pk can be read straight
     * from the pathname instead of any DOM/fiber inspection. On the very
     * first frame the pk segment isn't in the URL yet, which conveniently
     * matches the index-0 fallback. Highlights don't expose a frame pk this
     * way (their URL only carries the highlight id), so highlights always
     * fall back to index 0 (the first frame) - a known limitation.
     */
    const IG_STORY_REGEX_MAIN = /\/(stories)\/(.*?)\/(\d*)(\/?)/;
    const IG_HIGHLIGHT_REGEX_MAIN = /\/(stories)\/(highlights)\/(\d*)(\/?)/;

    function scanStoriesViewer() {
        if (!window.location.pathname.match(IG_STORY_REGEX_MAIN)) return;
        const section = Array.from(document.querySelectorAll('section')).pop();
        if (!section) return;
        const mediaEl = findActiveMediaElement(section);
        if (!mediaEl) return;
        const anchor = findSizedAnchor(mediaEl);
        cleanupStaleAnchors(section, anchor);
        const highlightMatch = window.location.pathname.match(IG_HIGHLIGHT_REGEX_MAIN);
        if (highlightMatch) {
            const highlightId = highlightMatch[3];
            attachOverlayButton(
                anchor,
                () => ({
                    kind: 'highlight',
                    highlightId,
                    mediaId: null,
                    index: 0,
                }),
                'igd-story-position',
            );
            return;
        }
        const username = getValueByKey(section, 'username');
        if (!username) return;
        attachOverlayButton(
            anchor,
            () => {
                const frameMatch = window.location.pathname.match(IG_STORY_REGEX_MAIN);
                return {
                    kind: 'stories',
                    username,
                    mediaId: frameMatch && frameMatch[3] ? frameMatch[3] : null,
                    index: 0,
                };
            },
            'igd-story-position',
        );
    }

    const storiesObserver = new MutationObserver(debounce(scanStoriesViewer, Math.floor(1000 / 60)));

    navigation.addEventListener('navigate', (e) => {
        const url = new URL(e.destination.url);
        if (url.pathname.match(IG_STORY_REGEX_MAIN)) {
            storiesObserver.observe(document.body, { childList: true, subtree: true });
            setTimeout(scanStoriesViewer, 0);
        } else {
            storiesObserver.disconnect();
        }
    });
    if (window.location.pathname.match(IG_STORY_REGEX_MAIN)) {
        storiesObserver.observe(document.body, { childList: true, subtree: true });
        scanStoriesViewer();
    }
})();
