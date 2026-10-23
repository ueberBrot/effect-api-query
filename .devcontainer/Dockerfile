FROM node:24.22.1-bookworm@sha256:6449e19d8184d84062525b6a7524def03146c2cb04a7f08b076680d0e8e4240a AS node-runtime

FROM mcr.microsoft.com/devcontainers/typescript-node:5.1.2-24-bookworm@sha256:3c84ba4842b181e699f9494842dbf737a3c96cc3a6028dd83f9a9d9b6f059d1a

ENV NODE_VERSION=24.22.1

COPY --from=node-runtime /usr/local/ /usr/local/
