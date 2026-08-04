(() => {
    function debounce(func, delay) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                func(...args);
            }, delay);
        };
    }
    const homeScrollHandler = debounce(
        () => {
            function getVisibleArea(element) {
                const rect = element.getBoundingClientRect();
                const viewHeight = Math.max(document.documentElement.clientHeight, window.innerHeight);
                const viewWidth = Math.max(document.documentElement.clientWidth, window.innerWidth);
                const height = Math.max(0, Math.min(rect.bottom, viewHeight) - Math.max(rect.top, 0));
                const width = Math.max(0, Math.min(rect.right, viewWidth) - Math.max(rect.left, 0));
                return height * width;
            }
            const postContainers = Array.from(document.querySelectorAll('article'));
            const mostVisibleElement = postContainers.reduce(
                (mostVisible, container) => {
                    const visibleArea = getVisibleArea(container);
                    return visibleArea > mostVisible.area ? { element: container, area: visibleArea } : mostVisible;
                },
                { element: null, area: 0 },
            ).element;

            if (mostVisibleElement) {
                const mediaFragmentKey = getValueByKey(mostVisibleElement, 'queryReference');
                if (mediaFragmentKey) {
                    window.dispatchEvent(
                        new CustomEvent('shortcodeChange', {
                            detail: {
                                code: mediaFragmentKey.code,
                            },
                        }),
                    );
                    if (mediaFragmentKey.pk && mediaFragmentKey.code) {
                        window.dispatchEvent(
                            new CustomEvent('postView', {
                                detail: {
                                    id: mediaFragmentKey.pk,
                                    code: mediaFragmentKey.code,
                                },
                            }),
                        );
                    }
                }
            }
        },
        Math.floor(1000 / 60),
    );
    const observer = new MutationObserver(homeScrollHandler);
    function startObserve() {
        observer.disconnect();
        const mainNode = document.querySelector('main');
        if (mainNode)
            observer.observe(mainNode, {
                attributes: true,
                childList: true,
                subtree: true,
            });
        window.addEventListener('scroll', homeScrollHandler);
    }
    function stopObserve() {
        observer.disconnect();
        window.removeEventListener('scroll', homeScrollHandler);
    }
    navigation.addEventListener('navigate', (e) => {
        const url = new URL(e.destination.url);
        if (url.pathname === '/') startObserve();
        else stopObserve();
    });
    if (window.location.pathname === '/') startObserve();
})();
