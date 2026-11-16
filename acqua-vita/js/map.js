// Selector de punto en el mapa (Leaflet). Se carga recién cuando se abre el mapa,
// así el resto de la app anda igual sin internet.
import { CENTRO_PUEBLO, tienePunto } from "./geo.js";

const LEAFLET_LOCAL = "./lib/leaflet/";
const LEAFLET_CDN = "https://unpkg.com/leaflet@1.9.4/dist/";

function cargarScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("no cargó " + src));
    document.head.appendChild(s);
  });
}
function cargarEstilo(href) {
  return new Promise((resolve, reject) => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = href;
    l.onload = resolve;
    l.onerror = () => reject(new Error("no cargó " + href));
    document.head.appendChild(l);
  });
}

let promesaLeaflet = null;
export function cargarLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!promesaLeaflet) {
    const intentar = (base) =>
      Promise.all([cargarEstilo(base + "leaflet.css"), cargarScript(base + "leaflet.js")]);
    promesaLeaflet = intentar(LEAFLET_LOCAL)
      .catch(() => intentar(LEAFLET_CDN))
      .then(() => window.L)
      .catch(() => {
        promesaLeaflet = null;
        throw new Error("No se pudo cargar el mapa. Hace falta internet la primera vez.");
      });
  }
  return promesaLeaflet;
}

const CAPAS = {
  calles: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attr: "© Colaboradores de OpenStreetMap",
  },
  satelite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attr: "Imágenes © Esri",
  },
};

let mapa = null;
let capaActual = null;
let capaNombre = "calles";
let marcadores = null;

/**
 * Muestra el mapa dentro de `contenedor`. El punto elegido es el centro del mapa
 * (mira de la cruz): se mueve el mapa con el dedo hasta dejar la casa en el centro.
 * `otros`: clientes que ya tienen punto, para tener referencias cerca.
 */
export async function mostrarMapa(contenedor, { inicial, otros = [] }) {
  const L = await cargarLeaflet();
  if (mapa) {
    mapa.remove();
    mapa = null;
  }
  const centro = tienePunto(inicial) ? inicial : CENTRO_PUEBLO;
  mapa = L.map(contenedor, { zoomControl: true, attributionControl: true }).setView(
    [centro.lat, centro.lng],
    tienePunto(inicial) ? 18 : 15,
  );
  capaNombre = "calles";
  capaActual = L.tileLayer(CAPAS.calles.url, { maxZoom: 19, attribution: CAPAS.calles.attr }).addTo(mapa);

  marcadores = L.layerGroup().addTo(mapa);
  for (const c of otros) {
    if (!tienePunto(c)) continue;
    L.circleMarker([c.lat, c.lng], {
      radius: 6,
      weight: 2,
      color: "#16365c",
      fillColor: "#4ca83a",
      fillOpacity: 0.9,
    })
      .bindTooltip(c.nombre, { direction: "top" })
      .addTo(marcadores);
  }
  setTimeout(() => mapa && mapa.invalidateSize(), 50);
}

export function cambiarCapa() {
  if (!mapa || !window.L) return capaNombre;
  const L = window.L;
  capaNombre = capaNombre === "calles" ? "satelite" : "calles";
  if (capaActual) mapa.removeLayer(capaActual);
  capaActual = L.tileLayer(CAPAS[capaNombre].url, {
    maxZoom: 19,
    attribution: CAPAS[capaNombre].attr,
  }).addTo(mapa);
  return capaNombre;
}

export function centroActual() {
  if (!mapa) return null;
  const c = mapa.getCenter();
  return { lat: c.lat, lng: c.lng };
}

export function irA(punto, zoom = 18) {
  if (mapa) mapa.setView([punto.lat, punto.lng], zoom);
}

export function cerrarMapa() {
  if (mapa) {
    mapa.remove();
    mapa = null;
  }
}
