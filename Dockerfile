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

# Node.js setup
RUN curl -sL https://deb.nodesource.com/setup_18.x | bash - \
  && apt-get update && apt-get install -y nodejs \
  && npm config set strict-ssl false \
  && npm config set registry http://registry.npmjs.org/ \
  && npm install -g typescript

# ---------- Stage 2: Build ----------
FROM base AS build

RUN npm install
RUN tsc -p .

# ---------- Stage 3: Test ----------
FROM build AS test

RUN npm run test

# ---------- Stage 4: Final Deploy Image ----------
FROM base AS deploy

COPY --from=build /usr/src/app /usr/src/app

EXPOSE 4500
ARG WHICH_GROOMER
RUN chmod +x /usr/src/app/util/start.sh

CMD sh -c "npm run $(echo ${WHICH_GROOMER})"