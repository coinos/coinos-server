# First stage: build the ark-wallet-daemon binary
FROM golang:1.25.3 AS builder

ARG VERSION
ARG TARGETOS
ARG TARGETARCH

ARG BRANCH=v0.8.4

WORKDIR /app

RUN git clone https://github.com/arkade-os/arkd.git && cd arkd && git checkout ${BRANCH}

RUN mkdir -p bin && cd arkd && \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -ldflags="-X 'main.Version=${VERSION}'" -o /app/bin/arkd-wallet ./cmd/arkd-wallet/main.go

# Second stage: minimal runtime image
FROM alpine:3.22

RUN apk update && apk upgrade

WORKDIR /app

COPY --from=builder /app/bin/arkd-wallet /app/

ENV PATH="/app:${PATH}"
ENV ARK_WALLET_DATADIR=/app/wallet-data

VOLUME /app/wallet-data

ENTRYPOINT [ "arkd-wallet" ]