const DASH_MUXER_MESSAGE_SOURCE = 'instagram-downloader-muxer';
let dashMuxerFrame = null;
let dashMuxerReadyPromise = null;
let dashMuxerRequestId = 0;
const dashMuxerRequests = new Map();

function ensureDashMuxer() {
    if (dashMuxerReadyPromise) return dashMuxerReadyPromise;
    dashMuxerReadyPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Muxer failed to load')), 15000);
        dashMuxerFrame = document.createElement('iframe');
        dashMuxerFrame.hidden = true;
        dashMuxerFrame.src = chrome.runtime.getURL('src/muxer/muxer-frame.html');
        dashMuxerFrame.setAttribute('aria-hidden', 'true');
        function handleReady(event) {
            if (event.source !== dashMuxerFrame.contentWindow) return;
            if (event.data?.source !== DASH_MUXER_MESSAGE_SOURCE || event.data.type !== 'ready') return;
            clearTimeout(timeout);
            window.removeEventListener('message', handleReady);
            resolve();
        }
        window.addEventListener('message', handleReady);
        document.documentElement.appendChild(dashMuxerFrame);
    });
    return dashMuxerReadyPromise;
}

window.addEventListener('message', (event) => {
    if (!dashMuxerFrame || event.source !== dashMuxerFrame.contentWindow) return;
    if (event.data?.source !== DASH_MUXER_MESSAGE_SOURCE) return;
    const pending = dashMuxerRequests.get(event.data.requestId);
    if (!pending) return;
    if (event.data.type === 'progress') {
        pending.onProgress?.(event.data.stage);
        return;
    }
    dashMuxerRequests.delete(event.data.requestId);
    if (event.data.type === 'result') pending.resolve(event.data.blob);
    else pending.reject(new Error(event.data.message || 'Muxing failed'));
});

async function muxDashMedia(dash, onProgress) {
    await ensureDashMuxer();
    const requestId = ++dashMuxerRequestId;
    return new Promise((resolve, reject) => {
        dashMuxerRequests.set(requestId, { resolve, reject, onProgress });
        dashMuxerFrame.contentWindow.postMessage(
            {
                source: DASH_MUXER_MESSAGE_SOURCE,
                type: 'mux',
                requestId,
                videoUrl: dash.videoUrl,
                audioUrl: dash.audioUrl,
            },
            new URL(dashMuxerFrame.src).origin,
        );
    });
}
