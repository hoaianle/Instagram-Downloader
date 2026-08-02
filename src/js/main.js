const IG_BASE_URL = window.location.origin + '/';

const IG_SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const appCache = Object.freeze({
    /**
     * Cache user id, reduce one api call to get id from username
     *
     * username => id
     */
    userIdsCache: new Map(),
    /**
     * Cache post id, reduce one api call to get post id from shortcode.
     *
     * Only for private profile, check out  post-modal-view-handler.js
     *
     * shortcode => post_id
     */
    postIdInfoCache: new Map(),
    /**
     * Cache fetched media lists so overlay buttons on the same post
     * (e.g. feed thumbnail + its modal) don't re-fetch.
     *
     * key => { date, user: { username }, media: [{ url, isVideo, id }] }
     * key is 'post:<shortcode>' | 'stories:<username>' | 'highlight:<highlightId>'
     */
    mediaDataCache: new Map(),
});

window.addEventListener('userLoad', (e) => {
    if (!appCache.userIdsCache.has(e.detail.username)) {
        appCache.userIdsCache.set(e.detail.username, e.detail.id);
    }
});
window.addEventListener('postView', (e) => {
    if (appCache.postIdInfoCache.has(e.detail.code)) return;
    // Check valid shortcode
    if (e.detail.code.startsWith(convertToShortcode(e.detail.id))) {
        appCache.postIdInfoCache.set(e.detail.code, e.detail.id);
    }
});
