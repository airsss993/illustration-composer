# Конструктор иллюстраций

Демо: https://tz.pe4mnur7.online

Сервис собирает иллюстрации из готовых векторных объектов библиотеки: по метафоре
или заголовку (сценарий 1) либо по названиям объектов (сценарий 2). Новых объектов
не создаёт, результат отдаёт в SVG.

## Запуск

Нужен node (проверено на 26), зависимостей нет.

```bash
node server.mjs
```

Открыть http://localhost:8080. Порт меняется аргументом: `node server.mjs 3000`.

Сценарий 1 разбирает языковая модель через любой OpenAI-совместимый API, если задан ключ:
`LLM_API_KEY=... node server.mjs`. Адрес - `LLM_BASE_URL` (по умолчанию `https://taynik.store/v1`,
подойдёт и `https://generativelanguage.googleapis.com/v1beta/openai` для ключа Google), модели -
`LLM_MODELS` через запятую, пробуются по очереди при перегрузке или квоте (по умолчанию
`orig/claude-haiku-5-5,gemini-3.8-flash`). Запрос идёт через `curl`, прокси при необходимости
задаётся его переменной `ALL_PROXY` (например `socks5h://host:port`).
Без ключа фразу разбирает локальный словарь ассоциаций.

В docker: `docker build -t illustration-composer .`, затем `docker run --env-file .env -p 8080:8080 illustration-composer`.

Без ключа сервер нужен только для раздачи файлов: `index.html`, `web/`, `library/` и `examples/`
работают с любого статического хостинга, в том числе из подпапки.

В редакторе: собрать по фразе или по названиям, затем двигать объекты мышью, поворачивать,
дублировать (Cmd/Ctrl+D), удалять (Delete), менять слои и состояние главный/фоновый,
формат холста, набор L/S, вид фона и схему. Своя палитра загружается JSON-файлом в формате
схемы из `library/palettes.json`: `{"id": "sea", "background": [3 hex], "object": [3 hex]}`.
Кнопка "Скачать SVG" отдаёт вектор, каждый объект отдельной группой.

Проверки:

```bash
node scripts/build-manifest.mjs && node scripts/test-compose.mjs
```

## Что где

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - хранение, извлечение и переиспользование SVG, алгоритм сборки
- [web/](web/) - интерфейс (`index.html`, `app.js`) и логика без DOM (`compose.js`)
- [examples/composed/](examples/composed/) - три композиции, собранные сервисом

- [docs/TZ.md](docs/TZ.md) - текст задания
- [docs/RULES.md](docs/RULES.md) - правила библиотеки, что можно и нельзя, как сервис это соблюдает, открытые вопросы
- [docs/LIBRARY.md](docs/LIBRARY.md) - библиотека по файлу Figma: объекты, id узлов, палитры, что выгружено
- [examples/](examples/) - эталонные композиции: 18 в SVG (`svg/`), 12 в PNG, раскладка каждой в `layouts.json`
- [library/](library/) - 40 объектов и 6 фонов в SVG (размеры L и S, состояния main и background), `palettes.json` и `manifest.json` (собирается `node scripts/build-manifest.mjs`)

Исходник библиотеки - файл Figma "Тестовое | иллюстрации",
ключ `4MCFttsSoP7hgQh29zq5G3`. Читается через копию `2FainuemKZkOmg7kHyowFN`.
