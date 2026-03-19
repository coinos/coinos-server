FROM ghcr.io/coinos/base AS builder
ARG VERSION=23.3.2
USER root
RUN wget -qO- https://github.com/ElementsProject/elements/releases/download/elements-$VERSION/elements-$VERSION-x86_64-linux-gnu.tar.gz | tar -xz --strip-components=1 -C /usr/local

FROM ghcr.io/coinos/base
USER root
COPY --from=builder /usr/local/bin/elementsd /usr/local/bin/elements-cli /usr/local/bin/
RUN usermod -l elements bun && usermod -d /home/elements -m elements && groupmod -n elements bun
USER elements
ENTRYPOINT ["elementsd"]
