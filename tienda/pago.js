/* Checkout — Ferretería Gasomi. Datos + entrega + pago (Yape/Plin/transferencia/tarjeta/contra entrega)
   + canje de puntos + comprobante. Crea el pedido en Supabase y abre WhatsApp con el resumen. */
(function () {
  'use strict';
  var KEY = 'gasomi_epp_cart_v1';
  var WA_DEF = '51958682246';
  var db = window.__gasomiSB;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { return 'S/ ' + Number(n).toFixed(2); }
  function toast(m, err) { var el = $('toast'); el.textContent = m; el.className = 'toast on'; setTimeout(function () { el.className = 'toast'; }, 2400); if (err) console.warn(m); }

  var st = { entrega: 'recojo', pago: 'yape', canje: false, cfg: null, envioCfg: null, comprobanteFile: null };
  var cart = {};
  try { cart = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}

  /* ---------- catálogo (con precios en vivo) ---------- */
  function catalogo() { return window.GASOMI_CATALOGO || { productos: [] }; }
  var byId = {};
  function indexar() { byId = {}; catalogo().productos.forEach(function (p) { byId[p.id] = p; }); }
  window.__gasomiApply = function (cats, prods) {
    if (prods && prods.length) window.GASOMI_CATALOGO.productos = prods;
    if (cats && cats.length) window.GASOMI_CATALOGO.categorias = cats;
    indexar(); pintarResumen();
  };
  function precio(p) { return p.precio != null ? p.precio : p.precio_ref_soles; }
  function escalasDe(p) {
    var e = Array.isArray(p.escalas) ? p.escalas : [];
    e = e.filter(function (t) { return t && t.desde > 1 && t.precio > 0 && t.precio < precio(p); }).sort(function (a, b) { return a.desde - b.desde; });
    if (!e.length && p.precio_mayor > 0 && p.precio_mayor < precio(p)) e = [{ desde: p.mayor_desde || 12, precio: p.precio_mayor }];
    return e;
  }
  function precioAplicado(p, q) { var e = escalasDe(p), pr = precio(p); e.forEach(function (t) { if (q >= t.desde) pr = t.precio; }); return pr; }

  /* ---------- puntos / cliente ---------- */
  function cliente() { return window.__gasomiCliente ? window.__gasomiCliente() : null; }
  window.__gasomiRefrescarCarrito = pintarResumen;
  window.__gasomiActualizarCanjeUI = function () {};
  window.__gasomiCanje = function () { return { activo: st.canje, puntos: cliente() ? cliente().puntos : 0 }; };

  var totales = { sub: 0, desc: 0, puntos: 0, total: 0, items: [], lines: [] };
  function pintarResumen() {
    var ids = Object.keys(cart).filter(function (id) { return byId[id] && cart[id] > 0; });
    var sub = 0, items = [], lines = [];
    var html = ids.map(function (id) {
      var p = byId[id], q = cart[id], pu = precioAplicado(p, q), s = pu * q;
      sub += s;
      var mayor = pu < precio(p);
      items.push({ id: p.id, nombre: p.nombre, qty: q, precio: pu, mayor: mayor, subtotal: +s.toFixed(2) });
      lines.push('• ' + q + ' × ' + p.nombre + (mayor ? ' [por mayor]' : '') + ' — ' + fmt(s));
      var img = p.imagen ? (p.imagen.indexOf('http') === 0 ? p.imagen : '/tienda/' + p.imagen) : '';
      return '<div class="res-item">' + (img ? '<img src="' + esc(img) + '" alt="">' : '<div class="res-ph"></div>') +
        '<div class="res-info"><div class="res-nombre">' + esc(p.nombre) + '</div><div class="res-meta">' + q + ' × ' + fmt(pu) + (mayor ? ' <b class="d-mayor">por mayor</b>' : '') + '</div></div>' +
        '<div class="res-sub">' + fmt(s) + '</div></div>';
    }).join('');
    $('res-items').innerHTML = html || '<div class="pl-empty">Tu carrito está vacío. <a href="/tienda/">Ir al catálogo</a></div>';

    var c = cliente();
    var desc = 0, pts = 0;
    var box = $('canje-box');
    if (c && c.puntos >= 10 && ids.length) {
      box.classList.add('visible');
      $('canje-pts').textContent = c.puntos;
      var maxDesc = Math.min(Math.floor(c.puntos / 10), Math.floor(sub));
      $('canje-desc').textContent = '−' + fmt(maxDesc);
      $('canje-check').checked = st.canje;
      if (st.canje) { desc = maxDesc; pts = desc * 10; }
    } else { box.classList.remove('visible'); st.canje = false; }

    var total = Math.max(0, sub - desc);
    $('res-sub').textContent = fmt(sub);
    $('res-desc-row').style.display = desc > 0 ? 'flex' : 'none';
    $('res-desc').textContent = '−' + fmt(desc);
    $('res-total').textContent = fmt(total);
    var envioCfg = st.envioCfg || {};
    $('res-envio').textContent = st.entrega === 'recojo' ? 'Gratis (recojo)' : (envioCfg.gratis_desde && sub >= envioCfg.gratis_desde ? 'Gratis en Cajamarca' : 'Se confirma por WhatsApp');
    totales = { sub: sub, desc: desc, puntos: pts, total: +total.toFixed(2), items: items, lines: lines };
    $('confirmar').disabled = !ids.length;
    var m = $('qr-monto'); if (m) m.textContent = fmt(totales.total);
  }
  $('canje-check').addEventListener('change', function (e) { st.canje = e.target.checked; pintarResumen(); });
  window.__gasomiCanje = function () { return { activo: st.canje, puntos: cliente() ? cliente().puntos : 0 }; };

  /* ---------- config de pagos ---------- */
  var METODOS = [
    { id: 'yape', nombre: 'Yape', icono: '/tienda/img-ui-yape.png' },
    { id: 'plin', nombre: 'Plin', icono: '/tienda/img-ui-plin.png' },
    { id: 'transferencia', nombre: 'Transferencia', txt: '🏦' },
    { id: 'tarjeta', nombre: 'Tarjeta', txt: '💳' },
    { id: 'contra_entrega', nombre: 'Contra entrega', txt: '🤝' }
  ];
  async function cargarConfig() {
    var cfg = null, env = null;
    try {
      var r = await db.from('gasomi_config').select('*').in('clave', ['pagos', 'envio']);
      (r.data || []).forEach(function (row) { if (row.clave === 'pagos') cfg = row.valor; if (row.clave === 'envio') env = row.valor; });
    } catch (e) {}
    st.cfg = cfg || {};
    st.envioCfg = env || {};
    if (env && env.recojo && env.recojo.direccion) $('ent-recojo-dir').textContent = env.recojo.direccion;
    if (env && env.obra && env.obra.nota) $('ent-obra-nota').textContent = env.obra.nota.split('.')[0];
    pintarMetodos();
  }
  function metodosActivos() {
    return METODOS.filter(function (m) { var c = (st.cfg || {})[m.id]; return c ? c.activo !== false : (m.id !== 'tarjeta'); });
  }
  function pintarMetodos() {
    var act = metodosActivos();
    if (!act.some(function (m) { return m.id === st.pago; })) st.pago = act[0] ? act[0].id : 'yape';
    $('pago-tabs').innerHTML = act.map(function (m) {
      return '<button class="metodo' + (st.pago === m.id ? ' on' : '') + '" data-pago="' + m.id + '" type="button">' +
        (m.icono ? '<img src="' + m.icono + '" alt="">' : '<span class="metodo-ico">' + m.txt + '</span>') + '<b>' + m.nombre + '</b></button>';
    }).join('');
    pintarPanel();
  }
  function pintarPanel() {
    var c = (st.cfg || {})[st.pago] || {};
    var wa = (st.cfg && st.cfg.whatsapp) || WA_DEF;
    var html = '';
    if (st.pago === 'yape' || st.pago === 'plin') {
      html = '<div class="qr-wrap">' + (c.qr ? '<img class="qr" src="' + esc(c.qr) + '" alt="QR ' + st.pago + '">' : '<div class="qr qr-ph">QR ' + esc(st.pago === 'yape' ? 'Yape' : 'Plin') + '<small>escanea desde la app</small></div>') +
        '<div class="qr-datos"><div class="pl-sub">Número ' + esc(st.pago === 'yape' ? 'Yape' : 'Plin') + '</div><div class="qr-num">' + esc(c.numero || '958 682 246') + '</div><div class="pl-sub">' + esc(c.titular || 'Gasomi Ingenieros E.I.R.L.') + '</div>' +
        '<div class="qr-monto">Monto: <b id="qr-monto"></b></div></div></div>' +
        '<div class="comp-box"><b>Después de pagar</b>, adjunta la captura del comprobante (o envíala por WhatsApp).<label class="btn-ghost btn-sm comp-btn">📎 Adjuntar comprobante<input type="file" id="comprobante" accept="image/*,.pdf" style="display:none"></label><span class="pl-sub" id="comp-nombre"></span></div>';
    } else if (st.pago === 'transferencia') {
      html = '<div class="banco-box"><div><span class="pl-sub">Banco</span><b>' + esc(c.banco || 'BCP') + '</b></div>' +
        '<div><span class="pl-sub">Cuenta</span><b>' + esc(c.cuenta || 'Te la enviamos por WhatsApp') + '</b></div>' +
        (c.cci ? '<div><span class="pl-sub">CCI</span><b>' + esc(c.cci) + '</b></div>' : '') +
        '<div><span class="pl-sub">Titular</span><b>' + esc(c.titular || 'Gasomi Ingenieros E.I.R.L.') + '</b></div></div>' +
        '<div class="comp-box"><b>Después de transferir</b>, adjunta el comprobante.<label class="btn-ghost btn-sm comp-btn">📎 Adjuntar comprobante<input type="file" id="comprobante" accept="image/*,.pdf" style="display:none"></label><span class="pl-sub" id="comp-nombre"></span></div>';
    } else if (st.pago === 'tarjeta') {
      html = '<div class="tarjeta-box"><b>Pago con tarjeta (Visa / Mastercard)</b><p class="pl-sub">Confirmas el pedido y te enviamos un <b>link de pago seguro</b> por WhatsApp para pagar con tarjeta desde tu celular. Tu tarjeta nunca pasa por nuestra web.</p></div>';
    } else {
      html = '<div class="tarjeta-box"><b>Pagas al recibir</b><p class="pl-sub">' + esc(c.nota || 'Pagas en efectivo, Yape o Plin al recibir tu pedido en obra o al recogerlo en tienda.') + '</p></div>';
    }
    $('pago-panel').innerHTML = html;
    var m = $('qr-monto'); if (m) m.textContent = fmt(totales.total);
  }

  /* ---------- eventos UI ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-entrega],[data-pago],#pago-login-btn');
    if (!t) return;
    if (t.dataset.entrega) {
      st.entrega = t.dataset.entrega;
      document.querySelectorAll('[data-entrega]').forEach(function (b) { b.classList.toggle('on', b === t); });
      $('dir-wrap').style.display = st.entrega === 'obra' ? 'block' : 'none';
      pintarResumen();
    }
    if (t.dataset.pago) { st.pago = t.dataset.pago; pintarMetodos(); }
    if (t.id === 'pago-login-btn') { $('cuenta-btn').click(); }
  });
  document.addEventListener('change', function (e) {
    if (e.target.name === 'comp') $('ruc-wrap').style.display = e.target.value === 'factura' ? 'block' : 'none';
    if (e.target.id === 'comprobante') { st.comprobanteFile = e.target.files[0] || null; var n = $('comp-nombre'); if (n) n.textContent = st.comprobanteFile ? '✓ ' + st.comprobanteFile.name : ''; }
  });

  /* ---------- prellenar con la cuenta ---------- */
  function prellenar() {
    var c = cliente();
    if (!c) return;
    if (!$('f-nombre').value) $('f-nombre').value = c.nombre || '';
    if (!$('f-telefono').value) $('f-telefono').value = c.telefono || '';
    if (!$('f-email').value) $('f-email').value = c.email || '';
    if (!$('f-empresa').value) $('f-empresa').value = c.empresa || '';
    $('pago-login-hint').style.display = 'none';
  }
  window.__gasomiOnCliente = function () { prellenar(); pintarResumen(); };

  /* ---------- confirmar ---------- */
  async function subirComprobante(pedidoId) {
    if (!st.comprobanteFile) return '';
    try {
      var f = st.comprobanteFile;
      var ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      var path = 'pedido-' + pedidoId + '-' + Date.now() + '.' + ext;
      var up = await db.storage.from('gasomi-comprobantes').upload(path, f, { contentType: f.type || 'image/jpeg' });
      if (up.error) return '';
      return path;
    } catch (e) { return ''; }
  }
  $('confirmar').addEventListener('click', async function () {
    var msg = $('pago-msg');
    msg.textContent = '';
    var nombre = $('f-nombre').value.trim(), tel = $('f-telefono').value.trim();
    var factura = document.querySelector('input[name=comp]:checked').value === 'factura';
    var ruc = $('f-ruc').value.trim();
    if (!totales.items.length) { msg.textContent = 'Tu carrito está vacío.'; return; }
    if (nombre.length < 3) { msg.textContent = 'Escribe tu nombre completo.'; $('f-nombre').focus(); return; }
    if (tel.replace(/\D/g, '').length < 9) { msg.textContent = 'Escribe un WhatsApp válido (9 dígitos).'; $('f-telefono').focus(); return; }
    if (factura && !/^\d{11}$/.test(ruc)) { msg.textContent = 'Para factura necesitamos un RUC de 11 dígitos.'; $('f-ruc').focus(); return; }
    if (st.entrega === 'obra' && $('f-direccion').value.trim().length < 6) { msg.textContent = 'Indica la dirección de la obra.'; $('f-direccion').focus(); return; }
    var btn = $('confirmar'); btn.disabled = true; btn.textContent = 'Registrando…';

    var uid = null;
    try { var s = await db.auth.getSession(); uid = s.data.session ? s.data.session.user.id : null; } catch (e) {}
    var payload = {
      items: totales.items, total: totales.total, origen: 'tienda',
      cliente_id: uid,
      cliente_nombre: nombre, cliente_telefono: tel, cliente_email: $('f-email').value.trim(),
      cliente_empresa: $('f-empresa').value.trim(), cliente_ruc: factura ? ruc : '',
      comprobante_tipo: factura ? 'factura' : 'boleta',
      entrega: st.entrega, direccion: st.entrega === 'obra' ? $('f-direccion').value.trim() : '',
      pago_metodo: st.pago, pago_estado: 'pendiente', monto_pagado: 0,
      puntos_canjeados: uid ? totales.puntos : 0, descuento: uid ? totales.desc : 0,
      nota: (uid && totales.desc > 0 ? 'Canjea ' + totales.puntos + ' puntos (−' + fmt(totales.desc) + ')' : '')
    };
    var r = await db.from('gasomi_pedidos').insert(payload).select();
    if (r.error || !r.data || !r.data.length) {
      msg.textContent = 'No se pudo registrar el pedido: ' + (r.error ? r.error.message : 'intenta de nuevo');
      btn.disabled = false; btn.textContent = 'Confirmar pedido';
      return;
    }
    var ped = r.data[0];
    var comp = await subirComprobante(ped.id);
    if (comp) await db.from('gasomi_pedidos').update({ comprobante_url: comp }).eq('id', ped.id);

    // limpiar carrito y mostrar confirmación
    localStorage.removeItem(KEY);
    var wa = (st.cfg && st.cfg.whatsapp) || WA_DEF;
    var metodoTxt = { yape: 'Yape', plin: 'Plin', transferencia: 'transferencia bancaria', tarjeta: 'tarjeta (link de pago)', contra_entrega: 'contra entrega' }[st.pago];
    var texto = 'Hola Gasomi, acabo de hacer el pedido #' + ped.id + ' en la tienda online:\n' + totales.lines.join('\n') +
      (totales.desc > 0 ? '\nDescuento por puntos: −' + fmt(totales.desc) : '') +
      '\nTotal: ' + fmt(totales.total) + '\nPago: ' + metodoTxt + '\nEntrega: ' + (st.entrega === 'obra' ? 'en obra — ' + payload.direccion : 'recojo en tienda') +
      '\nA nombre de: ' + nombre + (payload.cliente_empresa ? ' · ' + payload.cliente_empresa : '') + (factura ? ' · Factura RUC ' + ruc : '') +
      (comp ? '\n(Comprobante adjunto en la web)' : (st.pago === 'yape' || st.pago === 'plin' || st.pago === 'transferencia' ? '\nTe envío el comprobante aquí 👇' : ''));
    $('ok-num').textContent = '#' + ped.id;
    $('ok-texto').textContent = 'Gracias, ' + nombre.split(' ')[0] + '. Registramos tu pedido por ' + fmt(totales.total) + '. Envíanoslo por WhatsApp para confirmarte stock, envío y ' + (st.pago === 'tarjeta' ? 'recibir tu link de pago con tarjeta.' : 'coordinar el pago.');
    $('ok-pago').innerHTML = (st.pago === 'yape' || st.pago === 'plin' || st.pago === 'transferencia') && !comp
      ? '<div class="comp-box" style="margin-top:12px"><b>Recuerda:</b> paga ' + fmt(totales.total) + ' por ' + metodoTxt + ' y mándanos la captura por WhatsApp para despachar tu pedido.</div>' : '';
    $('ok-wa').href = 'https://wa.me/' + wa + '?text=' + encodeURIComponent(texto);
    document.querySelector('.pago-grid').style.display = 'none';
    document.querySelector('.pago-steps').innerHTML = '<span class="on">1 Datos</span><span class="on">2 Entrega</span><span class="on">3 Pago</span><span class="on">4 Confirmación</span>';
    $('pago-ok').style.display = 'block';
    window.scrollTo(0, 0);
  });

  /* ---------- init ---------- */
  function init() {
    if (!db) { setTimeout(init, 100); return; }
    indexar();
    pintarResumen();
    cargarConfig();
    setTimeout(prellenar, 800);
  }
  init();
})();
