(function initializeDesktopAnalytics(options) {
  const modules = {"./core": function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SAFE_TOKEN = exports.VALID_EVENT = void 0;
exports.safeToken = safeToken;
exports.cleanParams = cleanParams;
exports.parseCampaign = parseCampaign;
exports.toGtagCampaign = toGtagCampaign;
exports.safeScreen = safeScreen;
exports.routeFromLocation = routeFromLocation;
exports.isMetricValue = isMetricValue;
exports.localDay = localDay;
/** GA4 event names must start with a letter and use only letters, numbers and _. */
exports.VALID_EVENT = /^[a-z][a-z0-9_]{0,39}$/;
exports.SAFE_TOKEN = /^[a-z0-9][a-z0-9_.-]{0,79}$/i;
const CAMPAIGN_KEYS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_id', 'utm_content', 'utm_term',
];
/** Drop PII-like strings, remote/local paths and unstable high-cardinality values. */
function safeToken(value, maxLength = 80) {
    if (typeof value !== 'string')
        return undefined;
    const v = value.trim();
    if (!v || v.length > maxLength || !exports.SAFE_TOKEN.test(v))
        return undefined;
    return v;
}
/** Sanitize event parameters; callers must still use approved, non-identifying vocabularies. */
function cleanParams(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        return {};
    const out = {};
    for (const [key, value] of Object.entries(input)) {
        if (!exports.VALID_EVENT.test(key) || Object.keys(out).length >= 22)
            continue;
        if (typeof value === 'boolean')
            out[key] = value;
        else if (typeof value === 'number' && Number.isFinite(value))
            out[key] = value;
        else if (typeof value === 'string') {
            const s = safeToken(value);
            if (s !== undefined)
                out[key] = s;
        }
    }
    return out;
}
function parseCampaign(input) {
    if (!input)
        return undefined;
    let data = {};
    if (typeof input === 'string' || input instanceof URL) {
        try {
            const url = input instanceof URL ? input : new URL(input);
            for (const k of CAMPAIGN_KEYS)
                data[k] = url.searchParams.get(k);
        }
        catch {
            return undefined;
        }
    }
    else if (typeof input === 'object' && !Array.isArray(input)) {
        data = input;
    }
    const campaign = {};
    for (const key of CAMPAIGN_KEYS) {
        const value = safeToken(data[key], 60);
        if (value)
            campaign[key] = value;
    }
    return Object.keys(campaign).length ? campaign : undefined;
}
/** A GA4 campaign configuration must be explicit and MUST NOT reuse the install campaign forever. */
function toGtagCampaign(campaign) {
    const mapped = {};
    const keys = {
        utm_source: 'campaign_source', utm_medium: 'campaign_medium',
        utm_campaign: 'campaign_name', utm_id: 'campaign_id',
        utm_content: 'campaign_content', utm_term: 'campaign_term',
    };
    for (const [source, target] of Object.entries(keys)) {
        const value = campaign[source];
        if (value)
            mapped[target] = value;
    }
    return mapped;
}
const SENSITIVE_SEGMENT = /^(\d+|[0-9a-f]{8}-[0-9a-f-]{20,}|[0-9a-f]{16,}|[a-z0-9_-]{18,})$/i;
/** Keeps only a known section by default; nested pages need an explicit static route map. */
function safeScreen(path) {
    const raw = path.split(/[?#]/, 1)[0].replace(/^\/+|\/+$/g, '');
    if (!raw || raw === 'index.html')
        return 'home';
    const segments = raw.split('/');
    // Never expose local filesystem paths or full arbitrary router paths to GA4.
    const first = segments[0].toLowerCase();
    if (!/^[a-z][a-z0-9_-]{0,24}$/.test(first) || SENSITIVE_SEGMENT.test(first))
        return 'other';
    return segments.length === 1 ? first : `${first}/detail`;
}
function routeFromLocation(location, mode) {
    if (mode === 'hash') {
        const hash = location.hash.replace(/^#/, '');
        return hash.startsWith('/') ? hash : '/';
    }
    if (location.pathname.endsWith('/index.html') || location.pathname === '/index.html')
        return '/';
    return location.pathname;
}
function isMetricValue(v) {
    return typeof v === 'boolean' || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
}
/** ISO date in the user's local timezone; used only for one daily-active event per device. */
function localDay(timestamp) {
    const d = new Date(timestamp);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

},
"./links": function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLinkMeasurement = createLinkMeasurement;
/** One action can produce both an anchor event and an Electron notification. */
function createLinkMeasurement(options, origin, track) {
    const recent = new Map();
    const redacted = options.privacy === 'redacted';
    const domain = new URL(origin).hostname;
    function emit(name, url, source, params) {
        const key = `${name}:${url.href}`;
        const now = Date.now();
        const previous = recent.get(key);
        if (previous && previous.source !== source && now - previous.time < 1500)
            return;
        for (const [key, entry] of recent)
            if (now - entry.time >= 1500)
                recent.delete(key);
        recent.set(key, { source, time: now });
        track(name, params);
    }
    return {
        record(type, href, source, filename, anchor) {
            let url;
            try {
                url = new URL(href, origin);
            }
            catch {
                return;
            }
            if (!['https:', 'http:'].includes(url.protocol) ||
                url.username ||
                url.password)
                return;
            const name = (filename ?? url.pathname.split('/').pop() ?? '')
                .split(/[\\/]/)
                .pop() ?? '';
            const extension = /\.([a-z0-9]{1,12})$/i.exec(name)?.[1]?.toLowerCase();
            const known = /^(pdf|txt|csv|rtf|docx?|xlsx?|pptx?|zip|gz|tgz|bz2|tar|7z|rar|mp[234]|m4a|wav|wma|aac|avi|mov|mpe?g|wmv|exe|dmg|pkg)$/i.test(extension ?? '');
            if (options.fileDownloads && (type === 'download' || known)) {
                emit('file_download', url, source, {
                    ...(extension ? { file_extension: extension } : {}),
                    ...(!redacted
                        ? {
                            file_name: name,
                            link_url: url.href,
                            link_domain: url.hostname,
                            link_id: anchor?.id ?? '',
                            link_text: anchor?.textContent?.trim() ?? '',
                        }
                        : {}),
                });
            }
            if (type === 'click' &&
                options.outboundClicks &&
                url.hostname !== domain &&
                (typeof window === 'undefined' ||
                    url.hostname !== window.location.hostname)) {
                emit('click', url, source, {
                    outbound: true,
                    link_domain: url.hostname,
                    link_url: redacted ? url.origin : url.href,
                    ...(!redacted
                        ? {
                            link_id: anchor?.id ?? '',
                            link_classes: anchor?.getAttribute('class') ?? '',
                        }
                        : {}),
                });
            }
        },
    };
}

},
"./youtube": function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.installYouTubeMeasurement = installYouTubeMeasurement;
const core_1 = require("./core");
let loading;
function loadAPI(target) {
    if (target.YT?.Player)
        return Promise.resolve();
    return (loading ??= new Promise((resolve, reject) => {
        const previous = target.onYouTubeIframeAPIReady;
        const timer = setTimeout(() => {
            loading = undefined;
            reject(new Error('YouTube API timed out'));
        }, 15000);
        target.onYouTubeIframeAPIReady = () => {
            clearTimeout(timer);
            resolve();
            previous?.();
        };
        if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
            const script = document.createElement('script');
            script.src = 'https://www.youtube.com/iframe_api';
            script.onerror = () => {
                clearTimeout(timer);
                loading = undefined;
                reject(new Error('YouTube API unavailable'));
            };
            document.head.append(script);
        }
    }));
}
/** Use the official Player API; do not read arbitrary cross-origin postMessage payloads. */
function installYouTubeMeasurement(redacted, track) {
    const target = window;
    const players = new Map();
    const pending = new WeakSet();
    let disposed = false;
    async function attach(frame) {
        if (pending.has(frame) || players.has(frame))
            return;
        const label = (0, core_1.safeToken)(frame.getAttribute('data-ga4-video'), 50);
        if (redacted && !label)
            return;
        try {
            const url = new URL(frame.src);
            if (url.protocol !== 'https:' ||
                !/^(www\.)?youtube(-nocookie)?\.com$/.test(url.hostname) ||
                !url.pathname.startsWith('/embed/') ||
                url.searchParams.get('enablejsapi') !== '1')
                return;
            pending.add(frame);
            await loadAPI(target);
            if (disposed || !frame.isConnected || !target.YT)
                return;
            let started = false;
            let currentVideo = '';
            const listenerName = '__electronGa4YouTube' +
                Date.now() +
                Math.random().toString(36).slice(2);
            const progress = new Set();
            let timer;
            let player;
            const metadata = () => {
                const rect = frame.getBoundingClientRect();
                return {
                    video_title: label ?? frame.title ?? 'YouTube',
                    video_provider: 'youtube',
                    video_current_time: Math.round(player.getCurrentTime()),
                    video_duration: Math.round(player.getDuration()),
                    visible: rect.bottom > 0 &&
                        rect.right > 0 &&
                        rect.top < innerHeight &&
                        rect.left < innerWidth,
                    ...(!redacted ? { video_url: player.getVideoUrl() } : {}),
                };
            };
            const sample = () => {
                const duration = player.getDuration();
                if (!Number.isFinite(duration) || duration <= 0)
                    return;
                const percent = (player.getCurrentTime() / duration) * 100;
                for (const threshold of [10, 25, 50, 75])
                    if (percent >= threshold && !progress.has(threshold)) {
                        progress.add(threshold);
                        track('video_progress', {
                            ...metadata(),
                            video_percent: threshold,
                        });
                    }
            };
            const change = (event) => {
                clearInterval(timer);
                timer = undefined;
                if (event.data === 1) {
                    const video = player.getVideoUrl();
                    if (video !== currentVideo) {
                        started = false;
                        progress.clear();
                        currentVideo = video;
                    }
                    if (!started) {
                        started = true;
                        track('video_start', { ...metadata(), video_percent: 0 });
                    }
                    sample();
                    timer = setInterval(sample, 1000);
                }
                else if (event.data === 0) {
                    sample();
                    track('video_complete', { ...metadata(), video_percent: 100 });
                    started = false;
                    progress.clear();
                }
            };
            player =
                (frame.id && target.YT.get?.(frame.id)) ||
                    new target.YT.Player(frame, { events: {} });
            target[listenerName] = change;
            player.addEventListener('onStateChange', listenerName);
            players.set(frame, () => {
                clearInterval(timer);
                player.removeEventListener('onStateChange', listenerName);
                delete target[listenerName];
            });
        }
        catch {
            /* CSP, blocked embeds and player errors must not affect the host app. */
        }
    }
    const scan = () => {
        for (const [frame, stop] of players)
            if (!frame.isConnected) {
                stop();
                players.delete(frame);
            }
        for (const frame of document.querySelectorAll('iframe[src]'))
            void attach(frame);
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'data-ga4-video'],
    });
    return () => {
        disposed = true;
        observer.disconnect();
        for (const stop of players.values())
            stop();
        players.clear();
    };
}

},
"./enhanced": function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.installEnhancedMeasurement = installEnhancedMeasurement;
const core_1 = require("./core");
const links_1 = require("./links");
const youtube_1 = require("./youtube");
/** Application-DOM events for a tag running in a separate HTTPS collector. */
function installEnhancedMeasurement(options, origin, getScreen, track) {
    const listeners = [];
    const redacted = options.privacy === 'redacted';
    if (options.siteSearch && !redacted) {
        let previousSearch = '';
        const checkSearch = () => {
            const url = new URL(window.location.href);
            const term = (options.searchQueryParameters ?? ['q', 's', 'search', 'query', 'keyword'])
                .map(key => url.searchParams.get(key)).find(value => value !== null);
            if (!term) {
                previousSearch = '';
                return;
            }
            const signature = `${url.pathname}\n${term}`;
            if (signature === previousSearch)
                return;
            previousSearch = signature;
            track('view_search_results', { search_term: term });
        };
        checkSearch();
        const push = history.pushState, replace = history.replaceState;
        history.pushState = function (...args) { const result = push.apply(this, args); checkSearch(); return result; };
        history.replaceState = function (...args) { const result = replace.apply(this, args); checkSearch(); return result; };
        window.addEventListener('popstate', checkSearch);
        listeners.push(() => {
            history.pushState = push;
            history.replaceState = replace;
            window.removeEventListener('popstate', checkSearch);
        });
    }
    if (options.scroll) {
        let lastScreen = getScreen();
        let reached = false;
        const onScroll = (event) => {
            if (lastScreen !== getScreen()) {
                lastScreen = getScreen();
                reached = false;
            }
            if (reached || !getScreen())
                return;
            const pane = event.target;
            const isPane = pane && pane !== document.documentElement && pane !== document.body &&
                pane !== document && typeof pane.scrollHeight === 'number';
            if (isPane && !options.scrollContainers)
                return;
            const h = isPane ? pane.scrollHeight : document.documentElement.scrollHeight;
            const visible = isPane ? pane.clientHeight : window.innerHeight;
            const top = isPane ? pane.scrollTop : window.scrollY;
            if (h > visible + 2 && (top + visible) / h >= 0.9) {
                reached = true;
                track('scroll', { percent_scrolled: 90 });
            }
        };
        document.addEventListener('scroll', onScroll, { passive: true, capture: true });
        listeners.push(() => document.removeEventListener('scroll', onScroll, true));
    }
    const links = (0, links_1.createLinkMeasurement)(options, origin, track);
    if (options.outboundClicks || options.fileDownloads) {
        const onClick = (event) => {
            const anchor = event.target?.closest?.('a[href]');
            const href = anchor?.getAttribute('href');
            if (!anchor || !href)
                return;
            try {
                links.record('click', new URL(href, window.location.href).href, 'dom', undefined, anchor);
            }
            catch { /* Invalid links are not analytics events. */ }
        };
        document.addEventListener('click', onClick, true);
        listeners.push(() => document.removeEventListener('click', onClick, true));
    }
    const bridge = window.electronGoogleTag;
    if (bridge?.onNativeEvent)
        listeners.push(bridge.onNativeEvent(event => {
            if (event.type === 'download' && options.nativeDownloads !== true)
                return;
            links.record(event.type, event.url, 'native', event.filename);
        }));
    if (options.forms) {
        let started = new WeakSet();
        let onScreen = getScreen();
        const formData = (element) => {
            const target = element;
            const form = target?.closest?.(redacted ? 'form[data-ga4-form]' : 'form');
            if (!form)
                return undefined;
            if (onScreen !== getScreen()) {
                onScreen = getScreen();
                started = new WeakSet();
            }
            const formId = redacted ? (0, core_1.safeToken)(form.getAttribute('data-ga4-form'), 40) :
                (form.getAttribute('data-ga4-form') || form.id || form.getAttribute('name') || 'form');
            return formId ? { form, params: { form_id: formId, ...(!redacted ? {
                        form_name: form.getAttribute('name') ?? '',
                        form_destination: form.action,
                    } : {}) } } : undefined;
        };
        const onFocus = (e) => {
            const data = formData(e.target);
            if (!data || started.has(data.form))
                return;
            started.add(data.form);
            track('form_start', data.params);
        };
        const onSubmit = (e) => {
            const data = formData(e.target);
            if (data)
                track('form_submit', { ...data.params, ...(!redacted ? {
                        form_submit_text: e.submitter?.textContent?.trim() ||
                            e.submitter?.value || '',
                    } : {}) });
        };
        document.addEventListener('focusin', onFocus, true);
        document.addEventListener('submit', onSubmit, true);
        listeners.push(() => {
            document.removeEventListener('focusin', onFocus, true);
            document.removeEventListener('submit', onSubmit, true);
        });
    }
    if (options.html5Video) {
        const videoProgress = new WeakMap();
        const onMedia = (e) => {
            const video = e.target;
            if (!video?.matches?.(redacted ? 'video[data-ga4-video]' : 'video'))
                return;
            const label = redacted ? (0, core_1.safeToken)(video.getAttribute('data-ga4-video'), 50) :
                (video.getAttribute('data-ga4-video') || video.title || video.id || 'video');
            if (!label)
                return;
            const duration = video.duration;
            const props = {
                video_title: label,
                video_current_time: Math.round(video.currentTime), video_provider: 'html5',
                visible: video.getBoundingClientRect().bottom > 0 && video.getBoundingClientRect().top < window.innerHeight,
                ...(!redacted ? { video_url: video.currentSrc || video.src } : {}),
                ...(Number.isFinite(duration) && duration > 0 ? { video_duration: Math.round(duration) } : {}),
            };
            if (e.type === 'play') {
                if (!videoProgress.has(video)) {
                    videoProgress.set(video, new Set());
                    track('video_start', { ...props, video_percent: 0 });
                }
            }
            else if (e.type === 'timeupdate' && Number.isFinite(duration) && duration > 0) {
                const percent = video.currentTime / duration * 100;
                let seen = videoProgress.get(video);
                if (!seen) {
                    seen = new Set();
                    videoProgress.set(video, seen);
                }
                for (const threshold of [10, 25, 50, 75]) {
                    if (percent >= threshold && !seen.has(threshold)) {
                        seen.add(threshold);
                        track('video_progress', { ...props, video_percent: threshold });
                    }
                }
            }
            else if (e.type === 'ended') {
                track('video_complete', { ...props, video_percent: 100 });
                videoProgress.delete(video);
            }
        };
        for (const name of ['play', 'timeupdate', 'ended']) {
            document.addEventListener(name, onMedia, true);
            listeners.push(() => document.removeEventListener(name, onMedia, true));
        }
    }
    if (options.youtubeVideo)
        listeners.push((0, youtube_1.installYouTubeMeasurement)(redacted, track));
    return () => { for (const dispose of listeners.reverse())
        dispose(); };
}

},
"./gtag": function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoogleAnalyticsClient = void 0;
exports.getOrCreateGoogleTag = getOrCreateGoogleTag;
exports.loadGoogleTag = loadGoogleTag;
exports.setGoogleTagEnabled = setGoogleTagEnabled;
const enhanced_1 = require("./enhanced");
const core_1 = require("./core");
function getOrCreateGoogleTag() {
    const target = window;
    target.dataLayer ??= [];
    if (!target.gtag) {
        if (target.electronGoogleTag) {
            target.gtag = function gtag() {
                target.dataLayer.push(arguments);
                if (target.dataLayer.length > 200)
                    target.dataLayer.splice(0, target.dataLayer.length - 200);
                const callbacks = [];
                const args = JSON.parse(JSON.stringify(Array.from(arguments), (_key, value) => {
                    if (typeof value !== 'function')
                        return value;
                    const index = callbacks.push(value) - 1;
                    return { __electron_ga4_callback__: index };
                }));
                void target.electronGoogleTag.send(args).then((result) => {
                    if (result)
                        callbacks[result.index]?.(...result.values);
                }).catch(() => undefined);
            };
        }
        else {
            target.gtag = function gtag() {
                target.dataLayer.push(arguments);
            };
        }
    }
    return target.gtag;
}
function loadGoogleTag(measurementId, onLoad) {
    const bridge = window.electronGoogleTag;
    if (bridge) {
        void bridge.send(['set', {}]).then(() => onLoad?.()).catch(() => undefined);
        return;
    }
    if (document.querySelector(`script[data-electron-ga4="${measurementId}"]`))
        return;
    const script = document.createElement('script');
    script.async = true;
    script.onload = () => onLoad?.();
    script.dataset.electronGa4 = measurementId;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    document.head.appendChild(script);
}
/** Pause delivery without changing application-owned consent or rebuilding the Electron tag. */
function setGoogleTagEnabled(measurementId, enabled) {
    window[`ga-disable-${measurementId}`] = !enabled;
    const bridge = window.electronGoogleTag;
    if (bridge)
        void bridge.send(['__electron_ga4_enabled', enabled]).catch(() => undefined);
}
/**
 * Official gtag transport for applications that already own identity and event policy.
 * Automatic and enhanced measurement remain owned by Google and the GA4 stream settings.
 * Callers must supply safe page metadata and non-identifying event parameters.
 */
class GoogleAnalyticsClient {
    options;
    initialized = false;
    enabled;
    clientId;
    id;
    cleanup = [];
    pageLocation;
    pageTitle;
    constructor(options) {
        this.options = options;
        if (!/^G-[A-Z0-9]+$/i.test(options.measurementId))
            throw new Error('Invalid GA4 measurementId');
        if (options.clientId !== undefined && !/^\d+\.\d+$/.test(options.clientId))
            throw new Error('Invalid anonymous GA4 clientId');
        if (options.pageLocation) {
            const page = new URL(options.pageLocation);
            if (!['http:', 'https:'].includes(page.protocol) || page.username || page.password) {
                throw new Error('pageLocation must use HTTP/HTTPS without credentials');
            }
        }
        this.pageLocation = options.pageLocation;
        this.pageTitle = options.pageTitle ?? (typeof window !== 'undefined' && typeof document !== 'undefined' &&
            window.electronGoogleTag && options.config?.page_title === undefined
            ? document.title : undefined);
        this.id = options.measurementId.toUpperCase();
        this.clientId = options.clientId;
        this.enabled = options.enabled === true;
    }
    initialize() {
        if (!this.enabled)
            return false;
        if (this.initialized)
            return true;
        this.initializeIdentity();
        const gtag = getOrCreateGoogleTag();
        setGoogleTagEnabled(this.id, true);
        if (this.options.consent)
            gtag('consent', 'default', this.options.consent);
        gtag('js', new Date());
        gtag('config', this.id, {
            ...this.options.config,
            ...(this.clientId ? { client_id: this.clientId } : {}),
            ...(this.pageLocation ? { page_location: this.pageLocation } : {}),
            ...(this.pageTitle ? { page_title: this.pageTitle } : {}),
            send_page_view: this.options.sendPageView ?? this.options.config?.send_page_view ?? true,
        });
        loadGoogleTag(this.id);
        this.initialized = true;
        this.watchApplication();
        return true;
    }
    persistIdentity() {
        if (!this.clientId || !this.options.clientIdStorageKey)
            return;
        try {
            window.localStorage.setItem(this.options.clientIdStorageKey, this.clientId);
        }
        catch { /* Storage restrictions must not prevent in-memory analytics. */ }
    }
    initializeIdentity() {
        const key = this.options.clientIdStorageKey;
        if (!key)
            return;
        if (!this.clientId) {
            try {
                const stored = window.localStorage.getItem(key);
                if (stored && /^\d+\.\d+$/.test(stored))
                    this.clientId = stored;
            }
            catch { /* Opaque origins can deny localStorage. */ }
            if (!this.clientId) {
                let random;
                try {
                    random = window.crypto.getRandomValues(new Uint32Array(1))[0];
                }
                catch {
                    random = Math.floor(Math.random() * 0x100000000);
                }
                this.clientId = `${random}.${Math.floor(Date.now() / 1000)}`;
            }
        }
        this.persistIdentity();
    }
    setClientId(clientId) {
        return this.applyClientId(clientId, true);
    }
    /** @internal Main synchronizes siblings without echoing another native config command. */
    synchronizeClientId(clientId) {
        return this.applyClientId(clientId, false);
    }
    applyClientId(clientId, configure) {
        if (!/^\d+\.\d+$/.test(clientId))
            return false;
        this.clientId = clientId;
        this.persistIdentity();
        if (configure && this.initialized && this.enabled) {
            getOrCreateGoogleTag()('config', this.id, {
                client_id: clientId, update: true, send_page_view: false,
            });
        }
        return true;
    }
    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled)
            this.cleanup.splice(0).reverse().forEach(dispose => dispose());
        if (!this.initialized) {
            if (enabled)
                this.initialize();
            return;
        }
        setGoogleTagEnabled(this.id, enabled);
        if (enabled)
            this.watchApplication();
    }
    /** Native gtag command API; payloads and callbacks pass through unchanged. */
    gtag(...args) {
        if (args[0] === 'consent') {
            getOrCreateGoogleTag()(...args);
            return;
        }
        if (!this.enabled)
            return;
        // Preserve native pre-config consent defaults and global settings.
        if (!this.initialized && args[0] === 'set') {
            getOrCreateGoogleTag()(...args);
            return;
        }
        if (this.initialize())
            getOrCreateGoogleTag()(...args);
    }
    track(name, params = {}) {
        if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(name) || !this.initialize())
            return;
        getOrCreateGoogleTag()('event', name, {
            ...(this.pageLocation ? { page_location: this.pageLocation } : {}),
            ...(this.pageTitle ? { page_title: this.pageTitle } : {}),
            send_to: this.id,
            ...params,
        });
    }
    watchApplication() {
        if (!window.electronGoogleTag || this.cleanup.length)
            return;
        const origin = new URL(this.pageLocation ?? 'https://desktop.invalid').origin;
        if (this.options.autoPageViews !== false) {
            let previousScreen = null;
            try {
                previousScreen = this.options.mapRoute ? this.options.mapRoute(window.location.pathname) : (0, core_1.safeScreen)(window.location.pathname);
            }
            catch { /* Initial route mapping is optional telemetry. */ }
            const notify = () => {
                try {
                    const path = window.location.pathname;
                    const screen = this.options.mapRoute ? this.options.mapRoute(path) : (0, core_1.safeScreen)(path);
                    if (screen === null || screen === previousScreen || !/^[a-z][a-z0-9_-]{0,24}(?:\/[a-z][a-z0-9_-]{0,24}){0,2}$/.test(screen))
                        return;
                    previousScreen = screen;
                    const next = `${origin}/desktop/${screen}`;
                    if (next === this.pageLocation)
                        return;
                    const previous = this.pageLocation;
                    this.pageLocation = next;
                    this.pageTitle = screen;
                    this.track('page_view', previous ? { page_referrer: previous } : {});
                }
                catch { /* Route adapters must not interfere with application navigation. */ }
            };
            const push = history.pushState;
            const replace = history.replaceState;
            history.pushState = function (...args) { const result = push.apply(this, args); notify(); return result; };
            history.replaceState = function (...args) { const result = replace.apply(this, args); notify(); return result; };
            window.addEventListener('popstate', notify);
            this.cleanup.push(() => {
                history.pushState = push;
                history.replaceState = replace;
                window.removeEventListener('popstate', notify);
            });
        }
        if (this.options.enhancedMeasurement !== false) {
            this.cleanup.push((0, enhanced_1.installEnhancedMeasurement)(this.options.enhancedMeasurement ?? {
                scroll: true, scrollContainers: true, outboundClicks: true, fileDownloads: true, forms: true, html5Video: true, youtubeVideo: true, siteSearch: true, nativeDownloads: true,
            }, origin, () => this.pageLocation ?? 'home', (name, params) => this.track(name, params)));
        }
    }
    destroy() {
        this.cleanup.splice(0).reverse().forEach(dispose => dispose());
        this.enabled = false;
    }
}
exports.GoogleAnalyticsClient = GoogleAnalyticsClient;

},
"./desktop": function(require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDesktopGoogleAnalytics = getDesktopGoogleAnalytics;
exports.resolveAnalyticsRoute = resolveAnalyticsRoute;
exports.getAutoGoogleAnalytics = getAutoGoogleAnalytics;
const gtag_1 = require("./gtag");
const CLIENTS = Symbol.for('electron-ga4.desktop.clients');
class DesktopClient extends gtag_1.GoogleAnalyticsClient {
    unregister;
    constructor(options, unregister) {
        super(options);
        this.unregister = unregister;
    }
    destroy() {
        super.destroy();
        this.unregister();
    }
}
/**
 * One client per window/stream, including module reloads. The first call owns configuration;
 * use the client's methods for consent, enabled state and verified identity updates.
 * Creating a client does not start collection; initialize(), track() or gtag() does.
 */
function getDesktopGoogleAnalytics(options) {
    const target = window;
    const clients = (target[CLIENTS] ??= new Map());
    const id = options.measurementId.toUpperCase();
    const existing = clients.get(id);
    if (existing)
        return existing;
    const client = new DesktopClient({
        ...options,
        enabled: options.enabled ?? true,
        mapRoute: options.mapRoute ??
            (options.routes
                ? (path) => resolveAnalyticsRoute(path, options.routes)
                : undefined),
        clientIdStorageKey: options.clientIdStorageKey ?? `electron-ga4:${id}:client-id`,
        enhancedMeasurement: options.enhancedMeasurement === false
            ? false
            : {
                scroll: true,
                scrollContainers: true,
                outboundClicks: true,
                fileDownloads: true,
                forms: true,
                html5Video: true,
                youtubeVideo: true,
                siteSearch: true,
                nativeDownloads: true,
                privacy: options.privacy ?? 'native',
                ...options.enhancedMeasurement,
            },
    }, () => {
        if (clients.get(id) === client)
            clients.delete(id);
    });
    clients.set(id, client);
    return client;
}
/** Resolve fixed route labels without serializing functions across Electron processes. */
function resolveAnalyticsRoute(path, routes) {
    if (Object.prototype.hasOwnProperty.call(routes, path))
        return routes[path];
    const pattern = Object.keys(routes)
        .filter((key) => key.endsWith('*') && path.startsWith(key.slice(0, -1)))
        .sort((a, b) => b.length - a.length)[0];
    return pattern ? routes[pattern] : null;
}
/** Wait for Main/Preload automatic setup. A disabled or unavailable transport returns null. */
async function getAutoGoogleAnalytics(measurementId) {
    const target = window;
    let id = measurementId?.toUpperCase();
    if (target.electronGoogleTag?.ready) {
        let configured;
        try {
            configured = await target.electronGoogleTag.ready();
        }
        catch {
            return null;
        }
        if (!configured || (id && id !== configured))
            return null;
        id = configured;
    }
    return id ? (target[CLIENTS]?.get(id) ?? null) : null;
}

}};
  const cache = {};
  function require(id) {
    if (cache[id]) return cache[id].exports;
    const module = cache[id] = {exports: {}};
    modules[id](require, module, module.exports);
    return module.exports;
  }
  const client = require('./desktop').getDesktopGoogleAnalytics(options);
  if (!client.initialize()) return null;
  const id = options.measurementId.toUpperCase();
  const config = Array.from(window.dataLayer ?? []).reverse().find(args => args[0] === 'config' && args[1] === id && typeof args[2]?.client_id === 'string');
  return {measurementId: id, clientId: config?.[2].client_id};
})
