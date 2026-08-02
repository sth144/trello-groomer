# ---------- Stage 1: Base (for reuse) ----------
FROM python:3.12 AS base

WORKDIR /usr/src/app
COPY . .
COPY requirements.txt .

RUN apt-get update && apt-get install -y \
  apache2 \
  cmake \
  libblas-dev \
  libopenblas-dev \
  liblapack-dev \
  gfortran \
  curl \
  gnupg \
  && rm -rf /var/lib/apt/lists/*

RUN pip install --upgrade pip setuptools wheel numpy
RUN pip install -r requirements.txt
RUN pip3 install audible

# Node.js setup
RUN curl -sL https://deb.nodesource.com/setup_18.x | bash - \
  && apt-get update && apt-get install -y nodejs \
  && npm config set strict-ssl false \
  && npm config set registry http://registry.npmjs.org/

# ---------- Stage 2: Build ----------
FROM base AS build

RUN npm install
RUN npx tsc -p .

# ---------- Stage 3: Test ----------
FROM build AS test

RUN npm run test

# ---------- Stage 4: Client build ----------
# The Angular client keeps its own package.json and toolchain. Building it in a separate stage means
# only the emitted bundle reaches the deploy image, not the ~300MB of Angular dependencies.
#
# Pinned to $BUILDPLATFORM on purpose. CI builds this image for arm/v7, arm64 and amd64 under QEMU
# (see .travis.yml), and the Angular toolchain has no business running emulated three times to emit
# the same platform-independent JavaScript. This also decouples the client from the base image's
# Node 18, which only barely satisfies Angular 19's engine requirement.
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS client-build

WORKDIR /client
# dependencies first, so editing client source does not invalidate the install layer
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---------- Stage 5: Final Deploy Image ----------
FROM base AS deploy

COPY --from=build /usr/src/app /usr/src/app
# the API serves this directory when it exists; without it the API still runs, just headless
COPY --from=client-build /client/dist/client/browser /usr/src/app/client/dist/client/browser

EXPOSE 4500
ARG WHICH_GROOMER
RUN chmod +x /usr/src/app/util/start.sh

CMD sh -c "npm run $(echo ${WHICH_GROOMER})"
