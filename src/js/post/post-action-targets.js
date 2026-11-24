const postActionTargets = Object.freeze(
    (() => {
        const OWN_BUTTONS = '.igd-post-inline-download, .igd-post-inline-download-all';

        // /reels/:code is a vertical feed: every reel shares the page URL, which
        // tracks only the reel currently on screen, and its actions are a column.
        function isReelsFeed() {
            return /^\/reels\/[A-Za-z0-9_-]+/.test(window.location.pathname);
        }

        function isActiveReel(root) {
            const video = root.querySelector?.('video');
            if (!video) return false;
            const rect = video.getBoundingClientRect();
            return rect.top <= innerHeight / 2 && rect.bottom >= innerHeight / 2;
        }

        function isVisible(element) {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        }

        // Icon geometry is independent of Instagram's translated accessibility labels.
        // Keep the label fallback for older icon variants.
        function isShareIcon(icon) {
            const path = icon.querySelector('path')?.getAttribute('d') ?? '';
            return (
                path.startsWith('M13.973 20.046') || ['Share', 'Share Post'].includes(icon.getAttribute('aria-label'))
            );
        }

        // Reels have a vertical action column and keep their existing detection.
        function findReelActionTargets() {
            const targets = [];
            const handledRoots = new Set();
            for (const icon of document.querySelectorAll('svg[aria-label]')) {
                if (!isShareIcon(icon) || !isVisible(icon)) continue;
                const anchorButton = icon.closest('button, [role="button"]');
                if (!anchorButton) continue;
                const root = getPostRoot(anchorButton);
                if (handledRoots.has(root) || (root === document && !IG_POST_REGEX.test(location.pathname))) continue;
                const reelsFeed = isReelsFeed();
                if (reelsFeed && !isActiveReel(root)) continue;
                const directions = reelsFeed ? ['column', 'column-reverse'] : ['row', 'row-reverse'];

                // Stop at the innermost action group (a column on /reels/). The outer grid has
                // a separate Save cell: inserting a new child there creates a new row.
                let container = anchorButton.parentElement;
                while (container && container !== root && container !== document.body) {
                    const style = getComputedStyle(container);
                    if (style.display === 'grid' || style.display === 'inline-grid') break;
                    const icons = [...container.querySelectorAll('svg[aria-label]')].filter(
                        (item) => !item.closest(OWN_BUTTONS),
                    );
                    if (
                        ['flex', 'inline-flex'].includes(style.display) &&
                        directions.includes(style.flexDirection) &&
                        icons.length >= 3 &&
                        icons.length <= 6
                    ) {
                        handledRoots.add(root);
                        targets.push({ actionsContainer: container, anchorButton, root });
                        break;
                    }
                    container = container.parentElement;
                }
            }

            return targets;
        }

        function getPostActionKind(icon) {
            if (isShareIcon(icon)) return 'share';
            const label = icon.getAttribute('aria-label');
            const path = icon.querySelector('path')?.getAttribute('d') ?? '';
            if (['Like', 'Unlike'].includes(label) || path.startsWith('M16.792 3.904')) return 'like';
            if (label === 'Comment' || path.startsWith('M20.656 17.008')) return 'comment';
            const points = icon
                .querySelector('polygon')
                ?.getAttribute('points')
                ?.trim()
                .split(/[\s,]+/)
                .join(' ');
            if (['Save', 'Remove'].includes(label) || points === '20 21 12 13.44 4 21 4 3 20 3 20 21') return 'save';
            return '';
        }

        function getPostActions(root) {
            return [...root.querySelectorAll('svg[aria-label]')]
                .filter((icon) => isVisible(icon) && !icon.closest(OWN_BUTTONS))
                .map((icon) => ({ kind: getPostActionKind(icon), button: icon.closest('button, [role="button"]') }))
                .filter((action) => action.kind && action.button);
        }

        function findFeedPostRoots() {
            // Never use the entire document for a feed containing multiple posts.
            return [...document.querySelectorAll('main article')].filter(isVisible);
        }

        function findModalPostRoots(dialog) {
            const articles = [...dialog.querySelectorAll('article')].filter(isVisible);
            return articles.length ? articles : [dialog];
        }

        function findDetailPostRoots() {
            const main = document.querySelector('main');
            if (!main) return [];
            const articles = [...main.querySelectorAll('article')].filter(isVisible);
            return articles.length ? articles : [main];
        }

        function findPostTarget(root) {
            const candidates = new Map();
            for (const like of getPostActions(root).filter((action) => action.kind === 'like')) {
                let container = like.button.parentElement;
                while (container && container !== document.body && root.contains(container)) {
                    const style = getComputedStyle(container);
                    // A grid may have a separate Save cell: never insert into it.
                    if (['grid', 'inline-grid'].includes(style.display)) break;
                    if (
                        ['flex', 'inline-flex'].includes(style.display) &&
                        ['row', 'row-reverse'].includes(style.flexDirection)
                    ) {
                        const actions = getPostActions(container);
                        const likes = actions.filter((action) => action.kind === 'like');
                        const saves = actions.filter((action) => action.kind === 'save');
                        const hasCompanion = actions.some((action) =>
                            ['share', 'comment', 'save'].includes(action.kind),
                        );
                        const parent = container.parentElement;
                        const separateSave =
                            parent &&
                            ['grid', 'inline-grid'].includes(getComputedStyle(parent).display) &&
                            getPostActions(parent).some(
                                (action) => action.kind === 'save' && !container.contains(action.button),
                            );
                        if (likes.length === 1 && saves.length <= 1 && (hasCompanion || separateSave)) {
                            const saveItem = saves[0] && findDirectChild(container, saves[0].button);
                            const nativeItems = [...container.children].filter(
                                (item) => !item.matches(OWN_BUTTONS) && isVisible(item),
                            );
                            const saveIndex = nativeItems.indexOf(saveItem);
                            // Insert before Save, or after the last action/count if Save
                            // lives in another grid cell. DOM order also handles RTL.
                            const anchorButton = saveItem ? nativeItems[saveIndex - 1] : nativeItems.at(-1);
                            if (anchorButton && findDirectChild(container, like.button) !== saveItem) {
                                candidates.set(container, { actionsContainer: container, anchorButton, root });
                            }
                            break;
                        }
                    }
                    if (container === root) break;
                    container = container.parentElement;
                }
            }
            // Multiple matching action rows within a root are ambiguous.
            return candidates.size === 1 ? [...candidates.values()][0] : null;
        }

        function findPostActionTargets() {
            if (isReelsFeed()) return findReelActionTargets();
            const dialogs = [...document.querySelectorAll('[role="dialog"], dialog')].filter(isVisible);
            let roots;
            if (dialogs.length) roots = dialogs.flatMap(findModalPostRoots);
            else if (location.pathname === '/') roots = findFeedPostRoots();
            else roots = findDetailPostRoots();
            return roots.map(findPostTarget).filter(Boolean);
        }

        function findDirectChild(container, descendant) {
            let child = descendant;
            while (child?.parentElement && child.parentElement !== container) child = child.parentElement;
            return child?.parentElement === container ? child : null;
        }

        function getPostRoot(actionButton) {
            const article = actionButton.closest('article');
            if (article || !isReelsFeed()) return article ?? document;
            // A reel's own container is the largest ancestor holding only its Share
            // button. Its video can be missing while it loads lazily off screen.
            let reel = actionButton;
            while (
                reel.parentElement &&
                reel.parentElement !== document.body &&
                countShareButtons(reel.parentElement) === 1
            ) {
                reel = reel.parentElement;
            }
            return reel;
        }

        function countShareButtons(element) {
            return [...element.querySelectorAll('svg[aria-label]')].filter(
                (icon) => isShareIcon(icon) && icon.closest('button, [role="button"]'),
            ).length;
        }

        return { find: findPostActionTargets, isReelsFeed, isVisible, findDirectChild };
    })(),
);
