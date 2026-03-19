FROM apache/kvrocks AS source

FROM ghcr.io/coinos/base
USER root
COPY --from=source /usr/bin/kvrocks /usr/bin/kvrocks
ENTRYPOINT ["kvrocks"]
