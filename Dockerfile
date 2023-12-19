FROM node:21

ARG NODE_ENV=production
ENV NODE_ENV $NODE_ENV

RUN apt update
RUN apt install gcc make pkg-config automake libpcre2-dev libtool git ffmpeg -y
RUN npm i -g bun

COPY . /app
WORKDIR /app

RUN NODE_ENV=development NODE_OPTIONS="" bun i

CMD ["bun", "run", "start"]
