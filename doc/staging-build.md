To build staging locally do: 

```bash
docker build -t coinos-server-staging:0.0.1 -f staging.Dockerfile .
```


Also build the UI for staging:  

```
docker build -t coinos-ui-staging:0.1.0 -f Dockerfile.stage .

docker run --rm --mount type=bind,source="$(pwd)",destination=/app --user $UID:$GID coinos-ui-staging:0.1.0 pnpm stage
```


To run staging: 

```
docker-compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.staging.yml up

```