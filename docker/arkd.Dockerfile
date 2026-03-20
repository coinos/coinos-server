FROM asoltys/arkd AS source

FROM ghcr.io/coinos/base
USER root
COPY --from=source /app/arkd /app/ark /usr/local/bin/
ENTRYPOINT ["arkd"]
