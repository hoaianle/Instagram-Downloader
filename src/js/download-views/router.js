// Resolve the view at click time because Instagram navigates without reloading.
function getPostDownloadView(root) {
    if (/^\/reels\//.test(location.pathname)) return reelsDownloadView;
    const dialog =
        root.closest?.('[role="dialog"], dialog') ||
        (root === document && document.querySelector('[role="dialog"], dialog'));
    if (dialog) return postModalDownloadView;
    if (location.pathname === '/') return postFeedDownloadView;
    return postDetailDownloadView;
}
