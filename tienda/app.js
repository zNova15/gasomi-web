/* Tienda EPP — Gasomi Ingenieros E.I.R.L.
   Lógica de catálogo, carrito y checkout por WhatsApp. Sin dependencias. */
(function () {
  'use strict';

  var WA = '51958682246';
  var KEY = 'gasomi_epp_cart_v1';
  var TINTS = ['t-gold', 't-teal', 't-warm', 't-steel'];
  var SHORTS = {
    'proteccion-cabeza': 'Cabeza',
    'proteccion-visual-facial': 'Visual',
    'proteccion-auditiva': 'Auditiva',
    'proteccion-respiratoria': 'Respiratoria',
    'proteccion-manos': 'Manos',
    'calzado-seguridad': 'Calzado',
    'ropa-trabajo': 'Ropa',
    'altura-senalizacion': 'Altura'
  };

  var data = window.GASOMI_CATALOGO || { categorias: [], productos: [] };
  var byId = {};
  var catIdx = {};
  data.productos.forEach(function (p) { byId[p.id] = p; });
  data.categorias.forEach(function (c, i) { catIdx[c.slug] = i; });

  var state = {
    cat: 'todos',
    q: '',
    cart: loadCart(),
    open: false,
    modal: null,
    qty: 1
  };
  var toastTimer = null;

  function loadCart() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveCart() {
    try { localStorage.setItem(KEY, JSON.stringify(state.cart)); } catch (e) {}
  }
  function fmt(n) { return 'S/ ' + n.toFixed(2); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(s) {
    return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function precio(p) { return p.precio_ref_soles != null ? p.precio_ref_soles : p.precio; }
  function tintOf(p) { return TINTS[(catIdx[p.categoria] || 0) % 4]; }

  function visibles() {
    var nq = norm(state.q);
    return data.productos.filter(function (p) {
      if (state.cat !== 'todos' && p.categoria !== state.cat) return false;
      if (nq && norm(p.nombre + ' ' + p.marca + ' ' + p.categoria).indexOf(nq) === -1) return false;
      return true;
    });
  }

  function phHTML(p, extraCls) {
    return '<div class="ph ' + (extraCls || '') + '">' +
      '<div class="ph-glow"></div>' +
      '<div class="ph-mono">' + esc(p.nombre.charAt(0)) + '</div>' +
      (extraCls ? '' : '<span class="card-cat">' + esc(SHORTS[p.categoria] || 'EPP') + '</span>') +
      '<span class="ph-tag">foto producto</span>' +
      '</div>';
  }

  function renderChips() {
    var cats = [{ slug: 'todos', nombre: 'Todos' }].concat(data.categorias);
    document.getElementById('chips').innerHTML = cats.map(function (c) {
      return '<button class="chip' + (state.cat === c.slug ? ' on' : '') + '" data-cat="' + esc(c.slug) + '">' + esc(c.nombre) + '</button>';
    }).join('');
  }

  function renderGrid() {
    var vis = visibles();
    document.getElementById('cat-count').textContent = vis.length + ' de ' + data.productos.length + ' productos';
    document.getElementById('sin-result').style.display = vis.length ? 'none' : 'block';
    document.getElementById('grid').innerHTML = vis.map(function (p) {
      return '<div class="card ' + tintOf(p) + '" data-open="' + esc(p.id) + '">' +
        phHTML(p) +
        '<div class="card-body">' +
        '<span class="card-marca">' + esc(p.marca) + '</span>' +
        '<h3 class="card-nombre">' + esc(p.nombre) + '</h3>' +
        (p.norma ? '<span class="norma">' + esc(p.norma) + '</span>' : '') +
        '<div class="card-foot">' +
        '<div><div class="precio">' + fmt(precio(p)) + '</div><div class="unidad">' + esc(p.unidad) + '</div></div>' +
        '<button class="add-btn" data-add="' + esc(p.id) + '">+ Agregar</button>' +
        '</div></div></div>';
    }).join('');
  }

  function cartIds() {
    return Object.keys(state.cart).filter(function (id) { return byId[id]; });
  }

  function renderCart() {
    var ids = cartIds();
    var total = 0;
    var count = 0;
    var rows = ids.map(function (id) {
      var p = byId[id];
      var q = state.cart[id];
      var sub = precio(p) * q;
      total += sub;
      count += q;
      return '<div class="d-item">' +
        '<div class="d-info"><div class="d-nombre">' + esc(p.nombre) + '</div>' +
        '<div class="d-meta">' + fmt(precio(p)) + ' · ' + esc(p.unidad) + '</div></div>' +
        '<div class="step"><button data-dec="' + esc(id) + '">−</button><span>' + q + '</span><button data-inc="' + esc(id) + '">+</button></div>' +
        '<div class="d-sub">' + fmt(sub) + '</div>' +
        '<button class="d-x" data-del="' + esc(id) + '">✕</button>' +
        '</div>';
    });
    document.getElementById('cart-count').textContent = count;
    document.getElementById('d-empty').style.display = ids.length ? 'none' : 'block';
    document.getElementById('d-items').innerHTML = rows.join('');
    document.getElementById('total-n').textContent = fmt(total);

    var lines = ids.map(function (id) {
      var p = byId[id];
      var q = state.cart[id];
      var u = norm(p.nombre).indexOf(norm(p.unidad)) === -1 ? ' (' + p.unidad + ')' : '';
      return '• ' + q + ' × ' + p.nombre + u + ' — ' + fmt(precio(p) * q);
    });
    var msg = 'Hola Gasomi, quiero hacer este pedido de EPPs desde la tienda online:\n' +
      lines.join('\n') + '\nTotal referencial: ' + fmt(total) + '\n\nMi obra / empresa: ';
    document.getElementById('wa-btn').href = 'https://wa.me/' + WA + '?text=' + encodeURIComponent(msg);
  }

  function renderModal() {
    var root = document.getElementById('modal-root');
    var p = state.modal ? byId[state.modal] : null;
    if (!p) { root.innerHTML = ''; return; }
    root.innerHTML = '<div class="modal-wrap">' +
      '<div class="overlay on" data-close="1"></div>' +
      '<div class="modal" style="z-index:101">' +
      '<button class="x-btn modal-x" data-close="1">✕</button>' +
      phHTML(p, tintOf(p)) +
      '<div class="modal-body">' +
      '<span class="card-marca">' + esc(p.marca) + '</span>' +
      '<h3 class="modal-nombre">' + esc(p.nombre) + '</h3>' +
      '<p class="modal-desc">' + esc(p.descripcion) + '</p>' +
      (p.norma ? '<span class="norma">' + esc(p.norma) + '</span>' : '') +
      '<div class="modal-precio-row"><span class="modal-precio">' + fmt(precio(p)) + '</span><span class="unidad">' + esc(p.unidad) + '</span></div>' +
      '<div class="modal-acciones">' +
      '<div class="step"><button data-qty="-1">−</button><span id="m-qty">' + state.qty + '</span><button data-qty="1">+</button></div>' +
      '<button class="add-btn" data-add-modal="' + esc(p.id) + '" style="padding:12px 22px;font-size:0.9rem">Agregar al pedido</button>' +
      '</div></div></div></div>';
  }

  function setDrawer(open) {
    state.open = open;
    document.getElementById('overlay').className = open ? 'overlay on' : 'overlay';
    document.getElementById('drawer').className = open ? 'drawer on' : 'drawer';
  }

  function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast on';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 1800);
  }

  function mod(id, delta) {
    var n = (state.cart[id] || 0) + delta;
    if (n <= 0) { delete state.cart[id]; } else { state.cart[id] = n; }
    saveCart();
    renderCart();
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-cat],[data-add],[data-open],[data-inc],[data-dec],[data-del],[data-close],[data-qty],[data-add-modal],#cart-btn,#x-btn');
    if (!t) return;
    if (t.dataset.cat) { state.cat = t.dataset.cat; renderChips(); renderGrid(); return; }
    if (t.dataset.add) {
      e.stopPropagation();
      mod(t.dataset.add, 1);
      toast('Agregado: ' + byId[t.dataset.add].nombre);
      return;
    }
    if (t.dataset.addModal) {
      mod(t.dataset.addModal, state.qty);
      toast('Agregado: ' + byId[t.dataset.addModal].nombre);
      state.modal = null;
      renderModal();
      return;
    }
    if (t.dataset.qty) {
      state.qty = Math.max(1, state.qty + parseInt(t.dataset.qty, 10));
      document.getElementById('m-qty').textContent = state.qty;
      return;
    }
    if (t.dataset.open) { state.modal = t.dataset.open; state.qty = 1; renderModal(); return; }
    if (t.dataset.inc) { mod(t.dataset.inc, 1); return; }
    if (t.dataset.dec) { mod(t.dataset.dec, -1); return; }
    if (t.dataset.del) { mod(t.dataset.del, -(state.cart[t.dataset.del] || 0)); return; }
    if (t.dataset.close) { state.modal = null; renderModal(); setDrawer(false); return; }
    if (t.id === 'cart-btn') { setDrawer(true); return; }
    if (t.id === 'x-btn') { setDrawer(false); return; }
  });

  document.getElementById('overlay').addEventListener('click', function () { setDrawer(false); });
  document.getElementById('buscar').addEventListener('input', function (e) {
    state.q = e.target.value;
    renderGrid();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { state.modal = null; renderModal(); setDrawer(false); }
  });

  renderChips();
  renderGrid();
  renderCart();
})();
