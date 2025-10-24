# Background Agent Environment for form-factor-eas
# Expo/React Native project with Bun package manager
# Supports: CI/CD workflows, linting, type checking, security scanning, smart commits

FROM node:18-slim

# Install essential build tools and dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    unzip \
    wget \
    ca-certificates \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# Install Bun (package manager)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Configure Git for smart commits
RUN git config --global user.email "agent@cursor.sh" && \
    git config --global user.name "Cursor Agent" && \
    git config --global init.defaultBranch main

# Set working directory
WORKDIR /workspace

# Copy package files for dependency installation
COPY package.json bun.lock* ./

# Install project dependencies
RUN bun install --frozen-lockfile

# Install global CI/CD tools
RUN bun add -g \
    typescript \
    eslint \
    depcheck \
    audit-ci \
    @expo/cli \
    eas-cli

# Install Supabase CLI (for database migrations)
RUN curl -fsSL https://supabase.com/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

# Copy TypeScript and ESLint configs
COPY tsconfig.json eslint.config.js babel.config.js tailwind.config.js* ./

# Copy the rest of the project
COPY . .

# Verify installations
RUN echo "=== Environment Setup Complete ===" && \
    echo "Node version: $(node --version)" && \
    echo "Bun version: $(bun --version)" && \
    echo "TypeScript version: $(tsc --version)" && \
    echo "Git version: $(git --version)" && \
    echo "Supabase CLI: $(supabase --version)" && \
    echo "EAS CLI: $(eas --version)"

# Expose common Expo ports
EXPOSE 8081 8082 19000 19001 19002

# Default command - keep container running for agent
CMD ["tail", "-f", "/dev/null"]
