FROM ubuntu:24.04

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    python3 \
    python3-pip \
    python3-venv \
    nodejs \
    npm \
    wget \
    unzip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install flyctl
RUN curl -L https://fly.io/install.sh | sh
ENV PATH="/root/.fly/bin:${PATH}"

# Create workspace
RUN mkdir -p /workspace
WORKDIR /workspace

# Git config
RUN git config --global user.email "garza-dc@garzahive.com" && \
    git config --global user.name "GARZA Desktop Commander"

# Create a simple MCP server (placeholder until we set up Desktop Commander correctly)
RUN mkdir -p /app
COPY start.sh /app/start.sh
COPY healthcheck.sh /app/healthcheck.sh
RUN chmod +x /app/start.sh /app/healthcheck.sh

# Expose ports
EXPOSE 6000 6001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD /app/healthcheck.sh

CMD ["/app/start.sh"]