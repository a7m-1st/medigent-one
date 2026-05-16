# Stage 1: Build Frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /frontend

# Copy package files
COPY frontend/package.json frontend/package-lock.json ./

# Install dependencies
RUN npm ci

# Copy frontend source
COPY frontend/ ./

# Build the frontend
RUN npm run build

# Stage 2: Build Backend
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS backend-builder

WORKDIR /app

# Install build dependencies
RUN apt-get update -o Acquire::Retries=3 && apt-get install -y --no-install-recommends \
    git \
    curl \
    build-essential \
    gcc \
    python3-dev \
    && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
    && rm -rf /var/lib/apt/lists/*

# Add Rust to PATH
ENV PATH="/root/.cargo/bin:$PATH"

# Disable bytecode transfer during compilation
ENV UV_COMPILE_BYTECODE=0

# Copy from the cache instead of linking
ENV UV_LINK_MODE=copy

# Copy dependency files first
COPY backend/pyproject.toml backend/uv.lock ./

# Install the project's dependencies
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --no-install-project --no-dev

# Copy backend source
COPY backend/ /app

# Install the project
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --no-dev

# Copy frontend build to backend static folder
COPY --from=frontend-builder /frontend/dist /app/app/static

# Place executables in the environment at the front of the path
ENV PATH="/app/.venv/bin:$PATH"

# Expose ports (8000 for FastAPI, 5678 for debugpy)
EXPOSE 8000 5678

# Set Python path
ENV PYTHONPATH=/app

# Run the FastAPI server
CMD ["uvicorn", "app:api", "--host", "0.0.0.0", "--port", "8000"]
