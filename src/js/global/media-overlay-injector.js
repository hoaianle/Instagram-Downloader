(() => {
    const IG_POST_REGEX_MAIN = /\/(p|tv|reel|reels)\/([A-Za-z0-9_-]*)(\/?)/;
    let nextContainerId = 0;
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
})();
