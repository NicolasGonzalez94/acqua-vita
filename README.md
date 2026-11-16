# Acqua Vita Reparto

App para el celular (PWA) para llevar los clientes, armar el recorrido del día con el mejor orden, registrar bidones y cobros, y mandar el resumen a tu jefe por WhatsApp.

- Los datos quedan **solo en tu celular** (no hay servidor ni cuentas).
- Se instala como una app, con el ícono de Acqua Vita.
- Funciona sin internet (menos el mapa para marcar casas, ver más abajo).

---

## 1. Abrir el proyecto en VS Code

1. Descomprimí la carpeta `acqua-vita`.
2. En VS Code: **Archivo → Abrir carpeta** y elegí `acqua-vita`.

## 2. Extensiones (qué son y qué hacer con cada una)

Las extensiones se instalan desde el panel de la izquierda (el ícono de cuadraditos) o con `Ctrl + Shift + X`. Buscás el nombre y tocás **Instalar**.

**Live Server** (autor: Ritwick Dey) — *obligatoria para probar*
- Qué hace: abre tu proyecto en el navegador y lo recarga solo cada vez que guardás un archivo.
- Cómo se usa: clic derecho sobre `index.html` → **Open with Live Server**. Se abre en `http://127.0.0.1:5500`.
- Por qué la necesitás: la app no funciona abriendo el archivo con doble clic. Necesita un servidor, y Live Server hace de servidor local.

**Prettier - Code formatter** — *recomendada*
- Qué hace: acomoda el código (espacios, comillas, saltos de línea) para que quede prolijo.
- Cómo se usa: abrí Ajustes (`Ctrl + ,`), buscá **Format on Save** y tildalo. Desde ahí, cada vez que guardás, el archivo se ordena solo.
- La primera vez que formatees, VS Code te pide elegir un formateador: elegí Prettier.

No hace falta instalar Node ni nada más. Todo el proyecto es HTML, CSS y JavaScript simples.

## 3. Probar en la compu con Brave

1. Abrí con Live Server (paso anterior).
2. Apretá `F12` para abrir las herramientas. En la pestaña **Application** (o **Aplicación**) podés ver el **Manifest** y los **Service Workers**: ahí chequeás que la app se reconozca como instalable.
3. El GPS en Brave de escritorio puede no funcionar si no activás "Usar servicios de Google para la ubicación" en `brave://settings/privacy`. Es normal: en el celular usa el GPS de verdad. Para probar sin GPS, usá "Pegar coordenadas".

## 4. Mapa propio (recomendado, 3 minutos)

El mapa para marcar casas usa una librería gratuita llamada Leaflet. Para que quede guardada dentro de tu app (más seguro y más rápido):

1. Entrá a https://leafletjs.com/download.html y bajá **Leaflet 1.9.4** (el zip).
2. Dentro del zip está la carpeta `dist`. Copiá estos 3 elementos a una carpeta nueva `lib/leaflet/` dentro del proyecto:
   - `leaflet.js`
   - `leaflet.css`
   - la carpeta `images`
3. Listo. Si no lo hacés, la app lo baja de `unpkg.com` cuando abrís el mapa (necesita internet y funciona igual).

Después de copiar los archivos, agregá `"./lib/leaflet/leaflet.js"` y `"./lib/leaflet/leaflet.css"` a la lista `ARCHIVOS` de `sw.js`, así quedan disponibles sin internet.

## 5. Publicarla gratis en GitHub Pages

1. En VS Code: panel **Control de código fuente** (ícono de ramitas) → **Inicializar repositorio** → escribí un mensaje (por ejemplo "Primera versión") → **Confirmar** → **Publicar en GitHub**. Elegí **repositorio público** y el nombre `acqua-vita`.
2. En GitHub, entrá al repositorio → **Settings → Pages** → en *Branch* elegí `main` y la carpeta `/ (root)` → **Save**.
3. A los 1 o 2 minutos tu app queda en `https://TU-USUARIO.github.io/acqua-vita/`.

El repositorio es público, pero **solo contiene el código**. Los datos de tus clientes nunca se suben: viven en el celular. No guardes datos de clientes ni claves en el proyecto.

## 6. Instalarla en el Android

1. Abrí la dirección de GitHub Pages en el navegador del celu (Chrome es lo más seguro; Brave también debería andar).
2. Menú de los tres puntos → **Instalar app** (o **Agregar a la pantalla principal**).
3. Abrila desde el ícono. En **Ajustes** cargá: el precio del bidón, el WhatsApp de tu jefe y el depósito (parado en el depósito, tocá "Estoy en el depósito").

## 7. Cómo funciona sin señal

- **El GPS no necesita señal de datos.** Funciona con satélites, igual que en un auto con GPS.
- **La app** (clientes, recorrido, cuentas, ordenar la ruta, resumen) funciona sin internet, porque todo se calcula en el celu.
- **Google Maps** para ir hasta cada cliente necesita mapas guardados. Antes de salir, en Google Maps: tu foto de perfil → **Mapas sin conexión** → **Seleccionar tu propio mapa** → encuadrá Huanguelén → **Descargar**. Con eso te guía sin señal.
- **El mapa de la app** (para marcar casas) necesita internet, salvo las zonas que ya viste antes. Para casas nuevas, usá "Guardar mi ubicación aquí" parado en la puerta, que no necesita internet.
- **Enviar el WhatsApp** necesita internet, claro. Podés dejarlo para cuando tengas señal: el resumen queda guardado.

## 8. Cómo marcar la casa de un cliente (de lo más fácil a lo más fino)

1. **Parado en la puerta**: en el cliente tocá **Guardar mi ubicación aquí**. Es lo más rápido y preciso. Si el GPS dice precisión mayor a 40 m, esperá unos segundos y tocá de nuevo.
2. **En el mapa**: **Marcar en el mapa**, movés el mapa con el dedo hasta dejar la casa debajo de la cruz roja y tocás **Usar este punto**. Con **Ver satélite** reconocés los techos.
3. **Pegando coordenadas**: en Google Maps mantené apretada la casa, copiá los dos números que aparecen arriba y pegalos en el cliente.

Los clientes **sin punto** igual se pueden usar (Google busca por la dirección escrita), pero no entran en el cálculo del mejor orden y quedan al final del recorrido.

## 9. Cómo se ordena la ruta

Parte del depósito, va siempre al cliente más cercano y después corrige los cruces del camino. Termina volviendo al depósito. Usa distancia en línea recta, que en un pueblo en damero da muy buenos resultados. No sabe de calles de un solo sentido, de tierra o cortadas, por eso podés mover las paradas (↑ ↓, **Ahora**) o tocar **Reordenar lo que falta** (parte desde donde estás).

Para ir a cada cliente, el botón **Ir con Google Maps** abre la navegación hasta ese punto.

## 10. Seguridad (qué hay y qué no)

- La app se sirve por **HTTPS** (lo da GitHub Pages) y solo carga código propio. Una política de seguridad (CSP) en `index.html` bloquea cualquier otro script.
- No hay cuentas, claves ni servidor: no hay nada que robar de un lado ni de otro. Los datos están en el almacenamiento del celular.
- La protección de esos datos es el **bloqueo de tu celu** (huella, patrón o PIN).
- La app pide al navegador que **no borre los datos** si falta espacio.
- Los textos que escribís se muestran siempre como texto (nunca como código), y las copias de seguridad que restaurás se validan.
- **Hacé copias de seguridad** (Ajustes → Guardar copia). Si perdés o rompés el celu o borrás los datos del navegador, sin copia se pierde todo.
- Los mapas vienen de OpenStreetMap y Esri, que tienen condiciones de uso. Para una persona usando la app está bien. Si la empresa creciera a muchos repartidores, habría que pasar a un proveedor de mapas con plan propio.

## 11. Actualizar la app

Cambiás los archivos → guardás → en Control de código fuente: **Confirmar** y **Sincronizar**. En el celu, abrí la app y cerrala; la próxima vez que la abras toma la versión nueva. Si cambiás la lista de archivos de `sw.js`, subí el número de `VERSION` (por ejemplo `v2`).

## Estructura

```
acqua-vita/
  index.html            pantalla y política de seguridad
  manifest.webmanifest  datos para instalarla como app
  sw.js                 funcionamiento sin internet
  css/styles.css        estilos
  js/app.js             pantallas y lógica
  js/db.js              guardado en el celular (IndexedDB)
  js/geo.js             distancias, orden de la ruta, links de Google Maps
  js/summary.js         totales y mensaje de WhatsApp
  js/map.js             mapa para marcar casas
  icons/                logo de Acqua Vita (icon.svg es el original editable)
```

## Ideas para más adelante

Historial de recorridos, saldo de bidones por cliente, precio especial por cliente, sincronizar con otro celular.
