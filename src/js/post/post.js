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

async function getPostPhotos(shortcode) {
    const apiURL = new URL('/graphql/query', IG_BASE_URL);
    const fetchOptions = getFetchOptions();
    fetchOptions['method'] = 'POST';
    fetchOptions.headers['content-type'] = 'application/x-www-form-urlencoded';
    fetchOptions.headers['x-fb-friendly-name'] = 'PolarisPostRootQuery';
    fetchOptions.body = new URLSearchParams({
        fb_dtsg: getFbDtsg(),
        fb_api_caller_class: 'RelayModern',
        fb_api_req_friendly_name: 'PolarisPostRootQuery',
        doc_id: IG_POST_ROOT_QUERY_DOC_ID,
        variables: JSON.stringify({
            shortcode,
            __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: false,
            __relay_internal__pv__PolarisMultiCaptionCarouselEnabledrelayprovider: false,
        }),
        server_timestamps: true,
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

async function downloadPostPhotos(shortcode = appState.current.shortcode) {
    if (!shortcode) return null;
    const json = await getPostPhotos(shortcode);
    if (!json) return null;
    const data = {
        type: DOWNLOAD_FILENAME_SCOPES.POST,
        id: String(json.pk ?? convertToPostId(shortcode)),
        date: json['taken_at'],
        title: json.caption?.text?.split('\n')[0] || '',
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
