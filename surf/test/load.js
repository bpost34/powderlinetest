// load the surf scripts into a sandbox for headless sims: node surf/test/<sim>.js
const fs = require('fs'), vm = require('vm'), path = require('path');
module.exports = function load(files, extra = '') {
  const root = path.join(__dirname, '..', '..');
  const ctx = { console, Math, Float32Array, Uint32Array, Uint16Array, Uint8Array, Map, Set, Infinity, isFinite };
  vm.createContext(ctx);
  let s = fs.readFileSync(path.join(root, 'js/math.js'), 'utf8') + '\n';
  for (const f of files) s += fs.readFileSync(path.join(root, 'surf/js', f + '.js'), 'utf8') + '\n';
  vm.runInContext(s + extra + '\n;this.__x={SEA,Ocean,Profile};', ctx);
  return ctx;
};
