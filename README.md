# Coinos

Coinos is a web-based bitcoin and nostr client. You can use it as a front end to your personal bitcoin and lightning nodes or host a public instance that allows anyone to register with a username and password. Try ours at https://coinos.io

This repository contains the code for the API server. The frontend code is at <a href="https://github.com/coinos/coinos-ui">https://github.com/coinos/coinos-ui</a>

## Install

The following commands will set up bitcoin and lightning nodes in regtest mode, along with a coinos api server and database. You'll need to have <a href="https://docs.docker.com/get-docker/">docker</a>.

```bash
cp -r sampledata data
docker compose up -d
docker run -it -v $(pwd):/app --entrypoint pnpm cs i
chmod +x setup.sh
./setup.sh
```

