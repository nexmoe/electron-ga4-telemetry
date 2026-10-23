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
  return client.initialize() ? options.measurementId.toUpperCase() : null;
})\n`;
writeFileSync(join(__dirname, '../dist/renderer-bootstrap.js'), source);
