# NodeFlow

Минимальный PWA без npm-зависимостей: задания + записки, локальное хранение в IndexedDB, темы без градиентов, Google Drive OAuth/REST, Markdown-подобный редактор, код, таблицы, диаграммы, ссылки между записями и AI-ready API.

## Запуск

```bash
node server.js
```

Открой `http://localhost:5173`.

## Google Drive

1. Создай OAuth 2.0 Web Client в Google Cloud.
2. Добавь `http://localhost:5173` в Authorized JavaScript origins.
3. В NodeFlow нажми **Google Drive**, вставь Client ID и подключись.
4. Используется только scope `drive.file`; NodeFlow создаёт/обновляет `nodeflow-data.json`.

## Формат контента

- Markdown-подобные `**жирный**`, `*курсив*`, `# заголовок`.
- Код: ` ```javascript `, ` ```python `, ` ```cpp `, ` ```gdscript `.
- Таблицы в Markdown-формате.
- Диаграмма:

```text
```chart
{"title":"Пример","data":[{"label":"A","value":7},{"label":"B","value":4}]}
```
```

- Связь: `[[Название записи]]`.
- Обычные emoji поддерживаются Unicode.

## AI

В `window.NodeFlowAI` уже есть:

```js
await NodeFlowAI.context();
await NodeFlowAI.run({ endpoint, apiKey, prompt });
```

Свой адаптер можно зарегистрировать через `NodeFlowAI.providers`.
