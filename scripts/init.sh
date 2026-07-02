#!/usr/bin/env bash
# init.sh — arranque de sesión: muestra el estado actual del proyecto PortaIDE.
# Uso: bash scripts/init.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
rule() { printf '%s\n' "────────────────────────────────────────────────────────"; }

bold "PortaIDE — arranque de sesión"
rule

if [ -f ".progreso/estado.md" ]; then
  bold "▸ Estado (último checkpoint)"
  cat .progreso/estado.md
  rule
fi

if [ -f ".progreso/plan.md" ]; then
  bold "▸ Tareas pendientes en el plan"
  # Muestra solo las líneas con casillas sin marcar.
  grep -nE '^\s*- \[ \]' .progreso/plan.md || echo "  (no quedan tareas sin marcar)"
  rule
fi

bold "Recordatorio: lee CLAUDE.md y DESIGN.md antes de tocar UI."
bold "Norte visual: 'Editor Movil (offline).html' (la app) y 'PortaIDE Brand (offline).html' (marca)."
