// Refresh only the failed media, using the existing logged-in Instagram session.
async function refreshLegacyMedia(item) {
    const id = getMediaId(item.id);
    if (!/^\d+$/.test(id)) return null;
    const url = new URL(`/api/v1/media/${id}/info/`, IG_BASE_URL);
    const options = getFetchOptions();
    options.method = 'GET';
    const response = await fetch(url.href, options);
    if (!response.ok) {
        const error = new Error(`Media info request failed (${response.status})`);
        error.status = response.status;
        throw error;
    }
    const json = await response.json();
    const candidates = (json.items ?? []).flatMap((entry) => [entry, ...(entry.carousel_media ?? [])]);
    const match = candidates.find((entry) => getMediaId(entry.pk ?? entry.id) === id);
    return match ? extractMediaData(match) : null;
}

function hasFreshDashMedia(original, refreshed) {
    if (!refreshed?.isVideo || !refreshed.dash) return false;
    return refreshed.dash.videoUrl !== original.dash.videoUrl || refreshed.dash.audioUrl !== original.dash.audioUrl;
}
