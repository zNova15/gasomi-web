/* Tienda EPP — cuenta de cliente: registro con bono de bienvenida, login, puntos,
   canje como descuento en el pedido y "mis pedidos". Usa el cliente Supabase de live.js. */
(function () {
  'use strict';
  var db = window.__gasomiSB;
  var btn = document.getElementById('cuenta-btn');
  if (!db) { if (btn) btn.style.display = 'none'; return; }

  var st = { session: null, cliente: null, movs: [], pedidos: [], canje: false, vista: 'login' };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n) { return 'S/ ' + n.toFixed(2); }
  function fecha(iso) {
    return new Date(iso).toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'short' });
  }
  function toast(m) { if (window.__gasomiToast) window.__gasomiToast(m); }

  window.__gasomiCanje = function () {
    return { activo: st.canje, puntos: st.cliente ? st.cliente.puntos : 0 };
  };
  window.__gasomiCliente = function () { return st.cliente; };

  /* ---------- Botón del nav + caja de canje en el carrito ---------- */
  function pintarNav() {
    if (st.cliente) {
      var nombre = (st.cliente.nombre || st.cliente.email).split(' ')[0].split('@')[0];
      btn.innerHTML = esc(nombre) + ' <span class="pts">' + st.cliente.puntos + ' pts</span>';
    } else {
      btn.textContent = 'Mi cuenta';
    }
  }
  window.__gasomiActualizarCanjeUI = function () {
    var box = $('canje-box');
    var pedido = window.__gasomiPedidoActual;
    if (st.cliente && st.cliente.puntos >= 10 && pedido) {
      box.classList.add('visible');
      $('canje-pts').textContent = st.cliente.puntos;
      var maxDesc = Math.floor(st.cliente.puntos / 10);
      $('canje-desc').textContent = '−' + fmt(Math.min(maxDesc, Math.floor(pedido.total + (st.canje ? maxDesc : 0))));
      $('canje-check').checked = st.canje;
    } else {
      box.classList.remove('visible');
    }
  };
  if (!document.getElementById('confirmar')) {
    // en el catálogo el canje vive aquí; en pago.html lo maneja pago.js
    $('canje-check').addEventListener('change', function (e) {
      st.canje = e.target.checked;
      if (window.__gasomiRefrescarCarrito) window.__gasomiRefrescarCarrito();
    });
  }

  /* ---------- Modal ---------- */
  function abrir() { $('cuenta-wrap').classList.add('visible'); pintar(); }
  function cerrar() { $('cuenta-wrap').classList.remove('visible'); }
  btn.addEventListener('click', abrir);
  $('cuenta-close').addEventListener('click', cerrar);
  $('cuenta-overlay').addEventListener('click', cerrar);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrar(); });

  function pintar() {
    var b = $('cuenta-body');
    if (st.cliente) { pintarPerfil(b); return; }
    var esLogin = st.vista === 'login';
    $('cuenta-title').textContent = 'Mi cuenta';
    b.innerHTML =
      '<div class="cuenta-tabs">' +
      '<button class="cuenta-tab' + (esLogin ? ' on' : '') + '" data-vista="login">Ingresar</button>' +
      '<button class="cuenta-tab' + (!esLogin ? ' on' : '') + '" data-vista="registro">Crear cuenta</button>' +
      '</div>' +
      (esLogin ? '' :
        '<label>Nombre completo<input type="text" id="c-nombre" placeholder="Juan Pérez"></label>' +
        '<label>Teléfono / WhatsApp<input type="tel" id="c-telefono" placeholder="9xx xxx xxx"></label>' +
        '<label>Empresa u obra (opcional)<input type="text" id="c-empresa" placeholder="Constructora XYZ"></label>') +
      '<label>Correo<input type="email" id="c-email" autocomplete="username" placeholder="tu@correo.com"></label>' +
      '<label>Contraseña<input type="password" id="c-pass" autocomplete="' + (esLogin ? 'current-password' : 'new-password') + '" placeholder="Mínimo 6 caracteres"></label>' +
      '<button class="btn-gold btn-block" id="c-accion">' + (esLogin ? 'Ingresar' : 'Crear cuenta y ganar 50 puntos') + '</button>' +
      '<div class="o-sep"><span>o</span></div>' +
      '<button class="btn-google btn-block" id="c-google" type="button"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.8 6C12.3 13.5 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z"/><path fill="#FBBC05" d="M10.4 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.8-6A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.7-4-13.6-9.7l-7.8 6C6.5 42.6 14.6 48 24 48z"/></svg> Continuar con Google</button>' +
      (esLogin ? '' : '<div class="cuenta-legal">Al crear tu cuenta aceptas nuestra <a href="../privacidad.html" target="_blank" rel="noopener">Política de Privacidad</a> (Ley 29733).</div>') +
      '<div class="cuenta-msg" id="c-msg"></div>';
  }

  function pintarPerfil(b) {
    var c = st.cliente;
    $('cuenta-title').textContent = 'Hola, ' + (c.nombre ? c.nombre.split(' ')[0] : 'cliente');
    var movs = st.movs.slice(0, 5).map(function (m) {
      return '<div class="mp-row"><span>' + esc(m.motivo) + '</span><span class="pl-val">' + (m.delta > 0 ? '+' : '') + m.delta + ' pts</span></div>';
    }).join('') || '<div class="mp-row">Aún no tienes movimientos.</div>';
    var peds = st.pedidos.slice(0, 6).map(function (p) {
      return '<div class="mp-row"><span>#' + p.id + ' · ' + fecha(p.created_at) + '</span><span class="mp-est ' + esc(p.estado) + '">' + esc(p.estado) + '</span><span class="pl-val">' + fmt(parseFloat(p.total)) + '</span></div>';
    }).join('') || '<div class="mp-row">Todavía no tienes pedidos.</div>';
    b.innerHTML =
      '<div class="puntos-card"><div class="puntos-n">' + c.puntos + ' pts</div>' +
      '<div class="puntos-l">Tus puntos Gasomi</div>' +
      '<div class="puntos-eq">= ' + fmt(Math.floor(c.puntos / 10)) + ' de descuento · canjéalos en tu carrito</div></div>' +
      '<div class="cuenta-sec"><h4>Movimientos de puntos</h4>' + movs + '</div>' +
      '<div class="cuenta-sec"><h4>Mis pedidos</h4>' + peds + '</div>' +
      '<div class="cuenta-sec"><h4>Mis datos</h4>' +
      '<label>Nombre<input type="text" id="c-nombre" value="' + esc(c.nombre) + '"></label>' +
      '<label>Teléfono<input type="tel" id="c-telefono" value="' + esc(c.telefono) + '"></label>' +
      '<label>Empresa<input type="text" id="c-empresa" value="' + esc(c.empresa) + '"></label>' +
      '<button class="btn-gold btn-block" id="c-guardar">Guardar datos</button>' +
      '<div class="cuenta-msg" id="c-msg"></div></div>' +
      '<button class="cuenta-out" id="c-salir">Cerrar sesión</button>';
  }

  document.addEventListener('click', async function (e) {
    var t = e.target;
    if (t.dataset && t.dataset.vista) { st.vista = t.dataset.vista; pintar(); return; }
    if (t.id === 'c-accion') { st.vista === 'login' ? await login() : await registro(); return; }
    if (t.id === 'c-google') {
      var r = await db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname + location.search } });
      if (r.error) msg('Google no está disponible en este momento. Usa correo y contraseña.');
      return;
    }
    if (t.id === 'c-guardar') { await guardarDatos(); return; }
    if (t.id === 'c-salir') {
      await db.auth.signOut();
      st.session = null; st.cliente = null; st.canje = false;
      pintarNav(); pintar();
      if (window.__gasomiRefrescarCarrito) window.__gasomiRefrescarCarrito();
      toast('Sesión cerrada');
      return;
    }
  });

  function msg(texto, ok) {
    var el = $('c-msg');
    if (el) { el.textContent = texto; el.className = 'cuenta-msg ' + (ok ? 'ok' : 'err'); }
  }

  async function registro() {
    var email = $('c-email').value.trim();
    var pass = $('c-pass').value;
    if (!email || pass.length < 6) { msg('Completa correo y una contraseña de 6+ caracteres.'); return; }
    var r = await db.auth.signUp({
      email: email,
      password: pass,
      options: { data: { nombre: $('c-nombre').value.trim(), telefono: $('c-telefono').value.trim(), empresa: $('c-empresa').value.trim(), tienda: 'gasomi' } }
    });
    if (r.error) {
      msg(r.error.message.indexOf('already') > -1 ? 'Este correo ya tiene cuenta — usa "Ingresar".' : 'No se pudo crear la cuenta: ' + r.error.message);
      return;
    }
    if (r.data.session) {
      st.session = r.data.session;
      await cargarCliente();
      toast('¡Cuenta creada! Ganaste 50 puntos de bienvenida');
    } else {
      msg('Te enviamos un correo de confirmación. Confírmalo y luego inicia sesión aquí — tus 50 puntos de bienvenida te esperan.', true);
    }
  }

  async function login() {
    var r = await db.auth.signInWithPassword({ email: $('c-email').value.trim(), password: $('c-pass').value });
    if (r.error) { msg('Correo o contraseña incorrectos, o cuenta sin confirmar.'); return; }
    st.session = r.data.session;
    await cargarCliente();
    toast('¡Bienvenido de vuelta!');
  }

  async function guardarDatos() {
    var r = await db.from('gasomi_clientes').update({
      nombre: $('c-nombre').value.trim(),
      telefono: $('c-telefono').value.trim(),
      empresa: $('c-empresa').value.trim()
    }).eq('user_id', st.session.user.id).select();
    if (r.error || !r.data.length) { msg('No se pudo guardar.'); return; }
    st.cliente = r.data[0];
    pintarNav();
    msg('Datos guardados ✓', true);
  }

  async function cargarCliente() {
    if (!st.session) return;
    var uid = st.session.user.id;
    // el personal del CRM no es cliente de la tienda
    var staff = await db.from('gasomi_crm_usuarios').select('email').eq('email', st.session.user.email).limit(1);
    if (staff.data && staff.data.length) { st.cliente = null; pintarNav(); return; }
    var r = await db.from('gasomi_clientes').select('*').eq('user_id', uid);
    if (!r.data || !r.data.length) {
      var meta = st.session.user.user_metadata || {};
      var prov = (st.session.user.app_metadata && st.session.user.app_metadata.provider) || 'email';
      var ins = await db.from('gasomi_clientes').insert({
        user_id: uid,
        email: st.session.user.email,
        nombre: meta.nombre || meta.full_name || meta.name || '',
        telefono: meta.telefono || '',
        empresa: meta.empresa || '',
        provider: prov
      }).select();
      st.cliente = ins.data && ins.data.length ? ins.data[0] : null;
      if (st.cliente && prov === 'google') toast('¡Bienvenido! Ganaste 50 puntos de bienvenida');
    } else {
      st.cliente = r.data[0];
    }
    if (window.__gasomiOnCliente) window.__gasomiOnCliente();
    var rm = await db.from('gasomi_puntos_movs').select('*').eq('cliente_id', uid).order('created_at', { ascending: false }).limit(10);
    st.movs = rm.data || [];
    var rp = await db.from('gasomi_pedidos').select('id,total,estado,created_at').eq('cliente_id', uid).order('created_at', { ascending: false }).limit(10);
    st.pedidos = rp.data || [];
    pintarNav();
    pintar();
    if (window.__gasomiRefrescarCarrito) window.__gasomiRefrescarCarrito();

    // puntos en vivo (p. ej., cuando Gasomi atiende tu pedido)
    db.channel('gasomi-cliente-' + uid)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'gasomi_clientes', filter: 'user_id=eq.' + uid }, function (payload) {
        if (payload.new) {
          st.cliente = payload.new;
          pintarNav();
          if ($('cuenta-wrap').classList.contains('visible')) pintar();
          if (window.__gasomiRefrescarCarrito) window.__gasomiRefrescarCarrito();
        }
      })
      .subscribe();
  }

  (async function boot() {
    try {
      var s = await db.auth.getSession();
      if (s.data.session) { st.session = s.data.session; await cargarCliente(); }
      // vuelta del OAuth de Google
      db.auth.onAuthStateChange(function (ev, sess) {
        if (ev === 'SIGNED_IN' && sess && (!st.session || st.session.user.id !== sess.user.id)) { st.session = sess; cargarCliente(); }
      });
    } catch (e) {}
  })();
})();
