FROM ghcr.io/coinos/base AS builder
ARG VERSION=30.2
USER root
RUN wget -qO- https://bitcoincore.org/bin/bitcoin-core-$VERSION/bitcoin-$VERSION-x86_64-linux-gnu.tar.gz | tar -xz --strip-components=1 -C /usr/local

FROM ghcr.io/coinos/base
USER root
COPY --from=builder /usr/local/bin/bitcoind /usr/local/bin/bitcoin-cli /usr/local/bin/
RUN usermod -l bitcoin bun && usermod -d /home/bitcoin -m bitcoin && groupmod -n bitcoin bun
USER bitcoin
ENTRYPOINT ["bitcoind"]
