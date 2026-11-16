# AI Knowledge Import (Phase 3C)

**Status:** Admin module complete · Migration **source only** (not applied) · **Never auto-publishes**

## Formats & limits

| Format | Notes |
|--------|--------|
| PDF | `pdf-parse` text extraction (image-only PDFs fail) |
| DOCX | `mammoth` raw text |
| TXT / MD | UTF-8 decode |

- Max size: **5 MiB**
- Validation: extension + magic bytes + size (client MIME not trusted alone)
- Bucket: **`skg-ai-knowledge-imports`** (`public = false`)
- Access: service-role upload/download; Admin preview via **signed URL** (1 hour)

## Workflow

1. Upload → private storage + `skg_ai_knowledge_import_jobs`
2. Extract → `extracted` or `failed`
3. Admin reviews/edits text, assigns category + locale
4. Create **draft** Knowledge Base article(s) (Phase 3B tables)
5. Approve/publish only via Knowledge Base workflow

Imported text is wrapped as untrusted document data — never system instructions.

## Gemini boundary

Imports and draft articles are **not** Gemini-accessible. Only Phase 3B `published` articles are eligible for a future retrieval integration.
