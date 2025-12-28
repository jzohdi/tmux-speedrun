# PostgreSQL for local development
FROM postgres:16-alpine

# Copy initialization script
COPY docker/init.sql /docker-entrypoint-initdb.d/init.sql

# Set environment variables
ENV POSTGRES_USER=tmux
ENV POSTGRES_PASSWORD=tmux
ENV POSTGRES_DB=tmux_speedrun

# Expose PostgreSQL port
EXPOSE 5432

