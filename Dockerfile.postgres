FROM postgres:18 AS pg
FROM ghcr.io/coinos/base
USER root
COPY --from=pg /usr/lib/postgresql /usr/lib/postgresql
COPY --from=pg /usr/share/postgresql /usr/share/postgresql
COPY --from=pg /usr/local/bin/docker-entrypoint.sh /usr/local/bin/
COPY --from=pg /lib/x86_64-linux-gnu/libpq.so.5* /lib/x86_64-linux-gnu/
COPY --from=pg /usr/local/bin/gosu /usr/local/bin/
RUN ln -s /usr/lib/postgresql/18/bin/* /usr/local/bin/ \
 && apt-get update && apt-get install -y --no-install-recommends libicu76 libreadline8t64 libxml2 libxslt1.1 libssl3t64 liblz4-1 libzstd1 libnuma1 liburing2 locales \
 && rm -rf /var/lib/apt/lists/* \
 && sed -i '/en_US.UTF-8/s/^# //' /etc/locale.gen && locale-gen \
 && groupadd -r postgres --gid=999 && useradd -r -g postgres --uid=999 --home-dir=/var/lib/postgresql --shell=/bin/bash postgres \
 && mkdir -p /var/run/postgresql /var/lib/postgresql /docker-entrypoint-initdb.d \
 && chown -R postgres:postgres /var/run/postgresql /var/lib/postgresql
WORKDIR /
ENV PGDATA=/var/lib/postgresql/data
ENV PG_MAJOR=18
STOPSIGNAL SIGINT
USER postgres
EXPOSE 5432
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["postgres"]
