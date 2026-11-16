// Totales del recorrido y armado del mensaje para WhatsApp / PDF.

const pesos = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});
export const formatoPesos = (n) => pesos.format(n || 0);

export const ETIQUETA_PAGO = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  no_pago: "No pagó",
};

export function montoParada(s) {
  return (s.dejados || 0) * (s.precio || 0);
}

export function totales(recorrido) {
  const t = {
    visitados: 0,
    pendientes: 0,
    dejados: 0,
    vacios: 0,
    efectivo: 0,
    transferencia: 0,
    sinPagar: 0,
    cargados: recorrido.cargados || 0,
  };
  for (const s of recorrido.stops) {
    if (!s.hecho) {
      t.pendientes++;
      continue;
    }
    t.visitados++;
    t.dejados += s.dejados || 0;
    t.vacios += s.vacios || 0;
    if ((s.dejados || 0) > 0) {
      if (s.pago === "efectivo") t.efectivo += montoParada(s);
      else if (s.pago === "transferencia") t.transferencia += montoParada(s);
      else t.sinPagar += montoParada(s);
    }
  }
  t.sobrantes = t.cargados - t.dejados;
  return t;
}

export function fechaLarga(recorrido) {
  const [a, m, d] = recorrido.fecha.split("-").map(Number);
  const f = new Date(a, m - 1, d).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return f.charAt(0).toUpperCase() + f.slice(1);
}

function plural(n, uno, varios) {
  return `${n} ${n === 1 ? uno : varios}`;
}

function lineaParada(s, cliente, n) {
  const nombre = s.nombre || (cliente && cliente.nombre) || "Cliente eliminado";
  const direccion = s.direccion || (cliente && cliente.direccion) || "";
  const dir = direccion ? ` (${direccion})` : "";
  const partes = [];
  partes.push(`dejé ${s.dejados || 0}`);
  partes.push(`vacíos ${s.vacios || 0}`);
  if ((s.dejados || 0) > 0) {
    const pago = ETIQUETA_PAGO[s.pago] || "sin dato";
    partes.push(`${pago} ${formatoPesos(montoParada(s))}`);
  }
  return `${n}. ${nombre}${dir}: ${partes.join(", ")}`;
}

/** Texto listo para pegar en WhatsApp (los asteriscos lo ponen en negrita). */
export function armarTexto(recorrido, clientes) {
  const porId = new Map(clientes.map((c) => [c.id, c]));
  const t = totales(recorrido);
  const lineas = [];
  lineas.push(`*Acqua Vita - Recorrido*`);
  lineas.push(fechaLarga(recorrido));
  lineas.push("");
  lineas.push("*Bidones*");
  if (t.cargados > 0) lineas.push(`Salí con: ${t.cargados}`);
  lineas.push(`Dejé: ${t.dejados}`);
  lineas.push(`Vacíos que me dieron: ${t.vacios}`);
  if (t.cargados > 0) lineas.push(`Me quedaron llenos: ${t.sobrantes}`);
  lineas.push("");
  lineas.push("*Cobros*");
  lineas.push(`Efectivo: ${formatoPesos(t.efectivo)}`);
  lineas.push(`Transferencias: ${formatoPesos(t.transferencia)}`);
  lineas.push(`Sin pagar: ${formatoPesos(t.sinPagar)}`);
  lineas.push("");
  lineas.push(`*Detalle* (${plural(t.visitados, "parada", "paradas")})`);
  let n = 0;
  for (const s of recorrido.stops) {
    if (!s.hecho) continue;
    n++;
    lineas.push(lineaParada(s, porId.get(s.cid), n));
  }
  const faltan = recorrido.stops.filter((s) => !s.hecho);
  if (faltan.length) {
    lineas.push("");
    lineas.push("*No visitados*");
    for (const s of faltan) {
      const c = porId.get(s.cid);
      lineas.push(`- ${c ? c.nombre : "Cliente eliminado"}`);
    }
  }
  return lineas.join("\n");
}

export function urlWhatsApp(texto, numero) {
  const base = numero ? `https://wa.me/${numero}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(texto)}`;
}
