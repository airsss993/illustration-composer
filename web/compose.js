// Логика без DOM: роли цветов, разбор запроса, раскладка, сборка SVG.
// Один модуль для браузера (web/app.js) и для проверки в node (scripts/test-compose.mjs).

// Соответствие "роль -> hex" для схемы. Порядок цветов в схеме и есть роль.
export function rolesOf(scheme, palettes) {
  const r = { ink: palettes.ink, white: palettes.white };
  scheme.background.forEach((c, i) => { r[`bg${i + 1}`] = c; });
  scheme.object.forEach((c, i) => { r[`obj${i + 1}`] = c; });
  return r;
}

// Библиотека нарисована в одной схеме (manifest.sourceScheme). Каждый hex исходника
// заменяем на метку роли, дальше перекраска - подстановка hex по роли.
export function toTemplate(svgText, palettes, sourceScheme) {
  const src = palettes.schemes.find((s) => s.id === sourceScheme);
  const roleByHex = Object.fromEntries(Object.entries(rolesOf(src, palettes)).map(([k, v]) => [v.toUpperCase(), k]));
  roleByHex.WHITE = 'white';
  const m = svgText.match(/<svg[^>]*>([\s\S]*)<\/svg>\s*$/);
  if (!m) throw new Error('не SVG');
  return m[1].replace(/(fill|stroke)="(#[0-9a-fA-F]{6}|white)"/g, (_, attr, c) => {
    const role = roleByHex[c.toUpperCase()];
    if (!role) throw new Error(`цвет ${c} не из схемы ${sourceScheme}`);
    return `${attr}="{${role}}"`;
  });
}

// recolor экземпляра - перестановка ролей внутри схемы, а не произвольный hex.
// Фоновому объекту и фону объектные цвета запрещены (docs/RULES.md).
export function paint(template, colors, recolor = {}, backgroundOnly = false) {
  return template.replace(/\{(\w+)\}/g, (_, role) => {
    const r = recolor[role] ?? role;
    if (backgroundOnly && r.startsWith('obj')) throw new Error(`объектный цвет ${r} в фоне`);
    const hex = colors[r];
    if (!hex) throw new Error(`нет роли ${r}`);
    return hex;
  });
}

// Загруженная палитра: { id, background: [3 hex], object: [3 hex] }, как в library/palettes.json.
// Принимает одну схему, массив или { schemes: [...] }.
export function parsePalette(json, existingIds = []) {
  const list = Array.isArray(json) ? json : json.schemes ?? [json];
  const hex = /^#[0-9a-fA-F]{6}$/;
  return list.map((s, n) => {
    const where = `схема ${s?.id ?? n + 1}`;
    // id попадает в разметку интерфейса: только буквы, цифры, дефис и подчёркивание.
    if (!s || typeof s.id !== 'string' || !/^[\p{L}\d_-]{1,32}$/u.test(s.id)) throw new Error(`${where}: id - до 32 букв, цифр, - или _`);
    for (const k of ['background', 'object']) {
      if (!Array.isArray(s[k]) || s[k].length !== 3 || !s[k].every((c) => hex.test(c))) {
        throw new Error(`${where}: ${k} - ровно 3 цвета вида #RRGGBB`);
      }
    }
    const bg = new Set(s.background.map((c) => c.toUpperCase()));
    const clash = s.object.find((c) => bg.has(c.toUpperCase()));
    if (clash) throw new Error(`${where}: ${clash} и в фоне, и в объектах`);
    if (existingIds.includes(s.id)) throw new Error(`${where}: такой id уже есть`);
    return { id: s.id, background: s.background.map((c) => c.toUpperCase()), object: s.object.map((c) => c.toUpperCase()) };
  });
}

// Первая основа в каждом списке - название объекта (сценарий 2), остальные - смысловые
// ассоциации для метафоры (сценарий 1). Сравнение по началу слова, ё -> е.
const WORDS = {
  book: [['книг', 'книжк', 'book'], ['учеб', 'учит', 'знан', 'образован', 'обучен', 'школ', 'курс', 'чтен', 'чита', 'литератур', 'истори', 'библиот', 'студент', 'урок', 'опыт']],
  phone: [['телефон', 'смартфон', 'phone'], ['связ', 'звон', 'мобильн', 'приложен', 'онлайн', 'сообщен', 'чат', 'интернет', 'цифров', 'соцсет', 'уведомлен', 'гаджет', 'смс']],
  puzzle: [['пазл', 'puzzle'], ['задач', 'решен', 'головолом', 'стратег', 'команд', 'сотрудничеств', 'партнер', 'логик', 'собрат', 'сложн', 'вызов', 'проблем', 'деталь']],
  coin: [['монет', 'coin'], ['деньг', 'денег', 'финанс', 'бюджет', 'доход', 'инвест', 'экономи', 'накоп', 'кэшбэк', 'процент', 'вклад', 'выгод', 'прибыл', 'богат', 'сбережен', 'копил']],
  headphones: [['наушник', 'headphones'], ['музык', 'подкаст', 'звук', 'слуша', 'аудио', 'отдых', 'плейлист', 'песн', 'тишин', 'концентрац', 'релакс']],
  lamp: [['ламп', 'светильник', 'lamp'], ['идея', 'идеи', 'идей', 'идею', 'свет', 'вдохнов', 'творч', 'озарен', 'мысл', 'креатив', 'вечер', 'ночь', 'ночн', 'изобрет', 'гениальн', 'инсайт']],
  vase: [['ваз', 'тюльпан', 'цвет', 'букет', 'vase'], ['весн', 'подар', 'праздн', 'уют', 'дом', 'интерьер', 'красот', 'март', 'любов', 'забот', 'нежн']],
  wallet: [['кошел', 'кошельк', 'wallet'], ['плат', 'покуп', 'расход', 'карт', 'банк', 'зарплат', 'шопинг', 'трат', 'оплат', 'кредит', 'долг', 'финансов']],
  folder: [['папк', 'folder'], ['документ', 'архив', 'офис', 'работ', 'отчет', 'бумаг', 'порядок', 'порядк', 'налог', 'бухгалт', 'проект', 'файл', 'организац']],
  pen: [['ручк', 'pen'], ['письм', 'пиш', 'подпис', 'договор', 'запис', 'заметк', 'текст', 'автор', 'план', 'экзамен', 'контракт', 'сочинен', 'тетрад']],
};

const tokens = (text) => text.toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9]+/).filter(Boolean);
const hits = (word, stems) => stems.some((s) => word.startsWith(s));

// Сценарий 2: названия в порядке ввода, без повторов. Нераспознанные слова возвращаем.
export function parseNames(text) {
  const ids = [];
  const unknown = [];
  for (const w of tokens(text)) {
    const id = Object.keys(WORDS).find((k) => k === w || hits(w, WORDS[k][0]));
    if (id) { if (!ids.includes(id)) ids.push(id); } else if (w.length > 2) unknown.push(w);
  }
  return { ids, unknown };
}

// Сценарий 1: счёт совпадений по всем основам, название весит вдвое. Не больше max объектов.
export function parseMetaphor(text, max = 3) {
  const words = tokens(text);
  const score = Object.entries(WORDS).map(([id, [names, assoc]], order) => ({
    id, order,
    s: words.reduce((a, w) => a + (hits(w, names) ? 2 : hits(w, assoc) ? 1 : 0), 0),
  }));
  return score.filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.order - b.order).slice(0, max).map((x) => x.id);
}

const area = (o) => o.width * o.height;
// Все упорядоченные выборки k элементов из arr; мест в примерах не больше трёх.
const perms = (arr, k) => (k === 0 ? [[]] : arr.flatMap((x, i) => perms(arr.filter((_, j) => j !== i), k - 1).map((p) => [x, ...p])));

// Раскладка в координатах набора L. Сначала пример с тем же составом. Иначе пример, где
// совпало больше всего объектов: совпавшие остаются на своих местах, остальные встают
// центр в центр в свободные места, ближайшие по площади к их прежним объектам.
// Лишние места отбрасываются. При равном совпадении выигрывает пример с лучшей подгонкой.
// Объект, который в примерах бывает только фоновым (лампа, ваза), в чужое место не встаёт:
// он крупнее остальных в разы и в примерах почти весь за кадром. Ставится фоновым на своё
// место из своего примера этого формата, под остальными.
export function compose(ids, format, manifest, layouts) {
  const objL = (id) => manifest.objects.find((o) => o.size === 'L' && o.id === id);
  const inFormat = layouts.filter((l) => l.format.join() === format.join());
  const key = (list) => [...list].sort().join();
  const exact = inFormat.find((l) => key(l.objects.map((o) => o.id)) === key(ids));
  if (exact) return { background: exact.background, template: exact.file, objects: exact.objects.map((o) => ({ ...o, rotation: 0 })) };

  const used = ids.slice(0, 3);
  const dropped = ids.slice(3);
  if (used.length === 1) {
    const o = objL(used[0]);
    return {
      background: 'confetti', template: null, dropped,
      objects: [{ id: o.id, state: 'main', x: Math.round((format[0] - o.width) / 2), y: Math.round((format[1] - o.height) / 2), rotation: 0 }],
    };
  }
  const bgOnly = used.filter((id) => {
    const seen = layouts.flatMap((l) => l.objects.filter((o) => o.id === id));
    return seen.length && seen.every((o) => o.state === 'background');
  }).sort((a, b) => area(objL(b)) - area(objL(a)));
  // Закрепляется один, самый крупный: два таких в одном углу перекрывают друг друга.
  const pin = bgOnly.slice(0, 1);
  const own = (id) => pin.includes(id) && inFormat.flatMap((l) => l.objects).find((o) => o.id === id);
  const plan = (l) => {
    const slots = l.objects.map((s) => ({ ...s, taken: used.includes(s.id) }));
    const missing = used.filter((id) => !slots.some((s) => s.taken && s.id === id));
    const pinned = missing.filter(own).map((id) => ({ ...own(id), rotation: 0 }));
    const rest = missing.filter((id) => !own(id)).sort((a, b) => area(objL(b)) - area(objL(a)));
    const cost = (pick) => pick.reduce((sum, s, i) => sum + Math.abs(Math.log(area(objL(rest[i])) / area(objL(s.id)))), 0);
    const free = perms(slots.filter((s) => !s.taken), rest.length).sort((a, b) => cost(a) - cost(b))[0];
    const misfit = cost(free);
    const objects = [...pinned, ...slots.filter((s) => s.taken || free.includes(s)).map((slot) => {
      const { taken, ...s } = slot;
      if (taken) return { ...s, rotation: 0 };
      const o = objL(rest[free.indexOf(slot)]);
      const was = objL(s.id);
      return {
        id: o.id, state: s.state, rotation: 0,
        x: Math.round(s.x + was.width / 2 - o.width / 2), y: Math.round(s.y + was.height / 2 - o.height / 2),
      };
    })];
    return { l, objects, misfit, overlap: used.length - rest.length };
  };
  // Остальные такие объекты в чужое место тоже не встают: годится только пример, где они есть сами.
  const extra = bgOnly.slice(1);
  const best = inFormat.filter((l) => l.objects.length >= used.filter((id) => !own(id) || l.objects.some((o) => o.id === id)).length)
    .filter((l) => extra.every((id) => l.objects.some((o) => o.id === id))).map(plan)
    .sort((a, b) => b.overlap - a.overlap || a.misfit - b.misfit || a.l.objects.length - b.l.objects.length)[0];
  if (!best) {
    const rest = compose(used.filter((id) => !extra.includes(id)), format, manifest, layouts);
    return { ...rest, dropped: [...extra, ...dropped] };
  }
  const { l: base, objects } = best;
  // Без главного объекта композиции нет (лампа и ваза вдвоём): незакреплённые становятся главными.
  if (objects.every((o) => o.state === 'background')) objects.forEach((o) => { if (!pin.includes(o.id)) o.state = 'main'; });
  return { background: base.background, template: base.file, objects, dropped };
}

// Набор S - вся композиция вдвое меньше (как L/scene 1000 и S/scene 500), объекты S в родном размере.
export const SIZE_SCALE = { L: 1, S: 0.5 };

// Итоговый SVG. Каждый экземпляр - отдельная группа с id и transform, пути библиотеки как есть.
// state: { format, size, background, objects: [{ id, state, x, y, rotation, recolor, hidden }] }, x/y в пикселях холста.
export function buildSvg(state, colors, getTemplate, manifest) {
  const k = SIZE_SCALE[state.size];
  const [W, H] = state.format.map((v) => Math.round(v * k));
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none">`];
  if (state.background !== 'none') {
    const bg = manifest.backgrounds.find((b) => b.kind === state.background && b.format.join() === state.format.join());
    const body = paint(getTemplate(bg.file), colors, {}, true);
    parts.push(`<g id="background"${k === 1 ? '' : ` transform="scale(${k})"`}>${body}</g>`);
  }
  const count = {};
  state.objects.forEach((inst, i) => {
    if (inst.hidden) return;
    const o = manifest.objects.find((x) => x.size === state.size && x.id === inst.id);
    const st = o.states[inst.state];
    const [w, h] = [st.width ?? o.width, st.height ?? o.height];
    const body = paint(getTemplate(st.file), colors, inst.recolor, inst.state === 'background');
    count[inst.id] = (count[inst.id] ?? 0) + 1;
    const rot = inst.rotation ? ` rotate(${inst.rotation} ${w / 2} ${h / 2})` : '';
    parts.push(`<g id="${inst.id}-${count[inst.id]}" data-i="${i}" transform="translate(${inst.x} ${inst.y})${rot}">${body}</g>`);
  });
  parts.push('</svg>');
  return parts.join('\n');
}

// Перевод экземпляра между наборами с сохранением центра.
export function resize(inst, from, to, manifest) {
  const a = manifest.objects.find((o) => o.size === from && o.id === inst.id);
  const b = manifest.objects.find((o) => o.size === to && o.id === inst.id);
  const f = SIZE_SCALE[to] / SIZE_SCALE[from];
  return { ...inst, x: Math.round((inst.x + a.width / 2) * f - b.width / 2), y: Math.round((inst.y + a.height / 2) * f - b.height / 2) };
}
