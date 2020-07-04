FROM node:13-alpine
RUN apk --no-cache add --virtual native-deps python3 build-base

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
COPY . .

RUN pip3 install -r requirements.txt

RUN npm install -g typescript
RUN npm install
RUN tsc -p .
RUN which python3

EXPOSE 4500
CMD ["npm", "start"]