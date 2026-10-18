function getUserIdFromLoadedStory(username) {
    return new Promise((resolve) => {
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const timer = setTimeout(() => finish(''), 800);
        function finish(id) {
            clearTimeout(timer);
            window.removeEventListener('igd-story-owner-result', onResult);
            resolve(id);
        }
        function onResult(event) {
            const detail = event.detail;
            if (detail?.requestId !== requestId || detail.username !== username) return;
            const id = String(detail.id ?? '');
            finish(/^\d+$/.test(id) ? id : '');
        }
        window.addEventListener('igd-story-owner-result', onResult);
        window.dispatchEvent(new CustomEvent('igd-request-story-owner', { detail: { username, requestId } }));
    });
}

async function getUserIdFromSearch(username) {
    const query = String(username || appState.current.username || '').trim();
    if (!query) return '';
    if (appCache.userIdsCache.has(query)) {
        const id = appCache.userIdsCache.get(query);
        return id;
    }
    const loadedId = await getUserIdFromLoadedStory(query);
    if (loadedId) {
        appCache.userIdsCache.set(query, loadedId);
        return loadedId;
    }
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
                    query,
                    rank_token: '',
                    search_surface: 'web_top_search',
                },
                hasQuery: true,
            }),
            server_timestamps: true,
        }).toString();
        const respone = await fetch(apiURL.href, fetchOptions);
        if ([401, 403, 429].includes(respone.status)) return '';
        if (!respone.ok) throw new Error(`User search failed (${respone.status})`);
        const json = await respone.json();
        const users = json.data?.['xdt_api__v1__fbsearch__topsearch_connection']?.users ?? [];
        const exactMatch = users.find((item) => item.user?.username?.toLowerCase() === query.toLowerCase());
        const id = String(exactMatch?.user?.id ?? exactMatch?.user?.pk ?? '');
        if (/^\d+$/.test(id)) {
            appCache.userIdsCache.set(query, id);
            return id;
        }
    } catch (error) {
        console.log(error);
    }
    // Search is ranked and may omit the requested account. Never use a similar account.
    return getUserIdFromProfile(query);
}

async function getUserIdFromProfile(username) {
    try {
        const url = new URL('/api/v1/users/web_profile_info/', IG_BASE_URL);
        url.searchParams.set('username', username);
        const response = await fetch(url.href, getFetchOptions());
        if (!response.ok) return '';
        const json = await response.json();
        const user = json.data?.user;
        if (user?.username?.toLowerCase() !== username.toLowerCase()) return '';
        const id = String(user.id ?? user.pk ?? '');
        if (!/^\d+$/.test(id)) return '';
        appCache.userIdsCache.set(username, id);
        return id;
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
        return json.data?.['xdt_api__v1__feed__reels_media__connection']?.edges?.[0]?.node ?? null;
    } catch (error) {
        console.log(error);
        return null;
    }
}

async function downloadStoryPhotos(type = 'stories') {
    if (type === 'highlights') return downloadHighlightPhotos();
    const username = String(appState.current.username || '');
    const userId = await getUserIdFromSearch(username);
    if (!userId) return null;
    const json = await getStoryPhotos(userId);
    if (json?.user?.username?.toLowerCase() !== username.toLowerCase()) return null;
    return normalizeStoryDownloadData(json, 'stories');
}
