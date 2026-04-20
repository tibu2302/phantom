# Guía de Despliegue en VPS — PHANTOM Trading Bot

Esta guía explica cómo instalar y ejecutar el bot PHANTOM en un servidor propio (VPS) para operar con dinero real en Bybit sin restricciones geográficas.

---

## ¿Por qué un VPS?

El bot necesita ejecutar órdenes en Bybit a través de la API REST (`POST /v5/order/create`). Esta API está bloqueada geográficamente desde algunos proveedores de hosting (incluyendo el servidor de Manus). Al correr el bot en un VPS ubicado en Europa o Asia, las llamadas a Bybit funcionan sin restricciones.

---

## Opción 1 — Docker (recomendado, más fácil)

Docker instala todo automáticamente: la aplicación, la base de datos MySQL y las dependencias. Es la opción más rápida si no tenés experiencia con servidores.

### Paso 1 — Elegir y contratar un VPS

| Proveedor | Plan recomendado | Precio aprox. | Región recomendada |
|---|---|---|---|
| [Hetzner](https://www.hetzner.com) | CX22 (2 vCPU, 4 GB RAM) | €4/mes | Alemania o Finlandia |
| [Vultr](https://www.vultr.com) | Regular Cloud (1 vCPU, 2 GB RAM) | $6/mes | Frankfurt o Amsterdam |
| [DigitalOcean](https://www.digitalocean.com) | Basic Droplet (1 vCPU, 2 GB RAM) | $6/mes | Frankfurt o Amsterdam |

> **Importante:** Elegí una región en **Europa** (Alemania, Países Bajos, Finlandia) o **Asia** (Singapur, Japón). Evitá regiones de EE.UU. donde Bybit puede estar bloqueado.

El sistema operativo debe ser **Ubuntu 22.04 LTS**.

### Paso 2 — Conectarse al servidor

Desde tu computadora, abrí una terminal y conectate por SSH:

```bash
ssh root@IP_DE_TU_VPS
```

Reemplazá `IP_DE_TU_VPS` con la dirección IP que te dio el proveedor.

### Paso 3 — Instalar Docker

```bash
# Actualizar el sistema
apt update && apt upgrade -y

# Instalar Docker
curl -fsSL https://get.docker.com | sh

# Instalar Docker Compose
apt install docker-compose-plugin -y

# Verificar que funciona
docker --version
docker compose version
```

### Paso 4 — Obtener el código del bot

**Opción A — Desde GitHub (si exportaste el proyecto):**

```bash
git clone https://github.com/TU_USUARIO/phantom-bot.git
cd phantom-bot
```

**Opción B — Subir el ZIP directamente:**

Descargá el código desde el panel de Manus (botón "Download as ZIP" en el menú ⋯), luego subilo al servidor:

```bash
# Desde tu computadora local:
scp phantom-bot.zip root@IP_DE_TU_VPS:/root/

# En el servidor:
apt install unzip -y
unzip phantom-bot.zip
cd phantom-bot  # o el nombre que tenga la carpeta
```

### Paso 5 — Configurar las variables de entorno

Creá el archivo `.env` con la configuración del bot:

```bash
nano .env
```

Pegá el siguiente contenido y completá los valores:

```bash
# ─── Base de datos ────────────────────────────────────────────────────────────
DATABASE_URL=mysql://phantom:phantom_db_2024@db:3306/phantom_bot

# ─── Seguridad ────────────────────────────────────────────────────────────────
# Generá una clave aleatoria con: openssl rand -hex 32
JWT_SECRET=PEGA_AQUI_UNA_CLAVE_ALEATORIA_LARGA

# ─── Autenticación local ──────────────────────────────────────────────────────
AUTH_MODE=local
ADMIN_USERNAME=admin
ADMIN_PASSWORD=tu_contraseña_segura

# ─── Puerto ───────────────────────────────────────────────────────────────────
PORT=3000

# ─── MySQL ────────────────────────────────────────────────────────────────────
MYSQL_ROOT_PASSWORD=phantom_root_2024
MYSQL_PASSWORD=phantom_db_2024

# ─── LLM para el Analista IA (opcional) ──────────────────────────────────────
# Si tenés una API key de OpenAI, el Analista IA va a funcionar
OPENAI_API_KEY=sk-...
OPENAI_API_URL=https://api.openai.com
```

Para generar una clave JWT segura:

```bash
openssl rand -hex 32
```

Guardá el archivo con `Ctrl+O`, `Enter`, `Ctrl+X`.

### Paso 6 — Iniciar el bot

```bash
# Construir e iniciar todos los servicios
docker compose up -d --build

# Ver los logs en tiempo real
docker compose logs -f app
```

El bot va a estar disponible en `http://IP_DE_TU_VPS:3000`.

### Paso 7 — Crear las tablas de la base de datos

La primera vez que arrancás, necesitás crear las tablas:

```bash
# Ejecutar las migraciones de la base de datos
docker compose exec app pnpm db:push
```

### Paso 8 — Acceder al bot

Abrí tu navegador y entrá a `http://IP_DE_TU_VPS:3000`. Vas a ver la pantalla de login. Usá el usuario y contraseña que configuraste en el `.env`.

---

## Opción 2 — Sin Docker (instalación manual)

Si preferís instalar todo a mano sin Docker.

### Paso 1 — Instalar Node.js 20 y pnpm

```bash
# Actualizar el sistema
apt update && apt upgrade -y

# Instalar Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install nodejs -y

# Instalar pnpm
npm install -g pnpm@10

# Verificar versiones
node --version   # debe mostrar v20.x.x
pnpm --version   # debe mostrar 10.x.x
```

### Paso 2 — Instalar MySQL

```bash
# Instalar MySQL
apt install mysql-server -y

# Iniciar MySQL y habilitarlo para que arranque con el sistema
systemctl start mysql
systemctl enable mysql

# Crear la base de datos y el usuario
mysql -u root << 'SQL'
CREATE DATABASE phantom_bot CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'phantom'@'localhost' IDENTIFIED BY 'phantom_db_2024';
GRANT ALL PRIVILEGES ON phantom_bot.* TO 'phantom'@'localhost';
FLUSH PRIVILEGES;
SQL
```

### Paso 3 — Obtener el código y configurar

Seguí los mismos pasos 4 y 5 de la Opción 1, pero en el `.env` cambiá la URL de la base de datos:

```bash
DATABASE_URL=mysql://phantom:phantom_db_2024@localhost:3306/phantom_bot
```

### Paso 4 — Instalar dependencias y compilar

```bash
# Instalar dependencias
pnpm install

# Crear las tablas en la base de datos
pnpm db:push

# Compilar el frontend y el backend para producción
pnpm build
```

### Paso 5 — Instalar PM2 para mantener el bot corriendo

PM2 es un gestor de procesos que reinicia el bot automáticamente si se cae.

```bash
# Instalar PM2
npm install -g pm2

# Iniciar el bot
pm2 start dist/index.js --name phantom-bot

# Guardar la configuración para que arranque con el sistema
pm2 startup
pm2 save

# Ver los logs
pm2 logs phantom-bot
```

---

## Configurar HTTPS con Nginx (opcional pero recomendado)

HTTPS es necesario para que el bot funcione correctamente desde el celular (las cookies de sesión requieren HTTPS en algunos navegadores).

### Paso 1 — Apuntar un dominio al VPS

En el panel de tu proveedor de dominio (GoDaddy, Namecheap, etc.), creá un registro DNS tipo A que apunte al IP de tu VPS. Por ejemplo: `bot.tudominio.com → IP_DE_TU_VPS`.

Esperá 5-10 minutos para que el DNS se propague.

### Paso 2 — Instalar Nginx y Certbot

```bash
apt install nginx certbot python3-certbot-nginx -y
```

### Paso 3 — Configurar Nginx

```bash
nano /etc/nginx/sites-available/phantom-bot
```

Pegá esta configuración (reemplazá `bot.tudominio.com` con tu dominio):

```nginx
server {
    listen 80;
    server_name bot.tudominio.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Guardá con `Ctrl+O`, `Enter`, `Ctrl+X`.

```bash
# Activar la configuración
ln -s /etc/nginx/sites-available/phantom-bot /etc/nginx/sites-enabled/
nginx -t  # verificar que no hay errores
systemctl reload nginx
```

### Paso 4 — Obtener certificado SSL gratuito

```bash
certbot --nginx -d bot.tudominio.com
```

Seguí las instrucciones en pantalla. Certbot configura HTTPS automáticamente.

Ahora el bot va a estar disponible en `https://bot.tudominio.com`.

---

## Activar el modo de órdenes reales

Por defecto, el bot arranca en **modo simulación**. Para operar con dinero real:

1. Entrá al bot desde el navegador
2. Andá a **Ajustes** (ícono de engranaje)
3. Desactivá el switch **"Modo Simulación"**
4. Configurá tus **Claves API de Bybit** en la sección "Claves API"
5. Iniciá el bot desde el Panel

> **Advertencia:** En modo real, el bot ejecuta órdenes de compra/venta con tu dinero real en Bybit. Asegurate de haber probado la estrategia en simulación durante al menos 2 semanas antes de activar el modo real.

---

## Comandos útiles de mantenimiento

| Tarea | Docker | Sin Docker (PM2) |
|---|---|---|
| Ver logs | `docker compose logs -f app` | `pm2 logs phantom-bot` |
| Reiniciar el bot | `docker compose restart app` | `pm2 restart phantom-bot` |
| Detener el bot | `docker compose stop` | `pm2 stop phantom-bot` |
| Actualizar el código | `git pull && docker compose up -d --build` | `git pull && pnpm build && pm2 restart phantom-bot` |
| Ver estado | `docker compose ps` | `pm2 status` |

---

## Solución de problemas comunes

**El bot no puede conectarse a Bybit:**
Verificá que el VPS tiene acceso a internet y que Bybit no está bloqueado en esa región. Podés probarlo con: `curl https://api.bybit.com/v5/market/time`

**Error "Cannot connect to database":**
Verificá que la variable `DATABASE_URL` en el `.env` es correcta y que MySQL está corriendo.

**La página no carga después de instalar:**
Esperá 1-2 minutos para que el build termine. Revisá los logs con `docker compose logs -f app`.

**Las cookies de sesión no funcionan:**
Configurá HTTPS con Nginx y Certbot (ver sección anterior). Las cookies `SameSite=None` requieren HTTPS.

---

## Resumen de variables de entorno

| Variable | Descripción | Ejemplo |
|---|---|---|
| `DATABASE_URL` | Conexión a MySQL | `mysql://phantom:pass@localhost:3306/phantom_bot` |
| `JWT_SECRET` | Clave para firmar tokens de sesión | `openssl rand -hex 32` |
| `AUTH_MODE` | Modo de auth: `local` para VPS | `local` |
| `ADMIN_USERNAME` | Usuario del administrador | `admin` |
| `ADMIN_PASSWORD` | Contraseña del administrador | `tu_contraseña_segura` |
| `PORT` | Puerto del servidor | `3000` |
| `OPENAI_API_KEY` | API key para el Analista IA (opcional) | `sk-...` |
| `OPENAI_API_URL` | URL de la API de LLM (opcional) | `https://api.openai.com` |
