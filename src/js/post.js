function convertToPostId(shortcode) {
    let id = BigInt(0);
    for (let i = 0; i < shortcode.length; i++) {
        let char = shortcode[i];
        id = id * BigInt(64) + BigInt(IG_SHORTCODE_ALPHABET.indexOf(char));
    }
    return id.toString(10);
}

function convertToShortcode(postId) {
    let id = BigInt(postId);
    let shortcode = '';
    while (id > BigInt(0)) {
        const remainder = id % BigInt(64);
        shortcode = IG_SHORTCODE_ALPHABET[Number(remainder)] + shortcode;
        id = id / BigInt(64);
        id = id - (id % BigInt(1));
    }
    return shortcode;
}

async function getPostIdFromApi() {
    const cachedPostId = appCache.postIdInfoCache.get(appState.current.shortcode);
    if (cachedPostId) return cachedPostId;
    const apiURL = new URL('/graphql/query/', IG_BASE_URL);
    const fetchOptions = getFetchOptions();
    fetchOptions['method'] = 'POST';
    fetchOptions.headers['content-type'] = 'application/x-www-form-urlencoded';
    fetchOptions.headers['x-fb-friendly-name'] = 'PolarisPostActionLoadPostQueryQuery';
    fetchOptions.body = new URLSearchParams({
        fb_api_caller_class: 'RelayModern',
        fb_api_req_friendly_name: 'PolarisPostActionLoadPostQueryQuery',
        doc_id: '8845758582119845',
        variables: JSON.stringify({
            shortcode: appState.current.shortcode,
        }),
    }).toString();
    try {
        const respone = await fetch(apiURL.href, fetchOptions);
        const json = await respone.json();
        return json.data['xdt_shortcode_media'].id;
    } catch (error) {
        console.log(error);
        return null;
    }
}

async function getPostPhotos(shortcode) {
    const postId = convertToPostId(shortcode);
    const apiURL = new URL(`/api/v1/media/${postId}/info/`, IG_BASE_URL);
    try {
        setPreferredMediaResolutionCookies();
        let respone = await fetch(apiURL.href, getFetchOptions());
        if (respone.status === 400) {
            const postId = await getPostIdFromApi();
            if (!postId) throw new Error('Network bug');
            const apiURL = new URL(`/api/v1/media/${postId}/info/`, IG_BASE_URL);
            respone = await fetch(apiURL.href, getFetchOptions());
        }
        const json = await respone.json();
        return json.items[0];
    } catch (error) {
        console.log(error);
        return null;
    }
}

async function downloadPostPhotos() {
    if (!appState.current.shortcode) return null;
    const json = await getPostPhotos(appState.current.shortcode);
    if (!json) return null;
    const data = {
        date: json['taken_at'],
        user: {
            username: json.user['username'],
        },
        media: [],
    };
    function extractMediaData(item) {
        const isVideo = item['media_type'] !== 1;
        const mediaItems = isVideo ? item['video_versions'] : item['image_versions2'].candidates;
        const largestMediaItem = mediaItems.reduce((accumulator, currentValue) => {
            if (accumulator.width * accumulator.height > currentValue.width * currentValue.height) return accumulator;
            return currentValue;
        }, mediaItems[0]);
        const media = {
            url: largestMediaItem.url,
            isVideo,
            id: item.pk,
        };
        return media;
    }
    if (json['carousel_media']) data.media = json['carousel_media'].map(extractMediaData);
    else data.media.push(extractMediaData(json));
    return data;
}
