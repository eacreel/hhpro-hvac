"""Tiny static file server that disables caching, so the preview always
loads the latest JS/CSS during development."""
import http.server

PORT = 8000


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


# ThreadingHTTPServer so browser keep-alive connections don't block each
# other (a single-threaded server stalls and the page fails to load).
with http.server.ThreadingHTTPServer(('', PORT), NoCacheHandler) as httpd:
    print('Serving (no-cache, threaded) on port %d' % PORT)
    httpd.serve_forever()
