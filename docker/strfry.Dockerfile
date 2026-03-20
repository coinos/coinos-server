FROM debian:trixie-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    git g++ make pkg-config ca-certificates \
    liblmdb-dev libflatbuffers-dev libsecp256k1-dev \
    libb2-dev libzstd-dev libssl-dev zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/hoytech/strfry.git /build
WORKDIR /build
RUN git submodule update --init
RUN make setup-golpe && make -j$(nproc)
RUN strip --strip-unneeded strfry

FROM ghcr.io/coinos/base
USER root
WORKDIR /app
COPY --from=builder /build/strfry /app/strfry
ENTRYPOINT ["tini", "--"]
CMD ["/app/strfry", "relay"]
