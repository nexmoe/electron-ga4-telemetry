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
