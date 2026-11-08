// NodeFlow — ранняя установка темы (до отрисовки страницы), чтобы не было
// «вспышки» светлой/тёмной темы при загрузке.
(function () {
  'use strict';
  var LEGACY = {
    noir: ['dark', 'mono'], snow: ['light', 'mono'], graphite: ['light', 'mono'],
    azure: ['light', 'blue'], violet: ['light', 'violet'], sage: ['light', 'green'],
  };
  var pref = 'dark', accent = 'mono';
  try {
    pref = localStorage.getItem('nf.theme') || 'dark';
    accent = localStorage.getItem('nf.accent') || '';
    if (LEGACY[pref]) {
      if (!accent) accent = LEGACY[pref][1];
      pref = LEGACY[pref][0];
      localStorage.setItem('nf.theme', pref);
      localStorage.setItem('nf.accent', accent);
    }
  } catch (e) { /* localStorage недоступен — берём значения по умолчанию */ }
  if (pref !== 'light' && pref !== 'dark' && pref !== 'system') pref = 'dark';
  var resolved = pref === 'system'
    ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : pref;
  var root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.accent = accent || 'mono';
})();
