# Medigent One — Frontend

React + TypeScript + Vite frontend for Medigent One, the single-model (Gemma 4 31B) multi-agent medical workspace.

## Development

```bash
npm install
npm run dev
```

The dev server defaults to `http://localhost:5173` and expects the backend on `http://localhost:3001` (configurable via `VITE_API_URL`).

## Build

```bash
npm run build
```

Outputs to `dist/`, which the backend Dockerfile bundles into the combined container.

## Environment

Copy `.env.example` to `.env.local` and fill in:

- `VITE_API_URL` — backend base URL
- `VITE_DEFAULT_MODEL_PLATFORM` / `VITE_DEFAULT_MODEL_TYPE` — defaults for the API key modal
- `VITE_ENCRYPTION_KEY` — must match the backend `ENCRYPTION_KEY` for credential encryption

## Tech

- React 19, Vite 7, TypeScript 5.9
- TailwindCSS 4
- Zustand (state), Zod (schemas), Framer Motion (animation)
- Radix UI primitives via shadcn-style components
