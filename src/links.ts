import type { GA4EventParams } from './ga4-web';

export interface LinkMeasurementOptions {
  privacy?: 'native' | 'redacted';
  outboundClicks?: boolean;
  fileDownloads?: boolean;
}

export interface NativeMeasurementEvent {
  type: 'click' | 'download';
  url: string;
  filename?: string;
}

/** One action can produce both an anchor event and an Electron notification. */
export function createLinkMeasurement(
  options: LinkMeasurementOptions,
  origin: string,
  track: (name: string, params: GA4EventParams) => void,
) {
  const recent = new Map<string, { source: string; time: number }>();
  const redacted = options.privacy === 'redacted';
  const domain = new URL(origin).hostname;
  function emit(
    name: string,
    url: URL,
    source: string,
    params: GA4EventParams,
  ) {
    const key = `${name}:${url.href}`;
    const now = Date.now();
    const previous = recent.get(key);
    if (previous && previous.source !== source && now - previous.time < 1500)
      return;
    for (const [key, entry] of recent)
      if (now - entry.time >= 1500) recent.delete(key);
    recent.set(key, { source, time: now });
    track(name, params);
  }
  return {
    record(
      type: 'click' | 'download',
      href: string,
      source: 'dom' | 'native',
      filename?: string,
      anchor?: Element,
    ) {
      let url: URL;
      try {
        url = new URL(href, origin);
      } catch {
        return;
      }
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        url.username ||
        url.password
      )
        return;
      const name =
        (filename ?? url.pathname.split('/').pop() ?? '')
          .split(/[\\/]/)
          .pop() ?? '';
      const extension = /\.([a-z0-9]{1,12})$/i.exec(name)?.[1]?.toLowerCase();
      const known =
        /^(pdf|txt|csv|rtf|docx?|xlsx?|pptx?|zip|gz|tgz|bz2|tar|7z|rar|mp[234]|m4a|wav|wma|aac|avi|mov|mpe?g|wmv|exe|dmg|pkg)$/i.test(
          extension ?? '',
        );
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
      if (
        type === 'click' &&
        options.outboundClicks &&
        url.hostname !== domain &&
        (typeof window === 'undefined' ||
          url.hostname !== window.location.hostname)
      ) {
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
