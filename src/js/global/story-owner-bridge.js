// Read already-loaded owner data on demand without making network requests.
(() => {
    function findOwner(username) {
        const ids = new Set();
        const visited = new Set();
        const stack = [];
        const roots = new Set(document.querySelectorAll('section, main, video'));
        const anchor = [...document.querySelectorAll('a[href]')].find((link) => {
            try {
                return new URL(link.href, location.origin).pathname.toLowerCase() === `/${username}/`;
            } catch {
                return false;
            }
        });
        let parent = anchor;
        for (let i = 0; parent && i < 10; i++, parent = parent.parentElement) roots.add(parent);
        for (const element of roots) {
            for (const key of Object.keys(element)) {
                if (key.startsWith('__reactFiber$') || key.startsWith('__reactProps$')) stack.push(element[key]);
            }
        }
        for (const script of document.querySelectorAll('script[type="application/json"]')) {
            const text = script.textContent || '';
            if (text.length > 1000000 || !text.toLowerCase().includes(username)) continue;
            try {
                stack.push(JSON.parse(text));
            } catch {}
        }
        while (stack.length && visited.size < 5000) {
            const node = stack.pop();
            if (!node || typeof node !== 'object' || visited.has(node) || node.nodeType) continue;
            visited.add(node);
            try {
                // Validate both values on the same object, including when ads are present.
                if (typeof node.username === 'string' && node.username.toLowerCase() === username) {
                    const id = String(node.pk ?? node.id ?? node.userId ?? '');
                    if (/^\d+$/.test(id)) ids.add(id);
                }
                const keys =
                    typeof node.tag === 'number' && 'memoizedProps' in node
                        ? ['memoizedProps', 'pendingProps', 'memoizedState', 'child', 'sibling', 'return']
                        : Object.keys(node);
                for (const key of keys) {
                    const value = node[key];
                    if (value && typeof value === 'object') stack.push(value);
                }
            } catch {}
        }
        // Conflicting identities must fall back to the existing lookup rather than guess.
        return ids.size === 1 ? [...ids][0] : '';
    }
    window.addEventListener('igd-request-story-owner', (event) => {
        const { username, requestId } = event.detail ?? {};
        if (typeof username !== 'string' || typeof requestId !== 'string') return;
        const expected = username.toLowerCase();
        function respond(attempt) {
            const parts = location.pathname.split('/').filter(Boolean);
            if (parts[0] !== 'stories' || parts[1]?.toLowerCase() !== expected || expected === 'highlights') return;
            const id = findOwner(expected);
            if (!id && attempt < 2) return setTimeout(() => respond(attempt + 1), 150);
            window.dispatchEvent(new CustomEvent('igd-story-owner-result', { detail: { username, requestId, id } }));
        }
        respond(0);
    });
})();
