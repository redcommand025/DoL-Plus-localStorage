// Paste this in the browser console after the game has loaded
// (or add as a bookmarklet)
fetch('https://redcommand025.github.io/DoL-Plus-localStorage/danny-safe-loader.js')
  .then(r => r.text())
  .then(code => { eval(code); console.log('[Danny] loader injected'); })
  .catch(e => console.error('[Danny] failed to load', e));
