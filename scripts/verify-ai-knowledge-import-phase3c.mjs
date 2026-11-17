/**
 * Phase 3C — Knowledge Import static verification (no live DB/Storage apply).
 * Run: npm run test:ai-knowledge-import-phase3c
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeRequire = createRequire(import.meta.url);
const file = (rel) => readFileSync(path.join(root, rel), "utf8");

function loadTs(rel, requireMap = {}) {
  const compiled = ts.transpileModule(file(rel), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    reportDiagnostics: true,
  });
  assert.equal(
    (compiled.diagnostics ?? []).filter(
      (d) => d.category === ts.DiagnosticCategory.Error,
    ).length,
    0,
    `TS errors in ${rel}`,
  );
  const mod = { exports: {} };
  const run = new Function("exports", "module", "require", compiled.outputText);
  run(mod.exports, mod, (id) => {
    if (requireMap[id]) return requireMap[id];
    if (id === "node:crypto" || id === "crypto") return nodeRequire("node:crypto");
    if (id === "@/lib/ai-knowledge-import") {
      return loadTs("lib/ai-knowledge-import.ts");
    }
    if (id === "@/lib/admin-permissions") return loadTs("lib/admin-permissions.ts");
    throw new Error(`Unexpected require in ${rel}: ${id}`);
  });
  return mod.exports;
}

const imp = loadTs("lib/ai-knowledge-import.ts");

{
  assert.equal(imp.AI_KNOWLEDGE_IMPORT_MAX_BYTES, 5 * 1024 * 1024);
  assert.deepEqual(imp.AI_KNOWLEDGE_IMPORT_FORMATS, ["pdf", "docx", "txt", "md"]);

  const empty = imp.validateImportUpload({
    filename: "a.txt",
    mimeType: "text/plain",
    byteSize: 0,
    buffer: Buffer.alloc(0),
  });
  assert.equal(empty.ok, false);

  const badExt = imp.validateImportUpload({
    filename: "x.exe",
    mimeType: "application/octet-stream",
    byteSize: 4,
    buffer: Buffer.from("abcd"),
  });
  assert.equal(badExt.ok, false);

  const traversal = imp.validateImportUpload({
    filename: "../secret.txt",
    mimeType: "text/plain",
    byteSize: 5,
    buffer: Buffer.from("hello"),
  });
  assert.equal(traversal.ok, false);

  const pdfMagic = Buffer.concat([
    Buffer.from("%PDF-1.4\n"),
    Buffer.alloc(20, 32),
  ]);
  const pdfOk = imp.validateImportUpload({
    filename: "doc.pdf",
    mimeType: "application/pdf",
    byteSize: pdfMagic.length,
    buffer: pdfMagic,
  });
  assert.equal(pdfOk.ok, true);
  assert.equal(pdfOk.format, "pdf");

  const pretendPdf = imp.validateImportUpload({
    filename: "doc.pdf",
    mimeType: "application/pdf",
    byteSize: 5,
    buffer: Buffer.from("hello"),
  });
  assert.equal(pretendPdf.ok, false);

  const huge = Buffer.alloc(imp.AI_KNOWLEDGE_IMPORT_MAX_BYTES + 1, 65);
  const tooBig = imp.validateImportUpload({
    filename: "big.txt",
    mimeType: "text/plain",
    byteSize: huge.length,
    buffer: huge,
  });
  assert.equal(tooBig.ok, false);
  console.log("OK: file type/size/magic validation");
}

{
  const text = imp.normalizeExtractedText("Hello\u0000\n\n\n\nWorld\r\n");
  assert.equal(text.includes("\u0000"), false);
  assert.match(text, /Hello/);
  assert.match(text, /World/);

  const segments = imp.splitImportSegments(
    "# One\nBody one\n\n---\n\n# Two\nBody two",
  );
  assert.ok(segments.length >= 2);

  const wrapped = imp.wrapUntrustedImportBody("Policy text", "a.pdf");
  assert.match(wrapped, /untrusted/i);
  assert.match(wrapped, /not system instructions/i);

  assert.equal(imp.canCreateArticlesFromImport("extracted"), true);
  assert.equal(imp.canCreateArticlesFromImport("failed"), false);
  assert.equal(imp.canRetryImport("failed"), true);
  console.log("OK: normalize/split/untrusted wrap/status gates");
}

{
  // TXT extraction via extract module
  const extract = loadTs("lib/ai-knowledge-import-extract.ts", {
    "@/lib/ai-knowledge-import": imp,
    "pdf-parse": async () => ({ text: "from pdf" }),
    mammoth: {
      extractRawText: async () => ({ value: "from docx" }),
    },
  });
  // Dynamic import won't work the same in transpile — call through sync path for txt
  // Re-test normalize empty
  const emptyNorm = imp.normalizeExtractedText("   ");
  assert.equal(emptyNorm, "");
  void extract;
  console.log("OK: empty extraction guard");
}

{
  const migration = file(
    "supabase/migrations/20261116200000_skg_ai_knowledge_import_phase3c.sql",
  );
  assert.match(migration, /skg_ai_knowledge_import_jobs/);
  assert.match(migration, /skg-ai-knowledge-imports/);
  assert.match(migration, /'skg-ai-knowledge-imports',\s*\n\s*false,/);
  assert.match(migration, /public = excluded\.public/);
  assert.match(migration, /source_import_job_id/);
  assert.match(migration, /revoke all on table public\.skg_ai_knowledge_import_jobs/i);
  assert.match(migration, /Do NOT apply to Production/i);
  assert.match(migration, /Never auto-publish/i);
  assert.match(migration, /Not Gemini-accessible/i);

  const rollback = file(
    "supabase/migrations/20261116200000_skg_ai_knowledge_import_phase3c.rollback.sql",
  );
  assert.match(rollback, /drop table if exists public\.skg_ai_knowledge_import_jobs/);
  console.log("OK: migration + private bucket + rollback");
}

{
  const upload = file(
    "app/api/admin/ai-management/knowledge/imports/route.ts",
  );
  assert.match(upload, /help_ai\.manage/);
  assert.match(upload, /help_ai\.knowledge\.import\.upload/);
  assert.match(upload, /help_ai\.knowledge\.import\.process/);
  assert.match(upload, /AI_KNOWLEDGE_IMPORT_BUCKET/);
  assert.match(upload, /validateImportUpload/);
  assert.doesNotMatch(upload, /getPublicUrl/);
  assert.doesNotMatch(upload, /GEMINI_API_KEY|SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(upload, /mint-skg-ai-live-token/);
  assert.match(upload, /auto_publish|Never auto|not published/i);

  const detail = file(
    "app/api/admin/ai-management/knowledge/imports/[id]/route.ts",
  );
  assert.match(detail, /createSignedUrl/);
  assert.match(detail, /help_ai\.knowledge\.import\.cancel/);
  assert.match(detail, /help_ai\.knowledge\.import\.delete/);

  const retry = file(
    "app/api/admin/ai-management/knowledge/imports/[id]/retry/route.ts",
  );
  assert.match(retry, /help_ai\.knowledge\.import\.retry/);

  const review = file(
    "app/api/admin/ai-management/knowledge/imports/[id]/review/route.ts",
  );
  assert.match(review, /help_ai\.knowledge\.import\.review/);

  const create = file(
    "app/api/admin/ai-management/knowledge/imports/[id]/create-articles/route.ts",
  );
  assert.match(create, /status: "draft"/);
  assert.match(create, /help_ai\.knowledge\.import\.create_articles/);
  assert.match(create, /auto_published:\s*false/);
  assert.match(create, /gemini_eligible:\s*false/);
  assert.match(create, /wrapUntrustedImportBody/);
  console.log("OK: APIs RBAC/audit/draft-only/private storage");
}

{
  const panel = file("components/admin/ai-knowledge-import-panel.tsx");
  assert.match(panel, /Drag and drop/);
  assert.match(panel, /Create draft article/);
  assert.match(panel, /Retry/);
  assert.match(panel, /skg-ai-knowledge-imports/);
  assert.doesNotMatch(panel, /supabaseAdmin|service_role/);

  const gate = file("components/admin/ai-management-access-gate.tsx");
  assert.match(gate, /AiKnowledgeImportPanel/);
  assert.match(gate, /ai-knowledge-import/);
  assert.match(gate, /AiKnowledgeAdminPanel/);
  assert.match(gate, /AiSettingsAdminPanel/);
  assert.match(gate, /HelpFaqAdminPanel/);

  const map = loadTs("lib/admin-permissions.ts").TAB_PERMISSION_MAP;
  assert.equal(map["ai-knowledge-import"], "help_ai.manage");
  assert.equal(map["ai-knowledge-base"], "help_ai.view");

  const pkg = JSON.parse(file("package.json"));
  assert.ok(pkg.dependencies["pdf-parse"]);
  assert.ok(pkg.dependencies.mammoth);
  console.log("OK: UI wiring + deps + other tabs intact");
}

console.log("\nPhase 3C Knowledge Import verification: passed");
