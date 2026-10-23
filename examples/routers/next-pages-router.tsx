// Next.js Pages Router used as the Electron Renderer. Set autoPageViews: false.
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { telemetry } from '../renderer';

export function GA4NextPagesRouterTracker() {
  const router = useRouter();
  useEffect(() => {
    const onRouteChange = () => {
      const path = router.pathname; // route template, excludes dynamic route values
      if (path === '/') telemetry.page('home');
      else if (path.startsWith('/downloads')) telemetry.page('downloads');
      else telemetry.page('other');
    };
    onRouteChange();
    router.events.on('routeChangeComplete', onRouteChange);
    return () => router.events.off('routeChangeComplete', onRouteChange);
  }, [router]);
  return null;
}
