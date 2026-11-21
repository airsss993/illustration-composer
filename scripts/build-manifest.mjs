// Собирает library/manifest.json из SVG библиотеки и проверяет правила из docs/RULES.md.
// Запуск: node scripts/build-manifest.mjs. Любое нарушение - исключение и код выхода 1.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { rolesOf } from '../web/compose.js';

const LIB = join(dirname(fileURLToPath(import.meta.url)), '..', 'library');
const palettes = JSON.parse(readFileSync(join(LIB, 'palettes.json'), 'utf8'));

const NAMES = {
  book: ['книга'], phone: ['телефон', 'смартфон'], puzzle: ['пазл', 'пазлы'],
  coin: ['монета'], headphones: ['наушники'], lamp: ['лампа'],
  vase: ['ваза', 'тюльпаны', 'цветы'], wallet: ['кошелек', 'кошелёк'],
  folder: ['папка'], pen: ['ручка'],
};

// Объекты нарисованы только в lilac, поэтому роль цвета определяется по его hex в lilac.
function roleIndex(schemeId) {
  const scheme = palettes.schemes.find((s) => s.id === schemeId);
  assert(scheme, `нет схемы ${schemeId}`);
  const idx = Object.fromEntries(Object.entries(rolesOf(scheme, palettes)).map(([role, hex]) => [hex.toUpperCase(), role]));
  idx.WHITE = 'white';
  return idx;
}

function inspect(path, roleByHex = roleIndex('lilac')) {
  const svg = readFileSync(path, 'utf8');
  const m = svg.match(/<svg[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"/);
  assert(m, `${path}: нет width/height`);
  assert(!/<image|data:image/.test(svg), `${path}: растр`);
  const attrColors = [...svg.matchAll(/(?:fill|stroke)="(#[0-9a-fA-F]{6}|white)"/g)].map((x) => x[1].toUpperCase());
  // Цвет вне fill/stroke (style, stop-color) перекраска не увидит - запрещаем.
  assert.equal(svg.match(/#[0-9a-fA-F]{6}/g)?.length ?? 0,
    attrColors.filter((c) => c !== 'WHITE').length, `${path}: цвет вне атрибутов fill/stroke`);
  const roles = [...new Set(attrColors.map((c) => {
    assert(roleByHex[c], `${path}: цвет ${c} не из своей палитры`);
    return roleByHex[c];
  }))].sort();
  return { width: +m[1], height: +m[2], roles, tags: [...new Set([...svg.matchAll(/<([a-zA-Z]+)/g)].map((x) => x[1]))] };
}

const objects = [];
const scenes = [];
for (const size of ['L', 'S']) {
  for (const id of Object.keys(NAMES)) {
    const main = inspect(join(LIB, size, 'main', `${id}.svg`));
    const bg = inspect(join(LIB, size, 'background', `${id}.svg`));
    assert(main.roles.includes('ink'), `${size}/${id}: в главном нет чёрного`);
    assert.deepEqual(bg.roles, ['bg1', 'bg3'], `${size}/${id}: фоновое не в двух фоновых цветах`);
    for (const x of [main, bg]) {
      assert(x.tags.every((t) => ['svg', 'g', 'path'].includes(t)), `${size}/${id}: лишние теги ${x.tags}`);
    }
    if (size === 'L') {
      assert.deepEqual([main.width, main.height], [bg.width, bg.height], `L/${id}: габариты состояний разные`);
    }
    objects.push({
      id, size, names: NAMES[id], width: main.width, height: main.height,
      states: {
        main: { file: `${size}/main/${id}.svg`, roles: main.roles },
        background: { file: `${size}/background/${id}.svg`, roles: bg.roles, width: bg.width, height: bg.height },
      },
    });
  }
  for (const f of readdirSync(join(LIB, size, 'scene')).filter((f) => f.endsWith('.svg'))) {
    const scheme = f.replace('.svg', '');
    const s = inspect(join(LIB, size, 'scene', f), roleIndex(scheme));
    assert(s.roles.every((r) => !r.startsWith('obj')), `${f}: объектный цвет в фоне`);
    scenes.push({ scheme, size, kind: kindOf(join(LIB, size, 'scene', f)), file: `${size}/scene/${f}`, width: s.width, height: s.height, roles: s.roles });
  }
}

// Два вида фона: "lines" (клин bg2 и две длинные диагонали) и "confetti" (одна линия, пятна, штрихи).
function kindOf(path) {
  return readFileSync(path, 'utf8').match(/<line\b/g).length === 2 ? 'lines' : 'confetti';
}

// Фоны под форматы холста, вынуты из примеров (examples/svg), все в lilac.
const backgrounds = [];
for (const f of readdirSync(join(LIB, 'backgrounds')).filter((f) => f.endsWith('.svg'))) {
  const [, kind, w, h] = f.match(/^(lines|confetti)-(\d+)x(\d+)\.svg$/);
  const path = join(LIB, 'backgrounds', f);
  const s = inspect(path);
  assert.equal(kindOf(path), kind, `${f}: вид фона не совпал с именем`);
  assert.deepEqual([s.width, s.height], [+w, +h], `${f}: размер не совпал с именем`);
  assert(s.roles.every((r) => !r.startsWith('obj')), `${f}: объектный цвет в фоне`);
  backgrounds.push({ kind, format: [+w, +h], file: `backgrounds/${f}`, roles: s.roles });
}
const FORMATS = [[1000, 1000], [1200, 630], [800, 1200]];
for (const fmt of FORMATS) for (const kind of ['lines', 'confetti']) {
  assert(backgrounds.some((b) => b.kind === kind && b.format.join() === fmt.join()), `нет фона ${kind} ${fmt}`);
}

// S не везде вдвое меньше L: отношение пишем в манифест, чтобы редактор знал масштаб набора.
for (const o of objects.filter((o) => o.size === 'S')) {
  const l = objects.find((x) => x.size === 'L' && x.id === o.id);
  o.ratioToL = Math.round((o.width / l.width) * 100) / 100;
}

const manifest = {
  _generated: 'node scripts/build-manifest.mjs, не править руками',
  sourceScheme: 'lilac',
  formats: FORMATS,
  objects,
  backgrounds,
  scenes,
};
writeFileSync(join(LIB, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`ok: ${objects.length} объектов, ${backgrounds.length} фонов под форматы, ${scenes.length} фонов-образцов схем`);
