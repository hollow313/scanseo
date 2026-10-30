#!/bin/sh
set -eu
fail() { echo "FATAL: $1" >&2; exit 1; }

for d in "${DATA_DIR:-/data}" "${REPORTS_DIR:-/reports}"; do
  mkdir -p "$d" 2>/dev/null || true
  probe="$d/.write-probe.$$"
  printf 'ok' > "$probe" 2>/dev/null || fail "dossier $d non inscriptible par uid $(id -u). Corriger côté hôte : chown -R 568:568 <chemin hôte>"
  rm -f "$probe"
done

echo "[entrypoint] uid=$(id -u) gid=$(id -g) data=$(realpath "${DATA_DIR:-/data}") reports=$(realpath "${REPORTS_DIR:-/reports}")"
if [ -d "${CONTENT_DIR:-/content}" ]; then
  echo "[entrypoint] content=$(ls -1 "${CONTENT_DIR:-/content}" 2>/dev/null | tr '\n' ' ')"
fi

# binaire chromium résolu une fois pour toutes
for c in "${CHROMIUM_PATH:-}" /usr/bin/chromium-browser /usr/bin/chromium /usr/lib/chromium/chrome; do
  [ -n "$c" ] && [ -x "$c" ] && { export CHROMIUM_PATH="$c"; "$c" --version 2>/dev/null || true; break; }
done
[ -n "${CHROMIUM_PATH:-}" ] || echo "[entrypoint] AVERTISSEMENT: aucun binaire chromium trouvé, le rendu PDF échouera"

exec "$@"
