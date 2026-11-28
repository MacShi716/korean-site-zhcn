# API routes

Two serverless routes live in this folder. Both use `lib/http.js` for CORS and
JSON errors. API keys and system prompts stay on the server.

- `POST /api/translate` - translation (see below).
- `POST /api/chat` - membership-gated Korean conversation tutor.

## POST /api/chat

A Korean conversation-practice tutor. Text and voice are combined in the site
panel, but the browser only sends text. The tutor prompt and model choice are
server-side (`lib/chat-prompt.js`, `AI_CHAT_MODEL`).

### Request

```json
{
  "messages": [
    { "role": "user", "content": "tomato scrambled eggs 怎么说?" },
    { "role": "assistant", "content": "토마토 스크램블 에그라고 해요. 문장으로 한번 말해 보세요." }
  ],
  "locale": "zh",
  "profile": { "nativeLang": "zh", "goal": "", "level": "beginner" }
}
```

- `messages` is required and must contain at least one `user` turn.
- Only `user` and `assistant` roles are accepted. Each content string is capped
  at 4000 characters; only the last 20 messages are used.
- `locale` accepts `zh`, `en`, or `ko` (default `zh`). `profile` is optional
  background context and is never treated as instructions.
- A client-supplied `model` is ignored for both authorization and the prompt.

### Auth and membership gates

The route fails closed in this order:

1. Missing or invalid Supabase access token -> `401` `login_required`.
   The token is verified against `{SUPABASE_URL}/auth/v1/user` with the public
   publishable key. A demo phone login in `index.html` never counts.
2. Missing service role env, missing table, or missing RPC -> `503`
   `membership_unconfigured`. No LLM call is made.
3. Authenticated but not a member -> `403` `membership_required`.
4. Member with `ai_quota_remaining < 1` -> `403` `quota_exhausted`.
5. Missing `AI_API_KEY` -> `503` `ai_unconfigured`. No reply is invented.
6. LLM failure -> `502` `ai_upstream_error`; the reserved quota unit is refunded.
7. Success -> `200`:

```json
{ "reply": "토마토 스크램블 에그라고 해요. 문장으로 한 번 말해 보세요.", "quotaRemaining": 4 }
```

The quota unit is reserved with the `consume_ai_quota` RPC before the LLM call
and refunded with `refund_ai_quota` if the call fails. SQL lives in
`api/sql/ai-membership.sql`.

### Environment

- `SUPABASE_URL` or `AI_SUPABASE_URL` (defaults to the already-public project URL)
- `SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY` (defaults to the already-public
  publishable key in `auth/public-config.js`)
- `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY` (server only; never commit)
- `AI_API_KEY` and optional `AI_BASE_URL`, `AI_CHAT_MODEL`
- Optional `AI_CHAT_PROMPT` override (server only)
- `AI_LOG_CONVERSATIONS=1` logs route metadata only: status, code, character
  counts, and a hashed user id. It never logs message text.

### Payment gap

Membership purchase and checkout do not exist in this repo. The live Supabase
public schema currently has no tables, and the Vercel project has no env
variables, so the real deployment returns `membership_unconfigured` until an
operator applies the SQL and sets env vars. The client does not show a fake
checkout button and must not claim a purchase can be completed.

AI quota is a separate membership balance. It is not the site's learning
energy, and no learning-energy field is read or spent.

## POST /api/translate

`POST /api/translate` is the only route the standalone translate page and the
legacy in-page helper call. It contains no credentials.

### Request

```json
{
  "text": "你好",
  "from": "zh",
  "to": "ko",
  "honorific": true,
  "profile": { "nativeLang": "zh", "goal": "", "level": "beginner" }
}
```

`from` and `to` accept `zh`, `ko`, and `en`. Text is capped at 4000 characters.
Empty text returns `400`; unsupported method returns `405`; an unreachable
upstream returns `502`.

### Response

```json
{ "text": "안녕하세요", "roma": "annyeonghaseyo" }
```

`roma` is optional and currently only comes from the LLM path.

### Upstream selection

1. If `AI_API_KEY` is set, call an OpenAI-compatible chat-completions endpoint
   (`AI_BASE_URL`, default `https://api.deepseek.com/v1`; model from
   `AI_TRANSLATE_MODEL`, `AI_ALLOWED_MODELS`, or `AI_DEFAULT_MODEL`, default
   `deepseek-chat`) with the server-only prompt in `lib/translate-prompt.js`.
2. If no key is set, use the keyless server-side fallback in `lib/mt.js`:
   - Primary: MyMemory public translation API (`api.mymemory.translated.net`),
     used for requests up to 480 characters.
   - Secondary: Google gtx translation endpoint for longer text or when
     MyMemory fails.
3. If a configured LLM call fails, the handler also tries the keyless path so a
   bad key does not break the page.

Honorific is best-effort. The LLM path can follow it. The keyless machine
translation path does not fake an honorific rewrite.

## CORS

Allowed origins:

- `https://macshi716.github.io`
- `https://korean-site-zhcn.vercel.app`
- `https://korean-site-zhcn-*.vercel.app` previews
- `http://localhost[:port]`, `http://127.0.0.1[:port]` (and the `https` forms)

`OPTIONS` returns `204`. Allowed request headers include `Authorization`.
No conversation text is logged by default. Setting `AI_LOG_CONVERSATIONS=1`
logs only route metadata and character counts, never the text.

## Local test

```sh
node --test tests/chat-api.test.mjs tests/translate-api.test.mjs
```
