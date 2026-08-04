# Rivix Sports Chile — sitio web

Sitio web de Rivix Sports Chile (mangas de compresión deportiva). Hoy es un
sitio estático de una sola página (`index.html`, con todas las imágenes
incrustadas), con la carpeta `netlify/functions/` ya preparada para cuando
quieras agregar backend (por ejemplo, para integrar Webpay Plus más adelante).

## Estructura del proyecto

```
rivix-project/
├── index.html              # El sitio completo (HTML + CSS + JS + imágenes)
├── netlify.toml             # Configuración de despliegue de Netlify
├── package.json             # Dependencias del proyecto
├── .gitignore
├── README.md
└── netlify/
    └── functions/            # Acá van las funciones serverless (vacía por ahora)
```

## 1. Subir el proyecto a GitHub

```bash
cd rivix-project
git init
git add .
git commit -m "Sitio Rivix Sports Chile"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/rivix-sports-web.git
git push -u origin main
```

(Antes crea el repositorio vacío en GitHub, sin README ni .gitignore, para
evitar conflictos con este primer push).

## 2. Conectar el repositorio a Netlify

1. Entra a **app.netlify.com** → **Add new site** → **Import an existing
   project**.
2. Elige **GitHub** y autoriza el acceso si es la primera vez.
3. Selecciona el repositorio `rivix-sports-web`.
4. Netlify va a detectar automáticamente la configuración gracias al
   `netlify.toml` incluido:
   - **Build command:** (vacío, no hace falta)
   - **Publish directory:** `.`
   - **Functions directory:** `netlify/functions`
5. Clic en **Deploy site**. Netlify te da una URL tipo
   `https://algo-al-azar.netlify.app`.

Desde ahora, **cada vez que hagas `git push` a la rama `main`, Netlify
publica la nueva versión automáticamente** — ya no necesitas arrastrar
archivos a mano.

## 3. Dominio propio (NIC Chile u otro)

Una vez publicado, puedes conectar tu dominio en **Site settings → Domain
management → Add a domain**, igual que con el despliegue manual. Si tu
dominio es `.cl`, lo registras/gestionas en NIC Chile y apuntas los
nameservers a los que te entregue Netlify.

## 4. Agregar funciones serverless (ej. Webpay Plus)

Cuando quieras integrar Webpay Plus (o cualquier otro backend), simplemente
crea archivos `.js` dentro de `netlify/functions/`. Por ejemplo:

```
netlify/functions/webpay-create.js
netlify/functions/webpay-return.js
```

Cada archivo exporta un `handler`:

```js
// netlify/functions/webpay-create.js
exports.handler = async (event) => {
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true }),
  };
};
```

Netlify las publica automáticamente en:

```
https://tu-sitio.netlify.app/.netlify/functions/webpay-create
```

No necesitas tocar `netlify.toml` para que esto funcione — ya está
configurado para leer esa carpeta. Si más adelante quieres URLs más limpias
(por ejemplo `/api/webpay/create` en vez de `/.netlify/functions/...`), hay
un bloque de ejemplo ya dejado (comentado) dentro de `netlify.toml` que solo
tienes que descomentar.

Para las funciones de Webpay vas a necesitar el paquete `transbank-sdk`
como dependencia (`npm install transbank-sdk`) y configurar las credenciales
como variables de entorno en **Site settings → Environment variables** de
Netlify (nunca subirlas al repositorio). Cuando quieras avanzar con esto,
te ayudo a escribir esas funciones.

## 5. Probarlo en tu computador antes de subirlo (opcional)

```bash
npm install
npm run dev
```

Esto levanta el sitio localmente en `http://localhost:8888`, simulando el
comportamiento real de Netlify (incluyendo funciones, cuando existan).

## Notas

- El formulario de "Contacto" ya usa **Netlify Forms** (no requiere
  función ni backend) — revisa **Site settings → Forms → Form
  notifications** para confirmar que el correo de aviso llegue a
  `padelaltamirachile@gmail.com`.
- El botón "Pedir por WhatsApp" del carrito abre WhatsApp directamente con
  el pedido prellenado — tampoco requiere backend.

