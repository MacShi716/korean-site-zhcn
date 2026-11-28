# Translation API

`POST /api/translate` is the only route the standalone translate page and the
legacy in-page helper call. It contains no credentials.

## Request

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

## Response

```json
{ "text": "안녕하세요", "roma": "annyeonghaseyo" }
```

`roma` is optional and currently only comes from the LLM path.

## Upstream selection

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

`OPTIONS` returns `204`. No conversation text is logged by default. Setting
`AI_LOG_CONVERSATIONS=1` logs only route metadata and character counts, never
the text.

## Local test

```sh
node --test tests/translate-api.test.mjs
```
