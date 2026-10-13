#!/usr/bin/env python3
"""Gulmira dev server: static files with caching disabled. python3 tools/serve.py [port]"""
import http.server, os, sys, functools

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary',
                      '.gltf': 'model/gltf+json', '.gz': 'application/octet-stream', '.wasm': 'application/wasm'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *a):
        pass

    def do_POST(self):
        if not self.path.startswith('/shot'):
            self.send_response(404); self.end_headers(); return
        from urllib.parse import urlparse, parse_qs
        name = parse_qs(urlparse(self.path).query).get('name', ['shot'])[0]
        name = ''.join(c for c in name if c.isalnum() or c in '-_') or 'shot'
        n = int(self.headers.get('Content-Length', 0))
        data = self.rfile.read(n)
        out = os.path.join(ROOT, 'Niepotrzebne', 'shots')
        os.makedirs(out, exist_ok=True)
        with open(os.path.join(out, name + '.jpg'), 'wb') as f:
            f.write(data)
        self.send_response(200); self.end_headers(); self.wfile.write(b'ok')


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
    http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(Handler, directory=ROOT)).serve_forever()
