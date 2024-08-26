FROM oven/bun

ARG NODE_ENV=production

RUN apt update
RUN apt install ffmpeg -y

COPY . /home/bun/app

RUN NODE_ENV=development bun i

CMD ["bun", "run", "start"]
