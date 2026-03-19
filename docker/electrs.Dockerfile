FROM ghcr.io/vulpemventures/electrs AS source

FROM ghcr.io/coinos/base
USER root
COPY --from=source /build/electrs /build/electrs
ENTRYPOINT ["/build/electrs"]
