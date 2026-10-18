// Selection entry point for the reels view. Keep view-specific changes isolated here.
const reelsDownloadView = {
    getSelection(root) {
        return postMediaSelection.getStablePostSelection(root);
    },
};
