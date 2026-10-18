// Selection entry point for the feed view. Keep view-specific changes isolated here.
const postFeedDownloadView = {
    getSelection(root) {
        return postMediaSelection.getStablePostSelection(root);
    },
};
