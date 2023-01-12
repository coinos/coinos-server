FROM jarredsumner/bun:edge

ARG NODE_ENV=production
ENV NODE_ENV $NODE_ENV

RUN apk add --update inotify-tools vips-dev

COPY . /app
WORKDIR /app

CMD ["bun", "start"]
