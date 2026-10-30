import assert from "node:assert/strict";

const {
  parseMemberVerificationDetail,
  parseMemberVerificationList,
  parseNotificationList,
  parseUnreadCount,
} = await import("../lib/admin-ops-parse.ts");

const shadow = parseMemberVerificationList(
  {
    items: [
      {
        user_id: "user_1",
        member_name: "Asha Patel",
        mobile: "9876543210",
        registered_at: "2026-09-01T10:00:00.000Z",
        status: "manual_review",
        recommendation: "approve",
        confidence: 0.91,
        users_verified: false,
        last_activity_at: "2026-09-01T10:05:00.000Z",
        aadhaar_number: "123412341234",
        document_url: "https://example.supabase.co/storage/v1/object/sign/secret",
        openai_response: { raw: "do not show" },
        prompt: "internal prompt",
      },
    ],
    total: 1,
  },
  1,
  20,
);

assert.equal(shadow.items.length, 1);
const row = shadow.items[0];
assert.equal(row.recommendationLabel, "AI Recommendation: Approve");
assert.equal(row.accountStatusLabel, "Actual Account Status: Unverified");
assert.equal(row.accountTone, "warning");
assert.match(row.shadowNote ?? "", /not applied/);
assert.equal(row.needsAttention, true);
assert.ok(row.attentionLabels.includes("Manual Review"));
const shadowJson = JSON.stringify(row);
assert.equal(shadowJson.includes("123412341234"), false);
assert.equal(shadowJson.includes("supabase.co"), false);
assert.equal(shadowJson.includes("openai"), false);
assert.equal(shadowJson.includes("internal prompt"), false);

const correction = parseMemberVerificationDetail({
  user_id: "user_2",
  full_name: "Ravi Shah",
  phone: "9123456789",
  created_at: "2026-08-01T08:00:00.000Z",
  verified: false,
  status: "correction_required",
  ai_recommendation: "correction_required",
  ai_confidence: 42,
  safe_reasons: [
    "Date of birth mismatch",
    "name_requires_review",
    "https://files.example/doc.jpg",
    "1234 5678 9012",
    "Driving Licence expired",
  ],
  timeline: [
    { event: "member_registered", at: "2026-08-01T08:00:00.000Z" },
    { event: "documents_submitted", at: null },
    { event: "ai_recommendation_generated", at: "2026-08-01T09:00:00.000Z" },
    { event: "internal_prompt_sent", at: "2026-08-01T09:01:00.000Z" },
    { event: "correction_required", at: "2026-08-01T09:02:00.000Z" },
  ],
  stack: "Error: secret at function",
});

assert.ok(correction);
assert.equal(
  correction.recommendationLabel,
  "AI Recommendation: Correction Required",
);
assert.equal(correction.accountStatusLabel, "Actual Account Status: Unverified");
assert.equal(correction.caseStatusLabel, "Correction Required");
assert.deepEqual(correction.reasonLabels, [
  "Date of birth mismatch",
  "Name requires review",
  "Driving Licence expired",
]);
assert.deepEqual(
  correction.timeline.map((event) => event.label),
  ["Member Registered", "AI Recommendation Generated", "Correction Required"],
);
assert.equal(correction.confidenceLabel, "42%");
assert.ok(correction.attentionLabels.includes("Low Confidence"));
assert.ok(correction.attentionLabels.includes("Correction Required"));
const correctionJson = JSON.stringify(correction);
assert.equal(correctionJson.includes("1234 5678 9012"), false);
assert.equal(correctionJson.includes("https://"), false);
assert.equal(correctionJson.includes("internal_prompt"), false);
assert.equal(correctionJson.includes("secret at function"), false);

const verified = parseMemberVerificationDetail({
  user_id: "user_3",
  name: "Verified Member",
  mobile: "+919876543210",
  users_verified: true,
  recommendation: "approve",
  status: "completed",
  confidence: "88%",
  events: {
    member_registered_at: "2026-07-01T00:00:00.000Z",
    completed_at: "2026-07-02T00:00:00.000Z",
    documents_updated_at: null,
  },
});
assert.ok(verified);
assert.equal(verified.accountStatusLabel, "Actual Account Status: Verified");
assert.equal(verified.accountTone, "success");
assert.equal(verified.shadowNote, null);
assert.equal(verified.mobile, "+919876543210");
assert.deepEqual(
  verified.timeline.map((event) => event.label),
  ["Member Registered", "Completed"],
);

const notifications = parseNotificationList({
  notifications: [
    {
      id: "note_1",
      type: "verification",
      title: "New member",
      message: "Asha submitted documents",
      user_id: "user_1",
      is_read: false,
      created_at: "2026-09-26T10:00:00.000Z",
      signed_url: "https://example.supabase.co/storage/v1/object/sign/abc",
    },
    {
      id: "bad id",
      title: "skip",
      created_at: "2026-09-26T10:00:00.000Z",
    },
  ],
});
assert.equal(notifications.length, 1);
assert.equal(notifications[0].title, "New member");
assert.equal(JSON.stringify(notifications).includes("supabase.co"), false);
assert.equal(parseUnreadCount({ unread_count: 4 }, 1), 4);
assert.equal(parseUnreadCount({ ok: true }, 2), 2);

console.log("admin-ops-parse tests passed");
