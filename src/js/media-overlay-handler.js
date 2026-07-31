window.addEventListener('mediaOverlayDownload', async (e) => {
    const { containerId, kind, shortcode, username, highlightId, mediaId, index } = e.detail;
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
        const matchedByIdItem = mediaId != null ? data.media.find((m) => String(m.id) === String(mediaId)) : null;
        const clampedIndex = Math.min(Math.max(index || 0, 0), data.media.length - 1);
        const item = matchedByIdItem || data.media[clampedIndex];
        const date = new Date(data.date * 1000).toISOString().split('T')[0];
        const fileName = `${data.user.username}_${item.id}_${date}${item.isVideo ? '.mp4' : '.jpeg'}`;
        await saveMediaItem(item, fileName);
        reportResult('success');
    } catch (error) {
        console.log(error);
        reportResult('error');
    }
});
