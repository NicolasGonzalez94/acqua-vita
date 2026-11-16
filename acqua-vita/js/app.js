// Acqua Vita - Reparto. Pantallas y lógica de la app.
import * as DB from "./db.js";
import * as Geo from "./geo.js";
import * as Res from "./summary.js";
import * as Mapa from "./map.js";

const $ = (id) => document.getElementById(id);

const state = {
  tab: "hoy",
  clients: [],
  settings: { precio: 4900, wsp: "", depot: null },
  route: null, // recorrido de hoy: { fecha, estado, cargados, stops: [...] }
  armando: false, // mostrando la pantalla "Nuevo recorrido"
  cargados: "",
  picked: new Set(),
  draft: null, // datos de la parada actual mientras se completan
  busquedaClientes: "",
  confirmar: null, // "cerrar" | "quitar:<indice>" | "importar"
  importPendiente: null,
  instalador: null,
  persistente: false,
};

// ---------- utilidades ----------

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const norm = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const nuevoId = () =>
  crypto.randomUUID ? crypto.randomUUID() : "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const hoyStr = () => new Date().toLocaleDateString("en-CA");
const clienteDe = (id) => state.clients.find((c) => c.id === id) || null;

let timerAviso = null;
function avisar(texto, esError = false) {
  const t = $("toast");
  t.textContent = texto;
  t.className = "toast visible" + (esError ? " error" : "");
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => (t.className = "toast"), 3500);
}

async function recargarClientes() {
  const lista = await DB.todosLosClientes();
  lista.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), "es"));
  state.clients = lista;
}
const guardarAjustes = () => DB.guardarClave("ajustes", state.settings);
const guardarRecorrido = () => DB.guardarClave("recorrido", state.route);

function stepper(valorInicial, alCambiar) {
  let valor = valorInicial;
  const salida = h("output", { class: "paso-valor", text: String(valor) });
  const cambiar = (d) => {
    const nuevo = Math.max(0, Math.min(999, valor + d));
    if (nuevo === valor) return;
    valor = nuevo;
    salida.textContent = String(valor);
    alCambiar(valor);
  };
  return h(
    "div",
    { class: "stepper" },
    h("button", { type: "button", class: "paso", "aria-label": "Uno menos", text: "−", onclick: () => cambiar(-1) }),
    salida,
    h("button", { type: "button", class: "paso", "aria-label": "Uno más", text: "+", onclick: () => cambiar(1) }),
  );
}

// ---------- pestañas ----------

function irA(tab) {
  state.tab = tab;
  state.confirmar = null;
  render();
  window.scrollTo({ top: 0 });
}

function render() {
  for (const t of ["hoy", "clientes", "ajustes"]) {
    $("tab-" + t).hidden = state.tab !== t;
    const b = document.querySelector(`.nav button[data-tab="${t}"]`);
    b.setAttribute("aria-current", state.tab === t ? "page" : "false");
  }
  if (state.tab === "hoy") renderHoy();
  else if (state.tab === "clientes") renderClientes();
  else renderAjustes();
}

// ---------- HOY ----------

function renderHoy() {
  const raiz = $("tab-hoy");
  raiz.textContent = "";
  const r = state.route;
  if (state.armando || !r) raiz.append(vistaNuevo());
  else if (r.estado === "cerrado") raiz.append(vistaResumen());
  else raiz.append(vistaCurso());
}

function vistaNuevo() {
  const caja = h("div", { class: "vista" });
  caja.append(h("h2", { text: "Nuevo recorrido" }));
  if (!state.clients.length) {
    caja.append(
      h("div", { class: "vacio" }, h("strong", { text: "Todavía no cargaste clientes" }),
        "Primero cargá los clientes y después armás el recorrido."),
      h("button", { class: "primario", type: "button", text: "Ir a Clientes", onclick: () => irA("clientes") }),
    );
    return caja;
  }
  if (!state.settings.depot) {
    caja.append(
      h("p", { class: "aviso" },
        "Todavía no cargaste el depósito. Hacelo en Ajustes para que el recorrido salga y vuelva de ahí."),
    );
  }
  const inCargados = h("input", {
    id: "in-cargados", type: "number", inputmode: "numeric", min: "0", max: "999",
    placeholder: "Ej: 40", value: state.cargados,
    oninput: (e) => (state.cargados = e.target.value),
  });
  caja.append(h("label", { for: "in-cargados" }, "Bidones que cargué en el camión", inCargados));

  const contador = h("p", { class: "cuenta" });
  const boton = h("button", { class: "primario grande", type: "button", onclick: armarRecorrido });
  const buscar = h("input", {
    type: "search", id: "buscar-nuevo", placeholder: "Buscar cliente", autocomplete: "off",
    "aria-label": "Buscar cliente", value: "", oninput: () => pintarLista(),
  });
  const lista = h("div", { class: "lista-sel" });

  function actualizarBoton() {
    const n = state.picked.size;
    contador.textContent = n ? `${n} ${n === 1 ? "cliente elegido" : "clientes elegidos"}` : "Elegí los clientes de hoy";
    boton.textContent = n ? `Armar recorrido (${n})` : "Armar recorrido";
    boton.disabled = n === 0;
  }
  function pintarLista() {
    const q = norm(buscar.value.trim());
    lista.textContent = "";
    const visibles = state.clients.filter(
      (c) => !q || norm([c.nombre, c.direccion, c.referencia].join(" ")).includes(q),
    );
    if (!visibles.length) lista.append(h("p", { class: "vacio", text: "No hay resultados." }));
    for (const c of visibles) {
      const marca = h("input", { type: "checkbox", id: "sel-" + c.id, checked: state.picked.has(c.id) });
      marca.addEventListener("change", () => {
        if (marca.checked) state.picked.add(c.id);
        else state.picked.delete(c.id);
        actualizarBoton();
      });
      lista.append(
        h("label", { class: "fila-sel", for: "sel-" + c.id }, marca,
          h("span", { class: "fila-texto" },
            h("strong", { text: c.nombre }),
            h("small", { text: c.direccion || "Solo punto en el mapa" }),
            Geo.tienePunto(c) ? null : h("span", { class: "tag aviso-tag", text: "Sin punto en el mapa" }),
          )),
      );
    }
  }
  const todos = h("button", {
    type: "button", class: "secundario", text: "Elegir todos",
    onclick: () => {
      state.clients.forEach((c) => state.picked.add(c.id));
      pintarLista();
      actualizarBoton();
    },
  });
  const ninguno = h("button", {
    type: "button", class: "secundario", text: "Quitar todos",
    onclick: () => {
      state.picked.clear();
      pintarLista();
      actualizarBoton();
    },
  });
  caja.append(buscar, h("div", { class: "fila-botones" }, todos, ninguno), lista, contador, boton);
  if (state.route) {
    caja.append(h("button", { class: "texto", type: "button", text: "Volver al recorrido anterior",
      onclick: () => { state.armando = false; render(); } }));
  }
  pintarLista();
  actualizarBoton();
  return caja;
}

async function armarRecorrido() {
  const ids = [...state.picked].filter((id) => clienteDe(id));
  if (!ids.length) return;
  const cs = ids.map(clienteDe);
  const conPunto = cs.filter(Geo.tienePunto);
  const sinPunto = cs.filter((c) => !Geo.tienePunto(c));
  let inicio = state.settings.depot;
  if (!inicio && conPunto.length) {
    try {
      inicio = await Geo.ubicacionActual(8000);
    } catch (e) {
      inicio = null;
    }
  }
  const orden = Geo.ordenar(conPunto.map((c) => ({ id: c.id, lat: c.lat, lng: c.lng })), inicio, state.settings.depot);
  const idsOrdenados = [...orden.map((p) => p.id), ...sinPunto.map((c) => c.id)];
  state.route = {
    fecha: hoyStr(),
    creado: Date.now(),
    estado: "en_curso",
    cargados: Math.max(0, parseInt(state.cargados, 10) || 0),
    stops: idsOrdenados.map((cid) => nuevaParada(cid, false)),
  };
  state.armando = false;
  state.picked = new Set();
  state.cargados = "";
  state.draft = null;
  await guardarRecorrido();
  render();
  window.scrollTo({ top: 0 });
  if (sinPunto.length) {
    avisar(`${sinPunto.length} sin punto en el mapa: quedaron al final del recorrido.`);
  }
}

function nuevaParada(cid, extra) {
  return { cid, hecho: false, dejados: 0, vacios: 0, pago: null, precio: null, extra, nombre: "", direccion: "", ts: null };
}

const indicesPendientes = (r) => r.stops.map((s, i) => (s.hecho ? -1 : i)).filter((i) => i >= 0);

function vistaCurso() {
  const r = state.route;
  const t = Res.totales(r);
  const pend = indicesPendientes(r);
  const caja = h("div", { class: "vista" });

  const total = r.stops.length;
  caja.append(
    h("div", { class: "progreso" },
      h("div", { class: "progreso-texto" },
        h("strong", { text: pend.length ? `Parada ${t.visitados + 1} de ${total}` : "Recorrido completo" }),
        h("span", { text: Res.fechaLarga(r) })),
      h("progress", { max: String(total), value: String(t.visitados), "aria-label": "Avance del recorrido" })),
    h("div", { class: "chips" },
      chip("Dejé", t.dejados), chip("Vacíos", t.vacios),
      chip("Efectivo", Res.formatoPesos(t.efectivo)), chip("Transf.", Res.formatoPesos(t.transferencia))),
  );

  if (!pend.length) {
    caja.append(h("div", { class: "tarjeta ok" }, h("strong", { text: "Terminaste todas las paradas." }),
      h("p", { text: "Si te falta pasar por alguien más, agregalo abajo. Si no, cerrá el recorrido." })));
  } else {
    caja.append(tarjetaActual(r, pend[0]));
  }

  if (pend.length > 1) {
    caja.append(h("h3", { text: "Siguientes paradas" }));
    const ul = h("ul", { class: "paradas" });
    pend.slice(1).forEach((idx, k) => ul.append(filaPendiente(r, idx, k + 2, pend)));
    caja.append(ul);
  }

  const hechas = r.stops.filter((s) => s.hecho);
  if (hechas.length) {
    const det = h("details", { class: "hechas" }, h("summary", { text: `Ya entregadas (${hechas.length})` }));
    r.stops.forEach((s, i) => {
      if (!s.hecho) return;
      const c = clienteDe(s.cid);
      const pago = s.dejados > 0 ? `${Res.ETIQUETA_PAGO[s.pago] || "Sin dato"} ${Res.formatoPesos(Res.montoParada(s))}` : "Sin cobro";
      det.append(
        h("div", { class: "fila-hecha" },
          h("div", {},
            h("strong", { text: s.nombre || (c && c.nombre) || "Cliente eliminado" }),
            h("small", { text: `Dejé ${s.dejados} · Vacíos ${s.vacios} · ${pago}` })),
          h("button", { type: "button", class: "secundario chico", text: "Corregir", onclick: () => corregirParada(i) })),
      );
    });
    caja.append(det);
  }

  const acciones = h("div", { class: "acciones-curso" });
  acciones.append(
    h("button", { type: "button", class: "secundario", text: "Agregar un cliente al recorrido", onclick: abrirAgregar }),
  );
  if (pend.length > 1) {
    acciones.append(
      h("button", { type: "button", class: "secundario", text: "Reordenar lo que falta (desde donde estoy)", onclick: async () => {
        await reordenarPendientes();
        await guardarRecorrido();
        render();
        avisar("Recorrido reordenado.");
      } }),
    );
  }
  if (pend.length) {
    const url = Geo.urlRutaCompleta(pend.map((i) => clienteDe(r.stops[i].cid)).filter(Boolean));
    if (url) acciones.append(h("a", { class: "btn secundario", href: url, target: "_blank", rel: "noopener", text: "Ver todo lo que falta en Google Maps" }));
  }
  if (state.confirmar === "cerrar") {
    acciones.append(
      h("div", { class: "confirmar" },
        h("p", { text: pend.length ? `Quedan ${pend.length} paradas sin visitar. ¿Cerrar el recorrido igual?` : "¿Cerrar el recorrido y armar el resumen?" }),
        h("div", { class: "fila-botones" },
          h("button", { type: "button", class: "primario", text: "Sí, cerrar", onclick: cerrarRecorrido }),
          h("button", { type: "button", class: "secundario", text: "No", onclick: () => { state.confirmar = null; render(); } }))),
    );
  } else {
    acciones.append(h("button", { type: "button", class: "primario grande", text: "Cerrar recorrido",
      onclick: () => { state.confirmar = "cerrar"; render(); } }));
  }
  caja.append(acciones);
  return caja;
}

const chip = (titulo, valor) =>
  h("div", { class: "chip" }, h("small", { text: titulo }), h("strong", { text: String(valor) }));

function tarjetaActual(r, idx) {
  const s = r.stops[idx];
  const c = clienteDe(s.cid);
  if (!state.draft || state.draft.idx !== idx || state.draft.cid !== s.cid) {
    state.draft = { idx, cid: s.cid, dejados: s.dejados || 0, vacios: s.vacios || 0, pago: s.pago || null };
  }
  const d = state.draft;
  const precio = state.settings.precio || 0;

  const nombre = c ? c.nombre : "Cliente eliminado";
  const tarjeta = h("div", { class: "tarjeta actual" });
  tarjeta.append(...[
    h("div", { class: "etiquetas" },
      h("span", { class: "tag", text: "Ahora" }),
      s.extra ? h("span", { class: "tag extra", text: "Agregado en el camino" }) : null,
      c && !Geo.tienePunto(c) ? h("span", { class: "tag aviso-tag", text: "Sin punto en el mapa" }) : null),
    h("h2", { text: nombre }),
    c && c.direccion ? h("p", { class: "dir", text: c.direccion }) : null,
    c && c.referencia ? h("p", { class: "ref" }, h("b", { text: "Queda cerca de: " }), c.referencia) : null,
    c && c.notas ? h("p", { class: "ref" }, h("b", { text: "Notas: " }), c.notas) : null,
    c && c.telefono ? h("p", { class: "ref" }, h("b", { text: "Tel: " }), h("a", { href: "tel:" + c.telefono.replace(/[^\d+]/g, ""), text: c.telefono })) : null,
  ].filter(Boolean));
  if (c) {
    tarjeta.append(h("a", { class: "btn primario grande", href: Geo.urlComoLlegar(c), target: "_blank", rel: "noopener", text: "Ir con Google Maps" }));
  }

  const total = h("p", { class: "total" });
  const error = h("p", { class: "msg err", role: "alert", hidden: true });
  const botones = h("div", { class: "pagos", role: "group", "aria-label": "Cómo pagó" });
  const opciones = [["efectivo", "Efectivo"], ["transferencia", "Transferencia"], ["no_pago", "No pagó"]];
  function pintarTotal() {
    const monto = d.dejados * precio;
    total.textContent = d.dejados > 0
      ? `Total: ${Res.formatoPesos(monto)} (${d.dejados} × ${Res.formatoPesos(precio)})`
      : "Sin bidones dejados: no hay cobro.";
    if (d.dejados > 0 && !precio) total.textContent += " Cargá el precio en Ajustes.";
    botones.hidden = d.dejados === 0;
    error.hidden = true;
  }
  for (const [valor, texto] of opciones) {
    const b = h("button", { type: "button", class: "segmento", text: texto, "aria-pressed": String(d.pago === valor) });
    b.addEventListener("click", () => {
      d.pago = valor;
      botones.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      error.hidden = true;
    });
    botones.append(b);
  }
  tarjeta.append(
    h("div", { class: "campo-paso" }, h("span", { text: "Bidones que dejé" }), stepper(d.dejados, (v) => { d.dejados = v; pintarTotal(); })),
    h("div", { class: "campo-paso" }, h("span", { text: "Vacíos que me dieron" }), stepper(d.vacios, (v) => { d.vacios = v; })),
    botones, total, error,
    h("button", { type: "button", class: "primario grande", text: "Entregado", onclick: async () => {
      if (d.dejados === 0 && d.vacios === 0) {
        error.textContent = "Poné cuántos bidones dejaste o cuántos vacíos te dieron.";
        error.hidden = false;
        return;
      }
      if (d.dejados > 0 && !d.pago) {
        error.textContent = "Elegí cómo pagó: efectivo, transferencia o no pagó.";
        error.hidden = false;
        return;
      }
      s.hecho = true;
      s.dejados = d.dejados;
      s.vacios = d.vacios;
      s.pago = d.dejados > 0 ? d.pago : null;
      s.precio = precio;
      s.nombre = nombre;
      s.direccion = c ? c.direccion : "";
      s.ts = Date.now();
      state.draft = null;
      await guardarRecorrido();
      render();
      window.scrollTo({ top: 0 });
      avisar(`Listo: ${nombre}`);
    } }),
  );
  pintarTotal();

  const sec = h("div", { class: "fila-botones" });
  if (indicesPendientes(r).length > 1) {
    sec.append(h("button", { type: "button", class: "secundario", text: "Dejar para después", onclick: async () => {
      const [parada] = r.stops.splice(idx, 1);
      const ultimaPend = Math.max(...indicesPendientes(r), idx - 1);
      r.stops.splice(ultimaPend + 1, 0, parada);
      state.draft = null;
      await guardarRecorrido();
      render();
    } }));
  }
  if (state.confirmar === "quitar:" + idx) {
    sec.append(
      h("button", { type: "button", class: "peligro", text: "Sí, quitar del recorrido", onclick: () => quitarParada(idx) }),
      h("button", { type: "button", class: "secundario", text: "No", onclick: () => { state.confirmar = null; render(); } }));
  } else {
    sec.append(h("button", { type: "button", class: "secundario", text: "Quitar del recorrido", onclick: () => { state.confirmar = "quitar:" + idx; render(); } }));
  }
  tarjeta.append(sec);
  return tarjeta;
}

function filaPendiente(r, idx, numero, pend) {
  const s = r.stops[idx];
  const c = clienteDe(s.cid);
  const k = pend.indexOf(idx);
  const mover = async (dest) => {
    const otro = pend[dest];
    [r.stops[idx], r.stops[otro]] = [r.stops[otro], r.stops[idx]];
    state.draft = null;
    await guardarRecorrido();
    render();
  };
  return h("li", { class: "parada" },
    h("span", { class: "num", text: String(numero) }),
    h("div", { class: "parada-texto" },
      h("strong", { text: c ? c.nombre : "Cliente eliminado" }),
      h("small", { text: (c && c.direccion) || "Solo punto en el mapa" }),
      s.extra ? h("span", { class: "tag extra", text: "Agregado en el camino" }) : null),
    h("div", { class: "parada-botones" },
      h("button", { type: "button", class: "icono", "aria-label": "Hacer esta parada ahora", text: "Ahora", onclick: async () => {
        const [p] = r.stops.splice(idx, 1);
        r.stops.splice(pend[0], 0, p);
        state.draft = null;
        await guardarRecorrido();
        render();
        window.scrollTo({ top: 0 });
      } }),
      h("button", { type: "button", class: "icono", "aria-label": "Subir", text: "↑", disabled: k <= 1, onclick: () => mover(k - 1) }),
      h("button", { type: "button", class: "icono", "aria-label": "Bajar", text: "↓", disabled: k >= pend.length - 1, onclick: () => mover(k + 1) }),
    ));
}

async function quitarParada(idx) {
  state.route.stops.splice(idx, 1);
  state.confirmar = null;
  state.draft = null;
  await guardarRecorrido();
  render();
}

async function corregirParada(idx) {
  const r = state.route;
  const pend = indicesPendientes(r);
  const [p] = r.stops.splice(idx, 1);
  p.hecho = false;
  const destino = pend.length ? Math.min(...pend.map((i) => (i > idx ? i - 1 : i))) : r.stops.length;
  r.stops.splice(destino, 0, p);
  state.draft = null;
  await guardarRecorrido();
  render();
  window.scrollTo({ top: 0 });
  avisar("Corregí los datos y tocá Entregado.");
}

async function reordenarPendientes() {
  const r = state.route;
  const idxs = indicesPendientes(r);
  const pend = idxs.map((i) => r.stops[i]);
  const conPunto = pend.filter((s) => Geo.tienePunto(clienteDe(s.cid)));
  const sinPunto = pend.filter((s) => !Geo.tienePunto(clienteDe(s.cid)));
  let inicio = null;
  try {
    inicio = await Geo.ubicacionActual(8000);
  } catch (e) {
    const ultima = [...r.stops].reverse().find((s) => s.hecho && Geo.tienePunto(clienteDe(s.cid)));
    inicio = ultima ? clienteDe(ultima.cid) : state.settings.depot;
    avisar("Sin GPS: ordené desde la última parada o el depósito.");
  }
  const puntos = conPunto.map((s) => {
    const c = clienteDe(s.cid);
    return { id: s.cid, lat: c.lat, lng: c.lng, stop: s };
  });
  const orden = Geo.ordenar(puntos, inicio ? { lat: inicio.lat, lng: inicio.lng } : null, state.settings.depot);
  const nuevo = [...orden.map((p) => p.stop), ...sinPunto];
  idxs.forEach((pos, k) => (r.stops[pos] = nuevo[k]));
  state.draft = null;
}

async function agregarAlRecorrido(cid) {
  const r = state.route;
  if (!r || r.estado !== "en_curso") return;
  const c = clienteDe(cid);
  if (!c) return;
  if (r.stops.some((s) => !s.hecho && s.cid === cid)) {
    avisar("Ese cliente ya está en el recorrido.");
    return;
  }
  const parada = nuevaParada(cid, true);
  const pend = indicesPendientes(r);
  const pendConPunto = pend.filter((i) => Geo.tienePunto(clienteDe(r.stops[i].cid)));
  if (!Geo.tienePunto(c) || !pend.length) {
    r.stops.push(parada);
  } else {
    const ultima = [...r.stops].reverse().find((s) => s.hecho && Geo.tienePunto(clienteDe(s.cid)));
    const inicio = ultima ? clienteDe(ultima.cid) : state.settings.depot;
    const puntos = pendConPunto.map((i) => clienteDe(r.stops[i].cid));
    const k = Geo.mejorPosicion(puntos, c, inicio, state.settings.depot);
    if (k >= pendConPunto.length) {
      const despues = pendConPunto.length ? pendConPunto[pendConPunto.length - 1] + 1 : r.stops.length;
      r.stops.splice(despues, 0, parada);
    } else {
      r.stops.splice(pendConPunto[k], 0, parada);
    }
  }
  state.draft = null;
  await guardarRecorrido();
  const lugar = indicesPendientes(r).findIndex((i) => r.stops[i] === parada) + 1;
  avisar(`${c.nombre} quedó en la parada ${lugar} de las que faltan.`);
}

async function cerrarRecorrido() {
  state.route.estado = "cerrado";
  state.route.cerrado = Date.now();
  state.confirmar = null;
  state.draft = null;
  await guardarRecorrido();
  render();
  window.scrollTo({ top: 0 });
}

function vistaResumen() {
  const r = state.route;
  const t = Res.totales(r);
  const texto = Res.armarTexto(r, state.clients);
  const caja = h("div", { class: "vista" });
  caja.append(h("h2", { text: "Recorrido cerrado" }), h("p", { class: "sub", text: Res.fechaLarga(r) }));
  caja.append(
    h("div", { class: "chips grandes" },
      chip("Salí con", t.cargados), chip("Dejé", t.dejados), chip("Vacíos", t.vacios), chip("Sobraron", t.sobrantes),
      chip("Efectivo", Res.formatoPesos(t.efectivo)), chip("Transferencias", Res.formatoPesos(t.transferencia)),
      chip("Sin pagar", Res.formatoPesos(t.sinPagar)), chip("Paradas", `${t.visitados}/${r.stops.length}`)),
  );
  caja.append(h("h3", { text: "Mensaje para tu jefe" }), h("pre", { class: "texto-resumen", text: texto }));

  const wsp = h("a", { class: "btn primario grande", href: Res.urlWhatsApp(texto, state.settings.wsp), target: "_blank", rel: "noopener", text: "Enviar por WhatsApp" });
  const copiar = h("button", { type: "button", class: "secundario", text: "Copiar texto", onclick: async () => {
    try {
      await navigator.clipboard.writeText(texto);
      avisar("Texto copiado.");
    } catch (e) {
      avisar("No se pudo copiar. Mantené apretado el texto para seleccionarlo.", true);
    }
  } });
  const pdf = h("button", { type: "button", class: "secundario", text: "Guardar como PDF", onclick: () => {
    armarImpresion(r);
    window.print();
  } });
  const botones = h("div", { class: "acciones-curso" }, wsp, h("div", { class: "fila-botones" }, copiar, pdf));
  if (navigator.share) {
    botones.append(h("button", { type: "button", class: "secundario", text: "Compartir con otra app", onclick: async () => {
      try { await navigator.share({ title: "Recorrido Acqua Vita", text: texto }); } catch (e) { /* canceló */ }
    } }));
  }
  if (!state.settings.wsp) {
    botones.append(h("p", { class: "hint", text: "Guardá el WhatsApp de tu jefe en Ajustes y el mensaje se abre directo en su chat." }));
  }
  caja.append(botones);
  caja.append(
    h("hr"),
    h("div", { class: "fila-botones" },
      h("button", { type: "button", class: "secundario", text: "Volver al recorrido", onclick: async () => {
        state.route.estado = "en_curso";
        await guardarRecorrido();
        render();
      } }),
      h("button", { type: "button", class: "secundario", text: "Nuevo recorrido", onclick: () => { state.armando = true; render(); } })),
    h("p", { class: "hint", text: "Al armar un recorrido nuevo se borra este resumen. Mandalo o copialo antes." }),
  );
  return caja;
}

function armarImpresion(r) {
  const t = Res.totales(r);
  const area = $("print-area");
  area.textContent = "";
  const filas = r.stops.filter((s) => s.hecho).map((s, i) => {
    const c = clienteDe(s.cid);
    return h("tr", {},
      h("td", { text: String(i + 1) }),
      h("td", { text: s.nombre || (c && c.nombre) || "Cliente eliminado" }),
      h("td", { text: s.direccion || (c && c.direccion) || "" }),
      h("td", { text: String(s.dejados) }),
      h("td", { text: String(s.vacios) }),
      h("td", { text: s.dejados > 0 ? Res.ETIQUETA_PAGO[s.pago] || "" : "" }),
      h("td", { text: s.dejados > 0 ? Res.formatoPesos(Res.montoParada(s)) : "" }));
  });
  area.append(
    h("h1", { text: "Acqua Vita - Recorrido" }),
    h("p", { text: Res.fechaLarga(r) }),
    h("p", { text: `Salí con ${t.cargados} · Dejé ${t.dejados} · Vacíos ${t.vacios} · Sobraron ${t.sobrantes}` }),
    h("p", { text: `Efectivo ${Res.formatoPesos(t.efectivo)} · Transferencias ${Res.formatoPesos(t.transferencia)} · Sin pagar ${Res.formatoPesos(t.sinPagar)}` }),
    h("table", {},
      h("thead", {}, h("tr", {}, ...["#", "Cliente", "Dirección", "Dejé", "Vacíos", "Pago", "Monto"].map((x) => h("th", { text: x })))),
      h("tbody", {}, filas)),
  );
}

// ---------- agregar cliente al recorrido (ventana) ----------

function abrirAgregar() {
  const dlg = $("dlg-agregar");
  dlg.textContent = "";
  const buscar = h("input", { type: "search", placeholder: "Buscar cliente", autocomplete: "off", "aria-label": "Buscar cliente", oninput: () => pintar() });
  const lista = h("div", { class: "lista-sel" });
  function pintar() {
    const q = norm(buscar.value.trim());
    lista.textContent = "";
    const visibles = state.clients.filter((c) => !q || norm([c.nombre, c.direccion, c.referencia].join(" ")).includes(q));
    if (!visibles.length) lista.append(h("p", { class: "vacio", text: "No hay resultados." }));
    for (const c of visibles) {
      const yaEsta = state.route.stops.some((s) => !s.hecho && s.cid === c.id);
      lista.append(h("button", { type: "button", class: "fila-sel boton-fila", disabled: yaEsta, onclick: async () => {
        dlg.close();
        await agregarAlRecorrido(c.id);
        render();
      } },
        h("span", { class: "fila-texto" },
          h("strong", { text: c.nombre }),
          h("small", { text: yaEsta ? "Ya está en el recorrido" : c.direccion || "Solo punto en el mapa" }))));
    }
  }
  dlg.append(
    h("div", { class: "dlg-cab" }, h("h2", { text: "Agregar al recorrido" }),
      h("button", { type: "button", class: "texto", text: "Cerrar", onclick: () => dlg.close() })),
    h("button", { type: "button", class: "primario", text: "Cliente nuevo", onclick: () => { dlg.close(); abrirCliente(null, { agregarARecorrido: true }); } }),
    buscar, lista,
  );
  pintar();
  dlg.showModal();
}

// ---------- CLIENTES ----------

function renderClientes() {
  const raiz = $("tab-clientes");
  raiz.textContent = "";
  const lista = h("ul", { class: "clientes" });
  const cuenta = h("p", { class: "cuenta" });
  const buscar = h("input", {
    type: "search", placeholder: "Buscar por nombre, calle o referencia", autocomplete: "off",
    "aria-label": "Buscar cliente", value: state.busquedaClientes,
    oninput: (e) => { state.busquedaClientes = e.target.value; pintar(); },
  });
  function pintar() {
    const q = norm(state.busquedaClientes.trim());
    lista.textContent = "";
    const visibles = state.clients.filter((c) => !q || norm([c.nombre, c.direccion, c.referencia, c.notas].join(" ")).includes(q));
    cuenta.textContent = state.clients.length
      ? q ? `${visibles.length} de ${state.clients.length} clientes` : `${state.clients.length} ${state.clients.length === 1 ? "cliente" : "clientes"}`
      : "";
    if (!visibles.length) {
      lista.append(h("li", { class: "vacio" },
        h("strong", { text: state.clients.length ? "No hay resultados" : "Todavía no hay clientes cargados" }),
        state.clients.length ? "Probá con otra parte del nombre o de la calle." : "Tocá “Nuevo cliente” para cargar el primero."));
    }
    for (const c of visibles) {
      lista.append(h("li", { class: "tarjeta" },
        h("div", { class: "etiquetas" },
          Geo.tienePunto(c) ? h("span", { class: "tag ok-tag", text: "Con punto en el mapa" }) : h("span", { class: "tag aviso-tag", text: "Sin punto en el mapa" })),
        h("h3", { text: c.nombre }),
        c.direccion ? h("p", { class: "dir", text: c.direccion }) : null,
        c.referencia ? h("p", { class: "ref" }, h("b", { text: "Queda cerca de: " }), c.referencia) : null,
        c.telefono ? h("p", { class: "ref" }, h("b", { text: "Tel: " }), c.telefono) : null,
        c.notas ? h("p", { class: "ref" }, h("b", { text: "Notas: " }), c.notas) : null,
        h("div", { class: "fila-botones" },
          h("a", { class: "btn primario", href: Geo.urlComoLlegar(c), target: "_blank", rel: "noopener", text: "Cómo llegar" }),
          h("button", { type: "button", class: "secundario", text: "Editar", onclick: () => abrirCliente(c) }))));
    }
  }
  raiz.append(h("div", { class: "vista" },
    h("div", { class: "barra" }, buscar, h("button", { type: "button", class: "primario", text: "Nuevo cliente", onclick: () => abrirCliente(null) })),
    cuenta, lista));
  pintar();
}

function abrirCliente(cliente, opciones = {}) {
  const dlg = $("dlg-cliente");
  dlg.textContent = "";
  let punto = cliente && Geo.tienePunto(cliente) ? { lat: cliente.lat, lng: cliente.lng } : null;
  let precision = null;

  const campo = (id, etiqueta, props, ayuda) =>
    h("label", { for: id }, etiqueta, ayuda ? h("small", { text: ayuda }) : null, h("input", { id, autocomplete: "off", ...props }));
  const nombre = campo("c-nombre", "Nombre", { required: true, maxlength: "120", value: cliente ? cliente.nombre : "", placeholder: "Pepito Gómez" });
  const direccion = campo("c-dir", "Dirección", { maxlength: "200", value: cliente ? cliente.direccion : "", placeholder: "Calle 12 n° 450" }, "Si la casa no tiene número, dejala en blanco y marcá el punto en el mapa");
  const referencia = campo("c-ref", "Queda cerca de", { maxlength: "200", value: cliente ? cliente.referencia : "", placeholder: "Cerca de lo de Menganito, reja verde" });
  const telefono = campo("c-tel", "Teléfono (opcional)", { type: "tel", maxlength: "40", value: cliente ? cliente.telefono : "" });
  const notas = h("label", { for: "c-notas" }, "Notas (opcional)",
    h("textarea", { id: "c-notas", rows: "2", maxlength: "500", placeholder: "Timbre roto, llamar antes, perro" }, cliente ? cliente.notas : ""));

  const estado = h("p", { class: "estado-punto", "aria-live": "polite" });
  const msgPunto = h("p", { class: "msg err", role: "alert", hidden: true });
  const verEnMapa = h("a", { class: "btn secundario", target: "_blank", rel: "noopener", text: "Probar en Google Maps" });
  const quitar = h("button", { type: "button", class: "secundario", text: "Quitar punto", onclick: () => { punto = null; precision = null; pintarPunto(); } });
  function pintarPunto() {
    estado.textContent = punto
      ? `Punto guardado: ${punto.lat.toFixed(5)}, ${punto.lng.toFixed(5)}` + (precision ? ` · precisión ±${Math.round(precision)} m` : "")
      : "Todavía no tiene punto en el mapa.";
    quitar.hidden = !punto;
    verEnMapa.hidden = !punto;
    if (punto) verEnMapa.setAttribute("href", Geo.urlVerEnMapa({ ...punto, direccion: "" }));
    msgPunto.hidden = true;
  }
  const botonGps = h("button", { type: "button", class: "secundario", text: "Guardar mi ubicación aquí", onclick: async () => {
    botonGps.disabled = true;
    botonGps.textContent = "Buscando GPS…";
    try {
      const p = await Geo.ubicacionActual(15000);
      punto = { lat: p.lat, lng: p.lng };
      precision = p.precision;
      pintarPunto();
      if (p.precision > 40) {
        msgPunto.textContent = `El GPS tiene una precisión de ±${Math.round(p.precision)} m. Esperá unos segundos y volvé a tocar para mejorarla.`;
        msgPunto.hidden = false;
      }
    } catch (e) {
      msgPunto.textContent = e.message;
      msgPunto.hidden = false;
    }
    botonGps.disabled = false;
    botonGps.textContent = "Guardar mi ubicación aquí";
  } });
  const botonMapa = h("button", { type: "button", class: "secundario", text: "Marcar en el mapa", onclick: async () => {
    const elegido = await elegirEnMapa(punto || state.settings.depot, cliente ? cliente.id : null);
    if (elegido) { punto = elegido; precision = null; pintarPunto(); }
  } });
  const coords = h("input", { id: "c-coords", placeholder: "-37.03333, -61.93333", autocomplete: "off", inputmode: "text", "aria-label": "Pegar coordenadas" });
  const usarCoords = h("button", { type: "button", class: "secundario", text: "Usar", onclick: () => {
    const p = Geo.leerCoordenadas(coords.value);
    if (!p) {
      msgPunto.textContent = "No entendí las coordenadas. Copialas desde Google Maps: dos números separados por coma.";
      msgPunto.hidden = false;
      return;
    }
    punto = p;
    precision = null;
    coords.value = "";
    pintarPunto();
  } });

  const msg = h("p", { class: "msg err", role: "alert", hidden: true });
  const form = h("form", { class: "form" },
    nombre, direccion, referencia, telefono, notas,
    h("fieldset", {},
      h("legend", { text: "Ubicación exacta" }),
      h("p", { class: "hint", text: "Lo más preciso: ir a la puerta de la casa y tocar “Guardar mi ubicación aquí”." }),
      estado, msgPunto,
      h("div", { class: "fila-botones" }, botonGps, botonMapa),
      h("label", { for: "c-coords" }, "O pegá coordenadas de Google Maps", h("div", { class: "fila-input" }, coords, usarCoords)),
      h("div", { class: "fila-botones" }, verEnMapa, quitar)),
    msg,
    h("div", { class: "fila-botones" },
      h("button", { type: "submit", class: "primario", text: "Guardar" }),
      h("button", { type: "button", class: "secundario", text: "Cancelar", onclick: () => dlg.close() })),
  );
  if (cliente) {
    const zona = h("div", { class: "zona-borrar" });
    const mostrarBorrar = () => {
      zona.textContent = "";
      zona.append(h("button", { type: "button", class: "peligro-suave", text: "Eliminar cliente", onclick: () => {
        zona.textContent = "";
        zona.append(
          h("p", { text: "¿Eliminar este cliente? No se puede deshacer." }),
          h("div", { class: "fila-botones" },
            h("button", { type: "button", class: "peligro", text: "Sí, eliminar", onclick: async () => {
              await DB.borrarCliente(cliente.id);
              if (state.route) {
                state.route.stops = state.route.stops.filter((s) => s.hecho || s.cid !== cliente.id);
                await guardarRecorrido();
              }
              await recargarClientes();
              dlg.close();
              render();
              avisar("Cliente eliminado.");
            } }),
            h("button", { type: "button", class: "secundario", text: "No", onclick: mostrarBorrar })));
      } }));
    };
    mostrarBorrar();
    form.append(zona);
  }
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const n = nombre.querySelector("input").value.trim();
    const d = direccion.querySelector("input").value.trim();
    if (!n) { msg.textContent = "Poné el nombre del cliente."; msg.hidden = false; return; }
    if (!d && !punto) { msg.textContent = "Poné la dirección o marcá el punto en el mapa."; msg.hidden = false; return; }
    const c = {
      id: cliente ? cliente.id : nuevoId(),
      nombre: n,
      direccion: d,
      referencia: referencia.querySelector("input").value.trim(),
      telefono: telefono.querySelector("input").value.trim(),
      notas: notas.querySelector("textarea").value.trim(),
      lat: punto ? punto.lat : null,
      lng: punto ? punto.lng : null,
      creado: cliente ? cliente.creado : Date.now(),
    };
    try {
      await DB.guardarCliente(c);
    } catch (err) {
      msg.textContent = "No se pudo guardar en el celular. Revisá que haya espacio libre.";
      msg.hidden = false;
      return;
    }
    await recargarClientes();
    dlg.close();
    if (opciones.agregarARecorrido) await agregarAlRecorrido(c.id);
    render();
  });

  dlg.append(h("div", { class: "dlg-cab" }, h("h2", { text: cliente ? "Editar cliente" : "Nuevo cliente" })), form);
  pintarPunto();
  dlg.showModal();
}

// ---------- mapa (ventana) ----------

function elegirEnMapa(inicial, excluirId) {
  return new Promise((resolve) => {
    const dlg = $("dlg-mapa");
    dlg.textContent = "";
    let resultado = null;
    const contenedor = h("div", { id: "mapa", class: "mapa" });
    const mira = h("div", { class: "mira", "aria-hidden": "true" });
    const botonCapa = h("button", { type: "button", class: "secundario", text: "Ver satélite", onclick: () => {
      botonCapa.textContent = Mapa.cambiarCapa() === "satelite" ? "Ver calles" : "Ver satélite";
    } });
    const botonGps = h("button", { type: "button", class: "secundario", text: "Mi ubicación", onclick: async () => {
      try {
        const p = await Geo.ubicacionActual(15000);
        Mapa.irA(p, 19);
      } catch (e) { avisar(e.message, true); }
    } });
    dlg.append(
      h("div", { class: "dlg-cab" }, h("h2", { text: "Marcar la casa" }),
        h("button", { type: "button", class: "texto", text: "Cancelar", onclick: () => dlg.close() })),
      h("p", { class: "hint", text: "Movés el mapa con el dedo hasta dejar la casa justo debajo de la cruz. El satélite ayuda a reconocer los techos." }),
      h("div", { class: "mapa-wrap" }, contenedor, mira),
      h("div", { class: "fila-botones mapa-botones" }, botonGps, botonCapa,
        h("button", { type: "button", class: "primario", text: "Usar este punto", onclick: () => {
          resultado = Mapa.centroActual();
          dlg.close();
        } })),
    );
    dlg.addEventListener("close", () => { Mapa.cerrarMapa(); resolve(resultado); }, { once: true });
    dlg.showModal();
    Mapa.mostrarMapa(contenedor, { inicial, otros: state.clients.filter((c) => c.id !== excluirId) }).catch((err) => {
      contenedor.replaceChildren(h("p", { class: "msg err cuerpo", text: err.message + " Podés usar “Guardar mi ubicación aquí” o pegar coordenadas." }));
      mira.hidden = true;
    });
  });
}

// ---------- AJUSTES ----------

function renderAjustes() {
  const raiz = $("tab-ajustes");
  raiz.textContent = "";
  const caja = h("div", { class: "vista" });
  caja.append(h("h2", { text: "Ajustes" }));

  const precio = h("input", { id: "aj-precio", type: "number", inputmode: "numeric", min: "0", step: "50", value: String(state.settings.precio || "") });
  const estadoPrecio = h("small", { class: "ok-texto", text: "" });
  precio.addEventListener("change", async () => {
    const v = Math.max(0, Math.round(Number(precio.value) || 0));
    state.settings.precio = v;
    precio.value = String(v);
    await guardarAjustes();
    estadoPrecio.textContent = `Guardado: ${Res.formatoPesos(v)} por bidón`;
  });
  caja.append(h("section", { class: "bloque" },
    h("h3", { text: "Precio del bidón" }),
    h("label", { for: "aj-precio" }, "Pesos por bidón", precio, estadoPrecio),
    h("p", { class: "hint", text: "Se usa para calcular cada cobro. Si lo cambiás, los recorridos nuevos usan el precio nuevo y los ya entregados conservan el que tenían." })));

  const wsp = h("input", { id: "aj-wsp", type: "tel", inputmode: "numeric", placeholder: "5492926123456", value: state.settings.wsp || "" });
  const estadoWsp = h("small", { class: "ok-texto", text: "" });
  wsp.addEventListener("change", async () => {
    const limpio = wsp.value.replace(/\D/g, "");
    if (limpio && (limpio.length < 10 || limpio.length > 15)) {
      estadoWsp.textContent = "Ese número parece incompleto.";
      estadoWsp.className = "err-texto";
      return;
    }
    state.settings.wsp = limpio;
    wsp.value = limpio;
    await guardarAjustes();
    estadoWsp.className = "ok-texto";
    estadoWsp.textContent = limpio ? "Guardado" : "Sin número: se abre WhatsApp para elegir el contacto";
  });
  caja.append(h("section", { class: "bloque" },
    h("h3", { text: "WhatsApp de tu jefe" }),
    h("label", { for: "aj-wsp" }, "Número con código de país", wsp, estadoWsp),
    h("p", { class: "hint", text: "Formato para Argentina: 54 9 + código de área sin 0 + número sin 15. Todo junto, sin espacios." })));

  const estadoDepot = h("p", { class: "estado-punto", "aria-live": "polite" });
  const msgDepot = h("p", { class: "msg err", role: "alert", hidden: true });
  const quitarDepot = h("button", { type: "button", class: "secundario", text: "Quitar depósito", onclick: async () => { state.settings.depot = null; await guardarAjustes(); pintarDepot(); } });
  function pintarDepot() {
    const d = state.settings.depot;
    estadoDepot.textContent = d ? `Depósito guardado: ${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}` : "Todavía no cargaste el depósito.";
    quitarDepot.hidden = !d;
    msgDepot.hidden = true;
  }
  caja.append(h("section", { class: "bloque" },
    h("h3", { text: "Depósito (salida y vuelta)" }),
    estadoDepot, msgDepot,
    h("div", { class: "fila-botones" },
      h("button", { type: "button", class: "secundario", text: "Estoy en el depósito", onclick: async () => {
        try {
          const p = await Geo.ubicacionActual(15000);
          state.settings.depot = { lat: p.lat, lng: p.lng };
          await guardarAjustes();
          pintarDepot();
        } catch (e) { msgDepot.textContent = e.message; msgDepot.hidden = false; }
      } }),
      h("button", { type: "button", class: "secundario", text: "Marcar en el mapa", onclick: async () => {
        const p = await elegirEnMapa(state.settings.depot, null);
        if (p) { state.settings.depot = p; await guardarAjustes(); pintarDepot(); }
      } }),
      quitarDepot)));
  pintarDepot();

  // copia de seguridad
  const msgBackup = h("p", { class: "msg", role: "status", hidden: true });
  const archivo = h("input", { type: "file", id: "aj-archivo", accept: "application/json,.json", class: "oculto" });
  archivo.addEventListener("change", async () => {
    const f = archivo.files && archivo.files[0];
    archivo.value = "";
    if (!f) return;
    try {
      if (f.size > 20 * 1024 * 1024) throw new Error("El archivo es demasiado grande.");
      state.importPendiente = JSON.parse(await f.text());
      if (!state.importPendiente || state.importPendiente.app !== "acqua-vita") throw new Error("El archivo no es una copia de seguridad de Acqua Vita.");
      state.confirmar = "importar";
      render();
    } catch (e) {
      msgBackup.textContent = e instanceof SyntaxError ? "El archivo no se pudo leer." : e.message;
      msgBackup.className = "msg err";
      msgBackup.hidden = false;
    }
  });
  const bloqueBackup = h("section", { class: "bloque" },
    h("h3", { text: "Copia de seguridad" }),
    h("p", { class: "hint", text: "Tus datos están solo en este celular. Si se rompe, lo perdés o borrás los datos del navegador, se pierden. Guardá una copia de vez en cuando (por ejemplo, mandátela por WhatsApp o a Drive)." }),
    msgBackup,
    h("div", { class: "fila-botones" },
      h("button", { type: "button", class: "secundario", text: "Guardar copia", onclick: exportar }),
      h("label", { class: "btn secundario", for: "aj-archivo", text: "Restaurar copia" }), archivo));
  if (state.confirmar === "importar" && state.importPendiente) {
    const n = Array.isArray(state.importPendiente.clientes) ? state.importPendiente.clientes.length : 0;
    bloqueBackup.append(h("div", { class: "confirmar" },
      h("p", { text: `Esto reemplaza TODO lo que tenés ahora por la copia (${n} clientes). ¿Seguro?` }),
      h("div", { class: "fila-botones" },
        h("button", { type: "button", class: "peligro", text: "Sí, restaurar", onclick: async () => {
          try {
            const r = await DB.importarTodo(state.importPendiente);
            state.importPendiente = null;
            state.confirmar = null;
            await cargarTodo();
            render();
            avisar(`Copia restaurada: ${r.clientes} clientes.`);
          } catch (e) {
            state.confirmar = null;
            state.importPendiente = null;
            render();
            avisar(e.message, true);
          }
        } }),
        h("button", { type: "button", class: "secundario", text: "No", onclick: () => { state.confirmar = null; state.importPendiente = null; render(); } }))));
  }
  caja.append(bloqueBackup);

  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const bloqueApp = h("section", { class: "bloque" }, h("h3", { text: "La app en tu celular" }));
  if (standalone) {
    bloqueApp.append(h("p", { class: "hint", text: "Ya estás usando la app instalada." }));
  } else {
    if (state.instalador) {
      bloqueApp.append(h("button", { type: "button", class: "primario", text: "Instalar la app", onclick: async () => {
        state.instalador.prompt();
        await state.instalador.userChoice;
        state.instalador = null;
        render();
      } }));
    }
    bloqueApp.append(h("p", { class: "hint", text: "Si no ves el botón, abrí el menú del navegador (los tres puntos) y tocá “Instalar app” o “Agregar a la pantalla principal”." }));
  }
  bloqueApp.append(h("p", { class: "hint", text: state.persistente
    ? "Protección de datos: el navegador no borrará tus datos por falta de espacio."
    : "Protección de datos: el navegador puede borrar los datos si el celular se queda sin espacio. Instalá la app y hacé copias de seguridad." }));
  caja.append(bloqueApp);
  raiz.append(caja);
}

async function exportar() {
  const datos = await DB.exportarTodo();
  const blob = new Blob([JSON.stringify(datos, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `acqua-vita-copia-${hoyStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  avisar("Copia guardada en tus descargas.");
}

// ---------- arranque ----------

async function cargarTodo() {
  await recargarClientes();
  const aj = await DB.leerClave("ajustes", null);
  state.settings = {
    precio: aj && Number.isFinite(aj.precio) ? aj.precio : 4900,
    wsp: aj && typeof aj.wsp === "string" ? aj.wsp : "",
    depot: aj && aj.depot && Number.isFinite(aj.depot.lat) ? aj.depot : null,
  };
  if (!aj) await guardarAjustes();
  state.route = await DB.leerClave("recorrido", null);
  state.draft = null;
}

function actualizarRed() {
  const el = $("red");
  el.textContent = navigator.onLine ? "" : "Sin internet";
  el.hidden = navigator.onLine;
}

async function iniciar() {
  document.querySelectorAll(".nav button").forEach((b) => b.addEventListener("click", () => irA(b.dataset.tab)));
  window.addEventListener("online", actualizarRed);
  window.addEventListener("offline", actualizarRed);
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    state.instalador = e;
    if (state.tab === "ajustes") render();
  });
  window.addEventListener("appinstalled", () => { state.instalador = null; });
  actualizarRed();
  try {
    await cargarTodo();
    state.persistente = await DB.pedirAlmacenamientoPersistente();
  } catch (e) {
    $("tab-hoy").textContent = "No se pudo abrir el almacenamiento del celular. Probá en una ventana normal (no privada).";
    return;
  }
  render();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
  }
}

iniciar();
