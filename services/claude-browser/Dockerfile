FROM node:20-slim

RUN apt-get update && apt-get install -y \
    chromium \
    chromium-sandbox \
    x11vnc \
    xvfb \
    fluxbox \
    novnc \
    websockify \
    supervisor \
    xdotool \
    scrot \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN mkdir -p /data/chrome-profile
RUN mkdir -p /etc/supervisor/conf.d

COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY start.sh /start.sh
COPY api.js /app/api.js
RUN chmod +x /start.sh

EXPOSE 8080
CMD ["/start.sh"]
