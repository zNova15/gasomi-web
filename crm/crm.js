/* CRM Tienda EPP — Gasomi Ingenieros. Supabase (tablas gasomi_*, RLS por allowlist de admins).
   Inventario automático: los pedidos descuentan stock, anular lo devuelve, atender otorga puntos. */
(function () {
  'use strict';

  var SB_URL = 'https://lggxsejjbhkymazgalzm.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnZ3hzZWpqYmhreW1hemdhbHptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MDAwMDAsImV4cCI6MjA5ODk3NjAwMH0.X3yg0OewAb1QoBk4HdeALWR33cv9WVJZIbzNKzUWCT4';
  var db = window.supabase.createClient(SB_URL, SB_KEY);

  var state = { categorias: [], productos: [], pedidos: [], historial: [], clientes: [], cat: 'todos', q: '', editId: null };
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
  function toast(msg, err) {
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast on' + (err ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 2600);
  }

  /* ---------- Auth ---------- */
  function showLogin(msg) {
    $('login-view').style.display = 'flex';
    $('app-view').style.display = 'none';
    if (msg) $('login-error').textContent = msg;
  }
  async function boot() {
    var s = await db.auth.getSession();
    if (s.data.session) { await enter(s.data.session); } else { showLogin(''); }
  }
  async function enter(session) {
    var chk = await db.from('gasomi_crm_admins').select('email').limit(1);
    if (chk.error || !chk.data || !chk.data.length) {
      await db.auth.signOut();
      showLogin('Esta cuenta no tiene acceso al CRM de Gasomi.');
      return;
    }
    $('login-view').style.display = 'none';
    $('app-view').style.display = 'flex';
    $('side-user').textContent = session.user.email;
    await cargarTodo();
    render();
    activarRealtime();
  }
  $('login-btn').addEventListener('click', doLogin);
  $('login-pass').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  async function doLogin() {
    $('login-error').textContent = '';
    $('login-btn').textContent = 'Entrando…';
    var r = await db.auth.signInWithPassword({ email: $('login-email').value.trim(), password: $('login-pass').value });
    $('login-btn').textContent = 'Entrar';
    if (r.error) { $('login-error').textContent = 'Credenciales incorrectas o cuenta inexistente.'; return; }
    await enter(r.data.session);
  }
  $('logout-btn').addEventListener('click', async function () {
    await db.auth.signOut();
    location.reload();
  });

  /* ---------- Data + realtime ---------- */
  async function cargarTodo() {
    var rc = await db.from('gasomi_categorias').select('*').order('orden');
    var rp = await db.from('gasomi_productos').select('*').order('orden');
    var rped = await db.from('gasomi_pedidos').select('*').order('created_at', { ascending: false }).limit(100);
    var rh = await db.from('gasomi_precios_historial').select('*, gasomi_productos(nombre)').order('created_at', { ascending: false }).limit(200);
    var rcli = await db.from('gasomi_clientes').select('*').order('created_at', { ascending: false });
    state.categorias = rc.data || [];
    state.productos = rp.data || [];
    state.pedidos = rped.data || [];
    state.historial = rh.data || [];
    state.clientes = rcli.data || [];
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
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'gasomi_pedidos' }, function () { refrescar(null); })
      .subscribe();
    db.channel('crm-productos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gasomi_productos' }, function () { refrescar(null); })
      .subscribe();
    db.channel('crm-clientes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gasomi_clientes' }, function () { refrescar(null); })
      .subscribe();
  }

  /* ---------- Navegación ---------- */
  document.querySelectorAll('.side-link').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.side-link').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      document.querySelectorAll('.view').forEach(function (v) { v.style.display = 'none'; });
      $('view-' + b.dataset.view).style.display = 'block';
    });
  });

  /* ---------- Render ---------- */
  function render() { renderDash(); renderChips(); renderProductos(); renderPedidos(); renderClientes(); renderHistorial(); }

  function renderDash() {
    $('dash-fecha').textContent = new Date().toLocaleDateString('es-PE', { timeZone: 'America/Lima', weekday: 'long', day: 'numeric', month: 'long' });
    var activos = state.productos.filter(function (p) { return p.activo; }).length;
    var nuevos = state.pedidos.filter(function (p) { return p.estado === 'nuevo'; }).length;
    var agotados = state.productos.filter(function (p) { return p.stock <= 0; }).length;
    var bajos = state.productos.filter(function (p) { return p.stock > 0 && p.stock <= 5; }).length;
    $('kpis').innerHTML =
      '<div class="kpi"><div class="kpi-n">' + activos + '/' + state.productos.length + '</div><div class="kpi-l">Productos visibles</div></div>' +
      '<div class="kpi"><div class="kpi-n">' + nuevos + '</div><div class="kpi-l">Pedidos nuevos</div></div>' +
      '<div class="kpi"><div class="kpi-n' + (agotados ? ' kpi-alerta' : '') + '">' + agotados + '</div><div class="kpi-l">Agotados</div></div>' +
      '<div class="kpi"><div class="kpi-n' + (bajos ? ' kpi-aviso' : '') + '">' + bajos + '</div><div class="kpi-l">Stock bajo (≤5)</div></div>' +
      '<div class="kpi"><div class="kpi-n">' + state.clientes.length + '</div><div class="kpi-l">Clientes registrados</div></div>';
    var badge = $('badge-pedidos');
    badge.style.display = nuevos ? 'inline-flex' : 'none';
    badge.textContent = nuevos;
    $('dash-pedidos').innerHTML = state.pedidos.slice(0, 5).map(function (p) {
      var n = (p.items || []).reduce(function (a, i) { return a + (i.qty || 0); }, 0);
      return '<div class="pl-row"><div class="pl-main">Pedido #' + p.id + (p.estado === 'nuevo' ? ' · <span class="estado-nuevo">nuevo</span>' : ' · ' + esc(p.estado)) +
        '<div class="pl-sub">' + fecha(p.created_at) + ' · ' + n + ' ítems' + (p.cliente_id ? ' · ' + esc(nombreCliente(p.cliente_id)) : '') + '</div></div><div class="pl-val">' + fmt(p.total) + '</div></div>';
    }).join('') || '<div class="pl-empty">Aún no hay pedidos.</div>';
    $('dash-cambios').innerHTML = state.historial.slice(0, 5).map(function (h) {
      var nom = h.gasomi_productos ? h.gasomi_productos.nombre : h.producto_id;
      return '<div class="pl-row"><div class="pl-main">' + esc(nom) + '<div class="pl-sub">' + fecha(h.created_at) + (h.tipo === 'mayor' ? ' · por mayor' : '') + '</div></div>' +
        '<div class="pl-val">' + fmt(h.precio_anterior) + ' → ' + fmt(h.precio_nuevo) + '</div></div>';
    }).join('') || '<div class="pl-empty">Sin cambios de precio todavía.</div>';
  }

  function nombreCliente(uid) {
    var c = state.clientes.find(function (x) { return x.user_id === uid; });
    if (!c) return 'cliente';
    return c.nombre || c.empresa || c.email;
  }

  function renderChips() {
    var cats = [{ slug: 'todos', nombre: 'Todos' }].concat(state.categorias);
    $('prod-chips').innerHTML = cats.map(function (c) {
      return '<button class="chip' + (state.cat === c.slug ? ' on' : '') + '" data-cat="' + esc(c.slug) + '">' + esc(c.nombre) + '</button>';
    }).join('');
  }

  function renderProductos() {
    var q = state.q.toLowerCase();
    var vis = state.productos.filter(function (p) {
      if (state.cat !== 'todos' && p.categoria !== state.cat) return false;
      if (q && (p.nombre + ' ' + p.marca).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    $('prod-tbody').innerHTML = vis.map(function (p) {
      var thumb = p.imagen
        ? '<img class="prod-thumb" src="../tienda/' + esc(p.imagen) + '" onerror="this.style.display=\'none\'" alt="">'
        : '<div class="prod-thumb-ph">' + esc(p.nombre.charAt(0)) + '</div>';
      var margen = '';
      if (num(p.costo) > 0) {
        var m = ((num(p.precio) - num(p.costo)) / num(p.precio)) * 100;
        margen = '<div class="margen-chip' + (m < 15 ? ' bajo' : '') + '">margen ' + m.toFixed(0) + '%</div>';
      }
      var mayor = num(p.precio_mayor) > 0
        ? fmt(p.precio_mayor) + '<div class="pl-sub">desde ' + p.mayor_desde + ' und.</div>'
        : '<span class="cat-tag">—</span>';
      var stockCls = p.stock <= 0 ? ' stock-cero' : (p.stock <= 5 ? ' stock-bajo' : '');
      return '<tr data-id="' + esc(p.id) + '">' +
        '<td><div class="prod-cell">' + thumb + '<div><div class="prod-nombre">' + esc(p.nombre) + '</div><div class="prod-marca">' + esc(p.marca) + ' · ' + esc(p.unidad) + '</div></div></div></td>' +
        '<td><div class="precio-edit"><input type="number" step="0.10" min="0" value="' + num(p.precio).toFixed(2) + '" data-precio="' + esc(p.id) + '"><button class="precio-save" data-save="' + esc(p.id) + '" title="Guardar precio">✓</button></div>' + margen + '</td>' +
        '<td>' + mayor + '</td>' +
        '<td><div class="precio-edit"><input type="number" step="1" min="0" class="input-stock' + stockCls + '" value="' + p.stock + '" data-stock="' + esc(p.id) + '"><button class="precio-save" data-save-stock="' + esc(p.id) + '" title="Guardar stock">✓</button></div></td>' +
        '<td><button class="switch' + (p.activo ? ' on' : '') + '" data-activo="' + esc(p.id) + '" title="Mostrar u ocultar en la tienda"></button></td>' +
        '<td><button class="icon-btn" data-edit="' + esc(p.id) + '" title="Editar producto">✎</button></td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="6" style="color:var(--muted)">Sin resultados.</td></tr>';
  }

  function renderPedidos() {
    $('pedidos-list').innerHTML = state.pedidos.map(function (p) {
      var items = (p.items || []).map(function (i) {
        return '<div><span>' + i.qty + ' × ' + esc(i.nombre) + (i.mayor ? ' <b class="tag-mayor">por mayor</b>' : '') + '</span><span>' + fmt(i.subtotal) + '</span></div>';
      }).join('');
      var cli = p.cliente_id
        ? '<span class="pedido-cliente">' + esc(nombreCliente(p.cliente_id)) + (p.puntos_otorgados ? ' · <b class="tag-pts">puntos otorgados</b>' : '') + '</span>'
        : '<span class="pedido-cliente">Sin cuenta</span>';
      return '<div class="pedido-card"><div class="pedido-head">' +
        '<span class="pedido-id">#' + p.id + '</span>' +
        '<span class="pedido-fecha">' + fecha(p.created_at) + '</span>' +
        cli +
        '<select class="pedido-estado" data-estado="' + p.id + '">' +
        ['nuevo', 'atendido', 'anulado'].map(function (e) { return '<option value="' + e + '"' + (p.estado === e ? ' selected' : '') + '>' + e + '</option>'; }).join('') +
        '</select>' +
        '<span class="pedido-total">' + fmt(p.total) + '</span>' +
        '</div>' +
        (p.nota ? '<div class="pedido-nota">' + esc(p.nota) + '</div>' : '') +
        '<div class="pedido-items">' + items + '</div></div>';
    }).join('') || '<div class="pl-empty">Aún no hay pedidos. Cuando un cliente envíe su carrito por WhatsApp, quedará registrado aquí y descontará stock automáticamente.</div>';
  }

  function renderClientes() {
    $('cli-tbody').innerHTML = state.clientes.map(function (c) {
      return '<tr>' +
        '<td><div class="prod-nombre">' + esc(c.nombre || '—') + '</div><div class="pl-sub">' + esc(c.email) + '</div></td>' +
        '<td>' + esc(c.telefono || '—') + '</td>' +
        '<td>' + esc(c.empresa || '—') + '</td>' +
        '<td><b class="pts-badge">' + c.puntos + ' pts</b><div class="pl-sub">= ' + fmt(Math.floor(c.puntos / 10)) + '</div></td>' +
        '<td><span class="cat-tag">' + fecha(c.created_at) + '</span></td>' +
        '<td><button class="icon-btn" data-puntos="' + esc(c.user_id) + '" title="Ajustar puntos (canje o bono)">±</button></td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="6" style="color:var(--muted)">Todavía no hay clientes registrados. Los que creen su cuenta en la tienda aparecerán aquí con sus 50 puntos de bienvenida.</td></tr>';
  }

  function renderHistorial() {
    $('hist-tbody').innerHTML = state.historial.map(function (h) {
      var nom = h.gasomi_productos ? h.gasomi_productos.nombre : h.producto_id;
      return '<tr><td>' + fecha(h.created_at) + '</td><td>' + esc(nom) + '</td><td><span class="tag-tipo' + (h.tipo === 'mayor' ? ' mayor' : '') + '">' + (h.tipo === 'mayor' ? 'por mayor' : 'unidad') + '</span></td><td>' + fmt(h.precio_anterior) + '</td><td><b>' + fmt(h.precio_nuevo) + '</b></td><td>' + esc(h.cambiado_por || '—') + '</td></tr>';
    }).join('') || '<tr><td colspan="6" style="color:var(--muted)">Sin cambios registrados.</td></tr>';
  }

  /* ---------- Acciones ---------- */
  async function updateProducto(id, patch, okMsg) {
    var r = await db.from('gasomi_productos').update(patch).eq('id', id).select();
    if (r.error || !r.data || !r.data.length) { toast('No se pudo guardar: ' + (r.error ? r.error.message : 'sin permisos'), true); return false; }
    var i = state.productos.findIndex(function (p) { return p.id === id; });
    if (i > -1) state.productos[i] = r.data[0];
    toast(okMsg || 'Guardado ✓');
    return true;
  }

  document.addEventListener('input', function (e) {
    if (e.target.dataset && (e.target.dataset.precio || e.target.dataset.stock)) e.target.closest('.precio-edit').classList.add('dirty');
    if (e.target.id === 'prod-buscar') { state.q = e.target.value; renderProductos(); }
    if (e.target.id === 'e-precio' || e.target.id === 'e-costo') pintarMargen();
  });

  function pintarMargen() {
    var pr = parseFloat($('e-precio').value || 0);
    var co = parseFloat($('e-costo').value || 0);
    var el = $('e-margen');
    if (pr > 0 && co > 0) {
      var m = ((pr - co) / pr) * 100;
      el.textContent = 'Margen: ' + fmt(pr - co) + ' por unidad (' + m.toFixed(1) + '%)';
      el.style.color = m < 15 ? 'var(--accent-warm)' : 'var(--ok)';
    } else {
      el.textContent = 'Registra el costo para ver tu margen (solo se ve aquí, nunca en la tienda).';
      el.style.color = 'var(--muted)';
    }
  }

  document.addEventListener('click', async function (e) {
    var t = e.target;
    if (t.dataset && t.dataset.cat) { state.cat = t.dataset.cat; renderChips(); renderProductos(); return; }
    if (t.dataset && t.dataset.save) {
      var input = document.querySelector('input[data-precio="' + t.dataset.save + '"]');
      var val = parseFloat(input.value);
      if (isNaN(val) || val < 0) { toast('Precio inválido', true); return; }
      if (await updateProducto(t.dataset.save, { precio: val }, 'Precio actualizado ✓ (la tienda ya lo muestra)')) {
        input.closest('.precio-edit').classList.remove('dirty');
        renderDash(); await refrescarHistorial();
      }
      return;
    }
    if (t.dataset && t.dataset.saveStock) {
      var inputS = document.querySelector('input[data-stock="' + t.dataset.saveStock + '"]');
      var valS = parseInt(inputS.value, 10);
      if (isNaN(valS) || valS < 0) { toast('Stock inválido', true); return; }
      if (await updateProducto(t.dataset.saveStock, { stock: valS }, 'Stock actualizado ✓')) {
        inputS.closest('.precio-edit').classList.remove('dirty');
        renderDash(); renderProductos();
      }
      return;
    }
    if (t.dataset && t.dataset.activo) {
      var p = state.productos.find(function (x) { return x.id === t.dataset.activo; });
      if (await updateProducto(p.id, { activo: !p.activo }, p.activo ? 'Producto oculto en la tienda' : 'Producto visible en la tienda')) {
        t.classList.toggle('on'); renderDash();
      }
      return;
    }
    if (t.dataset && t.dataset.edit) { abrirModal(t.dataset.edit); return; }
    if (t.dataset && t.dataset.puntos) { await ajustarPuntos(t.dataset.puntos); return; }
  });

  async function ajustarPuntos(uid) {
    var c = state.clientes.find(function (x) { return x.user_id === uid; });
    if (!c) return;
    var deltaStr = prompt('Ajustar puntos de ' + (c.nombre || c.email) + ' (tiene ' + c.puntos + ' pts).\nEscribe la cantidad: positiva para abonar, negativa para canjear/descontar.\nEj: -120 para canjear 120 puntos.');
    if (deltaStr == null) return;
    var delta = parseInt(deltaStr, 10);
    if (isNaN(delta) || delta === 0) { toast('Cantidad inválida', true); return; }
    var motivo = prompt('Motivo del ajuste:', delta < 0 ? 'Canje en pedido' : 'Bono') || (delta < 0 ? 'Canje' : 'Bono');
    var nuevos = Math.max(0, c.puntos + delta);
    var r = await db.from('gasomi_clientes').update({ puntos: nuevos }).eq('user_id', uid).select();
    if (r.error || !r.data.length) { toast('No se pudo ajustar', true); return; }
    await db.from('gasomi_puntos_movs').insert({ cliente_id: uid, delta: delta, motivo: motivo + ' (manual)' });
    c.puntos = nuevos;
    renderClientes(); renderDash();
    toast('Puntos de ' + (c.nombre || c.email) + ': ' + nuevos + ' pts');
  }

  document.addEventListener('change', async function (e) {
    if (e.target.dataset && e.target.dataset.estado) {
      var id = parseInt(e.target.dataset.estado, 10);
      var r = await db.from('gasomi_pedidos').update({ estado: e.target.value }).eq('id', id).select();
      if (r.error || !r.data.length) { toast('No se pudo actualizar el pedido', true); return; }
      var i = state.pedidos.findIndex(function (p) { return p.id === id; });
      if (i > -1) state.pedidos[i] = r.data[0];
      await cargarTodo();
      render();
      var msgs = { atendido: 'Pedido #' + id + ' atendido — puntos otorgados si tiene cuenta', anulado: 'Pedido #' + id + ' anulado — stock devuelto', nuevo: 'Pedido #' + id + ' → nuevo' };
      toast(msgs[e.target.value] || 'Pedido actualizado');
    }
  });

  async function refrescarHistorial() {
    var rh = await db.from('gasomi_precios_historial').select('*, gasomi_productos(nombre)').order('created_at', { ascending: false }).limit(200);
    state.historial = rh.data || [];
    renderHistorial(); renderDash();
  }

  /* ---------- Modal ---------- */
  function abrirModal(id) {
    var p = state.productos.find(function (x) { return x.id === id; });
    if (!p) return;
    state.editId = id;
    $('edit-title').textContent = p.nombre;
    $('e-nombre').value = p.nombre;
    $('e-marca').value = p.marca;
    $('e-categoria').innerHTML = state.categorias.map(function (c) {
      return '<option value="' + esc(c.slug) + '"' + (c.slug === p.categoria ? ' selected' : '') + '>' + esc(c.nombre) + '</option>';
    }).join('');
    $('e-precio').value = num(p.precio).toFixed(2);
    $('e-costo').value = num(p.costo).toFixed(2);
    $('e-precio-mayor').value = num(p.precio_mayor).toFixed(2);
    $('e-mayor-desde').value = p.mayor_desde;
    $('e-stock').value = p.stock;
    $('e-unidad').value = p.unidad;
    $('e-norma').value = p.norma;
    $('e-descripcion').value = p.descripcion;
    $('e-imagen').value = p.imagen;
    $('e-activo').checked = !!p.activo;
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
    var patch = {
      nombre: $('e-nombre').value.trim(),
      marca: $('e-marca').value.trim(),
      categoria: $('e-categoria').value,
      precio: val,
      costo: parseFloat($('e-costo').value) || 0,
      precio_mayor: parseFloat($('e-precio-mayor').value) || 0,
      mayor_desde: Math.max(2, parseInt($('e-mayor-desde').value, 10) || 12),
      stock: Math.max(0, parseInt($('e-stock').value, 10) || 0),
      unidad: $('e-unidad').value.trim(),
      norma: $('e-norma').value.trim(),
      descripcion: $('e-descripcion').value.trim(),
      imagen: $('e-imagen').value.trim(),
      activo: $('e-activo').checked
    };
    if (await updateProducto(state.editId, patch, 'Producto actualizado ✓')) {
      cerrarModal(); renderProductos(); renderDash(); await refrescarHistorial();
    }
  });

  boot();
})();
