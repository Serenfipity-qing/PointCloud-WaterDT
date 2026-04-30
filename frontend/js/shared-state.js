(function initSharedState(global) {
    const STORAGE_KEY = 'waterTwinCurrentTask';
    const DB_NAME = 'waterTwinCacheDB';
    const STORE_NAME = 'viewerCache';
    const RETAIN_KEYS = [
        'fileId',
        'filename',
        'fileInfo',
        'hasPrediction',
        'currentMode',
        'currentViewMode',
        'downsample',
        'statistics',
        'alerts',
        'inspection',
        'floodState',
        'embankmentState',
        'highlightState',
        'updatedAt',
    ];

    function sanitizeState(state) {
        if (!state || typeof state !== 'object') {
            return null;
        }

        const next = {};
        RETAIN_KEYS.forEach((key) => {
            if (key in state) {
                next[key] = state[key];
            }
        });
        return next;
    }

    function persistState(next) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
    }

    function clearTaskState() {
        localStorage.removeItem(STORAGE_KEY);
    }

    function readTaskState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) {
                return null;
            }

            const parsed = JSON.parse(raw);
            const sanitized = sanitizeState(parsed);
            if (!sanitized) {
                clearTaskState();
                return null;
            }

            // One-time migration for legacy oversized localStorage payloads.
            if (JSON.stringify(parsed) !== JSON.stringify(sanitized)) {
                persistState(sanitized);
            }

            return sanitized;
        } catch (err) {
            console.warn('Failed to read task state.', err);
            clearTaskState();
            return null;
        }
    }

    function sanitizePatch(patch) {
        if (!patch || typeof patch !== 'object') {
            return {};
        }
        return sanitizeState(patch) || {};
    }

    function writeTaskState(patch) {
        const current = sanitizeState(readTaskState()) || {};
        const next = {
            ...current,
            ...sanitizePatch(patch),
            updatedAt: new Date().toISOString(),
        };

        try {
            return persistState(next);
        } catch (err) {
            console.warn('Failed to persist task state, retrying with sanitized data.', err);
            const fallback = sanitizeState(next) || {};
            fallback.updatedAt = next.updatedAt;

            try {
                clearTaskState();
                return persistState(fallback);
            } catch (retryErr) {
                console.warn('Retrying task state persistence failed.', retryErr);
                return fallback;
            }
        }
    }

    function openCacheDb() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async function getViewerCache(key) {
        if (!key) return null;
        const db = await openCacheDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    async function setViewerCache(key, value) {
        if (!key) return;
        const db = await openCacheDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.put(value, key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async function clearViewerCache(key) {
        if (!key) return;
        const db = await openCacheDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.delete(key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    global.TaskState = {
        read: readTaskState,
        write: writeTaskState,
        clear: clearTaskState,
        getViewerCache,
        setViewerCache,
        clearViewerCache,
    };
})(window);
