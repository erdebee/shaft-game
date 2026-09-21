#!/usr/bin/env python3
"""
Development static server.

Identical to `python3 -m http.server` except that it sends `Cache-Control:
no-store` on everything. That matters more here than it looks: the project has
no build step, so nothing invalidates a cached file. Without this header the
browser serves a stale ES module or data JSON after you have edited it, and the
symptom is a code change that appears to have no effect — which is a genuinely
horrible thing to debug.

No dependencies, standard library only, matching the project's zero-dependency
stance.

    python3 tools/serve.py [port]
"""

import sys
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Quieter than the default: one line per request, no timestamp noise.
        sys.stderr.write("%s\n" % (fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = partial(NoCacheHandler, directory=".")
    server = HTTPServer(("127.0.0.1", port), handler)
    print(f"Serving http://localhost:{port} with caching disabled (Ctrl-C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
