import { protocol, net } from 'electron';
import { existsSync, statSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Optional packaged SPA asset handler for app://bundle/index.html.
 * Before app.whenReady(), register:
 * protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
 * Then call registerSpaAppProtocol(distRoot) AFTER app.whenReady().
 * If BrowserWindow uses a custom session/partition, register on THAT session's protocol.
 */
export function registerSpaAppProtocol(distRoot: string) {
  const root = resolve(distRoot);
  protocol.handle('app', (request) => {
    let parsed: URL;
    try { parsed = new URL(request.url); }
    catch { return new Response('Bad URL', { status: 400 }); }
    if (parsed.hostname !== 'bundle' || parsed.username || parsed.password) {
      return new Response('Bad host', { status: 403 });
    }
    let pathname: string;
    try { pathname = decodeURIComponent(parsed.pathname); }
    catch { return new Response('Invalid path', { status: 400 }); }
    if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').includes('..')) {
      return new Response('Forbidden path', { status: 403 });
    }
    const absolutePath = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    const rel = relative(root, absolutePath);
    if (rel.startsWith('..') || isAbsolute(rel)) return new Response('Forbidden path', { status: 403 });
    let file = absolutePath;
    if (!existsSync(file) || !statSync(file).isFile()) {
      // SPA history routes fall back to index.html; missing JS/CSS assets should 404.
      if (extname(file)) return new Response('Not found', { status: 404 });
      file = resolve(root, 'index.html');
    }
    if (!existsSync(file)) return new Response('Missing index.html', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}
