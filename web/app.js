import * as C from './compose.js';

const $ = (s) => document.querySelector(s);
const getJSON = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
};
const [manifest, palettes, { layouts }] = await Promise.all([
  getJSON('/library/manifest.json'), getJSON('/library/palettes.json'), getJSON('/examples/layouts.json'),
]);

const templates = new Map();
async function load(files) {
  await Promise.all(files.filter((f) => !templates.has(f)).map(async (f) => {
    const r = await fetch(`/library/${f}`);
    if (!r.ok) throw new Error(`${f}: ${r.status}`);
    templates.set(f, C.toTemplate(await r.text(), palettes, manifest.sourceScheme));
  }));
}

const state = { format: [1000, 1000], size: 'L', scheme: 'lilac', background: 'lines', objects: [] };
let selected = -1;

const objOf = (inst, size = state.size) => manifest.objects.find((o) => o.size === size && o.id === inst.id);
const colors = () => C.rolesOf(palettes.schemes.find((s) => s.id === state.scheme), palettes);
const k = () => C.SIZE_SCALE[state.size];

function say(text, isError = false) {
  $('#status').textContent = text;
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
  $('#stage').innerHTML = C.buildSvg(state, colors(), (f) => templates.get(f), manifest, { selected });
  const [W, H] = state.format.map((v) => Math.round(v * k()));
  $('#info').textContent = `${W} x ${H} · ${state.scheme} · набор ${state.size} · объектов ${state.objects.length}`;

  $('#layers').innerHTML = '';
  [...state.objects.keys()].reverse().forEach((i) => {
    const inst = state.objects[i];
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${objOf(inst).names[0]} · ${inst.state === 'main' ? 'главный' : 'фоновый'}${inst.rotation ? ` · ${inst.rotation}°` : ''}`;
    b.setAttribute('aria-current', i === selected);
    b.onclick = () => select(i);
    const li = document.createElement('li');
    li.append(b);
    $('#layers').append(li);
  });
  $('#selected').disabled = selected < 0;
  if (selected >= 0) {
    $('#rotation').value = state.objects[selected].rotation;
    $('[data-act=up]').disabled = selected === state.objects.length - 1;
    $('[data-act=down]').disabled = selected === 0;
  }
}

function select(i) {
  selected = i;
  render();
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
  render();
}

$('#byMetaphor').onsubmit = (e) => {
  e.preventDefault();
  apply(C.parseMetaphor(e.target.q.value), 'metaphor');
};
$('#byNames').onsubmit = (e) => {
  e.preventDefault();
  const { ids, unknown } = C.parseNames(e.target.q.value);
  apply(ids, 'names');
  if (ids.length && unknown.length) say(`${$('#status').textContent} Не узнал: ${unknown.join(', ')}.`);
};

// Холст
$('#format').innerHTML = manifest.formats.map((f) => `<option value="${f.join('x')}">${f.join(' x ')}</option>`).join('');
$('#format').onchange = (e) => {
  const next = e.target.value.split('x').map(Number);
  // Объекты остаются на своих местах относительно центра холста.
  const dx = Math.round(((next[0] - state.format[0]) / 2) * k());
  const dy = Math.round(((next[1] - state.format[1]) / 2) * k());
  state.objects = state.objects.map((o) => ({ ...o, x: o.x + dx, y: o.y + dy }));
  state.format = next;
  render();
};
$('#size').onchange = (e) => {
  state.objects = state.objects.map((o) => C.resize(o, state.size, e.target.value, manifest));
  state.size = e.target.value;
  render();
};
$('#background').onchange = (e) => { state.background = e.target.value; render(); };

function fillSchemes() {
  $('#scheme').innerHTML = palettes.schemes.map((s) => `<option value="${s.id}">${s.id}</option>`).join('');
  $('#scheme').value = state.scheme;
}
fillSchemes();
$('#scheme').onchange = (e) => { state.scheme = e.target.value; render(); renderLib(); };
$('#palette').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const added = C.parsePalette(JSON.parse(await file.text()), palettes.schemes.map((s) => s.id));
    palettes.schemes.push(...added);
    state.scheme = added[0].id;
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
      select(state.objects.length - 1);
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
  dup(o) {
    state.objects.splice(selected + 1, 0, { ...o, x: o.x + 40, y: o.y + 40 });
    selected += 1;
  },
  del() {
    state.objects.splice(selected, 1);
    selected = -1;
  },
  up() {
    const [o] = state.objects.splice(selected, 1);
    state.objects.splice(++selected, 0, o);
  },
  down() {
    const [o] = state.objects.splice(selected, 1);
    state.objects.splice(--selected, 0, o);
  },
};
$('#selected').onclick = (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act || selected < 0 || e.target.disabled) return;
  actions[act](state.objects[selected]);
  render();
};
$('#rotation').oninput = (e) => {
  state.objects[selected].rotation = Number(e.target.value);
  render();
};
document.addEventListener('keydown', (e) => {
  if (selected < 0 || e.target.matches?.('input, select')) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); actions.del(); render(); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); actions.dup(state.objects[selected]); render(); }
});

// Перенос мышью или пальцем
let drag = null;
const toSvg = (svg, e) => new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
$('#stage').addEventListener('pointerdown', (e) => {
  const svg = $('#stage svg');
  const g = e.target.closest('g[data-i]');
  if (!svg || !svg.contains(e.target)) return;
  if (!g) { if (selected >= 0) select(-1); return; }
  const i = Number(g.dataset.i);
  const p = toSvg(svg, e);
  drag = { i, g, svg, dx: p.x - state.objects[i].x, dy: p.y - state.objects[i].y, moved: false };
  $('#stage').setPointerCapture(e.pointerId);
});
$('#stage').addEventListener('pointermove', (e) => {
  if (!drag) return;
  const p = toSvg(drag.svg, e);
  const o = state.objects[drag.i];
  o.x = Math.round(p.x - drag.dx);
  o.y = Math.round(p.y - drag.dy);
  drag.moved = true;
  drag.g.setAttribute('transform', drag.g.getAttribute('transform').replace(/translate\([^)]*\)/, `translate(${o.x} ${o.y})`));
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
