import http.server
import socketserver
import sys
from pathlib import Path
import os
import errno
import webbrowser
from time import sleep

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=Path(__file__).parent, **kwargs)
    
    def end_headers(self):
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        super().end_headers()
    
    def translate_path(self, path):
        # Handle requests for WASM files from the local wasm-lib directory
        if path.endswith('/CavalryWasm.js'):
            return str('wasm-lib/CavalryWasm.js')
        elif path.endswith('/CavalryWasm.wasm'):
            return str('wasm-lib/CavalryWasm.wasm')
        elif path.endswith('/CavalryWasm.data'):
            return str('wasm-lib/CavalryWasm.data')
        else:
            return super().translate_path(path)

def find_available_port(start_port=8000, max_attempts=10):
    """Find an available port starting from start_port."""
    for port in range(start_port, start_port + max_attempts):
        try:
            test_server = socketserver.TCPServer(("", port), Handler)
            test_server.server_close()
            return port
        except OSError as e:
            if e.errno == errno.EADDRINUSE:
                continue
            else:
                raise
    
    print(f"Could not find an available port in range {start_port}-{start_port + max_attempts - 1}")
    sys.exit(1)

port = find_available_port()
url = f"http://localhost:{port}/"

# Create the actual server
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("", port), Handler)
print(f"Serving Cavalry Web Player at {url}")
webbrowser.open_new_tab(url)

try:
    httpd.serve_forever()
except KeyboardInterrupt:
    print("\nShutting down...")
finally:
    httpd.shutdown()
    httpd.server_close()