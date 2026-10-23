// react-router-dom v6/v7. Use ONLY when telemetry has autoPageViews: false.
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { telemetry } from '../renderer';

function screenForRoute(pathname: string) {
  if (pathname === '/') return 'home';
  if (pathname === '/downloads') return 'downloads';
  if (pathname.startsWith('/settings')) return 'settings';
  if (/^\/videos\/[^/]+$/.test(pathname)) return 'videos/detail';
  return 'other';
}

export function GA4ReactRouterTracker() {
  const { pathname } = useLocation();
  useEffect(() => { telemetry.page(screenForRoute(pathname)); }, [pathname]);
  return null;
}
