FROM ghcr.io/vulpemventures/nigiri-chopsticks AS source

FROM ghcr.io/coinos/base
USER root
COPY --from=source /app /usr/local/bin/chopsticks
ENTRYPOINT ["chopsticks"]
