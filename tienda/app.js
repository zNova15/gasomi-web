/* Tienda EPP — Gasomi Ingenieros E.I.R.L.
   Catálogo con filtros laterales, stock en vivo, precio por mayor, carrito con puntos
   y checkout por WhatsApp. Sin dependencias (Supabase se conecta aparte en live.js). */
(function () {
  'use strict';

  var WA = '51958682246';
  var KEY = 'gasomi_epp_cart_v1';
  var TINTS = ['t-gold', 't-teal', 't-warm', 't-steel'];
  var SHORTS = {
    'epp': 'EPP',
    'herramientas-manuales': 'Herramientas',
    'herramientas-electricas': 'Eléctricas',
    'tornilleria-fijaciones': 'Tornillería',
    'gasfiteria': 'Gasfitería',
    'electricidad': 'Electricidad',
    'pinturas': 'Pinturas',
    'construccion': 'Construcción',
    'cerrajeria': 'Cerrajería',
    'jardin-exterior': 'Jardín',
    'adhesivos-quimicos': 'Adhesivos',
    'escaleras-andamios': 'Escaleras',
    'limpieza-industrial': 'Limpieza'
  };

  var data = window.GASOMI_CATALOGO || { categorias: [], productos: [] };
  var byId = {};
  var catIdx = {};
  function rebuild() {
    byId = {}; catIdx = {};
    data.productos.forEach(function (p) { byId[p.id] = p; });
    data.categorias.forEach(function (c, i) { catIdx[c.slug] = i; });
  }
  rebuild();

  var state = {
    cat: (typeof window.__GASOMI_CAT === 'string' ? window.__GASOMI_CAT : 'todos'),
    sub: 'todas',
    q: '',
    marcas: {},          // {marca: true}
    pmin: null,
    pmax: null,
    soloStock: false,
    orden: 'relevancia',
    cart: loadCart(),
    open: false,
    modal: null,
    qty: 1,
    filtrosOpen: false
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
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(s) {
    return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function precio(p) { return p.precio != null ? p.precio : p.precio_ref_soles; }
  function stockDe(p) { return p.stock != null ? p.stock : 99; }
  function tieneMayor(p) { return p.precio_mayor > 0 && p.precio_mayor < precio(p); }
  function precioAplicado(p, qty) {
    return (tieneMayor(p) && qty >= p.mayor_desde) ? p.precio_mayor : precio(p);
  }
  function tintOf(p) { return TINTS[(catIdx[p.categoria] || 0) % 4]; }
  function imgSrc(p) {
    if (!p.imagen) return '';
    return p.imagen.indexOf('http') === 0 ? p.imagen : '/tienda/' + p.imagen;
  }

  /* ---------- Filtros ---------- */
  function baseFiltro(p, ignorar) {
    // aplica todos los filtros menos el indicado (para contar opciones)
    if (state.q) {
      var hay = norm(p.nombre + ' ' + p.marca + ' ' + p.categoria + ' ' + (p.subcategoria || ''));
      var toks = norm(state.q).split(/\s+/).filter(Boolean);
      for (var ti = 0; ti < toks.length; ti++) { if (hay.indexOf(toks[ti]) === -1) return false; }
    }
    if (ignorar !== 'cat' && state.cat !== 'todos' && p.categoria !== state.cat) return false;
    if (ignorar !== 'cat' && ignorar !== 'sub' && state.cat !== 'todos' && state.sub !== 'todas' && (p.subcategoria || '') !== state.sub) return false;
    if (ignorar !== 'marca') {
      var sel = Object.keys(state.marcas);
      if (sel.length && !state.marcas[p.marca]) return false;
    }
    if (ignorar !== 'precio') {
      var pr = precio(p);
      if (state.pmin != null && pr < state.pmin) return false;
      if (state.pmax != null && pr > state.pmax) return false;
    }
    if (ignorar !== 'stock' && state.soloStock && stockDe(p) <= 0) return false;
    return true;
  }
  function visibles() {
    var vis = data.productos.filter(function (p) { return baseFiltro(p, null); });
    if (state.orden === 'precio-asc') vis.sort(function (a, b) { return precio(a) - precio(b); });
    if (state.orden === 'precio-desc') vis.sort(function (a, b) { return precio(b) - precio(a); });
    if (state.orden === 'stock') vis.sort(function (a, b) { return stockDe(b) - stockDe(a); });
    return vis;
  }

  function renderFiltros() {
    var el = document.getElementById('filtros');
    if (!el) return;
    var catCounts = {};
    data.productos.forEach(function (p) { if (baseFiltro(p, 'cat')) catCounts[p.categoria] = (catCounts[p.categoria] || 0) + 1; });
    var totalCat = Object.keys(catCounts).reduce(function (a, k) { return a + catCounts[k]; }, 0);
    var cats = '<button class="f-cat' + (state.cat === 'todos' ? ' on' : '') + '" data-fcat="todos"><span>Todas</span><span class="n">' + totalCat + '</span></button>' +
      data.categorias.map(function (c) {
        return '<button class="f-cat' + (state.cat === c.slug ? ' on' : '') + '" data-fcat="' + esc(c.slug) + '"><span>' + esc(c.nombre) + '</span><span class="n">' + (catCounts[c.slug] || 0) + '</span></button>';
      }).join('');

    var marcaCounts = {};
    data.productos.forEach(function (p) { if (baseFiltro(p, 'marca')) marcaCounts[p.marca] = (marcaCounts[p.marca] || 0) + 1; });
    var marcasOrden = Object.keys(marcaCounts).sort(function (a, b) { return marcaCounts[b] - marcaCounts[a] || a.localeCompare(b); });
    var marcasOrden = marcasOrden.slice(0, state.masMarcas ? 60 : 12);
    var marcas = marcasOrden.map(function (m) {
      return '<label class="f-check"><input type="checkbox" data-fmarca="' + esc(m) + '"' + (state.marcas[m] ? ' checked' : '') + '><span>' + esc(m) + '</span><span class="n">' + marcaCounts[m] + '</span></label>';
    }).join('');

    var subs = '';
    if (state.cat !== 'todos') {
      var subCounts = {};
      data.productos.forEach(function (p) { if (p.categoria === state.cat && baseFiltro(p, 'sub')) subCounts[p.subcategoria || 'Otros'] = (subCounts[p.subcategoria || 'Otros'] || 0) + 1; });
      var subKeys = Object.keys(subCounts).sort();
      if (subKeys.length > 1) {
        subs = '<div class="f-sec"><div class="f-label">Subcategoría</div>' +
          '<button class="f-cat f-sub' + (state.sub === 'todas' ? ' on' : '') + '" data-fsub="todas"><span>Todas</span></button>' +
          subKeys.map(function (k) {
            return '<button class="f-cat f-sub' + (state.sub === k ? ' on' : '') + '" data-fsub="' + esc(k) + '"><span>' + esc(k) + '</span><span class="n">' + subCounts[k] + '</span></button>';
          }).join('') + '</div>';
      }
    }
    el.innerHTML =
      '<div class="f-head"><span class="f-title">Filtros</span><button class="f-clear" id="f-clear">Limpiar todo</button></div>' +
      '<div class="f-sec"><div class="f-label">Departamentos</div>' + cats + '</div>' +
      subs +
      '<div class="f-sec"><div class="f-label">Marcas</div>' + marcas + (Object.keys(marcaCounts).length > 12 ? '<button class="f-clear" id="f-mas-marcas">' + (state.masMarcas ? 'Ver menos' : 'Ver todas las marcas') + '</button>' : '') + '</div>' +
      '<div class="f-sec"><div class="f-label">Precio (S/)</div><div class="f-precio">' +
      '<input type="number" min="0" placeholder="Mín" id="f-pmin" value="' + (state.pmin != null ? state.pmin : '') + '">' +
      '<span>—</span>' +
      '<input type="number" min="0" placeholder="Máx" id="f-pmax" value="' + (state.pmax != null ? state.pmax : '') + '"></div></div>' +
      '<div class="f-sec"><label class="f-check"><input type="checkbox" id="f-stock"' + (state.soloStock ? ' checked' : '') + '><span>Solo con stock</span></label></div>';
  }

  /* ---------- Cards ---------- */
  function stockChip(p) {
    var s = stockDe(p);
    if (s <= 0) return '<span class="stock-chip fuera">Agotado</span>';
    if (s <= 5) return '<span class="stock-chip pocas">¡Últimas ' + s + '!</span>';
    return '';
  }
  function phHTML(p, extraCls) {
    var img = p.imagen
      ? '<img class="ph-img" loading="lazy" src="' + esc(imgSrc(p)) + '" alt="' + esc(p.nombre) + '" onerror="this.remove()">'
      : '';
    return '<div class="ph ' + (extraCls || '') + '">' +
      '<div class="ph-glow"></div>' +
      '<div class="ph-mono">' + esc(p.nombre.charAt(0)) + '</div>' +
      img +
      (extraCls ? '' : '<span class="card-cat">' + esc(SHORTS[p.categoria] || 'EPP') + '</span>') +
      stockChip(p) +
      (p.imagen ? '' : '<span class="ph-tag">foto producto</span>') +
      '</div>';
  }
  function mayorLine(p) {
    if (!tieneMayor(p)) return '';
    return '<span class="mayor-line">Por mayor (' + p.mayor_desde + '+): ' + fmt(p.precio_mayor) + '</span>';
  }

  function renderDeptos() {
    var el = document.getElementById('deptos-grid');
    if (!el) return;
    el.innerHTML = data.categorias.map(function (c) {
      var ps = data.productos.filter(function (p) { return p.categoria === c.slug; });
      var conFoto = ps.filter(function (p) { return p.imagen; });
      var foto = conFoto.length ? imgSrc(conFoto[0]) : '';
      return '<a class="depto-card" href="/tienda/c/' + esc(c.slug) + '/">' +
        (foto ? '<img src="' + esc(foto) + '" alt="" loading="lazy">' : '<div class="depto-ph">' + esc(c.nombre.charAt(0)) + '</div>') +
        '<div class="depto-body"><div class="depto-nombre">' + esc(c.nombre) + '</div>' +
        '<div class="depto-n">' + ps.length + ' productos</div></div></a>';
    }).join('');
  }

  var PAGE = 48;
  function renderGrid() {
    if (!document.getElementById('grid')) return;
    var visAll = visibles();
    var lim = state.pageLim || PAGE;
    var vis = visAll.slice(0, lim);
    document.getElementById('cat-count').textContent = (visAll.length > vis.length ? vis.length + ' de ' : '') + visAll.length + ' productos';
    document.getElementById('sin-result').style.display = visAll.length ? 'none' : 'block';
    var masBtn = document.getElementById('ver-mas');
    if (masBtn) { masBtn.style.display = visAll.length > vis.length ? 'inline-flex' : 'none'; masBtn.textContent = 'Ver más (' + (visAll.length - vis.length) + ' restantes)'; }
    document.getElementById('grid').innerHTML = vis.map(function (p) {
      var s = stockDe(p);
      var boton = s <= 0
        ? '<button class="add-btn" disabled>Agotado</button>'
        : '<button class="add-btn" data-add="' + esc(p.id) + '">+ Agregar</button>';
      return '<div class="card ' + tintOf(p) + (s <= 0 ? ' agotado' : '') + '" data-open="' + esc(p.id) + '">' +
        phHTML(p) +
        '<div class="card-body">' +
        '<span class="card-marca">' + esc(p.marca) + '</span>' +
        '<h3 class="card-nombre">' + esc(p.nombre) + '</h3>' +
        (p.norma ? '<span class="norma">' + esc(p.norma) + '</span>' : '') +
        mayorLine(p) +
        '<div class="card-foot">' +
        '<div><div class="precio">' + fmt(precio(p)) + '</div><div class="unidad">' + esc(p.unidad) + '</div></div>' +
        boton +
        '</div></div></div>';
    }).join('');
  }

  /* ---------- Carrito ---------- */
  function cartIds() {
    return Object.keys(state.cart).filter(function (id) { return byId[id]; });
  }
  function canjeInfo(totalBruto) {
    var c = window.__gasomiCanje ? window.__gasomiCanje() : null;
    if (!c || !c.activo || c.puntos < 10) return { desc: 0, puntos: 0 };
    var maxDesc = Math.floor(c.puntos / 10);
    var desc = Math.min(maxDesc, Math.floor(totalBruto));
    return { desc: desc, puntos: desc * 10 };
  }

  function renderCart() {
    if (!document.getElementById('d-items')) return;
    var ids = cartIds();
    var totalBruto = 0;
    var count = 0;
    var lines = [];
    var itemsPayload = [];
    var rows = ids.map(function (id) {
      var p = byId[id];
      var q = state.cart[id];
      var pu = precioAplicado(p, q);
      var esMayor = tieneMayor(p) && q >= p.mayor_desde;
      var sub = pu * q;
      totalBruto += sub;
      count += q;
      var u = norm(p.nombre).indexOf(norm(p.unidad)) === -1 ? ' (' + p.unidad + ')' : '';
      lines.push('• ' + q + ' × ' + p.nombre + u + (esMayor ? ' [precio por mayor]' : '') + ' — ' + fmt(sub));
      itemsPayload.push({ id: p.id, nombre: p.nombre, qty: q, precio: pu, mayor: esMayor, subtotal: +sub.toFixed(2) });
      return '<div class="d-item">' +
        '<div class="d-info"><div class="d-nombre">' + esc(p.nombre) + '</div>' +
        '<div class="d-meta">' + fmt(pu) + ' · ' + esc(p.unidad) + (esMayor ? '<span class="d-mayor">por mayor</span>' : '') + '</div></div>' +
        '<div class="step"><button data-dec="' + esc(id) + '">−</button><span>' + q + '</span><button data-inc="' + esc(id) + '">+</button></div>' +
        '<div class="d-sub">' + fmt(sub) + '</div>' +
        '<button class="d-x" data-del="' + esc(id) + '">✕</button>' +
        '</div>';
    });
    document.getElementById('cart-count').textContent = count;
    document.getElementById('d-empty').style.display = ids.length ? 'none' : 'block';
    document.getElementById('d-items').innerHTML = rows.join('');

    // canje de puntos
    var canje = canjeInfo(totalBruto);
    var total = totalBruto - canje.desc;
    var descRow = document.getElementById('desc-row');
    if (canje.desc > 0) {
      descRow.style.display = 'flex';
      document.getElementById('desc-n').textContent = '−' + fmt(canje.desc);
      lines.push('Canjeo ' + canje.puntos + ' puntos: −' + fmt(canje.desc));
    } else {
      descRow.style.display = 'none';
    }
    document.getElementById('total-n').textContent = fmt(total);

    var msg = 'Hola Gasomi, quiero hacer este pedido de EPPs desde la tienda online:\n' + lines.join('\n') +
      '\nTotal referencial: ' + fmt(total) + '\n\nMi obra / empresa: ';
    document.getElementById('wa-btn').href = 'https://wa.me/' + WA + '?text=' + encodeURIComponent(msg);

    // datos para el registro del pedido (live.js / cuenta.js)
    window.__gasomiPedidoActual = ids.length ? {
      items: itemsPayload,
      total: +total.toFixed(2),
      nota: canje.desc > 0 ? ('Canjea ' + canje.puntos + ' puntos (−' + fmt(canje.desc) + ')') : ''
    } : null;

    if (window.__gasomiActualizarCanjeUI) window.__gasomiActualizarCanjeUI();
  }

  /* ---------- Modal producto ---------- */
  function renderModal() {
    var root = document.getElementById('modal-root');
    var p = state.modal ? byId[state.modal] : null;
    if (!p) { root.innerHTML = ''; return; }
    var s = stockDe(p);
    var stockLine = s <= 0
      ? '<span class="stock-line">Sin stock por ahora — consúltanos por WhatsApp</span>'
      : '<span class="stock-line ok">Stock disponible: ' + s + '</span>';
    var accion = s <= 0
      ? '<a class="add-btn" style="padding:12px 22px;font-size:0.9rem;text-decoration:none" href="https://wa.me/' + WA + '?text=' + encodeURIComponent('Hola Gasomi, ¿tienen stock de ' + p.nombre + '?') + '" target="_blank" rel="noopener">Consultar por WhatsApp</a>'
      : '<div class="step"><button data-qty="-1">−</button><span id="m-qty">' + state.qty + '</span><button data-qty="1">+</button></div>' +
        '<button class="add-btn" data-add-modal="' + esc(p.id) + '" style="padding:12px 22px;font-size:0.9rem">Agregar al pedido</button>';
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
      mayorLine(p) +
      stockLine +
      '<div class="modal-acciones">' + accion + '</div>' +
      '</div></div></div>';
  }

  function setDrawer(open) {
    state.open = open;
    document.getElementById('overlay').className = open ? 'overlay on' : 'overlay';
    document.getElementById('drawer').className = open ? 'drawer on' : 'drawer';
  }
  function setFiltros(open) {
    var fEl = document.getElementById('filtros');
    if (!fEl) return;
    state.filtrosOpen = open;
    fEl.classList.toggle('open', open);
    if (window.innerWidth <= 960) document.getElementById('overlay').className = open ? 'overlay on' : 'overlay';
  }

  function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast on';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 2000);
  }
  window.__gasomiToast = toast;

  function mod(id, delta) {
    var p = byId[id];
    var actual = state.cart[id] || 0;
    var n = actual + delta;
    if (p && delta > 0 && n > stockDe(p)) {
      toast('Solo hay ' + stockDe(p) + ' en stock de este producto');
      n = stockDe(p);
    }
    if (n <= 0) { delete state.cart[id]; } else { state.cart[id] = n; }
    saveCart();
    renderCart();
  }

  /* ---------- Eventos ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-fcat],[data-fsub],#f-mas-marcas,#ver-mas,[data-add],[data-open],[data-inc],[data-dec],[data-del],[data-close],[data-qty],[data-add-modal],#cart-btn,#x-btn,#f-clear,#f-toggle');
    if (!t) return;
    if (t.dataset.fcat) { state.cat = t.dataset.fcat; state.sub = 'todas'; state.pageLim = PAGE; renderFiltros(); renderGrid(); return; }
    if (t.dataset.fsub) { state.sub = t.dataset.fsub; state.pageLim = PAGE; renderFiltros(); renderGrid(); return; }
    if (t.id === 'ver-mas') { state.pageLim = (state.pageLim || PAGE) + PAGE; renderGrid(); return; }
    if (t.id === 'f-mas-marcas') { state.masMarcas = !state.masMarcas; renderFiltros(); return; }
    if (t.id === 'f-clear') {
      state.cat = 'todos'; state.sub = 'todas'; state.marcas = {}; state.pmin = null; state.pmax = null; state.soloStock = false; state.q = '';
      document.getElementById('buscar').value = '';
      renderFiltros(); renderGrid(); return;
    }
    if (t.id === 'f-toggle') { setFiltros(!state.filtrosOpen); return; }
    if (t.dataset.add) {
      e.stopPropagation();
      mod(t.dataset.add, 1);
      var p = byId[t.dataset.add];
      var q = state.cart[t.dataset.add] || 0;
      if (p && tieneMayor(p) && q === p.mayor_desde) toast('¡Precio por mayor aplicado! ' + fmt(p.precio_mayor) + ' c/u');
      else toast('Agregado: ' + p.nombre);
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
      var mp = byId[state.modal] || (window.__GASOMI_PID ? byId[window.__GASOMI_PID] : null);
      var nq2 = Math.max(1, state.qty + parseInt(t.dataset.qty, 10));
      if (mp) nq2 = Math.min(nq2, Math.max(1, stockDe(mp)));
      state.qty = nq2;
      var mq = document.getElementById('m-qty');
      if (mq) mq.textContent = state.qty;
      return;
    }
    if (t.dataset.open) { location.href = '/tienda/p/' + t.dataset.open + '/'; return; }
    if (t.dataset.inc) { mod(t.dataset.inc, 1); return; }
    if (t.dataset.dec) { mod(t.dataset.dec, -1); return; }
    if (t.dataset.del) { mod(t.dataset.del, -(state.cart[t.dataset.del] || 0)); return; }
    if (t.dataset.close) { state.modal = null; renderModal(); setDrawer(false); return; }
    if (t.id === 'cart-btn') { setDrawer(true); return; }
    if (t.id === 'x-btn') { setDrawer(false); return; }
  });

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.dataset && t.dataset.fmarca) {
      if (t.checked) state.marcas[t.dataset.fmarca] = true; else delete state.marcas[t.dataset.fmarca];
      renderFiltros(); renderGrid(); return;
    }
    if (t.id === 'f-stock') { state.soloStock = t.checked; renderFiltros(); renderGrid(); return; }
    if (t.id === 'orden-sel') { state.orden = t.value; renderGrid(); return; }
  });

  document.addEventListener('input', function (e) {
    if (e.target.id === 'f-pmin') { state.pmin = e.target.value === '' ? null : parseFloat(e.target.value); renderGrid(); }
    if (e.target.id === 'f-pmax') { state.pmax = e.target.value === '' ? null : parseFloat(e.target.value); renderGrid(); }
  });

  var ovEl = document.getElementById('overlay');
  if (ovEl) ovEl.addEventListener('click', function () { setDrawer(false); setFiltros(false); });
  var buscarEl = document.getElementById('buscar');
  if (buscarEl) buscarEl.addEventListener('input', function (e) {
    state.q = e.target.value;
    state.pageLim = PAGE;
    if (state.q && !window.__GASOMI_CAT) { state.cat = 'todos'; state.sub = 'todas'; }
    renderFiltros();
    renderGrid();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { state.modal = null; renderModal(); setDrawer(false); setFiltros(false); }
  });

  function renderProducto() {
    var pid = window.__GASOMI_PID;
    if (!pid) return;
    var p = byId[pid];
    var el = function (id) { return document.getElementById(id); };
    if (!p) {
      if (el('p-nombre') && el('p-nombre').textContent === '…') el('p-nombre').textContent = 'Producto no encontrado';
      return;
    }
    var s0 = stockDe(p);
    if (el('p-nombre')) {
      el('p-nombre').textContent = p.nombre;
      document.title = p.nombre + ' — Ferretería Gasomi';
    }
    if (el('p-marca')) el('p-marca').textContent = p.marca;
    if (el('p-desc')) el('p-desc').textContent = p.descripcion;
    if (el('p-norma')) {
      el('p-norma').textContent = p.norma || '';
      el('p-norma').style.display = p.norma ? 'inline-block' : 'none';
    }
    if (el('p-crumb')) el('p-crumb').textContent = p.nombre.length > 40 ? p.nombre.slice(0, 40) + '…' : p.nombre;
    if (el('p-meta-cat')) {
      var cat0 = data.categorias.filter(function (c) { return c.slug === p.categoria; })[0];
      el('p-meta-cat').textContent = cat0 ? cat0.nombre : p.categoria;
    }
    if (el('p-meta-unidad')) el('p-meta-unidad').textContent = p.unidad;
    if (el('p-unidad')) el('p-unidad').textContent = p.unidad;
    if (el('p-visual') && p.imagen && !el('p-visual').querySelector('img')) {
      el('p-visual').innerHTML = '<img src="' + esc(imgSrc(p)) + '" alt="' + esc(p.nombre) + '" fetchpriority="high">';
    }
    if (el('p-add')) el('p-add').setAttribute('data-add-modal', p.id);
    if (el('p-precio')) el('p-precio').textContent = fmt(precio(p));
    if (el('p-mayor')) {
      el('p-mayor').innerHTML = mayorLine(p);
      el('p-mayor').style.display = tieneMayor(p) ? 'block' : 'none';
    }
    if (el('p-stock')) {
      el('p-stock').className = 'stock-line' + (s0 > 0 ? ' ok' : '');
      el('p-stock').textContent = s0 > 0 ? ('Stock disponible: ' + s0) : 'Sin stock por ahora — consúltanos por WhatsApp';
    }
    if (el('p-add')) {
      el('p-add').disabled = s0 <= 0;
      el('p-add').textContent = s0 <= 0 ? 'Agotado' : 'Agregar al pedido';
    }
    if (state.qty > Math.max(1, s0)) state.qty = Math.max(1, s0);
    if (el('m-qty')) el('m-qty').textContent = state.qty;
  }

  renderDeptos();
  renderFiltros();
  renderGrid();
  renderCart();
  renderProducto();

  // Hook para live.js: catálogo en vivo desde Supabase (precios/stock del CRM) y re-render total
  window.__gasomiApply = function (cats, prods) {
    if (cats && cats.length) data.categorias = cats;
    if (prods && prods.length) data.productos = prods;
    rebuild();
    if (state.modal && !byId[state.modal]) state.modal = null;
    renderDeptos(); renderFiltros(); renderGrid(); renderCart(); renderModal(); renderProducto();
  };
  // Hook para cuenta.js: re-render del carrito al activar canje o cambiar puntos
  window.__gasomiRefrescarCarrito = renderCart;
})();
