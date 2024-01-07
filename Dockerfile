FROM debian:bookworm-slim
RUN apt-get update

# replace shell with bash so we can source files
RUN curl -sL https://deb.nodesource.com/setup_18.x | bash -
RUN apt install -y nodejs

RUN echo "NODE VERSION"
RUN node -v

RUN apt-get install -y  python3 \
                    python3-dev \
                    python3-pip \
                    python3-full \
                    npm \
                    zlib1g \
                    zlib1g-dev \
                    libjpeg-dev \
                    libpng-dev \
                    python3-pil \
                    python3-pil.imagetk \
                    ca-certificates \
                    curl \
                    wget \
                    build-essential \
                    libssl-dev \
                    libreadline-dev


RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
COPY . .

RUN pip3 install --upgrade pip
RUN pip3 install -r requirements.txt

RUN npm config set strict-ssl false
RUN npm config set registry http://registry.npmjs.org/
RUN npm install -g typescript
RUN npm install
RUN tsc -p .

RUN npm run test

EXPOSE 4500

ARG WHICH_GROOMER

RUN ["chmod", "+x", "/usr/src/app/util/start.sh"]
CMD sh -c "npm run $(echo ${WHICH_GROOMER})"
