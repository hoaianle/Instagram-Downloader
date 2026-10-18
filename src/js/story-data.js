// Shared normalization for stories and highlights; preserves filename and media metadata.
function normalizeStoryDownloadData(json, type) {
    if (!json?.items?.length) return null;
    const data = {
        type: type === 'highlights' ? DOWNLOAD_FILENAME_SCOPES.HIGHLIGHTS : DOWNLOAD_FILENAME_SCOPES.STORIES,
        id: String(
            type === 'highlights' ? appState.current.highlights : (json.id ?? json.user?.pk ?? json.user?.pk_id ?? ''),
        ),
        date: json.items[0]['taken_at'],
        title: type === 'highlights' ? json.title || json.reel_title || '' : '',
        user: {
            username: json.user['username'],
        },
        media: [],
    };
    json.items.forEach((item) => {
        const media = extractMediaData(item);
        if (media) data.media.push(media);
    });
    return data;
}
