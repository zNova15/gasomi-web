#!/usr/bin/env python3
"""Catálogo de ferretería completa para la Tienda Gasomi — extraído con Scrapling.

Fuente: API de catálogo VTEX de Promart (retailer peruano, precios reales en soles).
Uso (desde web-gasomi/, con el venv activo):
    python scraper/catalogo_ferreteria.py            # extrae y genera scraper/catalogo.json + descarga fotos
    python scraper/catalogo_ferreteria.py --sin-fotos

Reglas: solo datos que devuelve la API (nombre, marca, precio, foto); precios referenciales,
Gasomi los ajusta en el CRM. Departamentos y consultas curadas para una ferretería peruana.
"""
import json, os, re, sys, time, unicodedata, subprocess
from scrapling.fetchers import Fetcher

BASE_API = 'https://www.promart.pe/api/catalog_system/pub/products/search/'
OUT_DIR = os.path.dirname(os.path.abspath(__file__))
IMG_DIR = os.path.join(OUT_DIR, '..', 'tienda', 'img')
POR_QUERY = 8   # productos por consulta

# departamento -> (nombre bonito, descripción, [(subcategoría, [consultas de búsqueda])])
DEPARTAMENTOS = [
    ('herramientas-manuales', 'Herramientas Manuales', 'Martillos, alicates, llaves, destornilladores, serruchos y todo lo esencial para el trabajo en obra y taller.',
        [('Martillos y combas', ['martillo carpintero', 'comba']),
         ('Alicates y pinzas', ['alicate universal', 'alicate de presión']),
         ('Llaves', ['llave francesa', 'juego de llaves mixtas', 'llave stilson']),
         ('Destornilladores', ['juego destornilladores', 'destornillador estrella']),
         ('Corte y sierras', ['serrucho', 'arco de sierra', 'cuchilla cutter']),
         ('Medición', ['wincha', 'nivel de burbuja', 'escuadra metalica'])]),
    ('herramientas-electricas', 'Herramientas Eléctricas', 'Taladros, amoladoras, sierras y rotomartillos de las marcas líderes para trabajo profesional.',
        [('Taladros', ['taladro percutor', 'taladro inalambrico']),
         ('Amoladoras', ['amoladora angular', 'esmeril angular']),
         ('Sierras', ['sierra circular', 'sierra caladora']),
         ('Rotomartillos', ['rotomartillo']),
         ('Lijadoras', ['lijadora orbital'])]),
    ('tornilleria-fijaciones', 'Tornillería y Fijaciones', 'Tornillos, pernos, tuercas, clavos, tarugos y anclajes para toda aplicación.',
        [('Tornillos', ['tornillo drywall', 'tornillo autoperforante', 'tornillo para madera']),
         ('Pernos y tuercas', ['perno hexagonal', 'tuerca hexagonal']),
         ('Clavos', ['clavo con cabeza', 'clavo para calamina']),
         ('Tarugos y anclajes', ['tarugo', 'anclaje expansivo']),
         ('Alambres', ['alambre negro', 'alambre galvanizado'])]),
    ('gasfiteria', 'Gasfitería y Sanitarios', 'Tuberías, conexiones PVC, llaves, grifería, inodoros y accesorios para agua y desagüe.',
        [('Tuberías PVC', ['tubo pvc agua', 'tubo pvc desague']),
         ('Conexiones', ['codo pvc', 'tee pvc', 'union pvc']),
         ('Llaves y válvulas', ['llave de paso', 'valvula esferica']),
         ('Grifería', ['grifo lavatorio', 'caño cocina', 'ducha']),
         ('Sanitarios', ['inodoro', 'lavatorio']),
         ('Pegamentos y teflón', ['pegamento pvc', 'cinta teflon'])]),
    ('electricidad', 'Electricidad e Iluminación', 'Cables, interruptores, tomacorrientes, focos LED y protección eléctrica.',
        [('Cables', ['cable electrico thw', 'cable mellizo']),
         ('Interruptores y tomacorrientes', ['interruptor simple', 'tomacorriente doble']),
         ('Iluminación LED', ['foco led', 'reflector led']),
         ('Protección', ['interruptor termomagnetico', 'llave diferencial']),
         ('Canaletas y tubos', ['canaleta electrica', 'tubo pvc electrico'])]),
    ('pinturas', 'Pinturas y Acabados', 'Pinturas látex, esmaltes, brochas, rodillos, masillas y accesorios de acabado.',
        [('Pinturas', ['pintura latex', 'esmalte sintetico']),
         ('Brochas y rodillos', ['brocha', 'rodillo pintura']),
         ('Preparación', ['masilla', 'lija para pared', 'thinner']),
         ('Impermeabilizantes', ['impermeabilizante'])]),
    ('construccion', 'Materiales de Construcción', 'Cemento, pegamentos, aditivos, drywall y herramientas de albañilería.',
        [('Cemento y morteros', ['cemento', 'pegamento ceramico']),
         ('Aditivos', ['aditivo impermeabilizante', 'acelerante concreto']),
         ('Drywall', ['plancha drywall', 'perfil drywall']),
         ('Albañilería', ['badilejo', 'plancha de batir', 'balde albañil'])]),
    ('cerrajeria', 'Cerrajería y Seguridad', 'Cerraduras, candados, bisagras y herrajes.',
        [('Cerraduras', ['cerradura puerta', 'cerrojo']),
         ('Candados', ['candado']),
         ('Bisagras y herrajes', ['bisagra', 'picaporte'])]),
    ('jardin-exterior', 'Jardín y Exterior', 'Mangueras, herramientas de jardín, carretillas y limpieza.',
        [('Riego', ['manguera jardin', 'aspersor']),
         ('Herramientas de jardín', ['pala', 'rastrillo', 'tijera podar']),
         ('Carretillas', ['carretilla'])]),
    ('adhesivos-quimicos', 'Adhesivos y Químicos', 'Siliconas, pegamentos, espumas y lubricantes.',
        [('Siliconas y selladores', ['silicona', 'sellador poliuretano']),
         ('Pegamentos', ['pegamento contacto', 'pegamento epoxico']),
         ('Lubricantes', ['lubricante wd-40', 'grasa multiuso'])]),
    ('escaleras-andamios', 'Escaleras y Andamios', 'Escaleras de aluminio y fibra, plataformas de trabajo.',
        [('Escaleras', ['escalera aluminio', 'escalera tijera'])]),
    ('limpieza-industrial', 'Limpieza Industrial', 'Escobas, trapeadores, contenedores y químicos de limpieza.',
        [('Limpieza', ['escoba', 'trapeador', 'tacho basura'])]),
]

# Categorías VTEX (ruta '/Depto/Sub/') que deben aparecer para aceptar el producto en cada departamento
CATS_OK = {
    'herramientas-manuales': ['herramientas', 'ferreter'],
    'herramientas-electricas': ['herramientas'],
    'tornilleria-fijaciones': ['tornil', 'fijaci', 'clavos', 'pernos', 'anclaj', 'alambre', 'ferreter'],
    'gasfiteria': ['gasfiter', 'sanitar', 'griferia', 'grifer', 'baño', 'tuber', 'agua', 'plomer'],
    'electricidad': ['electric', 'ilumin', 'cable', 'foco', 'led'],
    'pinturas': ['pintur', 'acabado', 'brocha', 'rodillo', 'masilla', 'impermeab', 'thinner', 'lija'],
    'construccion': ['construc', 'cemento', 'drywall', 'albañil', 'albanil', 'aditivo', 'pegamento'],
    'cerrajeria': ['cerraj', 'seguridad', 'candado', 'cerradura', 'bisagra', 'herraje'],
    'jardin-exterior': ['jardin', 'jardín', 'exterior', 'riego', 'carretilla', 'terraza'],
    'adhesivos-quimicos': ['adhesiv', 'pegamento', 'silicona', 'quimic', 'químic', 'lubric', 'sellador'],
    'escaleras-andamios': ['escalera', 'andamio'],
    'limpieza-industrial': ['limpieza', 'aseo', 'basura', 'escoba', 'trapeador'],
}
EXCLUIR = ['refrigerad', 'lavadora ', 'televis', ' tv ', 'sofa', 'sofá', 'colchon', 'colchón', 'ropero', 'cama ', 'juguete', 'perfume', 'microondas', 'licuadora', 'cocina multiuso', 'espejo led', 'placa armada']

def coherente(p, dep_slug, nombre):
    cats = ' '.join(p.get('categories') or []).lower()
    nl = ' ' + nombre.lower() + ' '
    if any(x in nl for x in EXCLUIR):
        return False
    claves = CATS_OK.get(dep_slug, [])
    return any(k in cats or k in nl for k in claves)

def slug(t):
    t = unicodedata.normalize('NFKD', t).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', t).strip('-')[:48]

def buscar(q):
    url = f'{BASE_API}{q}?_from=0&_to={POR_QUERY - 1}'
    for intento in range(3):
        try:
            r = Fetcher.get(url, stealthy_headers=True, timeout=30)
            if r.status in (200, 206):
                return json.loads(r.body)
        except Exception as e:
            time.sleep(1.5 * (intento + 1))
    return []

def limpiar_nombre(n):
    n = re.sub(r'\s+', ' ', n).strip()
    return n[:90]

def procesar(raw, dep_slug, subcat):
    out = []
    for p in raw:
        try:
            it = p['items'][0]
            oferta = it['sellers'][0]['commertialOffer']
            precio = float(oferta.get('Price') or 0)
            if precio <= 0 or not it.get('images'):
                continue
            nombre = limpiar_nombre(p['productName'])
            # descartar combos/kits gigantes y cosas raras
            if precio > 3000 or 'COMBO' in nombre.upper():
                continue
            if not coherente(p, dep_slug, nombre):
                continue
            desc = re.sub(r'<[^>]+>', ' ', p.get('description') or p.get('metaTagDescription') or '')
            desc = re.sub(r'\s+', ' ', desc).strip()[:220]
            if len(desc) < 20:
                desc = f'{nombre}. Producto de ferretería para obra, taller y hogar. Precio referencial; consulta stock y descuentos por volumen.'
            out.append({
                'id': slug(nombre),
                'nombre': nombre,
                'categoria': dep_slug,
                'subcategoria': subcat,
                'marca': (p.get('brand') or 'Genérico').strip()[:40],
                'descripcion': desc,
                'norma': '',
                'precio_ref_soles': round(precio, 2),
                'unidad': 'unidad',
                'imagen_url': it['images'][0]['imageUrl'].split('?')[0].replace('-55-55', '-800-800'),
                'fuente_precio': f'promart.pe (API VTEX) · {p.get("link", "")}',
            })
        except Exception:
            continue
    return out

def main():
    sin_fotos = '--sin-fotos' in sys.argv
    categorias, productos, vistos = [], [], set()
    for dep_slug, dep_nombre, dep_desc, subs in DEPARTAMENTOS:
        categorias.append({'slug': dep_slug, 'nombre': dep_nombre, 'descripcion': dep_desc})
        n0 = len(productos)
        for subcat, queries in subs:
            for q in queries:
                for prod in procesar(buscar(q), dep_slug, subcat):
                    if prod['id'] in vistos:
                        continue
                    vistos.add(prod['id'])
                    productos.append(prod)
                time.sleep(0.4)
        print(f'  {dep_nombre}: {len(productos) - n0} productos', flush=True)

    if not sin_fotos:
        os.makedirs(IMG_DIR, exist_ok=True)
        ok = 0
        for p in productos:
            dest = os.path.join(IMG_DIR, p['id'] + '.jpg')
            tmp = dest + '.tmp'
            if os.path.exists(dest):
                p['imagen'] = 'img/' + p['id'] + '.jpg'; ok += 1; continue
            try:
                r = Fetcher.get(p['imagen_url'], stealthy_headers=True, timeout=30)
                if r.status == 200 and len(r.body) > 2000:
                    open(tmp, 'wb').write(r.body)
                    subprocess.run(['sips', '-s', 'format', 'jpeg', '-Z', '800', tmp, '--out', dest],
                                   capture_output=True)
                    if os.path.exists(dest):
                        p['imagen'] = 'img/' + p['id'] + '.jpg'; ok += 1
                if os.path.exists(tmp): os.remove(tmp)
            except Exception:
                pass
        print(f'fotos descargadas: {ok}/{len(productos)}')

    for p in productos:
        p.setdefault('imagen', '')
        p.pop('imagen_url', None)

    json.dump({'categorias': categorias, 'productos': productos},
              open(os.path.join(OUT_DIR, 'catalogo.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'TOTAL: {len(productos)} productos en {len(categorias)} departamentos -> scraper/catalogo.json')

if __name__ == '__main__':
    main()
