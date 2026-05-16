import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chatStore';
import { useProjectStore } from '@/stores/projectStore';
import {
  ChevronRight,
  Download,
  File,
  FileJson,
  FileText,
  FileType,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';

interface ProjectFile {
  name: string;
  path: string;
  size: number;
  created_at: string;
  is_directory: boolean;
}

interface ProjectFilesResponse {
  project_id: string;
  task_id: string | null;
  files: ProjectFile[];
  total_count: number;
}

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatDate = (isoString: string): string => {
  const date = new Date(isoString);
  return date.toLocaleString();
};

const getFileIcon = (filename: string) => {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'svg':
    case 'webp':
      return ImageIcon;
    case 'pdf':
      return FileType;
    case 'txt':
    case 'md':
    case 'log':
      return FileText;
    case 'json':
    case 'xml':
      return FileJson;
    default:
      return File;
  }
};

// Group files by directory
const groupFilesByDirectory = (
  files: ProjectFile[],
): Record<string, ProjectFile[]> => {
  const groups: Record<string, ProjectFile[]> = {};

  files.forEach((file) => {
    // Normalize path separators
    const normalizedPath = file.path.replace(/\\/g, '/');
    const parts = normalizedPath.split('/');

    // Get directory (everything except the filename)
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';

    if (!groups[dir]) {
      groups[dir] = [];
    }
    groups[dir].push(file);
  });

  return groups;
};

// Format directory name for display, using task's user prompt if available
const formatDirectoryName = (
  dir: string,
  messages: { id: string; role: string; content: string }[],
): string => {
  if (!dir) return 'Root';

  // Extract the folder name (last part of path)
  const parts = dir.split('/');
  const folderName = parts[parts.length - 1] || dir;

  // Try to extract task ID from folder name (e.g., "task_task-1771688301542" -> "task-1771688301542")
  const taskMatch = folderName.match(/^task_(.+)$/);
  if (taskMatch) {
    const taskId = taskMatch[1];

    // Extract timestamp from task ID (e.g., "task-1771688301542" -> "1771688301542")
    const timestampMatch = taskId.match(/^task-(\d+)$/);
    if (timestampMatch) {
      const taskTimestamp = timestampMatch[1];

      // Find user message with matching timestamp in ID (e.g., "user-1771688301539")
      // Allow small difference (within 10ms) due to timing variations
      const taskTime = parseInt(taskTimestamp, 10);
      const userMessage = messages.find((m) => {
        if (m.role !== 'user') return false;
        const msgMatch = m.id.match(/^user-(\d+)$/);
        if (!msgMatch) return false;
        const msgTime = parseInt(msgMatch[1], 10);
        // Match if within 100ms of each other
        return Math.abs(taskTime - msgTime) < 100;
      });

      if (userMessage?.content) {
        // Truncate if too long (max 50 chars)
        const content = userMessage.content.trim();
        return content.length > 50 ? content.slice(0, 47) + '...' : content;
      }
    }
  }

  // Fallback to the folder name if no message found
  return folderName;
};

export const FileOutputPanel: React.FC = () => {
  const { currentProjectId } = useChatStore();
  const { projects } = useProjectStore();

  // Get messages from current project
  const currentProject = projects.find((p) => p.id === currentProjectId);
  const projectMessages = currentProject?.messages || [];
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<ProjectFile | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'preview'>('list');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );

  const fetchFiles = async () => {
    if (!currentProjectId) {
      setError('No project selected');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.get<ProjectFilesResponse>(
        `/projects/${currentProjectId}/files`,
      );
      setFiles(response.data.files);
    } catch (err) {
      console.error('Failed to fetch files:', err);
      setError('Failed to load files');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, [currentProjectId]);

  const handleViewFile = async (file: ProjectFile) => {
    if (!currentProjectId) return;

    setSelectedFile(file);
    setViewMode('preview');

    const ext = file.name.split('.').pop()?.toLowerCase();
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'];

    if (imageExts.includes(ext || '')) {
      try {
        const response = await apiClient.get(
          `/projects/${currentProjectId}/files/${encodeURIComponent(file.path)}`,
          { responseType: 'blob' },
        );
        const url = URL.createObjectURL(response.data);
        setFileContent(url);
      } catch (err) {
        console.error('Failed to load image:', err);
        setFileContent(null);
      }
    } else if (ext === 'md') {
      try {
        const response = await apiClient.get(
          `/projects/${currentProjectId}/files/${encodeURIComponent(file.path)}`,
          { responseType: 'text' },
        );
        setFileContent(response.data);
      } catch (err) {
        console.error('Failed to load markdown:', err);
        setFileContent(null);
      }
    } else {
      setFileContent(null);
    }
  };

  const handleDownload = async (file: ProjectFile) => {
    if (!currentProjectId) return;

    try {
      const response = await apiClient.get(
        `/projects/${currentProjectId}/files/${encodeURIComponent(file.path)}`,
        { responseType: 'blob' },
      );

      const url = URL.createObjectURL(response.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download file:', err);
    }
  };

  const handleDelete = async (file: ProjectFile) => {
    if (!currentProjectId) return;

    const confirmed = window.confirm(`Delete "${file.name}"?`);
    if (!confirmed) return;

    try {
      await apiClient.delete(
        `/projects/${currentProjectId}/files/${encodeURIComponent(file.path)}`,
      );
      // Refresh file list
      fetchFiles();
      if (selectedFile?.path === file.path) {
        setSelectedFile(null);
        setViewMode('list');
      }
    } catch (err) {
      console.error('Failed to delete file:', err);
      alert('Failed to delete file');
    }
  };

  if (!currentProjectId) {
    return (
      <div className="flex flex-col items-center justify-center py-23 text-center px-4">
        <div className="w-12 h-12 rounded-full bg-background-secondary border border-border flex items-center justify-center mb-4">
          <FolderOpen className="w-6 h-6 text-foreground-muted" />
        </div>
        <p className="text-foreground font-medium text-sm">No files output</p>
        <p className="text-foreground-muted text-xs mt-1">
          Files generated from completed tasks will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Project Files</h3>
          <span className="text-xs text-foreground-muted">
            ({files.length})
          </span>
        </div>
        <button
          onClick={fetchFiles}
          disabled={loading}
          className={cn(
            'p-1.5 rounded hover:bg-background-secondary transition-colors',
            loading && 'animate-spin',
          )}
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex">
        {/* File List */}
        <div
          className={cn(
            'overflow-y-auto',
            viewMode === 'preview' && selectedFile ? 'hidden' : 'w-full',
          )}
        >
          {loading && files.length === 0 ? (
            <div className="flex items-center justify-center h-32">
              <RefreshCw className="w-5 h-5 animate-spin text-foreground-muted" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-32 text-sm text-red-500">
              <p>{error}</p>
              <button onClick={fetchFiles} className="text-xs underline mt-1">
                Retry
              </button>
            </div>
          ) : files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-4">
              <div className="w-12 h-12 rounded-full bg-background-secondary border border-border flex items-center justify-center mb-4">
                <File className="w-6 h-6 text-foreground-muted" />
              </div>
              <p className="text-foreground font-medium text-sm">
                No files output
              </p>
              <p className="text-foreground-muted text-xs mt-1">
                Files generated from completed tasks will appear here.
              </p>
            </div>
          ) : (
            (() => {
              const groupedFiles = groupFilesByDirectory(files);
              const directories = Object.keys(groupedFiles);
              const hasMultipleDirs =
                directories.filter((d) => d !== '').length > 1;

              // If all files are in a single directory (or no directory), show flat list
              if (!hasMultipleDirs) {
                return (
                  <div className="divide-y divide-border">
                    {files.map((file) => {
                      const Icon = getFileIcon(file.name);
                      return (
                        <div
                          key={file.path}
                          className={cn(
                            'flex items-center gap-2 px-3 py-2 hover:bg-background-secondary cursor-pointer',
                            selectedFile?.path === file.path &&
                              'bg-background-secondary',
                          )}
                          onClick={() => handleViewFile(file)}
                        >
                          <Icon className="w-4 h-4 text-foreground-muted shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate">{file.name}</p>
                            <p className="text-xs text-foreground-muted">
                              {formatFileSize(file.size)} •{' '}
                              {formatDate(file.created_at)}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDownload(file);
                              }}
                              className="p-1 rounded hover:bg-background text-foreground-muted hover:text-foreground"
                              title="Download"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(file);
                              }}
                              className="p-1 rounded hover:bg-background text-foreground-muted hover:text-red-500"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              }

              // Multiple directories - show nested folders
              return (
                <div className="divide-y divide-border">
                  {directories.sort().map((dir) => {
                    const dirFiles = groupedFiles[dir];
                    const isExpanded = expandedFolders.has(dir);

                    return (
                      <div key={dir || 'root'}>
                        {/* Folder header */}
                        <div
                          className="flex items-center gap-2 px-3 py-2 hover:bg-background-secondary cursor-pointer bg-background-secondary/50"
                          onClick={() => {
                            setExpandedFolders((prev) => {
                              const next = new Set(prev);
                              if (next.has(dir)) {
                                next.delete(dir);
                              } else {
                                next.add(dir);
                              }
                              return next;
                            });
                          }}
                        >
                          <ChevronRight
                            className={cn(
                              'w-4 h-4 text-foreground-muted transition-transform',
                              isExpanded && 'rotate-90',
                            )}
                          />
                          {isExpanded ? (
                            <FolderOpen className="w-4 h-4 text-amber-500" />
                          ) : (
                            <Folder className="w-4 h-4 text-amber-500" />
                          )}
                          <span className="text-sm font-medium">
                            {formatDirectoryName(dir, projectMessages)}
                          </span>
                          <span className="text-xs text-foreground-muted">
                            ({dirFiles.length})
                          </span>
                        </div>

                        {/* Files in folder */}
                        {isExpanded && (
                          <div className="bg-background/50">
                            {dirFiles.map((file) => {
                              const Icon = getFileIcon(file.name);
                              return (
                                <div
                                  key={file.path}
                                  className={cn(
                                    'flex items-center gap-2 px-3 py-2 pl-10 hover:bg-background-secondary cursor-pointer',
                                    selectedFile?.path === file.path &&
                                      'bg-background-secondary',
                                  )}
                                  onClick={() => handleViewFile(file)}
                                >
                                  <Icon className="w-4 h-4 text-foreground-muted shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm truncate">
                                      {file.name}
                                    </p>
                                    <p className="text-xs text-foreground-muted">
                                      {formatFileSize(file.size)} •{' '}
                                      {formatDate(file.created_at)}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDownload(file);
                                      }}
                                      className="p-1 rounded hover:bg-background text-foreground-muted hover:text-foreground"
                                      title="Download"
                                    >
                                      <Download className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDelete(file);
                                      }}
                                      className="p-1 rounded hover:bg-background text-foreground-muted hover:text-red-500"
                                      title="Delete"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()
          )}
        </div>

        {/* File Preview */}
        {viewMode === 'preview' && selectedFile && (
          <div className="w-full flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-background-secondary">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  onClick={() => {
                    setViewMode('list');
                    setSelectedFile(null);
                    if (fileContent?.startsWith('blob:')) {
                      URL.revokeObjectURL(fileContent);
                    }
                    setFileContent(null);
                  }}
                  className="p-1 rounded hover:bg-background text-foreground-muted hover:text-foreground"
                  title="Back to files"
                >
                  <ChevronRight className="w-4 h-4 rotate-180" />
                </button>
                <span className="text-sm font-medium truncate">
                  {selectedFile.name}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleDownload(selectedFile)}
                  className="p-1 rounded hover:bg-background"
                  title="Download"
                >
                  <Download className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-3 bg-background">
              {selectedFile.name.match(/\.(jpg|jpeg|png|gif|svg|webp)$/i) &&
              fileContent ? (
                <img
                  src={fileContent}
                  alt={selectedFile.name}
                  className="max-w-full h-auto"
                />
              ) : selectedFile.name.match(/\.md$/i) && fileContent ? (
                <div className="markdown-content text-sm">
                  <ReactMarkdown>{fileContent}</ReactMarkdown>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-foreground-muted">
                  <File className="w-16 h-16 mb-2 opacity-30" />
                  <p className="text-sm">Preview not available</p>
                  <button
                    onClick={() => handleDownload(selectedFile)}
                    className="mt-2 text-xs underline"
                  >
                    Download to view
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
