FROM debian:buster-slim
RUN apt-get update
RUN apt-get install -y  python3 \
                    python3-dev \
                    python3-pip \
                    npm \
                    nodejs \
                    zlib1g \
                    zlib1g-dev \
                    libjpeg-dev \
                    libpng-dev \
                    python3-pil \
                    python3-pil.imagetk

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

CMD sh -c "npm run $(echo ${WHICH_GROOMER})"
