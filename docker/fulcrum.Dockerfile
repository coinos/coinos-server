# Fulcrum on the coinos base image. The static upstream release binary is
# self-contained, so we just drop it onto ghcr.io/coinos/base — the rest of the
# coinos stack already uses that base, so this shares layers instead of pulling
# a separate Fulcrum image tree. Matches the prod Fulcrum version.
FROM ghcr.io/coinos/base
USER root
ARG VERSION=2.1.1
ADD https://github.com/cculianu/Fulcrum/releases/download/v${VERSION}/Fulcrum-${VERSION}-x86_64-linux.tar.gz /tmp/f.tar.gz
RUN tar xzf /tmp/f.tar.gz -C /usr/local/bin --strip-components=1 \
      Fulcrum-${VERSION}-x86_64-linux/Fulcrum Fulcrum-${VERSION}-x86_64-linux/FulcrumAdmin \
    && rm /tmp/f.tar.gz && mkdir -p /etc/fulcrum /data
ENTRYPOINT ["Fulcrum"]
CMD ["/etc/fulcrum/fulcrum.conf"]
