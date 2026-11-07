/*
 * Función de Vercel que lee la cotización del dólar del Banco de la Nación Argentina,
 * tabla «Divisas», tipo vendedor (www.bna.com.ar).
 *
 * Uso: /api/bna              -> cotización de hoy:            { fecha, compra, venta }
 *      /api/bna?mes=202609   -> última cotización de ese mes: { fecha, compra, venta }
 *
 * El BNA no tiene una API: se lee su página. Si cambia el formato, la página de consulta
 * avisa y se puede cargar el dólar a mano.
 */
const BASE = 'https://www.bna.com.ar';

function numero(t) {
  t = String(t == null ? '' : t).replace(/[^\d.,]/g, '');
  if (!t) return 0;
  if (t.indexOf(',') !== -1) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return isFinite(n) && n > 0 ? n : 0;
}

function limpiar(html) {
  return String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&oacute;/gi, 'ó')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// Filas de las tablas del HTML, como listas de textos de celdas.
function filas(html) {
  const res = [];
  const trs = String(html).match(/<tr[\s\S]*?<\/tr>/gi) || [];
  trs.forEach(function (tr) {
    const celdas = [];
    const re = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let m;
    while ((m = re.exec(tr))) celdas.push(limpiar(m[1]));
    if (celdas.length) res.push(celdas);
  });
  return res;
}

// d/m/aaaa -> aaaa-mm-dd
function fechaIso(t) {
  const m = String(t || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : '';
}

const esDolar = function (t) { return /d[oó]lar/i.test(t) && !/euro|real/i.test(t); };

async function bajar(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (consulta-bcra)', Accept: 'text/html' },
    signal: AbortSignal.timeout(20000)
  });
  if (!r.ok) throw new Error('El BNA respondió con código ' + r.status + '.');
  return r.text();
}

// Página principal: la pestaña «Divisas» (id="divisas") tiene fecha, compra y venta.
async function hoy() {
  const html = await bajar(BASE + '/Personas');
  const i = html.search(/id=["']divisas["']/i);
  if (i < 0) throw new Error('No encontré la tabla de Divisas en la página del BNA.');
  let parte = html.slice(i);
  const fin = parte.search(/<\/table>/i);
  if (fin > 0) parte = parte.slice(0, fin + 8);
  const fs = filas(parte);
  let fecha = '';
  fs.forEach(function (f) { f.forEach(function (c) { if (!fecha && fechaIso(c)) fecha = fechaIso(c); }); });
  if (!fecha) fecha = fechaIso(limpiar(parte));
  const fila = fs.find(function (f) { return esDolar(f[0]); });
  if (!fila) throw new Error('No encontré el dólar en la tabla de Divisas del BNA.');
  const nums = fila.slice(1).map(numero).filter(Boolean);
  if (nums.length < 2) throw new Error('No pude leer compra y venta del dólar en el BNA.');
  return { fecha: fecha, compra: nums[0], venta: nums[1] };
}

// Histórico del BNA: cotizaciones de Divisas hasta la fecha pedida. Se toma la última del mes.
async function delMes(aaaamm) {
  const anio = Number(aaaamm.slice(0, 4)), mes = Number(aaaamm.slice(4));
  const ultimo = new Date(Date.UTC(anio, mes, 0));
  const hoyUtc = new Date();
  const tope = ultimo > hoyUtc ? hoyUtc : ultimo;
  const d = tope.getUTCDate(), m = tope.getUTCMonth() + 1, y = tope.getUTCFullYear();
  const fechas = [String(d).padStart(2, '0') + '/' + String(m).padStart(2, '0') + '/' + y, d + '/' + m + '/' + y];
  const prefijo = aaaamm.slice(0, 4) + '-' + aaaamm.slice(4) + '-';
  let ultimoHtml = '', ultimoError = null;
  for (const fecha of fechas) {
    try {
      const html = await bajar(BASE + '/Cotizador/HistoricoPrincipales?id=divisas&fecha=' + encodeURIComponent(fecha) + '&filtroEuro=0&filtroDolar=1');
      ultimoHtml = html;
      const delMesPedido = leerHistorico(html).filter(function (c) { return c.fecha.indexOf(prefijo) === 0; })
        .sort(function (a, b) { return b.fecha.localeCompare(a.fecha); });
      if (delMesPedido.length) return delMesPedido[0];
    } catch (e) { ultimoError = e; }
  }
  const err = ultimoError || new Error('El BNA no devolvió cotizaciones de Divisas para ' + aaaamm.slice(4) + '/' + aaaamm.slice(0, 4) + '.');
  err.html = ultimoHtml;
  throw err;
}

function leerHistorico(html) {
  const cotis = [];
  filas(html).forEach(function (f) {
    if (!f.some(esDolar)) return;
    let fe = '';
    const nums = [];
    f.forEach(function (c) {
      if (!fe && fechaIso(c)) { fe = fechaIso(c); return; }
      if (esDolar(c)) return;
      const n = numero(c);
      if (n) nums.push(n);
    });
    if (fe && nums.length >= 2) cotis.push({ fecha: fe, compra: nums[0], venta: nums[1] });
  });
  return cotis;
}

module.exports = async function (req, res) {
  const mes = String((req.query && req.query.mes) || '');
  try {
    if (mes) {
      if (!/^\d{6}$/.test(mes)) { res.status(400).json({ error: 'Mes inválido (AAAAMM).' }); return; }
      res.setHeader('Cache-Control', 's-maxage=86400');
      res.status(200).json(await delMes(mes));
    } else {
      res.setHeader('Cache-Control', 's-maxage=600');
      res.status(200).json(await hoy());
    }
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    const salida = { error: e && e.message ? e.message : String(e) };
    // /api/bna?mes=AAAAMM&ver=1 muestra el principio de lo que respondió el BNA, para revisar el formato.
    if (req.query && req.query.ver && e && e.html !== undefined) salida.respuesta = limpiar(e.html).slice(0, 1500);
    res.status(502).json(salida);
  }
};
