// Собирает examples/composed/*.svg тем же кодом, что и веб-редактор. Запуск: node scripts/make-examples.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from '../web/compose.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const json = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const manifest = json('library/manifest.json');
const palettes = json('library/palettes.json');
const { layouts } = json('examples/layouts.json');
const tpl = (f) => C.toTemplate(readFileSync(join(ROOT, 'library', f), 'utf8'), palettes, manifest.sourceScheme);

const CASES = [
  { name: 'metaphor-finance', query: 'Финансовая грамотность: как копить деньги', by: 'metaphor', format: [1200, 630], scheme: 'peach', size: 'L' },
  { name: 'names-vase-pen', query: 'ваза, ручка', by: 'names', format: [800, 1200], scheme: 'mint', size: 'L' },
  { name: 'metaphor-idea', query: 'Светлая идея для нового проекта', by: 'metaphor', format: [1000, 1000], scheme: 'lilac', size: 'S' },
];

mkdirSync(join(ROOT, 'examples', 'composed'), { recursive: true });
for (const c of CASES) {
  const ids = c.by === 'metaphor' ? C.parseMetaphor(c.query) : C.parseNames(c.query).ids;
  const res = C.compose(ids, c.format, manifest, layouts);
  const objects = c.size === 'L' ? res.objects : res.objects.map((o) => C.resize(o, 'L', c.size, manifest));
  const colors = C.rolesOf(palettes.schemes.find((s) => s.id === c.scheme), palettes);
  const svg = C.buildSvg({ format: c.format, size: c.size, background: res.background, objects }, colors, tpl, manifest);
  const file = `${c.name}-${c.format.join('x')}-${c.scheme}-${c.size}.svg`;
  writeFileSync(join(ROOT, 'examples', 'composed', file), `<!-- ${c.by}: "${c.query}" -> ${ids.join(', ')}; шаблон ${res.template} -->\n${svg}\n`);
  console.log(`${file}: ${ids.join(', ')} по шаблону ${res.template}`);
}
