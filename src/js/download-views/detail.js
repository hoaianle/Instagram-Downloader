// Selection entry point for the detail view. Keep view-specific changes isolated here.
const postDetailDownloadView = {
    getSelection(root) {
        return postMediaSelection.getStablePostSelection(root);
    },
};
