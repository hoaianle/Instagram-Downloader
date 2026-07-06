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

async function downloadStoryPhotos(type = 'stories') {
    let json = null;
    if (type === 'highlights') {
        if (!appState.current.highlights) return null;
        json = await getHighlightStory(appState.current.highlights);
    } else {
        const userId = await getUserId(appState.current.username);
        if (!userId) return null;
        json = await getStoryPhotos(userId);
    }
    if (!json) return null;
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
        const media = {
            url: largestMediaItem.url,
            isVideo: isVideo,
            id: item.pk,
        };
        data.media.push(media);
    });
    return data;
}
