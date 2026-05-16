/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_ENCRYPTION_KEY: string
}

// Prevent TS6196: ImportMetaEnv is declared but never used
export type { ImportMetaEnv }

export const env = {
  VITE_API_URL: import.meta.env.VITE_API_URL || '',
  VITE_ENCRYPTION_KEY: import.meta.env.VITE_ENCRYPTION_KEY || '',
} as const
