#!/bin/zsh
# Двойной щелчок — запускает демо БытМаркет CRM и открывает его в браузере.
cd "$(dirname "$0")/web" || exit 1
if [ ! -d node_modules ]; then
  echo "Первый запуск: ставлю зависимости…"
  npm install --cache "$HOME/.bytmarket-npm-cache" || exit 1
fi
if ! lsof -iTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then
  (sleep 2 && open "http://127.0.0.1:5173/") &
  npm run dev
else
  open "http://127.0.0.1:5173/"
fi
