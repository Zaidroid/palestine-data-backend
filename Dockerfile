FROM node:22-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src ./src
COPY scripts ./scripts
COPY public ./public

# Create empty directories if they don't exist (for safety)
RUN mkdir -p public/data/unified

# Expose port
EXPOSE 7860

# Start the application
# Note: Hugging Face Spaces expects the app to listen on port 7860
ENV PORT=7860
CMD ["npm", "run", "start-api"]
