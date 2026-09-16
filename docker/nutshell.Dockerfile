# Nutshell (cashu mint) on the coinos base image.
#
# Source comes from our fork, github.com/coinos/nutshell, at NUTSHELL_REF:
#   limited-invoices-<ver>             → `mint`
#   panic-mode-limited-invoices-<ver>  → `mint-old`
#
#   docker build -f docker/nutshell.Dockerfile \
#     --build-arg NUTSHELL_REF=limited-invoices-0.21.0 \
#     -t ghcr.io/coinos/nutshell:0.21.0-limited-invoices .
#
# The interpreter comes from python:3.12-slim-trixie rather than trixie's own
# python3 (3.13): coincurve 20 publishes cp312 wheels but no cp313, so 3.13
# would mean compiling the libsecp256k1 bindings from source. The builder is
# the same Debian release as ghcr.io/coinos/base, so /usr/local (interpreter +
# site-packages) copies over ABI-compatible, the same way lightningd.Dockerfile
# lifts /usr/local out of the upstream CLN image.

FROM python:3.12-slim-trixie AS build

ARG NUTSHELL_REPO=https://github.com/coinos/nutshell.git
ARG NUTSHELL_REF=limited-invoices-0.21.0

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates curl build-essential pkg-config libffi-dev libpq-dev \
    && rm -rf /var/lib/apt/lists/*

RUN curl -sSL https://install.python-poetry.org | python3 - --version 2.3.2
ENV PATH="/root/.local/bin:$PATH" \
    POETRY_VIRTUALENVS_CREATE=false \
    PIP_NO_CACHE_DIR=1

RUN git clone --depth 1 --branch "$NUTSHELL_REF" "$NUTSHELL_REPO" /app \
    && rm -rf /app/.git
WORKDIR /app

# editable root install → /app must ship in the runtime image
RUN poetry install --without dev --no-root \
    && poetry install --only-root \
    && find /usr/local/lib/python3.12 -name __pycache__ -prune -exec rm -rf {} +

FROM ghcr.io/coinos/base

USER root
# shared libs the CPython build and its wheels link against that base lacks
RUN apt-get update && apt-get install -y --no-install-recommends \
    libexpat1 libffi8 libsqlite3-0 libbz2-1.0 liblzma5 zlib1g libssl3t64 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /usr/local /usr/local
COPY --from=build /app /app

WORKDIR /app
# runtime config is nutshell's /app/.env (bind-mounted, takes precedence over
# container env); data lives under CASHU_DIR (/app/data/mint)
EXPOSE 3338
ENTRYPOINT ["tini", "--"]
CMD ["mint"]
