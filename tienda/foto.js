/* Búsqueda por foto — componente compartido por la tienda y el CRM.
   Uso:  GasomiFoto.abrir({ origen: 'tienda'|'crm', onElegir: fn(producto)|null })
   Sin onElegir, las tarjetas usan data-add/data-open de la tienda. */
(function () {
  'use strict';
  var MAX_LADO = 1000;
  var st = { abierto: false, archivo: null, dataUrl: null, opts: {} };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n) { return 'S/ ' + Number(n || 0).toFixed(2); }
  function imgSrc(p) {
    if (!p.imagen) return '';
    return p.imagen.indexOf('http') === 0 ? p.imagen : '/tienda/' + p.imagen;
  }

  /* ---------- Modal ---------- */
  function crear() {
    if ($('gf-wrap')) return;
    var d = document.createElement('div');
    d.className = 'gf-wrap';
    d.id = 'gf-wrap';
    d.innerHTML =
      '<div class="gf-overlay" data-gf-close></div>' +
      '<div class="gf-modal" role="dialog" aria-modal="true" aria-labelledby="gf-titulo">' +
        '<div class="gf-head">' +
          '<div><h3 id="gf-titulo">Buscar por foto</h3><p class="gf-sub">Sube o toma la foto y te decimos qué es y si lo tenemos</p></div>' +
          '<button class="gf-x" data-gf-close aria-label="Cerrar">✕</button>' +
        '</div>' +
        '<div class="gf-body" id="gf-body"></div>' +
      '</div>';
    document.body.appendChild(d);
    d.addEventListener('click', onClick);
    d.addEventListener('change', onChange);
    d.addEventListener('dragover', function (e) { e.preventDefault(); var z = $('gf-zona'); if (z) z.classList.add('drag'); });
    d.addEventListener('dragleave', function () { var z = $('gf-zona'); if (z) z.classList.remove('drag'); });
    d.addEventListener('drop', function (e) {
      e.preventDefault();
      var z = $('gf-zona'); if (z) z.classList.remove('drag');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) tomarArchivo(e.dataTransfer.files[0]);
    });
  }

  function abrir(opts) {
    crear();
    st.opts = opts || {};
    st.abierto = true;
    st.archivo = null; st.dataUrl = null;
    $('gf-wrap').classList.add('on');
    document.body.style.overflow = 'hidden';
    pintarInicio();
    document.addEventListener('keydown', onEsc);
    document.addEventListener('paste', onPaste);
  }
  function cerrar() {
    st.abierto = false;
    var w = $('gf-wrap');
    if (w) w.classList.remove('on');
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onEsc);
    document.removeEventListener('paste', onPaste);
  }
  function onEsc(e) { if (e.key === 'Escape') cerrar(); }
  function onPaste(e) {
    if (!st.abierto || !e.clipboardData) return;
    var items = e.clipboardData.items || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image/') === 0) {
        var f = items[i].getAsFile();
        if (f) { tomarArchivo(f); e.preventDefault(); return; }
      }
    }
  }

  /* ---------- Pantallas ---------- */
  function pintarInicio(msg) {
    $('gf-body').innerHTML =
      (msg ? '<div class="gf-error">' + esc(msg) + '</div>' : '') +
      '<div class="gf-zona" id="gf-zona">' +
        '<div class="gf-lente">📷</div>' +
        '<b>Arrastra la foto aquí</b>' +
        '<span class="gf-sub">o elige una opción · también puedes pegarla con Ctrl+V</span>' +
        '<div class="gf-btns">' +
          '<label class="gf-btn gf-btn-oro">Tomar foto<input type="file" id="gf-camara" accept="image/*" capture="environment" hidden></label>' +
          '<label class="gf-btn">Subir de galería<input type="file" id="gf-archivo" accept="image/*" hidden></label>' +
        '</div>' +
      '</div>' +
      '<p class="gf-tip">💡 Tip: acerca la foto al producto y que se vea la marca o el código; así lo reconocemos mejor.</p>';
  }

  function pintarPreview() {
    $('gf-body').innerHTML =
      '<div class="gf-prev-grid">' +
        '<img src="' + st.dataUrl + '" alt="Foto del producto" class="gf-prev">' +
        '<div>' +
          '<b>¿Se ve bien el producto?</b>' +
          '<p class="gf-sub">Si está borrosa o muy lejos, toma otra: mientras mejor se vea, mejor lo identificamos.</p>' +
          '<div class="gf-btns">' +
            '<button class="gf-btn gf-btn-oro" data-gf-buscar>Buscar este producto</button>' +
            '<button class="gf-btn" data-gf-otra>Cambiar foto</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function pintarCargando() {
    $('gf-body').innerHTML =
      '<div class="gf-cargando">' +
        '<img src="' + st.dataUrl + '" alt="" class="gf-prev gf-prev-sm">' +
        '<div class="gf-barra"><span></span></div>' +
        '<b id="gf-paso">Analizando la foto…</b>' +
        '<span class="gf-sub">Identificamos el producto y lo buscamos en nuestro catálogo</span>' +
      '</div>';
    var pasos = ['Analizando la foto…', 'Reconociendo marca y medidas…', 'Buscando en el catálogo de Gasomi…'];
    var i = 0;
    st.timer = setInterval(function () {
      i++;
      var el = $('gf-paso');
      if (!el) return clearInterval(st.timer);
      el.textContent = pasos[Math.min(i, pasos.length - 1)];
    }, 2200);
  }

  function tarjeta(p, elegible) {
    var s = Number(p.stock || 0);
    var agotado = s <= 0;
    var img = imgSrc(p);
    var accion = elegible
      ? '<button class="gf-btn gf-btn-oro gf-mini" data-gf-elegir="' + esc(p.id) + '">Elegir</button>'
      : (agotado
        ? '<a class="gf-btn gf-mini" href="https://wa.me/51958682246?text=' + encodeURIComponent('Hola Gasomi, ¿cuándo tendrán ' + p.nombre + '?') + '" target="_blank" rel="noopener">Consultar</a>'
        : '<button class="gf-btn gf-btn-oro gf-mini" data-add="' + esc(p.id) + '">+ Agregar</button>');
    return '<div class="gf-card' + (agotado ? ' agotado' : '') + '">' +
      (img ? '<img src="' + esc(img) + '" alt="' + esc(p.nombre) + '" loading="lazy">' : '<div class="gf-noimg">·</div>') +
      '<div class="gf-card-info">' +
        (p.marca ? '<span class="gf-marca">' + esc(p.marca) + '</span>' : '') +
        '<a class="gf-nombre" href="/tienda/p/' + encodeURIComponent(p.id) + '/">' + esc(p.nombre) + '</a>' +
        '<div class="gf-precio-row"><b>' + fmt(p.precio) + '</b>' +
          '<span class="gf-stock' + (agotado ? ' rojo' : '') + '">' + (agotado ? 'Sin stock' : s + ' ' + esc(p.unidad || 'und')) + '</span>' +
        '</div>' +
      '</div>' + accion + '</div>';
  }

  function pintarResultados(r) {
    var d = r.detectado || {};
    var elegible = !!st.opts.onElegir;
    var wa = 'https://wa.me/51958682246?text=' + encodeURIComponent(
      'Hola Gasomi, busco este producto: ' + (d.producto || '') + (d.marca ? ' marca ' + d.marca : '') +
      (d.atributos && d.atributos.length ? ' (' + d.atributos.join(', ') + ')' : '') + '. ¿Lo tienen?');

    if (!d.es_ferreteria) {
      $('gf-body').innerHTML =
        '<div class="gf-detectado alerta"><b>No parece un producto de ferretería</b>' +
        '<p class="gf-sub">' + esc(d.nota || 'Prueba con una foto del producto que buscas.') + '</p></div>' +
        '<div class="gf-btns"><button class="gf-btn gf-btn-oro" data-gf-otra>Probar con otra foto</button></div>';
      return;
    }

    var chips = (d.atributos || []).map(function (a) { return '<span class="gf-chip">' + esc(a) + '</span>'; }).join('');
    var titulo = (d.marca ? d.marca + ' ' : '') + (d.producto || 'Producto') + (d.modelo ? ' ' + d.modelo : '');
    var conf = d.confianza === 'alta' ? '' : '<span class="gf-conf">Identificación ' + esc(d.confianza) + '</span>';

    var html =
      '<div class="gf-detectado">' +
        '<img src="' + st.dataUrl + '" alt="" class="gf-prev-mini">' +
        '<div><span class="gf-label">Detectamos</span>' +
          '<b>' + esc(titulo) + '</b>' + conf +
          (chips ? '<div class="gf-chips">' + chips + '</div>' : '') +
          (d.nota ? '<p class="gf-sub">' + esc(d.nota) + '</p>' : '') +
        '</div>' +
      '</div>';

    var hayEx = !!(r.exactos && r.exactos.length);
    var haySim = !!(r.similares && r.similares.length);
    if (hayEx) {
      html += '<div class="gf-sec"><span class="gf-sec-t ok">✓ Sí lo tenemos</span></div>' +
        '<div class="gf-grid">' + r.exactos.map(function (p) { return tarjeta(p, elegible); }).join('') + '</div>';
    } else if (haySim) {
      html += '<div class="gf-sec"><span class="gf-sec-t">No lo tenemos igualito, pero mira estas opciones</span></div>';
    }
    if (haySim) {
      html += (hayEx ? '<div class="gf-sec"><span class="gf-sec-t">También te puede servir</span></div>' : '') +
        '<div class="gf-grid">' + r.similares.map(function (p) { return tarjeta(p, elegible); }).join('') + '</div>';
    }
    if (!hayEx && !haySim) {
      html += '<div class="gf-vacio">No tenemos este producto en el catálogo todavía. Escríbenos y te lo conseguimos.</div>';
    }
    html += '<div class="gf-pie">' +
      '<a class="gf-btn gf-wa" href="' + wa + '" target="_blank" rel="noopener">Preguntar por WhatsApp</a>' +
      '<button class="gf-btn" data-gf-otra>Buscar otra foto</button></div>';
    $('gf-body').innerHTML = html;
  }

  /* ---------- Foto ---------- */
  function tomarArchivo(file) {
    if (!file || file.type.indexOf('image/') !== 0) return pintarInicio('Ese archivo no es una imagen.');
    var fr = new FileReader();
    fr.onload = function () {
      var img = new Image();
      img.onload = function () {
        var w = img.width, h = img.height;
        var esc_ = Math.min(1, MAX_LADO / Math.max(w, h));
        var cv = document.createElement('canvas');
        cv.width = Math.round(w * esc_); cv.height = Math.round(h * esc_);
        try {
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          st.dataUrl = cv.toDataURL('image/jpeg', 0.82);
        } catch (e) { return pintarInicio('No pudimos leer esa foto. Intenta con otra.'); }
        st.archivo = file;
        pintarPreview();
      };
      img.onerror = function () {
        pintarInicio('No pudimos abrir esa foto. Si es de iPhone (HEIC), tómala de nuevo con la cámara.');
      };
      img.src = fr.result;
    };
    fr.onerror = function () { pintarInicio('No pudimos leer el archivo.'); };
    fr.readAsDataURL(file);
  }

  async function buscar() {
    if (!st.dataUrl) return;
    pintarCargando();
    try {
      var r = await fetch('/api/buscar-imagen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagen: st.dataUrl, origen: st.opts.origen || 'tienda' })
      });
      clearInterval(st.timer);
      var d = await r.json().catch(function () { return {}; });
      if (!r.ok || !d.ok) return pintarInicio(d.error || 'No pudimos analizar la foto. Intenta de nuevo.');
      pintarResultados(d);
    } catch (e) {
      clearInterval(st.timer);
      pintarInicio('Sin conexión. Revisa tu internet e intenta de nuevo.');
    }
  }

  /* ---------- Eventos ---------- */
  function onChange(e) {
    if (e.target.id === 'gf-camara' || e.target.id === 'gf-archivo') {
      if (e.target.files && e.target.files[0]) tomarArchivo(e.target.files[0]);
    }
  }
  function onClick(e) {
    var t = e.target.closest('[data-gf-close],[data-gf-buscar],[data-gf-otra],[data-gf-elegir],[data-add]');
    if (!t) return;
    if (t.hasAttribute('data-gf-close')) return cerrar();
    if (t.hasAttribute('data-gf-buscar')) return buscar();
    if (t.hasAttribute('data-gf-otra')) { st.dataUrl = null; return pintarInicio(); }
    if (t.dataset.gfElegir && st.opts.onElegir) {
      st.opts.onElegir(t.dataset.gfElegir);
      return cerrar();
    }
    if (t.dataset.add && !st.opts.onElegir) {
      // lo agrega app.js; cerramos para que el cliente vea su carrito
      setTimeout(cerrar, 250);
    }
  }

  window.GasomiFoto = { abrir: abrir, cerrar: cerrar };

  // Botón del buscador de la tienda
  document.addEventListener('click', function (e) {
    var b = e.target.closest('#foto-btn,[data-foto-abrir]');
    if (b) { e.preventDefault(); abrir({ origen: b.dataset.fotoOrigen || 'tienda' }); }
  });
})();
