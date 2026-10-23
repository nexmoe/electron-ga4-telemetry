'use client';
// Next.js App Router used as the Electron Renderer. Set autoPageViews: false.
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { telemetry } from '../renderer';

export function GA4NextAppRouterTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname === '/') telemetry.page('home');
    else if (pathname?.startsWith('/settings')) telemetry.page('settings');
    else telemetry.page('other'); // Static screen names protect against PII in URLs.
  }, [pathname]);
  return null;
}
