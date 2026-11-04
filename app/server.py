"""Local CRM foundation. Bind to loopback only until staff authentication is implemented."""
import argparse
import hashlib
import json
import sqlite3
from contextlib import contextmanager
from decimal import Decimal, InvalidOperation
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]


def connect_db(path):
    conn = sqlite3.connect(str(path), isolation_level=None, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    conn.execute('PRAGMA journal_mode=WAL')
    return conn


def init_db(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with connect_db(path) as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS demo_snapshots(revision INTEGER PRIMARY KEY AUTOINCREMENT,
          content TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
        CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, name TEXT NOT NULL,
          sku TEXT UNIQUE NOT NULL, barcode TEXT, unit_size INTEGER NOT NULL, price INTEGER NOT NULL CHECK(price>=0));
        CREATE UNIQUE INDEX IF NOT EXISTS barcode_unique ON products(barcode) WHERE barcode IS NOT NULL;
        CREATE TABLE IF NOT EXISTS inventory(product_id INTEGER PRIMARY KEY REFERENCES products(id),
          quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity>=0), reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0 AND reserved<=quantity));
        CREATE TABLE IF NOT EXISTS clients(id INTEGER PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '');
        CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY,client_id INTEGER REFERENCES clients(id),
          status TEXT NOT NULL DEFAULT 'reserved',total INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          idempotency_key TEXT UNIQUE NOT NULL,payload_hash TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS order_lines(id INTEGER PRIMARY KEY,order_id INTEGER NOT NULL REFERENCES orders(id),
          product_id INTEGER NOT NULL REFERENCES products(id),name TEXT NOT NULL,quantity INTEGER NOT NULL,
          unit_size INTEGER NOT NULL,price INTEGER NOT NULL,total INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS movements(id INTEGER PRIMARY KEY,product_id INTEGER NOT NULL REFERENCES products(id),
          quantity INTEGER NOT NULL,reason TEXT NOT NULL,author TEXT NOT NULL DEFAULT 'Локальный оператор',
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
        CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,action TEXT NOT NULL,entity_id INTEGER NOT NULL,
          author TEXT NOT NULL DEFAULT 'Локальный оператор',created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
        ''')


@contextmanager
def transaction(c):
    c.execute('BEGIN IMMEDIATE')
    try:
        yield
        c.execute('COMMIT')
    except Exception:
        c.execute('ROLLBACK')
        raise


def integer(value, label):
    if isinstance(value, bool):
        raise ValueError(label + ': требуется положительное целое число')
    try:
        n = int(value)
        if Decimal(str(value)) != n or n < 1 or n > 100000000:
            raise ValueError()
        return n
    except (ValueError, TypeError, InvalidOperation):
        raise ValueError(label + ': требуется положительное целое число')


def required(data, key, label):
    v = data.get(key)
    if not isinstance(v, str) or not v.strip() or len(v.strip()) > 250:
        raise ValueError(label + ': заполните поле (до 250 символов)')
    return v.strip()


def money(value):
    try:
        d = Decimal(str(value))
        if not d.is_finite() or d < 0 or d > 100000000 or d != d.quantize(Decimal('.01')):
            raise ValueError()
        return int(d * 100)
    except (ValueError, TypeError, InvalidOperation):
        raise ValueError('Цена должна быть неотрицательной суммой с точностью до копеек')


def create_product(c, data):
    name = required(data, 'name', 'Название')
    sku = required(data, 'sku', 'Артикул')
    barcode = str(data.get('barcode') or '').strip() or None
    size = integer(data.get('unit_size', 1), 'Размер упаковки')
    price = money(data.get('price'))
    try:
        with transaction(c):
            ident = c.execute('INSERT INTO products(name,sku,barcode,unit_size,price) VALUES(?,?,?,?,?)', (name,sku,barcode,size,price)).lastrowid
            c.execute('INSERT INTO inventory(product_id) VALUES(?)',(ident,))
            c.execute('INSERT INTO audit(action,entity_id) VALUES(?,?)',('product_created',ident))
    except sqlite3.IntegrityError:
        raise ValueError('Товар с таким артикулом или штрихкодом уже существует')
    return {'id': ident}


def create_client(c, data):
    name = required(data, 'name', 'Имя клиента')
    phone = str(data.get('phone') or '').strip()[:100]
    with transaction(c):
        ident = c.execute('INSERT INTO clients(name,phone) VALUES(?,?)',(name,phone)).lastrowid
        c.execute('INSERT INTO audit(action,entity_id) VALUES(?,?)',('client_created',ident))
    return {'id':ident}


def add_stock(c, data):
    pid = integer(data.get('product_id'),'Товар')
    qty = integer(data.get('quantity'),'Количество в штуках')
    reason = required(data,'reason','Основание поступления')
    with transaction(c):
        if not c.execute('SELECT id FROM products WHERE id=?',(pid,)).fetchone():
            raise ValueError('Товар не найден')
        c.execute('UPDATE inventory SET quantity=quantity+? WHERE product_id=?',(qty,pid))
        ident = c.execute('INSERT INTO movements(product_id,quantity,reason) VALUES(?,?,?)',(pid,qty,reason)).lastrowid
        c.execute('INSERT INTO audit(action,entity_id) VALUES(?,?)',('stock_received',ident))
    return {'id':ident}


def order_result(c, ident):
    row = c.execute('SELECT o.*,c.name client_name FROM orders o LEFT JOIN clients c ON c.id=o.client_id WHERE o.id=?',(ident,)).fetchone()
    result = {k:row[k] for k in ('id','client_id','client_name','status','total','created_at')}
    result['total'] /= 100
    result['lines'] = [dict(r) for r in c.execute('SELECT product_id,name,quantity,unit_size,price,total FROM order_lines WHERE order_id=?',(ident,))]
    for line in result['lines']:
        line['price'] /= 100
        line['total'] /= 100
    return result


def create_order(c, data):
    key = required(data,'idempotency_key','Ключ операции')
    payload = {k:v for k,v in data.items() if k != 'idempotency_key'}
    digest = hashlib.sha256(json.dumps(payload,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    with transaction(c):
        previous = c.execute('SELECT id,payload_hash FROM orders WHERE idempotency_key=?',(key,)).fetchone()
        if previous:
            if previous['payload_hash'] != digest:
                raise ValueError('Этот ключ операции уже использован для другого заказа')
            return order_result(c,previous['id'])
        cid = data.get('client_id') or None
        if cid is not None:
            cid = integer(cid,'Клиент')
            if not c.execute('SELECT id FROM clients WHERE id=?',(cid,)).fetchone():
                raise ValueError('Клиент не найден')
        lines = data.get('lines')
        if not isinstance(lines,list) or not 1 <= len(lines) <= 500:
            raise ValueError('Добавьте от 1 до 500 строк заказа')
        resolved = []
        total = 0
        for line in lines:
            if not isinstance(line,dict):
                raise ValueError('Некорректная строка заказа')
            pid = integer(line.get('product_id'),'Товар')
            qty = integer(line.get('quantity'),'Количество')
            size = integer(line.get('unit_size',1),'Упаковка')
            p = c.execute('SELECT * FROM products WHERE id=?',(pid,)).fetchone()
            if not p:
                raise ValueError('Товар не найден')
            if size not in (1,p['unit_size']):
                raise ValueError('Упаковка товара изменилась. Обновите заказ')
            units = qty*size
            changed = c.execute('UPDATE inventory SET reserved=reserved+? WHERE product_id=? AND quantity-reserved>=?',(units,pid,units)).rowcount
            if not changed:
                raise ValueError('Недостаточно товара: '+p['name'])
            subtotal = units*p['price']
            total += subtotal
            resolved.append((pid,p['name'],qty,size,p['price']*size,subtotal))
        ident = c.execute('INSERT INTO orders(client_id,total,idempotency_key,payload_hash) VALUES(?,?,?,?)',(cid,total,key,digest)).lastrowid
        c.executemany('INSERT INTO order_lines(order_id,product_id,name,quantity,unit_size,price,total) VALUES(?,?,?,?,?,?,?)',[(ident,)+x for x in resolved])
        c.execute('INSERT INTO audit(action,entity_id) VALUES(?,?)',('order_reserved',ident))
        result = order_result(c,ident)
    return result


def cancel_order(c, ident):
    ident = integer(ident,'Заказ')
    with transaction(c):
        order = c.execute('SELECT status FROM orders WHERE id=?',(ident,)).fetchone()
        if not order:
            raise ValueError('Заказ не найден')
        if order['status'] != 'cancelled':
            for line in c.execute('SELECT product_id,quantity,unit_size FROM order_lines WHERE order_id=?',(ident,)).fetchall():
                c.execute('UPDATE inventory SET reserved=reserved-? WHERE product_id=?',(line['quantity']*line['unit_size'],line['product_id']))
            c.execute("UPDATE orders SET status='cancelled' WHERE id=?",(ident,))
            c.execute('INSERT INTO audit(action,entity_id) VALUES(?,?)',('order_cancelled',ident))
        result = order_result(c,ident)
    return result


def get_state(c):
    products = [dict(r) for r in c.execute('SELECT p.*,i.quantity stock,i.reserved,i.quantity-i.reserved available FROM products p JOIN inventory i ON i.product_id=p.id ORDER BY p.name')]
    for p in products:
        p['price'] /= 100
    orders = [order_result(c,r['id']) for r in c.execute('SELECT id FROM orders ORDER BY id DESC').fetchall()]
    return {'products':products,'clients':[dict(r) for r in c.execute('SELECT * FROM clients ORDER BY name')],
            'orders':orders,'movements':[dict(r) for r in c.execute('SELECT m.*,p.name FROM movements m JOIN products p ON p.id=m.product_id ORDER BY m.id DESC LIMIT 100')],
            'summary':{'products':len(products),'clients':c.execute('SELECT count(*) FROM clients').fetchone()[0],
                       'orders':sum(o['status']=='reserved' for o in orders),'reserved_value':sum(o['total'] for o in orders if o['status']=='reserved')}}


class SnapshotConflict(ValueError):
    pass


def get_demo_snapshot(c):
    row = c.execute('SELECT * FROM demo_snapshots ORDER BY revision DESC LIMIT 1').fetchone()
    return {'revision':row['revision'],'state':json.loads(row['content']),'saved_at':row['created_at']} if row else {'revision':0,'state':None}


def save_demo_snapshot(c,data):
    state = data.get('state')
    revision = data.get('expected_revision')
    if isinstance(revision,bool) or not isinstance(revision,int) or revision < 0:
        raise ValueError('Некорректная версия демо')
    if not isinstance(state,dict) or any(not isinstance(state.get(k),list) for k in ('products','clients','orders','payments')):
        raise ValueError('Некорректные данные демо')
    raw = json.dumps(state,ensure_ascii=False,sort_keys=True,allow_nan=False,separators=(',',':'))
    if len(raw.encode()) > 5000000:
        raise ValueError('Слишком много данных для демонстрации')
    with transaction(c):
        current = c.execute('SELECT revision,content FROM demo_snapshots ORDER BY revision DESC LIMIT 1').fetchone()
        if current and current['content'] == raw:
            return {'revision':current['revision']}
        if (current['revision'] if current else 0) != revision:
            raise SnapshotConflict('Демо обновлено в другом окне. Локальная копия сохранена, загрузите актуальную версию.')
        ident = c.execute('INSERT INTO demo_snapshots(content) VALUES(?)',(raw,)).lastrowid
        c.execute('DELETE FROM demo_snapshots WHERE revision NOT IN (SELECT revision FROM demo_snapshots ORDER BY revision DESC LIMIT 20)')
        return {'revision':ident}


class Handler(BaseHTTPRequestHandler):
    def reply(self, code, data):
        raw = json.dumps(data,ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        self.send_header('Content-Length',str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path in ('/api/state','/api/demo-state'):
            c = connect_db(self.server.db_path)
            try:
                self.reply(200,get_demo_snapshot(c) if path=='/api/demo-state' else get_state(c))
            finally:
                c.close()
            return
        files = {'/':ROOT/'app/static/index.html','/app.js':ROOT/'app/static/app.js',
                 '/design-options.html':ROOT/'app/static/design-options.html',
                 '/demo.js':ROOT/'app/static/demo.js','/demo-controller.js':ROOT/'app/static/demo-controller.js',
                 '/analytics.js':ROOT/'app/static/analytics.js','/analytics.css':ROOT/'app/static/analytics.css',
                 '/operations.js':ROOT/'app/static/operations.js','/operations.css':ROOT/'app/static/operations.css',
                 '/chat-enhancements.css':ROOT/'app/static/chat-enhancements.css',
                 '/workflows.js':ROOT/'app/static/workflows.js',
                 '/style.css':ROOT/'app/static/style.css','/assets/brand/bytmarket-original.png':ROOT/'assets/brand/bytmarket-original.png'}
        for filename in ('features.js','features.css','inventory.js','catalog-tools.js','catalog-tools.css','business-tools.js','business-tools.css','fulfillment.js','fulfillment.css','register.js','register.css','demo-examples.js','demo-store.js','experience.js','role-demo.js','role-demo.css','workspace.js','workspace.css','ui-polish.css','workspace-shell.js','workspace-shell.css'):
            files['/'+filename] = ROOT/'app/static'/filename
        f = files.get(path)
        if not f or not f.is_file():
            self.reply(404,{'error':'Страница не найдена'})
            return
        raw = f.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type',{'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png'}[f.suffix])
        self.send_header('Cache-Control','no-cache')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Length',str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        # Local-only mutations: reject browser requests originating on another site.
        origin = self.headers.get('Origin')
        if origin and origin != 'http://'+self.headers.get('Host',''):
            self.reply(403,{'error':'Недопустимый источник запроса'})
            return
        if not self.headers.get('Content-Type','').startswith('application/json'):
            self.reply(415,{'error':'Ожидается JSON'})
            return
        c = connect_db(self.server.db_path)
        try:
            length = int(self.headers.get('Content-Length','0'))
            if not 0 < length <= (5000000 if urlsplit(self.path).path=='/api/demo-state' else 1000000):
                raise ValueError('Недопустимый размер запроса')
            data = json.loads(self.rfile.read(length))
            if not isinstance(data,dict):
                raise ValueError('Ожидается объект')
            path = urlsplit(self.path).path
            routes = {'/api/products':create_product,'/api/clients':create_client,'/api/stock':add_stock,'/api/orders':create_order}
            if path == '/api/demo-state':
                result = save_demo_snapshot(c,data)
            elif path in routes:
                result = routes[path](c,data)
            elif path.startswith('/api/orders/') and path.endswith('/cancel'):
                result = cancel_order(c,path.split('/')[3])
            else:
                self.reply(404,{'error':'Операция не найдена'})
                return
            self.reply(200,result)
        except SnapshotConflict as e:
            self.reply(409,{'error':str(e)})
        except (ValueError,TypeError,KeyError) as e:
            self.reply(400,{'error':str(e)})
        except Exception:
            self.log_error('Internal operation failure')
            self.reply(500,{'error':'Операция не выполнена. Обновите данные и повторите попытку'})
        finally:
            c.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=8765)
    parser.add_argument('--db',default=str(ROOT/'data/bytmarket.sqlite3'))
    args = parser.parse_args()
    init_db(args.db)
    server = ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    server.db_path = args.db
    print('БытМаркет: http://127.0.0.1:'+str(args.port),flush=True)
    server.serve_forever()
