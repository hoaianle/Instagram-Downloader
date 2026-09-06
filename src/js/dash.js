function getXmlElements(parent, localName) {
    return Array.from(parent.getElementsByTagNameNS('*', localName));
}

function parseDashManifest(manifest) {
    if (!manifest) return [];
    const xml = new DOMParser().parseFromString(manifest, 'application/xml');
    if (getXmlElements(xml, 'parsererror').length) return [];
    return getXmlElements(xml, 'Representation')
        .map((representation) => {
            const adaptationSet = representation.parentElement;
            const baseUrl = getXmlElements(representation, 'BaseURL')[0]?.textContent?.trim();
            return {
                url: baseUrl,
                codec: representation.getAttribute('codecs') || '',
                mimeType: representation.getAttribute('mimeType') || adaptationSet?.getAttribute('mimeType') || '',
                width: Number(representation.getAttribute('width') || adaptationSet?.getAttribute('width') || 0),
                height: Number(representation.getAttribute('height') || adaptationSet?.getAttribute('height') || 0),
                bandwidth: Number(
                    representation.getAttribute('bandwidth') || representation.getAttribute('FBAvgBitrate') || 0,
                ),
                contentLength: Number(representation.getAttribute('FBContentLength') || 0),
                qualityLabel: representation.getAttribute('FBQualityLabel') || '',
            };
        })
        .filter((representation) => representation.url);
}

function selectBestRepresentation(representations, type) {
    const candidates = representations.filter((representation) => representation.mimeType.startsWith(`${type}/`));
    return candidates.sort((a, b) => {
        if (type === 'video') {
            const pixelDifference = b.width * b.height - a.width * a.height;
            if (pixelDifference) return pixelDifference;
        }
        return b.bandwidth - a.bandwidth || b.contentLength - a.contentLength;
    })[0];
}

function getBestDashMedia(item) {
    const representations = parseDashManifest(item['video_dash_manifest']);
    const video = selectBestRepresentation(representations, 'video');
    const audio = selectBestRepresentation(representations, 'audio');
    if (!video) return null;
    if (item['has_audio'] === true && !audio) return null;
    return {
        videoUrl: video.url,
        audioUrl: audio?.url || null,
        videoCodec: video.codec,
        audioCodec: audio?.codec || null,
        width: video.width,
        height: video.height,
        bandwidth: video.bandwidth,
        qualityLabel: video.qualityLabel,
    };
}

function selectLargestProgressive(items) {
    return items.reduce((best, current) => {
        const bestPixels = Number(best.width || 0) * Number(best.height || 0);
        const currentPixels = Number(current.width || 0) * Number(current.height || 0);
        return currentPixels > bestPixels ? current : best;
    }, items[0]);
}

function extractMediaData(item) {
    const isVideo = item['media_type'] !== 1;
    const mediaItems = isVideo ? item['video_versions'] : item['image_versions2'].candidates;
    if (!mediaItems?.length) return null;
    const progressive = selectLargestProgressive(mediaItems);
    const dash = isVideo ? getBestDashMedia(item) : null;
    return {
        url: progressive.url,
        isVideo,
        id: item.pk,
        format: resolveMediaFormat(progressive.url) ?? (isVideo ? 'mp4' : 'jpg'),
        dash,
    };
}
