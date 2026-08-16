// Vercel Serverless Function — cobra con Culqi (Yape / tarjeta) y confirma el pedido en Supabase.
// El monto SIEMPRE se lee de la base de datos (nunca del navegador). La confirmación va por RPC
// protegida con un secreto compartido (env PAGOS_SECRETO), sin exponer llaves de Supabase.
//
// Variables de entorno en Vercel (Settings → Environment Variables → Production):
//   PAGOS_SECRETO       secreto compartido (tabla gasomi_secretos, clave 'pagos_backend')
//   CULQI_SECRET_KEY    sk_test_… / sk_live_… (cuando Gasomi active Culqi)
//   PAGOS_DEMO          "1" = modo demostración (aprueba tokens 'demo_ok', rechaza 'demo_rechazado')

const SB_URL = 'https://lggxsejjbhkymazgalzm.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnZ3hzZWpqYmhreW1hemdhbHptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MDAwMDAsImV4cCI6MjA5ODk3NjAwMH0.X3yg0OewAb1QoBk4HdeALWR33cv9WVJZIbzNKzUWCT4';

async function rpc(fn, args) {
  const r = await fetch(SB_URL + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });
  const txt = await r.text();
  let data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
  return { ok: r.ok, status: r.status, data };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  const secreto = process.env.PAGOS_SECRETO;
  if (!secreto) return res.status(500).json({ error: 'Servidor sin configurar (PAGOS_SECRETO)' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { pedido_id, token, metodo, email } = body;
    if (!pedido_id || !token) return res.status(400).json({ error: 'Faltan datos (pedido_id, token)' });

    // 1) Pedido y monto desde la BD
    const q = await rpc('gasomi_pedido_para_pago', { p_secreto: secreto, p_pedido_id: Number(pedido_id) });
    const ped = q.ok ? q.data : null;
    if (!ped) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (ped.pago_estado === 'pagado') return res.status(200).json({ ok: true, ya_pagado: true, pedido_id: ped.id, referencia: '' });
    if (ped.estado === 'anulado') return res.status(400).json({ error: 'El pedido está anulado' });
    const montoCent = Math.round(Number(ped.total) * 100);
    if (montoCent < 100) return res.status(400).json({ error: 'Monto inválido' });

    // 2) Cobro
    let referencia = '', detalle = {}, pasarela = 'culqi', aprobado = false, motivo = '';
    if (String(token).startsWith('demo_')) {
      if (process.env.PAGOS_DEMO !== '1') return res.status(400).json({ error: 'Modo demo desactivado' });
      pasarela = 'demo';
      aprobado = token !== 'demo_rechazado';
      referencia = 'DEMO-' + String(ped.id).padStart(5, '0') + '-' + Date.now().toString(36).toUpperCase();
      detalle = { demo: true, metodo };
      motivo = aprobado ? '' : 'Pago rechazado (demostración)';
    } else {
      if (!process.env.CULQI_SECRET_KEY) return res.status(500).json({ error: 'Pasarela no configurada (CULQI_SECRET_KEY)' });
      const r = await fetch('https://api.culqi.com/v2/charges', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + process.env.CULQI_SECRET_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: montoCent, currency_code: 'PEN',
          email: email || ped.cliente_email || 'cliente@gasomi-ingenieros.cloud',
          source_id: token,
          description: 'Pedido #' + ped.id + ' — Ferretería Gasomi',
          metadata: { pedido_id: String(ped.id), metodo: metodo || '' }
        })
      });
      const data = await r.json().catch(() => ({}));
      detalle = data; referencia = (data && data.id) || '';
      aprobado = r.ok && !!data && !!data.id && (!data.outcome || data.outcome.type === 'venta_exitosa');
      if (!aprobado) motivo = (data && (data.user_message || data.merchant_message || (data.outcome && data.outcome.user_message))) || 'Pago no aprobado';
    }

    // 3) Registrar + confirmar (RPC con secreto)
    const c = await rpc('gasomi_confirmar_pago', {
      p_secreto: secreto, p_pedido_id: Number(ped.id), p_pasarela: pasarela, p_metodo: metodo || 'tarjeta',
      p_referencia: referencia, p_estado: aprobado ? 'pagado' : 'rechazado', p_detalle: detalle
    });
    if (!aprobado) return res.status(402).json({ error: motivo || 'Pago rechazado' });
    if (!c.ok) return res.status(500).json({ error: 'Pago aprobado pero no se pudo registrar; contáctanos con la referencia ' + referencia });
    return res.status(200).json({ ok: true, pedido_id: ped.id, referencia, pasarela });
  } catch (e) {
    return res.status(500).json({ error: 'Error interno: ' + (e && e.message ? e.message : e) });
  }
};
