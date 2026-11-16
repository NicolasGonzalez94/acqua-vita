// Cálculos de ubicación y de ruta. No usa internet: todo se resuelve en el celular.

export const LOCALIDAD = "Huanguelén, Buenos Aires, Argentina";
// Punto donde arranca el mapa la primera vez (centro del pueblo). Se puede cambiar acá.
export const CENTRO_PUEBLO = { lat: -37.0333, lng: -61.9333 };

const RADIO_TIERRA = 6371000; // metros

export function tienePunto(c) {
  return !!c && Number.isFinite(c.lat) && Number.isFinite(c.lng);
}

/** Distancia en metros entre dos puntos {lat, lng} (fórmula de haversine). */
export function distancia(a, b) {
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA * Math.asin(Math.sqrt(h));
}

/** Largo de un recorrido: inicio -> puntos en orden -> fin (inicio y fin son opcionales). */
export function largoRecorrido(puntos, inicio, fin) {
  let total = 0;
  let previo = inicio || null;
  for (const p of puntos) {
    if (previo) total += distancia(previo, p);
    previo = p;
  }
  if (fin && previo) total += distancia(previo, fin);
  return total;
}

/**
 * Ordena las paradas para recorrer poco camino.
 * 1) Vecino más cercano: siempre va al punto más cercano que falta.
 * 2) 2-opt: busca cruces en el recorrido y los desarma hasta que no mejora más.
 * puntos: [{id, lat, lng}]. Devuelve los mismos objetos, reordenados.
 * Usa distancia en línea recta: en un pueblo en damero da muy buen resultado,
 * pero no conoce calles de un solo sentido ni de tierra.
 */
export function ordenar(puntos, inicio, fin) {
  const n = puntos.length;
  if (n <= 1) return puntos.slice();
  const desde = inicio || puntos[0];

  const libres = puntos.slice();
  const orden = [];
  let actual = desde;
  while (libres.length) {
    let mejor = 0;
    let mejorD = Infinity;
    for (let i = 0; i < libres.length; i++) {
      const d = distancia(actual, libres[i]);
      if (d < mejorD) {
        mejorD = d;
        mejor = i;
      }
    }
    actual = libres.splice(mejor, 1)[0];
    orden.push(actual);
  }

  let mejoro = true;
  let vueltas = 0;
  while (mejoro && vueltas++ < 200) {
    mejoro = false;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = i === 0 ? desde : orden[i - 1];
        const b = orden[i];
        const c = orden[j];
        const d = j === n - 1 ? fin || null : orden[j + 1];
        const antes = distancia(a, b) + (d ? distancia(c, d) : 0);
        const despues = distancia(a, c) + (d ? distancia(b, d) : 0);
        if (despues < antes - 1e-6) {
          let x = i;
          let y = j;
          while (x < y) {
            [orden[x], orden[y]] = [orden[y], orden[x]];
            x++;
            y--;
          }
          mejoro = true;
        }
      }
    }
  }
  return orden;
}

/**
 * Dónde conviene meter una parada nueva en un recorrido que ya está armado
 * (la que agrega el mínimo de camino). Devuelve la posición 0..puntos.length.
 */
export function mejorPosicion(puntos, nuevo, inicio, fin) {
  if (!puntos.length) return 0;
  let mejor = 0;
  let mejorCosto = Infinity;
  for (let k = 0; k <= puntos.length; k++) {
    const previo = k === 0 ? inicio || null : puntos[k - 1];
    const siguiente = k === puntos.length ? fin || null : puntos[k];
    let costo = 0;
    if (previo) costo += distancia(previo, nuevo);
    if (siguiente) costo += distancia(nuevo, siguiente);
    if (previo && siguiente) costo -= distancia(previo, siguiente);
    if (costo < mejorCosto) {
      mejorCosto = costo;
      mejor = k;
    }
  }
  return mejor;
}

/** Lee "-37.0333, -61.9333" (como lo copia Google Maps) o variantes con espacios y punto y coma. */
export function leerCoordenadas(texto) {
  const m = String(texto || "")
    .trim()
    .match(/^(-?\d{1,3}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)$/);
  if (!m) return null;
  const lat = parseFloat(m[1].replace(",", "."));
  const lng = parseFloat(m[2].replace(",", "."));
  if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return null;
  return { lat, lng };
}

function destino(c) {
  return tienePunto(c)
    ? `${c.lat.toFixed(6)},${c.lng.toFixed(6)}`
    : `${c.direccion}, ${LOCALIDAD}`;
}

/** Link que abre Google Maps con la ruta en auto hasta el cliente, desde donde estés. */
export function urlComoLlegar(c) {
  return (
    "https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=" +
    encodeURIComponent(destino(c))
  );
}

/** Link con varias paradas en orden (Google admite hasta 9 intermedias; se usan las primeras 10). */
export function urlRutaCompleta(clientes) {
  const lista = clientes.slice(0, 10);
  if (!lista.length) return null;
  if (lista.length === 1) return urlComoLlegar(lista[0]);
  const ultimo = lista[lista.length - 1];
  const intermedias = lista.slice(0, -1).map(destino).join("|");
  return (
    "https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=" +
    encodeURIComponent(destino(ultimo)) +
    "&waypoints=" +
    encodeURIComponent(intermedias)
  );
}

export function urlVerEnMapa(c) {
  return (
    "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(destino(c))
  );
}

/** Pide la ubicación del GPS. Funciona sin señal de datos. Rechaza con un mensaje en español. */
export function ubicacionActual(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Este celular no permite usar el GPS desde la app."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          precision: pos.coords.accuracy,
        }),
      (err) => {
        const msg =
          err.code === 1
            ? "No diste permiso para usar la ubicación. Activalo en los ajustes del navegador."
            : err.code === 3
              ? "El GPS tardó demasiado. Probá afuera o esperá unos segundos."
              : "No se pudo obtener la ubicación.";
        reject(new Error(msg));
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 15000 },
    );
  });
}
