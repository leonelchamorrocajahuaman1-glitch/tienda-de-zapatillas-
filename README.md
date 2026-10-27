# Tienda de zapatillas 3D

Tienda online de zapatillas con experiencia cinematográfica en 3D y un sistema real de administración, inventario y ventas.

- **Tienda pública** (`apps/store`): portada con escenas 3D fijadas al scroll, transiciones glitch, catálogo con buscador y filtros, visor 3D por producto, carrito, registro de clientes, confirmación de pedidos, historial y seguimiento.
- **Panel administrativo** (`apps/admin`): aplicación separada y privada con dashboard, productos, precios y descuentos, inventario por talla y color, imágenes, modelos 3D (GLB/glTF), publicación, pedidos y estados, clientes, historial de ventas y auditoría de inventario.
- **API** (`server`): Node.js + Express + Prisma. **Una sola base de datos PostgreSQL** compartida por ambas interfaces.

```
 Navegador cliente            Navegador administrador
 http://localhost:5173        http://localhost:5174/admin
        │                              │
        │   /api/catalog, /api/cart,   │   /api/admin/*  (sesión admin
        │   /api/orders  (sesión de    │    separada, rol ADMIN verificado
        │    cliente)                  │    en el servidor)
        └──────────────┬───────────────┘
                       ▼
             API Express  http://localhost:4000
                       │  Prisma
                       ▼
             PostgreSQL  ·  base "tienda_zapatillas"  (única)
```

---

## 1. Requisitos en Windows

| Programa | Versión | Descarga |
|---|---|---|
| Node.js | 20 o superior (LTS) | https://nodejs.org |
| PostgreSQL | 14 o superior | https://www.postgresql.org/download/windows/ (anota la contraseña del usuario `postgres` que te pide el instalador) |
| Git (opcional) | — | https://git-scm.com |

> Alternativa a instalar PostgreSQL: con **Docker Desktop** ejecuta `docker compose up -d` en la carpeta del proyecto (usuario `postgres`, contraseña `postgres`).

## 2. Instalación (solo la primera vez)

**Opción fácil:** doble clic en **`instalar.bat`**.

**Opción por terminal** (PowerShell o CMD, dentro de la carpeta del proyecto):

```bash
npm run setup
```

El asistente:
1. Te pregunta los datos de PostgreSQL y el email y la contraseña del administrador.
2. Crea `server/.env` con secretos aleatorios para las sesiones.
3. Instala las dependencias (`npm install`).
4. **Crea la base de datos y aplica las migraciones** (`prisma migrate deploy`).
5. **Carga los datos iniciales** (`prisma db seed`): el administrador, las tallas EU 35–45, los colores, las categorías y las marcas base. **No crea productos ni pedidos falsos.**
6. **Importa tu catálogo** (`server/catalog/productos.json`): los 12 modelos con sus fotos (ver la sección "Catálogo de modelos").

<details>
<summary>Instalación manual, paso a paso</summary>

```bash
npm install
copy server\.env.example server\.env      # (en macOS/Linux: cp)
# edita server\.env: DATABASE_URL, JWT_SECRET_STORE, JWT_SECRET_ADMIN, ADMIN_EMAIL, ADMIN_PASSWORD
npm run db:deploy                          # crea la base y aplica las migraciones
npm run db:seed                            # administrador + tallas, colores, categorías y marcas
```
</details>

## 3. Iniciar el sistema

**Opción fácil:** doble clic en **`iniciar.bat`**. Abre las dos interfaces en el navegador.

**Por terminal:**

```bash
npm run dev
```

Esto levanta tres procesos a la vez:

| Servicio | URL |
|---|---|
| Tienda (clientes) | http://localhost:5173 |
| Panel administrativo | http://localhost:5174/admin |
| API | http://localhost:4000/api/health |

Para detener todo: `Ctrl + C` en la terminal.

También puedes iniciarlos por separado: `npm run dev:server`, `npm run dev:store` y `npm run dev:admin`.

## Catálogo de modelos

`server/catalog/productos.json` contiene 12 modelos: Air Max 270, Ultra 4D, Air Jordan 1 High OG, RS-X, ZoomX Invincible, NMD S1, Air Jordan 4 Retro, VaporMax, Yeezy 350 V2, LeBron XX, Future Rider y Ozweego. Cada uno tiene su marca, categoría, frase, colorway, color de luz para la escena 3D y dos fotos (en `server/catalog/imagenes/`).

```bash
npm run catalogo:importar
```

- Los modelos **no traen precio ni stock**, así que se importan como **borradores** (no se ven en la tienda). Para publicarlos:
  - **Desde el panel:** Productos → abre el modelo → escribe el precio → elige tallas y existencias → **Publicar en la tienda**.
  - **O en bloque:** completa `"precio"` (en soles) y `"stock"` (p. ej. `{"40": 3, "41": 5}`) en `productos.json` y vuelve a ejecutar `npm run catalogo:importar`. Los modelos completos se publican solos.
- El importador **no sobrescribe** lo que cambies en el panel: solo crea lo que falta. Se puede ejecutar varias veces sin problema.
- Air Max 270, Air Jordan 1, RS-X y VaporMax vienen marcados como **destacados** (escenas de la portada). Cámbialo con la casilla "Destacar en la portada".
- Para añadir más modelos: agrega entradas al JSON y sus fotos a `server/catalog/imagenes/`, o créalos desde el panel.

## 4. Entrar al panel administrativo

1. Abre http://localhost:5174/admin
2. Entra con el `ADMIN_EMAIL` y el `ADMIN_PASSWORD` que configuraste (están en `server/.env`).
3. Cambia la contraseña desde **Mi cuenta** cuando quieras.

Las cuentas de clientes **no pueden** entrar: el login del panel solo acepta usuarios con rol `ADMIN`.

## 5. Comprobar que la tienda y el panel usan la misma base de datos

1. **Panel → Productos → + Nueva zapatilla.** Nombre `Urban X`, precio `199.90`, marca y categoría. Pulsa **Crear producto**.
2. En **Tallas, colores y existencias**, elige un color y las tallas (p. ej. 40, 41 y 42), escribe las existencias y pulsa **Guardar inventario**.
3. Sube una o más **imágenes** y, si lo tienes, el **modelo 3D** (`.glb`).
4. Marca **Destacar en la portada** y pulsa **Publicar en la tienda**.
5. Abre la **tienda** (http://localhost:5173): Urban X aparece en la portada 3D y en el catálogo.
6. En la tienda, elige una talla y pulsa **Añadir al carrito** → **Revisar y pagar** → crea una cuenta → **Confirmar pedido**.
7. En el **panel → Pedidos** aparece el pedido nuevo (`PED-000001`). Ábrelo y pulsa **Confirmar pedido**.
8. Revisa **Movimientos de inventario**: la reserva y la salida de stock. En la tienda, el cliente ve en **Mis pedidos** el estado "Confirmado".
9. Cambia el precio o el stock en el panel y recarga la ficha del producto en la tienda: el cambio aparece de inmediato. La ficha también se actualiza sola cada 30 segundos.

Para ver directamente las tablas: `npm run db:studio` (abre Prisma Studio en el navegador).

## 6. Reglas de pedidos e inventario

`stock` son las unidades físicas en almacén y `reservado` las apartadas por pedidos pendientes. Se puede vender `stock − reservado`.

| Evento | Efecto en el inventario |
|---|---|
| El cliente confirma el pedido → **Pendiente** | `reservado += cantidad` (otros clientes ya no pueden comprar esas unidades) |
| Pendiente → **Confirmado** | `stock −= cantidad` y `reservado −= cantidad` (salen del almacén) |
| Pendiente → **Cancelado** | `reservado −= cantidad` (se libera la reserva) |
| Confirmado / Preparando → **Cancelado** | `stock += cantidad` (vuelven al almacén) |
| Preparando, **Enviado** y **Entregado** | Sin cambios de inventario |

- Transiciones permitidas: Pendiente → Confirmado → Preparando → Enviado → Entregado. Se puede cancelar en cualquier momento antes del envío.
- Cada pedido guarda su `inventoryState` (RESERVED, COMMITTED, RELEASED o RESTOCKED), así que **nunca se descuentan dos veces las mismas unidades**.
- Cada operación es un `UPDATE` atómico dentro de una **transacción**. Si dos clientes compran la última unidad a la vez, solo uno lo consigue.
- El servidor recalcula **precios, descuentos, envío y totales**. Ignora cualquier precio que envíe el navegador.
- Cada línea de pedido guarda el precio cobrado (precio histórico). Además, cada cambio de precio queda registrado en `PriceHistory`.
- Los pedidos llevan una clave de idempotencia: hacer doble clic en "Confirmar pedido" no crea dos pedidos.
- Pago: **contra entrega**. No se simulan cobros electrónicos. Al marcar el pedido como "Entregado", el pago pasa a "Pagado". Para integrar una pasarela de pagos en el futuro, consulta `server/src/payments/index.ts`.

## 7. Seguridad

- Contraseñas con **bcrypt**. Las sesiones van en cookies `httpOnly` y `SameSite=Strict`.
- **Dos sesiones independientes**: la cookie de clientes (`tz_store`) y la de administración (`tz_admin`, firmada con otro secreto y enviada solo a `/api/admin`).
- **Toda la autorización ocurre en el servidor.** Las rutas `/api/admin/*` exigen la sesión de administrador y comprueban el rol `ADMIN` en la base de datos en cada petición. Un cliente recibe `401` aunque conozca las URLs.
- Un cliente solo ve y cancela **sus** pedidos, y solo mientras están pendientes. Un pedido ajeno responde `404`.
- Validación de todos los datos con `zod`, límite de intentos de inicio de sesión y cabeceras de seguridad con `helmet`.
- Los archivos subidos se validan por su contenido real (no solo por la extensión).
- Las credenciales y los secretos viven en `server/.env`, que no se sube al repositorio.

## 8. Modelos 3D

- Visor: [`<model-viewer>`](https://modelviewer.dev). Permite girar el modelo con el mouse o el dedo y acercarlo con la rueda o pellizcando. Se carga solo cuando hace falta.
- Desde **Panel → Producto → Modelo 3D** se sube un `.glb` (recomendado) o un `.gltf` con las texturas incrustadas, de hasta 60 MB. No hace falta tocar el código.
- Si un producto no tiene modelo, o si el modelo falla al cargar, la tienda muestra sus fotos. Si tampoco tiene fotos, muestra una silueta rotulada "Modelo 3D no disponible". **Nunca se inventa un modelo.**
- En la portada, el modelo de cada producto destacado gira según el scroll.
- Exporta los modelos con origen centrado y escala real. Si usan compresión Draco/KTX2, el visor descarga sus decodificadores desde `www.gstatic.com`.

## 9. Personalización

- **Nombre comercial:** crea `apps/store/.env` y `apps/admin/.env` con `VITE_STORE_NAME="Tu Marca"` (puedes partir de los `.env.example`).
- **Envío:** `SHIPPING_FLAT_CENTS` y `FREE_SHIPPING_MIN_CENTS` en `server/.env` (en céntimos: `1000` = S/ 10.00).
- **Color de luz de cada escena:** campo "Color de luz en la escena 3D" de cada producto.

## 10. Publicarla en Internet (link público)

El repositorio ya trae `render.yaml`, así que se publica en [Render](https://render.com) en unos minutos y sin tocar código.

### Pasos

1. Crea una cuenta en https://render.com con **"Sign up with GitHub"** y autoriza el acceso a este repositorio.
2. Abre este enlace:
   **https://render.com/deploy?repo=https://github.com/leonelchamorrocajahuaman1-glitch/tienda-de-zapatillas-**
   (o, en el panel de Render: **New → Blueprint** → elige el repositorio).
3. Render te pedirá dos datos:
   - `ADMIN_EMAIL`: el email con el que entrarás al panel.
   - `ADMIN_PASSWORD`: tu contraseña de administrador (**mínimo 10 caracteres**).
4. Pulsa **Apply / Deploy Blueprint** y espera unos 5–10 minutos. Render crea la base de datos PostgreSQL, compila todo, aplica las migraciones, crea el administrador e importa los 12 modelos.
5. Tu tienda queda en una dirección como **https://sole20-tienda.onrender.com** (Render muestra la URL exacta):
   - Tienda: `https://sole20-tienda.onrender.com`
   - Panel: `https://sole20-tienda.onrender.com/admin`
6. Entra al panel, ponles precio y stock a los modelos y pulsa **Publicar en la tienda**.

Cada vez que se suban cambios a GitHub, Render vuelve a publicar la tienda automáticamente.

### Plan gratuito y plan de pago

La configuración usa los **planes gratuitos** de Render, que sirven para probar la tienda. Según la documentación de Render:
- El servicio web gratuito **se duerme** tras 15 minutos sin visitas, y la siguiente visita tarda alrededor de un minuto en cargar.
- La base de datos gratuita **caduca a los 30 días**. Después hay 14 días de gracia y luego se borra con todos sus datos.

Para vender de verdad, cambia en Render el servicio y la base de datos a un plan de pago (o cambia `plan:` en `render.yaml`) **antes de que pasen los 30 días**. Consulta los precios actuales en https://render.com/pricing.

### Detalles técnicos

- Un solo servicio de Node sirve la tienda en `/`, el panel en `/admin` y la API en `/api`.
- Las imágenes y los modelos 3D se guardan **en la base de datos** (tabla `StoredFile`), así que no hace falta un disco permanente y una copia de la base incluye también los archivos.
- Al arrancar (`npm run start:prod`) se aplican las migraciones, se crea el administrador si falta y se importa el catálogo **solo si la base está vacía**. Así no reaparece un producto que hayas borrado.
- Los secretos de sesión los genera Render. HTTPS viene incluido, así que las cookies son `Secure`.
- Para usar tu propio dominio (p. ej. `www.sole20.pe`): en Render, **Settings → Custom Domains**.
- En otro proveedor (Railway, un VPS…): `npm ci --include=dev && npm run build` y luego `npm run start:prod`, con las variables de `server/.env.example`. Para probarlo en tu PC sin HTTPS, usa `COOKIE_SECURE=false`.

## 11. Comandos

| Comando | Qué hace |
|---|---|
| `npm run setup` | Configuración inicial guiada |
| `npm run dev` | API, tienda y panel en modo desarrollo |
| `npm run db:deploy` | Aplica las migraciones |
| `npm run db:migrate` | Crea una migración nueva tras editar `schema.prisma` (desarrollo) |
| `npm run db:seed` | Datos iniciales (se puede repetir sin duplicar) |
| `npm run catalogo:importar` | Importa/completa el catálogo de `server/catalog/productos.json` |
| `npm run db:studio` | Explorador visual de la base de datos |
| `npm run typecheck` | Comprobación de tipos de todo el proyecto |
| `npm test` | Pruebas de extremo a extremo de la API (requiere `TEST_DATABASE_URL`) |
| `npm run build` / `npm run start:prod` | Compilar y ejecutar en modo producción (migra, crea el admin e importa el catálogo si la base está vacía) |

**Pruebas automáticas:** crea una base de datos vacía cuyo nombre termine en `_test` y ejecuta:

```bash
# PowerShell
$env:TEST_DATABASE_URL="postgresql://postgres:TU_CLAVE@localhost:5432/tienda_zapatillas_test"; npm test
```

Las pruebas recorren el flujo completo (registrar Urban X, publicarlo, comprarlo, confirmarlo y cancelarlo) y comprueban la seguridad, la compra simultánea de la última unidad, la idempotencia y el historial de precios.

## 12. Estructura

```
apps/
  store/     Tienda pública (React + Vite + GSAP + model-viewer)
  admin/     Panel administrativo (React + Vite), servido bajo /admin
packages/
  shared/    Tipos, formato en soles y cliente HTTP compartidos
server/
  prisma/    schema.prisma (base de datos única), migraciones y datos iniciales
  catalog/   productos.json + imagenes/ (catálogo importable)
  scripts/   importar-catalogo.ts
  src/
    routes/public/   catálogo, autenticación de clientes, carrito y pedidos
    routes/admin/    API privada del panel
    services/        pedidos e inventario (transacciones)
    payments/        punto de integración para pasarelas de pago
    storage/         subida y validación de imágenes y modelos 3D
  test/      prueba de extremo a extremo
scripts/setup.mjs    asistente de instalación
instalar.bat / iniciar.bat   accesos directos para Windows
```
