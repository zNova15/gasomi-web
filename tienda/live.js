/* Tienda EPP — sincronización en vivo con Supabase (precios editados desde el CRM /crm/).
   Si Supabase no está disponible, la tienda sigue funcionando con el catálogo local (productos.js). */
(function () {
  'use strict';
  if (!window.supabase || !window.supabase.createClient) return;

  var SB_URL = 'https://lggxsejjbhkymazgalzm.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnZ3hzZWpqYmhreW1hemdhbHptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MDAwMDAsImV4cCI6MjA5ODk3NjAwMH0.X3yg0OewAb1QoBk4HdeALWR33cv9WVJZIbzNKzUWCT4';
  var db = window.supabase.createClient(SB_URL, SB_KEY);

  function map(r) {
    return {
      id: r.id, nombre: r.nombre, categoria: r.categoria, marca: r.marca,
      descripcion: r.descripcion, norma: r.norma, precio: parseFloat(r.precio),
      unidad: r.unidad, imagen: r.imagen || ''
    };
  }

  async function cargar() {
    try {
      var rc = await db.from('gasomi_categorias').select('*').order('orden');
      var rp = await db.from('gasomi_productos').select('*').eq('activo', true).order('orden');
      if (rp.data && rp.data.length && window.__gasomiApply) {
        window.__gasomiApply(rc.data || null, rp.data.map(map));
      }
    } catch (e) { /* la tienda sigue con el catálogo local */ }
  }

  cargar();

  // Realtime: si cambian un precio en el CRM, la tienda lo refleja al instante sin recargar
  db.channel('gasomi-productos')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'gasomi_productos' }, function () { cargar(); })
    .subscribe();

  // Registrar el pedido en el CRM cuando el cliente lo envía por WhatsApp
  document.addEventListener('click', function (e) {
    var a = e.target.closest('#wa-btn');
    if (!a) return;
    try {
      var cart = JSON.parse(localStorage.getItem('gasomi_epp_cart_v1') || '{}');
      var cat = window.GASOMI_CATALOGO || { productos: [] };
      var items = [], total = 0;
      cat.productos.forEach(function (p) {
        var q = cart[p.id];
        if (!q) return;
        var pr = p.precio != null ? p.precio : p.precio_ref_soles;
        var sub = pr * q;
        total += sub;
        items.push({ id: p.id, nombre: p.nombre, qty: q, precio: pr, subtotal: +sub.toFixed(2) });
      });
      if (!items.length) return;
      fetch(SB_URL + '/rest/v1/gasomi_pedidos', {
        method: 'POST',
        keepalive: true,
        headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ items: items, total: +total.toFixed(2) })
      });
    } catch (err) { /* nunca bloquear el envío por WhatsApp */ }
  });
})();
