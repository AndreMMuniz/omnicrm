# syntax=docker/dockerfile:1
FROM python:3.13-slim-bookworm AS base

# Install system dependencies required for native Python packages.
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first to maximize Docker layer cache reuse.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application source and enable the container entrypoint.
COPY . .
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 8000

# The entrypoint runs migrations; the CMD defines the default API process.
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
