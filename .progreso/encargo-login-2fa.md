# Encargo — segundo factor en el login (TOTP) y límite de intentos

> Viene de una sesión de TotalGrind (19/10/2026): auditoría de seguridad del VPS tras la caída del 18/10.
> Bórralo cuando el encargo esté hecho y pase lo que importe a `.progreso/`.

## Por qué

PortaIDE está en `portaide.joan-coll.com` y da **terminal y agente sin pedir permisos** (`bypassPermissions`)
con el usuario `kuoyii`, que está en el grupo `docker` (en la práctica, root del VPS). El login (email +
contraseña de `.env`) es la **única barrera**: no tiene segundo factor. Lo demás grave del VPS ya está
cerrado (Portainer y el panel del proxy, ahora solo en `127.0.0.1`).

**Decisión del usuario:** segundo factor con **app autenticadora (TOTP)**. Se descartó el código por
correo: si el correo falla se queda fuera de su propio IDE, y quien entre en su correo tiene las dos llaves.

## Qué hay que hacer

1. **TOTP en el login** (`server/src/auth/*`, `server/src/config/env.ts`, `client/src/auth/AuthProvider.tsx`
   y la pantalla de acceso):
   - Secreto base32 en `.env` (p. ej. `AUTH_TOTP_SECRET`, también en `.env.example` sin valor) y un script
     que lo genere y muestre la URI `otpauth://` y el QR en la terminal para darlo de alta en la app.
   - Tras email y contraseña correctos, pedir el código de 6 dígitos. RFC 6238: 30 s, ±1 paso de margen,
     comparación en tiempo constante y **sin reutilizar** un código ya aceptado.
   - Recuperación: no hacen falta códigos de respaldo; si pierde el móvil entra por SSH/VS Code y cambia
     el secreto. Decidir y documentar qué pasa si falta el secreto (al arrancar, como ya se hace con
     `AUTH_EMAIL`/`AUTH_PASSWORD`).
2. **Echar las sesiones abiertas al activarlo.** Las cookies duran 30 días y son JWT firmados con
   `SESSION_SECRET`: rotar el secreto (o meter una versión en el token), o las de antes siguen valiendo.
3. **El límite de intentos es global, no por IP** (deducido de la configuración, no medido en caliente).
   Cadena: NPM añade la IP real a `X-Forwarded-For` → el nginx del frontend (`client/nginx.conf`) añade
   otra (la de NPM) → el backend tiene `trust proxy` = 1, así que `req.ip` = **IP del contenedor de NPM**
   para todo el mundo. Cualquiera bloquea el login fallando 10 veces cada 15 min. Arreglarlo para que
   `req.ip` sea el cliente real.
   - **Ojo:** el backend escucha en `0.0.0.0:4100`. Si ese puerto se abre desde internet, una cabecera
     `X-Forwarded-For` falsa se salta el límite (con `trust proxy` por número, se fía del primer salto
     sea quien sea). Pedir al usuario `sudo ufw status verbose` (las reglas de ufw solo las lee root) y,
     si 4100 está abierto hacia fuera, cerrarlo o escuchar solo donde llega el frontend.
   - El límite debe contar también los códigos TOTP fallidos.

## Cómo comprobarlo

Pruebas de TOTP con los vectores de la RFC 6238; acceso sin código o con código viejo → rechazado; una
cookie de antes de rotar → 401; dos IPs distintas tienen cupos distintos. Prueba por mutación: si romper
el arreglo a mano no pone la prueba en rojo, no prueba nada.

## Despliegue y avisos

- Backend: servicio systemd `portaide-backend` (`EnvironmentFile=.env`, `node dist/index.js`). Reiniciarlo
  con `systemctl` necesita `sudo`, que solo tiene el usuario. Frontend: su Docker Compose.
- A 19/10 el árbol tenía **cambios sin commitear de otra sesión** (cliente, `DESIGN.md`, `.progreso/`).
  Mirar `git status` antes de construir y no desplegar trabajo ajeno a medias.
- Es un cambio de seguridad: según el §8 de `CLAUDE.md`, proponer el modo al usuario (recomendado:
  Directo + `revisor`).
