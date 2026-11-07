/*
 * Función de Vercel que consulta la API pública de la Central de Deudores del BCRA
 * (https://api.bcra.gob.ar). Hace falta porque el navegador no puede llamar a esa API
 * directamente (no permite pedidos desde otras páginas).
 *
 * Uso: /api/bcra?cuit=30707866981&tipo=deudas|historicas|cheques
 *      /api/bcra?tipo=cotizacion&desde=2025-01-01&hasta=2026-11-07  (dólar oficial, API de estadísticas cambiarias)
 */
const RUTAS = {
  deudas: 'Deudas/',
  historicas: 'Deudas/Historicas/',
  cheques: 'ChequesRechazados/'
};

module.exports = async function (req, res) {
  const cuit = String((req.query && req.query.cuit) || '').replace(/\D/g, '');
  const tipo = String((req.query && req.query.tipo) || 'deudas');
  res.setHeader('Cache-Control', 'no-store');

  if (tipo === 'cotizacion') {
    const desde = String((req.query && req.query.desde) || '');
    const hasta = String((req.query && req.query.hasta) || '');
    const fecha = /^\d{4}-\d{2}-\d{2}$/;
    let urlTc = 'https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones';
    if (fecha.test(desde) && fecha.test(hasta)) urlTc += '/USD?fechadesde=' + desde + '&fechahasta=' + hasta + '&limit=1000';
    await reenviar(urlTc, res);
    return;
  }

  if (cuit.length !== 11) {
    res.status(400).json({ status: 400, errorMessages: ['El CUIT tiene que tener 11 números.'] });
    return;
  }
  if (!RUTAS[tipo]) {
    res.status(400).json({ status: 400, errorMessages: ['Tipo de consulta desconocido.'] });
    return;
  }

  await reenviar('https://api.bcra.gob.ar/CentralDeDeudores/v1.0/' + RUTAS[tipo] + cuit, res);
};

async function reenviar(url, res) {
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
    res.status(r.status).json(datos);
  } catch (e) {
    res.status(502).json({ status: 502, errorMessages: ['No se pudo conectar con el BCRA: ' + (e && e.message ? e.message : e)] });
  }
}
