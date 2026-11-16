"""Servidor local de DASON. Ejecutar con Python 3."""
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from datetime import date, timedelta
from functools import partial
from http import HTTPStatus
from http.cookies import SimpleCookie, CookieError
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
DB = Path(os.environ.get('DASON_DB', ROOT / 'backend' / 'cuentas.sqlite3'))
PORT = int(os.environ.get('DASON_PORT', '8765'))
ORIGIN = f'http://127.0.0.1:{PORT}'
TTL = 8 * 3600
CATEGORIES = ('Alimentación', 'Transporte', 'Vivienda', 'Salud', 'Ocio', 'Otros', '')

def derive(password, salt):
    return hashlib.scrypt(password.encode(), salt=salt, n=32768, r=8, p=1,
                          maxmem=64 * 1024 * 1024)

def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()

class Handler(SimpleHTTPRequestHandler):
    def list_directory(self, path):
        self.send_error(HTTPStatus.NOT_FOUND)
        return None

    def reply(self, status, message, cookie=None):
        data = json.dumps(message).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(data)

    def token(self):
        cookies = SimpleCookie()
        try:
            cookies.load(self.headers.get('Cookie', ''))
        except CookieError:
            return ''
        return cookies['dason'].value if 'dason' in cookies else ''

    def user(self, db):
        row = db.execute('SELECT email FROM sessions WHERE token=? AND expires>?',
                         (digest(self.token()), time.time())).fetchone()
        return row[0] if row else None

    def do_GET(self):
        path = urlsplit(self.path).path
        if path not in ('/api/session', '/api/summary', '/api/goals', '/api/history'):
            return super().do_GET()
        with sqlite3.connect(DB) as db:
            email = self.user(db)
            if path == '/api/session':
                return self.reply(200, {'email': email})
            if not email:
                return self.reply(401, {'error': 'Inicia sesión para continuar.'})
            if path in ('/api/goals','/api/history'):
                db.row_factory = sqlite3.Row
                query = ("""SELECT g.title,g.key,g.notes,g.target,g.saved,g.deadline, COALESCE((SELECT SUM(m.portion) FROM movements m
                             WHERE m.email=g.email AND m.goal_key=g.key),0) AS contributions
                             FROM goals g WHERE g.email=? ORDER BY g.id DESC""" if path == '/api/goals'
                         else 'SELECT key,kind,day,amount,note,category,goal_key,portion FROM movements WHERE email=? ORDER BY day DESC,id DESC')
                return self.reply(200, {'items':[dict(row) for row in db.execute(query,(email,))]})
            db.execute('BEGIN')
            today = date.today().isoformat()
            opening = db.execute('SELECT amount FROM openings WHERE email=?', (email,)).fetchone()
            net, income, expense = db.execute("""
                SELECT COALESCE(SUM(CASE kind WHEN 'income' THEN amount ELSE -amount END),0),
                       COALESCE(SUM(CASE WHEN day>=? AND kind='income' THEN amount END),0),
                       COALESCE(SUM(CASE WHEN day>=? AND kind='expense' THEN amount END),0)
                FROM movements WHERE email=? AND day<=?
            """, (today[:8]+'01', today[:8]+'01', email, today)).fetchone()
            db.row_factory = sqlite3.Row
            groups = db.execute("""SELECT category, SUM(amount) AS amount FROM movements
                WHERE email=? AND kind='expense' AND day BETWEEN ? AND ?
                GROUP BY category ORDER BY amount DESC,category""",(email,today[:8]+'01',today))
            categories = [dict(row) for row in groups]
            daily = db.execute("""SELECT day, SUM(CASE kind WHEN 'income' THEN amount ELSE -amount END) AS change
                FROM movements WHERE email=? AND day BETWEEN ? AND ? GROUP BY day ORDER BY day""",
                (email,(date.fromisoformat(today) - timedelta(days=89)).isoformat(),today))
            changes = {row['day']:row['change'] for row in daily}
            recent = db.execute("""SELECT kind, day, amount, note FROM movements WHERE email=?
                                   ORDER BY day DESC, id DESC LIMIT 5""", (email,))
            self.reply(200, dict(initialized=bool(opening), balance=(opening[0] if opening else 0)+net,
                                 income=income, expense=expense, today=today, dailyChanges=changes, categories=categories, recent=[dict(r) for r in recent]))

    def save_entry(self, db, body):
        email = self.user(db)
        if not email:
            return self.reply(401, {'error': 'Inicia sesión para continuar.'})
        if self.path in ('/api/goal','/api/goal/edit'):
            title = body['title'].strip()
            key = body['key']
            if not 1 <= len(title) <= 200 or not re.fullmatch(r'[a-f0-9-]{36}',key):
                return self.reply(400, {'error':'Escribe una meta de hasta 200 caracteres.'})
            notes = body.get('notes','').strip()
            target, saved = body.get('target',0), body.get('saved',0)
            deadline = body.get('deadline','')
            if (len(notes)>500 or any(type(n) is not int or not 0<=n<=99999999999999 for n in (target,saved))
                    or (deadline and date.fromisoformat(deadline).isoformat()!=deadline)):
                return self.reply(400, {'error':'Revisa los detalles de la meta.'})
            values = (title,notes,target,saved,deadline,email,key)
            if self.path == '/api/goal/edit':
                changed = db.execute("""UPDATE goals SET title=?,notes=?,target=?,saved=?,deadline=?
                                        WHERE email=? AND key=?""", values)
                if not changed.rowcount:
                    return self.reply(404, {'error':'No se encontró la meta.'})
            else:
                db.execute("""INSERT OR IGNORE INTO goals(title,notes,target,saved,deadline,email,key)
                              VALUES (?,?,?,?,?,?,?)""", values)
            db.commit()
            return self.reply(200, {'saved':True})
        if self.path == '/api/remove':
            db.execute('DELETE FROM movements WHERE email=? AND key=?',(email,body['key']))
            db.commit()
            return self.reply(200, {'saved':True})
        amount = body['amount']
        if type(amount) is not int or not 0 <= amount <= 99999999999999:
            raise ValueError()
        db.execute('BEGIN IMMEDIATE')
        if self.path == '/api/opening':
            db.execute('INSERT OR IGNORE INTO openings VALUES (?,?)', (email, amount))
        else:
            if not db.execute('SELECT 1 FROM openings WHERE email=?', (email,)).fetchone():
                return self.reply(409, {'error': 'Guarda primero tu saldo inicial.'})
            kind, day, note, key = (body[k] for k in ('kind','day','note','key'))
            if (not amount or kind not in ('income','expense') or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',day)
                    or date.fromisoformat(day)>date.today() or not isinstance(note,str)
                    or len(note)>200 or not re.fullmatch(r'[a-f0-9-]{36}',key)):
                raise ValueError()
            category = body.get('category','') if kind == 'expense' else ''
            if category not in CATEGORIES:
                return self.reply(400, {'error':'Selecciona una categoría válida.'})
            goal_key, portion = body.get('goal_key',''), body.get('portion',0)
            if self.path == '/api/edit' and 'goal_key' not in body and kind == 'income':
                old = db.execute('SELECT goal_key,portion FROM movements WHERE email=? AND key=?',(email,key)).fetchone()
                if old:
                    goal_key,portion = old
            if (not isinstance(goal_key,str) or type(portion) is not int or not 0<=portion<=amount
                    or bool(goal_key)!=bool(portion) or (goal_key and kind!='income')):
                return self.reply(400, {'error':'El aporte debe ser positivo y no superar el ingreso.'})
            if goal_key and not db.execute('SELECT 1 FROM goals WHERE email=? AND key=?',(email,goal_key)).fetchone():
                return self.reply(400, {'error':'Selecciona una de tus metas.'})
            if self.path == '/api/edit':
                changed = db.execute('UPDATE movements SET kind=?,day=?,amount=?,note=?,category=?,goal_key=?,portion=? WHERE email=? AND key=?',
                                     (kind,day,amount,note.strip(),category,goal_key,portion,email,key))
                if not changed.rowcount:
                    return self.reply(404, {'error':'Este movimiento ya no está disponible.'})
            else:
                db.execute('INSERT OR IGNORE INTO movements(email,kind,day,amount,note,key,category,goal_key,portion) VALUES (?,?,?,?,?,?,?,?,?)',
                           (email,kind,day,amount,note.strip(),key,category,goal_key,portion))
        db.commit()
        return self.reply(200, {'saved': True})

    def do_POST(self):
        if self.headers.get('Origin') != ORIGIN or self.headers.get_content_type() != 'application/json':
            return self.reply(403, {'error': 'Abre DASON desde su dirección local.'})
        if self.path not in ('/api/register', '/api/login', '/api/logout', '/api/opening', '/api/movement', '/api/goal', '/api/goal/edit', '/api/remove', '/api/edit'):
            return self.reply(404, {})
        with sqlite3.connect(DB, timeout=10) as db:
            if self.path == '/api/logout':
                db.execute('DELETE FROM sessions WHERE token=?', (digest(self.token()),))
                return self.reply(200, {}, 'dason=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
            try:
                size = int(self.headers.get('Content-Length', 0))
                if not 0 < size <= 8192:
                    raise ValueError()
                body = json.loads(self.rfile.read(size))
                if self.path in ('/api/opening', '/api/movement', '/api/goal', '/api/goal/edit', '/api/remove', '/api/edit'):
                    try:
                        return self.save_entry(db, body)
                    except (KeyError, TypeError, ValueError):
                        return self.reply(400, {'error':'Revisa el monto, la fecha y la descripción.'})
                email = body['email'].strip().lower()
                password = body['password']
                if not isinstance(password,str) or len(password)>256 or len(email)>254 or not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+',email):
                    raise ValueError()
            except (KeyError, TypeError, AttributeError, ValueError):
                return self.reply(400, {'error':'Revisa el correo y la contraseña.'})
            if self.path == '/api/register':
                if len(password)<12:
                    return self.reply(400, {'error':'Usa al menos 12 caracteres.'})
                salt = secrets.token_bytes(16)
                try:
                    db.execute('INSERT INTO users VALUES (?,?,?)',(email,salt,derive(password,salt)))
                except sqlite3.IntegrityError:
                    return self.reply(409, {'error':'Este correo ya tiene una cuenta. Inicia sesión.'})
                return self.reply(201, {'created':True})
            row = db.execute('SELECT salt, hash FROM users WHERE email=?',(email,)).fetchone()
            candidate = derive(password,row[0] if row else bytes(16))
            if not row or not hmac.compare_digest(row[1],candidate):
                return self.reply(401, {'error':'El correo o la contraseña son incorrectos.'})
            token = secrets.token_urlsafe(32)
            db.execute('DELETE FROM sessions WHERE expires<=? OR token=?',(time.time(),digest(self.token())))
            db.execute('INSERT INTO sessions VALUES (?,?,?)',(digest(token),email,time.time()+TTL))
            self.reply(200, {'email':email}, f'dason={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={TTL}')

if __name__ == '__main__':
    os.umask(0o077)
    with sqlite3.connect(DB) as db:
        db.executescript("""CREATE TABLE IF NOT EXISTS users(email TEXT PRIMARY KEY, salt BLOB NOT NULL, hash BLOB NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, email TEXT NOT NULL, expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS openings(email TEXT PRIMARY KEY, amount INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS movements(id INTEGER PRIMARY KEY, email TEXT NOT NULL, kind TEXT NOT NULL,
            day TEXT NOT NULL, amount INTEGER NOT NULL, note TEXT NOT NULL, key TEXT NOT NULL, UNIQUE(email,key));
        CREATE TABLE IF NOT EXISTS goals(id INTEGER PRIMARY KEY, email TEXT NOT NULL, title TEXT NOT NULL, key TEXT NOT NULL, UNIQUE(email,key));
        CREATE INDEX IF NOT EXISTS movements_date ON movements(email,day,id);""")
        if 'category' not in {row[1] for row in db.execute('PRAGMA table_info(movements)')}:
            db.execute("ALTER TABLE movements ADD COLUMN category TEXT NOT NULL DEFAULT ''")
        columns = {row[1] for row in db.execute('PRAGMA table_info(movements)')}
        if 'goal_key' not in columns:
            db.execute("ALTER TABLE movements ADD COLUMN goal_key TEXT NOT NULL DEFAULT ''")
        if 'portion' not in columns:
            db.execute("ALTER TABLE movements ADD COLUMN portion INTEGER NOT NULL DEFAULT 0")
        db.execute("CREATE INDEX IF NOT EXISTS movement_goals ON movements(email,goal_key) WHERE goal_key<>''")
        existing = {row[1] for row in db.execute('PRAGMA table_info(goals)')}
        for name, definition in [('notes',"TEXT NOT NULL DEFAULT ''"),('target','INTEGER NOT NULL DEFAULT 0'),
                                 ('saved','INTEGER NOT NULL DEFAULT 0'),('deadline',"TEXT NOT NULL DEFAULT ''")]:
            if name not in existing:
                db.execute(f'ALTER TABLE goals ADD COLUMN {name} {definition}')
    ThreadingHTTPServer(('127.0.0.1',PORT),partial(Handler,directory=str(ROOT/'frontend'))).serve_forever()
