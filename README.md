# DASON 2.0 · Guía para revisar la aplicación
En macOS, haz doble clic en **Abrir DASON.command** y mantén abierta esa terminal. En el navegador usa **http://127.0.0.1:8765**. No uses Live Server ni abras directamente el archivo HTML: no ejecutan la API de Python.

En Windows o Linux, desde la carpeta del proyecto ejecuta `python backend/server.py` o `python3 backend/server.py` con una instalación de Python 3 que incluya sqlite3 y hashlib.scrypt. Abre la misma dirección. No se requiere un servicio de base de datos, ni paquetes de pip.

Para revisar: selecciona **Crear cuenta**, utiliza un correo de prueba y una contraseña de al menos 12 caracteres. Después selecciona **Iniciar sesión** con esos mismos datos. Establece un saldo inicial (puede ser cero), registra un ingreso, consúltalo en movimientos, edítalo y elimínalo.

SQLite crea el archivo local automáticamente en el primer arranque. Para entregar una copia limpia, incluye el código y esta guía, pero excluye backend/cuentas.sqlite3 y cualquier archivo SQLite auxiliar: pueden contener información personal. No borres tu propia base.
