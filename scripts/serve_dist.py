"""Serve the built frontend (dist/) with gzip, and forward /api to the backend.

    backend/.venv/bin/python scripts/serve_dist.py dist/bindsite-explorer/browser [--port 4200] [--backend http://127.0.0.1:8000]

Why not `ng serve`: the dev server sends ~17 MB of unminified, uncompressed JavaScript for the first page, too slow over
an SSH tunnel through a Tailscale relay (the page stays black). The production build sent with gzip is ~0.5 MB.
Routes: /api/* -> backend (path without /api, like proxy.conf.json); a file of dist if it exists; a page path from
before the app used "#" routes (/explore?dataset=...) -> redirect to /#/explore?dataset=...; else index.html.
"""
import argparse
import re
from pathlib import Path

import httpx
import uvicorn
from starlette.applications import Starlette
from starlette.middleware.gzip import GZipMiddleware
from starlette.responses import FileResponse, RedirectResponse, Response
from starlette.routing import Route

p = argparse.ArgumentParser()
p.add_argument("root")
p.add_argument("--port", type=int, default=4200)
p.add_argument("--host", default="127.0.0.1")
p.add_argument("--backend", default="http://127.0.0.1:8000")
args = p.parse_args()

ROOT = Path(args.root).resolve()
HASHED = re.compile(r"-[A-Za-z0-9_-]{8}\.(js|css)$")
HOP = {"host", "content-length", "accept-encoding", "connection", "transfer-encoding", "content-encoding"}
client = httpx.AsyncClient(base_url=args.backend, timeout=None)


async def api(request):
    try:
        r = await client.request(
            request.method,
            "/" + request.path_params["path"],
            params=request.query_params,
            content=await request.body(),
            headers={k: v for k, v in request.headers.items() if k.lower() not in HOP},
        )
    except httpx.HTTPError:
        # No JSON body on purpose: the page reports it as "backend not reachable".
        return Response("backend not reachable", status_code=502)
    return Response(r.content, r.status_code, {k: v for k, v in r.headers.items() if k.lower() not in HOP})


async def static(request):
    rel = request.path_params.get("path", "")
    f = (ROOT / rel).resolve()
    if rel and f.is_file() and ROOT in f.parents:
        cache = "public, max-age=31536000, immutable" if HASHED.search(f.name) else "no-cache"
        return FileResponse(f, headers={"Cache-Control": cache})
    if rel and "." not in rel.rsplit("/", 1)[-1]:
        # An old link or bookmark (/explore?dataset=...): the app routes after "#" now. Serving index.html here would
        # break, its relative script paths would resolve under /explore/.
        query = f"?{request.url.query}" if request.url.query else ""
        return RedirectResponse(f"/#/{rel}{query}", status_code=302)
    return FileResponse(ROOT / "index.html", headers={"Cache-Control": "no-cache"})


app = Starlette(
    routes=[
        Route("/api/{path:path}", api, methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]),
        Route("/{path:path}", static),
    ]
)
app.add_middleware(GZipMiddleware, minimum_size=1024)

if __name__ == "__main__":
    if not (ROOT / "index.html").exists():
        raise SystemExit(f"{ROOT}/index.html not found: build the frontend first (npx ng build)")
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
