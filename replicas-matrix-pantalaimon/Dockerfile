FROM matrixdotorg/pantalaimon:latest

# Bake the config into the image at a stable location; the entrypoint copies
# it into /data on first boot since CF Containers gives us an empty /data each
# cold start and pantalaimon's image defaults expect /data/pantalaimon.conf.
COPY pantalaimon.conf /pantalaimon.conf.template

EXPOSE 8008

# Foreground execution: `exec` replaces the shell with pantalaimon so a crash
# actually exits the container (CF marks it failed) instead of being silently
# hidden behind a sleep loop. `set -ex` echoes each step for observability via
# CF Container stdout forwarding.
ENTRYPOINT ["/bin/sh", "-c"]
CMD ["set -ex; mkdir -p /data; cp -n /pantalaimon.conf.template /data/pantalaimon.conf; ls -la /data; exec pantalaimon -c /data/pantalaimon.conf --data-path /data --log-level info"]
