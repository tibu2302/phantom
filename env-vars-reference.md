# Variables de Entorno — PHANTOM Trading Bot

Copiá este contenido en un archivo llamado `.env` en tu VPS y completá los valores.

```bash
# ─── Base de datos ────────────────────────────────────────────────────────────
DATABASE_URL=mysql://phantom:tu_contraseña@localhost:3306/phantom_bot

# ─── Seguridad ────────────────────────────────────────────────────────────────
# Generá una clave aleatoria con: openssl rand -hex 32
JWT_SECRET=cambia-este-valor-por-algo-aleatorio-largo

# ─── Autenticación local ──────────────────────────────────────────────────────
AUTH_MODE=local
ADMIN_USERNAME=admin
ADMIN_PASSWORD=tu_contraseña_segura

# ─── Puerto ───────────────────────────────────────────────────────────────────
PORT=3000

# ─── LLM para el Analista IA (opcional) ──────────────────────────────────────
OPENAI_API_KEY=sk-...
OPENAI_API_URL=https://api.openai.com
```
