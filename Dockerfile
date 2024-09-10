FROM oven/bun

ARG NODE_ENV=production

COPY package.json /home/bun/app

RUN NODE_ENV=development bun i

CMD ["bun", "run", "start"]
