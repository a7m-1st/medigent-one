# Medigent One: One Model. One Panel of Specialists. For One Patient.

The second coming of Medigent. Where the previous version stitched together a frontier cloud orchestrator (Gemini) and a smaller medical specialist (MedGemma), **Medigent One collapses the whole stack into a single open model: Gemma 4 31B Instruct**. One model now plays every role on the multi-agent panel — triage, clinical research, differential diagnosis, image analysis, and synthesis.

<img width="1600" height="900" alt="image" src="https://github.com/user-attachments/assets/f0e29b7a-092d-4c11-93f5-51cc10d1693d" />

## Why "One"

- **One model** — Gemma 4 31B replaces the dual Gemini + MedGemma split. No more two-cloud dependency.
- **One panel** — six CAMEL-AI specialist agents (coordinator, clinical researcher, image analyst, differential, summarizer, triage) all backed by the same Gemma 4 weights.
- **One patient** — the architecture is shaped for the singular clinical encounter, not for fleet-scale throughput.

## Project Structure

- `backend/` — FastAPI backend with the CAMEL-AI multi-agent workforce
- `frontend/` — React + TypeScript + Vite frontend
- `model/` — llama.cpp service configuration for self-hosting Gemma 4 31B

## Quick Start

### Prerequisites

- Docker and Docker Compose
  OR locally with:
- Python 3.11 or 3.12
- Node.js 20+
- UV package manager
- A Google AI Studio API key (for cloud-served Gemma 4 via the Gemini API)
- Hugging Face account and token (only if you self-host the GGUF weights)

### Running Locally (Development)

#### 1. Frontend

```bash
cd frontend
npm install
npm run dev
```

#### 2. Backend

```bash
cd backend
uv sync
uv run uvicorn app:api --host 0.0.0.0 --port 3001 --reload
```

### Running with Docker (Recommended for Production)

```bash
docker-compose up -d
```

This builds and starts:

- Frontend (built into static files)
- Backend (FastAPI serving on port 8000)
- Combined into a single container

**Access the Application:** http://localhost:8000

**NOTE:** By default, both the primary and secondary agents are configured to call Gemma 4 31B Instruct through the Gemini API. To switch to a fully self-hosted, on-prem deployment, see the **Setting Up Local Model** section.

## Configuration

The minimal `backend/.env` for the cloud-served setup:

```env
MODEL_PLATFORM=gemini
MODEL_TYPE=gemma-4-31b-it
GEMINI_API_KEY=your_google_ai_studio_key
API_URL=

SECONDARY_API_URL=
SECONDARY_MODEL_PLATFORM=gemini
SECONDARY_MODEL_TYPE=gemma-4-31b-it
SECONDARY_CONTEXT_SIZE=128000
```

## Setting Up Local Model (Optional)

_Use this option if you want to run Gemma 4 31B entirely on your own hardware rather than relying on the Gemini API — useful for data privacy and offline deployment._

1. Configure your HuggingFace token in `model/.env`:

   ```
   HF_TOKEN=your_token_here
   ```

2. Run the weights download script:

   ```bash
   cd backend
   uv run python app/model/download_models.py
   ```

   This fetches the Gemma 4 31B GGUF (Q4_K_M) weights.

3. Start the model container — it reads from `./models`:

   ```bash
   cd model
   docker-compose up -d
   ```

4. Point the backend at your local llama.cpp endpoint. The model server will be available at `http://localhost:8080/v1`. Configure the frontend (or backend `.env`) to use this URL for both primary and secondary agents.

## Security & Encryption

To protect sensitive agent credentials (like API keys), Medigent One uses Fernet symmetric encryption. API keys are encrypted on the frontend before being sent to the backend, where they are decrypted for use.

### Configuration Required

1. **Generate an encryption key:**

   ```bash
   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```

2. **Configure the backend:**
   Add to `backend/.env`:

   ```
   ENCRYPTION_KEY=your_generated_key_here
   ```

3. **Configure the frontend:**
   Add to `frontend/.env.local`:
   ```
   VITE_ENCRYPTION_KEY=your_generated_key_here
   ```

Make sure both keys match exactly.
