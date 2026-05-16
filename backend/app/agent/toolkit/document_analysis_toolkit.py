

import os
from typing import Union

from camel.toolkits import FileToolkit as BaseFileToolkit
from camel.toolkits.function_tool import FunctionTool

from app.agent.toolkit.abstract_toolkit import AbstractToolkit
from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import (
    auto_listen_toolkit,
    listen_toolkit,
)


@auto_listen_toolkit(BaseFileToolkit)
class DocumentAnalysisToolkit(BaseFileToolkit, AbstractToolkit):
    """Toolkit for reading and analyzing documents (PDF, DOCX, etc.).

    Uses camel-ai's FileToolkit.read_file under the hood, which
    leverages MarkItDown to convert documents to Markdown for analysis.

    Supported formats: PDF, Word (.doc/.docx), Excel (.xls/.xlsx),
    PowerPoint (.ppt/.pptx), HTML, EPUB, CSV, JSON, XML, TXT, images
    (OCR), and ZIP archives.
    """

    agent_name: str = Agents.radiologist

    def __init__(
        self,
        api_task_id: str,
        working_directory: str | None = None,
        timeout: float | None = None,
    ) -> None:
        if working_directory is None:
            working_directory = env(
                "file_save_path", os.path.expanduser("~/Downloads")
            )
        super().__init__(
            working_directory=working_directory,
            timeout=timeout,
        )
        self.api_task_id = api_task_id

    @listen_toolkit(
        BaseFileToolkit.read_file,
        lambda _, file_paths: (
            f"Reading document(s): {file_paths}"
        ),
    )
    def read_file(
        self,
        file_paths: Union[str, list[str]],
    ) -> Union[str, dict[str, str]]:
        r"""Read and extract content from one or more document files.

        Converts various file formats to Markdown text for analysis.
        Use this tool when you receive PDF files, Word documents, or
        other non-image document files that cannot be processed by
        image analysis tools.

        Supported formats include:
        - PDF (.pdf)
        - Microsoft Office: Word (.doc, .docx), Excel (.xls, .xlsx),
          PowerPoint (.ppt, .pptx)
        - EPUB (.epub)
        - HTML (.html, .htm)
        - Images (.jpg, .jpeg, .png) for OCR
        - Text-based formats (.csv, .json, .xml, .txt, .md)
        - ZIP archives (.zip)

        Args:
            file_paths (Union[str, List[str]]): A single file path or
                a list of file paths to read.

        Returns:
            Union[str, Dict[str, str]]:
                - Single file: content as a string in Markdown format.
                - Multiple files: dictionary mapping file paths to
                  their Markdown content.
        """
        return super().read_file(file_paths)

    def get_tools(self) -> list[FunctionTool]:
        """Returns only the read_file tool for document analysis.

        Unlike the full FileToolkit, this toolkit only exposes the
        read_file method to keep the agent focused on document
        reading/analysis without write or edit capabilities.
        """
        return [
            FunctionTool(self.read_file),
        ]
