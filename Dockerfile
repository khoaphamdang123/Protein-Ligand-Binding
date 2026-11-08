# BindSite Explorer: the whole app in one image, running on the CPU.
#
#   web page (Explore, Predict)   built Angular app, served with gzip by scripts/serve_dist.py on $PORT (8080)
#   API                           FastAPI backend on 127.0.0.1:8000 inside the container, reached as /api/*
#   models                        AdaBind (adabind/final_model), bindEmbed21DL + bindNode24 (baselines_2124),
#                                 ESM-2, ProtT5, ESM-IF1, ESMFold v1 (folds on the CPU) and the 4036 precomputed
#                                 ESMFold structures
#
#   docker build -t bindsite:latest .
#   docker run -d --name bindsite -p 8080:8080 bindsite:latest        then open http://localhost:8080
#
# Three Python environments, as on the development machine (backend/setup_env.sh): their numpy / torch versions
# conflict. Versions are pinned to the ones the golden set and the baselines were verified with (docker/constraints-*).

# ---------- 1. frontend build ----------
FROM node:24-bookworm-slim AS web
WORKDIR /src
COPY package.json package-lock.json ./
# --legacy-peer-deps: @angular/animations 20 next to Angular 22, as on the development machine (README)
RUN npm ci --legacy-peer-deps --no-audit --no-fund
COPY angular.json tsconfig.json tsconfig.app.json ./
COPY src src
COPY public public
RUN npx ng build && test -f dist/bindsite-explorer/browser/index.html

# ---------- 2. Python 3.10 for the ESM-IF environment (fair-esm 2.0.0 + torch 2.4.1) ----------
FROM python:3.10-slim-bookworm AS py310

# ---------- 3. runtime ----------
FROM python:3.11-slim-bookworm
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_ROOT_USER_ACTION=ignore
COPY --from=py310 /usr/local/bin/python3.10 /usr/local/bin/python3.10
COPY --from=py310 /usr/local/lib/python3.10 /usr/local/lib/python3.10
COPY --from=py310 /usr/local/lib/libpython3.10.so.1.0 /usr/local/lib/libpython3.10.so.1.0
RUN ldconfig && python3.10 --version

WORKDIR /app
COPY docker/constraints-main.txt docker/constraints-esmif.txt docker/constraints-baselines.txt docker/
COPY backend/requirements.txt backend/requirements-esmif.txt backend/requirements-baselines.txt backend/

# backend/.venv: FastAPI + pbind (ESM-2, ProtT5, 140 checkpoints), numpy 2
RUN python3.11 -m venv backend/.venv \
 && backend/.venv/bin/pip install -q --upgrade pip setuptools wheel \
 && backend/.venv/bin/pip install -q --index-url https://download.pytorch.org/whl/cpu "torch==2.14.1+cpu" \
 && backend/.venv/bin/pip install -q -r backend/requirements.txt -c docker/constraints-main.txt

# backend/.venv-esmif: ESM-IF1 embedding worker, numpy < 2
RUN python3.10 -m venv backend/.venv-esmif \
 && backend/.venv-esmif/bin/pip install -q --upgrade "pip<25" setuptools wheel \
 && backend/.venv-esmif/bin/pip install -q --index-url https://download.pytorch.org/whl/cpu "torch==2.4.1+cpu" \
 && backend/.venv-esmif/bin/pip install -q -f https://data.pyg.org/whl/torch-2.4.0+cpu.html "torch-scatter==2.1.2" \
 && backend/.venv-esmif/bin/pip install -q -r backend/requirements-esmif.txt -c docker/constraints-esmif.txt

# backend/.venv-baselines: bindEmbed21DL + bindNode24 worker, versions of the original bindNode24 repository
RUN python3.11 -m venv backend/.venv-baselines \
 && backend/.venv-baselines/bin/pip install -q --upgrade pip setuptools wheel \
 && backend/.venv-baselines/bin/pip install -q --index-url https://download.pytorch.org/whl/cpu "torch==2.2.2+cpu" \
 && backend/.venv-baselines/bin/pip install -q -r backend/requirements-baselines.txt -c docker/constraints-baselines.txt

# Foundation models (15 GB), one layer each so that a change to one does not re-send the others.
COPY foundation_models/MANIFEST.json foundation_models/
COPY foundation_models/esm2_t33_650M_UR50D foundation_models/esm2_t33_650M_UR50D
COPY foundation_models/prot_t5_xl_half_uniref50-enc foundation_models/prot_t5_xl_half_uniref50-enc
COPY foundation_models/esm_if1 foundation_models/esm_if1
COPY foundation_models/esmfold_v1 foundation_models/esmfold_v1
COPY foundation_models/esmfold_files foundation_models/esmfold_files
# fair-esm looks for ESM-IF1 in $TORCH_HOME/hub/checkpoints: the same file as esm_if1/ (identical bytes, kept once)
RUN mkdir -p foundation_models/torch_home/hub/checkpoints \
 && ln -s ../../../esm_if1/esm_if1_gvp4_t16_142M_UR50.pt foundation_models/torch_home/hub/checkpoints/

# AdaBind (pbind code, final_model, golden set), the baselines with their frozen results, the backend, the web page
COPY adabind adabind
COPY baselines_2124 baselines_2124
COPY backend/app backend/app
COPY backend/scripts backend/scripts
COPY backend/tests backend/tests
COPY backend/README.md backend/
COPY scripts/serve_dist.py scripts/
COPY docker/entrypoint.sh docker/
COPY --from=web /src/dist/bindsite-explorer/browser dist/bindsite-explorer/browser
RUN backend/.venv/bin/pip install -q --no-deps -e adabind \
 && mkdir -p backend/cache backend/logs \
 && cd backend && .venv/bin/python -c "from app.config import Settings; from app.esmfold import PrecomputedStructures; \
s = Settings.from_env(); p = PrecomputedStructures(s.esmfold_files_dir, s.cache_dir / 'esmfold_files_index.json'); \
p.start(background=False); print(p.status['message']); assert p.status['status'] == 'ok' and p.status['count'] > 4000" \
 && cd .. && chmod -R a+rwX backend/cache backend/logs && chmod +x docker/entrypoint.sh \
 && mkdir -p /app/home && chmod 1777 /app/home \
 # Hugging Face runs the container as user 1000, not root: every file must be readable by others. Only the files that
 # are not get chmod (a chmod copies a file into a new layer). baselines_2124 ships 28 owner-only files.
 && find /app \( \( -type f ! -perm -o=r \) -o \( -type d ! -perm -o=rx \) \) -print0 | xargs -0 -r chmod a+rX \
 && test -z "$(find /app \( -type f ! -perm -o=r \) -o \( -type d ! -perm -o=rx \) | head -1)"

# Everything on the CPU, ESMFold v1 included: the 4th structure source (after the precomputed structures and the
# ESM Atlas API) folds in the background, minutes per protein, ~20 GB of RAM while it runs.
# HOME: a user without a home directory (Hugging Face runs the container as user 1000) gets HOME=/, and libraries that
# create ~/.cache then fail (torch-geometric in the baseline worker did).
ENV PORT=8080 \
    HOME=/app/home \
    BINDSITE_DEVICE=cpu \
    BINDSITE_DEVICE_ESMFOLD=cpu
EXPOSE 8080
# /api/health answers once the server is up; the models then load in the background (Predict waits for them).
HEALTHCHECK --start-period=3m --interval=30s --timeout=15s --retries=3 \
  CMD python3 -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/api/health', timeout=10)"
CMD ["/app/docker/entrypoint.sh"]
