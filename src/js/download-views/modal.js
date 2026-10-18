// Selection entry point for the modal view. Keep view-specific changes isolated here.
const postModalDownloadView = {
    getSelection(root) {
        return postMediaSelection.getStablePostSelection(root);
    },
};
