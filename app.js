/*
 * Consulta BCRA: toma una lista de CUIT y consulta, uno por uno, la Central de Deudores
 * del BCRA a través de /api/bcra (función de Vercel, ver api/bcra.js).
 */
(function () {
  'use strict';

  var CLAVE_TEXTO = 'consulta-bcra.cuits'; // versión anterior (una sola lista)
  var CLAVE_LISTAS = 'consulta-bcra.listas';
  var CLAVE_CAT = 'consulta-bcra.categoria';
  var CLAVE_MARCADOS = 'consulta-bcra.marcados';
  var marcados = {};    // 'categoria:cuit' -> true (tildados para consultar)
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
    }).then(function () { return traerMeses(forzar); });
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

  function clave(cat, cuit) { return cat + ':' + cuit; }
  function tildados(cat) {
    return leerLista(listas[cat] || '', cat).filter(function (x) { return marcados[clave(cat, x.cuit)]; });
  }

  function actualizarEstadoLista() {
    listas[catActual] = $('cuits').value;
    guardarListas();
    renderLista();
    renderSolapas();
  }

  // Lista con casillas de la categoría elegida (filtrada por el buscador).
  function visibles() {
    var q = $('buscar').value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    var qn = soloNumeros(q);
    return leerLista(listas[catActual] || '', catActual).filter(function (x) {
      if (!q) return true;
      var nom = x.referencia.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return nom.indexOf(q) !== -1 || (qn.length >= 3 && x.cuit.indexOf(qn) !== -1);
    });
  }

  function renderLista() {
    var todos = leerLista(listas[catActual] || '', catActual);
    var vis = visibles();
    $('lista-cuits').innerHTML = !todos.length
      ? '<li class="l-vacio">Todavía no hay CUIT en ' + escapar(nombreCat(catActual)) + '. Cargalos en «Agregar o editar CUIT» o con «Importar Excel».</li>'
      : !vis.length ? '<li class="l-vacio">Ninguno coincide con la búsqueda.</li>'
      : vis.map(function (x) {
        return '<li><label><input type="checkbox" data-cuit="' + x.cuit + '"' + (marcados[clave(catActual, x.cuit)] ? ' checked' : '') + '>' +
          '<span class="l-cuit">' + fmtCuit(x.cuit) + '</span><span class="l-nombre">' + escapar(x.referencia) + '</span>' +
          (x.valido ? '' : '<span class="l-malo" title="El dígito verificador no coincide">CUIT dudoso</span>') + '</label></li>';
      }).join('');
    var n = todos.filter(function (x) { return marcados[clave(catActual, x.cuit)]; }).length;
    var total = 0;
    CATEGORIAS.forEach(function (c) { total += tildados(c.id).length; });
    $('cuits-estado').textContent = todos.length
      ? n + ' de ' + todos.length + ' tildados en ' + nombreCat(catActual) + (total !== n ? ' (' + total + ' en todas las categorías).' : '.')
      : '';
    if (!todos.length) $('editar-lista').open = true;
  }

  function guardarMarcados() {
    try { localStorage.setItem(CLAVE_MARCADOS, JSON.stringify(marcados)); } catch (e) { /* nada */ }
  }

  function guardarListas() {
    try { localStorage.setItem(CLAVE_LISTAS, JSON.stringify(listas)); localStorage.setItem(CLAVE_CAT, catActual); } catch (e) { /* nada */ }
  }

  function cargarListas() {
    try { listas = JSON.parse(localStorage.getItem(CLAVE_LISTAS) || '{}') || {}; } catch (e) { listas = {}; }
    try { marcados = JSON.parse(localStorage.getItem(CLAVE_MARCADOS) || '{}') || {}; } catch (e) { marcados = {}; }
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
      var n = leerLista(listas[c.id] || '', c.id).length, t = tildados(c.id).length;
      return '<button type="button" class="solapa" role="tab" data-cat="' + c.id + '" aria-selected="' + (c.id === catActual) + '" title="' + t + ' tildados de ' + n + '">' +
        escapar(c.nombre) + '<span class="cuenta">' + (t ? t + '/' : '') + n + '</span></button>';
    }).join('');
    $('nombre-cat').textContent = nombreCat(catActual);
  }

  function elegirCategoria(id) {
    listas[catActual] = $('cuits').value;
    catActual = id;
    $('cuits').value = listas[id] || '';
    $('buscar').value = '';
    $('editar-lista').open = false;
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
      var jud = (p.entidades || []).some(function (e) { return e.procesoJud || e.situacionJuridica; });
      return { periodo: p.periodo, peor: peor, total: total, cantidad: (p.entidades || []).length, jud: jud };
    }).sort(function (a, b) { return String(b.periodo).localeCompare(String(a.periodo)); });
  }

  // ---------------------------------------------------------------------------
  // Puntaje propio (1 a 999) con datos públicos del BCRA. NO es el score de Nosis ni de otro buró.
  // ---------------------------------------------------------------------------
  var BASE_SIT = { 0: 750, 1: 850, 2: 600, 3: 400, 4: 250, 5: 100, 6: 100 };

  // peor: situación del mes; anteriores: peor situación de los meses previos (hasta 24);
  // cheques: lista de cheques rechazados; marcas: { jud, irrec, refi, recat }.
  function calcPuntaje(peor, anteriores, cheques, marcas) {
    var hayAlgo = peor > 0 || anteriores.some(function (s) { return s > 0; }) || (cheques && cheques.length);
    if (!hayAlgo) return null;
    var p = BASE_SIT[peor] != null ? BASE_SIT[peor] : 100;
    var castigo = 0, premio = 0;
    anteriores.forEach(function (s) {
      if (s >= 4) castigo += 25; else if (s === 3) castigo += 15; else if (s === 2) castigo += 8;
      else if (s === 1) premio += 4;
    });
    p += -Math.min(castigo, 250) + Math.min(premio, 96);
    if (cheques && cheques.length) {
      var impagos = cheques.filter(function (c) { return !c.fechaPago; }).length;
      p -= Math.min(impagos * 60, 300) + Math.min((cheques.length - impagos) * 15, 60);
    }
    marcas = marcas || {};
    if (marcas.jud) p -= 150;
    if (marcas.irrec) p -= 150;
    if (marcas.refi) p -= 40;
    if (marcas.recat) p -= 40;
    return Math.max(1, Math.min(999, Math.round(p)));
  }

  function puntaje(r) {
    if (r.error || !r.deudas) return null;
    var ents = r.deudas.entidades || [];
    var marcas = {
      jud: ents.some(function (e) { return e.procesoJud || e.situacionJuridica; }),
      irrec: ents.some(function (e) { return e.irrecDisposicionTecnica; }),
      refi: ents.some(function (e) { return e.refinanciaciones; }),
      recat: ents.some(function (e) { return e.recategorizacionOblig; })
    };
    var anteriores = (r.historicas || []).filter(function (p) { return p.periodo < r.deudas.periodo; }).map(function (p) { return p.peor; });
    return calcPuntaje(r.deudas.peor, anteriores, r.cheques, marcas);
  }

  // Puntaje de cada mes del historial (sin cheques: el BCRA no los informa por mes).
  function puntajeMes(hist, i) {
    var anteriores = hist.slice(i + 1, i + 25).map(function (p) { return p.peor; });
    return calcPuntaje(hist[i].peor, anteriores, null, { jud: hist[i].jud });
  }

  function bandaPuntaje(n) { return n == null ? 0 : n >= 750 ? 1 : n >= 550 ? 2 : n >= 350 ? 3 : 5; }
  function etiquetaPuntaje(n) {
    return n == null ? '<span class="sit sit-0" title="Sin deudas ni cheques informados">—</span>'
      : '<span class="sit sit-' + bandaPuntaje(n) + '">' + n + '</span>';
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
      lista = lista.concat(tildados(id));
    });
    if (!lista.length) { alert(todas ? 'No hay CUIT tildados en ninguna categoría.' : 'Tildá al menos un CUIT de ' + nombreCat(catActual) + ' (o tocá «Marcar todos»).'); return; }
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
      traerMeses(false);
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

  var MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  function pasoRedondo(max) {
    var bruto = max / 4, pot = Math.pow(10, Math.floor(Math.log10(bruto || 1)));
    var n = bruto / pot;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pot;
  }
  function fmtCorto(v) {
    if (v >= 1e9) return (v / 1e9).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + ' mil M';
    if (v >= 1e6) return (v / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + ' M';
    if (v >= 1e3) return (v / 1e3).toLocaleString('es-AR', { maximumFractionDigits: 0 }) + ' mil';
    return String(v);
  }

  function htmlEvolucion(r) {
    var hist = r.historicas || [];             // del más nuevo al más viejo
    var asc = hist.slice().reverse();          // del más viejo al más nuevo
    var n = asc.length;
    // Grilla por mes (como los informes comerciales): puntaje, bancos y situación.
    var h = '<h4>Evolución de los últimos 24 meses</h4><div class="bcra-tabla-cont"><table class="evo-grid"><thead><tr><th></th>';
    asc.forEach(function (p) { var s = String(p.periodo); h += '<th>' + s.slice(4) + '<br>' + s.slice(2, 4) + '</th>'; });
    h += '</tr></thead><tbody><tr><th>Puntaje</th>';
    asc.forEach(function (p, k) { var v = puntajeMes(hist, n - 1 - k); h += '<td>' + (v == null ? '–' : v) + '</td>'; });
    h += '</tr><tr><th>Bancos</th>';
    asc.forEach(function (p) { h += '<td>' + (p.cantidad || '–') + '</td>'; });
    h += '</tr><tr><th>Situación</th>';
    asc.forEach(function (p) {
      h += p.peor ? '<td class="celda-sit s' + Math.min(p.peor, 5) + '" title="' + escapar(nombreSit(p.peor)) + '">' + p.peor + '</td>' : '<td>–</td>';
    });
    h += '</tr></tbody></table></div>';

    // Gráfico de barras: deuda total por mes, color según la peor situación del mes.
    var W = 720, H = 250, iz = 70, de = 10, ar = 22, ab = 26;
    var max = 0;
    asc.forEach(function (p) { max = Math.max(max, p.total * 1000); });
    if (!max) return h + '<p>No tuvo deudas en los últimos 24 meses.</p>';
    var paso = pasoRedondo(max), tope = Math.ceil(max / paso) * paso;
    var alto = H - ar - ab, ancho = W - iz - de, slot = ancho / Math.max(n, 1), bw = Math.max(4, Math.min(22, slot * 0.6));
    var y = function (v) { return ar + alto - (v / tope) * alto; };
    var s = '<svg class="evo-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Deuda total por mes, últimos 24 meses">';
    for (var t = 0; t <= tope + 1e-6; t += paso) {
      s += '<line class="evo-grilla" x1="' + iz + '" x2="' + (W - de) + '" y1="' + y(t) + '" y2="' + y(t) + '"/>' +
        '<text class="evo-eje" x="' + (iz - 8) + '" y="' + (y(t) + 4) + '" text-anchor="end">' + escapar(fmtCorto(t)) + '</text>';
    }
    asc.forEach(function (p, k) {
      var cx = iz + slot * k + slot / 2, mes = Number(String(p.periodo).slice(4)), anio = String(p.periodo).slice(0, 4);
      if (mes === 1 || k === 0) {
        var xl = iz + slot * k + 1;
        s += '<line class="evo-anio" x1="' + xl + '" x2="' + xl + '" y1="' + (ar - 14) + '" y2="' + (ar + alto) + '"/>' +
          '<text class="evo-eje evo-anio-txt" x="' + (xl + 4) + '" y="' + (ar - 4) + '">' + anio + '</text>';
      }
      s += '<text class="evo-eje" x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle">' + MESES[mes - 1] + '</text>';
      var v = p.total * 1000;
      if (v > 0) {
        var yt = y(v), x0 = cx - bw / 2, rr = Math.min(4, bw / 2, ar + alto - yt);
        s += '<path class="evo-barra s' + Math.min(p.peor || 1, 5) + '" d="M' + x0 + ',' + (ar + alto) + 'V' + (yt + rr) + 'Q' + x0 + ',' + yt + ' ' + (x0 + rr) + ',' + yt +
          'H' + (x0 + bw - rr) + 'Q' + (x0 + bw) + ',' + yt + ' ' + (x0 + bw) + ',' + (yt + rr) + 'V' + (ar + alto) + 'Z"/>';
      }
      var usd = enDolares(p.total, p.periodo);
      var tip = fmtPeriodo(p.periodo) + '|Deuda: ' + fmtPesos(p.total) + (usd !== null ? ' (US$ ' + usd.toLocaleString('es-AR') + ')' : '') +
        '|Situación: ' + (p.peor ? p.peor + ' · ' + nombreSit(p.peor) : 'sin deuda') + '|Bancos: ' + p.cantidad;
      s += '<rect class="evo-hit" x="' + (iz + slot * k) + '" y="' + ar + '" width="' + slot + '" height="' + alto + '" data-tip="' + escapar(tip) + '"/>';
    });
    s += '<line class="evo-base" x1="' + iz + '" x2="' + (W - de) + '" y1="' + (ar + alto) + '" y2="' + (ar + alto) + '"/></svg>';
    h += '<div class="evo-grafico">' + s + '</div><div class="evo-leyenda">' +
      [1, 2, 3, 4, 5].map(function (k) { return '<span><i class="s' + k + '"></i>' + k + ' · ' + escapar(SITUACIONES[k]) + '</span>'; }).join('') + '</div>';
    return h;
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
    var pj = puntaje(r);
    h += '<h4>Puntaje propio</h4><p>' + etiquetaPuntaje(pj) + ' ' + (pj == null ? 'Sin deudas ni cheques informados: no hay datos para calcularlo.' :
      'de 1 a 999, calculado con los datos del BCRA' + (r.historicas ? '' : ' (sin historial: tildá «Historial y gráfico» para que sea más preciso)') + '.') + '</p>';
    if (r.historicas) {
      if (r.historicas.length) {
        h += htmlEvolucion(r);
        h += '<details><summary class="ayuda">Ver el historial en tabla</summary><div class="bcra-tabla-cont"><table><thead><tr>' +
          '<th>Período</th><th>Peor situación</th><th class="der">Deuda total</th><th class="der">Entidades</th></tr></thead><tbody>';
        r.historicas.forEach(function (p) {
          h += '<tr><td>' + escapar(fmtPeriodo(p.periodo)) + '</td><td>' + etiquetaSit(p.peor) + '</td><td class="der">' + fmtMonto(p.total, p.periodo) +
            '</td><td class="der">' + p.cantidad + '</td></tr>';
        });
        h += '</tbody></table></div></details>';
      } else {
        h += '<h4>Historial (24 meses)</h4><p>Sin datos históricos.</p>';
      }
    }
    return h;
  }

  // ---------------------------------------------------------------------------
  // Cuadro mensual (como la planilla de deudas bancarias): por empresa y por mes,
  // deuda en pesos, equivalente en dólares (dólar BNA de ese mes), variación y deuda sobre facturación.
  // ---------------------------------------------------------------------------
  var CLAVE_FACT = 'consulta-bcra.facturacion';
  var facturacion = {};   // cuit -> texto, por ejemplo «400/430 MILL»
  var MESES_LARGOS = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

  function cargarFacturacion() { try { facturacion = JSON.parse(localStorage.getItem(CLAVE_FACT) || '{}') || {}; } catch (e) { facturacion = {}; } }
  function guardarFacturacion() { try { localStorage.setItem(CLAVE_FACT, JSON.stringify(facturacion)); } catch (e) { /* nada */ } }

  // «400/430 MILL» -> 430.000.000 (se toma el número más alto del rango, en dólares).
  function facturacionUsd(t) {
    t = String(t || '');
    var nums = (t.match(/\d+(?:[.,]\d+)*/g) || []).map(leerNumero).filter(Boolean);
    if (!nums.length) return 0;
    var max = Math.max.apply(null, nums);
    if (/mil+\b|mill|mm|\bm\b/i.test(t) || max < 100000) max *= 1e6;
    return max;
  }

  function mesAnterior(p) {
    var y = Number(String(p).slice(0, 4)), m = Number(String(p).slice(4)) - 1;
    if (m < 1) { m = 12; y--; }
    return y + String(m).padStart(2, '0');
  }
  function tcDelMes(p) { var x = tc.meses[String(p)]; return x && x.valor ? x.valor : 0; }

  function datosCuadro(lista, cantMeses) {
    var todos = {};
    lista.forEach(function (r) { (r.historicas || []).forEach(function (p) { todos[p.periodo] = true; }); });
    var meses = Object.keys(todos).sort().slice(-cantMeses);
    var filasC = lista.filter(function (r) { return !r.error && r.historicas; }).map(function (r) {
      var porMes = {};
      r.historicas.forEach(function (p) { porMes[p.periodo] = p; });
      var fact = facturacionUsd(facturacion[r.cuit]);
      var celdas = meses.map(function (m) {
        var p = porMes[m];
        if (!p) return null;
        var pesos = Math.round(p.total * 1000), t = tcDelMes(m), usd = t ? pesos / t : null;
        var ant = porMes[mesAnterior(m)], tAnt = tcDelMes(mesAnterior(m));
        var usdAnt = ant && tAnt ? ant.total * 1000 / tAnt : null;
        return {
          pesos: pesos, usd: usd, peor: p.peor,
          variacion: usd !== null && usdAnt ? usd / usdAnt - 1 : null
        };
      });
      var ultima = celdas[celdas.length - 1];
      // Deuda del último mes sobre la facturación (sin deuda ese mes: 0%).
      var usdFinal = !ultima ? 0 : ultima.usd;
      return {
        r: r, celdas: celdas, orden: ultima ? ultima.pesos : -1,
        sobreFact: fact && usdFinal !== null ? usdFinal / fact : null
      };
    }).sort(function (x, y) { return y.orden - x.orden; });
    return { meses: meses, filas: filasC };
  }

  function fmtPct(v, dec) {
    if (v === null || v === undefined || !isFinite(v)) return '';
    return (v * 100).toLocaleString('es-AR', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 }) + '%';
  }

  function renderCuadro() {
    var lista = resultados.filter(function (r) { return (!filtro || r.categoria === filtro) && !r.error && r.historicas; });
    $('sec-cuadro').hidden = !lista.length;
    if (!lista.length) return;
    var dc = datosCuadro(lista, Number($('cuadro-meses').value) || 8);
    var faltan = dc.meses.filter(function (m) { return !tcDelMes(m); });
    var ultimoMes = dc.meses[dc.meses.length - 1];
    var h = '<table class="cuadro"><thead><tr><th rowspan="3" class="c-fijo c-fact">Facturación aprox. (US$)</th><th rowspan="3" class="c-fijo c-emp">Empresa</th>';
    dc.meses.forEach(function (m) { h += '<th colspan="3" class="c-mes">' + MESES_LARGOS[Number(m.slice(4)) - 1] + ' ' + m.slice(0, 4) + '</th>'; });
    h += '<th rowspan="3" class="c-final">Deuda sobre<br>facturación<br><span class="c-final-mes">(' + fmtPeriodo(ultimoMes) + ')</span></th></tr><tr>';
    dc.meses.forEach(function (m) {
      var t = tcDelMes(m);
      h += '<th colspan="3" class="c-tc">' + (t ? 'US$ 1 = $ ' + fmtTc(t) : '<span class="c-falta">Falta el dólar</span>') + '</th>';
    });
    h += '</tr><tr>';
    dc.meses.forEach(function () { h += '<th class="c-sub">Pesos</th><th class="c-sub">Eq. dólares</th><th class="c-sub c-fin" title="Contra la deuda del mes anterior">Var. mes ant.</th>'; });
    h += '</tr></thead><tbody>';
    dc.filas.forEach(function (f) {
      h += '<tr><td class="c-fijo c-fact"><input type="text" data-fact="' + f.r.cuit + '" value="' + escapar(facturacion[f.r.cuit] || '') + '" placeholder="Ej.: 400/430 MILL"></td>' +
        '<td class="c-fijo c-emp"><strong>' + escapar(f.r.nombre || f.r.referencia || fmtCuit(f.r.cuit)) + '</strong><span class="ayuda">' + fmtCuit(f.r.cuit) + '</span></td>';
      f.celdas.forEach(function (c) {
        if (!c) { h += '<td class="der">–</td><td></td><td class="c-fin"></td>'; return; }
        var v = c.variacion;
        h += '<td class="der">$ ' + c.pesos.toLocaleString('es-AR') + '</td>' +
          '<td class="der">' + (c.usd === null ? '–' : 'US$ ' + Math.round(c.usd).toLocaleString('es-AR')) + '</td>' +
          '<td class="der c-fin ' + (v > 0 ? 'c-sube' : v < 0 ? 'c-baja' : '') + '">' + (v === null ? '' : (v > 0 ? '▲ ' : v < 0 ? '▼ ' : '') + fmtPct(Math.abs(v), 1)) + '</td>';
      });
      var sf = f.sobreFact;
      h += '<td class="der c-final ' + (sf === null ? '' : sf >= 1 ? 'c-alto' : sf >= 0.5 ? 'c-medio' : '') + '">' +
        (sf === null ? (facturacionUsd(facturacion[f.r.cuit]) ? '' : '<span class="ayuda">Falta facturación</span>') : fmtPct(sf)) + '</td></tr>';
    });
    h += '</tbody></table>';
    $('cuadro').innerHTML = h;
    $('cuadro-estado').textContent = faltan.length
      ? 'Falta el dólar de ' + faltan.map(fmtPeriodo).join(', ') + ': se busca solo en el Banco Nación; si no aparece, cargalo en «Dólar por mes».' : '';
  }

  function hojaCuadro(lista) {
    var dc = datosCuadro(lista, Number($('cuadro-meses').value) || 8);
    var fmtP = '"$" #,##0', fmtU = '"US$" #,##0', fmtV = '0.0%', fmtF = '0%';
    var ultimoMes = dc.meses[dc.meses.length - 1] || '';
    var f1 = ['', '', ''], f2 = ['FACTURACION APROX.', 'EMPRESA', 'CUIT'], f3 = ['', '', ''];
    var merges = [{ s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }, { s: { r: 1, c: 1 }, e: { r: 2, c: 1 } }, { s: { r: 1, c: 2 }, e: { r: 2, c: 2 } }];
    dc.meses.forEach(function (m, k) {
      var c0 = 3 + k * 3;
      f1.push('Dólar BNA', tcDelMes(m) || '', '');
      f2.push(MESES_LARGOS[Number(m.slice(4)) - 1] + ' ' + m.slice(0, 4), '', '');
      f3.push('PESOS', 'EQ. DOLARES', 'VARIACION MES ANT.');
      merges.push({ s: { r: 1, c: c0 }, e: { r: 1, c: c0 + 2 } });
    });
    var cFinal = 3 + dc.meses.length * 3;
    f1.push('');
    f2.push('DEUDA SOBRE FACT. APROX. (' + fmtPeriodo(ultimoMes) + ')');
    f3.push('');
    merges.push({ s: { r: 1, c: cFinal }, e: { r: 2, c: cFinal } });
    var aoa = [f1, f2, f3];
    dc.filas.forEach(function (f) {
      var fila = [facturacion[f.r.cuit] || '', f.r.nombre || f.r.referencia || '', fmtCuit(f.r.cuit)];
      f.celdas.forEach(function (c) {
        if (!c) fila.push('', '', '');
        else fila.push(c.pesos, c.usd === null ? '' : c.usd, c.variacion === null ? '' : c.variacion);
      });
      fila.push(f.sobreFact === null ? '' : f.sobreFact);
      aoa.push(fila);
    });
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = merges;
    ws['!cols'] = [{ wch: 18 }, { wch: 28 }, { wch: 15 }].concat(dc.meses.reduce(function (acc) { return acc.concat([{ wch: 18 }, { wch: 15 }, { wch: 12 }]); }, []), [{ wch: 20 }]);
    var formatos = [fmtP, fmtU, fmtV];
    for (var R = 3; R < aoa.length; R++) {
      for (var C = 3; C < aoa[R].length; C++) {
        var cel = ws[XLSX.utils.encode_cell({ r: R, c: C })];
        if (cel && cel.t === 'n') cel.z = C === cFinal ? fmtF : formatos[(C - 3) % 3];
      }
    }
    dc.meses.forEach(function (m, k) {
      var cel = ws[XLSX.utils.encode_cell({ r: 0, c: 4 + k * 3 })];
      if (cel && cel.t === 'n') cel.z = '"$" #,##0.00';
    });
    return ws;
  }

  function renderTabla() {
    var tb = $('tabla-resultados');
    if (!consultando && !resultados.length) return;
    renderFiltros();
    if (!resultados.length) { tb.innerHTML = '<tr><td colspan="9">Consultando…</td></tr>'; return; }
    tb.innerHTML = resultados.map(function (r, i) {
      if (filtro && r.categoria !== filtro) return '';
      var cat = '<td class="nowrap">' + escapar(nombreCat(r.categoria)) + '</td>';
      var nombre = escapar(r.nombre || r.referencia || '');
      if (r.nombre && r.referencia && r.referencia !== r.nombre) nombre += '<br><span class="ayuda">' + escapar(r.referencia) + '</span>';
      if (r.error) {
        return '<tr><td class="nowrap">' + fmtCuit(r.cuit) + '</td><td>' + nombre + '</td>' + cat + '<td colspan="6"><span class="sit sit-err">Error</span> ' + escapar(r.error) + '</td></tr>';
      }
      var d = r.deudas;
      return '<tr class="bcra-fila" data-i="' + i + '" title="Ver detalle"><td class="nowrap">' + fmtCuit(r.cuit) + '</td><td>' + nombre +
        '</td>' + cat + '<td class="nowrap">' + escapar(fmtPeriodo(d.periodo)) + '</td><td>' + etiquetaSit(d.peor) +
        '</td><td>' + etiquetaPuntaje(puntaje(r)) + '</td><td class="der">' + (d.entidades.length ? fmtMonto(d.total, d.periodo) : '—') + '</td><td class="der">' + d.entidades.length +
        '</td><td class="der">' + (r.cheques ? r.cheques.length : '—') + '</td></tr>' +
        '<tr class="bcra-detalle" data-det="' + i + '" hidden><td colspan="9">' + htmlDetalle(r) + '</td></tr>';
    }).join('');
    renderCuadro();
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
        'Puntaje propio': puntaje(r) == null ? '' : puntaje(r),
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
          'Categoría': nombreCat(r.categoria), CUIT: fmtCuit(r.cuit), Nombre: r.nombre || '', 'Período': fmtPeriodo(p.periodo), 'Peor situación': p.peor, 'Puntaje propio': puntajeMes(r.historicas, r.historicas.indexOf(p)),
          'Deuda total ($)': Math.round(p.total * 1000), 'Deuda total (US$)': enDolares(p.total, p.periodo),
          'Dólar usado': tcPara(p.periodo) || '', Entidades: p.cantidad
        });
      });
    });
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumen), 'Resumen');
    if (elegidos.some(function (r) { return r.historicas && r.historicas.length; })) XLSX.utils.book_append_sheet(wb, hojaCuadro(elegidos), 'Cuadro mensual');
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
          var colNombre = -1, colCat = -1, colFact = -1;
          var iTit = 0;
          for (var q = 0; q < Math.min(filas.length, 10); q++) {
            if (filas[q].some(function (t) { return /nombre|cliente|raz[oó]n|denominaci|empresa|categor|factur/i.test(String(t)); })) { iTit = q; break; }
          }
          (filas[iTit] || []).forEach(function (t, j) {
            if (colFact === -1 && /factur/i.test(String(t))) colFact = j;
            t = String(t);
            if (colNombre === -1 && /nombre|cliente|raz[oó]n|denominaci|proveedor|empresa/i.test(t) && !/cuit|factur/i.test(t)) colNombre = j;
            if (colCat === -1 && /categor|^tipo|rubro|grupo/i.test(t.trim())) colCat = j;
          });
          if (colNombre === colCat) colNombre = -1;
          filas.forEach(function (fila) {
            for (var j = 0; j < fila.length; j++) {
              var d = soloNumeros(fila[j]);
              if (d.length === 11 && j !== colCat && j !== colFact) {
                if (colFact >= 0 && String(fila[colFact]).trim()) facturacion[d] = String(fila[colFact]).trim();
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
        guardarFacturacion();
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
    cargarFacturacion();
    $('cuadro-meses').addEventListener('change', renderCuadro);
    $('cuadro').addEventListener('change', function (e) {
      var c = e.target.getAttribute('data-fact');
      if (!c) return;
      if (e.target.value.trim()) facturacion[c] = e.target.value.trim(); else delete facturacion[c];
      guardarFacturacion();
      renderCuadro();
    });
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
    $('buscar').addEventListener('input', renderLista);
    $('lista-cuits').addEventListener('change', function (e) {
      var d = e.target.getAttribute('data-cuit');
      if (!d) return;
      if (e.target.checked) marcados[clave(catActual, d)] = true; else delete marcados[clave(catActual, d)];
      guardarMarcados();
      renderLista();
      renderSolapas();
    });
    function marcarVisibles(si) {
      visibles().forEach(function (x) { if (si) marcados[clave(catActual, x.cuit)] = true; else delete marcados[clave(catActual, x.cuit)]; });
      guardarMarcados();
      renderLista();
      renderSolapas();
    }
    $('btn-marcar-todos').addEventListener('click', function () { marcarVisibles(true); });
    $('btn-marcar-ninguno').addEventListener('click', function () { marcarVisibles(false); });
    $('btn-limpiar').addEventListener('click', function () {
      if ($('cuits').value && !confirm('¿Borrar todos los CUIT de ' + nombreCat(catActual) + '?')) return;
      $('cuits').value = '';
      actualizarEstadoLista();
    });
    $('btn-consultar').addEventListener('click', function () { consultar(false); });
    $('btn-consultar-todas').addEventListener('click', function () { consultar(true); });
    $('btn-detener').addEventListener('click', function () { detener = true; $('progreso').textContent = 'Deteniendo…'; });
    $('btn-excel').addEventListener('click', bajarExcel);
    var tip = $('tip');
    document.addEventListener('mousemove', function (e) {
      var t = e.target.closest && e.target.closest('[data-tip]');
      if (!t) { tip.hidden = true; return; }
      var partes = t.getAttribute('data-tip').split('|');
      tip.innerHTML = '<strong>' + escapar(partes[0]) + '</strong>' + partes.slice(1).map(function (x) { return '<br>' + escapar(x); }).join('');
      tip.hidden = false;
      var x = e.clientX + 14, yy = e.clientY + 14;
      if (x + tip.offsetWidth > window.innerWidth - 8) x = e.clientX - tip.offsetWidth - 14;
      if (yy + tip.offsetHeight > window.innerHeight - 8) yy = e.clientY - tip.offsetHeight - 14;
      tip.style.left = x + 'px';
      tip.style.top = yy + 'px';
    });
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
