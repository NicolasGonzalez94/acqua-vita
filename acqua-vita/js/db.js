// Guardado de datos en el celular (IndexedDB). No hay servidor: nada sale del teléfono.

const NOMBRE_DB = "acqua-vita";
const VERSION_DB = 1;
let conexion = null;

function abrir() {
  if (!conexion) {
    conexion = new Promise((resolve, reject) => {
      const req = indexedDB.open(NOMBRE_DB, VERSION_DB);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore("clientes", { keyPath: "id" });
        db.createObjectStore("kv", { keyPath: "clave" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return conexion;
}

function ejecutar(tabla, modo, fn) {
  return abrir().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(tabla, modo);
        const req = fn(t.objectStore(tabla));
        t.oncomplete = () => resolve(req ? req.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export const todosLosClientes = () => ejecutar("clientes", "readonly", (s) => s.getAll());
export const guardarCliente = (c) => ejecutar("clientes", "readwrite", (s) => s.put(c));
export const borrarCliente = (id) => ejecutar("clientes", "readwrite", (s) => s.delete(id));

export async function leerClave(clave, porDefecto) {
  const r = await ejecutar("kv", "readonly", (s) => s.get(clave));
  return r ? r.valor : porDefecto;
}
export const guardarClave = (clave, valor) =>
  ejecutar("kv", "readwrite", (s) => s.put({ clave, valor }));

/** Pide al navegador que no borre estos datos si se queda sin espacio. */
export async function pedirAlmacenamientoPersistente() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch (e) {
    /* sin soporte */
  }
  return false;
}

const texto = (v, max) => String(v ?? "").slice(0, max);
const numeroONull = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Deja un cliente con la forma esperada (se usa al importar una copia de seguridad). */
export function limpiarCliente(x) {
  if (!x || typeof x !== "object" || typeof x.id !== "string" || !x.id) return null;
  const lat = numeroONull(x.lat);
  const lng = numeroONull(x.lng);
  const conPunto = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  return {
    id: texto(x.id, 80),
    nombre: texto(x.nombre, 120),
    direccion: texto(x.direccion, 200),
    referencia: texto(x.referencia, 200),
    telefono: texto(x.telefono, 40),
    notas: texto(x.notas, 500),
    lat: conPunto ? lat : null,
    lng: conPunto ? lng : null,
    creado: numeroONull(x.creado) ?? Date.now(),
  };
}

export async function exportarTodo() {
  return {
    app: "acqua-vita",
    version: 1,
    exportado: new Date().toISOString(),
    clientes: await todosLosClientes(),
    ajustes: await leerClave("ajustes", null),
    recorrido: await leerClave("recorrido", null),
  };
}

/** Valida y reemplaza TODO lo guardado por el contenido de una copia de seguridad. */
export async function importarTodo(datos) {
  if (!datos || datos.app !== "acqua-vita" || !Array.isArray(datos.clientes)) {
    throw new Error("El archivo no es una copia de seguridad de Acqua Vita.");
  }
  const clientes = datos.clientes.map(limpiarCliente).filter(Boolean);
  const aj = datos.ajustes && typeof datos.ajustes === "object" ? datos.ajustes : {};
  const depot = aj.depot && Number.isFinite(aj.depot.lat) && Number.isFinite(aj.depot.lng)
    ? { lat: aj.depot.lat, lng: aj.depot.lng }
    : null;
  const ajustes = {
    precio: Number.isFinite(aj.precio) && aj.precio >= 0 ? aj.precio : 0,
    wsp: texto(aj.wsp, 20).replace(/\D/g, ""),
    depot,
  };
  const recorrido = datos.recorrido && Array.isArray(datos.recorrido.stops) ? datos.recorrido : null;

  const db = await abrir();
  await new Promise((resolve, reject) => {
    const t = db.transaction(["clientes", "kv"], "readwrite");
    const c = t.objectStore("clientes");
    const k = t.objectStore("kv");
    c.clear();
    clientes.forEach((x) => c.put(x));
    k.put({ clave: "ajustes", valor: ajustes });
    k.put({ clave: "recorrido", valor: recorrido });
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  return { clientes: clientes.length };
}
