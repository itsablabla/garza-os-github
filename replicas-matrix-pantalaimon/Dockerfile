FROM matrixdotorg/pantalaimon:latest

COPY pantalaimon.conf /etc/pantalaimon/pantalaimon.conf

EXPOSE 8008

ENTRYPOINT ["pantalaimon"]
CMD ["-c", "/etc/pantalaimon/pantalaimon.conf", "--data-path", "/data"]
