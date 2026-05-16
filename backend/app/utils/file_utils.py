"""File system utilities."""

import base64
import logging
import os
import re
import uuid
from pathlib import Path

from app.component.environment import env
from app.model.chat import Chat

logger = logging.getLogger("file_utils")

MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB limit


def get_working_directory(options: Chat, task_lock=None) -> str:
    """
    Get the correct working directory for file operations.
    Environment variable or default path.
    """

    if (
        task_lock is not None
        and options is not None
        and getattr(task_lock, "current_task_id", None)
        and task_lock.current_task_id != options.task_id
    ):
        save_path = (
            Path.home()
            / "medgemma"
            / f"project_{options.project_id}"
            / f"task_{task_lock.current_task_id}"
        )
        save_path.mkdir(parents=True, exist_ok=True)
        return str(save_path)

    default_path = options.file_save_path() if options else "uploads"
    return env("file_save_path", default_path)


def is_base64_image(data: str) -> bool:
    """Check if a string is a base64 encoded image data URL."""
    return data.startswith("data:image/")


def is_base64_file(data: str) -> bool:
    """Check if a string is a base64 encoded file data URL (image or PDF)."""
    return data.startswith("data:image/") or data.startswith(
        "data:application/pdf"
    )


def save_base64_file(
    base64_data: str,
    save_dir: str,
    filename_prefix: str = "upload",
) -> str:
    """
    Save a base64 encoded file (image or PDF) to disk.

    Args:
        base64_data: Base64 data URL (e.g., "data:image/png;base64,iVBORw0..." or "data:application/pdf;base64,...")
        save_dir: Directory to save the file
        filename_prefix: Prefix for the generated filename

    Returns:
        Absolute path to the saved file

    Raises:
        ValueError: If the data is not a valid base64 file
    """
    # Try to match image first
    match = re.match(r"data:image/(\w+);base64,(.+)", base64_data)
    file_type = "image"

    if not match:
        # Try to match PDF
        match = re.match(r"data:application/pdf;base64,(.+)", base64_data)
        file_type = "pdf"

    if not match:
        raise ValueError("Invalid base64 file data URL")

    if file_type == "image":
        file_format = match.group(1).lower()
        file_data = match.group(2)
        # Normalize format extension
        ext_map = {"jpeg": "jpg", "png": "png", "gif": "gif", "webp": "webp"}
        ext = ext_map.get(file_format, file_format)
    else:
        # PDF
        file_data = match.group(1)
        ext = "pdf"

    # Generate unique filename
    unique_id = uuid.uuid4().hex[:8]
    filename = f"{filename_prefix}_{unique_id}.{ext}"

    # Ensure save directory exists
    save_path = Path(save_dir)
    save_path.mkdir(parents=True, exist_ok=True)

    # Decode and save
    file_path = save_path / filename
    try:
        decoded_data = base64.b64decode(file_data)
        with open(file_path, "wb") as f:
            f.write(decoded_data)

        logger.info(f"Saved file: {file_path} ({len(decoded_data)} bytes)")
        return str(file_path.absolute())
    except Exception as e:
        logger.error(f"Failed to save file: {e}")
        raise ValueError(f"Failed to decode and save file: {e}")


def process_attaches(
    attaches: list[str],
    save_dir: str,
) -> list[str]:
    """
    Process a list of attachments, converting base64 files to file paths.

    Args:
        attaches: List of file paths or base64 data URLs
        save_dir: Directory to save converted files

    Returns:
        List of file paths (base64 files are saved and converted to paths)
    """
    processed = []
    for i, attach in enumerate(attaches):
        if is_base64_file(attach):
            # Check file size before processing
            try:
                header, b64data = attach.split(",", 1)
                decoded = base64.b64decode(b64data)
                if len(decoded) > MAX_FILE_SIZE:
                    logger.warning(
                        f"Skipping file_{i + 1}: exceeds {MAX_FILE_SIZE} bytes limit"
                    )
                    continue
            except Exception as e:
                logger.warning(f"Could not check file size: {e}")

            try:
                file_path = save_base64_file(
                    attach,
                    save_dir,
                    filename_prefix=f"file_{i + 1}",
                )
                processed.append(file_path)
            except ValueError as e:
                logger.warning(f"Skipping invalid base64 file: {e}")
        else:
            # Already a file path, use as-is
            processed.append(attach)

    return processed
