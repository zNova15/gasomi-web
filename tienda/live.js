/* Tienda EPP — sincronización en vivo con Supabase (catálogo, stock y precios del CRM /crm/).
   Si Supabase no está disponible, la tienda sigue funcionando con el catálogo local (productos.js). */
(function () {
  'use strict';
  if (!window.supabase || !window.supabase.createClient) return;

  var SB_URL = 'https://lggxsejjbhkymazgalzm.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnZ3hzZWpqYmhreW1hemdhbHptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MDAwMDAsImV4cCI6MjA5ODk3NjAwMH0.X3yg0OewAb1QoBk4HdeALWR33cv9WVJZIbzNKzUWCT4';
  var db = window.supabase.createClient(SB_URL, SB_KEY);
  window.__gasomiSB = db; // cliente compartido con cuenta.js

  function map(r) {
    return {
      id: r.id, nombre: r.nombre, categoria: r.categoria, subcategoria: r.subcategoria || '', marca: r.marca,
      descripcion: r.descripcion, norma: r.norma,
      precio: parseFloat(r.precio),
      precio_mayor: parseFloat(r.precio_mayor || 0),
      mayor_desde: parseInt(r.mayor_desde || 12, 10),
      stock: parseInt(r.stock != null ? r.stock : 99, 10),
      unidad: r.unidad, imagen: r.imagen || ''
    };
  }

  async function cargar() {
    try {
      var rc = await db.from('gasomi_categorias').select('*').order('orden');
      var rp = await db.from('gasomi_productos').select('*').eq('activo', true).order('orden').range(0, 4999);
      if (rp.data && rp.data.length && window.__gasomiApply) {
        window.__gasomiApply(rc.data || null, rp.data.map(map));
      }
    } catch (e) { /* la tienda sigue con el catálogo local */ }
  }

  cargar();

  // Realtime: precios y stock cambian en la tienda al instante (ediciones del CRM y pedidos de otros clientes)
  db.channel('gasomi-productos')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'gasomi_productos' }, function () { cargar(); })
    .subscribe();

  // Registrar el pedido en el CRM cuando el cliente lo envía por WhatsApp.
  // Si hay sesión de cliente, el pedido queda firmado (cliente_id) y suma puntos al ser atendido.
  document.addEventListener('click', async function (e) {
    var a = e.target.closest('#wa-btn');
    if (!a) return;
    try {
      var pedido = window.__gasomiPedidoActual;
      if (!pedido || !pedido.items.length) return;
      var uid = null;
      try {
        var s = await db.auth.getSession();
        uid = s.data.session ? s.data.session.user.id : null;
      } catch (e2) {}
      db.from('gasomi_pedidos').insert({
        items: pedido.items,
        total: pedido.total,
        nota: pedido.nota || '',
        cliente_id: uid
      }).then(function () {});
    } catch (err) { /* nunca bloquear el envío por WhatsApp */ }
  });
})();
