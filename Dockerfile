FROM node:latest

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
COPY . .

RUN npm install -g typescript
RUN npm install
RUN tsc -p .
EXPOSE 4500
CMD ["npm", "start"]