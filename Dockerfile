# Use an official Node.js Alpine image
FROM node:24-alpine

# Declare the build argument
ARG API_KEY

# Set the environment variable for runtime
ENV API_KEY=$API_KEY

# install xmllint, xmlstarlet and the GNU iconv utility
RUN apk add --no-cache \
      libxml2-utils \
      xmlstarlet \
      gnu-libiconv

# Set the working directory in the container
WORKDIR /app

# preload libiconv so programs pick up the GNU version:
ENV LD_PRELOAD=/usr/lib/preloadable_libiconv.so

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
#RUN npm install
RUN npm install --production --legacy-peer-deps

# Copy the rest of the application code
COPY . .

# Expose port 3000
EXPOSE 3000

# Run the Node.js application
CMD ["node", "index.js"]