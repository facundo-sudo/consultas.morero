/*
 * Consulta BCRA: toma una lista de CUIT y consulta, uno por uno, la Central de Deudores
 * del BCRA a través de /api/bcra (función de Vercel, ver api/bcra.js).
 */
(function () {
  'use strict';

  var CLAVE_TEXTO = 'consulta-bcra.cuits'; // versión anterior (una sola lista)
  var CLAVE_LISTAS = 'consulta-bcra.listas';
  var CLAVE_CAT = 'consulta-bcra.categoria';
  var CATEGORIAS = [
    { id: 'proveedores', nombre: 'Proveedores' },
    { id: 'agronomias', nombre: 'Agronomías' },
    { id: 'productores', nombre: 'Productores' },
    { id: 'grupos', nombre: 'Grupos de siembra' },
    { id: 'varios', nombre: 'Varios' }
  ];
  var listas = {};      // id de categoría -> texto con los CUIT
  var catActual = 'proveedores';
  var filtro = '';      // categoría elegida en los resultados ('' = todas)
  var PAUSA_MS = 350; // entre consultas, para no saturar la API del BCRA

  var SITUACIONES = {
    1: 'Normal',
    2: 'Riesgo bajo',
    3: 'Riesgo medio',
    4: 'Riesgo alto',
    5: 'Irrecuperable',
    6: 'Irrecuperable (disp. técnica)'
  };

  function nombreCat(id) {
    for (var i = 0; i < CATEGORIAS.length; i++) if (CATEGORIAS[i].id === id) return CATEGORIAS[i].nombre;
    return id;
  }

  // ---------------------------------------------------------------------------
  // Dólar Banco Nación, Divisas, vendedor: de hoy o de fin de cada mes (api/bna.js), o cargado a mano
  // ---------------------------------------------------------------------------
  var CLAVE_TC = 'consulta-bcra.tc';
  var tc = { fuente: 'bna', modo: 'hoy', hoy: null, meses: {} }; // hoy/meses[AAAAMM]: { valor, fecha, manual }

  function leerNumero(t) {
    t = String(t == null ? '' : t).replace(/[^\d.,]/g, '');
    if (!t) return 0;
    if (t.indexOf(',') !== -1) t = t.replace(/\./g, '').replace(',', '.');
    var n = Number(t);
    return isFinite(n) && n > 0 ? n : 0;
  }
  function fmtTc(v) { return v ? v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''; }
  function guardarTc() { try { localStorage.setItem(CLAVE_TC, JSON.stringify(tc)); } catch (e) { /* nada */ } }
  function cargarTc() {
    try {
      var t = JSON.parse(localStorage.getItem(CLAVE_TC) || 'null');
      if (t && t.fuente === 'bna') { tc.modo = t.modo === 'mes' ? 'mes' : 'hoy'; tc.hoy = t.hoy || null; tc.meses = t.meses || {}; }
      else if (t) tc.modo = t.modo === 'mes' ? 'mes' : 'hoy'; // valores viejos (BCRA A 3500): se descartan
    } catch (e) { /* nada */ }
  }
  function isoFecha(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  // Últimos 25 meses (del actual para atrás), como AAAAMM.
  function ultimosMeses() {
    var d = new Date(), lista = [];
    d.setDate(1);
    for (var i = 0; i < 25; i++) {
      lista.push(d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0'));
      d.setMonth(d.getMonth() - 1);
    }
    return lista;
  }

  // Dólar que corresponde a un período (AAAAMM) según el modo elegido. 0 si falta.
  function tcPara(periodo) {
    if (tc.modo === 'mes') {
      var m = tc.meses[String(periodo)];
      return m && m.valor ? m.valor : 0;
    }
    return tc.hoy && tc.hoy.valor ? tc.hoy.valor : 0;
  }
  function enDolares(miles, periodo) {
    var v = tcPara(periodo);
    return v ? Math.round((Number(miles) || 0) * 1000 / v) : null;
  }
  function fmtUsd(miles, periodo) {
    var u = enDolares(miles, periodo);
    if (u === null) return '<span class="usd" title="Falta el dólar' + (tc.modo === 'mes' ? ' de ' + fmtPeriodo(periodo) : ' de hoy') + '">US$ —</span>';
    return '<span class="usd">US$ ' + u.toLocaleString('es-AR') + '</span>';
  }
  function fmtMonto(miles, periodo) { return fmtPesos(miles) + fmtUsd(miles, periodo); }

  // Meses que hacen falta: los períodos de los resultados (deuda actual e historial).
  function mesesNecesarios() {
    var m = {};
    resultados.forEach(function (r) {
      if (r.deudas && r.deudas.periodo) m[r.deudas.periodo] = true;
      (r.historicas || []).forEach(function (p) { m[p.periodo] = true; });
    });
    return Object.keys(m).sort().reverse();
  }

  function pedirBna(mes) {
    return fetch('api/bna' + (mes ? '?mes=' + mes : ''), { headers: { Accept: 'application/json' } })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok || !j.venta) throw new Error(j.error || 'sin datos');
          return j;
        });
      });
  }

  // Dólar del Banco Nación (Divisas, vendedor). forzar: pisa también lo cargado a mano en «hoy».
  var trayendoMeses = false;
  function traerTc(forzar) {
    $('tc-estado').textContent = 'Buscando el dólar en el Banco Nación…';
    return pedirBna('').then(function (j) {
      if (forzar || !tc.hoy || !tc.hoy.manual) tc.hoy = { valor: j.venta, fecha: j.fecha, manual: false };
      guardarTc();
      renderTc();
      renderTabla();
    }).catch(function (e) {
      renderTc();
      $('tc-estado').textContent = 'No se pudo traer el dólar del Banco Nación (' + e.message + '). Escribilo a mano.' +
        (tc.hoy && tc.hoy.valor ? ' Por ahora se usa el último guardado.' : '');
    }).then(function () { if (tc.modo === 'mes') return traerMeses(forzar); });
  }

  // Trae, de a uno, el dólar de fin de mes de los períodos que faltan (no pisa los cargados a mano).
  function traerMeses(forzar) {
    if (trayendoMeses) return Promise.resolve();
    var faltan = mesesNecesarios().filter(function (m) {
      var x = tc.meses[m];
      return !x || (!x.manual && (forzar || !x.valor));
    });
    if (!faltan.length) return Promise.resolve();
    trayendoMeses = true;
    var fallaron = [];
    var i = 0;
    $('tc-meses-estado').textContent = 'Buscando el dólar de ' + faltan.length + (faltan.length === 1 ? ' mes' : ' meses') + ' en el Banco Nación…';
    function siguiente() {
      if (i >= faltan.length) return Promise.resolve();
      var m = faltan[i++];
      return pedirBna(m).then(function (j) {
        tc.meses[m] = { valor: j.venta, fecha: j.fecha, manual: false };
        guardarTc();
      }, function () { fallaron.push(m); }).then(siguiente);
    }
    return siguiente().then(function () {
      trayendoMeses = false;
      renderTc();
      renderTabla();
      $('tc-meses-estado').textContent = fallaron.length
        ? 'No se pudo traer el dólar de ' + fallaron.map(fmtPeriodo).join(', ') + '. Escribilo a mano en «Dólar por mes».'
        : '';
    });
  }

  function renderTc() {
    document.querySelectorAll('input[name="tc-modo"]').forEach(function (r) { r.checked = r.value === tc.modo; });
    if (document.activeElement !== $('tc-hoy')) $('tc-hoy').value = tc.hoy && tc.hoy.valor ? fmtTc(tc.hoy.valor) : '';
    $('tc-estado').textContent = !tc.hoy || !tc.hoy.valor ? 'Sin dólar cargado.' :
      tc.hoy.manual ? 'Cargado a mano.' : 'Banco Nación, Divisas vendedor, cotización del ' + fmtFecha(tc.hoy.fecha) + '.';
    $('tc-meses').innerHTML = ultimosMeses().map(function (m) {
      var x = tc.meses[m];
      var titulo = x ? (x.manual ? 'Cargado a mano' : 'Banco Nación, cotización del ' + fmtFecha(x.fecha)) : 'Sin dato';
      return '<label title="' + escapar(titulo) + '">' + fmtPeriodo(m) +
        '<input type="text" inputmode="decimal" data-mes="' + m + '" value="' + (x && x.valor ? fmtTc(x.valor) : '') + '"' + (x && x.manual ? ' class="manual"' : '') + '></label>';
    }).join('');
    if (tc.modo === 'mes') $('tc-meses-cont').open = true;
  }

  var resultados = [];
  var detener = false;
  var consultando = false;

  function $(id) { return document.getElementById(id); }
  function soloNumeros(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }
  function fmtCuit(d) { return d.slice(0, 2) + '-' + d.slice(2, 10) + '-' + d.slice(10); }
  function escapar(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function esperar(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function fmtPesos(miles) {
    return '$ ' + Math.round((Number(miles) || 0) * 1000).toLocaleString('es-AR');
  }
  function fmtPeriodo(p) {
    p = String(p || '');
    return p.length === 6 ? p.slice(4) + '/' + p.slice(0, 4) : p;
  }
  function fmtFecha(f) {
    if (!f) return '';
    var m = String(f).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[3] + '/' + m[2] + '/' + m[1] : String(f);
  }
  function nombreSit(n) { return SITUACIONES[n] || (n ? 'Situación ' + n : 'Sin deudas'); }
  function etiquetaSit(n) {
    return '<span class="sit sit-' + (SITUACIONES[n] ? n : 0) + '">' + (n ? n + ' · ' : '') + escapar(nombreSit(n)) + '</span>';
  }

  // Dígito verificador del CUIT/CUIL.
  function cuitValido(d) {
    if (!/^\d{11}$/.test(d)) return false;
    var pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2], suma = 0;
    for (var i = 0; i < 10; i++) suma += Number(d[i]) * pesos[i];
    var v = 11 - (suma % 11);
    if (v === 11) v = 0;
    if (v === 10) v = 9;
    return v === Number(d[10]);
  }

  // Lee el texto: cada renglón con un CUIT (11 números, con o sin guiones) y, opcional, un nombre.
  function leerLista(texto, categoria) {
    var vistos = {}, lista = [];
    String(texto == null ? $('cuits').value : texto).split(/\r?\n/).forEach(function (renglon) {
      var m = renglon.match(/(\d{2})[\s.\-\/]?(\d{8})[\s.\-\/]?(\d)(?!\d)/);
      if (!m) return;
      var d = m[1] + m[2] + m[3];
      if (vistos[d]) return;
      vistos[d] = true;
      var nombre = renglon.replace(m[0], '').replace(/^[\s,;:\t\-–]+|[\s,;:\t\-–]+$/g, '');
      lista.push({ cuit: d, referencia: nombre, valido: cuitValido(d), categoria: categoria || catActual });
    });
    return lista;
  }

  function actualizarEstadoLista() {
    var lista = leerLista();
    var malos = lista.filter(function (x) { return !x.valido; });
    var t = lista.length ? lista.length + ' CUIT para consultar.' : 'Todavía no hay CUIT cargados.';
    if (malos.length) t += ' Ojo: ' + malos.map(function (x) { return fmtCuit(x.cuit); }).join(', ') + (malos.length === 1 ? ' no parece un CUIT válido' : ' no parecen CUIT válidos') + ' (dígito verificador).';
    $('cuits-estado').textContent = t;
    listas[catActual] = $('cuits').value;
    guardarListas();
    renderSolapas();
  }

  function guardarListas() {
    try { localStorage.setItem(CLAVE_LISTAS, JSON.stringify(listas)); localStorage.setItem(CLAVE_CAT, catActual); } catch (e) { /* nada */ }
  }

  function cargarListas() {
    try { listas = JSON.parse(localStorage.getItem(CLAVE_LISTAS) || '{}') || {}; } catch (e) { listas = {}; }
    try {
      var vieja = localStorage.getItem(CLAVE_TEXTO);
      if (vieja && !Object.keys(listas).length) { listas.varios = vieja; catActual = 'varios'; }
      if (vieja) localStorage.removeItem(CLAVE_TEXTO);
      var c = localStorage.getItem(CLAVE_CAT);
      if (c && CATEGORIAS.some(function (x) { return x.id === c; })) catActual = c;
    } catch (e) { /* nada */ }
  }

  function renderSolapas() {
    $('solapas').innerHTML = CATEGORIAS.map(function (c) {
      var n = leerLista(listas[c.id] || '', c.id).length;
      return '<button type="button" class="solapa" role="tab" data-cat="' + c.id + '" aria-selected="' + (c.id === catActual) + '">' +
        escapar(c.nombre) + '<span class="cuenta">' + n + '</span></button>';
    }).join('');
    $('nombre-cat').textContent = nombreCat(catActual);
  }

  function elegirCategoria(id) {
    listas[catActual] = $('cuits').value;
    catActual = id;
    $('cuits').value = listas[id] || '';
    actualizarEstadoLista();
  }

  function renderFiltros() {
    var hay = {};
    resultados.forEach(function (r) { hay[r.categoria] = (hay[r.categoria] || 0) + 1; });
    var cats = CATEGORIAS.filter(function (c) { return hay[c.id]; });
    if (cats.length < 2) { $('filtros').innerHTML = ''; filtro = ''; return; }
    if (filtro && !hay[filtro]) filtro = '';
    $('filtros').innerHTML = '<button type="button" class="solapa" data-filtro="" aria-selected="' + (filtro === '') + '">Todas<span class="cuenta">' + resultados.length + '</span></button>' +
      cats.map(function (c) {
        return '<button type="button" class="solapa" data-filtro="' + c.id + '" aria-selected="' + (filtro === c.id) + '">' + escapar(c.nombre) + '<span class="cuenta">' + hay[c.id] + '</span></button>';
      }).join('');
  }

  // ---------------------------------------------------------------------------
  // Consulta a la API
  // ---------------------------------------------------------------------------
  function pedir(cuit, tipo, intento) {
    intento = intento || 1;
    return fetch('api/bcra?tipo=' + tipo + '&cuit=' + cuit, { headers: { Accept: 'application/json' } })
      .then(function (r) {
        return r.json().catch(function () { return { status: r.status }; }).then(function (j) {
          if (r.status === 429 && intento < 4) return esperar(1500 * intento).then(function () { return pedir(cuit, tipo, intento + 1); });
          if ((r.status === 502 || r.status === 503 || r.status === 504) && intento < 3) return esperar(1000).then(function () { return pedir(cuit, tipo, intento + 1); });
          // 404: el BCRA no tiene datos para ese CUIT (no figura con deudas / cheques).
          if (r.status === 404) return { sinDatos: true, mensaje: (j.errorMessages || [])[0] || '' };
          if (!r.ok) {
            var msg = (j.errorMessages || [])[0];
            if (!msg && r.status === 404) msg = 'Sin datos';
            throw new Error(msg || 'Error ' + r.status + ' al consultar el BCRA.');
          }
          return j.results || {};
        });
      }, function () {
        throw new Error('No se pudo conectar. La consulta funciona en la página publicada en Vercel (no abriendo el archivo en la PC).');
      });
  }

  function resumirDeudas(res) {
    var r = { nombre: '', periodo: '', peor: 0, total: 0, entidades: [] };
    if (!res || res.sinDatos) return r;
    r.nombre = res.denominacion || '';
    var periodos = (res.periodos || []).slice().sort(function (a, b) { return String(b.periodo).localeCompare(String(a.periodo)); });
    if (!periodos.length) return r;
    r.periodo = periodos[0].periodo;
    r.entidades = periodos[0].entidades || [];
    r.entidades.forEach(function (e) {
      r.total += Number(e.monto) || 0;
      if ((Number(e.situacion) || 0) > r.peor) r.peor = Number(e.situacion);
    });
    return r;
  }

  function resumirCheques(res) {
    var lista = [];
    if (!res || res.sinDatos) return lista;
    (res.causales || []).forEach(function (c) {
      (c.entidades || []).forEach(function (e) {
        (e.detalle || []).forEach(function (d) {
          lista.push({
            causal: c.causal, entidad: e.entidad, nro: d.nroCheque, fecha: d.fechaRechazo, monto: d.monto,
            fechaPago: d.fechaPago, fechaPagoMulta: d.fechaPagoMulta, estadoMulta: d.estadoMulta,
            procesoJud: d.procesoJud, enRevision: d.enRevision
          });
        });
      });
    });
    return lista;
  }

  function resumirHistoricas(res) {
    if (!res || res.sinDatos) return [];
    return (res.periodos || []).map(function (p) {
      var peor = 0, total = 0;
      (p.entidades || []).forEach(function (e) {
        total += Number(e.monto) || 0;
        if ((Number(e.situacion) || 0) > peor) peor = Number(e.situacion);
      });
      return { periodo: p.periodo, peor: peor, total: total, cantidad: (p.entidades || []).length };
    }).sort(function (a, b) { return String(b.periodo).localeCompare(String(a.periodo)); });
  }

  function consultarUno(item, opciones) {
    var r = { cuit: item.cuit, referencia: item.referencia, categoria: item.categoria, error: '' };
    return pedir(item.cuit, 'deudas').then(function (res) {
      r.deudas = resumirDeudas(res);
      r.nombre = r.deudas.nombre;
      if (!opciones.cheques) return;
      return esperar(PAUSA_MS).then(function () { return pedir(item.cuit, 'cheques'); }).then(function (res2) {
        r.cheques = resumirCheques(res2);
        if (!r.nombre && res2 && res2.denominacion) r.nombre = res2.denominacion;
      });
    }).then(function () {
      if (!opciones.historicas) return;
      return esperar(PAUSA_MS).then(function () { return pedir(item.cuit, 'historicas'); }).then(function (res3) {
        r.historicas = resumirHistoricas(res3);
        if (!r.nombre && res3 && res3.denominacion) r.nombre = res3.denominacion;
      });
    }).catch(function (e) {
      r.error = e && e.message ? e.message : String(e);
    }).then(function () { return r; });
  }

  function consultar(todas) {
    if (consultando) return;
    listas[catActual] = $('cuits').value;
    var lista = [];
    (todas ? CATEGORIAS.map(function (c) { return c.id; }) : [catActual]).forEach(function (id) {
      lista = lista.concat(leerLista(listas[id] || '', id));
    });
    if (!lista.length) { alert(todas ? 'No hay CUIT cargados en ninguna categoría.' : 'Pegá al menos un CUIT (11 números) en ' + nombreCat(catActual) + '.'); return; }
    filtro = todas ? '' : catActual;
    var opciones = { cheques: $('op-cheques').checked, historicas: $('op-historicas').checked };
    consultando = true;
    detener = false;
    resultados = [];
    $('btn-consultar').disabled = true;
    $('btn-consultar-todas').disabled = true;
    $('btn-detener').hidden = false;
    $('progreso').hidden = false;
    $('sec-resultados').hidden = false;
    renderTabla();

    var i = 0;
    function siguiente() {
      if (detener || i >= lista.length) return Promise.resolve();
      var item = lista[i];
      $('progreso').textContent = 'Consultando ' + (i + 1) + ' de ' + lista.length + ': ' + fmtCuit(item.cuit) + ' (' + nombreCat(item.categoria) + ')…';
      return consultarUno(item, opciones).then(function (r) {
        resultados.push(r);
        renderTabla();
        i++;
        return i < lista.length && !detener ? esperar(PAUSA_MS).then(siguiente) : null;
      });
    }
    siguiente().then(function () {
      var errores = resultados.filter(function (r) { return r.error; }).length;
      $('progreso').textContent = (detener ? 'Consulta detenida. ' : 'Listo. ') + resultados.length + ' de ' + lista.length + ' consultados' +
        (errores ? ' (' + errores + ' con error).' : '.') + ' ' + new Date().toLocaleString('es-AR');
      consultando = false;
      if (tc.modo === 'mes') traerMeses(false);
      $('btn-consultar').disabled = false;
      $('btn-consultar-todas').disabled = false;
      $('btn-detener').hidden = true;
    });
  }

  // ---------------------------------------------------------------------------
  // Tabla de resultados
  // ---------------------------------------------------------------------------
  function marcasEntidad(e) {
    var m = [];
    if (e.refinanciaciones) m.push('Refinanciada');
    if (e.recategorizacionOblig) m.push('Recategorización obligatoria');
    if (e.situacionJuridica) m.push('Situación jurídica');
    if (e.irrecDisposicionTecnica) m.push('Irrec. disp. técnica');
    if (e.enRevision) m.push('En revisión');
    if (e.procesoJud) m.push('Proceso judicial');
    return m;
  }

  function htmlDetalle(r) {
    var h = '';
    var d = r.deudas || { entidades: [] };
    if (d.entidades.length) {
      h += '<h4>Deudas · período ' + escapar(fmtPeriodo(d.periodo)) + '</h4><div class="bcra-tabla-cont"><table><thead><tr>' +
        '<th>Entidad</th><th>Situación</th><th class="der">Monto</th><th class="der">Días de atraso</th><th>Observaciones</th></tr></thead><tbody>';
      d.entidades.forEach(function (e) {
        h += '<tr><td>' + escapar(e.entidad) + '</td><td>' + etiquetaSit(Number(e.situacion)) + '</td><td class="der">' + fmtMonto(e.monto, d.periodo) +
          '</td><td class="der">' + (e.diasAtrasoPago != null ? escapar(e.diasAtrasoPago) : '') + '</td><td>' +
          marcasEntidad(e).map(function (x) { return '<span class="marca">' + escapar(x) + '</span>'; }).join('') + '</td></tr>';
      });
      h += '</tbody></table></div>';
    } else {
      h += '<h4>Deudas</h4><p>No figura con deudas informadas en la Central de Deudores.</p>';
    }
    if (r.cheques) {
      if (r.cheques.length) {
        h += '<h4>Cheques rechazados (' + r.cheques.length + ')</h4><div class="bcra-tabla-cont"><table><thead><tr>' +
          '<th>Causal</th><th>Entidad</th><th>N° cheque</th><th>Fecha rechazo</th><th class="der">Monto</th><th>Pagado</th><th>Multa</th></tr></thead><tbody>';
        r.cheques.forEach(function (c) {
          h += '<tr><td>' + escapar(c.causal) + '</td><td>' + escapar(c.entidad) + '</td><td>' + escapar(c.nro) + '</td><td class="nowrap">' +
            escapar(fmtFecha(c.fecha)) + '</td><td class="der">$ ' + (Number(c.monto) || 0).toLocaleString('es-AR') + '</td><td class="nowrap">' +
            (c.fechaPago ? escapar(fmtFecha(c.fechaPago)) : 'No') + '</td><td>' + escapar(c.estadoMulta || '') +
            (c.fechaPagoMulta ? ' (' + escapar(fmtFecha(c.fechaPagoMulta)) + ')' : '') + '</td></tr>';
        });
        h += '</tbody></table></div>';
      } else {
        h += '<h4>Cheques rechazados</h4><p>No tiene cheques rechazados informados.</p>';
      }
    }
    if (r.historicas) {
      if (r.historicas.length) {
        h += '<h4>Historial (24 meses)</h4><div class="bcra-tabla-cont"><table><thead><tr>' +
          '<th>Período</th><th>Peor situación</th><th class="der">Deuda total</th><th class="der">Entidades</th></tr></thead><tbody>';
        r.historicas.forEach(function (p) {
          h += '<tr><td>' + escapar(fmtPeriodo(p.periodo)) + '</td><td>' + etiquetaSit(p.peor) + '</td><td class="der">' + fmtMonto(p.total, p.periodo) +
            '</td><td class="der">' + p.cantidad + '</td></tr>';
        });
        h += '</tbody></table></div>';
      } else {
        h += '<h4>Historial (24 meses)</h4><p>Sin datos históricos.</p>';
      }
    }
    return h;
  }

  function renderTabla() {
    var tb = $('tabla-resultados');
    if (!consultando && !resultados.length) return;
    renderFiltros();
    if (!resultados.length) { tb.innerHTML = '<tr><td colspan="8">Consultando…</td></tr>'; return; }
    tb.innerHTML = resultados.map(function (r, i) {
      if (filtro && r.categoria !== filtro) return '';
      var cat = '<td class="nowrap">' + escapar(nombreCat(r.categoria)) + '</td>';
      var nombre = escapar(r.nombre || r.referencia || '');
      if (r.nombre && r.referencia && r.referencia !== r.nombre) nombre += '<br><span class="ayuda">' + escapar(r.referencia) + '</span>';
      if (r.error) {
        return '<tr><td class="nowrap">' + fmtCuit(r.cuit) + '</td><td>' + nombre + '</td>' + cat + '<td colspan="5"><span class="sit sit-err">Error</span> ' + escapar(r.error) + '</td></tr>';
      }
      var d = r.deudas;
      return '<tr class="bcra-fila" data-i="' + i + '" title="Ver detalle"><td class="nowrap">' + fmtCuit(r.cuit) + '</td><td>' + nombre +
        '</td>' + cat + '<td class="nowrap">' + escapar(fmtPeriodo(d.periodo)) + '</td><td>' + etiquetaSit(d.peor) +
        '</td><td class="der">' + (d.entidades.length ? fmtMonto(d.total, d.periodo) : '—') + '</td><td class="der">' + d.entidades.length +
        '</td><td class="der">' + (r.cheques ? r.cheques.length : '—') + '</td></tr>' +
        '<tr class="bcra-detalle" data-det="' + i + '" hidden><td colspan="8">' + htmlDetalle(r) + '</td></tr>';
    }).join('');
  }

  // ---------------------------------------------------------------------------
  // Excel
  // ---------------------------------------------------------------------------
  function bajarExcel() {
    if (!resultados.length) { alert('Primero hay que consultar.'); return; }
    var elegidos = resultados.filter(function (r) { return !filtro || r.categoria === filtro; });
    var resumen = elegidos.map(function (r) {
      var d = r.deudas || { entidades: [] };
      return {
        'Categoría': nombreCat(r.categoria),
        CUIT: fmtCuit(r.cuit),
        Nombre: r.nombre || '',
        Referencia: r.referencia || '',
        'Período': fmtPeriodo(d.periodo),
        'Peor situación': r.error ? '' : d.peor || '',
        'Descripción': r.error ? 'Error: ' + r.error : nombreSit(d.peor),
        'Deuda total ($)': r.error ? '' : Math.round(d.total * 1000),
        'Deuda total (US$)': r.error || !d.entidades.length ? '' : enDolares(d.total, d.periodo),
        'Dólar usado': r.error || !d.entidades.length ? '' : tcPara(d.periodo) || '',
        Entidades: r.error ? '' : d.entidades.length,
        'Cheques rechazados': r.cheques ? r.cheques.length : ''
      };
    });
    var detalle = [];
    elegidos.forEach(function (r) {
      ((r.deudas && r.deudas.entidades) || []).forEach(function (e) {
        detalle.push({
          'Categoría': nombreCat(r.categoria), CUIT: fmtCuit(r.cuit), Nombre: r.nombre || '', 'Período': fmtPeriodo(r.deudas.periodo), Entidad: e.entidad,
          'Situación': Number(e.situacion), 'Descripción': nombreSit(Number(e.situacion)), 'Monto ($)': Math.round((Number(e.monto) || 0) * 1000),
          'Monto (US$)': enDolares(e.monto, r.deudas.periodo), 'Dólar usado': tcPara(r.deudas.periodo) || '',
          'Días de atraso': e.diasAtrasoPago, Observaciones: marcasEntidad(e).join(', ')
        });
      });
    });
    var cheques = [];
    elegidos.forEach(function (r) {
      (r.cheques || []).forEach(function (c) {
        cheques.push({
          'Categoría': nombreCat(r.categoria), CUIT: fmtCuit(r.cuit), Nombre: r.nombre || '', Causal: c.causal, Entidad: c.entidad, 'N° cheque': c.nro,
          'Fecha rechazo': fmtFecha(c.fecha), 'Monto ($)': c.monto, 'Fecha pago': fmtFecha(c.fechaPago),
          'Estado multa': c.estadoMulta || '', 'Fecha pago multa': fmtFecha(c.fechaPagoMulta)
        });
      });
    });
    var historial = [];
    elegidos.forEach(function (r) {
      (r.historicas || []).forEach(function (p) {
        historial.push({
          'Categoría': nombreCat(r.categoria), CUIT: fmtCuit(r.cuit), Nombre: r.nombre || '', 'Período': fmtPeriodo(p.periodo), 'Peor situación': p.peor,
          'Deuda total ($)': Math.round(p.total * 1000), 'Deuda total (US$)': enDolares(p.total, p.periodo),
          'Dólar usado': tcPara(p.periodo) || '', Entidades: p.cantidad
        });
      });
    });
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumen), 'Resumen');
    if (detalle.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detalle), 'Deudas por entidad');
    if (cheques.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cheques), 'Cheques rechazados');
    if (historial.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(historial), 'Historial');
    var hoy = new Date();
    var f = hoy.getFullYear() + '-' + String(hoy.getMonth() + 1).padStart(2, '0') + '-' + String(hoy.getDate()).padStart(2, '0');
    XLSX.writeFile(wb, 'Consulta BCRA ' + (filtro ? nombreCat(filtro) + ' ' : '') + f + '.xlsx');
  }

  // Reconoce la categoría escrita en el Excel (columna o nombre de la hoja).
  function categoriaDeTexto(t) {
    t = String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!t.trim()) return '';
    if (/provee/.test(t)) return 'proveedores';
    if (/agronom/.test(t)) return 'agronomias';
    if (/productor/.test(t)) return 'productores';
    if (/grupo|siembra|pool/.test(t)) return 'grupos';
    if (/vario|otro/.test(t)) return 'varios';
    return '';
  }

  // Excel con CUIT: toma de cada fila la primera celda con 11 números y, si hay, el nombre.
  // La categoría sale de una columna «Categoría»/«Tipo», o del nombre de la hoja;
  // si no, va a la categoría elegida.
  function leerExcel(archivo) {
    var lector = new FileReader();
    lector.onload = function () {
      try {
        var wb = XLSX.read(new Uint8Array(lector.result), { type: 'array' });
        var porCat = {}, total = 0;
        var hojaUsada = false;
        wb.SheetNames.forEach(function (nombreHoja, nh) {
          var catHoja = categoriaDeTexto(nombreHoja);
          // Si ninguna hoja tiene nombre de categoría, solo se lee la primera.
          if (nh > 0 && !catHoja && !wb.SheetNames.some(function (n) { return categoriaDeTexto(n); })) return;
          var filas = XLSX.utils.sheet_to_json(wb.Sheets[nombreHoja], { header: 1, defval: '' });
          var colNombre = -1, colCat = -1;
          (filas[0] || []).forEach(function (t, j) {
            t = String(t);
            if (colNombre === -1 && /nombre|cliente|raz[oó]n|denominaci|proveedor/i.test(t) && !/cuit/i.test(t)) colNombre = j;
            if (colCat === -1 && /categor|^tipo|rubro|grupo/i.test(t.trim())) colCat = j;
          });
          if (colNombre === colCat) colNombre = -1;
          filas.forEach(function (fila) {
            for (var j = 0; j < fila.length; j++) {
              var d = soloNumeros(fila[j]);
              if (d.length === 11 && j !== colCat) {
                var cat = (colCat >= 0 && categoriaDeTexto(fila[colCat])) || catHoja || catActual;
                (porCat[cat] = porCat[cat] || []).push(fmtCuit(d) + (colNombre >= 0 && fila[colNombre] ? '  ' + String(fila[colNombre]).trim() : ''));
                total++;
                hojaUsada = true;
                break;
              }
            }
          });
        });
        if (!hojaUsada) { alert('No encontré CUIT (11 números) en ese Excel.'); return; }
        listas[catActual] = $('cuits').value;
        var resumen = [];
        CATEGORIAS.forEach(function (c) {
          if (!porCat[c.id]) return;
          var ya = {};
          leerLista(listas[c.id] || '', c.id).forEach(function (x) { ya[x.cuit] = true; });
          var nuevos = porCat[c.id].filter(function (r) { var d = soloNumeros(r).slice(0, 11); if (ya[d]) return false; ya[d] = true; return true; });
          if (nuevos.length) {
            var actual = String(listas[c.id] || '').replace(/\s+$/, '');
            listas[c.id] = (actual ? actual + '\n' : '') + nuevos.join('\n');
          }
          resumen.push(c.nombre + ': ' + nuevos.length + (nuevos.length === 1 ? ' nuevo' : ' nuevos'));
        });
        $('cuits').value = listas[catActual] || '';
        actualizarEstadoLista();
        alert('Excel importado (' + total + ' CUIT leídos).\n' + resumen.join('\n'));
      } catch (e) {
        alert('No se pudo leer el Excel: ' + e.message);
      }
    };
    lector.readAsArrayBuffer(archivo);
  }

  // ---------------------------------------------------------------------------
  function iniciar() {
    cargarListas();
    cargarTc();
    renderTc();
    traerTc(false);
    document.querySelectorAll('input[name="tc-modo"]').forEach(function (r) {
      r.addEventListener('change', function () {
        tc.modo = this.value;
        guardarTc();
        renderTc();
        renderTabla();
        if (tc.modo === 'mes') traerMeses(false);
      });
    });
    $('tc-hoy').addEventListener('change', function () {
      var v = leerNumero(this.value);
      tc.hoy = v ? { valor: v, fecha: isoFecha(new Date()), manual: true } : null;
      guardarTc();
      renderTc();
      renderTabla();
    });
    $('tc-meses').addEventListener('change', function (e) {
      var m = e.target.getAttribute('data-mes');
      if (!m) return;
      var v = leerNumero(e.target.value);
      if (v) tc.meses[m] = { valor: v, manual: true }; else delete tc.meses[m];
      guardarTc();
      renderTc();
      renderTabla();
    });
    $('btn-tc').addEventListener('click', function () { traerTc(true); });
    $('cuits').value = listas[catActual] || '';
    actualizarEstadoLista();
    $('solapas').addEventListener('click', function (e) {
      var b = e.target.closest('[data-cat]');
      if (b && b.getAttribute('data-cat') !== catActual) elegirCategoria(b.getAttribute('data-cat'));
    });
    $('filtros').addEventListener('click', function (e) {
      var b = e.target.closest('[data-filtro]');
      if (!b) return;
      filtro = b.getAttribute('data-filtro');
      renderTabla();
    });
    $('cuits').addEventListener('input', actualizarEstadoLista);
    $('archivo-excel').addEventListener('change', function () {
      if (this.files && this.files[0]) leerExcel(this.files[0]);
      this.value = '';
    });
    $('btn-limpiar').addEventListener('click', function () {
      if ($('cuits').value && !confirm('¿Borrar todos los CUIT de ' + nombreCat(catActual) + '?')) return;
      $('cuits').value = '';
      actualizarEstadoLista();
    });
    $('btn-consultar').addEventListener('click', function () { consultar(false); });
    $('btn-consultar-todas').addEventListener('click', function () { consultar(true); });
    $('btn-detener').addEventListener('click', function () { detener = true; $('progreso').textContent = 'Deteniendo…'; });
    $('btn-excel').addEventListener('click', bajarExcel);
    $('tabla-resultados').addEventListener('click', function (e) {
      if (e.target.closest('.bcra-detalle')) return;
      var fila = e.target.closest('.bcra-fila');
      if (!fila) return;
      var det = document.querySelector('[data-det="' + fila.getAttribute('data-i') + '"]');
      if (det) det.hidden = !det.hidden;
    });
  }

  iniciar();
})();
