FROM elementsproject/lightningd:v26.06.2 AS source

FROM ghcr.io/coinos/base
USER root
COPY --from=source /usr/local/ /usr/local/
COPY --from=source /usr/bin/bitcoin-cli /usr/bin/
COPY --from=source /entrypoint.sh /entrypoint.sh

ENV LIGHTNINGD_DATA=/root/.lightning
ENV LIGHTNINGD_NETWORK=bitcoin
EXPOSE 9735 9835
VOLUME ["/root/.lightning"]
ENTRYPOINT ["/entrypoint.sh"]
