import * as C from './compose.js';

const $ = (s) => document.querySelector(s);
const getJSON = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
};
const [manifest, palettes, { layouts }] = await Promise.all([
  getJSON('../library/manifest.json'), getJSON('../library/palettes.json'), getJSON('../examples/layouts.json'),
]);

const templates = new Map();
async function load(files) {
  await Promise.all(files.filter((f) => !templates.has(f)).map(async (f) => {
    const r = await fetch(`../library/${f}`);
    if (!r.ok) throw new Error(`${f}: ${r.status}`);
    templates.set(f, C.toTemplate(await r.text(), palettes, manifest.sourceScheme));
  }));
}

const state = { format: [1000, 1000], size: 'L', scheme: 'lilac', background: 'lines', objects: [] };
let selected = -1;

const objOf = (inst, size = state.size) => manifest.objects.find((o) => o.size === size && o.id === inst.id);
// draft - схема из редактора палитры, пока её не сохранили: холст и библиотека рисуются в ней.
let draft = null;
const scheme = () => draft ?? palettes.schemes.find((s) => s.id === state.scheme);
const colors = () => C.rolesOf(scheme(), palettes);
const k = () => C.SIZE_SCALE[state.size];
const dims = (inst) => { const o = objOf(inst), st = o.states[inst.state]; return [st.width ?? o.width, st.height ?? o.height]; };
// Тот же transform, что у группы в buildSvg: рамка выделения повторяет объект.
const tf = (inst) => { const [w, h] = dims(inst); return `translate(${inst.x} ${inst.y})${inst.rotation ? ` rotate(${inst.rotation} ${w / 2} ${h / 2})` : ''}`; };
const NS = 'http://www.w3.org/2000/svg';
const ICON = {
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  off: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  state: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
  del: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

// Рамка выделения и зоны поворота у углов. Рисуется поверх холста и в экспорт не попадает.
function frame() {
  const svg = $('#stage svg');
  svg?.querySelector('#frame')?.remove();
  const inst = state.objects[selected];
  if (!svg || !inst || inst.hidden) return;
  const [w, h] = dims(inst);
  const px = svg.viewBox.baseVal.width / svg.getBoundingClientRect().width; // единиц холста на экранный пиксель
  const pad = 4 * px, s = 9 * px;
  const corners = [[-pad, -pad], [w + pad, -pad], [w + pad, h + pad], [-pad, h + pad]];
  const g = document.createElementNS(NS, 'g');
  g.id = 'frame';
  g.setAttribute('transform', tf(inst));
  g.innerHTML = corners.map(([x, y]) => `<circle class="rot" cx="${x}" cy="${y}" r="${20 * px}" fill="transparent"/>`).join('')
    + `<rect x="${-pad}" y="${-pad}" width="${w + 2 * pad}" height="${h + 2 * pad}" fill="none" stroke="#5b3df2" stroke-width="1.5" vector-effect="non-scaling-stroke" pointer-events="none"/>`
    + corners.map(([x, y]) => `<rect x="${x - s / 2}" y="${y - s / 2}" width="${s}" height="${s}" fill="#fff" stroke="#5b3df2" stroke-width="1.5" vector-effect="non-scaling-stroke" pointer-events="none"/>`).join('');
  svg.append(g);
}
addEventListener('resize', frame);

const calm = matchMedia('(prefers-reduced-motion: reduce)');
const fadeIn = (el, from = {}) => el && !calm.matches
  && el.animate([{ opacity: 0, ...from }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,.7,.3,1)' });

function say(text, isError = false) {
  const st = $('#status');
  // Перезапуск появления: новое сообщение заметно, даже если плашка уже была на экране.
  st.style.animation = 'none'; st.offsetWidth; st.style.animation = '';
  st.textContent = text;
  $('#status').classList.toggle('err', isError);
}

function neededFiles() {
  const files = state.objects.map((i) => objOf(i).states[i.state].file);
  if (state.background !== 'none') {
    files.push(manifest.backgrounds.find((b) => b.kind === state.background && b.format.join() === state.format.join()).file);
  }
  return files;
}

async function render() {
  await load(neededFiles());
  // Пока шли загрузки, состояние могло смениться: тогда нарисует render(), вызванный после смены.
  if (neededFiles().some((f) => !templates.has(f))) return;
  $('#stage').innerHTML = C.buildSvg(state, colors(), (f) => templates.get(f), manifest);
  const [W, H] = state.format.map((v) => Math.round(v * k()));
  const s = scheme();
  const n = state.objects.length;
  const word = n % 10 === 1 && n % 100 !== 11 ? 'объект' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'объекта' : 'объектов';
  const dots = [s.background[0], s.background[2], s.object[1]].map((c) => `<i style="background:${c}"></i>`).join('');
  $('#info').innerHTML = `<li><b>${W} x ${H}</b> px</li><li><span class="dots">${dots}</span><b>${s.id[0].toUpperCase() + s.id.slice(1)}</b></li>`
    + `<li>Набор <b>${state.size}</b></li><li><b>${n}</b> ${word}</li>`;

  frame();
  renderLayers();
  const pressed = (box, v) => box.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === v));
  pressed($('#format'), state.format.join('x'));
  pressed($('#scheme'), state.scheme);
  syncDropdowns.forEach((sync) => sync());
}

// Слои: верхний первым. Строку можно перетащить, скрыть или удалить.
function renderLayers() {
  const list = $('#layers');
  list.innerHTML = '';
  [...state.objects.keys()].reverse().forEach((i) => {
    const inst = state.objects[i];
    const o = objOf(inst, 'L'); // превью из набора L: его файлы уже загружены библиотекой
    const li = document.createElement('li');
    li.dataset.i = i;
    li.classList.toggle('off', !!inst.hidden);
    li.setAttribute('aria-current', i === selected);
    const name = o.names[0][0].toUpperCase() + o.names[0].slice(1);
    li.innerHTML = `<button type="button" class="pickl"><svg viewBox="0 0 ${o.width} ${o.height}" fill="none" aria-hidden="true">${C.paint(templates.get(o.states.main.file) ?? '', colors())}</svg>`
      + `<span>${name}<small>${inst.state === 'main' ? 'главный' : 'фоновый'}${inst.rotation ? `, ${inst.rotation}°` : ''}</small></span></button>`
      + `<button type="button" class="ic" data-l="state" aria-label="${inst.state === 'main' ? 'Сделать фоновым' : 'Сделать главным'}: ${o.names[0]}" title="${inst.state === 'main' ? 'Сделать фоновым' : 'Сделать главным'}">${icon('state')}</button>`
      + `<button type="button" class="ic" data-l="dup" aria-label="Дублировать: ${o.names[0]}" title="Дублировать, Cmd/Ctrl+D">${icon('dup')}</button>`
      + `<button type="button" class="ic" data-l="hide" aria-pressed="${!!inst.hidden}" aria-label="${inst.hidden ? 'Показать' : 'Скрыть'}: ${o.names[0]}" title="${inst.hidden ? 'Показать' : 'Скрыть'}">${icon(inst.hidden ? 'off' : 'eye')}</button>`
      + `<button type="button" class="ic" data-l="del" aria-label="Удалить: ${o.names[0]}" title="Удалить">${icon('del')}</button>`;
    list.append(li);
  });
}
// Смена порядка или удаление слоя не должны терять выделенный объект.
function edit(change) {
  const cur = state.objects[selected];
  change();
  selected = cur && !cur.hidden ? state.objects.indexOf(cur) : -1;
  render();
}
$('#layers').onclick = (e) => {
  const li = e.target.closest('li[data-i]');
  const b = e.target.closest('button');
  if (!li || !b) return;
  const i = Number(li.dataset.i);
  if (b.dataset.l === 'del') edit(() => state.objects.splice(i, 1));
  else if (b.dataset.l === 'state') edit(() => actions.state(state.objects[i]));
  else if (b.dataset.l === 'dup') { actions.dup(i); render(); }
  else if (b.dataset.l === 'hide') edit(() => { state.objects[i].hidden = !state.objects[i].hidden; });
  else if (!state.objects[i].hidden) select(i);
};
// Порядок слоёв: перетаскивание указателем. Мышью - за всю строку, пальцем - за миниатюру
// (у неё touch-action: none, остальная строка прокручивает страницу). Без сдвига это клик.
let lift = null;
$('#layers').onpointerdown = (e) => {
  const li = e.target.closest('li[data-i]');
  if (!li || !e.target.closest('.pickl') || e.button > 0) return;
  lift = { li, from: Number(li.dataset.i), y: e.clientY, on: false, id: e.pointerId };
};
$('#layers').onpointermove = (e) => {
  if (!lift || e.pointerId !== lift.id) return;
  if (!lift.on && Math.abs(e.clientY - lift.y) < 5) return;
  if (!lift.on) { lift.on = true; $('#layers').setPointerCapture(e.pointerId); lift.li.classList.add('lift'); }
  const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('#layers li[data-i]');
  lift.to = over ? Number(over.dataset.i) : lift.to;
  for (const x of $('#layers').children) x.classList.toggle('drop', x === over && x !== lift.li);
};
const drop = () => {
  const l = lift;
  lift = null;
  if (!l?.on) return;
  for (const x of $('#layers').children) x.classList.remove('drop', 'lift');
  if (l.to === undefined || l.to === l.from) return;
  edit(() => state.objects.splice(l.to, 0, ...state.objects.splice(l.from, 1)));
};
$('#layers').onpointerup = drop;
$('#layers').onpointercancel = () => { if (lift?.on) for (const x of $('#layers').children) x.classList.remove('drop', 'lift'); lift = null; };

function select(i) {
  selected = i;
  return render();
}

function apply(ids, how) {
  if (!ids.length) {
    say(how === 'metaphor'
      ? 'Не нашёл объектов под эту фразу. Попробуйте другие слова или соберите по названиям.'
      : 'Не узнал ни одного названия. Есть: книга, телефон, пазл, монета, наушники, лампа, ваза, кошелёк, папка, ручка.', true);
    return;
  }
  const res = C.compose(ids, state.format, manifest, layouts);
  state.background = res.background;
  state.objects = res.objects.map((o) => (state.size === 'L' ? o : C.resize(o, 'L', state.size, manifest)));
  $('#background').value = state.background;
  selected = -1;
  const names = ids.slice(0, 3).map((id) => objOf({ id }).names[0]).join(', ');
  const base = res.template ? `раскладка по примеру ${res.template.replace('svg/', '')}` : 'объект по центру';
  say(`Собрано: ${names}; ${base}.${res.dropped?.length ? ` Не поместились: ${res.dropped.join(', ')}, добавьте вручную.` : ''}`);
  render().then(() => fadeIn($('#stage svg'), { transform: 'scale(.98)' }));
}

// Сначала модель на сервере, при любой ошибке (статический хостинг, нет ключа, лимит) - словарь.
async function askModel(q) {
  try {
    const r = await fetch('../api/metaphor', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q }), signal: AbortSignal.timeout(40000),
    });
    const data = r.ok ? await r.json() : null;
    return data?.ids?.length ? data : null;
  } catch {
    return null;
  }
}
$('#byMetaphor').onsubmit = async (e) => {
  e.preventDefault();
  const q = e.target.q.value, button = e.target.querySelector('button');
  button.disabled = true;
  say('Подбираю объекты...');
  const ai = await askModel(q);
  button.disabled = false;
  apply(ai?.ids ?? C.parseMetaphor(q), 'metaphor');
  if (ai) say(`${$('#status').textContent} ${ai.model}: ${ai.reason}`);
  else if ($('#status').textContent.startsWith('Собрано')) say(`${$('#status').textContent} Разбор словарём.`);
};
$('#byNames').onsubmit = (e) => {
  e.preventDefault();
  const { ids, unknown } = C.parseNames(e.target.q.value);
  apply(ids, 'names');
  if (ids.length && unknown.length) say(`${$('#status').textContent} Не узнал: ${unknown.join(', ')}.`);
};

// Холст
$('#format').innerHTML = manifest.formats.map(([w, h]) =>
  `<button type="button" data-v="${w}x${h}"><span class="ratio" style="aspect-ratio:${w}/${h}"></span>${w} x ${h}</button>`).join('');
$('#format').onclick = (e) => {
  const v = e.target.closest('button')?.dataset.v;
  if (!v || v === state.format.join('x')) return;
  const next = v.split('x').map(Number);
  // Объекты остаются на своих местах относительно центра холста.
  const dx = Math.round(((next[0] - state.format[0]) / 2) * k());
  const dy = Math.round(((next[1] - state.format[1]) / 2) * k());
  state.objects = state.objects.map((o) => ({ ...o, x: o.x + dx, y: o.y + dy }));
  state.format = next;
  render();
};
// Свой список поверх скрытого select: системное меню не стилизуется. Значение и change остаются у select.
function dropdown(sel) {
  const wrap = document.createElement('div');
  const btn = document.createElement('button');
  const list = document.createElement('ul');
  wrap.className = 'dd';
  btn.type = 'button';
  btn.setAttribute('aria-haspopup', 'listbox');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', sel.getAttribute('aria-label'));
  list.innerHTML = [...sel.options].map((o) => `<li role="option" tabindex="-1" data-v="${o.value}">${o.text}</li>`).join('');
  const sync = () => {
    btn.textContent = sel.selectedOptions[0].text;
    btn.setAttribute('aria-label', `${sel.getAttribute('aria-label')}: ${btn.textContent}`);
    for (const li of list.children) li.setAttribute('aria-selected', li.dataset.v === sel.value);
  };
  const open = (on) => {
    list.hidden = !on;
    btn.setAttribute('aria-expanded', on);
    if (on) list.querySelector('[aria-selected=true]').focus();
  };
  const pick = (v) => {
    open(false);
    btn.focus();
    if (v === sel.value) return;
    sel.value = v;
    sync();
    sel.dispatchEvent(new Event('change'));
  };
  btn.onclick = () => open(list.hidden);
  btn.onkeydown = (e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(true); } };
  list.onclick = (e) => { const li = e.target.closest('li'); if (li) pick(li.dataset.v); };
  list.onkeydown = (e) => {
    const items = [...list.children], i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(items[i].dataset.v); }
    else if (e.key === 'Escape') { open(false); btn.focus(); }
    else if (e.key === 'Tab') open(false);
  };
  document.addEventListener('pointerdown', (e) => { if (!list.hidden && !wrap.contains(e.target)) open(false); });
  sel.hidden = true;
  wrap.append(btn, list);
  sel.after(wrap);
  open(false);
  sync();
  return sync;
}
const syncDropdowns = [dropdown($('#size')), dropdown($('#background'))];

$('#size').onchange = (e) => {
  state.objects = state.objects.map((o) => C.resize(o, state.size, e.target.value, manifest));
  state.size = e.target.value;
  render();
};
$('#background').onchange = (e) => { state.background = e.target.value; render(); };

// Кружки схемы: светлый и тёмный фоновый, главный объектный цвет.
function fillSchemes() {
  $('#scheme').innerHTML = palettes.schemes.map((s) =>
    `<button type="button" data-v="${s.id}"><span class="dots">${[s.background[0], s.background[2], s.object[1]].map((c) => `<i style="background:${c}"></i>`).join('')}</span>${s.id}</button>`).join('');
}
fillSchemes();
$('#scheme').onclick = (e) => {
  const v = e.target.closest('button')?.dataset.v;
  if (!v) return;
  // Выбор готовой схемы закрывает редактор и отменяет черновик.
  if (draft) { draft = null; $('#custom').open = false; } else if (v === state.scheme) return;
  state.scheme = v;
  redraw();
};
// Редактор своей схемы. Проверка та же, что у загрузки из файла.
const pf = $('#paletteForm');
const swatches = (k) => [...pf.querySelectorAll(`[data-k=${k}] input`)];
const readDraft = () => ({
  id: pf.elements.sid.value.trim(),
  background: swatches('background').map((i) => i.value.toUpperCase()),
  object: swatches('object').map((i) => i.value.toUpperCase()),
});
const redraw = () => { render(); renderLib(); };
$('#custom').ontoggle = () => {
  if (!$('#custom').open) { if (draft) { draft = null; redraw(); } return; }
  const s = scheme();
  swatches('background').forEach((i, n) => { i.value = s.background[n].toLowerCase(); });
  swatches('object').forEach((i, n) => { i.value = s.object[n].toLowerCase(); });
  let n = 1;
  while (palettes.schemes.some((x) => x.id === `своя-${n}`)) n += 1;
  pf.elements.sid.value = `своя-${n}`;
};
pf.oninput = (e) => {
  if (e.target.type !== 'color') return;
  draft = { ...readDraft(), id: pf.elements.sid.value.trim() || 'своя' };
  redraw();
};
pf.onsubmit = (e) => {
  e.preventDefault();
  try {
    const [added] = C.parsePalette(readDraft(), palettes.schemes.map((s) => s.id));
    palettes.schemes.push(added);
    state.scheme = added.id;
    draft = null;
    fillSchemes();
    $('#custom').open = false;
    say(`Схема ${added.id} сохранена.`);
    redraw();
  } catch (err) {
    say(`Схема не сохранена: ${err.message}`, true);
  }
};
$('#palette').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const added = C.parsePalette(JSON.parse(await file.text()), palettes.schemes.map((s) => s.id));
    palettes.schemes.push(...added);
    state.scheme = added[0].id;
    draft = null;
    $('#custom').open = false;
    fillSchemes();
    say(`Палитра загружена: ${added.map((s) => s.id).join(', ')}.`);
    render();
    renderLib();
  } catch (err) {
    say(`Палитра не принята: ${err.message}`, true);
  }
};

// Библиотека: превью в текущей схеме
async function renderLib() {
  const lib = manifest.objects.filter((o) => o.size === 'L');
  await load(lib.map((o) => o.states.main.file));
  $('#lib').innerHTML = '';
  for (const o of lib) {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = `Добавить: ${o.names[0]}`;
    b.setAttribute('aria-label', b.title);
    b.innerHTML = `<svg viewBox="0 0 ${o.width} ${o.height}" fill="none">${C.paint(templates.get(o.states.main.file), colors())}</svg>`;
    b.onclick = () => {
      const s = objOf(o);
      const [W, H] = state.format.map((v) => v * k());
      state.objects.push({ id: o.id, state: 'main', rotation: 0, x: Math.round((W - s.width) / 2), y: Math.round((H - s.height) / 2) });
      const i = state.objects.length - 1;
      select(i).then(() => fadeIn($(`#stage g[data-i="${i}"]`)));
    };
    $('#lib').append(b);
  }
}

// Выбранный объект
const actions = {
  state(o) {
    o.state = o.state === 'main' ? 'background' : 'main';
    delete o.recolor; // перестановка ролей главного объекта в фоновом недопустима
  },
  dup(i) {
    const o = state.objects[i];
    state.objects.splice(i + 1, 0, { ...o, hidden: false, x: o.x + 40, y: o.y + 40 });
    selected = i + 1;
  },
};
document.addEventListener('keydown', (e) => {
  if (selected < 0 || e.target.matches?.('input, select, [role=option]')) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); edit(() => state.objects.splice(selected, 1)); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); actions.dup(selected); render(); }
});

// Перенос мышью или пальцем
let drag = null;
const toSvg = (svg, e) => new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
$('#stage').addEventListener('pointerdown', (e) => {
  const svg = $('#stage svg');
  const g = e.target.closest('g[data-i]');
  if (!svg || !svg.contains(e.target)) return;
  if (e.target.classList.contains('rot')) {
    const o = state.objects[selected];
    const [w, h] = dims(o);
    const p = toSvg(svg, e);
    const c = { x: o.x + w / 2, y: o.y + h / 2 };
    drag = { i: selected, rotate: true, svg, g: svg.querySelector(`g[data-i="${selected}"]`), c, a0: Math.atan2(p.y - c.y, p.x - c.x), r0: o.rotation, moved: false };
    $('#stage').setPointerCapture(e.pointerId);
    return;
  }
  if (!g) { if (selected >= 0) select(-1); return; }
  const i = Number(g.dataset.i);
  const p = toSvg(svg, e);
  drag = { i, g, svg, dx: p.x - state.objects[i].x, dy: p.y - state.objects[i].y, moved: false };
  $('#stage').setPointerCapture(e.pointerId);
  // Выделять сразу при нажатии, а не после отпускания. render заменяет svg, поэтому ссылки для переноса берём заново.
  if (i !== selected) {
    select(i).then(() => {
      if (drag?.i !== i) return;
      drag.svg = $('#stage svg');
      drag.g = $(`#stage g[data-i="${i}"]`);
    });
  }
});
$('#stage').addEventListener('pointermove', (e) => {
  if (!drag) return;
  const p = toSvg(drag.svg, e);
  const o = state.objects[drag.i];
  if (drag.rotate) {
    // Shift - шаг 15 градусов.
    let r = drag.r0 + ((Math.atan2(p.y - drag.c.y, p.x - drag.c.x) - drag.a0) * 180) / Math.PI;
    r = ((((e.shiftKey ? Math.round(r / 15) * 15 : Math.round(r)) + 180) % 360) + 360) % 360 - 180;
    o.rotation = r;
  } else {
    o.x = Math.round(p.x - drag.dx);
    o.y = Math.round(p.y - drag.dy);
  }
  drag.moved = true;
  for (const el of [drag.g, drag.svg.querySelector('#frame')]) el?.setAttribute('transform', tf(o));
});
$('#stage').addEventListener('pointerup', () => {
  if (!drag) return;
  const { i, moved } = drag;
  drag = null;
  if (moved || i !== selected) select(i);
});

$('#export').onclick = async () => {
  await render();
  const svg = C.buildSvg(state, colors(), (f) => templates.get(f), manifest);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  a.download = `illustration-${state.format.join('x')}-${state.scheme}-${state.size}.svg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

renderLib();
apply(['lamp', 'wallet', 'coin'], 'names');
