To build staging locally do: 

```bash
docker build -t coinos-server-staging:0.0.1 -f staging.Dockerfile .
```


Also build the UI for staging:  

```
docker build -t coinos-ui-staging:0.1.0 -f Dockerfile.stage .

#spit out the build: 
docker run --rm -v $(pwd)/dist:/dist coinos-ui-staging:0.1.0 bash -c 'cd app; pnpm stage; cp -rf dist/* /dist'

```


To run staging: 

```
docker-compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.staging.yml up

```