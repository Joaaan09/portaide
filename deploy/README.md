# Migración a "backend en el host" (deploy)

> ADR: `.progreso/decisiones.md` → 2026-07-31 "Backend en el host (systemd)".
> Objetivo: que la Terminal de PortaIDE sea la **shell real del VPS** (tu `clauded`,
> docker, logs) y que el **deploy se lance desde la propia app**. El frontend sigue
> en Docker tras NPM; solo el backend baja al host.

Todo lo de aquí se ejecuta **en el host** (SSH / terminal del VPS), no dentro del
contenedor. Los cambios de repo (compose, nginx, systemd unit, código) ya están hechos.

---

## Paso 0 — Blindar el borde ANTES de abrir acceso al host (innegociable)

Con el backend en el host, una brecha del borde ya no cuesta "una cajita aislada"
sino **el VPS entero**, y PortaIDE corre `clauded` (sin pedir permisos). Así que
primero se endurece el acceso. Opción recomendada: **Tailscale** (dejas de exponer
PortaIDE a internet abierto; entras por la tailnet desde el móvil).

```bash
# En el VPS
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
# En el iPhone: instala Tailscale, entra con la misma cuenta.
```

Luego, en **Nginx Proxy Manager**, haz que el host de PortaIDE responda solo por la
IP de la tailnet (o restringe el acceso con una Access List). Alternativas válidas si
no quieres Tailscale: 2FA/passkeys en la app, o mTLS en NPM. Lo que NO vale es abrir
el host a internet tal cual.

---

## Paso 1 — Firewall del puerto del backend (4100)

El backend escucha en `0.0.0.0:4100` para que el contenedor del frontend lo alcance
por `host.docker.internal`. Hay que **cerrarlo al exterior** y abrirlo solo a las
redes Docker:

```bash
sudo ufw allow from 172.16.0.0/12 to any port 4100 proto tcp comment 'PortaIDE backend <- docker'
sudo ufw reload
# Verifica que 4100 NO está accesible desde fuera (default deny incoming de UFW).
```

> Si no usas UFW, aplica la regla equivalente en tu firewall. El backend es un
> proceso del host (no Docker), así que UFW **sí** lo gobierna (a diferencia de los
> contenedores, que Docker suele saltarse).

---

## Paso 2 — Dependencias del backend en el host

Node 20 ya está en el VPS. `better-sqlite3` y `node-pty` se compilan al instalar
(necesitan toolchain):

```bash
sudo apt-get update && sudo apt-get install -y python3 make g++ git
cd /home/kuoyii/servers/portaide/server
npm ci
npm run build
```

---

## Paso 3 — (Opcional) Rescatar el SQLite del volumen Docker

Solo guarda la **meta de las pestañas de chat** (no los proyectos). Si no te importa
perderla, sáltatelo (se crea una DB nueva).

```bash
mkdir -p /home/kuoyii/servers/portaide/data
# Copia el .db del volumen viejo al nuevo path del host:
docker run --rm -v portaide_data:/from -v /home/kuoyii/servers/portaide/data:/to \
  alpine sh -c 'cp -v /from/portaide.db /to/portaide.db' || echo "  (sin DB previa: se creará una nueva)"
```

---

## Paso 4 — Instalar y arrancar el servicio systemd

```bash
cd /home/kuoyii/servers/portaide
sudo cp deploy/portaide-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now portaide-backend
journalctl -u portaide-backend -f     # debe decir: "servidor escuchando en http://0.0.0.0:4100"
```

> Si usas **nvm**, `node` puede no estar en el PATH de systemd. Edita el unit y pon
> la ruta absoluta de `which node` en `ExecStart=`.

---

## Paso 5 — Rebuild del frontend y bajar el backend viejo (Docker)

```bash
cd /home/kuoyii/servers/portaide
# Para y elimina el contenedor backend viejo (ya no está en el compose):
docker rm -f portaide-backend 2>/dev/null || true
# Reconstruye/levanta solo el frontend (ya con extra_hosts host-gateway):
docker compose up -d --build frontend
```

En **NPM**, si no estaba, activa **"Websockets Support"** en el proxy host de PortaIDE
(sin eso, terminal y chat no conectan). NPM sigue apuntando a `portaide-frontend`: no
se toca nada más.

---

## Paso 6 — Verificar

1. Abre la PWA (por la tailnet). Login OK.
2. **Terminal**: `whoami` → `kuoyii`; `docker ps` → funciona; `clauded --version` → OK.
3. **Chat**: envía un mensaje, comprueba que las tarjetas Approve/Reject siguen apareciendo.
4. **Deploy desde la app**: en la Terminal, `bash /home/kuoyii/servers/portaide/scripts/deploy.sh`.

---

## Despliegues siguientes

Ya no necesitas SSH para desplegar: desde la **Terminal de PortaIDE** (o por SSH):

```bash
bash /home/kuoyii/servers/portaide/scripts/deploy.sh
```

Reconstruye el frontend y reinicia el backend. (`sudo systemctl restart
portaide-backend` recarga solo el backend; `docker compose up -d --build frontend`
solo el frontend.)

---

## Rollback (volver al modelo Docker)

```bash
sudo systemctl disable --now portaide-backend
sudo rm /etc/systemd/system/portaide-backend.service && sudo systemctl daemon-reload
git checkout <commit-anterior> -- docker-compose.yml client/nginx.conf
docker compose up -d --build   # vuelve a levantar backend + frontend en Docker
```

> Limpieza opcional del modelo viejo, una vez validado el nuevo: el volumen
> `portaide_data` y (si estaban) el contenedor/volumen huérfanos de Mongo.
