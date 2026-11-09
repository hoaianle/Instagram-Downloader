async function getUserIdFromSearch(username) {
    if (appCache.userIdsCache.has(username)) return appCache.userIdsCache.get(username);
    const query = username || appState.current.username;
    try {
        const apiURL = new URL('/graphql/query', IG_BASE_URL);
        const fetchOptions = getFetchOptions();
        fetchOptions['method'] = 'POST';
        fetchOptions.headers['content-type'] = 'application/x-www-form-urlencoded';
        fetchOptions.headers['x-fb-friendly-name'] = 'PolarisSearchBoxRefetchableQuery';
        fetchOptions.body = new URLSearchParams({
            fb_dtsg: getFbDtsg(),
            fb_api_caller_class: 'RelayModern',
            fb_api_req_friendly_name: 'PolarisSearchBoxRefetchableQuery',
            doc_id: '27706427925724183',
            variables: JSON.stringify({
                data: {
                    context: 'blended',
                    include_reel: 'true',
                    query: username,
                    rank_token: '',
                    search_surface: 'web_top_search',
                },
                hasQuery: true,
            }),
            server_timestamps: true,
        }).toString();
        const respone = await fetch(apiURL.href, fetchOptions);
        const json = await respone.json();
        const users = json.data['xdt_api__v1__fbsearch__topsearch_connection'].users;
        const exactMatch = users.find((item) => item.user['username'] === query);
        return (exactMatch ?? users[0]).user['id'];
    } catch (error) {
        console.log(error);
        return '';
    }
}

async function getStoryPhotos(userId) {
    try {
        setPreferredMediaResolutionCookies();
        const apiURL = new URL('/graphql/query', IG_BASE_URL);
        const fetchOptions = getFetchOptions();
        fetchOptions['method'] = 'POST';
        fetchOptions.headers['content-type'] = 'application/x-www-form-urlencoded';
        fetchOptions.headers['x-fb-friendly-name'] = 'PolarisStoriesV3ReelPageGalleryQuery';
        fetchOptions.body = new URLSearchParams({
            fb_dtsg: getFbDtsg(),
            fb_api_caller_class: 'RelayModern',
            fb_api_req_friendly_name: 'PolarisStoriesV3ReelPageGalleryQuery',
            doc_id: '28262315486766731',
            variables: JSON.stringify({
                initial_reel_id: userId,
                reel_ids: [userId],
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

async function downloadStoryPhotos(type = 'stories') {
    let json = null;
    if (type === 'highlights') {
        if (!appState.current.highlights) return null;
        json = await getHighlightStory(appState.current.highlights);
    } else {
        const userId = await getUserIdFromSearch(appState.current.username);
        if (!userId) return null;
        json = await getStoryPhotos(userId);
    }
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
