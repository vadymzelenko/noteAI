// NodeNote — настройки приложения (хранятся на этом устройстве).
// Prefs.get(key), Prefs.set(key, value), Prefs.onChange(cb).
// Визуальные настройки применяются через data-атрибуты на <html>.
(function () {
  'use strict';

  const KEY = 'nf.prefs';
  const DEFAULTS = {
    // Вид
    textSize: 'm',          // s | m | l | xl — размер текста заметок и редактора
    density: 'normal',      // compact | normal | cozy — плотность списков
    radius: 'normal',       // sharp | normal | round — скругления
    uiFont: 'geist',        // geist | system | serif
    motion: 'on',           // on | off — анимации
    // Заметки
    noteView: 'grid',       // grid | list
    covers: true,           // автоматические обложки-узоры
    coverStyle: 'auto',     // auto | grid | waves | arcs | triangles | rings | dots
    noteSort: 'updated',    // updated | created | title
    importantFirst: true,   // важные заметки наверху
    readMode: 'auto',       // auto | always | never — открывать в режиме чтения
    // Задачи
    doneVisible: 5,         // 0 | 3 | 5 | 10 — сколько выполненных показывать
    taskSort: 'deadline',   // deadline | importance | created
    taskDesc: true,         // показывать описание в списке
    // Редактор
    autosave: 'normal',     // fast | normal | slow
    listContinue: true,     // Enter продолжает списки
    spellcheck: true,
    monoDefault: false,     // моноширинный шрифт для новых записей
    // Ссылки
    linkPreviews: true,     // обложки и заголовки ссылок
    // Общее
    startMode: 'last',      // last | tasks | notes | links | projects
    haptics: true,          // вибрация на телефоне
  };

  let prefs = { ...DEFAULTS };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(KEY) || '{}') || {}); } catch { /* ignore */ }
  const listeners = new Set();

  function apply() {
    const r = document.documentElement;
    r.dataset.textSize = prefs.textSize;
    r.dataset.density = prefs.density;
    r.dataset.radius = prefs.radius;
    r.dataset.uiFont = prefs.uiFont;
    r.dataset.motion = prefs.motion;
  }

  function set(k, v) {
    if (!(k in DEFAULTS)) return;
    prefs[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
    apply();
    listeners.forEach((cb) => { try { cb(k, v); } catch { /* ignore */ } });
  }

  function reset() {
    prefs = { ...DEFAULTS };
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    apply();
    listeners.forEach((cb) => { try { cb('*'); } catch { /* ignore */ } });
  }

  apply();

  window.Prefs = {
    get: (k) => prefs[k],
    set,
    reset,
    all: () => ({ ...prefs }),
    defaults: DEFAULTS,
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    haptic(ms = 10) { if (prefs.haptics && navigator.vibrate) try { navigator.vibrate(ms); } catch { /* ignore */ } },
  };
})();
