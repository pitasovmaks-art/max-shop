#!/bin/bash
cd "$(dirname "$0")"

echo "──────────────────────────────────"
echo "  Точка Монтажа — запуск сервера"
echo "──────────────────────────────────"

# Проверяем node
if ! command -v node &> /dev/null; then
    echo "ОШИБКА: Node.js не установлен."
    echo "Скачайте: https://nodejs.org"
    read -p "Нажмите Enter для выхода..."
    exit 1
fi

NODE_VERSION=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [ "$NODE_VERSION" -lt 22 ]; then
    echo "ОШИБКА: нужен Node.js v22 или выше (у вас v$NODE_VERSION)."
    echo "Скачайте: https://nodejs.org"
    read -p "Нажмите Enter для выхода..."
    exit 1
fi

# Ставим зависимости если нужно
if [ ! -d "node_modules" ]; then
    echo "Устанавливаем зависимости..."
    npm install
fi

echo ""
echo "Сервер запущен!"
echo "Открывайте в браузере: http://localhost:3000"
echo "Админ-панель:          http://localhost:3000/admin/"
echo ""
echo "Для остановки нажмите Ctrl+C"
echo "──────────────────────────────────"
echo ""

node server/index.js
