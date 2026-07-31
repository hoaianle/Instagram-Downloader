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
     * Attaches a download button to `mediaContainer` (the element that gets
     * position:relative so the button anchors top-left of the media, not the
     * page) unless one is already attached.
     *
     * `resolveDetail` is called at click time (not attach time) so it always
     * reflects the currently-visible slide/frame.
     */
    function attachOverlayButton(mediaContainer, resolveDetail) {
        if (mediaContainer.querySelector(':scope > .igd-media-download-btn')) return;
        mediaContainer.classList.add('igd-media-anchor');
        const button = createDownloadButton();
        button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const detail = resolveDetail();
            if (!detail) return;
            requestDownload(button, detail);
        });
        // Touch fallback: first tap reveals the button instead of triggering
        // Instagram's own handler underneath.
        let touchRevealed = false;
        mediaContainer.addEventListener(
            'touchstart',
            () => {
                if (touchRevealed) return;
                touchRevealed = true;
                button.classList.add('igd-touch-visible');
                setTimeout(() => {
                    touchRevealed = false;
                    button.classList.remove('igd-touch-visible');
                }, 3000);
            },
            { passive: true },
        );
        mediaContainer.appendChild(button);
    }

    /**
     * Finds the pk of the currently-visible slide inside `scopeEl`'s carousel
     * (if any). Instagram virtualizes carousel slides as `<li>` elements
     * inside a `<ul>`, positioning the active one at `transform: translateX(0`
     * and the others off to the sides. The active slide's own `<img>`/`<video>`
     * carries its media `pk` directly on its React fiber.
     */
    function resolveActiveMediaId(scopeEl) {
        const ul = scopeEl.querySelector('ul');
        if (!ul) return null;
        const activeLi = Array.from(ul.querySelectorAll('li')).find((li) =>
            (li.getAttribute('style') || '').includes('translateX(0'),
        );
        if (!activeLi) return null;
        const mediaEl = activeLi.querySelector('img, video');
        return mediaEl ? getValueByKey(mediaEl, 'pk') : null;
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
        const ul = scope.querySelector('ul');
        const anchor = ul ? ul.parentElement : null;
        if (!anchor) return;
        attachOverlayButton(anchor, () => ({
            kind: 'post',
            shortcode,
            mediaId: resolveActiveMediaId(scope),
            index: 0,
        }));
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
        const ul = article.querySelector('ul');
        const anchor = ul ? ul.parentElement : null;
        if (!anchor) return;
        attachOverlayButton(anchor, () => ({
            kind: 'post',
            shortcode: postInfo.code,
            mediaId: resolveActiveMediaId(article),
            index: 0,
        }));
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
            if (article.dataset.igdObserved) return;
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
        const video = section.querySelector('video');
        const bigImg = Array.from(section.querySelectorAll('img')).find(
            (img) => img.getBoundingClientRect().width > 100,
        );
        const mediaEl = video || bigImg;
        if (!mediaEl || !mediaEl.parentElement) return;
        const anchor = mediaEl.parentElement;
        const highlightMatch = window.location.pathname.match(IG_HIGHLIGHT_REGEX_MAIN);
        if (highlightMatch) {
            const highlightId = highlightMatch[3];
            attachOverlayButton(anchor, () => ({
                kind: 'highlight',
                highlightId,
                mediaId: null,
                index: 0,
            }));
            return;
        }
        const username = getValueByKey(section, 'username');
        if (!username) return;
        attachOverlayButton(anchor, () => {
            const frameMatch = window.location.pathname.match(IG_STORY_REGEX_MAIN);
            return {
                kind: 'stories',
                username,
                mediaId: frameMatch && frameMatch[3] ? frameMatch[3] : null,
                index: 0,
            };
        });
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
