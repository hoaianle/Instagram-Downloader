/**
 * This file is not include in manifest so it not run.
 * If this file run, every network call with XHR will be tracked.
 * So you don't need to call api to get data, just cacth the response somewhere.
 */

/**
 * I have the algorithm that Instagram use to convert between post id and post shortcode.
 * But if the post is from a private profile, they add some extra stuff to the shortcode.
 * And I don't know how to convert between them.
 * So I wrote this to cache post id when user view post to reduce one api call.
 *
 * Why the hell I need to match post info api or comments api instead of just one?
 * The reason is post info api only load when you view post from home or /explore.
 * If you view post from user profile page, it not gonna call post info, instead it call post comments api
 */
(() => {
    const API_POST_INFO_REGEX = /api\/v1\/media\/(\d*)\/info\.*?/;
    const API_POST_COMMENTS_REGEX = /api\/v1\/media\/(\d+)\/comments\/.*?/;

    const performanceObserver = new PerformanceObserver((list) => {
        const entries = list.getEntriesByType('resource');
        entries.forEach((entry) => {
            const entryPath = new URL(entry.name).pathname;
            const currentPath = window.location.pathname;

            const matchPostInfoApi = entryPath.match(API_POST_INFO_REGEX);
            const matchPostCommentApi = entryPath.match(API_POST_COMMENTS_REGEX);
            const matchPostPath = currentPath.match(IG_POST_REGEX);

            if ((matchPostInfoApi || matchPostCommentApi) && matchPostPath) {
                const shortcode = matchPostPath[2];
                let pk = null;
                if (matchPostInfoApi) pk = matchPostInfoApi[1];
                if (matchPostCommentApi) pk = matchPostCommentApi[1];

                // Check Valid pk and code
                if (shortcode.startsWith(convertToShortcode(pk)) && !appCache.postIdInfoCache.has(shortcode)) {
                    appCache.postIdInfoCache.set(shortcode, pk);
                }
            }
        });
    });
    performanceObserver.observe({ entryTypes: ['resource'] });
})();
