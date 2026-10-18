// Highlight-specific API request. Normalization remains shared with stories.
async function getHighlightStory(highlightsId) {
    try {
        setPreferredMediaResolutionCookies();
        const apiURL = new URL('/graphql/query', IG_BASE_URL);
        const fetchOptions = getFetchOptions();
        fetchOptions['method'] = 'POST';
        fetchOptions.headers['content-type'] = 'application/x-www-form-urlencoded';
        fetchOptions.headers['x-fb-friendly-name'] = 'PolarisStoriesV3HighlightsPageQuery';
        fetchOptions.body = new URLSearchParams({
            fb_dtsg: getFbDtsg(),
            fb_api_caller_class: 'RelayModern',
            fb_api_req_friendly_name: 'PolarisStoriesV3HighlightsPageQuery',
            doc_id: '28325328583775973',
            variables: JSON.stringify({
                initial_reel_id: `highlight:${highlightsId}`,
                reel_ids: [`highlight:${highlightsId}`],
                first: 3,
                last: 2,
                __relay_internal__pv__PolarisCommunityNoteStoriesLabelEnabledrelayprovider: true,
            }),
            server_timestamps: true,
        }).toString();
        const respone = await fetch(apiURL.href, fetchOptions);
        const json = await respone.json();
        return json.data['xdt_api__v1__feed__reels_media__connection'].edges[0].node;
    } catch (error) {
        console.log(error);
        return null;
    }
}

async function downloadHighlightPhotos() {
    if (!appState.current.highlights) return null;
    const json = await getHighlightStory(appState.current.highlights);
    return normalizeStoryDownloadData(json, 'highlights');
}
