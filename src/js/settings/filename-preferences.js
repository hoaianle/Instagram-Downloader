const DOWNLOAD_FILENAME_SCOPES = Object.freeze({
    POST: 'post',
    STORIES: 'stories',
    HIGHLIGHTS: 'highlights',
});

const DOWNLOAD_FILENAME_TOKENS = Object.freeze([
    'original_filename',
    'username',
    'date',
    'title',
    'id',
    'resolution',
    'video_bitrate',
    'video_codec',
]);
const DOWNLOAD_FILENAME_SINGLE_ONLY_TOKENS = Object.freeze([
    'original_filename',
    'resolution',
    'video_bitrate',
    'video_codec',
]);
const DOWNLOAD_FILENAME_TEMPLATE_STORAGE_KEY = 'instagramDownloaderFilenameTemplates';
const DOWNLOAD_DATE_FORMAT_STORAGE_KEY = 'instagramDownloaderDateFormat';
const DOWNLOAD_DATE_FORMATS = Object.freeze(['YYYY-MM-DD', 'DD_MM_YYYY', 'MM_DD_YYYY', 'MMM DD, YYYY']);
const DEFAULT_DOWNLOAD_DATE_FORMAT = 'YYYY-MM-DD';
const DEFAULT_DOWNLOAD_FILENAME_TEMPLATES = Object.freeze({
    [DOWNLOAD_FILENAME_SCOPES.POST]: Object.freeze(['username', 'id', 'date']),
    [DOWNLOAD_FILENAME_SCOPES.STORIES]: Object.freeze(['username', 'id', 'date']),
    [DOWNLOAD_FILENAME_SCOPES.HIGHLIGHTS]: Object.freeze(['username', 'title']),
});

const downloadFilenamePreferences = Object.freeze(
    (() => {
        function normalizeTemplate(scope, template) {
            const fallback = DEFAULT_DOWNLOAD_FILENAME_TEMPLATES[scope] ?? DEFAULT_DOWNLOAD_FILENAME_TEMPLATES.post;
            if (!Array.isArray(template)) return [...fallback];
            const normalized = template.filter(
                (token, index) => DOWNLOAD_FILENAME_TOKENS.includes(token) && template.indexOf(token) === index,
            );
            return normalized.length ? normalized : [...fallback];
        }

        function loadTemplates() {
            let saved = {};
            try {
                saved = JSON.parse(localStorage.getItem(DOWNLOAD_FILENAME_TEMPLATE_STORAGE_KEY) || '{}');
            } catch (error) {
                console.log(error);
            }
            return Object.fromEntries(
                Object.values(DOWNLOAD_FILENAME_SCOPES).map((scope) => [scope, normalizeTemplate(scope, saved[scope])]),
            );
        }

        function saveTemplates(templates) {
            try {
                localStorage.setItem(DOWNLOAD_FILENAME_TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
            } catch (error) {
                console.log(error);
            }
        }

        function loadDateFormat() {
            try {
                const saved = localStorage.getItem(DOWNLOAD_DATE_FORMAT_STORAGE_KEY);
                return DOWNLOAD_DATE_FORMATS.includes(saved) ? saved : DEFAULT_DOWNLOAD_DATE_FORMAT;
            } catch (error) {
                return DEFAULT_DOWNLOAD_DATE_FORMAT;
            }
        }

        function cleanPart(value) {
            return String(value ?? '')
                .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
                .replace(/\s+/g, ' ')
                .replace(/[. ]+$/g, '')
                .trim();
        }

        let templates = loadTemplates();
        let dateFormat = loadDateFormat();

        return {
            get(scope) {
                return [...normalizeTemplate(scope, templates[scope])];
            },
            set(scope, template) {
                if (!Object.values(DOWNLOAD_FILENAME_SCOPES).includes(scope)) return;
                templates = { ...templates, [scope]: normalizeTemplate(scope, template) };
                saveTemplates(templates);
                window.dispatchEvent(
                    new CustomEvent('downloadFilenameTemplateChange', {
                        detail: { scope, template: [...templates[scope]] },
                    }),
                );
            },
            reset(scope) {
                this.set(scope, DEFAULT_DOWNLOAD_FILENAME_TEMPLATES[scope]);
            },
            get dateFormat() {
                return dateFormat;
            },
            setDateFormat(value) {
                if (!DOWNLOAD_DATE_FORMATS.includes(value) || value === dateFormat) return;
                dateFormat = value;
                try {
                    localStorage.setItem(DOWNLOAD_DATE_FORMAT_STORAGE_KEY, dateFormat);
                } catch (error) {
                    console.log(error);
                }
                window.dispatchEvent(new CustomEvent('downloadDateFormatChange', { detail: { dateFormat } }));
            },
            formatDate(timestamp) {
                if (!timestamp) return '';
                const date = new Date(Number(timestamp) * 1000);
                if (Number.isNaN(date.getTime())) return '';
                const values = {
                    YYYY: String(date.getUTCFullYear()),
                    MM: String(date.getUTCMonth() + 1).padStart(2, '0'),
                    MMM: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
                        date.getUTCMonth()
                    ],
                    DD: String(date.getUTCDate()).padStart(2, '0'),
                };
                return dateFormat.replace(/YYYY|MMM|MM|DD/g, (part) => values[part]);
            },
            format(scope, values) {
                const parts = this.get(scope)
                    .map((token) => cleanPart(values?.[token]))
                    .filter(Boolean);
                return (parts.join('_') || 'instagram_download').slice(0, 180).replace(/[. ]+$/g, '');
            },
            formatMedia(scope, values) {
                const mediaValues = { ...values };
                const template = this.get(scope);
                if (scope === DOWNLOAD_FILENAME_SCOPES.HIGHLIGHTS) {
                    const usesDefaultTemplate = template.join(',') === 'username,title';
                    mediaValues.title = [
                        template.includes('id') ? '' : mediaValues.id,
                        mediaValues.title,
                        usesDefaultTemplate ? mediaValues.date : '',
                    ]
                        .filter(Boolean)
                        .join('_');
                }
                return this.format(scope, mediaValues);
            },
            formatArchive(scope, values) {
                const archiveValues = { ...values };
                DOWNLOAD_FILENAME_SINGLE_ONLY_TOKENS.forEach((token) => {
                    archiveValues[token] = '';
                });
                return this.format(scope, archiveValues);
            },
        };
    })(),
);
