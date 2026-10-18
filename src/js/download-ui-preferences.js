const DOWNLOAD_UI_MODES = Object.freeze({
    PANEL: 'panel',
    INLINE: 'inline',
    BOTH: 'both',
});
const DOWNLOAD_UI_MODE_STORAGE_KEY = 'instagramDownloaderUiMode';

/**
 * Central display preference for download controls.
 *
 * The settings screen can call setMode() later without changing the
 * individual post, Reel, or Story button implementations.
 */
const downloadUiPreferences = Object.freeze(
    (() => {
        function getSavedMode() {
            try {
                const savedMode = localStorage.getItem(DOWNLOAD_UI_MODE_STORAGE_KEY);
                return Object.values(DOWNLOAD_UI_MODES).includes(savedMode) ? savedMode : DOWNLOAD_UI_MODES.INLINE;
            } catch (error) {
                return DOWNLOAD_UI_MODES.INLINE;
            }
        }

        let mode = getSavedMode();

        return {
            get mode() {
                return mode;
            },
            setMode(value) {
                if (!Object.values(DOWNLOAD_UI_MODES).includes(value) || value === mode) return;
                mode = value;
                try {
                    localStorage.setItem(DOWNLOAD_UI_MODE_STORAGE_KEY, mode);
                } catch (error) {
                    console.log(error);
                }
                window.dispatchEvent(new CustomEvent('downloadUiModeChange', { detail: { mode } }));
            },
            shows(surface) {
                if (surface === 'panel') return mode === DOWNLOAD_UI_MODES.PANEL || mode === DOWNLOAD_UI_MODES.BOTH;
                if (surface === 'inline') return mode === DOWNLOAD_UI_MODES.INLINE || mode === DOWNLOAD_UI_MODES.BOTH;
                return false;
            },
        };
    })(),
);

const downloadNotificationPreferences = Object.freeze({
    get durationSeconds() {
        try {
            const value = Number(localStorage.getItem('instagramDownloaderNotificationSeconds'));
            return Number.isInteger(value) && value >= 1 && value <= 15 ? value : 5;
        } catch {
            return 5;
        }
    },
    setDurationSeconds(value) {
        const seconds = Number(value);
        if (!Number.isInteger(seconds) || seconds < 1 || seconds > 15) return;
        try {
            localStorage.setItem('instagramDownloaderNotificationSeconds', String(seconds));
        } catch (error) {
            console.log(error);
        }
    },
    get enabled() {
        try {
            return localStorage.getItem('instagramDownloaderNotifications') === 'true';
        } catch {
            return false;
        }
    },
    setEnabled(enabled) {
        try {
            localStorage.setItem('instagramDownloaderNotifications', String(Boolean(enabled)));
        } catch (error) {
            console.log(error);
        }
    },
});
