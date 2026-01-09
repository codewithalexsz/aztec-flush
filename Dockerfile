FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files first
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install ethers@6 dotenv

# Copy source code
COPY . .

# Environment variables will be passed via docker-compose or run command
# Set partial defaults if needed, but critical ones (PRIVATE_KEY) should be runtime
ENV NODE_ENV=production

# Run the bot
CMD ["node", "flush.js"]

