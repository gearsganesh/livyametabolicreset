#!/usr/bin/env python3
"""
LIVYA Metabolic — local server.

The app needs a real http:// origin, not file://. Browsers give file:// pages an
opaque origin, which switches off localStorage and IndexedDB — the two places
this prototype keeps its data. Served over http://localhost everything works.

    python3 serve.py            # then open http://localhost:8080
    python3 serve.py 9000       # a different port, if 8080 is taken
"""
import http.server, socketserver, sys, webbrowser, threading, os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map)
    extensions_map.update({
        '.html': 'text/html; charset=utf-8',
        '.csv':  'text/csv',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.pdf':  'application/pdf',
        '.md':   'text/markdown; charset=utf-8',
    })
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *a):
        pass  # keep the console quiet

if __name__ == '__main__':
    socketserver.TCPServer.allow_reuse_address = True
    try:
        httpd = socketserver.TCPServer(('127.0.0.1', PORT), Handler)
    except OSError:
        print(f'Port {PORT} is already in use. Try:  python3 serve.py {PORT + 1}')
        sys.exit(1)
    url = f'http://localhost:{PORT}/'
    print('\n  LIVYA Metabolic is running.')
    print(f'  Open  {url}')
    print('\n  Sign in with  admin@livyagcc.com  and choose any password (min 8 chars, a letter and a number).')
    print('  Stop the server with Ctrl+C.\n')
    threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\n  Stopped.\n')
