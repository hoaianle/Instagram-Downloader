const VIDEO_DOWNLOAD_MODES = Object.freeze({
    HIGHEST: 'highest',
    H264: 'h264',
});
const VIDEO_DOWNLOAD_MODE_STORAGE_KEY = 'instagramDownloaderVideoMode';
const VIDEO_DOWNLOAD_FALLBACK_STORAGE_KEY = 'instagramDownloaderVideoFallback';

const videoDownloadPreferences = Object.freeze(
    (() => {
        function getDefaultMode() {
            const platform = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '';
            return /mac/i.test(platform) ? VIDEO_DOWNLOAD_MODES.H264 : VIDEO_DOWNLOAD_MODES.HIGHEST;
        }

        function getSavedMode() {
            try {
                const savedMode = localStorage.getItem(VIDEO_DOWNLOAD_MODE_STORAGE_KEY);
                return Object.values(VIDEO_DOWNLOAD_MODES).includes(savedMode) ? savedMode : getDefaultMode();
            } catch (error) {
                return getDefaultMode();
            }
        }

        let mode = getSavedMode();
        let fallbackEnabled = true;
        try {
            fallbackEnabled = localStorage.getItem(VIDEO_DOWNLOAD_FALLBACK_STORAGE_KEY) !== 'false';
        } catch (error) {
            // Keep fallback available when storage is inaccessible.
        }

        return {
            get mode() {
                return mode;
            },
            setMode(value) {
                if (!Object.values(VIDEO_DOWNLOAD_MODES).includes(value) || value === mode) return;
                mode = value;
                try {
                    localStorage.setItem(VIDEO_DOWNLOAD_MODE_STORAGE_KEY, mode);
                } catch (error) {
                    console.log(error);
                }
            },
            usesProgressive() {
                return mode === VIDEO_DOWNLOAD_MODES.H264;
            },
            get fallbackEnabled() {
                return fallbackEnabled;
            },
            setFallbackEnabled(value) {
                fallbackEnabled = Boolean(value);
                try {
                    localStorage.setItem(VIDEO_DOWNLOAD_FALLBACK_STORAGE_KEY, String(fallbackEnabled));
                } catch (error) {
                    console.log(error);
                }
            },
        };
    })(),
);
