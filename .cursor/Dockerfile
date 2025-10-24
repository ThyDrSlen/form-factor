# Background Agent Environment for form-factor-eas
# Expo/React Native project with Bun package manager

FROM node:18-slim

# Install essential build tools and dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Set working directory
WORKDIR /workspace

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy the rest of the project
COPY . .

# Expose common Expo ports
EXPOSE 8081 8082 19000 19001 19002

# Default command - keep container running for agent
CMD ["tail", "-f", "/dev/null"]
