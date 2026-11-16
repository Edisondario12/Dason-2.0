#!/bin/zsh
cd -- "${0:A:h}" || exit 1
url=http://127.0.0.1:8765
if curl -fsS --max-time 2 "$url/api/session" >/dev/null 2>&1; then
  open "$url"
  exit
fi
for py in "$(command -v python3)" /usr/local/bin/python3 /opt/homebrew/bin/python3 /usr/bin/python3; do
  [[ -x "$py" ]] || continue
  "$py" -c 'import sqlite3, hashlib; hashlib.scrypt(b"test",salt=b"test",n=32768,r=8,p=1,maxmem=67108864)' 2>/dev/null && break
  py=""
done
if [[ -z "$py" || ! -x "$py" ]]; then
  echo 'Se necesita Python 3 con SQLite y hashlib.scrypt. Instala Python 3 de python.org.'
  read '?Pulsa Enter para cerrar.'
  exit 1
fi
"$py" backend/server.py &
pid=$!
trap 'kill "$pid" 2>/dev/null' EXIT
for intento in {1..50}; do
  if curl -fsS --max-time 1 "$url/api/session" >/dev/null 2>&1; then
    echo "DASON 2.0: $url — deja esta ventana abierta mientras usas la aplicación."
    open "$url"
    wait "$pid"
    exit
  fi
  kill -0 "$pid" 2>/dev/null || break
  sleep .1
done
echo 'No se pudo iniciar DASON en el puerto 8765. Revisa el mensaje de arriba.'
read '?Pulsa Enter para cerrar.'
exit 1
