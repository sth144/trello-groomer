FROM debian:buster-slim
RUN apt update
RUN apt install -y  python3 \
                    python3-dev \
                    python3-pip \
                    npm \
                    nodejs

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
COPY . .

RUN pip3 install --upgrade pip
RUN pip3 install -r requirements.txt


RUN npm install -g typescript
RUN npm install
RUN tsc -p .

RUN npm run test

EXPOSE 4500

ARG WHICH_GROOMER

CMD sh -c "npm run $(echo ${WHICH_GROOMER})"
