FROM python:3.12-slim

# Install SSH client and other tools
RUN apt-get update && apt-get install -y \
    openssh-client \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create SSH directory
RUN mkdir -p /root/.ssh && chmod 700 /root/.ssh

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# SSH config for known hosts
RUN echo "Host *\n  StrictHostKeyChecking no\n  UserKnownHostsFile /dev/null\n  LogLevel ERROR" > /root/.ssh/config

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
