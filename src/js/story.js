async function getUserIdFromSearch(username) {
    if (appCache.userIdsCache.has(username)) return appCache.userIdsCache.get(username);
    const apiURL = new URL('/web/search/topsearch/', IG_BASE_URL);
    if (username) apiURL.searchParams.set('query', username);
    else apiURL.searchParams.set('query', appState.current.username);
    try {
        const respone = await fetch(apiURL.href);
        const json = await respone.json();
        return json.users[0].user['pk_id'];
    } catch (error) {
        console.log(error);
        return '';
    }
}

async function getUserId(username) {
    if (appCache.userIdsCache.has(username)) return appCache.userIdsCache.get(username);
    const apiURL = new URL('/api/v1/users/web_profile_info/', IG_BASE_URL);
    if (username) apiURL.searchParams.set('username', username);
    else apiURL.searchParams.set('username', appState.current.username);
    try {
        const respone = await fetch(apiURL.href, getFetchOptions());
        const json = await respone.json();
        return json.data.user['id'];
    } catch (error) {
        console.log(error);
        return '';
    }
}

async function getStoryPhotos(userId) {
    const apiURL = new URL('/api/v1/feed/reels_media/', IG_BASE_URL);
    apiURL.searchParams.set('reel_ids', userId);
    try {
        setPreferredMediaResolutionCookies();
        const respone = await fetch(apiURL.href, getFetchOptions());
        const json = await respone.json();
        return json.reels[userId];
    } catch (error) {
        console.log(error);
        return null;
    }
}

async function getHighlightStory(highlightsId) {
    const apiURL = new URL('/api/v1/feed/reels_media/', IG_BASE_URL);
    apiURL.searchParams.set('reel_ids', `highlight:${highlightsId}`);
    try {
        setPreferredMediaResolutionCookies();
        const respone = await fetch(apiURL.href, getFetchOptions());
        const json = await respone.json();
        return json.reels[`highlight:${highlightsId}`];
    } catch (error) {
        console.log(error);
        return null;
    }
}

function extractStoryMediaData(json) {
    const data = {
        date: json.items[0]['taken_at'],
        user: {
            username: json.user['username'],
        },
        media: [],
    };
    json.items.forEach((item) => {
        const isVideo = item['media_type'] !== 1;
        const mediaItems = isVideo ? item['video_versions'] : item['image_versions2'].candidates;
        const largestMediaItem = mediaItems.reduce((accumulator, currentValue) => {
            if (accumulator.width > currentValue.width) return accumulator;
            return currentValue;
        }, mediaItems[0]);
        data.media.push({
            url: largestMediaItem.url,
            isVideo: isVideo,
            id: item.pk,
        });
    });
    return data;
}

async function fetchStoryMediaData(username) {
    const cacheKey = `stories:${username}`;
    if (appCache.mediaDataCache.has(cacheKey)) return appCache.mediaDataCache.get(cacheKey);
    const userId = await getUserId(username);
    if (!userId) return null;
    const json = await getStoryPhotos(userId);
    if (!json) return null;
    const data = extractStoryMediaData(json);
    appCache.mediaDataCache.set(cacheKey, data);
    return data;
}

async function fetchHighlightMediaData(highlightsId) {
    const cacheKey = `highlight:${highlightsId}`;
    if (appCache.mediaDataCache.has(cacheKey)) return appCache.mediaDataCache.get(cacheKey);
    const json = await getHighlightStory(highlightsId);
    if (!json) return null;
    const data = extractStoryMediaData(json);
    appCache.mediaDataCache.set(cacheKey, data);
    return data;
}

async function downloadStoryPhotos(type = 'stories') {
    if (type === 'highlights') {
        if (!appState.current.highlights) return null;
        return fetchHighlightMediaData(appState.current.highlights);
    }
    if (!appState.current.username) return null;
    return fetchStoryMediaData(appState.current.username);
}
