const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

// Bundle our compiled browser modules as static function bodies. No runtime eval,
// Node access, package loader, or host bundler configuration is required in the page.
const names = ['core', 'links', 'youtube', 'enhanced', 'gtag', 'desktop'];
const modules = names
  .map(
    (name) =>
      `${JSON.stringify('./' + name)}: function(require, module, exports) {\n${readFileSync(join(__dirname, '../dist', name + '.js'), 'utf8')}\n}`,
  )
  .join(',\n');
const source = `(function initializeDesktopAnalytics(options) {
  const modules = {${modules}};
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
})\n`;
writeFileSync(join(__dirname, '../dist/renderer-bootstrap.js'), source);
