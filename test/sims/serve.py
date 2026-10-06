import http.server, functools, sys
class S(http.server.ThreadingHTTPServer):
    request_queue_size = 128
    daemon_threads = True
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=sys.argv[1])
H.log_message = lambda *a: None
S(('127.0.0.1', 8765), H).serve_forever()
