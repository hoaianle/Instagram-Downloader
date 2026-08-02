function saveFile(blob, fileName) {
    const a = document.createElement('a');
    a.download = fileName;
    a.href = URL.createObjectURL(blob);
    a.click();
    URL.revokeObjectURL(a.href);
}

/**
 * The Instagram backend determines the maximum image resolution to return
 * based on the `wd` and `dpr` cookies.
 */
function setPreferredMediaResolutionCookies() {
    // 3840 × 2160
    const width = 3840 / 2;
    const height = 2160 / 2 - 100;
    const dpr = 2; // device pixel ratio
    Cookies.set('wd', `${width}x${height}`);
    Cookies.set('dpr', dpr);
}

function getFetchOptions() {
    return {
        headers: {
            // Hardcode variable: a="129477";f.ASBD_ID=a in JS, can be remove
            // 'x-asbd-id': '129477',
            'x-csrftoken': Cookies.get('csrftoken'),
            'x-ig-app-id': '936619743392459',
            'x-ig-www-claim': sessionStorage.getItem('www-claim-v2'),
            // 'x-instagram-ajax': '1006598911',
            'x-requested-with': 'XMLHttpRequest',
        },
        referrer: window.location.href,
        referrerPolicy: 'strict-origin-when-cross-origin',
        method: 'GET',
        mode: 'cors',
        credentials: 'include',
    };
}

function getValueByKey(obj, key) {
    if (typeof obj !== 'object' || obj === null) return null;
    const stack = [obj];
    const visited = new Set();
    while (stack.length) {
        const current = stack.pop();
        if (visited.has(current)) continue;
        visited.add(current);
        try {
            if (current[key] !== undefined) return current[key];
        } catch (error) {
            if (error.name === 'SecurityError') continue;
            console.log(error);
        }
        for (const value of Object.values(current)) {
            if (typeof value === 'object' && value !== null) {
                stack.push(value);
            }
        }
    }
    return null;
}

async function saveMediaItem(item, fileName) {
    try {
        const respone = await fetch(item.url);
        const blob = await respone.blob();
        saveFile(blob, fileName);
    } catch (error) {
        console.log(error);
    }
}
