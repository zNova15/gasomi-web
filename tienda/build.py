#!/usr/bin/env python3
"""Generador de páginas estáticas de la Tienda EPP Gasomi.

Lee productos.js y genera:
  - p/<id>/index.html   (ficha de cada producto, con JSON-LD Product)
  - c/<slug>/index.html (página de cada categoría, con el catálogo presetado)
  - ../sitemap.xml      (todas las URLs)

Ejecutar desde tienda/ cada vez que cambie el catálogo base:  python3 build.py
(Los precios/stock en vivo siguen viniendo de Supabase vía live.js.)
"""
import json, os, re, html

BASE = 'https://gasomi-web.vercel.app'
raw = open('productos.js').read()
data = json.loads(raw[raw.index('{'):raw.rindex(';')])
CATS = {c['slug']: c for c in data['categorias']}
PRODUCTOS = data['productos']

def esc(s):
    return html.escape(str(s), quote=True)

def precio(p):
    return p.get('precio_ref_soles', p.get('precio', 0))

def trim(s, n):
    s = re.sub(r'\s+', ' ', s).strip()
    return s if len(s) <= n else s[:n - 1].rsplit(' ', 1)[0] + '…'

def head(titulo, desc, canonical, ogimg, jsonld):
    return f'''<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{esc(titulo)}</title>
    <meta name="description" content="{esc(desc)}">
    <link rel="canonical" href="{canonical}">
    <meta property="og:title" content="{esc(titulo)}">
    <meta property="og:description" content="{esc(desc)}">
    <meta property="og:type" content="website">
    <meta property="og:locale" content="es_PE">
    <meta property="og:url" content="{canonical}">
    <meta property="og:image" content="{ogimg}">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="icon" type="image/png" href="/tienda/logo-gasomi.png">
    <link rel="preload" as="image" href="/tienda/logo-gasomi.png" fetchpriority="high">
    <link rel="preconnect" href="https://cdn.jsdelivr.net">
    <link rel="stylesheet" href="/tienda/tienda.min.css?v=6">
    <script type="application/ld+json">{json.dumps(jsonld, ensure_ascii=False)}</script>
</head>'''

NAV = '''<body>
    <a class="skip-link" href="#contenido">Saltar al contenido</a>
    <div class="topbar">
        <div class="topbar-inner">
            <span><b>Entrega en obra</b> en Cajamarca y alrededores</span>
            <span><b>Factura electrónica</b> · RUC 20600097726</span>
            <span><b>Atención B2B</b> para constructoras y contratistas</span>
        </div>
    </div>
    <nav class="nav">
        <div class="nav-inner">
            <a href="/tienda/" class="brand">
                <div class="brand-mark"><img src="/tienda/logo-gasomi.png" alt="Logo Gasomi Ingenieros E.I.R.L." width="400" height="358" fetchpriority="high"></div>
                <div>
                    <div class="brand-name">GASOMI INGENIEROS</div>
                    <div class="brand-sub">Tienda de Seguridad Industrial · EPP</div>
                </div>
            </a>
            <div class="nav-actions" style="margin-left:auto">
                <a href="/tienda/#b2b" class="nav-link">Compra por volumen</a>
                <button class="cuenta-btn" id="cuenta-btn">Mi cuenta</button>
                <button class="cart-btn" id="cart-btn">Pedido <span class="cart-count" id="cart-count">0</span></button>
            </div>
        </div>
    </nav>'''

COMUNES = '''    <div class="overlay" id="overlay"></div>
    <aside class="drawer" id="drawer">
        <div class="drawer-head">
            <h3>Tu pedido</h3>
            <button class="x-btn" id="x-btn">✕</button>
        </div>
        <div class="drawer-items">
            <div class="d-empty" id="d-empty">Tu pedido está vacío.<br>Agrega productos del catálogo para armar tu cotización.</div>
            <div id="d-items"></div>
        </div>
        <div class="drawer-foot">
            <label class="canje-box" id="canje-box">
                <input type="checkbox" id="canje-check">
                <span>Canjear mis <b id="canje-pts">0</b> puntos: <b id="canje-desc">−S/ 0.00</b> de descuento</span>
            </label>
            <div class="desc-row" id="desc-row" style="display:none">
                <span>Descuento por puntos</span>
                <span id="desc-n">−S/ 0.00</span>
            </div>
            <div class="total-row">
                <span class="total-l">Total referencial</span>
                <span class="total-n" id="total-n">S/ 0.00</span>
            </div>
            <div class="total-nota">Confirmamos stock, tallas y precio final en la proforma.</div>
            <a class="wa-btn" id="wa-btn" href="https://wa.me/51958682246" target="_blank" rel="noopener">Enviar pedido por WhatsApp</a>
        </div>
    </aside>
    <div id="modal-root"></div>
    <div class="cuenta-wrap" id="cuenta-wrap">
        <div class="overlay on" id="cuenta-overlay"></div>
        <div class="cuenta-modal">
            <div class="cuenta-head">
                <h3 id="cuenta-title">Mi cuenta</h3>
                <button class="x-btn" id="cuenta-close">✕</button>
            </div>
            <div class="cuenta-body" id="cuenta-body"></div>
        </div>
    </div>
    <div class="toast" id="toast"></div>'''

def footer(extra_js=''):
    return f'''    <footer class="footer">
        <div class="footer-base" style="border-top:none;margin-top:0">
            <span>© 2026 Gasomi Ingenieros E.I.R.L. · RUC 20600097726 · <a href="/privacidad.html">Privacidad</a></span>
            <span>Precios referenciales inc. IGV · Stock sujeto a confirmación</span>
        </div>
    </footer>
{COMUNES}
    <script>{extra_js}</script>
    <script src="/tienda/productos.min.js?v=6" defer></script>
    <script src="/tienda/app.min.js?v=6" defer></script>
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/dist/umd/supabase.min.js" integrity="sha384-l8ah+VgaWtk1mvOe9VC+OirC6qHFF4yH7l7mKRidV9MSti3E9F463bMp6ZVN4kuC" crossorigin="anonymous" defer></script>
    <script src="/tienda/live.min.js?v=6" defer></script>
    <script src="/tienda/cuenta.min.js?v=6" defer></script>
</body>
</html>
'''

def crumbs(items):
    partes = ['<a href="/tienda/">Tienda EPP</a>']
    for texto, url in items:
        partes.append('<span class="sep">›</span>')
        partes.append(f'<a href="{url}">{esc(texto)}</a>' if url else f'<span>{esc(texto)}</span>')
    return f'<nav class="crumbs" aria-label="Ruta de navegación">{"".join(partes)}</nav>'

# ---------- Fichas de producto ----------
for p in PRODUCTOS:
    cat = CATS[p['categoria']]
    url = f'{BASE}/tienda/p/{p["id"]}/'
    img_abs = f'{BASE}/tienda/{p["imagen"]}' if p.get('imagen') else f'{BASE}/og-gasomi.jpg'
    titulo = trim(f'{p["nombre"]} — Tienda EPP Gasomi', 60)
    desc = trim(f'{p["descripcion"]} Precio referencial S/ {precio(p):.2f} ({p["unidad"]}). Entrega en obra en Cajamarca.', 158)

    jsonld = [{
        "@context": "https://schema.org",
        "@type": "Product",
        "name": p['nombre'],
        "description": trim(p['descripcion'], 300),
        "image": img_abs,
        "brand": {"@type": "Brand", "name": p['marca']},
        "url": url,
        "offers": {
            "@type": "Offer",
            "priceCurrency": "PEN",
            "price": f'{precio(p):.2f}',
            "availability": "https://schema.org/InStock",
            "url": url,
            "seller": {"@type": "Organization", "name": "Gasomi Ingenieros E.I.R.L."}
        }
    }, {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Tienda EPP", "item": f"{BASE}/tienda/"},
            {"@type": "ListItem", "position": 2, "name": cat['nombre'], "item": f"{BASE}/tienda/c/{cat['slug']}/"},
            {"@type": "ListItem", "position": 3, "name": p['nombre'], "item": url}
        ]
    }]

    rel = [r for r in PRODUCTOS if r['categoria'] == p['categoria'] and r['id'] != p['id']][:3]
    rel_html = ''.join(
        f'''<a class="rel-card" href="/tienda/p/{r["id"]}/">
            <img src="/tienda/{r["imagen"]}" alt="{esc(r["nombre"])}" loading="lazy" width="400" height="300">
            <div class="rel-body"><div class="rel-nombre">{esc(r["nombre"])}</div>
            <div class="rel-precio">S/ {precio(r):.2f}</div></div>
        </a>''' for r in rel if r.get('imagen'))

    img_tag = (f'<img src="/tienda/{p["imagen"]}" alt="{esc(p["nombre"])}" width="800" height="800" fetchpriority="high">'
               if p.get('imagen') else '<div class="ph-mono" style="font-size:6rem">' + esc(p['nombre'][0]) + '</div>')
    norma_html = f'<span class="norma">{esc(p["norma"])}</span>' if p.get('norma') else ''

    cuerpo = f'''{head(titulo, desc, url, img_abs, jsonld)}
{NAV}
    {crumbs([(cat['nombre'], f'/tienda/c/{cat["slug"]}/'), (trim(p['nombre'], 40), None)])}
    <main id="contenido" class="prod-page">
        <div class="prod-grid">
            <div class="p-visual">{img_tag}</div>
            <div class="p-info">
                <span class="card-marca">{esc(p['marca'])}</span>
                <h1>{esc(p['nombre'])}</h1>
                {norma_html}
                <p class="p-desc">{esc(p['descripcion'])}</p>
                <div class="p-precio-row">
                    <span class="p-precio" id="p-precio">S/ {precio(p):.2f}</span>
                    <span class="unidad">{esc(p['unidad'])}</span>
                </div>
                <div id="p-mayor"></div>
                <span class="stock-line" id="p-stock"></span>
                <div class="p-acciones">
                    <div class="step"><button data-qty="-1" aria-label="Menos cantidad">−</button><span id="m-qty">1</span><button data-qty="1" aria-label="Más cantidad">+</button></div>
                    <button class="add-btn" id="p-add" data-add-modal="{p['id']}" style="padding:13px 26px;font-size:0.92rem">Agregar al pedido</button>
                    <a class="btn-ghost" style="color:var(--primary);border-color:var(--line);padding:12px 20px" href="https://wa.me/51958682246?text={esc('Hola Gasomi, tengo una consulta sobre: ' + p['nombre'])}" target="_blank" rel="noopener">Consultar</a>
                </div>
                <div class="p-meta">
                    <span><b>Categoría:</b> {esc(cat['nombre'])}</span>
                    <span><b>Unidad de venta:</b> {esc(p['unidad'])}</span>
                    <span><b>Entrega:</b> en obra en Cajamarca y alrededores, o recojo en Jr. Puyllucana N° 391, Baños del Inca</span>
                </div>
            </div>
        </div>
    </main>
    <section class="relacionados">
        <h2>También en {esc(cat['nombre'])}</h2>
        <div class="rel-grid">{rel_html}</div>
    </section>
{footer(f'window.__GASOMI_PID = {json.dumps(p["id"])};')}'''

    os.makedirs(f'p/{p["id"]}', exist_ok=True)
    open(f'p/{p["id"]}/index.html', 'w').write(cuerpo)

# ---------- Páginas de categoría ----------
for cat in data['categorias']:
    prods = [p for p in PRODUCTOS if p['categoria'] == cat['slug']]
    url = f'{BASE}/tienda/c/{cat["slug"]}/'
    titulo = trim(f'{cat["nombre"]} en Cajamarca — Gasomi', 60)
    desc = trim(cat['descripcion'] + ' Precios en soles y entrega en obra en Cajamarca.', 158)

    jsonld = [{
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Tienda EPP", "item": f"{BASE}/tienda/"},
            {"@type": "ListItem", "position": 2, "name": cat['nombre'], "item": url}
        ]
    }]

    enlaces = ''.join(f'<li><a href="/tienda/p/{p["id"]}/">{esc(p["nombre"])}</a></li>' for p in prods)

    cuerpo = f'''{head(titulo, desc, url, f'{BASE}/og-gasomi.jpg', jsonld)}
{NAV}
    {crumbs([(cat['nombre'], None)])}
    <main id="contenido">
        <div class="cat-intro">
            <span class="sec-label">Categoría</span>
            <h1>{esc(cat['nombre'])}</h1>
            <p>{esc(cat['descripcion'])}</p>
        </div>
        <section class="catalogo" id="catalogo" style="padding-top:26px">
            <div class="wrap">
                <div class="cat-layout">
                    <aside class="filtros" id="filtros"></aside>
                    <div class="cat-main">
                        <div class="cat-toolbar">
                            <button class="f-toggle" id="f-toggle">Filtros</button>
                            <span class="cat-count" id="cat-count"></span>
                            <label class="orden-label" for="orden-sel">Ordenar:</label>
                            <select class="orden-sel" id="orden-sel">
                                <option value="relevancia">Relevancia</option>
                                <option value="precio-asc">Precio: menor a mayor</option>
                                <option value="precio-desc">Precio: mayor a menor</option>
                                <option value="stock">Mayor stock</option>
                            </select>
                        </div>
                        <div class="grid" id="grid"></div>
                        <div class="sin-result" id="sin-result" style="display:none">No encontramos productos con esos filtros. Escríbenos por WhatsApp y lo conseguimos.</div>
                    </div>
                </div>
            </div>
        </section>
        <noscript><ul>{enlaces}</ul></noscript>
    </main>
{footer(f'window.__GASOMI_CAT = {json.dumps(cat["slug"])};')}'''

    os.makedirs(f'c/{cat["slug"]}', exist_ok=True)
    open(f'c/{cat["slug"]}/index.html', 'w').write(cuerpo)

# ---------- Sitemap ----------
urls = [f'{BASE}/', f'{BASE}/tienda/', f'{BASE}/privacidad.html']
urls += [f'{BASE}/tienda/c/{c["slug"]}/' for c in data['categorias']]
urls += [f'{BASE}/tienda/p/{p["id"]}/' for p in PRODUCTOS]
sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
for u in urls:
    pr = '1.0' if u.endswith('/tienda/') else ('0.8' if '/p/' in u or '/c/' in u else '0.5')
    sm.append(f'  <url><loc>{u}</loc><changefreq>weekly</changefreq><priority>{pr}</priority></url>')
sm.append('</urlset>')
open('../sitemap.xml', 'w').write('\n'.join(sm) + '\n')

print(f'{len(PRODUCTOS)} fichas + {len(data["categorias"])} categorías + sitemap ({len(urls)} URLs)')
