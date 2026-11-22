// NodeNote — выбор даты и времени дедлайна (вместо системного календаря).
// DatePicker.open({ value, title }) → Promise<{ ts } | { clear: true } | null>
(function () {
  'use strict';

  const NF = window.NF;
  const { escapeHtml, svgIcon, pad2 } = NF;

  const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const WD_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  const TIMES = ['09:00', '12:00', '15:00', '18:00', '21:00', '23:59'];

  const day0 = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  function relText(ts) {
    const diff = day0(ts) - day0(Date.now());
    const d = Math.round(diff / 86400000);
    if (d === 0) return 'сегодня';
    if (d === 1) return 'завтра';
    if (d === 2) return 'послезавтра';
    if (d === -1) return 'вчера';
    if (d > 0) return `через ${d} ${NF.plural(d, 'день', 'дня', 'дней')}`;
    return `${-d} ${NF.plural(-d, 'день', 'дня', 'дней')} назад`;
  }

  function open({ value = null, title = 'Дедлайн' } = {}) {
    return new Promise((resolve) => {
      const now = new Date();
      let sel = value ? new Date(value) : null;
      let time = sel ? `${pad2(sel.getHours())}:${pad2(sel.getMinutes())}` : (now.getHours() < 18 ? '18:00' : '21:00');
      let view = new Date((sel || now).getFullYear(), (sel || now).getMonth(), 1);

      const ov = document.createElement('div');
      ov.className = 'modal-overlay dp-overlay';
      ov.setAttribute('role', 'dialog');
      ov.setAttribute('aria-modal', 'true');
      ov.setAttribute('aria-label', title);
      ov.innerHTML = `<div class="modal modal-xs dp"></div>`;
      document.body.appendChild(ov);
      const box = ov.querySelector('.dp');

      const withTime = (d) => {
        const [h, m] = time.split(':').map(Number);
        const x = new Date(d); x.setHours(h, m, 0, 0); return x;
      };

      const quick = () => {
        const t = new Date();
        const at = (addDays, hh, mm = 0) => { const x = new Date(t); x.setDate(x.getDate() + addDays); x.setHours(hh, mm, 0, 0); return x; };
        const evening = t.getHours() < 19 ? at(0, 19) : at(0, Math.min(23, t.getHours() + 1), t.getHours() >= 23 ? 59 : 0);
        const nextMon = (() => { const x = at(0, 9); const dd = (8 - x.getDay()) % 7 || 7; x.setDate(x.getDate() + dd); return x; })();
        return [
          { label: t.getHours() < 19 ? 'Сегодня вечером' : 'Сегодня позже', d: evening },
          { label: 'Завтра утром', d: at(1, 9) },
          { label: 'Через 3 дня', d: at(3, 18) },
          { label: 'В понедельник', d: nextMon },
          { label: 'Через неделю', d: at(7, 18) },
        ];
      };

      function render() {
        const cur = sel ? withTime(sel) : null;
        const first = new Date(view);
        const offset = (first.getDay() + 6) % 7;     // неделя с понедельника
        const daysIn = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
        const cells = [];
        for (let i = 0; i < offset; i++) cells.push('<span class="dp-cell dp-blank"></span>');
        for (let d = 1; d <= daysIn; d++) {
          const date = new Date(view.getFullYear(), view.getMonth(), d);
          const cls = [
            'dp-cell',
            sameDay(date, now) ? 'today' : '',
            sel && sameDay(date, sel) ? 'sel' : '',
            day0(date) < day0(now) ? 'past' : '',
            [0, 6].includes(date.getDay()) ? 'wknd' : '',
          ].join(' ');
          cells.push(`<button type="button" class="${cls}" data-day="${d}">${d}</button>`);
        }
        box.innerHTML = `
          <div class="dp-head">
            <div class="dp-sum">
              <div class="dp-big">${cur ? `${cur.getDate()} ${MONTHS_GEN[cur.getMonth()]}<span>, ${escapeHtml(time)}</span>` : 'Без даты'}</div>
              <div class="dp-rel">${cur ? `${WD_FULL[cur.getDay()]} · ${relText(cur)}` : 'Выбери день и время'}</div>
            </div>
            <button class="icon-btn sm" data-x aria-label="Закрыть">${svgIcon('close', 16, 2.2)}</button>
          </div>
          <div class="dp-quick">${quick().map((q, i) => `<button type="button" class="chip" data-q="${i}">${q.label}</button>`).join('')}</div>
          <div class="dp-cal">
            <div class="dp-month">
              <button type="button" class="icon-btn sm" data-nav="-1" aria-label="Предыдущий месяц">${svgIcon('back', 16, 2)}</button>
              <b>${MONTHS[view.getMonth()]} ${view.getFullYear()}</b>
              <button type="button" class="icon-btn sm dp-next" data-nav="1" aria-label="Следующий месяц">${svgIcon('back', 16, 2)}</button>
            </div>
            <div class="dp-grid dp-wd">${WD.map((w, i) => `<span class="${i > 4 ? 'wknd' : ''}">${w}</span>`).join('')}</div>
            <div class="dp-grid dp-days">${cells.join('')}</div>
          </div>
          <div class="dp-times">
            ${TIMES.map((t) => `<button type="button" class="chip ${t === time ? 'active' : ''}" data-t="${t}">${t}</button>`).join('')}
            <label class="dp-time-custom" title="Своё время">${svgIcon('clock', 14)}<input type="time" value="${escapeHtml(time)}" aria-label="Время"></label>
          </div>
          <div class="dp-foot">
            ${value ? '<button type="button" class="btn ghost danger" data-clear>Убрать дедлайн</button>' : '<span></span>'}
            <button type="button" class="btn primary" data-ok ${sel ? '' : 'disabled'}>Готово</button>
          </div>`;

        box.querySelector('[data-x]').onclick = () => done(null);
        box.querySelectorAll('[data-nav]').forEach((b) => (b.onclick = () => { view = new Date(view.getFullYear(), view.getMonth() + +b.dataset.nav, 1); render(); }));
        box.querySelectorAll('[data-day]').forEach((b) => (b.onclick = () => { sel = new Date(view.getFullYear(), view.getMonth(), +b.dataset.day); render(); }));
        box.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => {
          const q = quick()[+b.dataset.q].d;
          sel = q; time = `${pad2(q.getHours())}:${pad2(q.getMinutes())}`;
          view = new Date(q.getFullYear(), q.getMonth(), 1);
          done({ ts: withTime(sel).getTime() });
        }));
        box.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { time = b.dataset.t; if (!sel) sel = new Date(); render(); }));
        const ti = box.querySelector('input[type="time"]');
        ti.onchange = () => { if (ti.value) { time = ti.value; if (!sel) sel = new Date(); render(); } };
        const clr = box.querySelector('[data-clear]');
        if (clr) clr.onclick = () => done({ clear: true });
        box.querySelector('[data-ok]').onclick = () => { if (sel) done({ ts: withTime(sel).getTime() }); };
      }

      const done = (val) => {
        ov.classList.remove('open');
        document.removeEventListener('keydown', onKey, true);
        setTimeout(() => ov.remove(), 260);
        resolve(val);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); done(null); }
        if (e.key === 'Enter' && sel && e.target.tagName !== 'INPUT') { e.preventDefault(); e.stopPropagation(); done({ ts: withTime(sel).getTime() }); }
      };
      document.addEventListener('keydown', onKey, true);
      ov.addEventListener('mousedown', (e) => { if (e.target === ov) done(null); });
      render();
      requestAnimationFrame(() => ov.classList.add('open'));
    });
  }

  window.DatePicker = { open };
})();
