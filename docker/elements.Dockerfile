FROM ghcr.io/coinos/base AS builder
ARG VERSION=23.3.4
ARG SHA256=a758151ace3f21008ab162067ffce9e0e526a1b5d55995e2c30d9cd7ccda41a0
USER root
RUN wget -qO /tmp/elements.tar.gz https://github.com/ElementsProject/elements/releases/download/elements-$VERSION/elements-$VERSION-x86_64-linux-gnu.tar.gz \
 && echo "$SHA256  /tmp/elements.tar.gz" | sha256sum -c - \
 && tar -xz --strip-components=1 -C /usr/local -f /tmp/elements.tar.gz && rm /tmp/elements.tar.gz

FROM ghcr.io/coinos/base
USER root
COPY --from=builder /usr/local/bin/elementsd /usr/local/bin/elements-cli /usr/local/bin/
RUN usermod -l elements bun && usermod -d /home/elements -m elements && groupmod -n elements bun
USER elements
ENTRYPOINT ["elementsd"]
