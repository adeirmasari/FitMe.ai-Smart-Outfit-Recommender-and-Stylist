# FitMe.ai

FitMe.ai is an outfit analysis and personal styling web app. A signed-in user uploads a photo of clothing or an outfit and picks an occasion (casual, campus, work, formal event, party, other). The user can also add preferences. The Django backend validates the photo, sends it to **Qwen2.5-VL** through a provider adapter, then validates and stores the structured answer. The vanilla-JS frontend shows what the model saw, the recommendation, alternatives and limitations. Users can revisit or delete their own history.

```
frontend/   HTML + CSS + ES modules (no build step), served by Django
backend/    Django 6 + DRF project
  config/       settings, URLs, error envelope, health + SPA views
  accounts/     registration, JWT login/refresh/logout, profile
  analyses/     upload validation, analysis lifecycle, history, permissions, OutfitRecommendation model
  ai_services/  provider interface, Qwen2.5-VL adapter, schema validation, dev mock, dataset tools
dataset/000/  Polyvore-derived outfit dataset (504 images + JSON stylist conversations)
e2e/          Playwright browser checks
```

---

## 1. Quick start (macOS / Linux)

Requirements: Python 3.12+, PostgreSQL 14+, Node 18+ (for the frontend unit tests only).

```bash
cd intan
python3 -m venv .venv && source .venv/bin/activate      # or: uv venv .venv
pip install -r requirements-dev.txt
cp .env.example .env                                     # then edit
```

### Database

Use any PostgreSQL instance and set `DATABASE_URL` in `.env`. You can also run a private dev cluster inside the project folder; this leaves any system PostgreSQL untouched:

```bash
PG=/Library/PostgreSQL/18/bin          # or the folder where initdb/pg_ctl live (e.g. $(brew --prefix postgresql@16)/bin)
$PG/initdb -D .pgdata/data -U fitme --auth=trust -E UTF8
$PG/pg_ctl -D .pgdata/data -o "-p 5433 -k /tmp -c listen_addresses=localhost" -l .pgdata/log.txt start
$PG/createdb -h localhost -p 5433 -U fitme fitme
# DATABASE_URL=postgres://fitme@localhost:5433/fitme   (the .env.example default)
# stop later with:  $PG/pg_ctl -D .pgdata/data stop
```

### Migrate and run

```bash
cd backend
python manage.py migrate
python manage.py createsuperuser          # optional, for /admin/
python manage.py runserver 127.0.0.1:8000
```

Open http://127.0.0.1:8000. The frontend, the API (`/api/...`) and the docs are all served from this one origin:

- Swagger UI: http://127.0.0.1:8000/api/docs/
- ReDoc: http://127.0.0.1:8000/api/redoc/
- OpenAPI schema: http://127.0.0.1:8000/api/schema/

There is no separate frontend server. Django serves `frontend/` as static files, and `index.html` is returned for every non-API route, so deep links and page refreshes work.

---

## 2. AI provider (Qwen2.5-VL)

All model access goes through `ai_services/`. The business logic in `analyses/services.py` only sees the `VisionProvider` interface.

| `AI_PROVIDER` | Behaviour |
|---|---|
| `qwen` | Real Qwen2.5-VL calls to an OpenAI-compatible `/chat/completions` endpoint (`ai_services/qwen.py`). |
| `mock` | Development fixture. Refused when `DJANGO_DEBUG=false`. Every result is stored with `is_mock=true` and labelled "Development mock — not AI output" in the UI. Only the dominant colours are real; Pillow measures them from the pixels. |
| `none` (default) | Analysis disabled. `POST /api/analyses/` returns `503 provider_not_configured` and stores nothing. |

**Credentials:** this repository ships no Qwen API key or GPU. To get real results, set one of these in `.env`:

```bash
# Alibaba Cloud Model Studio (DashScope), international region
AI_PROVIDER=qwen
QWEN_API_BASE=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
QWEN_API_KEY=sk-...
QWEN_MODEL=qwen2.5-vl-72b-instruct

# Self-hosted vLLM (needs a CUDA GPU; ~16 GB VRAM for 7B)
#   vllm serve Qwen/Qwen2.5-VL-7B-Instruct --port 8001
QWEN_API_BASE=http://localhost:8001/v1
QWEN_MODEL=Qwen/Qwen2.5-VL-7B-Instruct

# Ollama (local, CPU/Apple Silicon possible but slow)
#   ollama pull qwen2.5vl:7b
QWEN_API_BASE=http://localhost:11434/v1
QWEN_MODEL=qwen2.5vl:7b
QWEN_JSON_MODE=false
```

`GET /api/health/` shows whether a provider is configured, without exposing the URL or key.

How the integration behaves:

- **Timeouts:** connect `QWEN_CONNECT_TIMEOUT_SECONDS` (10 s), read `QWEN_TIMEOUT_SECONDS` (60 s). A timeout is not retried. Connection errors and HTTP 429/5xx are retried `QWEN_MAX_RETRIES` times (default 1) with a short backoff. HTTP 401/403/404 maps to `provider_not_configured`.
- **Bounded input:** the stored image is at most 2048 px and the copy sent to the model at most 1280 px (`FITME_MODEL_IMAGE_MAX_SIDE`). User text fields are capped at 80–300 characters and stripped of control characters.
- **Prompt-injection hygiene:** user text goes inside a `<USER_PREFERENCES>` block, and the system prompt says to treat it as preferences only. The model has no tools: its output is parsed as data and never executed.
- **Output validation:** `ai_services/schema.py` extracts the first JSON object, even from fenced or chatty replies. It then coerces every field into a bounded shape: max 12 items per list, capped string lengths, hex colours checked with a regex. It requires `visual_analysis`, `primary_recommendation` and `occasion_rationale`. If parsing fails, the analysis is marked `failed / invalid_model_output`; the app doesn't crash.
- **No fabricated output:** when the provider fails, no recommendation is stored. The analysis keeps its photo and a safe error code, and the user can **retry** (`POST /api/analyses/{id}/retry/`, max 5 attempts).
- **Logging:** errors log the analysis id and error category only. Images, base64 payloads and API keys are never logged, and urllib3 debug logging is silenced.
- **Stored metadata:** provider, model id, prompt version, latency, token usage, finish reason and provider request id.

### Evaluating the model against the bundled dataset

`dataset/000` holds 504 Polyvore outfit composites. Each comes with the items a stylist recommended (`target_items`) and a stylist conversation.

```bash
cd backend
python manage.py evaluate_dataset --limit 25 --occasion casual --out ../eval.json
```

The command reports the valid-JSON rate and median latency. It also reports a heuristic *target hit rate*: how often the recommendation mentions a category the dataset's stylist actually recommended. This is a rough proxy, not an accuracy score. The mock provider is refused unless you pass `--allow-mock`.

The dataset is also used in the UI: eight composites live in `frontend/assets/samples/` as "try a sample" inputs and landing imagery. The landing "example recommendation" adapts sample 0000500's stylist conversation and is labelled as such. **Licensing note:** the images come from Polyvore product photos. Check the dataset's licence before any public deployment.

---

## 3. API summary

All errors use one envelope: `{"error": {"code", "message", "fields"?}}`.

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/register/` | `{username, email, password}` → `201 {access, access_expires_in, user}` |
| POST | `/api/auth/token/` | `{username (or email), password}` → `{access, ...}` |
| POST | `/api/auth/token/refresh/` | Refresh from the HttpOnly cookie (web) or `{refresh}` in the body (API clients) |
| POST | `/api/auth/logout/` | Blacklists the refresh token and clears the cookie → `204` |
| GET/PATCH | `/api/profile/` | `display_name`, `email`, `style_notes` are editable |
| POST | `/api/analyses/` | multipart: `image`, `occasion`, optional `occasion_detail` (only for `other`), `preferred_style`, `desired_impression`, `additional_context` |
| GET | `/api/analyses/?page=&page_size=` | Paginated history (12 per page, max 50), newest first |
| GET | `/api/analyses/{id}/` | Detail, including `recommendation` when completed |
| DELETE | `/api/analyses/{id}/` | Deletes the record, its recommendation and both image files |
| POST | `/api/analyses/{id}/retry/` | Retries a failed analysis |
| GET | `/api/analyses/{id}/image/?variant=thumb` | Owner-only photo stream (photos are never public) |
| GET | `/api/health/` | `{status, database, ai_provider: {name, model, configured, is_mock}}` |

**Analysis status contract.** Inference is synchronous: `POST /api/analyses/` returns once the model has answered or failed.

- `201` + analysis with `status: "completed"` and a `recommendation` object.
- `502` / `504` + `{error, analysis}`: the analysis is saved with `status: "failed"` and `error: {code, message, retryable}`. The photo is kept for retry.
- `503 provider_not_configured`: nothing is stored.
- `400 validation_error`: field errors for the image, occasion or text fields.

The states are `pending → processing → completed | failed`. If a worker dies mid-request, the record would stay in `processing`. Any record in `processing` longer than the timeout budget (+60 s) is shown as `failed / processing_interrupted` and can be retried.

**Sync-inference limits.** One request holds a web worker for the whole model call (up to about 2 minutes with a retry). Run gunicorn with `--timeout 150` and enough workers or threads. A background queue would be the next step at scale; none was added because it wasn't needed for the MVP.

---

## 4. Security & privacy notes

**Authentication & token storage**

- The access token (15 min) lives **only in JavaScript memory** (`frontend/js/api.js`). It is never put in localStorage or sessionStorage.
- The refresh token (7 days, rotated on each use, old ones blacklisted) is an **HttpOnly, SameSite=Strict cookie** scoped to `/api/auth/`. It is `Secure` when DEBUG is off.
- Cookie-based refresh and logout require the header `X-FitMe-Client: web`. A cross-site page can't send a custom header without a CORS preflight, and this API never approves one. Together with SameSite=Strict, this blocks CSRF on the refresh endpoint.
- On page load the app calls refresh to resume the session. On any 401 it refreshes once and retries the request, then sends the user to sign-in with a "session expired" message.
- **Trade-off:** this keeps long-lived tokens out of reach of injected script. But an XSS bug could still make API calls while the page is open, using the in-memory access token. The main defence is that the frontend never renders untrusted text through `innerHTML`: every element is built with `textContent` (`frontend/js/dom.js`), and model hex colours are applied only after a strict `#rrggbb` check.

**Uploads**

- The extension and browser MIME type are checked against an allow-list, but neither is trusted. Pillow decodes the actual bytes; the format must be JPEG, PNG or WebP.
- Limits: 8 MB, 200–8000 px per side, 40 MP decompression-bomb guard.
- Images are re-encoded to a fresh JPEG with EXIF orientation applied. This strips EXIF/GPS, ICC payloads and appended data.
- The client filename is discarded. Files are stored as `media/outfits/<user_id>/<uuid>.jpg`, so path traversal isn't possible.
- `media/` is never routed publicly. Photos are streamed only to their owner through the API, with `Cache-Control: private`.

**Access control**

- Every analysis queryset is filtered by `owner=request.user`, so other users' records return 404. Analysis IDs are UUIDs.

**Rate limits** (DRF throttles, configurable through env vars)

- Login and registration: 10/min.
- Token refresh: 60/min.
- Analysis creation and retry: 20/hour per user.
- General API use: 600/hour.
- Use a shared cache (Redis or Memcached via `DJANGO_CACHE_BACKEND`/`DJANGO_CACHE_LOCATION`) when running more than one process.

**CORS & production settings**

- No CORS headers are sent; the frontend is same-origin.
- When `DJANGO_DEBUG=false`: a secret key is required, PostgreSQL is enforced and the mock provider is refused. The app also turns on HTTPS redirect, HSTS, Secure cookies, `X-Frame-Options: DENY`, nosniff and a same-origin referrer policy.

**Retention**

- Photos stay until the user deletes the analysis. Deleting an account cascades to its analyses and files.
- **Provider data handling:** with a hosted provider (DashScope, OpenRouter), the downscaled photo and the user's preference text are sent to that third party under its retention terms. Self-host with vLLM or Ollama if photos must not leave your infrastructure. Tell your users which option you chose.

---

## 5. Tests

```bash
# Backend: 69 tests (auth, uploads, provider failures, malformed output, status transitions,
# pagination, cross-user access, deletion, profile, health). Uses PostgreSQL from DATABASE_URL.
cd backend && python manage.py test

# Frontend unit tests (validation, error normalization). No dependencies needed.
cd frontend && npm test

# Browser end-to-end (needs a running server with AI_PROVIDER=mock and Chrome,
# or run `playwright install chromium` first)
python e2e/test_e2e.py --base http://127.0.0.1:8000 --shots e2e/screenshots
```

The external model is always mocked in automated tests. The E2E suite covers:

- registration and login errors
- image validation (empty, too small, wrong type)
- occasion selection and duplicate-submit prevention
- result rendering and session restore after refresh
- expired-token refresh and retry
- history and detail navigation
- cross-user blocking
- profile edit
- delete confirmation and logout guard
- 390 px mobile layouts with no horizontal scroll
- the skip link

Because login is rate-limited to 10/min, wait a minute between consecutive E2E runs.

---

## 6. Production run (outline)

```bash
export DJANGO_DEBUG=false DJANGO_SECRET_KEY=... DJANGO_ALLOWED_HOSTS=fitme.example.com \
       DATABASE_URL=postgres://... AI_PROVIDER=qwen QWEN_API_BASE=... QWEN_API_KEY=... QWEN_MODEL=...
cd backend
python manage.py migrate
python manage.py collectstatic --noinput
gunicorn config.wsgi --bind 0.0.0.0:8000 --workers 3 --threads 4 --timeout 150
```

Put a TLS-terminating reverse proxy in front that sets `X-Forwarded-Proto` and limits request bodies to about 10 MB. `media/` must sit on persistent storage and must **not** be exposed by the proxy.

## 7. Known limitations

- No real Qwen2.5-VL credentials were available when this was built. The adapter is covered by unit tests and by an HTTP test against a local OpenAI-compatible stub, but not yet against a live Qwen endpoint. Set `AI_PROVIDER=qwen` and run `evaluate_dataset` to verify.
- Inference is synchronous (see §3).
- HEIC uploads aren't supported; the UI asks users to export as JPEG.
- There is no password reset or email verification yet (outside the MVP scope).
