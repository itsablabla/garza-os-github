#!/bin/bash
mkdir -p /data/chrome-profile
mkdir -p /var/log/supervisor
echo "Starting Claude Browser - Access at your Fly.io URL"
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
