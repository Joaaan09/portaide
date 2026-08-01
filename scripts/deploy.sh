#!/usr/bin/env bash
# scripts/deploy.sh — despliegue de PortaIDE en el modelo "backend en el host".
#
# EJECÚTALO EN EL HOST (o desde la Terminal de PortaIDE una vez migrado, que ya
# es la shell real del VPS). Reconstruye el frontend (Docker) y reinicia el
# backend (systemd). NO sirve dentro del contenedor viejo (no tiene docker ni
# systemctl): ese era justo el problema que esta migración resuelve.
#
# Uso:
#   bash scripts/deploy.sh            # build backend + restart + frontend
#   bash scripts/deploy.sh --no-pull  # sin git pull (si trabajas en local)
set -euo pipefail

REPO="/home/kuoyii/servers/portaide"
cd "$REPO"

PULL=1
[[ "${1:-}" == "--no-pull" ]] && PULL=0

if [[ "$PULL" == "1" ]]; then
  echo "==> git pull --ff-only"
  git pull --ff-only || echo "  (aviso: no se pudo hacer fast-forward; sigo con lo que hay en disco)"
fi

echo "==> Backend (host): instalar deps + build"
cd "$REPO/server"
npm ci
npm run build

echo "==> Backend: reiniciar servicio systemd"
sudo systemctl restart portaide-backend
sleep 1
sudo systemctl --no-pager --lines=0 status portaide-backend || true

echo "==> Frontend (Docker): rebuild"
cd "$REPO"
docker compose up -d --build frontend

echo
echo "==> Listo."
echo "    Backend: journalctl -u portaide-backend -f"
echo "    Frontend: docker compose logs -f frontend"
