FROM ghcr.io/tigerbeetle/tigerbeetle AS source

FROM ghcr.io/coinos/base
USER root
COPY --from=source /tigerbeetle /usr/local/bin/tigerbeetle
ENTRYPOINT ["tigerbeetle"]
