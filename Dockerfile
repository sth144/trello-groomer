# Base image with Python 3
FROM python:3

# Set working directory
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
# Copy the project files to the working directory
COPY . .

# Copy requirement.txt to working directory
COPY requirements.txt .

# Install Python dependencies
RUN pip install --upgrade pip
RUN apt-get install cmake
RUN pip install --upgrade setuptools wheel
RUN pip install numpy

RUN pip install -r requirements.txt

# Install Node.js and npm
RUN curl -sL https://deb.nodesource.com/setup_18.x | bash -
RUN apt-get install -y nodejs

# Install TypeScript
RUN npm config set strict-ssl false
RUN npm config set registry http://registry.npmjs.org/
RUN npm install -g typescript
RUN npm install

# Run TypeScript compiler
RUN tsc -p .

RUN npm run test

EXPOSE 4500

ARG WHICH_GROOMER

RUN ["chmod", "+x", "/usr/src/app/util/start.sh"]
CMD sh -c "npm run $(echo ${WHICH_GROOMER})"
