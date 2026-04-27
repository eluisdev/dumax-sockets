# TmuxMonitor — Monorepo

Aplicación para monitorear sesiones `tmux` remotas vía SSH y capturar XML en tiempo real.

```
tmux-session-fb/
├── tmux-session-frontend/   → React + Vite + Tailwind   (deploy: Netlify)
├── tmux-session-backend/    → Express + Socket.io + SSH2 (deploy: Render)
├── netlify.toml             → config de Netlify
├── render.yaml              → blueprint de Render
└── package.json             → workspaces (raíz)
```

## ⚠️ Por qué dos hostings

El backend mantiene **conexiones SSH persistentes** y **WebSockets** abiertos. Eso **no funciona en Netlify** (sus Functions son serverless, con timeout de 10–26s). Por eso:

| Capa | Hosting |
|------|---------|
| Frontend (estático) | Netlify |
| Backend (Node persistente + WebSockets) | Render |

---

## 🛠 Desarrollo local

### Requisitos
- Node.js ≥ 20
- npm ≥ 10

### Setup

```powershell
# 1. Clona e instala dependencias de ambos workspaces
git clone <tu-repo>
cd tmux-session-fb
npm install

# 2. Backend: copia el .env de ejemplo y rellénalo
cd tmux-session-backend
cp .env.example .env
# Edita .env con tus credenciales SSH reales

# 3. Coloca tu llave privada en tmux-session-backend/keys/id_ed25519
#    (el .gitignore ya impide que se suba al repo)

# 4. Frontend: el .env por defecto ya apunta a localhost:4001
cd ../tmux-session-frontend
cp .env.example .env

# 5. Vuelve a la raíz y arranca ambos
cd ..
```

En **dos terminales separadas**:

```powershell
# Terminal 1 — backend (puerto 4001)
npm run dev:backend

# Terminal 2 — frontend (puerto 5173)
npm run dev:frontend
```

Abre http://localhost:5173

---

## 🚀 Deploy en producción

### Paso 1 — Sube el monorepo a GitHub

```powershell
git init
git add .
git commit -m "initial monorepo"
git branch -M main
git remote add origin https://github.com/<tu-usuario>/<tu-repo>.git
git push -u origin main
```

> El `.gitignore` ya excluye `.env` y la carpeta `keys/` — verifica que **nunca** suban llaves privadas al repo.

---

### Paso 2 — Backend en Render

1. Ve a https://dashboard.render.com → **New +** → **Blueprint**.
2. Conecta tu cuenta de GitHub y selecciona el repo.
3. Render detecta automáticamente `render.yaml` y propone crear el servicio `tmux-monitor-backend`.
4. Click **Apply**. Render construye con `npm install && npm run build` y arranca con `npm start`.
5. Cuando termine, copia la URL pública. Será algo como:

   ```
   https://tmux-monitor-backend.onrender.com
   ```

#### Variables de entorno a configurar en Render

En el dashboard del servicio → **Environment** → agrega:

| Variable | Valor | Notas |
|----------|-------|-------|
| `FRONTEND_URL` | `https://TU-APP.netlify.app` | Lo sabrás después del Paso 3. Acepta varias separadas por coma. |
| `SSH_SERVERS` | (JSON, ver abajo) | Lista de servidores con `keyEnv` o `password`. |
| `WIALON_SSH_KEY` | (contenido del id_ed25519) | Pega el archivo completo, incluyendo `-----BEGIN ...-----` y `-----END ...-----`. |

**Ejemplo de `SSH_SERVERS`** (todo en una sola línea):

```json
[{"id":"wialon","label":"Wialon","host":"165.22.88.108","port":22,"user":"staging","keyEnv":"WIALON_SSH_KEY","passphrase":"TU_PASSPHRASE"},{"id":"dumax-v4","label":"Dumax V4","host":"67.205.152.9","port":22,"user":"deployer","password":"TU_PASSWORD"},{"id":"dumax-v2","label":"Dumax V2","host":"104.236.146.29","port":22,"user":"staging","password":"TU_PASSWORD"}]
```

**Cómo obtener el contenido para `WIALON_SSH_KEY`** (PowerShell):

```powershell
Get-Content tmux-session-backend\keys\id_ed25519 -Raw | Set-Clipboard
```

Luego pégalo en el campo **Value** de la variable en Render. Render acepta multilínea sin necesidad de escapar.

> ✅ **Verifica que funciona:** abre `https://TU-BACKEND.onrender.com/health` — debe devolver JSON con la lista de servidores.

---

### Paso 3 — Frontend en Netlify

1. Ve a https://app.netlify.com → **Add new site** → **Import an existing project** → conecta GitHub.
2. Selecciona el repo. Netlify detecta `netlify.toml` automáticamente con:
   - **Base directory:** `tmux-session-frontend`
   - **Build command:** `npm install && npm run build`
   - **Publish directory:** `tmux-session-frontend/dist`
3. Antes del primer deploy, **Site settings → Environment variables** → agrega:

   | Variable | Valor |
   |----------|-------|
   | `VITE_SOCKET_URL` | `https://tmux-monitor-backend.onrender.com` |

4. Dispara el deploy. Cuando termine, anota la URL (ej. `https://tmux-monitor.netlify.app`).

---

### Paso 4 — Cierra el círculo de CORS

Vuelve a Render → tu servicio → **Environment** → edita `FRONTEND_URL`:

```
https://tmux-monitor.netlify.app
```

(o si quieres permitir varias):

```
https://tmux-monitor.netlify.app,http://localhost:5173
```

Render reinicia el servicio automáticamente. Listo — abre la URL de Netlify y prueba conectar SSH.

---

## 🩺 Verificación rápida

| Endpoint | Qué probar |
|----------|------------|
| `https://TU-BACKEND.onrender.com/health` | Debe devolver `{"ok":true,"servers":[...]}` |
| `https://TU-APP.netlify.app` | Debe cargar la UI con el logo Dumax y el indicador "● socket" en verde |
| Botón **Conectar SSH** | Debe pasar a verde "● Wialon — IP" en ~3s |
| Botón **▶ Live** | Debe empezar a mostrar líneas del terminal remoto |

---

## ⚠️ Limitaciones del free tier de Render

- **Se duerme tras 15 minutos sin tráfico.** El primer request después tarda ~30s en despertar.
- 750 horas gratis por mes (suficiente para un solo servicio always-on).
- Si necesitas que **nunca** se duerma, sube al plan **Starter ($7/mes)** o cambia a Fly.io.

Para mantenerlo despierto sin pagar, puedes configurar un **cron** externo (ej. https://cron-job.org) que haga GET a `/health` cada 10 minutos.

---

## 🎨 Branding

La interfaz usa la paleta **Dumax** definida en `tmux-session-frontend/src/dumax.json`:

- Primary: `#74FA4C` (lime green)
- Surface dark: `#1A1A1A` / `#2B2B2B` / `#3A3A3A`
- Border: `#4A4A4A`
- Logo: `tmux-session-frontend/src/assets/Logo.png`

---

## 📁 Scripts del monorepo

```powershell
npm run dev:frontend    # arranca solo el frontend
npm run dev:backend     # arranca solo el backend
npm run build           # compila ambos para producción
npm run install:all     # instala dependencias de todos los workspaces
```
