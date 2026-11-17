# AI Instructions ↔ Gemini Live Integration Contract

**Phase:** 2D (Admin Web + Mobile Edge)  
**Status:** Admin module complete · **Runtime enforcement: wired in code (deploy pending)**

## Gemini Live behavior (Phase 2D)

Edge Function `mint-skg-ai-live-token` (Mobile repo) builds the ephemeral token via
`buildGeminiAuthTokenRequest` in `supabase/functions/_shared/skg-ai-live-token.ts`.

Locked setup fields:

- `model`
- `generationConfig.responseModalities: ["AUDIO"]`
- `systemInstruction: { parts: [{ text: publishedComposedInstruction }] }`
- optional empty `sessionResumption`

Google AuthToken contract: when `fieldMask` is empty and `bidiGenerateContentSetup`
is present, the **client WebSocket setup is ignored**. Private prompts therefore
stay server-side; Mobile `skg-ai-live-socket.ts` does **not** need to send
`systemInstruction`.

## Admin module storage (Phase 2D)

Tables (Mobile migration `20261116180000_skg_ai_instructions_phase2d.sql`):

- `skg_ai_instructions` — singletons `global-draft` / `global-published`
- `skg_ai_instruction_versions` — append-only history
- `skg_ai_instruction_runtime_usage` — mint-time version metadata (no prompt body)

Adapter: `lib/ai-instructions-store.ts` (Postgres via service role).  
Defaults / compose: `lib/ai-instructions.ts`.  
Payload helper: `lib/ai-instructions-gemini-adapter.ts`.

## Runtime injection

1. Persist published instructions in Postgres (Admin publish).
2. Edge loads **only** `global-published` (service_role).
3. Edge appends session language hint (`en` / `hi` / `gu`).
4. Edge sets `bidiGenerateContentSetup.systemInstruction`.
5. Edge writes runtime usage audit (version + length only).
6. Drafts are never selected for mint.

## Clear split

| Layer | Phase 2D |
|-------|----------|
| Admin UI / RBAC / audit / draft vs publish | **Done** |
| Postgres version history | **Done (code)** |
| SKG-only default policy text | **Done** |
| Gemini Live runtime enforcement | **Done (code)** — Staging migrate + Edge + Admin deploy still required |
