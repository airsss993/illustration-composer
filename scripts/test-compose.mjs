// Проверка web/compose.js на настоящей библиотеке. Запуск: node scripts/test-compose.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import * as C from '../web/compose.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const json = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const manifest = json('library/manifest.json');
const palettes = json('library/palettes.json');
const { layouts } = json('examples/layouts.json');
const tpl = (f) => C.toTemplate(readFileSync(join(ROOT, 'library', f), 'utf8'), palettes, manifest.sourceScheme);
const hexes = (s) => new Set((s.match(/#[0-9A-F]{6}/gi) ?? []).map((c) => c.toUpperCase()));

// Каждый пример собирается из своего состава в свою же раскладку и красится в любую схему без нарушений.
for (const l of layouts) {
  const ids = l.objects.map((o) => o.id);
  const res = C.compose([...ids].reverse(), l.format, manifest, layouts);
  assert.equal(res.template, l.file);
  assert.deepEqual(res.objects.map(({ rotation, ...o }) => o), l.objects);
  for (const size of ['L', 'S']) for (const scheme of palettes.schemes) {
    const colors = C.rolesOf(scheme, palettes);
    const objects = size === 'L' ? res.objects : res.objects.map((o) => C.resize(o, 'L', 'S', manifest));
    const svg = C.buildSvg({ format: l.format, size, background: res.background, objects }, colors, tpl, manifest);
    const allowed = new Set(Object.values(colors).map((c) => c.toUpperCase()));
    for (const c of hexes(svg)) assert(allowed.has(c), `${l.file} ${scheme.id}: ${c} вне схемы`);
    const bgOnly = new Set([...scheme.background, palettes.white].map((c) => c.toUpperCase()));
    const bgSvg = C.buildSvg({ format: l.format, size, background: res.background, objects: objects.filter((o) => o.state === 'background') }, colors, tpl, manifest);
    for (const c of hexes(bgSvg)) assert(bgOnly.has(c), `${l.file} ${scheme.id}: объектный ${c} в фоне`);
    assert(!/<image|data:image/.test(svg));
  }
}

// Незнакомый состав: раскладка того же числа объектов, все запрошенные на месте.
for (const ids of [['vase', 'pen'], ['coin', 'book', 'headphones'], ['folder', 'lamp']]) {
  for (const fmt of manifest.formats) {
    const res = C.compose(ids, fmt, manifest, layouts);
    assert.deepEqual(res.objects.map((o) => o.id).sort(), [...ids].sort(), `${ids} ${fmt}`);
    assert(res.template);
  }
}
// Часть состава примера: объекты остаются ровно на своих местах из примера.
for (const fmt of manifest.formats) {
  const res = C.compose(['coin', 'wallet'], fmt, manifest, layouts);
  const src = layouts.find((l) => l.file === res.template);
  assert.equal(res.objects.length, 2);
  for (const o of res.objects) {
    const { rotation, ...rest } = o;
    assert.deepEqual(rest, src.objects.find((x) => x.id === o.id));
  }
}
assert.equal(C.compose(['lamp'], [1000, 1000], manifest, layouts).objects.length, 1);
const four = C.compose(['book', 'pen', 'coin', 'lamp'], [1200, 630], manifest, layouts);
assert.equal(four.objects.length, 3);
assert.deepEqual(four.dropped, ['lamp']);
// Лампа в примерах только фоновая и за кадром: в чужой раскладке встаёт так же, а не главной на чужое место.
for (const fmt of manifest.formats) for (const ids of [['phone', 'wallet', 'lamp'], ['lamp', 'pen'], ['lamp', 'vase']]) {
  const res = C.compose(ids, fmt, manifest, layouts);
  const lamp = res.objects.find((o) => o.id === 'lamp');
  const src = layouts.find((l) => l.format.join() === fmt.join() && l.objects.some((o) => o.id === 'lamp')).objects.find((o) => o.id === 'lamp');
  assert.deepEqual([lamp.state, lamp.x, lamp.y], ['background', src.x, src.y], `${ids} ${fmt}`);
  assert(res.objects.some((o) => o.state === 'main'), `${ids} ${fmt}: нет главного`);
}
// Ни лампа, ни ваза не встают в чужое место: только туда, где стоят в примере этого формата.
for (const fmt of manifest.formats) for (const ids of [['vase', 'lamp', 'pen'], ['lamp', 'vase', 'coin'], ['pen', 'vase', 'lamp']]) {
  const res = C.compose(ids, fmt, manifest, layouts);
  const homes = layouts.filter((l) => l.format.join() === fmt.join()).flatMap((l) => l.objects);
  for (const o of res.objects.filter((x) => ['lamp', 'vase'].includes(x.id))) {
    assert(homes.some((h) => h.id === o.id && h.x === o.x && h.y === o.y), `${ids} ${fmt}: ${o.id} в чужом месте`);
  }
  assert.equal(res.objects.length + res.dropped.length, 3, `${ids} ${fmt}`);
}

// Перекраска не даёт объектный цвет фоновому объекту.
assert.throws(() => C.paint('{bg1}', C.rolesOf(palettes.schemes[0], palettes), { bg1: 'obj1' }, true));

// Разбор запросов.
assert.deepEqual(C.parseNames('Лампу, кошелёк и две монеты'), { ids: ['lamp', 'wallet', 'coin'], unknown: ['две'] });
assert.deepEqual(C.parseNames('наушники, ручка, папку').ids, ['headphones', 'pen', 'folder']);
assert.deepEqual(C.parseNames('book phone').ids, ['book', 'phone']);
assert.deepEqual(C.parseMetaphor('Финансовая грамотность: как копить деньги').sort(), ['coin', 'wallet']);
assert.equal(C.parseMetaphor('Светлая идея для вечера')[0], 'lamp');
assert.deepEqual(C.parseMetaphor('Подарок к 8 марта'), ['vase']);
assert.deepEqual(C.parseMetaphor('xyz qwerty'), []);

// Загрузка палитры.
const ok = { id: 'sea', background: ['#DDEEFF', '#AACCEE', '#336699'], object: ['#FFEEAA', '#FF8866', '#FFDDCC'] };
assert.equal(C.parsePalette(ok, ['lilac'])[0].id, 'sea');
assert.equal(C.parsePalette({ schemes: [ok, { ...ok, id: 'sea2' }] }).length, 2);
assert.throws(() => C.parsePalette({ ...ok, object: ['#DDEEFF', '#FF8866', '#FFDDCC'] }), /и в фоне, и в объектах/);
assert.throws(() => C.parsePalette({ ...ok, background: ['#DDEEFF'] }), /ровно 3/);
assert.throws(() => C.parsePalette(ok, ['sea']), /уже есть/);
assert.throws(() => C.parsePalette({ ...ok, id: 'a<b' }), /id - до 32/);

// L -> S -> L возвращает центр с точностью до округления.
const inst = { id: 'vase', state: 'main', x: 100, y: 200, rotation: 0 };
const back = C.resize(C.resize(inst, 'L', 'S', manifest), 'S', 'L', manifest);
assert(Math.abs(back.x - inst.x) <= 2 && Math.abs(back.y - inst.y) <= 2, JSON.stringify(back));

console.log(`ok: ${layouts.length} примеров x 2 набора x ${palettes.schemes.length} схемы, разбор, палитра, раскладка`);
