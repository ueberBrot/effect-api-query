FROM mcr.microsoft.com/devcontainers/typescript-node:5.1.2-24-bookworm@sha256:3c84ba4842b181e699f9494842dbf737a3c96cc3a6028dd83f9a9d9b6f059d1a

ENV NODE_VERSION=24.22.1

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN set -eu; \
    case "$(dpkg --print-architecture)" in \
        amd64) \
            node_arch=x64; \
            node_sha=6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6 ;; \
        arm64) \
            node_arch=arm64; \
            node_sha=dbabf7a1cbf947e6059ffad2c27b80041db97dea1e553b62afdee7f13fca336e ;; \
        *) echo "Unsupported architecture" >&2; exit 1 ;; \
    esac; \
    curl --fail --silent --show-error --location \
        --output /tmp/node.tar.xz \
        "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"; \
    printf '%s  /tmp/node.tar.xz\n' "${node_sha}" \
        | sha256sum --check --strict -; \
    tar -xJf /tmp/node.tar.xz -C /usr/local \
        --strip-components=1 --no-same-owner; \
    rm /tmp/node.tar.xz; \
    test "$(node --version)" = "v${NODE_VERSION}"
