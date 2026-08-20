// Vercel Serverless Function — Búsqueda por foto.
// El cliente sube la foto de un producto (tornillo, casco, llave…), Claude la identifica
// (tipo, marca, modelo, medida) y la cruza contra el catálogo real de Gasomi para
// devolver coincidencias exactas y alternativas similares con stock y precio.
//
// Variables de entorno en Vercel:
//   ANTHROPIC_API_KEY    sk-ant-…  (obligatoria)
//   PAGOS_SECRETO        secreto compartido para el registro/limite en Supabase
//   GASOMI_VISION_MODEL  opcional, por defecto claude-sonnet-5

const crypto = require('crypto');

const SB_URL = 'https://lggxsejjbhkymazgalzm.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnZ3hzZWpqYmhreW1hemdhbHptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MDAwMDAsImV4cCI6MjA5ODk3NjAwMH0.X3yg0OewAb1QoBk4HdeALWR33cv9WVJZIbzNKzUWCT4';
const MODELO = process.env.GASOMI_VISION_MODEL || 'claude-sonnet-5';
const MAX_BYTES = 4 * 1024 * 1024;

async function sbGet(path) {
  const r = await fetch(SB_URL + '/rest/v1/' + path, {
    headers: { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON }
  });
  return r.ok ? r.json() : null;
}

async function rpc(fn, args) {
  const r = await fetch(SB_URL + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });
  const txt = await r.text();
  try { return { ok: r.ok, data: txt ? JSON.parse(txt) : null }; } catch (e) { return { ok: r.ok, data: txt }; }
}

const SISTEMA = `Eres el maestro ferretero de Gasomi Ingenieros (Cajamarca, Perú). Identificas productos de ferretería y seguridad industrial a partir de una foto y dices con precisión qué son.

Reglas:
- Identifica el TIPO de producto, la MARCA y el MODELO solo si los ves o los reconoces con seguridad. Si no estás seguro de la marca, déjala vacía; NUNCA inventes marcas ni códigos.
- Anota los atributos útiles para comprar: medida o diámetro, longitud, material, color, tipo de cabeza o rosca, norma, capacidad, etc.
- Usa vocabulario peruano de ferretería (perno, tarugo, calamina, tubo PVC, cinta aislante, esmeril, badana, cachimba).
- Del catálogo que te doy, elige en "exactos" solo los índices que sean EL MISMO producto (o su equivalente directo en otra marca del mismo tipo y medida). Si ninguno lo es, deja la lista vacía.
- En "similares" pon hasta 6 índices de productos que cumplan la misma función o sirvan de reemplazo, del más parecido al menos parecido.
- Usa SOLO índices que existan en la lista. Nunca inventes índices ni productos.
- Si la foto no es un producto de ferretería/seguridad (una persona, comida, un documento), pon es_ferreteria: false y explica en "nota" qué ves.

Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional, con esta forma:
{"producto":"nombre corto del producto","marca":"","modelo":"","atributos":["…"],"categoria":"","confianza":"alta|media|baja","es_ferreteria":true,"exactos":[1,2],"similares":[3,4,5],"nota":"una frase para el cliente"}`;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const t0 = Date.now();
  const secreto = process.env.PAGOS_SECRETO;
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'La búsqueda por foto todavía no está activada. Escríbenos por WhatsApp y te ayudamos al toque.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const origen = body.origen === 'crm' ? 'crm' : 'tienda';
    let imagen = body.imagen || '';
    const m = /^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/i.exec(imagen);
    if (!m) return res.status(400).json({ error: 'Envía una foto en formato JPG, PNG o WEBP.' });
    const mediaType = m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase();
    const datos = m[2];
    if (datos.length * 0.75 > MAX_BYTES) return res.status(413).json({ error: 'La foto pesa demasiado. Toma otra o recórtala.' });

    // Límite de uso por IP (la IP se guarda solo como huella, nunca en claro)
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'sin-ip';
    const ipHash = crypto.createHash('sha256').update(ip + '|' + (secreto || 'gasomi')).digest('hex').slice(0, 32);
    if (secreto && origen !== 'crm') {
      const permiso = await rpc('gasomi_busqueda_img_permiso', { p_secreto: secreto, p_ip_hash: ipHash });
      if (permiso.ok && permiso.data && permiso.data.permitido === false) {
        return res.status(429).json({ error: 'Hiciste muchas búsquedas por foto seguidas. Espera un rato o escríbenos por WhatsApp.' });
      }
    }

    // Catálogo activo (el mismo que ve el cliente)
    const prods = await sbGet('gasomi_productos?select=id,nombre,marca,categoria,subcategoria,precio,stock,unidad,imagen&activo=is.true&order=categoria.asc&limit=2000');
    if (!prods || !prods.length) return res.status(503).json({ error: 'No pudimos leer el catálogo. Intenta de nuevo.' });
    const lista = prods.map(function (p, i) {
      return i + '|' + p.nombre + (p.marca ? ' |' + p.marca : ' |') + '|' + (p.subcategoria || p.categoria);
    }).join('\n');

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 800,
        system: SISTEMA,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'CATÁLOGO DE GASOMI (índice|nombre|marca|subcategoría):\n' + lista, cache_control: { type: 'ephemeral' } },
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: datos } },
              { type: 'text', text: 'Identifica el producto de la foto y cruza con el catálogo. Responde solo el JSON.' }
            ]
          },
          { role: 'assistant', content: '{' }
        ]
      })
    });

    if (!r.ok) {
      const err = await r.text();
      const amable = r.status === 401 ? 'La búsqueda por foto no está bien configurada.' : 'La búsqueda por foto no está disponible en este momento.';
      return res.status(502).json({ error: amable + ' Escríbenos por WhatsApp y te ayudamos.', detalle: err.slice(0, 200) });
    }
    const data = await r.json();
    let txt = '{' + ((data.content && data.content[0] && data.content[0].text) || '');
    let out;
    try { out = JSON.parse(txt); }
    catch (e) {
      const j = txt.indexOf('{'), k = txt.lastIndexOf('}');
      try { out = JSON.parse(txt.slice(j, k + 1)); } catch (e2) { out = null; }
    }
    if (!out) return res.status(502).json({ error: 'No pudimos leer la respuesta. Intenta con otra foto.' });

    const limpiar = function (arr, max) {
      return (Array.isArray(arr) ? arr : [])
        .map(function (n) { return typeof n === 'number' ? n : parseInt(n, 10); })
        .filter(function (n) { return Number.isInteger(n) && n >= 0 && n < prods.length; })
        .filter(function (n, i, a) { return a.indexOf(n) === i; })
        .slice(0, max)
        .map(function (n) { return prods[n]; });
    };
    const exactos = limpiar(out.exactos, 4);
    const idsEx = exactos.map(function (p) { return p.id; });
    const similares = limpiar(out.similares, 6).filter(function (p) { return idsEx.indexOf(p.id) < 0; });

    const detectado = {
      producto: String(out.producto || '').slice(0, 120),
      marca: String(out.marca || '').slice(0, 60),
      modelo: String(out.modelo || '').slice(0, 60),
      atributos: (Array.isArray(out.atributos) ? out.atributos : []).slice(0, 6).map(function (a) { return String(a).slice(0, 60); }),
      categoria: String(out.categoria || '').slice(0, 60),
      confianza: ['alta', 'media', 'baja'].indexOf(out.confianza) >= 0 ? out.confianza : 'media',
      es_ferreteria: out.es_ferreteria !== false,
      nota: String(out.nota || '').slice(0, 300)
    };

    const ms = Date.now() - t0;
    if (secreto) {
      rpc('gasomi_busqueda_img_log', {
        p_secreto: secreto, p_origen: origen, p_ip_hash: ipHash, p_detectado: detectado,
        p_ids: exactos.concat(similares).map(function (p) { return p.id; }), p_modelo: MODELO, p_ms: ms
      }).catch(function () {});
    }

    return res.status(200).json({ ok: true, detectado: detectado, exactos: exactos, similares: similares, ms: ms });
  } catch (e) {
    return res.status(500).json({ error: 'Error interno: ' + (e && e.message ? e.message : e) });
  }
};
