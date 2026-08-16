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
    $('confirmar').textContent = (st.pago === 'yape_online' || st.pago === 'tarjeta') ? 'Pagar ' + fmt(total) + ' ahora' : 'Confirmar pedido';
    var m = $('qr-monto'); if (m) m.textContent = fmt(totales.total);
  }
  $('canje-check').addEventListener('change', function (e) { st.canje = e.target.checked; pintarResumen(); });
  window.__gasomiCanje = function () { return { activo: st.canje, puntos: cliente() ? cliente().puntos : 0 }; };

  /* ---------- config de pagos ---------- */
  var METODOS = [
    { id: 'yape_online', nombre: 'Yape', sub: 'confirmación inmediata', icono: '/tienda/img-ui-yape.png' },
    { id: 'tarjeta', nombre: 'Tarjeta', sub: 'Visa · Mastercard', txt: '💳' },
    { id: 'yape', nombre: 'Yape QR', sub: 'envías comprobante', icono: '/tienda/img-ui-yape.png' },
    { id: 'plin', nombre: 'Plin', sub: 'envías comprobante', icono: '/tienda/img-ui-plin.png' },
    { id: 'transferencia', nombre: 'Transferencia', txt: '🏦' },
    { id: 'contra_entrega', nombre: 'Contra entrega', txt: '🤝' }
  ];
  function pasarelaLista() {
    var c = st.cfg || {};
    var t = c.tarjeta || {};
    return !!(t.public_key || c.demo);
  }
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
    return METODOS.filter(function (m) {
      var c = (st.cfg || {})[m.id];
      if (m.id === 'yape_online' || m.id === 'tarjeta') return !!(c && c.activo) && pasarelaLista();
      return c ? c.activo !== false : true;
    });
  }
  function pintarMetodos() {
    var act = metodosActivos();
    if (!st.pagoElegido || !act.some(function (m) { return m.id === st.pago; })) st.pago = act[0] ? act[0].id : 'yape';
    $('pago-tabs').innerHTML = act.map(function (m) {
      return '<button class="metodo' + (st.pago === m.id ? ' on' : '') + '" data-pago="' + m.id + '" type="button">' +
        (m.icono ? '<img src="' + m.icono + '" alt="">' : '<span class="metodo-ico">' + m.txt + '</span>') + '<b>' + m.nombre + '</b>' + (m.sub ? '<small>' + m.sub + '</small>' : '') + '</button>';
    }).join('');
    pintarPanel();
  }
  function pintarPanel() {
    var c = (st.cfg || {})[st.pago] || {};
    var wa = (st.cfg && st.cfg.whatsapp) || WA_DEF;
    var html = '';
    if (st.pago === 'yape_online') {
      html = '<div class="online-box"><img src="/tienda/img-ui-yape.png" alt="" class="online-ico"><div><b>Paga con Yape y tu pedido queda confirmado al instante</b>' +
        '<p class="pl-sub">Al confirmar se abre una ventana segura: ingresas tu número de Yape y el <b>código de aprobación</b> (lo generas en la app Yape → menú → "Código de aprobación"). Máximo S/ 2,000 por operación.</p></div></div>';
    } else if (st.pago === 'tarjeta') {
      html = '<div class="online-box"><span class="online-ico" style="font-size:2rem">💳</span><div><b>Pago con tarjeta — confirmación inmediata</b>' +
        '<p class="pl-sub">Visa, Mastercard, Amex y Diners. Procesado por Culqi (certificado PCI): tu tarjeta nunca pasa por nuestra web.</p></div></div>';
    } else if (st.pago === 'yape' || st.pago === 'plin') {
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
    if (t.dataset.pago) { st.pago = t.dataset.pago; st.pagoElegido = true; pintarMetodos(); pintarResumen(); }
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
    if (st.pedidoPendiente && (st.pago === 'yape_online' || st.pago === 'tarjeta')) {
      var resR = await cobrarOnline(st.pedidoPendiente, nombre);
      if (resR.ok) { mostrarConfirmado(st.pedidoPendiente, nombre, resR); return; }
      msg.textContent = resR.error || 'El pago no se completó.'; btn.disabled = false; btn.textContent = 'Reintentar pago'; return;
    }

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
    var r;
    try { r = await db.from('gasomi_pedidos').insert(payload).select(); }
    catch (e) { r = { error: { message: 'sin conexión a internet' } }; }
    if (r.error || !r.data || !r.data.length) {
      msg.textContent = 'No se pudo registrar el pedido: ' + (r.error ? r.error.message : 'intenta de nuevo');
      btn.disabled = false; btn.textContent = 'Confirmar pedido';
      return;
    }
    var ped = r.data[0];
    if (st.pago === 'yape_online' || st.pago === 'tarjeta') {
      btn.textContent = 'Abriendo pago seguro…';
      var res = await cobrarOnline(ped, nombre);
      if (res.ok) { mostrarConfirmado(ped, nombre, res); return; }
      // no aprobado o cancelado: el pedido queda 'nuevo' pendiente; ofrecer reintento o WhatsApp
      msg.textContent = res.error || 'El pago no se completó. Puedes reintentar o elegir otro método.';
      btn.disabled = false; btn.textContent = 'Reintentar pago';
      st.pedidoPendiente = ped;
      return;
    }
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

  /* ---------- Pago online (Culqi Checkout / demo) ---------- */
  function cargarCulqi() {
    return new Promise(function (res, rej) {
      if (window.Culqi) return res();
      var sc = document.createElement('script');
      sc.src = 'https://checkout.culqi.com/js/v4';
      sc.onload = res; sc.onerror = rej;
      document.head.appendChild(sc);
    });
  }
  function obtenerToken(ped, nombre) {
    // Devuelve un token de Culqi (o demo) para el monto del pedido
    return new Promise(async function (res) {
      var c = st.cfg || {};
      var pk = (c.tarjeta || {}).public_key;
      if (!pk && c.demo) {
        // Modo demostración: simula la ventana de pago
        var okDemo = confirm('MODO DEMOSTRACIÓN\n\nSimular pago ' + (st.pago === 'yape_online' ? 'con Yape' : 'con tarjeta') + ' de ' + fmt(ped.total) + '?\n\nAceptar = pago aprobado · Cancelar = rechazado');
        return res(okDemo ? 'demo_ok' : 'demo_rechazado');
      }
      try { await cargarCulqi(); } catch (e) { return res(null); }
      window.Culqi.publicKey = pk;
      window.Culqi.settings({
        title: 'Ferretería Gasomi',
        currency: 'PEN',
        amount: Math.round(ped.total * 100),
        order: undefined
      });
      window.Culqi.options({
        lang: 'auto',
        installments: false,
        paymentMethods: { tarjeta: st.pago === 'tarjeta', yape: st.pago === 'yape_online', bancaMovil: false, agente: false, billetera: false, cuotealo: false },
        style: { logo: location.origin + '/tienda/logo-gasomi.png', bannerColor: '#000a1e', buttonBackground: '#f4a100', buttonText: 'Pagar', buttonTextColor: '#000a1e', priceColor: '#000a1e' }
      });
      var done = false;
      window.culqi = function () {
        if (done) return; done = true;
        if (window.Culqi.token && window.Culqi.token.id) res(window.Culqi.token.id);
        else if (window.Culqi.order) res(null);
        else res(null);
        try { window.Culqi.close(); } catch (e) {}
      };
      // si el usuario cierra la ventana sin pagar
      var poll = setInterval(function () {
        var visible = document.querySelector('#culqi-container, iframe[src*="culqi"]');
        if (!visible && !done) { done = true; clearInterval(poll); res(null); }
      }, 1500);
      setTimeout(function () { clearInterval(poll); }, 4 * 60 * 1000);
      window.Culqi.open();
    });
  }
  async function cobrarOnline(ped, nombre) {
    var token = await obtenerToken(ped, nombre);
    if (!token) return { ok: false, error: 'Pago cancelado. Tu pedido #' + ped.id + ' quedó guardado: puedes reintentar o pagar por otro medio.' };
    try {
      var r = await fetch('/api/pagar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pedido_id: ped.id, token: token, metodo: st.pago === 'yape_online' ? 'yape' : 'tarjeta', email: $('f-email').value.trim() })
      });
      var d = await r.json().catch(function () { return {}; });
      if (r.ok && d.ok) return { ok: true, referencia: d.referencia, pasarela: d.pasarela };
      return { ok: false, error: d.error || 'El pago fue rechazado. Intenta con otro medio.' };
    } catch (e) { return { ok: false, error: 'No pudimos conectar con la pasarela. Intenta de nuevo.' }; }
  }
  function mostrarConfirmado(ped, nombre, res) {
    localStorage.removeItem(KEY);
    var wa = (st.cfg && st.cfg.whatsapp) || WA_DEF;
    var metodoTxt = st.pago === 'yape_online' ? 'Yape' : 'tarjeta';
    $('ok-num').textContent = '#' + ped.id;
    document.querySelector('#pago-ok h2').innerHTML = '✅ ¡Compra confirmada! <span id="ok-num">#' + ped.id + '</span>';
    $('ok-texto').textContent = 'Gracias, ' + nombre.split(' ')[0] + '. Tu pago de ' + fmt(totales.total || ped.total) + ' con ' + metodoTxt + ' fue aprobado y tu pedido ya está en preparación. Te avisaremos por WhatsApp cuando esté listo' + (st.entrega === 'obra' ? ' para la entrega en obra.' : ' para recojo.');
    $('ok-pago').innerHTML = '<div class="pago-conf"><div><span class="pl-sub">Referencia de pago</span><b>' + esc(res.referencia || '—') + '</b></div><div><span class="pl-sub">Estado</span><b class="ok-txt">Pagado ✓</b></div><div><span class="pl-sub">Método</span><b>' + esc(metodoTxt) + (res.pasarela === 'demo' ? ' (demo)' : '') + '</b></div></div>';
    $('ok-wa').textContent = 'Escribirnos por WhatsApp';
    $('ok-wa').href = 'https://wa.me/' + wa + '?text=' + encodeURIComponent('Hola Gasomi, hice el pedido #' + ped.id + ' y ya está pagado con ' + metodoTxt + '. ¿Cuándo estaría listo?');
    document.querySelector('.pago-grid').style.display = 'none';
    document.querySelector('.pago-steps').innerHTML = '<span class="on">1 Datos</span><span class="on">2 Entrega</span><span class="on">3 Pago</span><span class="on">4 Confirmación</span>';
    $('pago-ok').style.display = 'block';
    window.scrollTo(0, 0);
    if (window.confetti) try { window.confetti(); } catch (e) {}
  }

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
