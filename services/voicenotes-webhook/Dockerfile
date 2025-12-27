FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir flask requests gunicorn

COPY voicenotes_webhook.py .

RUN mkdir -p /data/voicenotes

EXPOSE 8080

CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "2", "voicenotes_webhook:app"]
