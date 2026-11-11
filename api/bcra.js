/*
 * Función de Vercel que consulta la API pública de la Central de Deudores del BCRA
 * (https://api.bcra.gob.ar). Hace falta porque el navegador no puede llamar a esa API
 * directamente (no permite pedidos desde otras páginas).
 *
 * Uso: /api/bcra?cuit=30707866981&tipo=deudas|historicas|cheques   (con &ver=1 agrega la ruta usada)
 */
// Para cada tipo, las rutas a probar en orden (la primera es la documentada por el BCRA).
const RUTAS = {
  deudas: ['Deudas/'],
  historicas: ['Deudas/Historicas/'],
  cheques: ['Deudas/ChequesRechazados/', 'ChequesRechazados/']
};

module.exports = async function (req, res) {
  const cuit = String((req.query && req.query.cuit) || '').replace(/\D/g, '');
  const tipo = String((req.query && req.query.tipo) || 'deudas');
  res.setHeader('Cache-Control', 'no-store');

  if (cuit.length !== 11) {
    res.status(400).json({ status: 400, errorMessages: ['El CUIT tiene que tener 11 números.'] });
    return;
  }
  if (!RUTAS[tipo]) {
    res.status(400).json({ status: 400, errorMessages: ['Tipo de consulta desconocido.'] });
    return;
  }

  // Si una ruta responde 404 se prueba la siguiente; si todas dan 404, el CUIT no tiene datos.
  let ultima = null;
  for (const ruta of RUTAS[tipo]) {
    ultima = await pedir('https://api.bcra.gob.ar/CentralDeDeudores/v1.0/' + ruta + cuit);
    if (ultima.status !== 404) break;
  }
  if (req.query && req.query.ver) ultima.datos = Object.assign({ _ruta: ultima.url }, ultima.datos);
  res.status(ultima.status).json(ultima.datos);
};

async function pedir(url) {
  try {
    const r = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'consulta-bcra' },
      signal: AbortSignal.timeout(20000)
    });
    const texto = await r.text();
    let datos;
    try { datos = JSON.parse(texto); } catch (e) {
      datos = { status: r.status, errorMessages: ['El BCRA respondió algo inesperado (código ' + r.status + ').'] };
    }
    return { status: r.status, datos: datos, url: url };
  } catch (e) {
    return { status: 502, datos: { status: 502, errorMessages: ['No se pudo conectar con el BCRA: ' + (e && e.message ? e.message : e)] }, url: url };
  }
}
