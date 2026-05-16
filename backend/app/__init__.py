import logging
import os
from pathlib import Path

import debugpy
from dotenv import load_dotenv

# Configure root logger so all app loggers (workforce, chat_service,
# toolkit_pool, toolkit_listen, etc.) emit INFO-level output to stderr.
# Uvicorn only configures its own "uvicorn.*" loggers — our named loggers
# inherit from the root which defaults to WARNING, silently dropping
# all INFO/DEBUG messages unless we set it up here.
# logging.basicConfig(
#     level=logging.INFO,
#     format="%(asctime)s | %(levelname)-7s | %(name)-20s | %(message)s",
#     datefmt="%H:%M:%S",
# )
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.router import register_routers

# Load .env from the backend directory (project-level config)
_backend_env = Path(__file__).resolve().parent.parent / ".env"
if _backend_env.exists():
    load_dotenv(dotenv_path=str(_backend_env), override=False)
    print(f"Loaded environment from {_backend_env}")

# Start debugpy on port 5678
try:
    debugpy.listen(("0.0.0.0", 5679))
    print("Debugpy listening on port 5679 - Attach your debugger now if needed")
except RuntimeError:
    print("Debugpy failed to start - Port 5679 is already in use. Skipping debugpy setup.")
    pass  # Port already in use (e.g. uvicorn reload spawned a new process)

# Initialize FastAPI with title
api = FastAPI(title="Eigent Multi-Agent System API")

# Add CORS middleware - for development, allow all origins
# For production, specify exact origins
api.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins in development
    allow_credentials=False,  # Must be False when allow_origins is ["*"]
    allow_methods=["GET", "POST", "DELETE", "OPTIONS", "PUT", "PATCH"],
    allow_headers=["*"],
    expose_headers=["*"],  # Required for SSE headers to be accessible
)

# Register all routers
register_routers(api)

# Serve static files from the frontend build
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    # Mount /assets specifically so StaticFiles doesn't swallow unknown routes
    assets_dir = os.path.join(static_dir, "assets")
    if os.path.exists(assets_dir):
        api.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    # Catch-all route for SPA - must come after all API routes
    @api.get("/{path:path}")
    async def serve_spa(path: str):
        # Serve actual files that exist in the static dir (favicon, manifest, etc.)
        file_path = os.path.join(static_dir, path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)

        # For all other paths (SPA client-side routes), serve index.html
        return FileResponse(os.path.join(static_dir, "index.html"))
