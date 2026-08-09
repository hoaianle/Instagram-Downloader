const IG_BASE_URL = window.location.origin + '/';
/**
 * @deprecated
 */
const IG_PROFILE_HASH = '69cba40317214236af40e7efa697781d';
/**
 * @deprecated
 */
const IG_POST_HASH = '9f8827793ef34641b2fb195d4d41151c';

const IG_SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const IG_POST_REGEX = /\/(p|tv|reel|reels)\/([A-Za-z0-9_-]*)(\/?)/;
const IG_STORY_REGEX = /\/(stories)\/(.*?)\/(\d*)(\/?)/;
const IG_HIGHLIGHT_REGEX = /\/(stories)\/(highlights)\/(\d*)(\/?)/;

const APP_NAME = `${chrome.runtime.getManifest().name} v${chrome.runtime.getManifest().version}`;

const appCache = Object.freeze({
    /**
     * Cache user id, reduce one api call to get id from username
     *
     * username => id
     */
    userIdsCache: new Map(),
    /**
     * Cache post id, reduce one api call to get post id from shortcode.
     *
     * Only for private profile, check out  post-modal-view-handler.js
     *
     * shortcode => post_id
     */
    postIdInfoCache: new Map(),
});

const appState = Object.freeze(
    (() => {
        let currentDisplay = '';
        let isSelecting = false;
        let extensionHidden = false;
        let data = null;
        const selected = new Set();
        const current = {
            shortcode: '',
            username: '',
            highlights: '',
        };
        const previous = {
            shortcode: '',
            username: '',
            highlights: '',
        };
        window.addEventListener('shortcodeChange', (e) => {
            current.shortcode = e.detail.code;
        });
        return {
            get currentDisplay() {
                return currentDisplay;
            },
            set currentDisplay(value) {
                if (['post', 'stories', 'highlights'].includes(value)) currentDisplay = value;
            },
            get isSelecting() {
                return isSelecting;
            },
            set isSelecting(value) {
                isSelecting = value;
            },
            get extensionHidden() {
                return extensionHidden;
            },
            set extensionHidden(value) {
                extensionHidden = value;
            },
            get data() {
                return data;
            },
            set data(value) {
                data = value;
                selected.clear();
                isSelecting = false;
            },
            get selected() {
                return selected;
            },
            toggleSelected(index) {
                if (selected.has(index)) selected.delete(index);
                else selected.add(index);
            },
            selectAll() {
                if (!data) return;
                if (selected.size === data.media.length) selected.clear();
                else {
                    data.media.forEach((_, index) => {
                        selected.add(index);
                    });
                }
            },
            current: Object.freeze({
                get shortcode() {
                    return current.shortcode;
                },
                set shortcode(value) {
                    current.shortcode = value;
                    downloadPostPhotos().then((data) => {
                        renderMedia(data);
                        currentDisplay = 'post';
                    });
                },
                get username() {
                    return current.username;
                },
                set username(value) {
                    current.username = value;
                    downloadStoryPhotos('stories').then((data) => {
                        renderMedia(data);
                        currentDisplay = 'stories';
                    });
                },
                get highlights() {
                    return current.highlights;
                },
                set highlights(value) {
                    current.highlights = value;
                    downloadStoryPhotos('highlights').then((data) => {
                        renderMedia(data);
                        currentDisplay = 'hightlights';
                    });
                },
            }),
            setCurrentShortcode() {
                const page = window.location.pathname.match(IG_POST_REGEX);
                if (page) current.shortcode = page[2];
            },
            setCurrentUsername() {
                const page = window.location.pathname.match(IG_STORY_REGEX);
                if (page && page[2] !== 'highlights') current.username = page[2];
            },
            setCurrentHightlightsId() {
                const page = window.location.pathname.match(IG_HIGHLIGHT_REGEX);
                if (page) current.highlights = page[3];
            },
            setPreviousValues() {
                Object.keys(current).forEach((key) => {
                    previous[key] = current[key];
                });
            },
            getFieldChange() {
                if (current.highlights !== previous.highlights) return 'highlights';
                if (current.username !== previous.username) return 'stories';
                if (current.shortcode !== previous.shortcode) return 'post';
                return 'none';
            },
        };
    })(),
);

(() => {
    function createElement(htmlString) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, 'text/html').body;
        const fragment = document.createDocumentFragment();
        fragment.append(...doc.childNodes);
        return fragment;
    }
    function initUI() {
        document.body.appendChild(
            createElement(
                `<div class="display-container hide">
                    <div class="title-container">
                        <span title="${APP_NAME}">Media</span>
                        <button class="esc-button">&times</button>
                    </div>
                    <div class="media-container">
                        <p style="position: absolute;top: 50%;transform: translate(0%, -50%);">
                            Nothing to download
                        </p>
                    </div>
                </div>
                <button title="Shift+D" class="download-button">Download</button>
                <div class="group-download-media hide">
                    <button>Save as zip</button>
                    <button>Save all</button>
                </div>`,
            ),
        );
    }
    function handleEvents() {
        const ESC_BUTTON = document.querySelector('.esc-button');
        const TITLE_CONTAINER = document.querySelector('.title-container').firstElementChild;
        const DISPLAY_CONTAINER = document.querySelector('.display-container');
        const DOWNLOAD_BUTTON = document.querySelector('.download-button');
        const GROUP_DOWNLOAD_MEDIA = document.querySelector('.group-download-media');
        const IGNORE_FOCUS_ELEMENTS = ['INPUT', 'TEXTAREA'];
        const ESC_EVENT_KEYS = ['Escape', 'C'];
        const DOWNLOAD_EVENT_KEYS = ['D'];
        const SELECT_EVENT_KEYS = ['S'];
        function setTheme() {
            const isDarkMode =
                localStorage.getItem('igt') === null
                    ? window.matchMedia('(prefers-color-scheme: dark)').matches
                    : localStorage.getItem('igt') === 'dark';
            if (isDarkMode) {
                DISPLAY_CONTAINER.classList.add('dark');
                DISPLAY_CONTAINER.firstElementChild.classList.add('dark');
            } else {
                DISPLAY_CONTAINER.classList.remove('dark');
                DISPLAY_CONTAINER.firstElementChild.classList.remove('dark');
            }
        }
        function pauseVideo() {
            if (DISPLAY_CONTAINER.classList.contains('hide')) {
                DISPLAY_CONTAINER.querySelectorAll('video').forEach((video) => {
                    video.pause();
                });
            }
        }
        function toggleSelectMode() {
            appState.isSelecting = !appState.isSelecting;
            if (appState.isSelecting) {
                TITLE_CONTAINER.title = 'Hold to select / deselect all';
            } else {
                TITLE_CONTAINER.textContent = 'Media';
                TITLE_CONTAINER.title = APP_NAME;
            }
            DISPLAY_CONTAINER.querySelectorAll('.overlay').forEach((element) => {
                element.classList.toggle('show', appState.isSelecting);
            });
            updateSelectedMedia();
        }
        function handleSelectAll() {
            if (!appState.isSelecting) return;
            appState.selectAll();
            updateSelectedMedia();
        }
        function hideExtension() {
            appState.extensionHidden = true;
            DISPLAY_CONTAINER.classList.add('hide');
            DISPLAY_CONTAINER.setAttribute('style', 'display: none;');
            // Usage requestAnimationFrame to bypass transition attribute
            requestAnimationFrame(() => {
                DISPLAY_CONTAINER.removeAttribute('style');
            });
            updateButtonVisibility();
        }
        function showExtension() {
            appState.extensionHidden = false;
            updateButtonVisibility();
        }
        function handleChatTab() {
            const reactRoot = document.body.querySelector('[id]');
            const rootObserver = new MutationObserver(() => {
                const chatTabsRootContent = document.querySelector('[data-pagelet="IGDChatTabsRootContent"]');
                if (!chatTabsRootContent) {
                    return;
                }
                const tabChatWrapper = chatTabsRootContent.querySelector('[data-visualcompletion="ignore"]')
                    .childNodes[0];
                if (tabChatWrapper.childNodes.length > 1) {
                    // This tab will show when you click on Message button
                    const actualTabChat = tabChatWrapper.lastChild;
                    // This tab will show when you view someone story and click on avatar on Message button
                    const singleTabChat = actualTabChat.querySelector('[aria-label]');

                    if (
                        actualTabChat.checkVisibility({ checkVisibilityCSS: true }) ||
                        singleTabChat.checkVisibility({ checkVisibilityCSS: true })
                    ) {
                        hideExtension();
                    } else {
                        showExtension();
                    }
                } else {
                    showExtension();
                }
            });

            rootObserver.observe(reactRoot, {
                // attributes: true,
                childList: true,
                subtree: true,
            });
        }
        const handleTheme = new MutationObserver(setTheme);
        const handleVideo = new MutationObserver(pauseVideo);
        handleTheme.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class'],
        });
        handleVideo.observe(DISPLAY_CONTAINER, {
            attributes: true,
            attributeFilter: ['class'],
        });
        ESC_BUTTON.addEventListener('click', () => {
            DISPLAY_CONTAINER.classList.add('hide');
            exitSelectMode();
        });
        window.addEventListener('keydown', (e) => {
            if (window.location.pathname.startsWith('/direct')) return;
            if (IGNORE_FOCUS_ELEMENTS.includes(e.target.tagName)) return;
            if (e.target.role === 'textbox') return;
            if (e.ctrlKey) return;
            if (DOWNLOAD_EVENT_KEYS.includes(e.key)) {
                return DOWNLOAD_BUTTON.click();
            }
            if (ESC_EVENT_KEYS.includes(e.key)) {
                return ESC_BUTTON.click();
            }
            if (SELECT_EVENT_KEYS.includes(e.key) && !DISPLAY_CONTAINER.classList.contains('hide')) {
                return toggleSelectMode();
            }
        });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                DISPLAY_CONTAINER.querySelectorAll('video').forEach((video) => {
                    video.pause();
                });
            }
        });
        handleLongClick(TITLE_CONTAINER, () => toggleSelectMode(), handleSelectAll);
        DOWNLOAD_BUTTON.addEventListener('click', handleDownload);
        GROUP_DOWNLOAD_MEDIA.querySelector('button:first-child')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (appState.isSelecting && appState.selected.size !== 0) {
                saveZip();
            }
        });
        GROUP_DOWNLOAD_MEDIA.querySelector('button:last-child')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (appState.isSelecting && appState.selected.size !== 0) {
                saveAllSelected();
            }
        });
        window.addEventListener('online', () => {
            DISPLAY_CONTAINER.querySelectorAll('img , video').forEach((media) => {
                media.src = media.src;
            });
        });
        navigation.addEventListener('navigate', (e) => {
            const currentPath = new URL(e.destination.url).pathname;
            const previousPath = window.location.pathname;
            // Hide/Show Download button when user navigate
            if (currentPath.startsWith('/direct')) {
                hideExtension();
            }
            // Have to check old path because Instagram now show message button on almost every page.
            else if (previousPath.startsWith('/direct')) {
                showExtension();
            }

            // Set z-index to Download button when navigate to downloadable url
            // Download button z-index unset by default to prevent overlay over other element
            if (
                currentPath.match(IG_POST_REGEX) ||
                currentPath.match(IG_STORY_REGEX) ||
                currentPath.match(IG_HIGHLIGHT_REGEX)
            ) {
                DOWNLOAD_BUTTON.setAttribute('style', 'z-index: 1000000;');
                GROUP_DOWNLOAD_MEDIA.querySelectorAll('button').forEach((button) => {
                    button.setAttribute('style', 'z-index: 1000000;');
                });
            } else {
                DOWNLOAD_BUTTON.removeAttribute('style');
                GROUP_DOWNLOAD_MEDIA.querySelectorAll('button').forEach((button) => {
                    button.removeAttribute('style');
                });
            }
        });
        window.addEventListener('userLoad', (e) => {
            if (!appCache.userIdsCache.has(e.detail.username)) {
                appCache.userIdsCache.set(e.detail.username, e.detail.id);
            }
        });
        window.addEventListener('postView', (e) => {
            if (appCache.postIdInfoCache.has(e.detail.code)) return;
            // Check valid shortcode
            if (e.detail.code.startsWith(convertToShortcode(e.detail.id))) {
                appCache.postIdInfoCache.set(e.detail.code, e.detail.id);
            }
        });
        setTheme();
        handleChatTab();
        updateButtonVisibility();
        if (window.location.pathname.startsWith('/direct')) {
            hideExtension();
        }
    }
    function run() {
        document.querySelectorAll('.display-container, .download-button, .group-download-media').forEach((node) => {
            node.remove();
        });
        initUI();
        handleEvents();
    }
    run();
})();
