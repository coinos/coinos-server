FROM debian:trixie-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl unzip ca-certificates wget \
    libpq5 libsodium23 libatomic1 jq socat inotify-tools \
    liblmdb0 libsecp256k1-2 tini \
    && curl -fsSL https://bun.sh/install | bash \
    && mv /root/.bun/bin/bun /usr/local/bin/bun \
    && ln -s /usr/local/bin/bun /usr/local/bin/bunx \
    && rm -rf /root/.bun \
    && apt-get purge -y curl unzip \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/* \
       /usr/share/doc /usr/share/man /usr/share/locale \
       /usr/share/info /var/log/* /tmp/*

RUN groupadd -g 1000 bun && useradd -u 1000 -g bun -m -s /bin/sh bun
WORKDIR /home/bun/app
