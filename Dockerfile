FROM jarredsumner/bun:edge

ARG NODE_ENV=production
ENV NODE_ENV $NODE_ENV

RUN apk add --update inotify-tools vips-dev
RUN bun upgrade --canary

COPY . /app
WORKDIR /app

CMD ["bun", "start"]
