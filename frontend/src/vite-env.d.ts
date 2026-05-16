/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_DEFAULT_MODEL_PLATFORM: string
  readonly VITE_DEFAULT_MODEL_TYPE: string
  readonly VITE_DEFAULT_MODEL_API_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
