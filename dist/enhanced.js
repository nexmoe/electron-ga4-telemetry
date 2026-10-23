"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.installEnhancedMeasurement = installEnhancedMeasurement;
const core_1 = require("./core");
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
    if (options.outboundClicks || options.fileDownloads) {
        const virtualDomain = new URL(origin).hostname;
        const onClick = (e) => {
            const target = e.target;
            const anchor = target?.closest?.('a[href]');
            if (!anchor)
                return;
            const href = anchor.getAttribute('href');
            if (!href)
                return;
            let url;
            try {
                url = new URL(href, window.location.href || origin);
            }
            catch {
                return;
            }
            if (!['http:', 'https:'].includes(url.protocol))
                return;
            if (options.fileDownloads) {
                const ext = /\.([a-z0-9]{1,12})$/i.exec(url.pathname)?.[1]?.toLowerCase();
                const known = /^(pdf|txt|csv|docx?|xlsx?|zip|gz|7z|rar|mp[34]|m4a|avi|mov|exe|dmg|pkg)$/i.test(ext ?? '');
                if (known)
                    track('file_download', { file_extension: ext, ...(!redacted ? {
                            file_name: url.pathname.split('/').pop() ?? '', link_url: url.href,
                            link_id: anchor.id, link_text: anchor.textContent?.trim() ?? '',
                        } : {}) });
            }
            if (options.outboundClicks && url.hostname !== virtualDomain &&
                url.hostname !== window.location.hostname) {
                const host = (0, core_1.safeToken)(url.hostname.toLowerCase(), 80);
                if (host)
                    track('click', { outbound: true, link_domain: host,
                        link_url: redacted ? url.origin : url.href,
                        ...(!redacted ? { link_id: anchor.id, link_classes: anchor.className } : {}),
                    });
            }
        };
        document.addEventListener('click', onClick, true);
        listeners.push(() => document.removeEventListener('click', onClick, true));
    }
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
            return formId ? { form, formId } : undefined;
        };
        const onFocus = (e) => {
            const data = formData(e.target);
            if (!data || started.has(data.form))
                return;
            started.add(data.form);
            track('form_start', { form_id: data.formId });
        };
        const onSubmit = (e) => {
            const data = formData(e.target);
            if (data)
                track('form_submit', { form_id: data.formId });
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
                ...(!redacted ? { video_url: video.currentSrc || video.src, video_current_time: Math.round(video.currentTime), video_provider: 'html5' } : {}),
                ...(Number.isFinite(duration) && duration > 0 ? { video_duration: Math.round(duration) } : {}),
            };
            if (e.type === 'play') {
                if (video.currentTime < 1)
                    videoProgress.set(video, new Set());
                track('video_start', props);
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
                track('video_complete', props);
            }
        };
        for (const name of ['play', 'timeupdate', 'ended']) {
            document.addEventListener(name, onMedia, true);
            listeners.push(() => document.removeEventListener(name, onMedia, true));
        }
    }
    return () => { for (const dispose of listeners)
        dispose(); };
}
