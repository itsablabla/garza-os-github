FROM python:3.12-slim

# 1Password CLI (op) for saving bot tokens to the vault
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSLo /tmp/op.zip https://cache.agilebits.com/dist/1P/op2/pkg/v2.30.0/op_linux_amd64_v2.30.0.zip \
    && unzip -o /tmp/op.zip -d /usr/local/bin \
    && chmod +x /usr/local/bin/op \
    && rm -f /tmp/op.zip

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

EXPOSE 8080

# Non-root user for good practice
RUN useradd -m botmaker
USER botmaker

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
