// Runs before first paint to apply the saved theme and avoid a flash.
(function () {
  var pref = 'system';
  try { pref = JSON.parse(localStorage.getItem('fabriqon:theme')) || 'system'; } catch (e) { /* default */ }
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
