/*
 * Reportes en PDF (jsPDF + AutoTable):
 *  - individual: una o más páginas por CUIT, con situación, puntaje, deudas por entidad,
 *    cheques, grilla de 24 meses y gráfico de barras.
 *  - grupo: resumen de las empresas consultadas y cuadro mensual (pesos, dólares, variación
 *    y deuda sobre facturación).
 * Usa los datos que expone app.js en window.ConsultaBCRA.
 */
(function () {
  'use strict';

  var C = function () { return window.ConsultaBCRA; };
  var BORDO = [143, 19, 28], GRIS = [91, 91, 95], GRIS_CLARO = [236, 236, 237], TEXTO = [34, 34, 38];
  var COLOR_SIT = { 0: [200, 200, 204], 1: [47, 143, 78], 2: [217, 164, 0], 3: [224, 108, 0], 4: [198, 40, 40], 5: [122, 31, 31], 6: [122, 31, 31] };
  var M = 12; // margen en mm

  var logo = null; // { data, ancho, alto }
  function cargarLogo() {
    if (logo) return Promise.resolve(logo);
    return new Promise(function (ok) {
      var img = new Image();
      img.onload = function () {
        try {
          var c = document.createElement('canvas');
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0);
          logo = { data: c.toDataURL('image/png'), ancho: img.naturalWidth, alto: img.naturalHeight };
        } catch (e) { logo = { data: null }; }
        ok(logo);
      };
      img.onerror = function () { logo = { data: null }; ok(logo); };
      img.src = 'logo-morero.png';
    });
  }

  function pesos(n) { return '$ ' + Math.round(n || 0).toLocaleString('es-AR'); }
  function usd(n) { return n === null || n === undefined ? '-' : 'US$ ' + Math.round(n).toLocaleString('es-AR'); }
  function pct(v, dec) {
    if (v === null || v === undefined || !isFinite(v)) return '';
    return (v * 100).toLocaleString('es-AR', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 }) + '%';
  }
  function millones(n, dec) { return (n / 1e6).toLocaleString('es-AR', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 }); }
  function hoyTexto() {
    var d = new Date();
    return d.toLocaleDateString('es-AR') + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  }
  function hoyArchivo() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function limpiarNombreArchivo(t) { return String(t || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60); }

  // Encabezado: logo, título, subtítulo y línea bordó. Devuelve la Y donde sigue el contenido.
  function encabezado(doc, titulo, subtitulo) {
    var ancho = doc.internal.pageSize.getWidth();
    var y = M;
    if (logo && logo.data) {
      var h = 14, w = h * logo.ancho / logo.alto;
      doc.addImage(logo.data, 'PNG', M, y, w, h);
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor.apply(doc, BORDO);
    doc.text(titulo, ancho - M, y + 6, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor.apply(doc, GRIS);
    doc.text(subtitulo, ancho - M, y + 11.5, { align: 'right' });
    y += 17;
    doc.setDrawColor.apply(doc, BORDO); doc.setLineWidth(0.8);
    doc.line(M, y, ancho - M, y);
    return y + 6;
  }

  function piePaginas(doc, texto) {
    var n = doc.getNumberOfPages(), ancho = doc.internal.pageSize.getWidth(), alto = doc.internal.pageSize.getHeight();
    for (var i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor.apply(doc, GRIS);
      doc.text(texto, M, alto - 7, { maxWidth: ancho - 2 * M - 25 });
      doc.text('Página ' + i + ' de ' + n, ancho - M, alto - 7, { align: 'right' });
    }
  }

  function subtitulo(doc, texto, y) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor.apply(doc, BORDO);
    doc.text(texto, M, y);
    return y + 3;
  }

  // Si no entra lo que sigue (alto en mm), nueva página.
  function lugar(doc, y, alto, titulo, sub) {
    if (y + alto <= doc.internal.pageSize.getHeight() - 14) return y;
    doc.addPage();
    return encabezado(doc, titulo, sub);
  }

  // Recuadros de resumen (situación, puntaje, deuda, entidades, cheques).
  function tarjetas(doc, y, items) {
    var ancho = doc.internal.pageSize.getWidth() - 2 * M, sep = 3, w = (ancho - sep * (items.length - 1)) / items.length, h = 18;
    items.forEach(function (it, k) {
      var x = M + k * (w + sep);
      doc.setDrawColor(214, 214, 217); doc.setLineWidth(0.3); doc.setFillColor(255, 255, 255);
      doc.roundedRect(x, y, w, h, 2, 2, 'FD');
      if (it.color) { doc.setFillColor.apply(doc, it.color); doc.rect(x, y + 2, 1.4, h - 4, 'F'); }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor.apply(doc, GRIS);
      doc.text(it.titulo, x + 4, y + 5.5);
      doc.setFont('helvetica', 'bold'); doc.setTextColor.apply(doc, TEXTO);
      var tam = it.chico ? 10.5 : 13;
      doc.setFontSize(tam);
      while (tam > 6 && doc.getTextWidth(String(it.valor)) > w - 6) { tam -= 0.5; doc.setFontSize(tam); }
      doc.text(String(it.valor), x + 4, y + 12);
      if (it.nota) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor.apply(doc, GRIS);
        doc.text(String(it.nota), x + 4, y + 16, { maxWidth: w - 6 });
      }
    });
    return y + h + 6;
  }

  var estiloTabla = {
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.6, lineColor: [225, 225, 228], lineWidth: 0.2, textColor: TEXTO },
    headStyles: { fillColor: GRIS_CLARO, textColor: GRIS, fontStyle: 'bold' },
    margin: { left: M, right: M, bottom: 16 }
  };
  function tabla(doc, opciones) {
    var o = {};
    Object.keys(estiloTabla).forEach(function (k) { o[k] = estiloTabla[k]; });
    Object.keys(opciones).forEach(function (k) { o[k] = opciones[k]; });
    doc.autoTable(o);
    return doc.lastAutoTable.finalY + 7;
  }

  // Gráfico de barras de la deuda mensual (color según la situación del mes).
  function grafico(doc, x, y, w, h, asc, Cx) {
    var max = 0;
    asc.forEach(function (p) { max = Math.max(max, p.total * 1000); });
    if (!max) return;
    var bruto = max / 4, pot = Math.pow(10, Math.floor(Math.log10(bruto || 1))), n = bruto / pot;
    var paso = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pot, tope = Math.ceil(max / paso) * paso;
    var iz = 20, ar = 6, ab = 7, alto = h - ar - ab, ancho = w - iz - 2;
    var slot = ancho / asc.length, bw = Math.min(5, slot * 0.6);
    var yv = function (v) { return y + ar + alto - (v / tope) * alto; };
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
    for (var t = 0; t <= tope + 1e-6; t += paso) {
      doc.setDrawColor(230, 230, 232); doc.setLineWidth(0.2);
      doc.line(x + iz, yv(t), x + w - 2, yv(t));
      doc.setTextColor.apply(doc, GRIS);
      var et = t >= 1e9 ? (t / 1e9).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + ' mil M' : t >= 1e6 ? (t / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + ' M' : t >= 1e3 ? (t / 1e3).toLocaleString('es-AR') + ' mil' : String(t);
      doc.text(et, x + iz - 2, yv(t) + 1, { align: 'right' });
    }
    asc.forEach(function (p, k) {
      var cx = x + iz + slot * k + slot / 2, mes = Number(String(p.periodo).slice(4));
      if (mes === 1 || k === 0) {
        var xl = x + iz + slot * k;
        doc.setDrawColor(200, 200, 204); doc.setLineDashPattern([0.8, 0.8], 0);
        doc.line(xl, y + 1, xl, y + ar + alto);
        doc.setLineDashPattern([], 0);
        doc.setFont('helvetica', 'bold'); doc.setTextColor.apply(doc, GRIS);
        doc.text(String(p.periodo).slice(0, 4), xl + 1, y + 3.5);
        doc.setFont('helvetica', 'normal');
      }
      var v = p.total * 1000;
      if (v > 0) {
        doc.setFillColor.apply(doc, COLOR_SIT[Math.min(p.peor || 1, 5)]);
        var yt = yv(v);
        doc.roundedRect(cx - bw / 2, yt, bw, y + ar + alto - yt, Math.min(0.8, (y + ar + alto - yt) / 2), Math.min(0.8, (y + ar + alto - yt) / 2), 'F');
        doc.rect(cx - bw / 2, Math.max(yt, y + ar + alto - 1), bw, Math.min(1, y + ar + alto - yt), 'F');
      }
      doc.setTextColor.apply(doc, GRIS);
      doc.text(Cx.MESES[mes - 1], cx, y + h - 2, { align: 'center' });
    });
    doc.setDrawColor(200, 200, 204); doc.setLineWidth(0.3);
    doc.line(x + iz, y + ar + alto, x + w - 2, y + ar + alto);
  }

  function leyenda(doc, y, Cx) {
    var x = M;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor.apply(doc, GRIS);
    [1, 2, 3, 4, 5].forEach(function (k) {
      doc.setFillColor.apply(doc, COLOR_SIT[k]);
      doc.rect(x, y - 2.3, 2.6, 2.6, 'F');
      var t = k + ' · ' + Cx.SITUACIONES[k];
      doc.text(t, x + 3.6, y);
      x += 3.6 + doc.getTextWidth(t) + 5;
    });
    return y + 5;
  }

  // ---------------------------------------------------------------------------
  // Reporte individual
  // ---------------------------------------------------------------------------
  function paginaIndividual(doc, r, Cx, primera) {
    var titulo = 'Informe de deuda bancaria', sub = 'Central de Deudores del BCRA · emitido ' + hoyTexto();
    if (!primera) doc.addPage();
    var y = encabezado(doc, titulo, sub);
    var nombre = r.nombre || r.referencia || Cx.fmtCuit(r.cuit);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor.apply(doc, TEXTO);
    doc.text(nombre, M, y + 2, { maxWidth: doc.internal.pageSize.getWidth() - 2 * M });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor.apply(doc, GRIS);
    var linea = 'CUIT ' + Cx.fmtCuit(r.cuit) + '  ·  ' + Cx.nombreCat(r.categoria);
    if (r.referencia && r.nombre && r.referencia !== r.nombre) linea += '  ·  ' + r.referencia;
    doc.text(linea, M, y + 7.5);
    y += 13;

    if (r.error) {
      doc.setTextColor.apply(doc, BORDO); doc.setFontSize(10);
      doc.text('No se pudo consultar: ' + r.error, M, y + 4);
      return;
    }

    var d = r.deudas || { entidades: [], peor: 0, total: 0 };
    var pj = Cx.puntaje(r), banda = Cx.bandaPuntaje(pj);
    var usdTotal = d.entidades.length ? Cx.enDolares(d.total, d.periodo) : null;
    y = tarjetas(doc, y, [
      { titulo: 'Peor situación', valor: d.peor ? d.peor + ' · ' + Cx.nombreSit(d.peor) : 'Sin deudas', chico: true, color: COLOR_SIT[d.peor || 0] },
      { titulo: 'Puntaje propio (1 a 999)', valor: pj == null ? '-' : pj, color: COLOR_SIT[banda] },
      { titulo: 'Deuda total' + (d.periodo ? ' (' + Cx.fmtPeriodo(d.periodo) + ')' : ''), valor: d.entidades.length ? pesos(d.total * 1000) : '-', nota: usdTotal !== null ? usd(usdTotal) : '', chico: true },
      { titulo: 'Entidades', valor: d.entidades.length },
      { titulo: 'Cheques rechazados', valor: r.cheques ? r.cheques.length : '-' }
    ]);

    // Deudas por entidad
    y = subtitulo(doc, 'Deudas por entidad' + (d.periodo ? ' · período ' + Cx.fmtPeriodo(d.periodo) : ''), y);
    if (d.entidades.length) {
      y = tabla(doc, {
        startY: y,
        head: [['Entidad', 'Situación', 'Monto ($)', 'Monto (US$)', 'Días atraso', 'Observaciones']],
        body: d.entidades.map(function (e) {
          var s = Number(e.situacion) || 0;
          return [e.entidad, s + ' · ' + Cx.nombreSit(s), pesos((Number(e.monto) || 0) * 1000), usd(Cx.enDolares(e.monto, d.periodo)),
            e.diasAtrasoPago != null ? String(e.diasAtrasoPago) : '', Cx.marcasEntidad(e).join(', ')];
        }).concat([[{ content: 'Total', styles: { fontStyle: 'bold' } }, '', { content: pesos(d.total * 1000), styles: { fontStyle: 'bold' } },
          { content: usd(usdTotal), styles: { fontStyle: 'bold' } }, '', '']]),
        columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
        didParseCell: function (h) {
          if (h.section === 'body' && h.column.index === 1 && h.cell.raw && /^\d/.test(String(h.cell.raw))) {
            var s = Number(String(h.cell.raw)[0]);
            h.cell.styles.fillColor = COLOR_SIT[s]; h.cell.styles.textColor = s === 2 ? TEXTO : [255, 255, 255]; h.cell.styles.fontStyle = 'bold';
          }
        }
      });
    } else {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor.apply(doc, TEXTO);
      doc.text('No figura con deudas informadas en la Central de Deudores.', M, y + 3);
      y += 9;
    }

    // Cheques
    if (r.cheques) {
      y = lugar(doc, y, 20, titulo, sub);
      y = subtitulo(doc, 'Cheques rechazados', y);
      if (r.cheques.length) {
        y = tabla(doc, {
          startY: y,
          head: [['Causal', 'Entidad', 'N° cheque', 'Fecha rechazo', 'Monto ($)', 'Pagado', 'Multa']],
          body: r.cheques.map(function (c) {
            return [c.causal, String(c.entidad), String(c.nro || ''), Cx.fmtFecha(c.fecha), pesos(c.monto), c.fechaPago ? Cx.fmtFecha(c.fechaPago) : 'No',
              (c.estadoMulta || '') + (c.fechaPagoMulta ? ' (' + Cx.fmtFecha(c.fechaPagoMulta) + ')' : '')];
          }),
          columnStyles: { 4: { halign: 'right' } }
        });
      } else {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor.apply(doc, TEXTO);
        doc.text('No tiene cheques rechazados informados.', M, y + 3);
        y += 9;
      }
    }

    // Evolución 24 meses
    var hist = r.historicas || [];
    if (hist.length) {
      var asc = hist.slice().reverse(), n = asc.length;
      y = lugar(doc, y, 110, titulo, sub);
      y = subtitulo(doc, 'Evolución de los últimos ' + n + ' meses', y);
      var anchoPag = doc.internal.pageSize.getWidth() - 2 * M;
      var colMes = (anchoPag - 20) / n;
      var colStyles = { 0: { cellWidth: 20, halign: 'left', fontStyle: 'bold', textColor: GRIS } };
      for (var k = 1; k <= n; k++) colStyles[k] = { cellWidth: colMes, halign: 'center' };
      y = tabla(doc, {
        startY: y,
        theme: 'plain',
        styles: { font: 'helvetica', fontSize: 6, cellPadding: { top: 1, bottom: 1, left: 0, right: 0 }, textColor: TEXTO, halign: 'center' },
        headStyles: { fillColor: [255, 255, 255], textColor: GRIS, fontStyle: 'bold', halign: 'center' },
        head: [[''].concat(asc.map(function (p) { var s = String(p.periodo); return s.slice(4) + '\n' + s.slice(2, 4); }))],
        body: [
          ['Puntaje'].concat(asc.map(function (p, i) { var v = Cx.puntajeMes(hist, n - 1 - i); return v == null ? '-' : String(v); })),
          ['Bancos'].concat(asc.map(function (p) { return p.cantidad ? String(p.cantidad) : '-'; })),
          ['Situación'].concat(asc.map(function (p) { return p.peor ? String(p.peor) : '-'; }))
        ],
        columnStyles: colStyles,
        didParseCell: function (h) {
          if (h.section === 'body' && h.row.index === 2 && h.column.index > 0 && /^\d$/.test(String(h.cell.raw))) {
            var s = Number(h.cell.raw);
            h.cell.styles.fillColor = COLOR_SIT[Math.min(s, 5)]; h.cell.styles.textColor = s === 2 ? TEXTO : [255, 255, 255]; h.cell.styles.fontStyle = 'bold';
            h.cell.styles.lineColor = [255, 255, 255]; h.cell.styles.lineWidth = 0.4;
          }
        }
      });
      y -= 3;
      grafico(doc, M, y, anchoPag, 62, asc, Cx);
      y = leyenda(doc, y + 66, Cx);
    }
  }

  function individual(lista) {
    var Cx = C();
    lista = (lista || []).filter(Boolean);
    if (!lista.length) { alert('Primero hay que consultar.'); return; }
    cargarLogo().then(function () {
      var doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
      lista.forEach(function (r, i) { paginaIndividual(doc, r, Cx, i === 0); });
      piePaginas(doc, 'Fuente: Central de Deudores del BCRA (montos informados en miles de pesos, acá en pesos). Dólar: Banco Nación, Divisas, vendedor. ' +
        'El puntaje propio se calcula con datos públicos del BCRA; no es el score de Nosis ni de otro buró.');
      var nombre = lista.length === 1 ? 'Informe BCRA ' + limpiarNombreArchivo(lista[0].nombre || lista[0].referencia || Cx.fmtCuit(lista[0].cuit))
        : 'Informes BCRA ' + (Cx.filtro() ? Cx.nombreCat(Cx.filtro()) + ' ' : '') + hoyArchivo();
      doc.save(nombre + '.pdf');
    });
  }

  // ---------------------------------------------------------------------------
  // Reporte del grupo (cuadro mensual)
  // ---------------------------------------------------------------------------
  // opciones: { resumen: true/false, cuadro: true/false }
  function grupo(opciones) {
    opciones = opciones || { resumen: true, cuadro: true };
    var Cx = C();
    var lista = Cx.visibles().filter(function (r) { return !r.error; });
    if (!lista.length) { alert('Primero hay que consultar.'); return; }
    cargarLogo().then(function () {
      var doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
      var titulo = opciones.resumen ? 'Deuda bancaria por empresa' : 'Cuadro mensual de deuda bancaria';
      var sub = (Cx.filtro() ? Cx.nombreCat(Cx.filtro()) + ' · ' : '') + lista.length + (lista.length === 1 ? ' empresa' : ' empresas') + ' · Central de Deudores del BCRA · emitido ' + hoyTexto();
      var y = encabezado(doc, titulo, sub);

      // Resumen
      var dc = Cx.datosCuadro(lista, Cx.cantMeses());
      var sf = {};
      dc.filas.forEach(function (f) { sf[f.r.cuit] = f.sobreFact; });
      if (opciones.resumen) {
      y = subtitulo(doc, 'Resumen', y);
      y = tabla(doc, {
        startY: y,
        head: [['Empresa', 'CUIT', 'Categoría', 'Período', 'Peor situación', 'Puntaje', 'Deuda total ($)', 'Deuda total (US$)', 'Entidades', 'Cheques rech.', 'Deuda s/ fact.']],
        body: lista.map(function (r) {
          var d = r.deudas || { entidades: [], total: 0 }, pj = Cx.puntaje(r);
          return [r.nombre || r.referencia || '', Cx.fmtCuit(r.cuit), Cx.nombreCat(r.categoria), Cx.fmtPeriodo(d.periodo),
            d.peor ? d.peor + ' · ' + Cx.nombreSit(d.peor) : 'Sin deudas', pj == null ? '-' : String(pj),
            d.entidades.length ? pesos(d.total * 1000) : '-', d.entidades.length ? usd(Cx.enDolares(d.total, d.periodo)) : '-',
            String(d.entidades.length), r.cheques ? String(r.cheques.length) : '-', sf[r.cuit] != null ? pct(sf[r.cuit]) : ''];
        }),
        columnStyles: { 5: { halign: 'center' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'center' }, 9: { halign: 'center' }, 10: { halign: 'right' } },
        didParseCell: function (h) {
          if (h.section !== 'body') return;
          if (h.column.index === 4 && /^\d/.test(String(h.cell.raw))) {
            var s = Number(String(h.cell.raw)[0]);
            h.cell.styles.fillColor = COLOR_SIT[s]; h.cell.styles.textColor = s === 2 ? TEXTO : [255, 255, 255]; h.cell.styles.fontStyle = 'bold';
          }
          if (h.column.index === 10) colorSobreFact(h, String(h.cell.raw));
        }
      });
      }

      // Cuadro mensual en bloques de 6 meses (para que entre a lo ancho)
      if (opciones.cuadro && !(dc.meses.length && dc.filas.length)) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor.apply(doc, TEXTO);
        doc.text('Para el cuadro mensual hay que consultar con «Historial y gráfico de los últimos 24 meses» tildado.', M, y + 3);
      }
      if (opciones.cuadro && dc.meses.length && dc.filas.length) {
        // Hasta 6 meses por bloque, repartidos parejo (8 meses: 4 + 4; 12: 6 + 6; 24: 6 x 4).
        var porBloque = Math.ceil(dc.meses.length / Math.ceil(dc.meses.length / 6));
        var bloques = [];
        for (var i = 0; i < dc.meses.length; i += porBloque) bloques.push(i);
        bloques.forEach(function (ini, b) {
          var meses = dc.meses.slice(ini, ini + porBloque), ultimo = b === bloques.length - 1;
          y = lugar(doc, y, 40, titulo, sub);
          y = subtitulo(doc, 'Cuadro mensual' + (bloques.length > 1 ? ' (' + (b + 1) + ' de ' + bloques.length + ')' : '') + ' · importes en millones', y);
          var fila1 = [{ content: 'Facturación aprox.', rowSpan: 3 }, { content: 'Empresa', rowSpan: 3 }];
          var fila2 = [], fila3 = [];
          meses.forEach(function (m) {
            fila1.push({ content: Cx.MESES_LARGOS[Number(m.slice(4)) - 1] + ' ' + m.slice(0, 4), colSpan: 3 });
            var t = Cx.tcCuadro(m);
            fila2.push({ content: t ? 'US$ 1 = $ ' + Cx.fmtTc(t) + (Cx.tcEsDeHoy(m) ? ' (de hoy)' : '') : 'Falta el dólar', colSpan: 3 });
            fila3.push('$ (M)', 'US$ (M)', 'Var.');
          });
          if (ultimo) fila1.push({ content: 'Deuda s/ fact.\n(' + Cx.fmtPeriodo(dc.meses[dc.meses.length - 1]) + ')', rowSpan: 3 });
          var body = dc.filas.map(function (f) {
            var fila = [Cx.facturacion(f.r.cuit), f.r.nombre || f.r.referencia || Cx.fmtCuit(f.r.cuit)];
            f.celdas.slice(ini, ini + porBloque).forEach(function (c) {
              if (!c) { fila.push('-', '', ''); return; }
              var v = c.variacion;
              fila.push(millones(c.pesos), c.usd === null ? '-' : millones(c.usd, 1), v === null ? '' : (v > 0 ? '+' : v < 0 ? '-' : '') + pct(Math.abs(v), 1));
            });
            if (ultimo) fila.push(f.sobreFact === null ? '' : pct(f.sobreFact));
            return fila;
          });
          var cols = { 0: { cellWidth: 24 }, 1: { cellWidth: 46 } };
          var anchoMeses = doc.internal.pageSize.getWidth() - 2 * M - 70 - (ultimo ? 20 : 0);
          var w = anchoMeses / (meses.length * 3);
          for (var k = 0; k < meses.length * 3; k++) cols[2 + k] = { halign: 'right', cellWidth: w };
          if (ultimo) cols[2 + meses.length * 3] = { halign: 'right', cellWidth: 20, fontStyle: 'bold' };
          y = tabla(doc, {
            startY: y,
            head: [fila1, fila2, fila3],
            body: body,
            styles: { font: 'helvetica', fontSize: 6.8, cellPadding: 1.2, lineColor: [225, 225, 228], lineWidth: 0.2, textColor: TEXTO, overflow: 'linebreak' },
            headStyles: { fillColor: GRIS_CLARO, textColor: GRIS, fontStyle: 'bold', halign: 'center', valign: 'middle' },
            columnStyles: cols,
            didParseCell: function (h) {
              if (h.section !== 'body') return;
              var col = h.column.index;
              if (col >= 2 && col < 2 + meses.length * 3 && (col - 2) % 3 === 2) {
                var t = String(h.cell.raw);
                if (t[0] === '+') h.cell.styles.textColor = BORDO;
                else if (t[0] === '-' && t.length > 1) h.cell.styles.textColor = COLOR_SIT[1];
              }
              if (ultimo && col === 2 + meses.length * 3) colorSobreFact(h, String(h.cell.raw));
            }
          });
        });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor.apply(doc, GRIS);
        y = lugar(doc, y, 10, titulo, sub);
        doc.text('Variación: contra la deuda del mes anterior, en dólares (+ sube, - baja). Deuda s/ fact.: deuda del último mes en dólares sobre la facturación aproximada (se toma el número más alto del rango).', M, y, { maxWidth: doc.internal.pageSize.getWidth() - 2 * M });
      }

      piePaginas(doc, 'Fuente: Central de Deudores del BCRA. Dólar: Banco Nación, Divisas, vendedor (de cada mes; si falta, el de hoy). El puntaje propio no es el score de Nosis ni de otro buró.');
      doc.save((opciones.resumen && opciones.cuadro ? 'Deuda bancaria ' : opciones.resumen ? 'Deuda bancaria resumen ' : 'Deuda bancaria cuadro mensual ') + (Cx.filtro() ? Cx.nombreCat(Cx.filtro()) + ' ' : '') + hoyArchivo() + '.pdf');
    });
  }

  function colorSobreFact(h, t) {
    var v = parseFloat(t.replace(/\./g, '').replace(',', '.'));
    if (!isFinite(v)) return;
    if (v >= 100) { h.cell.styles.fillColor = [249, 211, 214]; h.cell.styles.textColor = [111, 14, 21]; h.cell.styles.fontStyle = 'bold'; }
    else if (v >= 50) { h.cell.styles.fillColor = [255, 244, 214]; }
  }

  window.ReportePDF = { individual: individual, grupo: grupo };

  var enganchado = false;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enganchar); else enganchar();
  function enganchar() {
    if (enganchado) return;
    var bg = document.getElementById('btn-pdf-grupo'), bi = document.getElementById('btn-pdf-individual');
    if (!bg || !bi) return;
    enganchado = true;
    // Antes de armar el PDF del grupo se pregunta qué incluir (se recuerda la última elección).
    var dlg = document.getElementById('dlg-pdf-grupo');
    bg.addEventListener('click', function () {
      if (!C().visibles().filter(function (r) { return !r.error; }).length) { alert('Primero hay que consultar.'); return; }
      var guardado = {};
      try { guardado = JSON.parse(localStorage.getItem('consulta-bcra.pdf-grupo') || '{}') || {}; } catch (e) { guardado = {}; }
      document.getElementById('pdf-op-resumen').checked = guardado.resumen !== false;
      document.getElementById('pdf-op-cuadro').checked = guardado.cuadro !== false;
      document.getElementById('pdf-op-aviso').hidden = true;
      dlg.showModal();
    });
    document.getElementById('pdf-op-cancelar').addEventListener('click', function () { dlg.close(); });
    ['pdf-op-resumen', 'pdf-op-cuadro'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', function () { document.getElementById('pdf-op-aviso').hidden = true; });
    });
    document.getElementById('pdf-op-generar').addEventListener('click', function () {
      var op = { resumen: document.getElementById('pdf-op-resumen').checked, cuadro: document.getElementById('pdf-op-cuadro').checked };
      if (!op.resumen && !op.cuadro) { document.getElementById('pdf-op-aviso').hidden = false; return; }
      try { localStorage.setItem('consulta-bcra.pdf-grupo', JSON.stringify(op)); } catch (e) { /* nada */ }
      dlg.close();
      grupo(op);
    });
    bi.addEventListener('click', function () { individual(C().visibles()); });
  }
})();
