// Shared single-file/ZIP pipeline used by every inline view.
async function getInlineDownloadData(type, shortcode) {
    if (type === 'post') {
        if (shortcode) return downloadPostPhotos(shortcode);
        appState.setCurrentShortcode();
        return downloadPostPhotos();
    }
    if (type === 'highlights') {
        appState.setCurrentHightlightsId();
        return downloadStoryPhotos('highlights');
    }
    appState.setCurrentUsername();
    return downloadStoryPhotos('stories');
}

async function downloadInlineMedia({
    button,
    type,
    downloadAll = false,
    index = 0,
    selection = null,
    shortcode,
    operationKey = '',
}) {
    if (button.disabled) return;
    setInlineDownloadProgress(button, 0, operationKey);
    const report = createDownloadReport();
    try {
        const data = await getInlineDownloadData(type, shortcode);
        if (!data?.media?.length) throw new Error('No downloadable media found');

        if (!downloadAll) {
            let item = null;
            if (type === 'stories' || type === 'highlights') item = resolveSelectedStoryMedia(data, selection);
            else if (type === 'post') item = resolveSelectedPostMedia(data, selection, shortcode);
            else item = data.media[Math.min(Math.max(index, 0), data.media.length - 1)];
            if (!item) throw new Error('Unable to identify the currently displayed media safely');
            setDownloadReportMedia(report, data, [item]);
            const result = await fetchMediaWithRecovery(
                item,
                ({ percent }) => setInlineDownloadProgress(button, percent, operationKey),
                report,
            );
            const { blob } = result;
            setInlineDownloadProgress(button, 100, operationKey);
            saveFile(blob, getMediaFileName(data, result.item, blob));
            recordDownloadedItem(report, result);
            report.saved = true;
            return;
        }

        const files = await collectDownloadFiles(
            data,
            data.media,
            (percent) => setInlineDownloadProgress(button, percent, operationKey),
            report,
        );
        if (!files.length) return;
        setInlineDownloadProgress(button, 96, operationKey);
        const zip = await createZip(files);
        setInlineDownloadProgress(button, 100, operationKey);
        saveFile(zip, getArchiveFileName(data));
        report.saved = true;
    } catch (error) {
        console.log(error);
        if (isDownloadRateLimited(error)) report.stopped = true;
        report.errors.push(error.message || 'Download failed.');
    } finally {
        showDownloadReport(report);
        setTimeout(() => resetInlineDownloadProgress(button, operationKey), 300);
    }
}
