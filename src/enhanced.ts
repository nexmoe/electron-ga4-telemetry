import { safeToken } from './core';
import type { GA4EventParams } from './ga4-web';

export interface EnhancedMeasurementOptions {
  scroll?: boolean;
  outboundClicks?: boolean;
  fileDownloads?: boolean;
  forms?: boolean;
  html5Video?: boolean;
}

/** Application-DOM events for a tag running in a separate HTTPS collector. */
export function installEnhancedMeasurement(
  options: EnhancedMeasurementOptions,
  origin: string,
  getScreen: () => string,
  track: (name: string, params: GA4EventParams) => void,
): () => void {
    const listeners: Array<() => void> = [];

    if (options.scroll) {
      let lastScreen = getScreen();
      let reached = false;
      const onScroll = () => {
        if (lastScreen !== getScreen()) {
          lastScreen = getScreen();
          reached = false;
        }
        if (reached || !getScreen()) return;
        const h = document.documentElement.scrollHeight;
        if (h > window.innerHeight + 2 && (window.scrollY + window.innerHeight) / h >= 0.9) {
          reached = true;
          track('scroll', { percent_scrolled: 90 });
        }
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      listeners.push(() => window.removeEventListener('scroll', onScroll));
    }

    if (options.outboundClicks || options.fileDownloads) {
      const virtualDomain = new URL(origin).hostname;
      const onClick = (e: MouseEvent) => {
        const target = e.target as Element | null;
        const anchor = target?.closest?.('a[href]');
        if (!anchor) return;
        const href = anchor.getAttribute('href');
        if (!href) return;
        let url: URL;
        try { url = new URL(href, window.location.href || origin); }
        catch { return; }
        if (!['http:', 'https:'].includes(url.protocol)) return;
        if (options.fileDownloads) {
          const ext = /\.([a-z0-9]{1,12})$/i.exec(url.pathname)?.[1]?.toLowerCase();
          const known = /^(pdf|txt|csv|docx?|xlsx?|zip|gz|7z|rar|mp[34]|m4a|avi|mov|exe|dmg|pkg)$/i.test(ext ?? '');
          if (known) track('file_download', { file_extension: ext! });
        }
        if (options.outboundClicks && url.hostname !== virtualDomain &&
            url.hostname !== window.location.hostname) {
          const host = safeToken(url.hostname.toLowerCase(), 80);
          if (host) track('click', { outbound: true, link_domain: host,
            // Only the origin may be transmitted; never the link path or query.
            link_url: url.origin,
          });
        }
      };
      document.addEventListener('click', onClick, true);
      listeners.push(() => document.removeEventListener('click', onClick, true));
    }

    if (options.forms) {
      let started = new WeakSet<Element>();
      let onScreen = getScreen();
      const formData = (element: EventTarget | null) => {
        const target = element as Element | null;
        const form = target?.closest?.('form[data-ga4-form]');
        if (!form) return undefined;
        if (onScreen !== getScreen()) { onScreen = getScreen(); started = new WeakSet(); }
        const formId = safeToken(form.getAttribute('data-ga4-form'), 40);
        return formId ? { form, formId } : undefined;
      };
      const onFocus = (e: Event) => {
        const data = formData(e.target);
        if (!data || started.has(data.form)) return;
        started.add(data.form);
        track('form_start', { form_id: data.formId });
      };
      const onSubmit = (e: Event) => {
        const data = formData(e.target);
        if (data) track('form_submit', { form_id: data.formId });
      };
      document.addEventListener('focusin', onFocus, true);
      document.addEventListener('submit', onSubmit, true);
      listeners.push(() => {
        document.removeEventListener('focusin', onFocus, true);
        document.removeEventListener('submit', onSubmit, true);
      });
    }

    if (options.html5Video) {
      const videoProgress = new WeakMap<Element, Set<number>>();
      const onMedia = (e: Event) => {
        const video = e.target as HTMLVideoElement | null;
        if (!video?.matches?.('video[data-ga4-video]')) return;
        const label = safeToken(video.getAttribute('data-ga4-video'), 50);
        if (!label) return;
        const duration = video.duration;
        const props: GA4EventParams = {
          video_title: label,
          ...(Number.isFinite(duration) && duration > 0 ? { video_duration: Math.round(duration) } : {}),
        };
        if (e.type === 'play') {
          if (video.currentTime < 1) videoProgress.set(video, new Set());
          track('video_start', props);
        } else if (e.type === 'timeupdate' && Number.isFinite(duration) && duration > 0) {
          const percent = video.currentTime / duration * 100;
          let seen = videoProgress.get(video);
          if (!seen) { seen = new Set(); videoProgress.set(video, seen); }
          for (const threshold of [10, 25, 50, 75]) {
            if (percent >= threshold && !seen.has(threshold)) {
              seen.add(threshold);
              track('video_progress', { ...props, video_percent: threshold });
            }
          }
        } else if (e.type === 'ended') {
          track('video_complete', props);
        }
      };
      for (const name of ['play', 'timeupdate', 'ended']) {
        document.addEventListener(name, onMedia, true);
        listeners.push(() => document.removeEventListener(name, onMedia, true));
      }
    }

    return () => { for (const dispose of listeners) dispose(); };
}
