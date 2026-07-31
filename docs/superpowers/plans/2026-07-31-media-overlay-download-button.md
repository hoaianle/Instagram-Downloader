# Media Overlay Download Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a top-left overlay download icon on every Instagram-rendered image/video (feed, profile/explore grid, reels, post/reel page, post modal, stories/highlights) that downloads the exact media item visible at click time, at max resolution, without disturbing the existing Download button/modal.

**Architecture:** Reuse the codebase's existing MAIN-world-detects / ISOLATED-world-fetches pattern (`window.dispatchEvent(new CustomEvent(...))` bridging the two worlds). A new MAIN-world script scans the DOM, injects buttons, resolves which media item is active, and dispatches a request event. A new ISOLATED-world script resolves/fetches/downloads the media via refactored versions of the existing `post.js`/`story.js` fetch logic, then dispatches a result event back so the button can show success/error.

**Tech Stack:** Plain browser-extension JS (MV3, no bundler, no framework), existing `Cookies` helper (`lib/js.cookie.min.js`), Chrome extension content scripts (isolated + `world: MAIN`).

## Global Constraints

- No automated test runner exists in this repo (no `package.json`, no test framework) — the project's only prior verification method is manual, in a real logged-in Chrome session against live instagram.com. Every task's "test" step means: reload the unpacked extension in `chrome://extensions/` and manually verify in the browser (use `chrome-devtools` MCP tools to navigate/inspect/screenshot instead of asking the user to do it by hand where possible).
- Never touch the existing `.overlay` class or the existing Download button/modal behavior — this feature is additive only.
- Any new class name must be prefixed `igd-` to avoid collisions with Instagram's own classes and the extension's existing `.overlay`.
- Keep the existing code style (no semicolons-are-required-but-project-uses-them; match `.prettierrc.json` — run `npx prettier --check ./src` before each commit).
- Constants starting with `IG_` are load-bearing (per README) — do not rename.
- Fetches must go through `getFetchOptions()` / `setPreferredMediaResolutionCookies()` exactly like existing code, so cookies/headers stay consistent.

---

## File Structure

- **Modify** `src/js/utils.js` — extract `saveMediaItem(item, fileName)` out of `saveMedia`, add `appCache.mediaDataCache`.
- **Modify** `src/js/main.js` — declare `mediaDataCache: new Map()` on `appCache`.
- **Modify** `src/js/post.js` — split `downloadPostPhotos()` into a cacheable, shortcode-parameterized `fetchPostMediaData(shortcode)` plus a thin wrapper.
- **Modify** `src/js/story.js` — split `downloadStoryPhotos(type)` into cacheable, parameterized `fetchStoryMediaData(username)` / `fetchHighlightMediaData(highlightsId)` plus thin wrappers.
- **Create** `src/js/media-overlay-handler.js` (ISOLATED world) — event bridge + download orchestration.
- **Create** `src/js/global/media-overlay-injector.js` (MAIN world) — DOM scanning, button injection, active-index detection, lifecycle.
- **Modify** `src/style/style.css` — `.igd-media-download-btn` and state classes.
- **Modify** `manifest.json` — register the two new files.

---

### Task 1: Cache + extraction in `utils.js`

**Files:**
- Modify: `src/js/utils.js:71-79` (the existing `saveMedia` function)
- Modify: `src/js/main.js:18-33` (the `appCache` object)

**Interfaces:**
- Produces: `saveMediaItem(item, fileName)` where `item` is `{ url: string, isVideo: boolean, id: string|number }` — later tasks call this directly with items straight out of the media-data arrays, no DOM element required.
- Produces: `appCache.mediaDataCache` — a `Map<string, object>` (key format defined in Task 2/3) that later tasks read/write for caching fetched media lists.

- [ ] **Step 1: Add `mediaDataCache` to `appCache`**

In `src/js/main.js`, inside the `appCache` object literal (around line 18), add a sibling entry to `postIdInfoCache`:

```javascript
const appCache = Object.freeze({
    userIdsCache: new Map(),
    postIdInfoCache: new Map(),
    /**
     * Cache fetched media lists so overlay buttons on the same post
     * (e.g. feed thumbnail + its modal) don't re-fetch.
     *
     * key => { date, user: { username }, media: [{ url, isVideo, id }] }
     * key is 'post:<shortcode>' | 'stories:<userId>' | 'highlight:<highlightId>'
     */
    mediaDataCache: new Map(),
});
```

- [ ] **Step 2: Extract `saveMediaItem` in `utils.js`**

Replace the existing `saveMedia` function (lines 71-79) with:

```javascript
async function saveMediaItem(item, fileName) {
    try {
        const respone = await fetch(item.url);
        const blob = await respone.blob();
        saveFile(blob, fileName);
    } catch (error) {
        console.log(error);
    }
}

async function saveMedia(media, fileName) {
    return saveMediaItem({ url: media.src }, fileName);
}
```

This keeps `saveMedia`'s existing call sites (`main.js`'s `renderMedia` click handler) working unchanged, while giving the new overlay code a DOM-independent entry point.

- [ ] **Step 3: Manual verification**

Reload the unpacked extension at `chrome://extensions/`, open any Instagram post, click a single photo to download it (existing behavior). Confirm the file downloads exactly as before — this proves the `saveMedia`/`saveMediaItem` split didn't break the existing flow.

- [ ] **Step 4: Format & commit**

```bash
npx --yes prettier --write ./src
git add src/js/utils.js src/js/main.js
git commit -m "refactor: extract saveMediaItem and add mediaDataCache for overlay downloads"
```

---

### Task 2: Parameterize + cache post media fetch

**Files:**
- Modify: `src/js/post.js:68-96` (`downloadPostPhotos`)

**Interfaces:**
- Consumes: `appCache.mediaDataCache` (Task 1), `getPostPhotos(shortcode)` (existing, unchanged).
- Produces: `fetchPostMediaData(shortcode)` — `async (shortcode: string) => data|null` where `data` is `{ date, user: { username }, media: [{ url, isVideo, id }] }`. Cached under key `` `post:${shortcode}` ``. Task 5 calls this directly.
- `downloadPostPhotos()` keeps its existing signature/behavior (delegates to `fetchPostMediaData(appState.current.shortcode)`), so `main.js` needs no changes.

- [ ] **Step 1: Refactor `downloadPostPhotos` into a parameterized, cached function**

Replace the `downloadPostPhotos` function (lines 68-96) with:

```javascript
async function fetchPostMediaData(shortcode) {
    const cacheKey = `post:${shortcode}`;
    if (appCache.mediaDataCache.has(cacheKey)) return appCache.mediaDataCache.get(cacheKey);
    const json = await getPostPhotos(shortcode);
    if (!json) return null;
    const data = {
        date: json['taken_at'],
        user: {
            username: json.user['username'],
        },
        media: [],
    };
    function extractMediaData(item) {
        const isVideo = item['media_type'] !== 1;
        const mediaItems = isVideo ? item['video_versions'] : item['image_versions2'].candidates;
        const largestMediaItem = mediaItems.reduce((accumulator, currentValue) => {
            if (accumulator.width * accumulator.height > currentValue.width * currentValue.height) return accumulator;
            return currentValue;
        }, mediaItems[0]);
        const media = {
            url: largestMediaItem.url,
            isVideo,
            id: item.pk,
        };
        return media;
    }
    if (json['carousel_media']) data.media = json['carousel_media'].map(extractMediaData);
    else data.media.push(extractMediaData(json));
    appCache.mediaDataCache.set(cacheKey, data);
    return data;
}

async function downloadPostPhotos() {
    if (!appState.current.shortcode) return null;
    return fetchPostMediaData(appState.current.shortcode);
}
```

Note `getPostIdFromApi()` (used inside `getPostPhotos`) already reads `appState.current.shortcode` internally for its fallback path — leave it as-is; it's only hit on a 400 response and is out of scope for this feature.

- [ ] **Step 2: Manual verification**

Reload the extension, open a post with a single image, click the main `Download` button (`D` key or the button), confirm it still renders/downloads correctly (proves `downloadPostPhotos()` wrapper still works). Then open a carousel post the same way and confirm all slides still render in the extension's modal (proves `carousel_media` mapping still works).

- [ ] **Step 3: Format & commit**

```bash
npx --yes prettier --write ./src
git add src/js/post.js
git commit -m "refactor: extract cacheable fetchPostMediaData from downloadPostPhotos"
```

---

### Task 3: Parameterize + cache story/highlight media fetch

**Files:**
- Modify: `src/js/story.js:59-92` (`downloadStoryPhotos`)

**Interfaces:**
- Consumes: `appCache.mediaDataCache` (Task 1), `getUserId(username)`, `getStoryPhotos(userId)`, `getHighlightStory(highlightsId)` (existing, unchanged).
- Produces: `fetchStoryMediaData(username)` — `async (username: string) => data|null`, cached under `` `stories:${username}` ``.
- Produces: `fetchHighlightMediaData(highlightsId)` — `async (highlightsId: string) => data|null`, cached under `` `highlight:${highlightsId}` ``.
- `downloadStoryPhotos(type)` keeps its existing signature/behavior.

- [ ] **Step 1: Refactor `downloadStoryPhotos` into parameterized, cached functions**

Replace the `downloadStoryPhotos` function (lines 59-92) with:

```javascript
function extractStoryMediaData(json) {
    const data = {
        date: json.items[0]['taken_at'],
        user: {
            username: json.user['username'],
        },
        media: [],
    };
    json.items.forEach((item) => {
        const isVideo = item['media_type'] !== 1;
        const mediaItems = isVideo ? item['video_versions'] : item['image_versions2'].candidates;
        const largestMediaItem = mediaItems.reduce((accumulator, currentValue) => {
            if (accumulator.width > currentValue.width) return accumulator;
            return currentValue;
        }, mediaItems[0]);
        data.media.push({
            url: largestMediaItem.url,
            isVideo: isVideo,
            id: item.pk,
        });
    });
    return data;
}

async function fetchStoryMediaData(username) {
    const cacheKey = `stories:${username}`;
    if (appCache.mediaDataCache.has(cacheKey)) return appCache.mediaDataCache.get(cacheKey);
    const userId = await getUserId(username);
    if (!userId) return null;
    const json = await getStoryPhotos(userId);
    if (!json) return null;
    const data = extractStoryMediaData(json);
    appCache.mediaDataCache.set(cacheKey, data);
    return data;
}

async function fetchHighlightMediaData(highlightsId) {
    const cacheKey = `highlight:${highlightsId}`;
    if (appCache.mediaDataCache.has(cacheKey)) return appCache.mediaDataCache.get(cacheKey);
    const json = await getHighlightStory(highlightsId);
    if (!json) return null;
    const data = extractStoryMediaData(json);
    appCache.mediaDataCache.set(cacheKey, data);
    return data;
}

async function downloadStoryPhotos(type = 'stories') {
    if (type === 'highlights') {
        if (!appState.current.highlights) return null;
        return fetchHighlightMediaData(appState.current.highlights);
    }
    if (!appState.current.username) return null;
    return fetchStoryMediaData(appState.current.username);
}
```

- [ ] **Step 2: Manual verification**

Reload the extension, open someone's story, confirm the main Download button still downloads it. Open a highlight, confirm the same.

- [ ] **Step 3: Format & commit**

```bash
npx --yes prettier --write ./src
git add src/js/story.js
git commit -m "refactor: extract cacheable fetchStoryMediaData/fetchHighlightMediaData"
```

---

### Task 4: Overlay button CSS

**Files:**
- Modify: `src/style/style.css` (append new rules)

**Interfaces:**
- Produces CSS classes consumed by Task 6's injector: `.igd-media-download-btn` (base), `.igd-media-download-btn.igd-loading`, `.igd-media-download-btn.igd-success`, `.igd-media-download-btn.igd-error`, and `.igd-media-anchor` (applied to whatever container the button is absolutely positioned inside — must have `position: relative` for the absolute button to anchor top-left of the *media*, not the page).

- [ ] **Step 1: Append the new rules to `style.css`**

```css
/* Media overlay download button (injected on top of Instagram's own media) */

.igd-media-anchor {
    position: relative !important;
}

.igd-media-download-btn {
    position: absolute;
    top: 8px;
    left: 8px;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.5);
    border: none;
    outline: none;
    display: none;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 999;
    padding: 0;
    transition: background-color 0.15s ease;
}

.igd-media-anchor:hover .igd-media-download-btn,
.igd-media-download-btn.igd-touch-visible {
    display: flex;
}

.igd-media-download-btn:hover {
    background: rgba(0, 0, 0, 0.7);
}

.igd-media-download-btn > svg {
    width: 16px;
    height: 16px;
    fill: white;
    display: block;
}

.igd-media-download-btn.igd-loading > svg {
    display: none;
}

.igd-media-download-btn.igd-loading::after {
    content: '';
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.4);
    border-top: 2px solid white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
}

.igd-media-download-btn.igd-success {
    background: rgb(var(--ig-colors-button-primary-background));
}

.igd-media-download-btn.igd-success > svg {
    display: none;
}

.igd-media-download-btn.igd-success::after {
    content: '\2714';
    color: white;
    font-size: 14px;
}

.igd-media-download-btn.igd-error {
    background: rgba(200, 40, 40, 0.85);
}
```

This reuses the `@keyframes spin` already defined at the bottom of `style.css` — no duplicate keyframes needed.

- [ ] **Step 2: Manual verification**

Nothing to functionally test yet (no JS creates these elements). Just confirm `npx prettier --check ./src` doesn't flag the CSS as broken syntax (it will still flag formatting-only diffs unrelated to this change — that's expected, pre-existing).

- [ ] **Step 3: Commit**

```bash
git add src/style/style.css
git commit -m "style: add media overlay download button classes"
```

---

### Task 5: ISOLATED-world download handler

**Files:**
- Create: `src/js/media-overlay-handler.js`
- Modify: `manifest.json:16-27` (first `content_scripts` entry, isolated world)

**Interfaces:**
- Consumes: `fetchPostMediaData(shortcode)` (Task 2), `fetchStoryMediaData(username)` / `fetchHighlightMediaData(highlightsId)` (Task 3), `saveMediaItem(item, fileName)` (Task 1).
- Consumes event `mediaOverlayDownload` dispatched on `window` by Task 6, with `detail`:
  ```javascript
  {
      containerId: string,       // opaque id, echoed back unchanged
      kind: 'post' | 'stories' | 'highlight',
      shortcode: string | null,  // set when kind === 'post'
      username: string | null,   // set when kind === 'stories'
      highlightId: string | null,// set when kind === 'highlight'
      index: number,             // clamped index into the resolved media array
  }
  ```
- Produces event `mediaOverlayDownloadResult` dispatched on `window`, with `detail`:
  ```javascript
  { containerId: string, status: 'success' | 'error' }
  ```

- [ ] **Step 1: Write `src/js/media-overlay-handler.js`**

```javascript
window.addEventListener('mediaOverlayDownload', async (e) => {
    const { containerId, kind, shortcode, username, highlightId, index } = e.detail;
    function reportResult(status) {
        window.dispatchEvent(
            new CustomEvent('mediaOverlayDownloadResult', {
                detail: { containerId, status },
            }),
        );
    }
    try {
        let data = null;
        if (kind === 'post') data = await fetchPostMediaData(shortcode);
        else if (kind === 'stories') data = await fetchStoryMediaData(username);
        else if (kind === 'highlight') data = await fetchHighlightMediaData(highlightId);
        if (!data || !data.media.length) return reportResult('error');
        const clampedIndex = Math.min(Math.max(index, 0), data.media.length - 1);
        const item = data.media[clampedIndex];
        const date = new Date(data.date * 1000).toISOString().split('T')[0];
        const fileName = `${data.user.username}_${item.id}_${date}${item.isVideo ? '.mp4' : '.jpeg'}`;
        await saveMediaItem(item, fileName);
        reportResult('success');
    } catch (error) {
        console.log(error);
        reportResult('error');
    }
});
```

- [ ] **Step 2: Register the file in `manifest.json`**

In the first `content_scripts` entry (isolated world, currently lines 16-28), add the new file to the end of the `js` array, before `lib/js.cookie.min.js` is fine either way since this file only adds a listener and doesn't need `Cookies` — put it right after `src/js/zip.js`:

```json
        {
            "matches": ["https://www.instagram.com/*"],
            "js": [
                "src/js/utils.js",
                "src/js/main.js",
                "src/js/post.js",
                "src/js/story.js",
                "src/js/zip.js",
                "src/js/media-overlay-handler.js",
                "lib/js.cookie.min.js"
            ],
            "css": ["src/style/style.css"]
        },
```

- [ ] **Step 3: Manual verification (temporary manual trigger)**

Reload the extension. Open the DevTools console on an Instagram post page and manually dispatch a test event to prove the bridge works end-to-end before Task 6 wires up real buttons:

```javascript
window.dispatchEvent(new CustomEvent('mediaOverlayDownload', {
    detail: { containerId: 'test', kind: 'post', shortcode: '<a real shortcode from the current URL>', index: 0 }
}));
```

Confirm a file downloads, and that `window.addEventListener('mediaOverlayDownloadResult', e => console.log(e.detail))` (register this first) logs `{ containerId: 'test', status: 'success' }`.

- [ ] **Step 4: Format & commit**

```bash
npx --yes prettier --write ./src
git add src/js/media-overlay-handler.js manifest.json
git commit -m "feat: add ISOLATED-world handler for overlay download requests"
```

---

### Task 6: MAIN-world injector — post modal & dedicated post/reel page

Start with the single most stable, best-understood context (the existing `post-modal-view-handler.js` already proves the DOM shape here) before expanding to feed/grid/reels/stories in later tasks.

**Files:**
- Create: `src/js/global/media-overlay-injector.js`
- Modify: `manifest.json:29-41` (second `content_scripts` entry, `world: MAIN`)

**Interfaces:**
- Consumes: `getValueByKey(obj, key)` (existing, `src/js/global/utils.js`), `IG_POST_REGEX` — **not available in MAIN world** (declared in `main.js`, isolated world only) — redeclare the regex locally in this file exactly as done for `getValueByKey` elsewhere (see the comment at the top of `global/utils.js`).
- Produces: `window.dispatchEvent(new CustomEvent('mediaOverlayDownload', { detail }))` per the shape defined in Task 5.
- Consumes: `mediaOverlayDownloadResult` events (Task 5) to drive per-button visual state via `containerId` lookup.

- [ ] **Step 1: Write the shared injector skeleton with a `containerId` registry and result-listener wiring**

```javascript
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
     * Attaches a download button to `mediaContainer` (the element that should
     * get position:relative so the button anchors top-left of the media, not
     * the page) unless one is already attached.
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

    window.igdMediaOverlay = { attachOverlayButton, IG_POST_REGEX_MAIN };
})();
```

- [ ] **Step 2: Add post-modal + dedicated post/reel page scanning**

Append to the same file (still inside the outer IIFE, after `window.igdMediaOverlay = ...` — move that assignment to the very end of the file instead, once all scanning functions exist):

```javascript
    function resolveCarouselIndex(article) {
        const slides = Array.from(article.querySelectorAll('ul[class] > li'));
        if (slides.length === 0) return 0;
        const activeIndex = slides.findIndex((slide) => slide.getAttribute('aria-hidden') !== 'true');
        return activeIndex === -1 ? 0 : activeIndex;
    }

    function scanPostArticle(article) {
        const postInfo = getValueByKey(article, 'post');
        if (!postInfo || !postInfo.code) return;
        const mediaContainer = article.querySelector('ul, div[role="button"] img, div[role="button"] video');
        const anchor = mediaContainer ? mediaContainer.closest('div') : null;
        if (!anchor) return;
        attachOverlayButton(anchor, () => ({
            kind: 'post',
            shortcode: postInfo.code,
            index: resolveCarouselIndex(article),
        }));
    }

    function scanForPostModalAndPage() {
        document.querySelectorAll('article[role="presentation"]').forEach(scanPostArticle);
    }

    const postPageObserver = new MutationObserver(scanForPostModalAndPage);
    postPageObserver.observe(document.body, { childList: true, subtree: true });
    scanForPostModalAndPage();
```

- [ ] **Step 3: Register the file in `manifest.json`**

In the second `content_scripts` entry (currently lines 29-41), append to `js`:

```json
        {
            "matches": ["https://www.instagram.com/*"],
            "js": [
                "src/js/global/utils.js",
                "src/js/global/home-scroll-handler.js",
                "src/js/global/stories-view-handler.js",
                "src/js/global/post-modal-view-handler.js",
                "src/js/global/reels-scroll-handler.js",
                "src/js/global/media-overlay-injector.js"
            ],
            "css": [],
            "world": "MAIN"
        }
```

- [ ] **Step 4: Live verification against real Instagram (use `chrome-devtools` MCP)**

1. Reload the unpacked extension.
2. Use the `chrome-devtools` MCP tools to navigate to `https://www.instagram.com/`, log in if needed, open any single-image post (dedicated page, `/p/<code>/`).
3. Take a DOM snapshot / inspect the `article[role="presentation"]` subtree to confirm the actual selectors for the media wrapper and (if a carousel) the slide list — `ul[class] > li` with `aria-hidden` is a best-guess based on Instagram's known accessibility pattern, not a confirmed live selector. **Adjust `resolveCarouselIndex` and the `mediaContainer` query in `scanPostArticle` to match whatever the live markup actually is.**
4. Hover the media, confirm the button appears top-left; click it; confirm the exact visible image downloads (compare visually to what's on screen).
5. Repeat for a carousel post: swipe to slide 2, click the button, confirm slide 2 (not slide 1) downloads.
6. Repeat both checks by opening the same posts as a **modal** (click into a post from the feed/grid instead of navigating directly).

- [ ] **Step 5: Format & commit**

```bash
npx --yes prettier --write ./src
git add src/js/global/media-overlay-injector.js manifest.json
git commit -m "feat: add overlay download button for post modal and post/reel page"
```

---

### Task 7: Extend injector — home feed carousels

**Files:**
- Modify: `src/js/global/media-overlay-injector.js` (add feed scanning; feed articles are structurally the same `article[role="presentation"]` shape already handled by `scanPostArticle` from Task 6, but they live inside `main` and must be (re)scanned on scroll, not just on route mutation)

**Interfaces:**
- Consumes: `scanPostArticle(article)`, `attachOverlayButton`, `resolveCarouselIndex` (Task 6).

- [ ] **Step 1: Add feed-specific scanning driven by scroll + mutation, reusing `scanPostArticle`**

Append:

```javascript
    function scanFeedArticles() {
        const main = document.querySelector('main');
        if (!main) return;
        main.querySelectorAll('article[role="presentation"]').forEach(scanPostArticle);
    }

    function debounce(fn, delay) {
        let timeoutId;
        return (...args) => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => fn(...args), delay);
        };
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
```

This mirrors the existing `home-scroll-handler.js` debounce/observe pattern exactly, so it's consistent with the rest of the codebase.

- [ ] **Step 2: Live verification**

Reload the extension, go to the home feed, scroll through several posts (including at least one carousel). Confirm buttons appear on hover for each post as it comes into view, and that clicking downloads the correct visible slide for carousels. Scroll far down (30+ posts) and confirm the page doesn't visibly lag — if `scanFeedArticles` re-querying the whole `main` subtree on every mutation is too slow, note it for Task 10 (which adds `IntersectionObserver`-based scoping) rather than optimizing prematurely here.

- [ ] **Step 3: Format & commit**

```bash
npx --yes prettier --write ./src
git add src/js/global/media-overlay-injector.js
git commit -m "feat: extend overlay download button to home feed"
```

---

### Task 8: Extend injector — profile grid & explore grid (cover-only)

**Files:**
- Modify: `src/js/global/media-overlay-injector.js`

**Interfaces:**
- Consumes: `attachOverlayButton` (Task 6).
- Produces: grid thumbnails always resolve `index: 0` (documented limitation from the spec, §5/§8).

- [ ] **Step 1: Add grid scanning**

Grid thumbnails are `<a href="/p/<code>/">` or `<a href="/reel/<code>/">` wrapping an `<img>`, with no fiber-based post object attached (unlike opened articles) — the shortcode comes straight from the `href`.

```javascript
    function extractShortcodeFromHref(href) {
        const match = new URL(href, window.location.origin).pathname.match(IG_POST_REGEX_MAIN);
        return match ? match[2] : null;
    }

    function scanGridLinks() {
        document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]').forEach((link) => {
            const shortcode = extractShortcodeFromHref(link.href);
            if (!shortcode) return;
            const mediaWrapper = link.querySelector('img, video');
            if (!mediaWrapper) return;
            attachOverlayButton(link, () => ({
                kind: 'post',
                shortcode,
                index: 0,
            }));
        });
    }

    const gridObserver = new MutationObserver(debounce(scanGridLinks, Math.floor(1000 / 60)));
    gridObserver.observe(document.body, { childList: true, subtree: true });
    scanGridLinks();
```

Note: `attachOverlayButton` sets `position: relative` on whatever element it's given (`link` here, an `<a>`), which is safe — anchors can be `position: relative` without breaking their click/navigation behavior. The button's own `stopPropagation()`/`preventDefault()` (from Task 6) prevents the click from also navigating to the post.

- [ ] **Step 2: Live verification**

Visit a profile page grid and the Explore grid. Hover a thumbnail (including one showing the "multiple photos" badge), confirm the button appears, click it, confirm it downloads the *cover* image of that post (open the post separately to confirm which image is the cover/first slide, and that they match).

- [ ] **Step 3: Format & commit**

```bash
npx --yes prettier --write ./src
git add src/js/global/media-overlay-injector.js
git commit -m "feat: extend overlay download button to profile/explore grid (cover image)"
```

---

### Task 9: Extend injector — reels

**Files:**
- Modify: `src/js/global/media-overlay-injector.js`

**Interfaces:**
- Consumes: `attachOverlayButton` (Task 6). Reels have no carousel (always a single video), so `index` is always `0`.

- [ ] **Step 1: Add reels-page scanning, mirroring `reels-scroll-handler.js`'s identification pattern**

```javascript
    function scanReelsPlayers() {
        document.querySelectorAll('main > div > div').forEach((reelContainer) => {
            const identifier = getValueByKey(reelContainer, 'PolarisClipsViewer_media_identifier');
            if (!identifier || !identifier.code) return;
            const video = reelContainer.querySelector('video');
            if (!video) return;
            attachOverlayButton(video.parentElement, () => ({
                kind: 'post',
                shortcode: identifier.code,
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
```

- [ ] **Step 2: Live verification**

Open `/reels/` and scroll through a few reels. Confirm the button appears over the video (not blocked by/blocking playback controls) and downloads the correct reel's video file. Also check a reel opened from the home feed and from a profile's reels tab — if `PolarisClipsViewer_media_identifier` isn't present in those contexts (it may only exist on the dedicated `/reels/:code` scroller), note that as a follow-up rather than blocking this task, since the spec already scoped reels broadly but the dedicated reels page is the primary, confirmed case.

- [ ] **Step 3: Format & commit**

```bash
npx --yes prettier --write ./src
git add src/js/global/media-overlay-injector.js
git commit -m "feat: extend overlay download button to reels"
```

---

### Task 10: Extend injector — stories & highlights

**Files:**
- Modify: `src/js/global/media-overlay-injector.js`

**Interfaces:**
- Consumes: `attachOverlayButton` (Task 6).
- Produces: `kind: 'stories'` (with `username`) or `kind: 'highlight'` (with `highlightId`) detail objects per Task 5's contract.

- [ ] **Step 1: Add stories/highlights scanning**

```javascript
    function resolveStorySegmentIndex(section) {
        const segments = Array.from(section.querySelectorAll('div[role="progressbar"]'));
        if (segments.length === 0) return 0;
        const activeIndex = segments.findIndex((segment) => segment.getAttribute('aria-valuenow') !== '100');
        return activeIndex === -1 ? segments.length - 1 : activeIndex;
    }

    function scanStoriesViewer() {
        const IG_STORY_REGEX_MAIN = /\/(stories)\/(.*?)\/(\d*)(\/?)/;
        const IG_HIGHLIGHT_REGEX_MAIN = /\/(stories)\/(highlights)\/(\d*)(\/?)/;
        if (!window.location.pathname.match(IG_STORY_REGEX_MAIN)) return;
        const section = Array.from(document.querySelectorAll('section')).pop();
        if (!section) return;
        const video = section.querySelector('video');
        const image = section.querySelector('img[decoding]');
        const mediaEl = video || image;
        if (!mediaEl) return;
        const highlightMatch = window.location.pathname.match(IG_HIGHLIGHT_REGEX_MAIN);
        if (highlightMatch) {
            const highlightId = highlightMatch[3];
            attachOverlayButton(mediaEl.parentElement, () => ({
                kind: 'highlight',
                highlightId,
                index: resolveStorySegmentIndex(section),
            }));
            return;
        }
        const username = getValueByKey(section, 'username');
        if (!username) return;
        attachOverlayButton(mediaEl.parentElement, () => ({
            kind: 'stories',
            username,
            index: resolveStorySegmentIndex(section),
        }));
    }

    const storiesObserver = new MutationObserver(debounce(scanStoriesViewer, Math.floor(1000 / 60)));

    navigation.addEventListener('navigate', (e) => {
        const url = new URL(e.destination.url);
        if (url.pathname.match(/\/(stories)\/(.*?)\/(\d*)(\/?)/)) {
            storiesObserver.observe(document.body, { childList: true, subtree: true });
            setTimeout(scanStoriesViewer, 0);
        } else {
            storiesObserver.disconnect();
        }
    });
```

- [ ] **Step 2: Live verification**

Open a story with multiple frames from someone who posted several. Confirm the button appears, and clicking it on frame 1 vs. advancing to frame 3 and clicking again downloads the correct, different frame each time (compare downloaded file's `id` — visible in DevTools Network tab or by content — against what's on screen). Repeat for a highlight with multiple frames. **The `div[role="progressbar"]` / `aria-valuenow` selector is a best guess** — inspect the live segmented bar markup via `chrome-devtools` MCP and adjust `resolveStorySegmentIndex` if the actual attributes differ; if no reliable "which segment is active" signal exists in the markup, fall back to always resolving index `0` and note that limitation, per the spec's explicit "fallback to index 0" rule (§5).

- [ ] **Step 3: Format & commit**

```bash
npx --yes prettier --write ./src
git add src/js/global/media-overlay-injector.js
git commit -m "feat: extend overlay download button to stories and highlights"
```

---

### Task 11: Lifecycle hardening — IntersectionObserver scoping + cleanup

**Files:**
- Modify: `src/js/global/media-overlay-injector.js`

**Interfaces:**
- Consumes: all `scan*` functions from Tasks 6-10 (no signature changes — this task only changes *when/how often* they run and adds teardown, not what they do).

- [ ] **Step 1: Scope expensive feed/grid mutation scans with an `IntersectionObserver`**

The feed and grid scans (Tasks 7-8) re-run `attachOverlayButton` checks across the whole visible `main`/grid subtree on every DOM mutation, which is fine at normal feed sizes but should stop doing full-subtree work once there are hundreds of loaded posts. Replace the blanket `MutationObserver`-triggers-`querySelectorAll`-over-everything approach for feed/grid with an `IntersectionObserver` that only calls `scanPostArticle`/grid-link-attach for elements entering the viewport (±1 screen), and disconnects/removes buttons for elements that leave:

```javascript
    const feedIntersectionObserver = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) scanPostArticle(entry.target);
            });
        },
        { rootMargin: '100% 0px 100% 0px' },
    );

    function observeNewArticles(root) {
        root.querySelectorAll('article[role="presentation"]').forEach((article) => {
            if (article.dataset.igdObserved) return;
            article.dataset.igdObserved = 'true';
            feedIntersectionObserver.observe(article);
        });
    }
```

Replace the body of `scanFeedArticles` (Task 7) with a call to `observeNewArticles(main)` instead of directly calling `scanPostArticle` on every match — the `IntersectionObserver` callback is now what actually attaches buttons. Apply the same `data-igd-observed` + `IntersectionObserver` pattern to `scanGridLinks` (Task 8), swapping its direct `attachOverlayButton` call for `gridIntersectionObserver.observe(link)` the first time each link is seen.

- [ ] **Step 2: Full teardown on SPA navigation**

Add one central cleanup, called at the top of every `navigation.addEventListener('navigate', ...)` handler already present in this file (Tasks 7, 9, 10) and once more unconditionally:

```javascript
    function teardownAllOverlayObservers() {
        feedObserver.disconnect();
        gridObserver.disconnect();
        reelsObserver.disconnect();
        storiesObserver.disconnect();
        feedIntersectionObserver.disconnect();
        window.removeEventListener('scroll', debouncedFeedScan);
    }

    navigation.addEventListener('navigate', teardownAllOverlayObservers);
```

Register this listener *before* the per-context ones added in Tasks 7/9/10 so teardown always runs first on every navigation, and the per-context handler that matches the new URL re-observes fresh. (Listener registration order determines call order for the same event target/type in the DOM spec, so declare this one first in the file.)

- [ ] **Step 3: Live verification**

Open Chrome DevTools' Performance/Memory tools (via `chrome-devtools` MCP) on the home feed, scroll through 50+ posts, navigate away to a profile and back to home several times. Confirm: no console errors, no runaway growth in listener/observer count (`getEventListeners` or a manual counter logged from `buttonRegistry.size` should not grow unbounded), and buttons still work correctly on freshly-scrolled-in posts after several navigations.

- [ ] **Step 4: Format & commit**

```bash
npx --yes prettier --write ./src
git add src/js/global/media-overlay-injector.js
git commit -m "perf: scope feed/grid overlay scanning with IntersectionObserver and add teardown"
```

---

### Task 12: Full cross-context manual regression pass

**Files:** none (verification-only task; fix forward in whichever file if something's broken)

- [ ] **Step 1: Run formatting check**

```bash
npx --yes prettier --check ./src
```

Fix any new formatting issues (`npx --yes prettier --write ./src`) — pre-existing warnings unrelated to files touched in this plan are out of scope.

- [ ] **Step 2: Full manual walkthrough (use `chrome-devtools` MCP to drive Chrome)**

For each of the following, confirm (a) button appears on hover, (b) click downloads the correct file with no console errors, (c) the existing Download button/modal still works untouched:
1. Home feed — single-image post
2. Home feed — carousel post (test at least 2 different slide positions)
3. Profile grid thumbnail (single image and carousel post — cover only)
4. Explore grid thumbnail
5. Reels (`/reels/:code` scroller)
6. Dedicated post page (`/p/:code`)
7. Post opened as a modal from feed
8. Story with 3+ frames (test at least 2 different frames)
9. Highlight with 3+ frames (test at least 2 different frames)
10. Existing `Download` button + modal (multi-select, zip download) — regression check

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: fix regressions found during cross-context overlay verification"
```

(Skip this commit if step 2 found nothing to fix.)
