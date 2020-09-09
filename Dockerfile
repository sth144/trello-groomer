FROM node:13-alpine AS base
RUN apk --no-cache add --virtual native-deps python3 python3-dev build-base

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
COPY . .

RUN which python3
# RUN pip3 install --upgrade pip
# RUN pip3 install wheel
# RUN pip3 install -r requirements.txt
# RUN pip3 install numpy
# RUN pip3 install scipy
# RUN pip install pandas
# RUN pip3 install scikit-learn


RUN npm install -g typescript
RUN npm install
RUN tsc -p .

RUN npm run test

EXPOSE 4500

FROM base as todo
CMD ["npm", "run", "start-todo-groomer"]

FROM base as work
CMD ["npm", "run", "start-work-groomer"]