// Story and highlight selection share the same player and progress indicators.
const storyMediaSelection = (() => {
    function getCurrentStoryProgress(toolbar) {
        const segments = [...(toolbar.previousElementSibling?.children ?? [])];
        const activeIndexes = segments.reduce((indexes, segment, index) => {
            if (segment.childElementCount > 0) indexes.push(index);
            return indexes;
        }, []);
        if (activeIndexes.length === 1) {
            return { index: activeIndexes[0], count: segments.length, confident: true };
        }

        const firstPendingIndex = segments.findIndex(
            (segment) => getComputedStyle(segment).backgroundColor !== 'rgb(255, 255, 255)',
        );
        return {
            index: firstPendingIndex >= 0 ? firstPendingIndex : Math.max(segments.length - 1, 0),
            count: segments.length,
            confident: firstPendingIndex >= 0 && segments.length > 0,
        };
    }

    function getStoryMediaIdFromPath(type) {
        if (type !== 'stories') return '';
        const pathParts = window.location.pathname.split('/').filter(Boolean);
        return /^\d+$/.test(pathParts[2] ?? '') ? pathParts[2] : '';
    }

    function getVisibleStoryMedia() {
        const candidates = [...document.querySelectorAll('img, video')]
            .map((media) => ({ media, rect: media.getBoundingClientRect() }))
            .filter(
                ({ rect }) =>
                    rect.width >= 240 &&
                    rect.height >= 300 &&
                    rect.bottom > 0 &&
                    rect.right > 0 &&
                    rect.top < window.innerHeight &&
                    rect.left < window.innerWidth,
            )
            .sort((first, second) => second.rect.width * second.rect.height - first.rect.width * first.rect.height);
        const currentMedia = candidates[0]?.media;
        return {
            sourceUrl: currentMedia?.currentSrc || currentMedia?.src || '',
            posterUrl: currentMedia instanceof HTMLVideoElement ? currentMedia.poster || '' : '',
        };
    }

    function readStorySelection(toolbar, type) {
        const progress = getCurrentStoryProgress(toolbar);
        const media = getVisibleStoryMedia();
        return {
            mediaId: getStoryMediaIdFromPath(type),
            ...media,
            index: progress.index,
            itemCount: progress.count,
            indexConfident: progress.confident,
        };
    }

    function selectionsMatch(first, second) {
        return (
            first.mediaId === second.mediaId &&
            first.sourceUrl === second.sourceUrl &&
            first.posterUrl === second.posterUrl &&
            first.index === second.index &&
            first.itemCount === second.itemCount
        );
    }

    async function getStableStorySelection(toolbar, type) {
        /**
         * During navigation, Instagram can update the URL, carousel/progress indicators, and visible media across separate render frames.
         * Retry briefly until two consecutive reads agree instead of failing on the first transitional frame.
         */
        let previous = readStorySelection(toolbar, type);
        for (let attempt = 0; attempt < 5; attempt++) {
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const current = readStorySelection(toolbar, type);
            if (selectionsMatch(previous, current)) {
                return {
                    ...current,
                    stable: true,
                    indexConfident: previous.indexConfident && current.indexConfident,
                };
            }
            previous = current;
        }
        return {
            ...previous,
            stable: false,
            indexConfident: false,
        };
    }

    return { getStableStorySelection };
})();

function resolveSelectedStoryMedia(data, selection) {
    if (!selection) return null;

    const selectedMediaId = getMediaId(selection.mediaId);
    if (selectedMediaId) {
        const mediaById = data.media.find((item) => getMediaId(item.id) === selectedMediaId);
        if (mediaById) return mediaById;
    }

    const mediaBySource = findMediaByRenderedUrl(data, selection.sourceUrl);
    if (mediaBySource) return mediaBySource;

    const mediaByPoster = findMediaByRenderedUrl(data, selection.posterUrl);
    if (mediaByPoster) return mediaByPoster;

    if (!selection.stable) return null;

    const index = Number(selection.index);
    const itemCount = Number(selection.itemCount);
    if (
        selection.indexConfident &&
        Number.isInteger(index) &&
        index >= 0 &&
        index < data.media.length &&
        itemCount === data.media.length
    ) {
        return data.media[index];
    }

    return null;
}
