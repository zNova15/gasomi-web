/* CRM de Ventas — Tienda EPP Gasomi Ingenieros.
   Roles reales (admin/vendedor por RLS), venta rápida de mostrador, cuentas por cobrar,
   tareas de seguimiento, WhatsApp con plantillas y catálogo con stock en vivo. */
(function () {
  'use strict';

  var SB_URL = 'https://lggxsejjbhkymazgalzm.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnZ3hzZWpqYmhreW1hemdhbHptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MDAwMDAsImV4cCI6MjA5ODk3NjAwMH0.X3yg0OewAb1QoBk4HdeALWR33cv9WVJZIbzNKzUWCT4';
  var db = window.supabase.createClient(SB_URL, SB_KEY);

  var state = {
    usuario: null, rol: 'vendedor',
    categorias: [], productos: [], pedidos: [], historial: [], clientes: [], tareas: [], costos: {},
    cat: 'todos', q: '', editId: null,
    pedFiltro: 'todos',
    venta: { cliente: '', items: [], q: '' },
    loginModo: 'ingresar',
    cliQ: '', cliF: 'todos', config: {}
  };
  var toastTimer = null;
  var rtOn = false;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { return typeof v === 'number' ? v : parseFloat(v || 0); }
  function fmt(v) { return 'S/ ' + num(v).toFixed(2); }
  function fecha(iso) {
    return new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function hoyLima() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
  }
  function toast(msg, err) {
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast on' + (err ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 2600);
  }
  function esAdmin() { return state.rol === 'admin'; }
  function normTxt(s) {
    return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function coincide(texto, q) {
    var hay = normTxt(texto);
    return normTxt(q).split(/\s+/).every(function (tok) { return !tok || hay.indexOf(tok) > -1; });
  }
  function prodDe(id) { return state.productos.find(function (p) { return p.id === id; }); }
  function clienteDe(uid) { return state.clientes.find(function (c) { return c.user_id === uid; }); }
  function nombreCliente(uid, p) {
    var c = clienteDe(uid);
    if (c) return c.nombre || c.empresa || c.email;
    return (p && p.cliente_nombre) ? p.cliente_nombre : 'cliente';
  }
  function telWa(c) {
    if (!c || !c.telefono) return null;
    var d = c.telefono.replace(/\D/g, '');
    if (!d) return null;
    if (d.length === 9) d = '51' + d;
    return d;
  }
  function thumbSrc(p) {
    if (!p.imagen) return '';
    return p.imagen.indexOf('http') === 0 ? p.imagen : '../tienda/' + p.imagen;
  }
  function slugify(t) {
    return normTxt(t).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'producto';
  }
  function escalasDe(p) {
    var e = Array.isArray(p.escalas) ? p.escalas : [];
    e = e.filter(function (t) { return t && num(t.desde) > 1 && num(t.precio) > 0 && num(t.precio) < num(p.precio); })
      .map(function (t) { return { desde: parseInt(t.desde, 10), precio: num(t.precio) }; })
      .sort(function (a, b) { return a.desde - b.desde; });
    if (!e.length && num(p.precio_mayor) > 0 && num(p.precio_mayor) < num(p.precio)) e = [{ desde: p.mayor_desde || 12, precio: num(p.precio_mayor) }];
    return e;
  }
  function precioAplicado(p, qty) {
    var e = escalasDe(p), pr = num(p.precio);
    for (var i = 0; i < e.length; i++) { if (qty >= e[i].desde) pr = e[i].precio; }
    return pr;
  }
  function sugerirEscalas(precio) {
    precio = num(precio);
    if (precio <= 0) return [];
    var r = function (x) { return Math.round(x * 100) / 100; };
    if (precio < 5) return [{ desde: 50, precio: r(precio * 0.90) }, { desde: 100, precio: r(precio * 0.85) }, { desde: 300, precio: r(precio * 0.80) }];
    if (precio < 30) return [{ desde: 12, precio: r(precio * 0.92) }, { desde: 50, precio: r(precio * 0.88) }, { desde: 100, precio: r(precio * 0.84) }];
    if (precio < 150) return [{ desde: 6, precio: r(precio * 0.93) }, { desde: 12, precio: r(precio * 0.90) }, { desde: 50, precio: r(precio * 0.86) }];
    return [{ desde: 3, precio: r(precio * 0.95) }, { desde: 6, precio: r(precio * 0.92) }, { desde: 12, precio: r(precio * 0.88) }];
  }
  function deudaDe(p) {
    return Math.max(0, num(p.total) - num(p.monto_pagado));
  }

  /* ================= Auth ================= */
  function showLogin(msg) {
    $('login-view').style.display = 'flex';
    $('app-view').style.display = 'none';
    if (msg) $('login-error').textContent = msg;
  }
  function pintarLoginModo() {
    var ing = state.loginModo === 'ingresar';
    $('tab-ingresar').classList.toggle('on', ing);
    $('tab-registro').classList.toggle('on', !ing);
    $('login-titulo').textContent = ing ? 'Inicia sesión' : 'Crea tu cuenta del equipo';
    $('login-hint').textContent = ing
      ? 'Acceso solo para el equipo de Gasomi.'
      : 'Usa el correo que el administrador registró en Equipo. Te llegará un email para confirmar.';
    $('login-btn').textContent = ing ? 'Entrar' : 'Crear cuenta';
  }
  $('tab-ingresar').addEventListener('click', function () { state.loginModo = 'ingresar'; pintarLoginModo(); });
  $('tab-registro').addEventListener('click', function () { state.loginModo = 'registro'; pintarLoginModo(); });

  async function boot() {
    var s = await db.auth.getSession();
    if (s.data.session) { await enter(s.data.session); } else { showLogin(''); }
  }
  async function enter(session) {
    var r = await db.from('gasomi_crm_usuarios').select('*').eq('email', session.user.email);
    var u = r.data && r.data[0];
    if (!u || !u.activo) {
      await db.auth.signOut();
      showLogin(u ? 'Tu acceso está desactivado. Habla con el administrador.' : 'Esta cuenta no es parte del equipo de Gasomi.');
      return;
    }
    state.usuario = u;
    state.rol = u.rol;
    $('login-view').style.display = 'none';
    $('app-view').style.display = 'flex';
    $('side-user').textContent = (u.nombre ? u.nombre + ' · ' : '') + u.email + ' · ' + (esAdmin() ? 'Administrador' : 'Vendedor');
    if (!esAdmin()) document.querySelectorAll('.solo-admin').forEach(function (b) { b.style.display = 'none'; });
    await cargarTodo();
    render();
    activarRealtime();
  }
  $('login-btn').addEventListener('click', doLoginRegistro);
  $('login-pass').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLoginRegistro(); });
  async function doLoginRegistro() {
    $('login-error').textContent = '';
    var email = $('login-email').value.trim();
    var pass = $('login-pass').value;
    if (state.loginModo === 'registro') {
      if (pass.length < 6) { $('login-error').textContent = 'La contraseña necesita 6+ caracteres.'; return; }
      var rr = await db.auth.signUp({ email: email, password: pass });
      if (rr.error) {
        $('login-error').textContent = rr.error.message.indexOf('already') > -1 ? 'Este correo ya tiene cuenta: usa "Ingresar".' : 'No se pudo crear: ' + rr.error.message;
        return;
      }
      $('login-error').textContent = 'Cuenta creada. Revisa tu correo, confírmalo y luego ingresa aquí.';
      state.loginModo = 'ingresar';
      pintarLoginModo();
      return;
    }
    $('login-btn').textContent = 'Entrando…';
    var r = await db.auth.signInWithPassword({ email: email, password: pass });
    $('login-btn').textContent = 'Entrar';
    if (r.error) { $('login-error').textContent = 'Credenciales incorrectas o cuenta sin confirmar.'; return; }
    await enter(r.data.session);
  }
  $('logout-btn').addEventListener('click', async function () {
    await db.auth.signOut();
    location.reload();
  });

  /* ================= Data ================= */
  async function cargarTodo() {
    var rc = await db.from('gasomi_categorias').select('*').order('orden');
    var rp = await db.from('gasomi_productos').select('*').order('orden');
    var rped = await db.from('gasomi_pedidos').select('*').order('created_at', { ascending: false }).limit(200);
    var rcli = await db.from('gasomi_clientes').select('*').order('created_at', { ascending: false });
    var rt = await db.from('gasomi_tareas').select('*').eq('hecho', false).order('fecha').limit(100);
    state.categorias = rc.data || [];
    state.productos = rp.data || [];
    state.pedidos = rped.data || [];
    state.clientes = rcli.data || [];
    state.tareas = rt.data || [];
    if (esAdmin()) {
      var rcf = await db.from('gasomi_config').select('*');
      state.config = {};
      (rcf.data || []).forEach(function (row) { state.config[row.clave] = row.valor; });
      var rh = await db.from('gasomi_precios_historial').select('*, gasomi_productos(nombre)').order('created_at', { ascending: false }).limit(200);
      state.historial = rh.data || [];
      var rco = await db.from('gasomi_costos').select('*');
      state.costos = {};
      (rco.data || []).forEach(function (c) { state.costos[c.producto_id] = num(c.costo); });
    }
  }

  var rtTimer = null;
  function activarRealtime() {
    if (rtOn) return;
    rtOn = true;
    function refrescar(aviso) {
      clearTimeout(rtTimer);
      rtTimer = setTimeout(async function () {
        await cargarTodo();
        render();
        if (aviso) toast(aviso);
      }, 400);
    }
    db.channel('crm-pedidos')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'gasomi_pedidos' }, function (p) {
        refrescar('Nuevo pedido #' + (p.new ? p.new.id : '') + ' — stock actualizado');
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'gasomi_pedidos' }, function (p) {
        var pagoNuevo = p.new && p.old && p.new.pago_estado === 'pagado' && p.old.pago_estado !== 'pagado' && p.new.pago_ref;
        refrescar(pagoNuevo ? '💰 Pago online recibido — pedido #' + p.new.id + ' (' + fmt(p.new.total) + ')' : null);
      })
      .subscribe();
    db.channel('crm-productos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gasomi_productos' }, function () { refrescar(null); })
      .subscribe();
    db.channel('crm-clientes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gasomi_clientes' }, function () { refrescar(null); })
      .subscribe();
  }

  /* ================= Navegación ================= */
  document.querySelectorAll('.side-link').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.side-link').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      document.querySelectorAll('.view').forEach(function (v) { v.style.display = 'none'; });
      $('view-' + b.dataset.view).style.display = 'block';
      if (b.dataset.view === 'venta') pintarVenta();
    });
  });
  function irA(view) {
    var btn = document.querySelector('.side-link[data-view="' + view + '"]');
    if (btn) btn.click();
  }

  /* ================= Render ================= */
  function render() { renderMiDia(); renderChips(); renderProductos(); renderPedChips(); renderPedidos(); renderClientes(); renderHistorial(); renderEquipo(); renderDeptos(); renderConfig(); pintarVenta(); }

  function ventasDe(dia) {
    return state.pedidos.filter(function (p) {
      return p.estado === 'atendido' && new Date(p.created_at).toLocaleDateString('en-CA', { timeZone: 'America/Lima' }) === dia;
    });
  }

  function renderMiDia() {
    $('midia-saludo').textContent = 'Hola, ' + ((state.usuario && state.usuario.nombre) ? state.usuario.nombre.split(' ')[0] : 'equipo');
    $('dash-fecha').textContent = new Date().toLocaleDateString('es-PE', { timeZone: 'America/Lima', weekday: 'long', day: 'numeric', month: 'long' });
    var hoy = hoyLima();
    var vHoy = ventasDe(hoy);
    var totalHoy = vHoy.reduce(function (a, p) { return a + num(p.total); }, 0);
    var nuevos = state.pedidos.filter(function (p) { return p.estado === 'nuevo'; });
    var porCobrar = state.pedidos.filter(function (p) { return p.estado === 'atendido' && p.pago_estado !== 'pagado' && deudaDe(p) > 0; });
    var deuda = porCobrar.reduce(function (a, p) { return a + deudaDe(p); }, 0);
    var bajos = state.productos.filter(function (p) { return p.activo && p.stock <= 5; });
    var mes = hoy.slice(0, 7);
    var vMes = state.pedidos.filter(function (p) {
      return p.estado === 'atendido' && new Date(p.created_at).toLocaleDateString('en-CA', { timeZone: 'America/Lima' }).slice(0, 7) === mes;
    }).reduce(function (a, p) { return a + num(p.total); }, 0);

    $('kpis').innerHTML =
      '<div class="kpi"><div class="kpi-n">' + fmt(totalHoy) + '</div><div class="kpi-l">Vendido hoy (' + vHoy.length + ' ventas)</div></div>' +
      '<div class="kpi"><div class="kpi-n' + (nuevos.length ? ' kpi-aviso' : '') + '">' + nuevos.length + '</div><div class="kpi-l">Pedidos por atender</div></div>' +
      '<div class="kpi"><div class="kpi-n' + (deuda > 0 ? ' kpi-alerta' : '') + '">' + fmt(deuda) + '</div><div class="kpi-l">Por cobrar (' + porCobrar.length + ')</div></div>' +
      (esAdmin() ? '<div class="kpi"><div class="kpi-n">' + fmt(vMes) + '</div><div class="kpi-l">Vendido este mes</div></div>' : '') +
      '<div class="kpi"><div class="kpi-n' + (bajos.length ? ' kpi-aviso' : '') + '">' + bajos.length + '</div><div class="kpi-l">Por agotarse (≤5)</div></div>';

    var badge = $('badge-pedidos');
    badge.style.display = nuevos.length ? 'inline-flex' : 'none';
    badge.textContent = nuevos.length;

    $('md-nuevos').innerHTML = nuevos.slice(0, 6).map(function (p) {
      return '<div class="pl-row"><div class="pl-main">#' + p.id + ' · ' + esc(nombreCliente(p.cliente_id, p)) + (p.pago_metodo ? ' · ' + esc(p.pago_metodo) : '') +
        '<div class="pl-sub">' + fecha(p.created_at) + ' · ' + (p.items || []).length + ' líneas' + (p.entrega === 'obra' ? ' · 🚚 obra' : '') + '</div></div>' +
        '<div class="md-acciones"><span class="pl-val">' + fmt(p.total) + '</span>' +
        '<button class="btn-mini-ok" data-atender="' + p.id + '">Atender ✓</button></div></div>';
    }).join('') || '<div class="pl-empty">Nada pendiente. Todo atendido ✓</div>';

    $('md-cobrar').innerHTML = porCobrar.slice(0, 6).map(function (p) {
      var c = clienteDe(p.cliente_id);
      var wa = telWa(c);
      var link = wa ? '<a class="btn-mini-wa" target="_blank" rel="noopener" href="https://wa.me/' + wa + '?text=' +
        encodeURIComponent('Hola ' + (c.nombre || '') + '! Te recordamos el saldo pendiente de ' + fmt(deudaDe(p)) + ' del pedido #' + p.id + ' en Gasomi. Puedes pagar por Yape o Plin al 958 682 246. ¡Gracias!') + '">Recordar 💬</a>' : '';
      return '<div class="pl-row"><div class="pl-main">#' + p.id + ' · ' + (p.cliente_id ? esc(nombreCliente(p.cliente_id)) : 'sin cuenta') +
        '<div class="pl-sub">' + esc(p.pago_estado) + (p.pago_metodo ? ' · ' + esc(p.pago_metodo) : '') + '</div></div>' +
        '<div class="md-acciones"><span class="pl-val">' + fmt(deudaDe(p)) + '</span>' + link + '</div></div>';
    }).join('') || '<div class="pl-empty">No hay deudas pendientes ✓</div>';

    var hoyD = hoyLima();
    $('md-tareas').innerHTML = state.tareas.slice(0, 8).map(function (t) {
      var vencida = t.fecha < hoyD;
      return '<div class="pl-row"><div class="pl-main">' + esc(t.texto) +
        '<div class="pl-sub' + (vencida ? ' tarea-vencida' : '') + '">' + (t.cliente_id ? esc(nombreCliente(t.cliente_id)) + ' · ' : '') + t.fecha + (vencida ? ' · vencida' : '') + '</div></div>' +
        '<button class="btn-mini-ok" data-tarea-ok="' + t.id + '">Hecho ✓</button></div>';
    }).join('') || '<div class="pl-empty">Sin tareas pendientes. Agrega una arriba ↑</div>';

    $('md-stock').innerHTML = bajos.slice(0, 8).map(function (p) {
      return '<div class="pl-row"><div class="pl-main">' + esc(p.nombre) + '<div class="pl-sub">' + esc(p.marca) + '</div></div>' +
        '<span class="pl-val' + (p.stock <= 0 ? ' txt-alerta' : '') + '">' + p.stock + ' und.</span></div>';
    }).join('') || '<div class="pl-empty">Stock saludable en todo el catálogo ✓</div>';
  }

  /* ================= Venta rápida ================= */
  function pintarVenta() {
    if (!$('v-cliente')) return;
    var sel = $('v-cliente');
    var actual = state.venta.cliente;
    sel.innerHTML = '<option value="">— Venta sin cuenta de cliente —</option>' + state.clientes.map(function (c) {
      return '<option value="' + esc(c.user_id) + '"' + (c.user_id === actual ? ' selected' : '') + '>' + esc((c.nombre || c.email) + (c.empresa ? ' · ' + c.empresa : '')) + '</option>';
    }).join('');
    $('v-repetir').style.display = actual && ultimoPedidoDe(actual) ? 'inline-flex' : 'none';
    pintarResultados();
    pintarTicket();
  }
  function ultimoPedidoDe(uid) {
    return state.pedidos.find(function (p) { return p.cliente_id === uid && p.estado !== 'anulado'; });
  }
  function ultimoPrecioDe(uid, pid) {
    if (!uid) return null;
    for (var i = 0; i < state.pedidos.length; i++) {
      var p = state.pedidos[i];
      if (p.cliente_id !== uid || p.estado === 'anulado') continue;
      var it = (p.items || []).find(function (x) { return x.id === pid; });
      if (it) return num(it.precio);
    }
    return null;
  }
  function pintarResultados() {
    var q = state.venta.q;
    var vis = state.productos.filter(function (p) {
      if (!p.activo) return false;
      if (q && !coincide(p.nombre + ' ' + p.marca + ' ' + p.categoria + ' ' + (p.subcategoria || ''), q)) return false;
      return true;
    }).slice(0, 12);
    $('v-resultados').innerHTML = vis.map(function (p) {
      var thumb = p.imagen ? '<img src="' + esc(thumbSrc(p)) + '" alt="" loading="lazy">' : '<div class="v-ph">' + esc(p.nombre.charAt(0)) + '</div>';
      var chip = p.stock <= 0 ? '<span class="v-chip fuera">Agotado</span>' : (p.stock <= 5 ? '<span class="v-chip pocas">' + p.stock + '</span>' : '');
      return '<button class="v-card' + (p.stock <= 0 ? ' agotada' : '') + '" data-v-add="' + esc(p.id) + '"' + (p.stock <= 0 ? ' disabled' : '') + '>' +
        thumb + chip +
        '<span class="v-nombre">' + esc(p.nombre) + '</span>' +
        '<span class="v-precio">' + fmt(p.precio) + '</span>' +
        '</button>';
    }).join('') || '<div class="pl-empty">Sin resultados para esa búsqueda.</div>';
  }
  function pintarTicket() {
    var total = 0;
    var html = state.venta.items.map(function (it) {
      var p = prodDe(it.id);
      if (!p) return '';
      var pu = precioAplicado(p, it.qty);
      var sub = pu * it.qty;
      total += sub;
      var esMayor = pu < num(p.precio);
      var hist = ultimoPrecioDe(state.venta.cliente, it.id);
      var hint = (hist != null && Math.abs(hist - pu) > 0.005) ? '<div class="v-hint">Última vez a este cliente: ' + fmt(hist) + '</div>' : '';
      var sig = escalasDe(p).filter(function (t) { return t.desde > it.qty; })[0];
      if (sig) hint += '<div class="v-hint" style="background:#e9f9ef;color:#17663a">Con ' + sig.desde + '+ baja a ' + fmt(sig.precio) + ' c/u</div>';
      return '<div class="t-item"><div class="t-info"><div class="t-nombre">' + esc(p.nombre) + '</div>' +
        '<div class="t-meta">' + fmt(pu) + (esMayor ? ' <b class="tag-mayor">por mayor</b>' : '') + (it.qty > p.stock ? ' <b class="txt-alerta">¡solo hay ' + p.stock + '!</b>' : '') + '</div>' + hint + '</div>' +
        '<div class="step"><button data-v-dec="' + esc(it.id) + '">−</button><span>' + it.qty + '</span><button data-v-inc="' + esc(it.id) + '">+</button></div>' +
        '<div class="d-sub">' + fmt(sub) + '</div>' +
        '<button class="d-x" data-v-del="' + esc(it.id) + '">✕</button></div>';
    }).join('');
    $('v-items').innerHTML = html || '<div class="pl-empty">Toca productos de la izquierda para armar la venta.</div>';
    $('v-total').textContent = fmt(total);
    $('v-parcial-row').style.display = $('v-pago').value === 'parcial' ? 'flex' : 'none';
    return total;
  }
  function ventaAdd(id, delta) {
    var it = state.venta.items.find(function (x) { return x.id === id; });
    var p = prodDe(id);
    if (!it && delta > 0) { state.venta.items.push({ id: id, qty: 1 }); }
    else if (it) {
      it.qty += delta;
      if (p && it.qty > p.stock) { it.qty = p.stock; toast('Solo hay ' + p.stock + ' en stock'); }
      if (it.qty <= 0) state.venta.items = state.venta.items.filter(function (x) { return x.id !== id; });
    }
    pintarTicket();
  }
  async function registrarVenta() {
    if (!state.venta.items.length) { toast('El ticket está vacío', true); return; }
    var items = [];
    var total = 0;
    var falta = state.venta.items.find(function (it) { var p = prodDe(it.id); return !p || it.qty > p.stock; });
    if (falta) { toast('Hay una línea con más cantidad que el stock', true); return; }
    state.venta.items.forEach(function (it) {
      var p = prodDe(it.id);
      var pu = precioAplicado(p, it.qty);
      var sub = +(pu * it.qty).toFixed(2);
      total += sub;
      items.push({ id: p.id, nombre: p.nombre, qty: it.qty, precio: pu, mayor: pu < num(p.precio), subtotal: sub });
    });
    total = +total.toFixed(2);
    var pago = $('v-pago').value;
    var monto = pago === 'pagado' ? total : (pago === 'parcial' ? Math.min(total, num($('v-monto').value)) : 0);
    if (pago === 'parcial' && monto <= 0) { toast('Ingresa el monto recibido', true); return; }
    var r = await db.from('gasomi_pedidos').insert({
      items: items, total: total, estado: 'atendido', origen: 'mostrador',
      vendedor_email: state.usuario.email,
      cliente_id: state.venta.cliente || null,
      pago_estado: pago, pago_metodo: $('v-metodo').value, monto_pagado: monto,
      nota: ''
    }).select();
    if (r.error || !r.data.length) { toast('No se pudo registrar: ' + (r.error ? r.error.message : ''), true); return; }
    toast('Venta #' + r.data[0].id + ' registrada ✓ (' + fmt(total) + ')');
    notaVenta(r.data[0]);
    state.venta = { cliente: state.venta.cliente, items: [], q: '' };
    $('v-buscar').value = '';
    await cargarTodo();
    render();
  }

  /* ================= Productos ================= */
  function renderChips() {
    var cats = [{ slug: 'todos', nombre: 'Todos' }].concat(state.categorias);
    var est = [['todos', 'Todos los estados'], ['visibles', 'Visibles'], ['ocultos', 'Ocultos'], ['sinstock', 'Sin stock']];
    $('prod-chips').innerHTML = cats.map(function (c) {
      var n = c.slug === 'todos' ? state.productos.length : state.productos.filter(function (p) { return p.categoria === c.slug; }).length;
      return '<button class="chip' + (state.cat === c.slug ? ' on' : '') + (c.activa === false ? ' chip-off' : '') + '" data-cat="' + esc(c.slug) + '">' + esc(c.nombre) + ' <span class="chip-n">' + n + '</span></button>';
    }).join('') + '<span class="chip-sep"></span>' + est.map(function (e) {
      return '<button class="chip chip-est' + ((state.estadoF || 'todos') === e[0] ? ' on' : '') + '" data-est="' + e[0] + '">' + e[1] + '</button>';
    }).join('');
  }
  function catNombre(slug) {
    var c = state.categorias.find(function (x) { return x.slug === slug; });
    return c ? c.nombre : slug;
  }
  function renderProductos() {
    var admin = esAdmin();
    var vis = state.productos.filter(function (p) {
      if (state.cat !== 'todos' && p.categoria !== state.cat) return false;
      if (state.estadoF === 'visibles' && !p.activo) return false;
      if (state.estadoF === 'ocultos' && p.activo) return false;
      if (state.estadoF === 'sinstock' && p.stock > 0) return false;
      if (state.q && !coincide(p.nombre + ' ' + p.marca + ' ' + (p.subcategoria || ''), state.q)) return false;
      return true;
    });
    state.visiblesIds = vis.map(function (p) { return p.id; });
    if ($('prod-masivo-txt')) $('prod-masivo-txt').textContent = vis.length + ' productos en este filtro · ' + vis.filter(function (p) { return p.activo; }).length + ' visibles en la tienda';
    $('prod-tbody').innerHTML = vis.map(function (p) {
      var thumb = p.imagen
        ? '<img class="prod-thumb" src="' + esc(thumbSrc(p)) + '" onerror="this.style.display=\'none\'" alt="">'
        : '<div class="prod-thumb-ph">' + esc(p.nombre.charAt(0)) + '</div>';
      var margen = '';
      if (admin && state.costos[p.id] > 0) {
        var m = ((num(p.precio) - state.costos[p.id]) / num(p.precio)) * 100;
        margen = '<div class="margen-chip' + (m < 15 ? ' bajo' : '') + '">margen ' + m.toFixed(0) + '%</div>';
      }
      var esc0 = escalasDe(p);
      var mayor = esc0.length
        ? esc0.map(function (t) { return '<div class="pl-sub" style="color:var(--on-surface)"><b>' + t.desde + '+</b> ' + fmt(t.precio) + '</div>'; }).join('')
        : '<span class="cat-tag">—</span>';
      var stockCls = p.stock <= 0 ? ' stock-cero' : (p.stock <= 5 ? ' stock-bajo' : '');
      var precioCell = admin
        ? '<div class="precio-edit"><input type="number" step="0.10" min="0" value="' + num(p.precio).toFixed(2) + '" data-precio="' + esc(p.id) + '"><button class="precio-save" data-save="' + esc(p.id) + '" title="Guardar precio">✓</button></div>' + margen
        : '<b>' + fmt(p.precio) + '</b>';
      var stockCell = admin
        ? '<div class="precio-edit"><input type="number" step="1" min="0" class="input-stock' + stockCls + '" value="' + p.stock + '" data-stock="' + esc(p.id) + '"><button class="precio-save" data-save-stock="' + esc(p.id) + '" title="Guardar stock">✓</button></div>'
        : '<b class="' + (p.stock <= 5 ? 'txt-alerta' : '') + '">' + p.stock + '</b>';
      var visibleCell = admin
        ? '<button class="switch' + (p.activo ? ' on' : '') + '" data-activo="' + esc(p.id) + '"></button>'
        : '<span class="cat-tag">' + (p.activo ? 'Sí' : 'No') + '</span>';
      var editCell = admin ? '<button class="icon-btn" data-edit="' + esc(p.id) + '" title="Editar producto">✎</button>' : '';
      return '<tr data-id="' + esc(p.id) + '">' +
        '<td><div class="prod-cell">' + thumb + '<div><div class="prod-nombre">' + esc(p.nombre) + '</div><div class="prod-marca">' + esc(p.marca) + ' · ' + esc(p.unidad) + '</div></div></div></td>' +
        '<td>' + precioCell + '</td>' +
        '<td>' + mayor + '</td>' +
        '<td>' + stockCell + '</td>' +
        '<td>' + visibleCell + '</td>' +
        '<td>' + editCell + '</td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="6" style="color:var(--muted)">Sin resultados.</td></tr>';
  }

  /* ================= Pedidos ================= */
  function renderPedChips() {
    var filtros = [['todos', 'Todos'], ['nuevo', 'Nuevos'], ['atendido', 'Atendidos'], ['porcobrar', 'Por cobrar'], ['anulado', 'Anulados']];
    $('ped-chips').innerHTML = filtros.map(function (f) {
      return '<button class="chip' + (state.pedFiltro === f[0] ? ' on' : '') + '" data-pedf="' + f[0] + '">' + f[1] + '</button>';
    }).join('');
  }
  function renderPedidos() {
    var vis = state.pedidos.filter(function (p) {
      if (state.pedFiltro === 'todos') return true;
      if (state.pedFiltro === 'porcobrar') return p.estado === 'atendido' && deudaDe(p) > 0;
      return p.estado === state.pedFiltro;
    });
    $('pedidos-list').innerHTML = vis.map(function (p) {
      var items = (p.items || []).map(function (i) {
        return '<div><span>' + i.qty + ' × ' + esc(i.nombre) + (i.mayor ? ' <b class="tag-mayor">por mayor</b>' : '') + '</span><span>' + fmt(i.subtotal) + '</span></div>';
      }).join('');
      var c = clienteDe(p.cliente_id) || (p.cliente_telefono ? { nombre: p.cliente_nombre, telefono: p.cliente_telefono } : null);
      var wa = telWa(c);
      var cli = p.cliente_id
        ? '<span class="pedido-cliente">' + esc(nombreCliente(p.cliente_id)) + (p.puntos_otorgados ? ' · <b class="tag-pts">pts ✓</b>' : '') + '</span>'
        : '<span class="pedido-cliente">Sin cuenta</span>';
      var origen = '<span class="tag-origen' + (p.origen === 'mostrador' ? ' mostrador' : '') + '">' + (p.origen === 'mostrador' ? 'Mostrador' : 'Tienda web') + '</span>';
      var deuda = deudaDe(p);
      var pagoBadge = p.pago_estado === 'pagado'
        ? '<span class="pago-badge ok">' + (p.pago_ref ? '⚡ Pagado online' : 'Pagado') + (p.pago_metodo ? ' · ' + esc(p.pago_metodo) : '') + '</span>'
        : '<span class="pago-badge deuda">Debe ' + fmt(deuda) + '</span>';
      var waBtns = wa ? '<div class="wa-plantillas">' +
        '<a target="_blank" rel="noopener" href="https://wa.me/' + wa + '?text=' + encodeURIComponent('Hola ' + (c.nombre || '') + '! Confirmamos tu pedido #' + p.id + ' por ' + fmt(p.total) + '. Coordinamos la entrega. — Gasomi Ingenieros') + '">Confirmar 💬</a>' +
        '<a target="_blank" rel="noopener" href="https://wa.me/' + wa + '?text=' + encodeURIComponent('Hola ' + (c.nombre || '') + '! Tu pedido #' + p.id + ' ya está listo para entrega o recojo. — Gasomi Ingenieros') + '">Listo 💬</a>' +
        (deuda > 0 ? '<a target="_blank" rel="noopener" href="https://wa.me/' + wa + '?text=' + encodeURIComponent('Hola ' + (c.nombre || '') + '! Te recordamos el saldo pendiente de ' + fmt(deuda) + ' del pedido #' + p.id + '. Yape/Plin: 958 682 246. ¡Gracias! — Gasomi') + '">Cobrar 💬</a>' : '') +
        '</div>' : '';
      return '<div class="pedido-card"><div class="pedido-head">' +
        '<span class="pedido-id">#' + p.id + '</span>' +
        '<span class="pedido-fecha">' + fecha(p.created_at) + '</span>' +
        origen + cli + pagoBadge +
        '<select class="pedido-estado" data-estado="' + p.id + '">' +
        ['nuevo', 'atendido', 'anulado'].map(function (e) { return '<option value="' + e + '"' + (p.estado === e ? ' selected' : '') + '>' + e + '</option>'; }).join('') +
        '</select>' +
        '<select class="pedido-estado" data-pago="' + p.id + '">' +
        [['pendiente', 'por cobrar'], ['parcial', 'pago parcial'], ['pagado', 'pagado']].map(function (e) { return '<option value="' + e[0] + '"' + (p.pago_estado === e[0] ? ' selected' : '') + '>' + e[1] + '</option>'; }).join('') +
        '</select>' +
        '<span class="pedido-total">' + fmt(p.total) + '</span>' +
        '<button class="icon-btn" data-nota="' + p.id + '" title="Nota de venta (imprimir/PDF)">🧾</button>' +
        '</div>' +
        (p.nota ? '<div class="pedido-nota">' + esc(p.nota) + '</div>' : '') +
        ((p.cliente_nombre || p.cliente_telefono || p.direccion) ? '<div class="ped-datos">' +
          (p.cliente_nombre ? '<span><b>' + esc(p.cliente_nombre) + '</b>' + (p.cliente_empresa ? ' · ' + esc(p.cliente_empresa) : '') + '</span>' : '') +
          (p.cliente_telefono ? '<span>📱 ' + esc(p.cliente_telefono) + '</span>' : '') +
          '<span>' + (p.entrega === 'obra' ? '🚚 Obra: ' + esc(p.direccion) : '🏬 Recojo en tienda') + '</span>' +
          (p.comprobante_tipo === 'factura' ? '<span>🧾 Factura RUC ' + esc(p.cliente_ruc) + '</span>' : '') +
          (p.comprobante_url ? '<a class="comp-link" href="#" data-comp="' + esc(p.comprobante_url) + '">📎 Ver comprobante</a>' : '') +
          '</div>' : '') +
        (p.pago_ref ? '<div class="pl-sub" style="margin-top:6px">Ref. pago: ' + esc(p.pago_ref) + (p.pago_pasarela === 'demo' ? ' (demo)' : '') + (p.pagado_at ? ' · ' + fecha(p.pagado_at) : '') + '</div>' : '') +
        (p.vendedor_email ? '<div class="pl-sub" style="margin-top:6px">Vendedor: ' + esc(p.vendedor_email) + '</div>' : '') +
        waBtns +
        '<div class="pedido-items">' + items + '</div></div>';
    }).join('') || '<div class="pl-empty" style="padding:16px">No hay pedidos con ese filtro.</div>';
  }

  /* ================= Clientes + 360 ================= */
  function deudaCliente(uid) {
    return state.pedidos.filter(function (p) { return p.cliente_id === uid && p.estado === 'atendido'; }).reduce(function (a, p) { return a + deudaDe(p); }, 0);
  }
  function renderClientes() {
    var filtros = [['todos', 'Todos'], ['deuda', 'Con deuda'], ['recientes', 'Nuevos (30 días)'], ['top', 'Mejores compradores'], ['dormidos', 'Sin compras 60+ días']];
    if ($('cli-chips')) $('cli-chips').innerHTML = filtros.map(function (f) { return '<button class="chip' + (state.cliF === f[0] ? ' on' : '') + '" data-clif="' + f[0] + '">' + f[1] + '</button>'; }).join('');
    var ahora = Date.now();
    var lista = state.clientes.map(function (c) {
      var peds = state.pedidos.filter(function (p) { return p.cliente_id === c.user_id && p.estado !== 'anulado'; });
      var ultimo = peds.length ? Math.max.apply(null, peds.map(function (p) { return new Date(p.created_at).getTime(); })) : 0;
      return { c: c, peds: peds, total: peds.reduce(function (a, p) { return a + num(p.total); }, 0), deuda: deudaCliente(c.user_id), ultimo: ultimo };
    }).filter(function (x) {
      if (state.cliQ && !coincide(x.c.nombre + ' ' + x.c.email + ' ' + x.c.empresa + ' ' + x.c.telefono + ' ' + (x.c.ruc || '') + ' ' + (x.c.etiqueta || ''), state.cliQ)) return false;
      if (state.cliF === 'deuda') return x.deuda > 0;
      if (state.cliF === 'recientes') return ahora - new Date(x.c.created_at).getTime() < 30 * 864e5;
      if (state.cliF === 'dormidos') return x.peds.length && ahora - x.ultimo > 60 * 864e5;
      return true;
    });
    if (state.cliF === 'top') lista.sort(function (a, b) { return b.total - a.total; });
    $('cli-tbody').innerHTML = lista.map(function (x) {
      var c = x.c;
      var etq = c.etiqueta ? '<span class="tag-etq ' + esc(c.etiqueta) + '">' + esc(c.etiqueta) + '</span>' : '';
      return '<tr class="cli-row" data-cli="' + esc(c.user_id) + '">' +
        '<td><div class="prod-nombre">' + esc(c.nombre || '—') + etq + '</div><div class="pl-sub">' + esc(c.email) + (c.provider === 'google' ? ' · Google' : '') + '</div></td>' +
        '<td>' + esc(c.telefono || '—') + '</td>' +
        '<td>' + esc(c.empresa || '—') + (c.ruc ? '<div class="pl-sub">RUC ' + esc(c.ruc) + '</div>' : '') + '</td>' +
        '<td><b class="pts-badge">' + c.puntos + ' pts</b></td>' +
        '<td>' + x.peds.length + ' pedidos<div class="pl-sub">' + fmt(x.total) + '</div></td>' +
        '<td>' + (x.deuda > 0 ? '<b class="txt-alerta">' + fmt(x.deuda) + '</b>' : '<span class="cat-tag">—</span>') + '</td>' +
        '<td><button class="icon-btn" data-cli-ver="' + esc(c.user_id) + '" title="Ver ficha del cliente">👁</button></td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="7" style="color:var(--muted)">Sin clientes con ese filtro.</td></tr>';
  }

  function abrirCliente(uid) {
    var c = clienteDe(uid);
    if (!c) return;
    var peds = state.pedidos.filter(function (p) { return p.cliente_id === uid; }).slice(0, 6);
    var deuda = state.pedidos.filter(function (p) { return p.cliente_id === uid && p.estado === 'atendido'; })
      .reduce(function (a, p) { return a + deudaDe(p); }, 0);
    var wa = telWa(c);
    $('cli-titulo').textContent = c.nombre || c.email;
    $('cli-body').innerHTML =
      '<div class="cli-grid">' +
      '<div><div class="pl-sub">Contacto</div><b>' + esc(c.telefono || '—') + '</b><div class="pl-sub">' + esc(c.email) + '</div></div>' +
      '<div><div class="pl-sub">Empresa</div><b>' + esc(c.empresa || '—') + '</b></div>' +
      '<div><div class="pl-sub">Puntos</div><b class="pts-badge">' + c.puntos + ' pts</b></div>' +
      '<div><div class="pl-sub">Deuda</div><b class="' + (deuda > 0 ? 'txt-alerta' : '') + '">' + fmt(deuda) + '</b></div>' +
      '</div>' +
      '<div class="cli-acciones">' +
      (wa ? '<a class="btn-mini-wa" target="_blank" rel="noopener" href="https://wa.me/' + wa + '?text=' + encodeURIComponent('Hola ' + (c.nombre || '') + '! Te saluda el equipo de Gasomi Ingenieros 👷') + '">WhatsApp 💬</a>' : '') +
      '<button class="btn-ghost btn-mini" data-cli-venta="' + esc(uid) + '">Nueva venta</button>' +
      (ultimoPedidoDe(uid) ? '<button class="btn-ghost btn-mini" data-cli-repetir="' + esc(uid) + '">Repetir último pedido</button>' : '') +
      '<button class="btn-ghost btn-mini" data-cli-tarea="' + esc(uid) + '">+ Tarea</button>' +
      (esAdmin() ? '<button class="btn-ghost btn-mini" data-puntos="' + esc(uid) + '">± Puntos</button>' : '') +
      '</div>' +
      '<h4 class="cli-sub">Datos del cliente</h4>' +
      '<div class="cli-edit-grid">' +
      '<label>Nombre<input type="text" id="ce-nombre" value="' + esc(c.nombre) + '"></label>' +
      '<label>Teléfono<input type="text" id="ce-telefono" value="' + esc(c.telefono) + '"></label>' +
      '<label>Empresa<input type="text" id="ce-empresa" value="' + esc(c.empresa) + '"></label>' +
      '<label>RUC<input type="text" id="ce-ruc" value="' + esc(c.ruc || '') + '"></label>' +
      '<label class="span2">Dirección / obra<input type="text" id="ce-direccion" value="' + esc(c.direccion || '') + '"></label>' +
      '<label>Etiqueta<select id="ce-etiqueta"><option value="">—</option>' + ['vip', 'constructora', 'nuevo', 'moroso'].map(function (e) { return '<option value="' + e + '"' + (c.etiqueta === e ? ' selected' : '') + '>' + e + '</option>'; }).join('') + '</select></label>' +
      '<label class="span2">Notas internas<textarea id="ce-notas" rows="2">' + esc(c.notas || '') + '</textarea></label>' +
      '<div class="span2"><button class="btn-primary btn-mini" data-cli-guardar="' + esc(uid) + '">Guardar datos</button></div></div>' +
      '<h4 class="cli-sub">Últimos pedidos</h4>' +
      (peds.map(function (p) {
        return '<div class="pl-row"><div class="pl-main">#' + p.id + ' · ' + esc(p.estado) + (deudaDe(p) > 0 && p.estado === 'atendido' ? ' · <b class="txt-alerta">debe ' + fmt(deudaDe(p)) + '</b>' : '') +
          '<div class="pl-sub">' + fecha(p.created_at) + ' · ' + (p.items || []).length + ' líneas</div></div><span class="pl-val">' + fmt(p.total) + '</span></div>';
      }).join('') || '<div class="pl-empty">Sin pedidos aún.</div>');
    $('cli-bg').style.display = 'flex';
  }
  $('cli-close').addEventListener('click', function () { $('cli-bg').style.display = 'none'; });
  $('cli-bg').addEventListener('click', function (e) { if (e.target === $('cli-bg')) $('cli-bg').style.display = 'none'; });

  /* ================= Departamentos ================= */
  function renderDeptos() {
    var el = $('deptos-crm');
    if (!el || !esAdmin()) return;
    el.innerHTML = state.categorias.map(function (c) {
      var ps = state.productos.filter(function (p) { return p.categoria === c.slug; });
      var act = ps.filter(function (p) { return p.activo; }).length;
      var conStock = ps.filter(function (p) { return p.stock > 0; }).length;
      var foto = c.imagen || (ps.filter(function (p) { return p.imagen; })[0] || {}).imagen || '';
      var img = foto ? '<img src="' + esc(foto.indexOf('http') === 0 ? foto : '../tienda/' + foto) + '" alt="">' : '<div class="prod-thumb-ph">' + esc(c.nombre.charAt(0)) + '</div>';
      return '<div class="dep-card' + (c.activa === false ? ' off' : '') + '">' +
        '<div class="dep-top">' + img + '<div style="flex:1"><div class="dep-nombre">' + esc(c.nombre) + '</div>' +
        '<div class="dep-n">' + ps.length + ' productos · ' + act + ' visibles · ' + conStock + ' con stock</div></div>' +
        '<button class="switch' + (c.activa !== false ? ' on' : '') + '" data-dep-activa="' + esc(c.slug) + '" title="Mostrar u ocultar el departamento en la tienda"></button></div>' +
        '<div class="dep-acciones">' +
        '<button class="btn-ghost" data-dep-ver="' + esc(c.slug) + '">Ver productos</button>' +
        '<button class="btn-ghost" data-dep-editar="' + esc(c.slug) + '">Editar</button>' +
        '<button class="btn-ghost" data-dep-mostrar="' + esc(c.slug) + '">Mostrar todos</button>' +
        '<button class="btn-ghost" data-dep-ocultar="' + esc(c.slug) + '">Ocultar todos</button>' +
        '<button class="btn-ghost" data-dep-solo-stock="' + esc(c.slug) + '" title="Muestra solo los que tienen stock y oculta el resto">Solo con stock</button>' +
        '</div></div>';
    }).join('');
  }
  async function updateCategoria(slug, patch, okMsg) {
    var r = await db.from('gasomi_categorias').update(patch).eq('slug', slug).select();
    if (r.error || !r.data || !r.data.length) { toast('No se pudo guardar: ' + (r.error ? r.error.message : 'sin permisos'), true); return false; }
    var i = state.categorias.findIndex(function (c) { return c.slug === slug; });
    if (i > -1) state.categorias[i] = r.data[0];
    toast(okMsg || 'Guardado ✓');
    return true;
  }
  async function masivoActivo(ids, activo, msg) {
    if (!ids.length) { toast('No hay productos en ese filtro', true); return; }
    if (!confirm((activo ? 'Mostrar' : 'Ocultar') + ' ' + ids.length + ' productos en la tienda?')) return;
    for (var k = 0; k < ids.length; k += 100) {
      var r = await db.from('gasomi_productos').update({ activo: activo }).in('id', ids.slice(k, k + 100));
      if (r.error) { toast('Error: ' + r.error.message, true); return; }
    }
    state.productos.forEach(function (p) { if (ids.indexOf(p.id) > -1) p.activo = activo; });
    toast(msg || ('Listo: ' + ids.length + ' productos ' + (activo ? 'visibles' : 'ocultos')));
    renderChips(); renderProductos(); renderDeptos(); renderMiDia();
  }

  /* ================= Configuración de pagos/envío ================= */
  function renderConfig() {
    if (!esAdmin() || !$('cf-yape-on')) return;
    var pg = state.config.pagos || {}, ev = state.config.envio || {};
    var y = pg.yape || {}, pl = pg.plin || {}, tr = pg.transferencia || {}, tj = pg.tarjeta || {}, ce = pg.contra_entrega || {};
    $('cf-yape-on').checked = y.activo !== false; $('cf-yape-num').value = y.numero || ''; $('cf-yape-tit').value = y.titular || '';
    $('cf-yape-prev').innerHTML = y.qr ? '<img src="' + esc(y.qr) + '" alt="QR Yape">' : '';
    $('cf-plin-on').checked = pl.activo !== false; $('cf-plin-num').value = pl.numero || ''; $('cf-plin-tit').value = pl.titular || '';
    $('cf-plin-prev').innerHTML = pl.qr ? '<img src="' + esc(pl.qr) + '" alt="QR Plin">' : '';
    $('cf-tr-on').checked = tr.activo !== false; $('cf-tr-banco').value = tr.banco || ''; $('cf-tr-cuenta').value = tr.cuenta || ''; $('cf-tr-cci').value = tr.cci || ''; $('cf-tr-tit').value = tr.titular || '';
    $('cf-tj-on').checked = !!tj.activo; $('cf-tj-pk').value = tj.public_key || ''; $('cf-yo-on').checked = !!(pg.yape_online && pg.yape_online.activo); $('cf-demo').checked = !!pg.demo;
    $('cf-ce-on').checked = ce.activo !== false; $('cf-ce-nota').value = ce.nota || ''; $('cf-wa').value = pg.whatsapp || '';
    var rc = ev.recojo || {}, ob = ev.obra || {};
    $('cf-rec-dir').value = rc.direccion || ''; $('cf-rec-hor').value = rc.horario || ''; $('cf-obra-nota').value = ob.nota || ''; $('cf-gratis').value = ev.gratis_desde || '';
  }
  async function subirQR(file, nombre) {
    var path = 'config/qr-' + nombre + '-' + Date.now() + '.jpg';
    var up = await db.storage.from('gasomi-fotos').upload(path, file, { contentType: file.type || 'image/jpeg', upsert: true });
    if (up.error) { toast('No se pudo subir el QR', true); return null; }
    return db.storage.from('gasomi-fotos').getPublicUrl(path).data.publicUrl;
  }
  async function guardarConfig() {
    var pg = state.config.pagos || {}, ev = state.config.envio || {};
    var y = Object.assign({}, pg.yape || {}), pl = Object.assign({}, pg.plin || {});
    if ($('cf-yape-qr').files[0]) { var u1 = await subirQR($('cf-yape-qr').files[0], 'yape'); if (u1) y.qr = u1; }
    if ($('cf-plin-qr').files[0]) { var u2 = await subirQR($('cf-plin-qr').files[0], 'plin'); if (u2) pl.qr = u2; }
    var nuevoPg = {
      yape: Object.assign(y, { activo: $('cf-yape-on').checked, numero: $('cf-yape-num').value.trim(), titular: $('cf-yape-tit').value.trim() }),
      plin: Object.assign(pl, { activo: $('cf-plin-on').checked, numero: $('cf-plin-num').value.trim(), titular: $('cf-plin-tit').value.trim() }),
      transferencia: { activo: $('cf-tr-on').checked, banco: $('cf-tr-banco').value.trim(), cuenta: $('cf-tr-cuenta').value.trim(), cci: $('cf-tr-cci').value.trim(), titular: $('cf-tr-tit').value.trim() },
      tarjeta: Object.assign({}, pg.tarjeta || {}, { activo: $('cf-tj-on').checked, proveedor: 'culqi', public_key: $('cf-tj-pk').value.trim() }),
      yape_online: { activo: $('cf-yo-on').checked },
      demo: $('cf-demo').checked,
      contra_entrega: { activo: $('cf-ce-on').checked, nota: $('cf-ce-nota').value.trim() },
      whatsapp: $('cf-wa').value.replace(/\D/g, '') || '51958682246'
    };
    var nuevoEv = {
      recojo: { activo: true, direccion: $('cf-rec-dir').value.trim(), horario: $('cf-rec-hor').value.trim() },
      obra: { activo: true, nota: $('cf-obra-nota').value.trim() },
      gratis_desde: parseFloat($('cf-gratis').value) || 0
    };
    var r1 = await db.from('gasomi_config').upsert({ clave: 'pagos', valor: nuevoPg, updated_at: new Date().toISOString() });
    var r2 = await db.from('gasomi_config').upsert({ clave: 'envio', valor: nuevoEv, updated_at: new Date().toISOString() });
    if (r1.error || r2.error) { toast('No se pudo guardar: ' + ((r1.error || r2.error).message), true); return; }
    state.config.pagos = nuevoPg; state.config.envio = nuevoEv;
    $('cf-yape-qr').value = ''; $('cf-plin-qr').value = '';
    renderConfig();
    toast('Configuración guardada ✓ — la tienda ya la usa');
  }

  /* ================= Historial + Equipo ================= */
  function renderHistorial() {
    if (!esAdmin()) { $('hist-tbody').innerHTML = ''; return; }
    $('hist-tbody').innerHTML = state.historial.map(function (h) {
      var nom = h.gasomi_productos ? h.gasomi_productos.nombre : h.producto_id;
      return '<tr><td>' + fecha(h.created_at) + '</td><td>' + esc(nom) + '</td><td><span class="tag-tipo' + (h.tipo === 'mayor' ? ' mayor' : '') + '">' + (h.tipo === 'mayor' ? 'por mayor' : 'unidad') + '</span></td><td>' + fmt(h.precio_anterior) + '</td><td><b>' + fmt(h.precio_nuevo) + '</b></td><td>' + esc(h.cambiado_por || '—') + '</td></tr>';
    }).join('') || '<tr><td colspan="6" style="color:var(--muted)">Sin cambios registrados.</td></tr>';
  }

  var equipo = [];
  async function renderEquipo() {
    if (!esAdmin() || !$('eq-tbody')) return;
    var r = await db.from('gasomi_crm_usuarios').select('*').order('created_at');
    equipo = r.data || [];
    $('eq-tbody').innerHTML = equipo.map(function (u) {
      var esYo = state.usuario && u.email === state.usuario.email;
      return '<tr><td>' + esc(u.nombre || '—') + (esYo ? ' <span class="pl-sub">(tú)</span>' : '') + '</td><td>' + esc(u.email) + '</td>' +
        '<td><span class="rol-badge' + (u.rol === 'admin' ? ' admin' : '') + '">' + esc(u.rol) + '</span></td>' +
        '<td>' + (esYo ? '<span class="cat-tag">activo</span>' : '<button class="switch' + (u.activo ? ' on' : '') + '" data-eq-activo="' + esc(u.email) + '"></button>') + '</td>' +
        '<td><span class="cat-tag">' + fecha(u.created_at) + '</span></td></tr>';
    }).join('');
  }

  /* ================= Acciones globales ================= */
  async function updateProducto(id, patch, okMsg) {
    var r = await db.from('gasomi_productos').update(patch).eq('id', id).select();
    if (r.error || !r.data || !r.data.length) { toast('No se pudo guardar: ' + (r.error ? r.error.message : 'sin permisos'), true); return false; }
    var i = state.productos.findIndex(function (p) { return p.id === id; });
    if (i > -1) state.productos[i] = r.data[0];
    toast(okMsg || 'Guardado ✓');
    return true;
  }

  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.dataset && (t.dataset.precio || t.dataset.stock)) t.closest('.precio-edit').classList.add('dirty');
    if (t.id === 'prod-buscar') { state.q = t.value; renderProductos(); }
    if (t.id === 'v-buscar') { state.venta.q = t.value; pintarResultados(); }
    if (t.id === 'cli-buscar') { state.cliQ = t.value; renderClientes(); }
    if (t.id === 'e-precio' || t.id === 'e-costo') pintarMargen();
    if (t.dataset && t.dataset.escDesde != null) escalasUI[parseInt(t.dataset.escDesde, 10)].desde = t.value;
    if (t.dataset && t.dataset.escPrecio != null) escalasUI[parseInt(t.dataset.escPrecio, 10)].precio = t.value;
  });

  document.addEventListener('click', async function (e) {
    var t = e.target.closest('[data-cat],[data-save],[data-save-stock],[data-activo],[data-edit],[data-puntos],[data-pedf],[data-atender],[data-tarea-ok],[data-v-add],[data-v-inc],[data-v-dec],[data-v-del],[data-cli-ver],[data-cli-venta],[data-cli-repetir],[data-cli-tarea],[data-eq-activo],[data-nota],[data-comp],[data-clif],[data-cli-guardar],#cf-guardar,[data-est],[data-dep-activa],[data-dep-ver],[data-dep-editar],[data-dep-mostrar],[data-dep-ocultar],[data-dep-solo-stock],[data-esc-del],#dep-add,#e-esc-add,#e-esc-sugerir,#prod-act-todos,#prod-des-todos,#prod-nuevo,#tarea-btn,#v-registrar,#v-repetir,#eq-add,.cli-row');
    if (!t) return;
    var d = t.dataset || {};
    if (d.cat) { state.cat = d.cat; renderChips(); renderProductos(); return; }
    if (d.est) { state.estadoF = d.est; renderChips(); renderProductos(); return; }
    if (t.id === 'prod-act-todos') { await masivoActivo(state.visiblesIds || [], true); return; }
    if (t.id === 'prod-des-todos') { await masivoActivo(state.visiblesIds || [], false); return; }
    if (d.depActiva) {
      var cA = state.categorias.find(function (x) { return x.slug === d.depActiva; });
      if (await updateCategoria(cA.slug, { activa: cA.activa === false }, cA.activa === false ? 'Departamento visible en la tienda ✓' : 'Departamento oculto en la tienda')) renderDeptos();
      return;
    }
    if (d.depVer) { state.cat = d.depVer; state.estadoF = 'todos'; irA('productos'); renderChips(); renderProductos(); return; }
    if (d.depMostrar) { await masivoActivo(state.productos.filter(function (p) { return p.categoria === d.depMostrar; }).map(function (p) { return p.id; }), true); return; }
    if (d.depOcultar) { await masivoActivo(state.productos.filter(function (p) { return p.categoria === d.depOcultar; }).map(function (p) { return p.id; }), false); return; }
    if (d.depSoloStock) {
      var con = state.productos.filter(function (p) { return p.categoria === d.depSoloStock && p.stock > 0; }).map(function (p) { return p.id; });
      var sin = state.productos.filter(function (p) { return p.categoria === d.depSoloStock && p.stock <= 0; }).map(function (p) { return p.id; });
      if (!confirm('Mostrar ' + con.length + ' con stock y ocultar ' + sin.length + ' sin stock?')) return;
      for (var k1 = 0; k1 < con.length; k1 += 100) await db.from('gasomi_productos').update({ activo: true }).in('id', con.slice(k1, k1 + 100));
      for (var k2 = 0; k2 < sin.length; k2 += 100) await db.from('gasomi_productos').update({ activo: false }).in('id', sin.slice(k2, k2 + 100));
      state.productos.forEach(function (p) { if (p.categoria === d.depSoloStock) p.activo = p.stock > 0; });
      toast('Listo ✓'); renderChips(); renderProductos(); renderDeptos(); renderMiDia();
      return;
    }
    if (d.depEditar) {
      var cE = state.categorias.find(function (x) { return x.slug === d.depEditar; });
      var nn = prompt('Nombre del departamento:', cE.nombre); if (nn == null) return;
      var nd = prompt('Descripción corta:', cE.descripcion); if (nd == null) return;
      var ni = prompt('Foto (URL o ruta img/…, vacío = automática):', cE.imagen || ''); if (ni == null) return;
      if (await updateCategoria(cE.slug, { nombre: nn.trim() || cE.nombre, descripcion: nd.trim(), imagen: ni.trim() }, 'Departamento actualizado ✓')) { renderDeptos(); renderChips(); }
      return;
    }
    if (t.id === 'dep-add') {
      var nom = $('dep-nombre').value.trim();
      if (!nom) { toast('Ponle nombre', true); return; }
      var slugN = slugify(nom);
      var rD = await db.from('gasomi_categorias').insert({ slug: slugN, nombre: nom, descripcion: $('dep-desc').value.trim(), orden: state.categorias.length + 1 }).select();
      if (rD.error) { toast(rD.error.message.indexOf('duplicate') > -1 ? 'Ya existe un departamento así' : 'No se pudo crear', true); return; }
      state.categorias.push(rD.data[0]);
      $('dep-nombre').value = ''; $('dep-desc').value = '';
      toast('Departamento creado ✓ — ya puedes asignarle productos'); renderDeptos(); renderChips();
      return;
    }
    if (t.id === 'e-esc-add') { escalasUI.push({ desde: '', precio: '' }); pintarEscalas(); return; }
    if (t.id === 'e-esc-sugerir') { escalasUI = sugerirEscalas($('e-precio').value); pintarEscalas(); if (!escalasUI.length) toast('Pon primero el precio unitario', true); return; }
    if (d.escDel != null) { escalasUI.splice(parseInt(d.escDel, 10), 1); pintarEscalas(); return; }
    if (d.pedf) { state.pedFiltro = d.pedf; renderPedChips(); renderPedidos(); return; }
    if (d.save) {
      var input = document.querySelector('input[data-precio="' + d.save + '"]');
      var val = parseFloat(input.value);
      if (isNaN(val) || val < 0) { toast('Precio inválido', true); return; }
      if (await updateProducto(d.save, { precio: val }, 'Precio actualizado ✓ (la tienda ya lo muestra)')) {
        input.closest('.precio-edit').classList.remove('dirty');
        renderMiDia(); await refrescarHistorial();
      }
      return;
    }
    if (d.saveStock) {
      var inputS = document.querySelector('input[data-stock="' + d.saveStock + '"]');
      var valS = parseInt(inputS.value, 10);
      if (isNaN(valS) || valS < 0) { toast('Stock inválido', true); return; }
      if (await updateProducto(d.saveStock, { stock: valS }, 'Stock actualizado ✓')) {
        inputS.closest('.precio-edit').classList.remove('dirty');
        renderMiDia(); renderProductos();
      }
      return;
    }
    if (d.activo) {
      var p = prodDe(d.activo);
      if (await updateProducto(p.id, { activo: !p.activo }, p.activo ? 'Producto oculto en la tienda' : 'Producto visible en la tienda')) {
        t.classList.toggle('on'); renderMiDia();
      }
      return;
    }
    if (d.edit) { abrirModal(d.edit); return; }
    if (d.puntos) { await ajustarPuntos(d.puntos); return; }
    if (d.atender) {
      var rA = await db.from('gasomi_pedidos').update({ estado: 'atendido' }).eq('id', parseInt(d.atender, 10)).select();
      if (rA.error || !rA.data.length) { toast('No se pudo atender', true); return; }
      toast('Pedido #' + d.atender + ' atendido ✓');
      await cargarTodo(); render();
      return;
    }
    if (d.tareaOk) {
      await db.from('gasomi_tareas').update({ hecho: true }).eq('id', parseInt(d.tareaOk, 10));
      state.tareas = state.tareas.filter(function (x) { return x.id !== parseInt(d.tareaOk, 10); });
      renderMiDia();
      return;
    }
    if (t.id === 'tarea-btn') {
      var texto = $('tarea-texto').value.trim();
      if (!texto) return;
      var rT = await db.from('gasomi_tareas').insert({ texto: texto, vendedor_email: state.usuario.email }).select();
      if (rT.data && rT.data.length) { state.tareas.push(rT.data[0]); $('tarea-texto').value = ''; renderMiDia(); toast('Tarea agregada ✓'); }
      return;
    }
    if (d.vAdd) { ventaAdd(d.vAdd, 1); return; }
    if (d.vInc) { ventaAdd(d.vInc, 1); return; }
    if (d.vDec) { ventaAdd(d.vDec, -1); return; }
    if (d.vDel) { state.venta.items = state.venta.items.filter(function (x) { return x.id !== d.vDel; }); pintarTicket(); return; }
    if (t.id === 'v-registrar') { await registrarVenta(); return; }
    if (t.id === 'v-repetir' || d.cliRepetir) {
      var uidR = d.cliRepetir || state.venta.cliente;
      var up = ultimoPedidoDe(uidR);
      if (up) {
        state.venta.cliente = uidR;
        state.venta.items = (up.items || []).map(function (i) {
          var p = prodDe(i.id);
          return p ? { id: i.id, qty: Math.min(i.qty, Math.max(1, p.stock)) } : null;
        }).filter(Boolean);
        $('cli-bg').style.display = 'none';
        irA('venta');
        toast('Último pedido cargado al ticket ✓');
      }
      return;
    }
    if (d.cliVenta) { state.venta.cliente = d.cliVenta; $('cli-bg').style.display = 'none'; irA('venta'); return; }
    if (d.cliTarea) {
      var txt = prompt('Tarea o seguimiento para ' + nombreCliente(d.cliTarea) + ':', 'Hacer seguimiento a la cotización');
      if (!txt) return;
      var rCT = await db.from('gasomi_tareas').insert({ texto: txt, cliente_id: d.cliTarea, vendedor_email: state.usuario.email }).select();
      if (rCT.data && rCT.data.length) { state.tareas.push(rCT.data[0]); renderMiDia(); toast('Tarea agregada ✓'); }
      return;
    }
    if (d.comp) {
      e.preventDefault();
      var su = await db.storage.from('gasomi-comprobantes').createSignedUrl(d.comp, 300);
      if (su.data && su.data.signedUrl) window.open(su.data.signedUrl, '_blank'); else toast('No se pudo abrir el comprobante', true);
      return;
    }
    if (d.nota) {
      var pn = state.pedidos.find(function (x) { return x.id === parseInt(d.nota, 10); });
      if (pn) notaVenta(pn);
      return;
    }
    if (d.cliVer) { abrirCliente(d.cliVer); return; }
    if (d.clif) { state.cliF = d.clif; renderClientes(); return; }
    if (d.cliGuardar) {
      var patchC = { nombre: $('ce-nombre').value.trim(), telefono: $('ce-telefono').value.trim(), empresa: $('ce-empresa').value.trim(), ruc: $('ce-ruc').value.trim(), direccion: $('ce-direccion').value.trim(), etiqueta: $('ce-etiqueta').value, notas: $('ce-notas').value.trim() };
      var rC = await db.from('gasomi_clientes').update(patchC).eq('user_id', d.cliGuardar).select();
      if (rC.error || !rC.data.length) { toast('No se pudo guardar', true); return; }
      var iC = state.clientes.findIndex(function (x) { return x.user_id === d.cliGuardar; });
      if (iC > -1) state.clientes[iC] = rC.data[0];
      toast('Cliente actualizado ✓'); renderClientes(); $('cli-bg').style.display = 'none';
      return;
    }
    if (t.classList && t.classList.contains('cli-row') && !e.target.closest('button')) { abrirCliente(t.dataset.cli); return; }
    if (d.eqActivo) {
      var u = equipo.find(function (x) { return x.email === d.eqActivo; });
      var rU = await db.from('gasomi_crm_usuarios').update({ activo: !u.activo }).eq('email', u.email).select();
      if (rU.error || !rU.data.length) { toast('No se pudo actualizar', true); return; }
      toast(u.email + (u.activo ? ' desactivado' : ' activado'));
      renderEquipo();
      return;
    }
    if (t.id === 'prod-nuevo') { abrirModal(null); return; }
    if (t.id === 'cf-guardar') { await guardarConfig(); return; }
    if (t.id === 'eq-add') {
      var em = $('eq-email').value.trim().toLowerCase();
      if (!em || em.indexOf('@') < 1) { toast('Correo inválido', true); return; }
      var rE = await db.from('gasomi_crm_usuarios').insert({ email: em, nombre: $('eq-nombre').value.trim(), rol: $('eq-rol').value }).select();
      if (rE.error) { toast(rE.error.message.indexOf('duplicate') > -1 ? 'Ese correo ya está en el equipo' : 'No se pudo agregar', true); return; }
      $('eq-email').value = ''; $('eq-nombre').value = '';
      toast(em + ' agregado al equipo ✓ — dile que cree su cuenta desde la pantalla de ingreso');
      renderEquipo();
      return;
    }
  });

  document.addEventListener('change', async function (e) {
    var t = e.target;
    if (t.id === 'e-categoria') { pintarSubcatsList(); return; }
    if (t.id === 'v-cliente') { state.venta.cliente = t.value; pintarVenta(); return; }
    if (t.id === 'v-pago') { pintarTicket(); return; }
    if (t.dataset && t.dataset.estado) {
      var id = parseInt(t.dataset.estado, 10);
      var r = await db.from('gasomi_pedidos').update({ estado: t.value }).eq('id', id).select();
      if (r.error || !r.data.length) { toast('No se pudo actualizar el pedido', true); return; }
      await cargarTodo(); render();
      var msgs = { atendido: 'Pedido #' + id + ' atendido — stock y puntos aplicados', anulado: 'Pedido #' + id + ' anulado — stock devuelto', nuevo: 'Pedido #' + id + ' → nuevo' };
      toast(msgs[t.value] || 'Pedido actualizado');
      return;
    }
    if (t.dataset && t.dataset.pago) {
      var idP = parseInt(t.dataset.pago, 10);
      var ped = state.pedidos.find(function (p) { return p.id === idP; });
      var patch = { pago_estado: t.value };
      if (t.value === 'pagado') { patch.monto_pagado = num(ped.total); if (!ped.pago_metodo) patch.pago_metodo = 'efectivo'; }
      if (t.value === 'pendiente') patch.monto_pagado = 0;
      if (t.value === 'parcial') {
        var m = parseFloat(prompt('¿Cuánto pagó hasta ahora? (total ' + fmt(ped.total) + ')', ped.monto_pagado || '') || '');
        if (isNaN(m) || m <= 0 || m >= num(ped.total)) { toast('Monto inválido para pago parcial', true); renderPedidos(); return; }
        patch.monto_pagado = m;
      }
      var rP = await db.from('gasomi_pedidos').update(patch).eq('id', idP).select();
      if (rP.error || !rP.data.length) { toast('No se pudo actualizar el pago', true); return; }
      var iP = state.pedidos.findIndex(function (p) { return p.id === idP; });
      if (iP > -1) state.pedidos[iP] = rP.data[0];
      renderPedidos(); renderMiDia();
      toast('Pago del pedido #' + idP + ' actualizado ✓');
      return;
    }
  });

  async function ajustarPuntos(uid) {
    var c = clienteDe(uid);
    if (!c) return;
    var deltaStr = prompt('Ajustar puntos de ' + (c.nombre || c.email) + ' (tiene ' + c.puntos + ' pts).\nPositivo abona, negativo canjea. Ej: -120');
    if (deltaStr == null) return;
    var delta = parseInt(deltaStr, 10);
    if (isNaN(delta) || delta === 0) { toast('Cantidad inválida', true); return; }
    var motivo = prompt('Motivo:', delta < 0 ? 'Canje en pedido' : 'Bono') || (delta < 0 ? 'Canje' : 'Bono');
    var nuevos = Math.max(0, c.puntos + delta);
    var r = await db.from('gasomi_clientes').update({ puntos: nuevos }).eq('user_id', uid).select();
    if (r.error || !r.data.length) { toast('No se pudo ajustar', true); return; }
    await db.from('gasomi_puntos_movs').insert({ cliente_id: uid, delta: delta, motivo: motivo + ' (manual)' });
    c.puntos = nuevos;
    renderClientes(); $('cli-bg').style.display = 'none';
    toast('Puntos de ' + (c.nombre || c.email) + ': ' + nuevos + ' pts');
  }

  function notaVenta(p) {
    var c = clienteDe(p.cliente_id);
    var filas = (p.items || []).map(function (i) {
      return '<tr><td>' + i.qty + '</td><td>' + esc(i.nombre) + (i.mayor ? ' <small>(por mayor)</small>' : '') + '</td>' +
        '<td class="der">' + fmt(i.precio) + '</td><td class="der">' + fmt(i.subtotal) + '</td></tr>';
    }).join('');
    var base = num(p.total) / 1.18;
    var igv = num(p.total) - base;
    var deuda = deudaDe(p);
    var html = '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Nota de venta NV-' + String(p.id).padStart(6, '0') + '</title>' +
      '<style>body{font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#1a2332;max-width:640px;margin:24px auto;padding:0 20px}' +
      '.cab{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #000a1e;padding-bottom:14px;margin-bottom:14px}' +
      'h1{font-size:16px;margin:0;color:#000a1e}.emp{font-size:11px;color:#5a6577;line-height:1.5}' +
      '.doc{text-align:right}.doc b{display:block;font-size:14px;color:#000a1e;border:2px solid #000a1e;border-radius:8px;padding:6px 14px}' +
      '.doc span{font-size:10px;color:#5a6577}table{width:100%;border-collapse:collapse;margin:12px 0;font-size:12px}' +
      'th{background:#f1f4f6;text-align:left;padding:7px 8px;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#5a6577}' +
      'td{padding:7px 8px;border-bottom:1px solid #eef2f5}.der{text-align:right}' +
      '.tot{margin-left:auto;width:230px;font-size:12px}.tot div{display:flex;justify-content:space-between;padding:3px 0}' +
      '.tot .g{font-size:15px;font-weight:800;color:#000a1e;border-top:2px solid #000a1e;padding-top:6px;margin-top:4px}' +
      '.meta{font-size:11px;color:#5a6577;margin:8px 0}.deuda{color:#a34700;font-weight:700}' +
      '.pie{margin-top:22px;border-top:1px dashed #cdd6de;padding-top:10px;font-size:9.5px;color:#8a94a3;text-align:center}' +
      '@media print{.noprint{display:none}}' +
      '.noprint{position:fixed;top:12px;right:12px}.noprint button{background:#00696b;color:#fff;border:none;border-radius:8px;padding:10px 18px;font-weight:700;cursor:pointer}</style></head><body>' +
      '<div class="noprint"><button onclick="window.print()">Imprimir / PDF</button></div>' +
      '<div class="cab"><div><h1>GASOMI INGENIEROS E.I.R.L.</h1>' +
      '<div class="emp">RUC 20600097726<br>Jr. Puyllucana N° 391, Baños del Inca, Cajamarca<br>WhatsApp +51 958 682 246</div></div>' +
      '<div class="doc"><b>NOTA DE VENTA<br>NV-' + String(p.id).padStart(6, '0') + '</b><span>' + fecha(p.created_at) + '</span></div></div>' +
      '<div class="meta"><b>Cliente:</b> ' + esc(c ? ((c.nombre || c.email) + (c.empresa ? ' · ' + c.empresa : '')) : 'Venta de mostrador') +
      (c && c.telefono ? ' · ' + esc(c.telefono) : '') + '<br>' +
      '<b>Origen:</b> ' + (p.origen === 'mostrador' ? 'Mostrador' : 'Tienda online') +
      (p.vendedor_email ? ' · <b>Vendedor:</b> ' + esc(p.vendedor_email) : '') + '</div>' +
      '<table><thead><tr><th>Cant.</th><th>Producto</th><th class="der">P. unit.</th><th class="der">Importe</th></tr></thead><tbody>' + filas + '</tbody></table>' +
      '<div class="tot"><div><span>Op. gravada</span><span>' + fmt(base) + '</span></div>' +
      '<div><span>IGV (18%)</span><span>' + fmt(igv) + '</span></div>' +
      '<div class="g"><span>TOTAL</span><span>' + fmt(p.total) + '</span></div>' +
      '<div><span>Pago</span><span>' + esc(p.pago_estado) + (p.pago_metodo ? ' · ' + esc(p.pago_metodo) : '') + '</span></div>' +
      (deuda > 0 ? '<div class="deuda"><span>Saldo pendiente</span><span>' + fmt(deuda) + '</span></div>' : '') +
      (p.nota ? '<div><span>Nota</span><span>' + esc(p.nota) + '</span></div>' : '') + '</div>' +
      '<div class="pie">Documento interno de control de ventas. No constituye comprobante de pago fiscal (SUNAT).<br>Precios incluyen IGV. ¡Gracias por su compra!</div>' +
      '</body></html>';
    var w = window.open('', '_blank');
    if (!w) { toast('Permite ventanas emergentes para ver la nota', true); return; }
    w.document.write(html);
    w.document.close();
  }

  async function refrescarHistorial() {
    if (!esAdmin()) return;
    var rh = await db.from('gasomi_precios_historial').select('*, gasomi_productos(nombre)').order('created_at', { ascending: false }).limit(200);
    state.historial = rh.data || [];
    renderHistorial();
  }

  /* ================= Ficha de producto (modal admin) ================= */
  function pintarMargen() {
    var pr = parseFloat($('e-precio').value || 0);
    var co = parseFloat($('e-costo').value || 0);
    var el = $('e-margen');
    if (pr > 0 && co > 0) {
      var m = ((pr - co) / pr) * 100;
      el.textContent = 'Margen: ' + fmt(pr - co) + ' por unidad (' + m.toFixed(1) + '%)';
      el.style.color = m < 15 ? 'var(--accent-warm)' : 'var(--ok)';
    } else {
      el.textContent = 'Registra el costo para ver tu margen (solo lo ve el administrador).';
      el.style.color = 'var(--muted)';
    }
  }
  var escalasUI = [];
  function pintarEscalas() {
    var el = $('e-escalas');
    if (!el) return;
    el.innerHTML = escalasUI.map(function (t, i) {
      return '<div class="esc-row"><span>Desde</span><input type="number" min="2" step="1" value="' + esc(t.desde) + '" data-esc-desde="' + i + '" placeholder="12">' +
        '<span>unidades →</span><input type="number" min="0" step="0.01" value="' + esc(t.precio) + '" data-esc-precio="' + i + '" placeholder="precio c/u">' +
        '<button class="d-x" data-esc-del="' + i + '" title="Quitar tramo">✕</button></div>';
    }).join('') || '<div class="pl-sub">Sin precio por mayor. Usa ✨ Sugerir o + Tramo.</div>';
  }
  function leerEscalas() {
    return escalasUI.map(function (t) { return { desde: parseInt(t.desde, 10), precio: Math.round(num(t.precio) * 100) / 100 }; })
      .filter(function (t) { return t.desde > 1 && t.precio > 0; })
      .sort(function (a, b) { return a.desde - b.desde; });
  }
  function pintarSubcatsList() {
    var dl = $('subcats-list');
    if (!dl) return;
    var cat = $('e-categoria').value;
    var set = {};
    state.productos.forEach(function (p) { if (p.categoria === cat && p.subcategoria) set[p.subcategoria] = 1; });
    dl.innerHTML = Object.keys(set).sort().map(function (k) { return '<option value="' + esc(k) + '">'; }).join('');
  }
  function pintarFotoPreview(url) {
    var pv = $('e-foto-preview');
    if (!pv) return;
    pv.innerHTML = url ? '<img src="' + esc(url.indexOf('http') === 0 ? url : '../tienda/' + url) + '" alt="">' : '<span>Sin foto</span>';
  }
  function abrirModal(id) {
    if (id == null) {
      state.editId = null;
      $('edit-title').textContent = 'Nuevo producto';
      $('e-nombre').value = '';
      $('e-marca').value = '';
      $('e-categoria').innerHTML = state.categorias.map(function (c) {
        return '<option value="' + esc(c.slug) + '">' + esc(c.nombre) + '</option>';
      }).join('');
      $('e-subcategoria').value = '';
      pintarSubcatsList();
      $('e-precio').value = '';
      $('e-costo').value = '';
      escalasUI = []; pintarEscalas();
      $('e-stock').value = '10';
      $('e-unidad').value = 'unidad';
      $('e-norma').value = '';
      $('e-descripcion').value = '';
      $('e-imagen').value = '';
      $('e-activo').checked = true;
      pintarFotoPreview('');
      pintarMargen();
      $('edit-bg').style.display = 'flex';
      return;
    }
    var p = prodDe(id);
    if (!p) return;
    state.editId = id;
    $('edit-title').textContent = p.nombre;
    $('e-nombre').value = p.nombre;
    $('e-marca').value = p.marca;
    $('e-categoria').innerHTML = state.categorias.map(function (c) {
      return '<option value="' + esc(c.slug) + '"' + (c.slug === p.categoria ? ' selected' : '') + '>' + esc(c.nombre) + '</option>';
    }).join('');
    $('e-subcategoria').value = p.subcategoria || '';
    pintarSubcatsList();
    $('e-precio').value = num(p.precio).toFixed(2);
    $('e-costo').value = (state.costos[p.id] || 0).toFixed(2);
    escalasUI = escalasDe(p).map(function (t) { return { desde: t.desde, precio: t.precio }; });
    pintarEscalas();
    $('e-stock').value = p.stock;
    $('e-unidad').value = p.unidad;
    $('e-norma').value = p.norma;
    $('e-descripcion').value = p.descripcion;
    $('e-imagen').value = p.imagen;
    $('e-activo').checked = !!p.activo;
    pintarFotoPreview(p.imagen);
    pintarMargen();
    $('edit-bg').style.display = 'flex';
  }
  function cerrarModal() { $('edit-bg').style.display = 'none'; state.editId = null; }
  $('edit-close').addEventListener('click', cerrarModal);
  $('edit-cancel').addEventListener('click', cerrarModal);
  $('edit-bg').addEventListener('click', function (e) { if (e.target === $('edit-bg')) cerrarModal(); });
  $('edit-save').addEventListener('click', async function () {
    var val = parseFloat($('e-precio').value);
    if (isNaN(val) || val < 0) { toast('Precio inválido', true); return; }
    var esNuevo = state.editId == null;
    var escV = leerEscalas();
    for (var ei = 0; ei < escV.length; ei++) {
      if (escV[ei].precio >= val) { toast('El precio por mayor desde ' + escV[ei].desde + ' debe ser menor al precio unitario', true); return; }
      if (ei > 0 && escV[ei].precio >= escV[ei - 1].precio) { toast('A más cantidad, el precio debe bajar (revisa el tramo desde ' + escV[ei].desde + ')', true); return; }
    }
    var patch = {
      nombre: $('e-nombre').value.trim(),
      marca: $('e-marca').value.trim(),
      categoria: $('e-categoria').value,
      subcategoria: $('e-subcategoria').value.trim(),
      precio: val,
      escalas: leerEscalas(),
      stock: Math.max(0, parseInt($('e-stock').value, 10) || 0),
      unidad: $('e-unidad').value.trim(),
      norma: $('e-norma').value.trim(),
      descripcion: $('e-descripcion').value.trim(),
      imagen: $('e-imagen').value.trim(),
      activo: $('e-activo').checked
    };
    if (esNuevo) {
      if (!patch.nombre) { toast('Ponle nombre al producto', true); return; }
      var nid = slugify(patch.nombre);
      while (prodDe(nid)) nid += '-2';
      patch.id = nid;
      patch.orden = state.productos.reduce(function (a, p) { return Math.max(a, p.orden || 0); }, 0) + 1;
      var rN = await db.from('gasomi_productos').insert(patch).select();
      if (rN.error || !rN.data.length) { toast('No se pudo crear: ' + (rN.error ? rN.error.message : ''), true); return; }
      state.productos.push(rN.data[0]);
      var costoN = parseFloat($('e-costo').value) || 0;
      if (costoN > 0) { await db.from('gasomi_costos').upsert({ producto_id: nid, costo: costoN }); state.costos[nid] = costoN; }
      toast(patch.activo ? '¡Producto creado y ya visible en la tienda! ✓' : 'Producto creado (oculto) ✓');
      cerrarModal(); renderProductos(); renderMiDia(); pintarVenta();
      return;
    }
    if (await updateProducto(state.editId, patch, 'Producto actualizado ✓')) {
      var costo = parseFloat($('e-costo').value) || 0;
      await db.from('gasomi_costos').upsert({ producto_id: state.editId, costo: costo });
      state.costos[state.editId] = costo;
      cerrarModal(); renderProductos(); renderMiDia(); await refrescarHistorial();
    }
  });

  // ---- Subida de foto (optimizada en el navegador) ----
  $('e-foto').addEventListener('change', async function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var st = $('e-foto-status');
    st.textContent = 'Optimizando foto…';
    try {
      var img = await new Promise(function (res, rej) {
        var u = URL.createObjectURL(file);
        var im = new Image();
        im.onload = function () { res(im); };
        im.onerror = rej;
        im.src = u;
      });
      var MAX = 1000;
      var esc2 = Math.min(1, MAX / Math.max(img.width, img.height));
      var cv = document.createElement('canvas');
      cv.width = Math.round(img.width * esc2);
      cv.height = Math.round(img.height * esc2);
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      var blob = await new Promise(function (res) { cv.toBlob(res, 'image/jpeg', 0.85); });
      st.textContent = 'Subiendo (' + Math.round(blob.size / 1024) + ' KB)…';
      var base = state.editId || slugify($('e-nombre').value || 'producto');
      var path = 'productos/' + base + '-' + Date.now() + '.jpg';
      var up = await db.storage.from('gasomi-fotos').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
      if (up.error) { st.textContent = 'Error al subir: ' + up.error.message; toast('No se pudo subir la foto', true); return; }
      var pub = db.storage.from('gasomi-fotos').getPublicUrl(path);
      $('e-imagen').value = pub.data.publicUrl;
      pintarFotoPreview(pub.data.publicUrl);
      st.textContent = 'Foto lista ✓ — guarda los cambios para publicarla.';
      toast('Foto subida ✓');
    } catch (err) {
      st.textContent = 'No se pudo procesar la imagen.';
      toast('Error con la foto', true);
    }
  });

  boot();
})();
