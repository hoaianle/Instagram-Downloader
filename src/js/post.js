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

const IG_POST_ROOT_QUERY_DOC_ID = '27852811784380813';

/**
 * Instagram embeds the LSD and DTSG tokens in inline scripts of the
 * server-rendered HTML. GraphQL POSTs without them get an HTML page back.
 */
function getWebSessionTokens() {
    const tokens = { lsd: null, dtsg: null };
    for (const script of document.querySelectorAll('script')) {
        const text = script.textContent;
        if (!tokens.lsd) tokens.lsd = text.match(/\["LSD",\[\],\{"token":"([^"]+)"\}/)?.[1] ?? null;
        if (!tokens.dtsg)
            tokens.dtsg =
                text.match(/\["DTSGInitData",\[\],\{"token":"([^"]+)"/)?.[1] ??
                text.match(/\["DTSGInitialData",\[\],\{"token":"([^"]+)"/)?.[1] ??
                null;
        if (tokens.lsd && tokens.dtsg) break;
    }
    return tokens;
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
    const apiURL = new URL('/graphql/query', IG_BASE_URL);
    const { lsd, dtsg } = getWebSessionTokens();
    const fetchOptions = getFetchOptions();
    fetchOptions['method'] = 'POST';
    fetchOptions.headers['content-type'] = 'application/x-www-form-urlencoded';
    fetchOptions.headers['x-fb-friendly-name'] = 'PolarisPostRootQuery';
    fetchOptions.headers['x-asbd-id'] = '129477';
    if (lsd) fetchOptions.headers['x-fb-lsd'] = lsd;
    fetchOptions.body = new URLSearchParams({
        __d: 'www',
        __user: '0',
        __a: '1',
        __req: '1',
        __comet_req: '7',
        fb_dtsg: dtsg ?? '',
        lsd: lsd ?? '',
        fb_api_caller_class: 'RelayModern',
        fb_api_req_friendly_name: 'PolarisPostRootQuery',
        server_timestamps: 'true',
        doc_id: IG_POST_ROOT_QUERY_DOC_ID,
        variables: JSON.stringify({
            shortcode,
            __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: false,
            __relay_internal__pv__PolarisMultiCaptionCarouselEnabledrelayprovider: false,
        }),
    }).toString();
    try {
        setPreferredMediaResolutionCookies();
        const respone = await fetch(apiURL.href, fetchOptions);
        const json = await respone.json();
        return json.data['xdt_api__v1__media__shortcode__web_info'].items[0];
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
    if (json['carousel_media']) data.media = json['carousel_media'].map(extractMediaData).filter(Boolean);
    else {
        const media = extractMediaData(json);
        if (media) data.media.push(media);
    }
    return data;
}
