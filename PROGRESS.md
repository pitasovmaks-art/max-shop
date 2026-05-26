# Точка Монтажа — статус проекта

Мини-приложение для Max Messenger. Магазин строительных инструментов с каталогом, корзиной и оформлением заказа.

---

## Стек

- **Frontend**: Vanilla JS, HTML/CSS (без фреймворков)
- **Backend**: Node.js + Express
- **БД**: PostgreSQL (Timeweb, SSL `rejectUnauthorized: false`)
- **Хранилище**: S3-совместимое (Timeweb, endpoint `s3.twcstorage.ru`)
- **Деплой**: **Timeweb** (не Railway)
- **Продакшен URL**: `https://pitasovmaks-art-max-shop-c149.twc1.net`
- **Платформа**: Max Messenger Mini App SDK (`https://st.max.ru/js/max-web-app.js`)

---

## Переменные окружения (Timeweb)

| Переменная | Назначение |
|---|---|
| `MAX_BOT_TOKEN` | Токен бота Max Messenger |
| `BOT_USERNAME` | Username бота (сейчас `id635009278943_bot`) |
| `WEBHOOK_URL` | URL вебхука (дефолт: `https://pitasovmaks-art-max-shop-c149.twc1.net/webhook`) |
| `SHOP_URL` | URL магазина для ссылок из бота |
| `PORT` | Порт сервера |
| `DATABASE_URL` | Строка подключения к PostgreSQL |

---

## Реализовано

### Каталог (`index.html`, `src/catalog/`)
- Загрузка товаров, категорий и подкатегорий из API
- Фильтрация по категории и подкатегории
- Поиск с debounce 250 мс
- Двухколоночная сетка карточек
- Бейджи «Нет в наличии» и название подкатегории на фото
- Варианты товара (пилюли) с выбором и обновлением цены
- Клик на карточку открывает страницу товара
- Нижний навбар: **Каталог | Корзина | Поддержка** (3 пункта)

### Кнопка «Поддержка»
- Третий пункт нижнего навбара в `index.html`
- Функция `openSupport()` в `src/catalog/catalog.js`
- Username загружается через `GET /api/config` при старте страницы
- Ссылка: `https://max.ru/<username>` через `window.WebApp.openLink` или `location.href`
- Захардкоженный фоллбек: `id635009278943_bot`

### Страница товара (`src/catalog/product.html` + `product.js`)
- Загрузка товара и дополнительных фото из API
- Свайп-галерея с touch-событиями
- Точки-индикаторы и стрип миниатюр
- Варианты товара с выбором цены
- Кнопка «В корзину» / «Записаться» / «Нет в наличии»
- Все стили — inline в `<style>` теге (нет отдельного product.css)

### Корзина (`cart.html`, `src/cart/`)
- Список товаров с количеством и итоговой суммой
- Изменение количества и удаление позиций
- Бейджи с количеством товаров в шапке и навигации
- Хранение в `localStorage`

### Оформление заказа (`checkout.html`, `src/cart/`)
- Форма с именем, телефоном, магазином (самовывоз) и комментарием
- Отправка заказа в API
- После заказа — уведомление администратору через бота

### Бот Max Messenger (`bot.js`)
- **Режим: webhook** (переключён с long polling 26 мая 2026)
- `API_BASE = 'platform-api.max.ru'` — без префикса `/v1/`
- При старте сервера вызывается `registerWebhook()` → `POST https://platform-api.max.ru/subscriptions`
- Endpoint для приёма обновлений: `POST /webhook` в `server/index.js`
- Список admin chat_id хранится в `bot_admins.json` (каждый кто нажал /start — становится админом)

**Команды бота:**
- `/start` / `bot_started` — приветствие + кнопка открытия магазина
- `/myid` — отвечает своим chat_id (case-insensitive)
- `/reply ID текст` — только для админов, отправляет ответ пользователю
- Любое сообщение от не-админа — автоответ пользователю + пересылка всем админам с инструкцией `/reply`

### Уведомления о заказах
- `notifyAdmin(order)` в `bot.js` — при новом заказе шлёт детали всем админам
- Кнопка «Открыть заказы» ведёт в `SHOP_URL/admin/`

### Backend API (`server/`)
- `GET /api/config` — возвращает `{ botUsername }` для фронтенда
- `POST /webhook` — принимает обновления от Max Bot API
- `GET/POST/PUT/DELETE /api/products`
- `GET/POST/PUT/DELETE /api/categories`, `/api/subcategories`
- `GET/POST/PUT /api/orders`
- `GET/POST/PUT/DELETE /api/stores`
- `POST /api/upload` — загрузка файла в S3, возвращает публичный URL
- `POST /api/auth/login` — выдача JWT
- `POST /api/admin/reset` / `/api/admin/seed` — сброс и заполнение БД (только для админов)

### БД (`server/db.js`)
- Таблицы: `products`, `categories`, `subcategories`, `orders`, `stores`, `product_images`
- Авто-создание схемы при старте
- Авто-сид товаров при пустой таблице

### Админ-панель (`admin/`)
- Авторизация через JWT (токен в `sessionStorage`)
- CRUD товаров с загрузкой фото в S3
- Управление дополнительными фото (`product_images`)
- CRUD категорий и подкатегорий
- Просмотр и управление заказами
- Управление точками выдачи (stores)

### Дизайн (текущий — тёмный градиент + glassmorphism)
- **Фон всех страниц**: `linear-gradient(135deg, #1a1a2e 0%, #2d4a3e 40%, #4a3728 100%)`
- **Акцентный цвет**: `#F85800` (кнопки, бейджи, цены, активные элементы)
- **Хедер/навбар**: тот же градиент; нижний навбар — обратный градиент
- **Карточки товаров**: `rgba(255,255,255,0.35)` + `backdrop-filter: blur(20px)` (glassmorphism)
- **Логотип**: текст «Точка Монтажа», шрифт Oswald 600, белый
- `body` фон задан inline в HTML-файлах, `.app { background: transparent }`
- Стили: `catalog.css`, `cart.css`, `checkout.css`, `cookie.css`, inline в `product.html`

### Юридические документы
- `offer.html` — публичная оферта (ст. 492 ГК РФ), дата 25 мая 2026 г.
- `privacy.html` — политика конфиденциальности, дата 25 мая 2026 г.

### Безопасность
- `X-Frame-Options: ALLOWALL` и `Content-Security-Policy: frame-ancestors *` для работы в iframe Max
- JWT middleware для защиты admin-эндпоинтов

---

## Что нужно проверить / потенциальные проблемы

- **Webhook регистрация**: после деплоя в логах должна появиться строка `[bot] Webhook зарегистрирован, статус: 200`. Если статус не 200 — возможно неверный формат запроса к `platform-api.max.ru/subscriptions`
- **Кнопка «Поддержка»**: ссылка `https://max.ru/<username>` — нужно проверить работу внутри Mini App
- **`/api/config`**: в логах видно что `BOT_USERNAME=id635009278943_bot` уже задан на Timeweb (проверено через `curl`)
- **Отправка сообщений**: `POST platform-api.max.ru/messages` без `/v1/` — нужно проверить доставку

---

## Планируется

- Проверить работу webhook на реальном устройстве (написать боту, убедиться что отвечает)
- Проверить кнопку «Поддержка» внутри Mini App
- Тестирование на реальных устройствах в Max Messenger
- Поиск по штрихкоду / артикулу
- История заказов для пользователя
- Push-уведомления о статусе заказа через бота
- Сортировка товаров (по цене, новизне)
- Избранные товары (wishlist)
