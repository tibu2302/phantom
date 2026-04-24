#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# PHANTOM Bot — Script de Actualización VPS v10.1
# Ejecutar como root en el VPS: bash UPDATE_VPS_v10.sh
# ═══════════════════════════════════════════════════════════════════════════════

set -e  # Salir si hay error

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo ""
echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}${BOLD}║         PHANTOM Bot — Actualización v10.1                ║${NC}"
echo -e "${CYAN}${BOLD}║   Motor optimizado + Dashboard moderno + LINEAR USDT     ║${NC}"
echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# ─── Detectar directorio del bot ─────────────────────────────────────────────
BOT_DIR=""
for d in /root/phantom-bot /home/ubuntu/phantom-bot /opt/phantom-bot /root/phantom /home/ubuntu/phantom; do
  if [ -f "$d/docker-compose.yml" ]; then
    BOT_DIR="$d"
    break
  fi
done

if [ -z "$BOT_DIR" ]; then
  echo -e "${RED}ERROR: No se encontró el directorio del bot.${NC}"
  echo "Buscando en: /root/phantom-bot, /home/ubuntu/phantom-bot, /opt/phantom-bot"
  echo ""
  read -p "Ingresa la ruta completa del directorio del bot: " BOT_DIR
  if [ ! -f "$BOT_DIR/docker-compose.yml" ]; then
    echo -e "${RED}ERROR: No existe docker-compose.yml en $BOT_DIR${NC}"
    exit 1
  fi
fi

echo -e "${GREEN}✓ Directorio del bot: ${BOLD}$BOT_DIR${NC}"
cd "$BOT_DIR"

# ─── Verificar que git está configurado ──────────────────────────────────────
if [ ! -d ".git" ]; then
  echo -e "${RED}ERROR: El directorio no es un repositorio git.${NC}"
  exit 1
fi

CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "main")
echo -e "${GREEN}✓ Branch actual: ${BOLD}$CURRENT_BRANCH${NC}"

# ─── Mostrar versión actual ───────────────────────────────────────────────────
CURRENT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "desconocido")
echo -e "${GREEN}✓ Commit actual: ${BOLD}$CURRENT_COMMIT${NC}"
echo ""

# ─── Confirmar actualización ─────────────────────────────────────────────────
echo -e "${YELLOW}${BOLD}Cambios que se aplicarán en v10.1:${NC}"
echo "  • Motor: 100% capital desplegado, todo LINEAR/USDT-settled"
echo "  • XAU (Oro): 50% del capital, 8 posiciones scalp + 10 futures"
echo "  • Ciclos: 10s main, 30s scanner (más rápido)"
echo "  • Scalping minProfit: 0.15% (era 0.3%)"
echo "  • Grid minProfit: 0.25% (era 0.5%)"
echo "  • FORCED-CLOSE-BIG-GAIN: cierre automático >= 8%"
echo "  • Dashboard: Daily Target Ring, XAU Crown, AI Modules, USDT bar"
echo "  • PDF fix: caracteres especiales corregidos"
echo ""
read -p "¿Continuar con la actualización? [S/n]: " CONFIRM
CONFIRM=${CONFIRM:-S}
if [[ ! "$CONFIRM" =~ ^[Ss]$ ]]; then
  echo "Actualización cancelada."
  exit 0
fi

echo ""
echo -e "${CYAN}${BOLD}[1/5] Descargando cambios de GitHub...${NC}"
git fetch origin
git pull origin "$CURRENT_BRANCH" --rebase
NEW_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "desconocido")
echo -e "${GREEN}✓ Actualizado: $CURRENT_COMMIT → $NEW_COMMIT${NC}"

echo ""
echo -e "${CYAN}${BOLD}[2/5] Verificando pdfkit en package.json...${NC}"
if grep -q '"pdfkit"' package.json; then
  echo -e "${GREEN}✓ pdfkit ya está en package.json${NC}"
else
  echo -e "${YELLOW}⚠ pdfkit no encontrado, agregando...${NC}"
  # Agregar pdfkit si no está (por si el VPS tiene una versión vieja)
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    if (!pkg.dependencies['pdfkit']) {
      pkg.dependencies['pdfkit'] = '^0.15.0';
      fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
      console.log('pdfkit agregado a package.json');
    }
  "
fi

echo ""
echo -e "${CYAN}${BOLD}[3/5] Deteniendo contenedores actuales...${NC}"
docker compose down --timeout 30
echo -e "${GREEN}✓ Contenedores detenidos${NC}"

echo ""
echo -e "${CYAN}${BOLD}[4/5] Construyendo imagen Docker con los cambios v10.1...${NC}"
echo -e "${YELLOW}(Esto puede tardar 3-5 minutos)${NC}"
docker compose build --no-cache
echo -e "${GREEN}✓ Build completado${NC}"

echo ""
echo -e "${CYAN}${BOLD}[5/5] Iniciando contenedores...${NC}"
docker compose up -d
echo -e "${GREEN}✓ Contenedores iniciados${NC}"

echo ""
echo -e "${CYAN}Esperando que la app arranque (15 segundos)...${NC}"
sleep 15

echo ""
echo -e "${CYAN}${BOLD}Verificando estado de los contenedores:${NC}"
docker compose ps

echo ""
echo -e "${CYAN}${BOLD}Últimas líneas del log de la app:${NC}"
docker compose logs app --tail=20

echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║          PHANTOM v10.1 actualizado correctamente         ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Detectar IP pública
PUBLIC_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s api.ipify.org 2>/dev/null || echo "TU_IP")
PORT=$(grep -oP '(?<=PORT:-)\d+' docker-compose.yml 2>/dev/null || echo "3000")

echo -e "${BOLD}Accedé al dashboard en:${NC}"
echo -e "  ${CYAN}http://$PUBLIC_IP:$PORT${NC}"
echo ""
echo -e "${BOLD}Novedades v10.1:${NC}"
echo "  🥇 XAU (Oro) como activo principal — 50% del capital"
echo "  ⚡ Todo opera en LINEAR (USDT-settled) — nunca altcoins spot"
echo "  🎯 Daily Target Ring — progreso hacia meta de \$300/día"
echo "  🤖 Panel de módulos IA — 55+ algoritmos activos"
echo "  📊 USDT Liquidity bar — % de liquidez disponible"
echo "  📄 PDF fix — reporte diario corregido"
echo ""
echo -e "${YELLOW}Para ver logs en tiempo real:${NC}"
echo "  docker compose logs -f app"
echo ""
echo -e "${YELLOW}Para ver solo errores:${NC}"
echo "  docker compose logs app 2>&1 | grep -i error"
echo ""
