# Media Overlay Download Button — Design

Date: 2026-07-31

## 1. Goal

Add a small download icon overlaid on the **top-left corner** of every image/video
Instagram renders — feed, profile grid, explore grid, reels, the dedicated post/reel
page, the post modal, and the Stories/Highlights viewer. Clicking it downloads
**exactly the media item currently visible at click time** (not the whole post),
at maximum resolution (same source as the existing main Download button — an
Instagram API call, not the rendered `<img>`/`<video>` element).

The existing `Download` button and the extension's own media modal are unchanged
and keep working exactly as they do today; this is a purely additive feature.

## 2. Where it appears

- Home feed (`article` posts, including carousels)
- Profile grid & Explore grid thumbnails
- Reels (feed, `/reels/:code`, explore reels tab)
- Dedicated post/reel page (`/p/:code`, `/reel/:code`, `/tv/:code`)
- Post modal (opened from feed/grid/explore)
- Stories and Highlights viewer

## 3. Visual design

- Circular button, ~28–32px, `position: absolute`, top-left of the media
  container. Semi-transparent black background + white SVG download icon,
  visually consistent with the existing `.overlay` checkmark used in the
  extension's own modal (see `style.css`), but a distinct class
  (`.igd-media-download-btn`) to avoid any collision.
- **Visibility**: hidden by default, shown on `:hover` of the media container
  (desktop). On touch devices, first tap on the container reveals the button
  (does not trigger Instagram's own tap handler for that first tap); a second
  tap on the button itself downloads.
- **States**: idle → loading (spinner, reuse existing `@keyframes spin` from
  `style.css`) → brief success flash (✔) → back to idle. On failure: brief
  error indication, `console.log(error)`, back to idle. Never throws /
  never blocks the page.
- On click: `preventDefault()` + `stopPropagation()` so Instagram's own click
  handling underneath (open modal, play/pause, like, navigate) never fires.

## 4. Identifying the post/reel/story

Reuse the existing ReactFiber-walking helpers (`getValueByKey` /
`getAllValuesByKey`, already used in `home-scroll-handler.js`,
`reels-scroll-handler.js`, `post-modal-view-handler.js`) to resolve a
container element to `{ id (pk), code (shortcode) }` for posts/reels, or
`{ username, id }` / highlight id for stories — the same identifiers the
existing `postView`, `userLoad`, `shortcodeChange` events already carry.

For grid/explore thumbnails, the shortcode is already available directly from
the anchor's `href` (`/p/<code>/`) — no fiber walk needed there.

## 5. Identifying the currently-visible slide/frame

- **Carousel posts**: do *not* depend on a specific ReactFiber prop name for
  the active index (too fragile across Instagram updates). Instead, find the
  carousel's slide elements in DOM order and determine which one is currently
  visible/active (not `aria-hidden`, not translated off-screen). That
  element's position among its siblings is the index into the API's
  `carousel_media` array — the visual order and the API order are the same
  (left-to-right).
- **Grid/Explore thumbnails**: no carousel navigation is visible there, so the
  button always downloads index `0` (the cover media). This is a known,
  intentional limitation, not a bug.
- **Stories/Highlights**: determine the active frame from the segmented
  progress bar at the top (the currently-animating/filled segment vs. the
  empty future ones); that segment's index maps to the `media` array already
  returned by `downloadStoryPhotos`.
- **Fallback**: if detection of the active index fails for any reason
  (Instagram changed markup), default to index `0` rather than failing the
  download. Exact selectors/heuristics will be verified against the live
  Instagram DOM during implementation (using the browser), since they cannot
  be fully confirmed by reading source alone.

## 6. Download flow & caching

- Fetch happens **lazily, on click only** — never pre-fetched while scanning
  the feed, to avoid hammering Instagram's API for posts the user never
  intends to download.
- Refactor `downloadPostPhotos` (`post.js`) and `downloadStoryPhotos`
  (`story.js`) so the underlying "fetch full media list for this
  shortcode/username/highlightId" logic is callable independently of
  `appState.current.*`, so the overlay flow can call it directly with the id
  resolved in step 4, without disturbing the existing main-button flow.
- Add `appCache.mediaDataCache` (key: shortcode / `stories:<userId>` /
  `highlight:<id>` → fetched `data`) so clicking overlays for the same post
  twice (e.g., once from the feed thumbnail, once from its modal) doesn't
  re-fetch.
- Extract a `saveMediaItem(item, fileName)` helper out of the existing
  `saveMedia` (`utils.js`) that saves a raw `{ url, isVideo, id }` media
  object directly, decoupled from a live `<img>`/`<video>` DOM element (unlike
  today's `saveMedia`, which reads `.src`/`.title` off a rendered element).

## 7. File/architecture changes

Following the existing MAIN-world-detects / ISOLATED-world-fetches pattern
already used throughout `global/*.js` + `main.js`:

- **New** `src/js/global/media-overlay-injector.js` (MAIN world): scans the
  DOM across all contexts in §2, injects the buttons, resolves the active
  index per §5, and on click dispatches
  `CustomEvent('mediaOverlayDownload', { detail: { ...identifiers, index, containerId } })`.
  Listens for `mediaOverlayDownloadResult` to drive the per-button
  loading/success/error visual state (`containerId` correlates request ↔
  button, since many can exist on screen at once).
- **New** `src/js/media-overlay-handler.js` (ISOLATED world): listens for
  `mediaOverlayDownload`, resolves media via the refactored fetch helpers
  (§6), saves the file, dispatches `mediaOverlayDownloadResult` back with the
  same `containerId`.
- `manifest.json`: register the two new files in their respective
  `content_scripts` entries (isolated / `world: MAIN`).
- `src/style/style.css`: add `.igd-media-download-btn` and its state classes.
- **Lifecycle/perf**: use a `MutationObserver` + `IntersectionObserver` combo
  so buttons are only attached to media that's on/near screen, detached when
  it scrolls away, and everything is torn down on SPA navigation (existing
  `navigation.addEventListener('navigate', ...)` pattern) — the feed can
  accumulate hundreds of loaded posts, so we must not leave stale
  observers/listeners behind.

## 8. Non-goals / explicit limitations

- Grid/Explore thumbnails only ever offer the cover image (no carousel index
  detection there — see §5).
- No change to the existing Download button, modal, multi-select, or zip
  download flow.
- No attempt to pre-fetch or prefetch-on-hover; always fetch-on-click.
