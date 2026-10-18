function isDownloadRateLimited(error) {
    return error.status === 429 || /\(429\)/.test(error.message || '');
}

async function retryMediaDownload(fetchMedia) {
    try {
        return await fetchMedia();
    } catch (error) {
        if (error.name === 'AbortError' || isDownloadRateLimited(error)) throw error;
        const transient = error instanceof TypeError || /\(5\d\d\)/.test(error.message || '');
        if (!transient) throw error;
        await new Promise((resolve) => setTimeout(resolve, 800));
        return fetchMedia();
    }
}

// Return per-download metadata without modifying the cached high-quality item.
async function fetchMediaWithRecovery(item, onProgress, report) {
    const useDash = item.isVideo && item.dash && !videoDownloadPreferences.usesProgressive();
    const allowFallback = videoDownloadPreferences.fallbackEnabled;
    try {
        // Handle DASH recovery here so the shared helper's fallback cannot be
        // mistaken for a successful DASH download in the summary.
        const blob = await retryMediaDownload(() =>
            useDash ? muxDashMedia(item.dash, onProgress) : fetchBestMediaBlob(item, onProgress),
        );
        return {
            blob,
            item,
            mode: item.isVideo ? (useDash ? 'DASH' : 'progressive') : 'image',
        };
    } catch (error) {
        if (error.name === 'AbortError' || isDownloadRateLimited(error)) throw error;
        if (!useDash) throw error;
        report.errors.push(getDownloadReportLabel(report, item) + ': ' + error.message);
        let refreshed = null;
        try {
            onProgress?.({ stage: 'Refreshing media', percent: 0 });
            refreshed = await refreshLegacyMedia(item);
            if (hasFreshDashMedia(item, refreshed)) {
                const blob = await retryMediaDownload(() => muxDashMedia(refreshed.dash, onProgress));
                if (refreshed.width * refreshed.height < item.width * item.height) {
                    report.fallback.push(
                        `${getDownloadReportLabel(report, item)}: ${refreshed.width}×${refreshed.height}`,
                    );
                }
                return { blob, item: { ...item, ...refreshed }, mode: 'DASH (refreshed)' };
            }
        } catch (refreshError) {
            if (refreshError.name === 'AbortError' || isDownloadRateLimited(refreshError)) throw refreshError;
            console.log(refreshError);
        }
        if (!allowFallback) throw error;
        // A refresh can also supply an unexpired progressive URL for the same media.
        const progressiveItem = refreshed ?? item;
        onProgress?.({ stage: 'Downloading fallback', percent: 0 });
        const blob = await retryMediaDownload(() => fetchProgressiveMediaBlob(progressiveItem.url, onProgress));
        const fallbackItem = {
            ...item,
            ...progressiveItem,
            width: progressiveItem.progressiveWidth || 0,
            height: progressiveItem.progressiveHeight || 0,
            videoBitrate: 0,
            videoCodec: '',
        };
        // Progressive is usually H.264, but its codec is not guaranteed by the URL.
        report.fallback.push(
            progressiveItem.progressiveWidth && progressiveItem.progressiveHeight
                ? `${getDownloadReportLabel(report, item)}: ${progressiveItem.progressiveWidth}×${progressiveItem.progressiveHeight}`
                : `${getDownloadReportLabel(report, item)}: progressive`,
        );
        return { blob, item: fallbackItem, mode: 'progressive' };
    }
}

async function collectDownloadFiles(data, media, onProgress, report) {
    setDownloadReportMedia(report, data, media);
    const files = [];
    const usedNames = new Set();
    for (let index = 0; index < media.length; index++) {
        try {
            const result = await fetchMediaWithRecovery(
                media[index],
                ({ percent }) => {
                    onProgress(((index + percent / 100) / media.length) * 95);
                },
                report,
            );
            files.push({
                title: getUniqueArchiveEntryName(getMediaFileName(data, result.item, result.blob), usedNames),
                data: result.blob,
            });
            recordDownloadedItem(report, result);
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            report.skipped++;
            report.skippedIds.push(getDownloadReportLabel(report, media[index]));
            report.errors.push(getDownloadReportLabel(report, media[index]) + ': ' + error.message);
            console.log(error);
            if (isDownloadRateLimited(error)) {
                report.stopped = true;
                break;
            }
        }
        onProgress(((index + 1) / media.length) * 95);
    }
    return files;
}
