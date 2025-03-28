# Use an official Node.js Alpine image
FROM node:23-alpine

# Install xmlstarlet via the package manager
RUN apk add --no-cache xmlstarlet

# Set the working directory in the container
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application code
COPY . .

# Expose port 3000
EXPOSE 3000

# Run the Node.js application
CMD ["node", "index.js"]