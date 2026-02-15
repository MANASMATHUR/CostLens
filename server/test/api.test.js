// Backend API tests: health and 400 validation (URL normalization via routes)
import assert from "assert";
import request from "supertest";

process.env.VERCEL = "1";
const mod = await import("../server.js");
const app = mod.default;

async function run() {
  // GET /api/health
  const healthRes = await request(app).get("/api/health");
  assert.strictEqual(healthRes.status, 200, "GET /api/health should return 200");
  assert.strictEqual(healthRes.body?.status, "ok", "health body.status should be ok");
  assert.ok("envReady" in healthRes.body, "health body should have envReady");
  assert.ok("missingEnv" in healthRes.body, "health body should have missingEnv");

  // POST /api/investigate — missing url
  const noUrlRes = await request(app).post("/api/investigate").send({});
  assert.strictEqual(noUrlRes.status, 400, "POST with {} should return 400");
  assert.ok(noUrlRes.body?.error, "400 body should have error message");

  // POST /api/investigate — invalid URL (no valid hostname)
  const badUrlRes = await request(app).post("/api/investigate").send({ url: "not-a-valid-host" });
  assert.strictEqual(badUrlRes.status, 400, "POST with invalid URL should return 400");
  assert.ok(badUrlRes.body?.error, "400 body should have error message");

  // POST /api/investigate — valid URL format (will fail on missing env, but we check 400 for URL only)
  // Use a clearly invalid URL to get URL validation 400
  const invalidSchemeRes = await request(app).post("/api/investigate").send({ url: "ftp://example.com" });
  assert.strictEqual(invalidSchemeRes.status, 400, "POST with ftp: URL should return 400");

  // POST /api/investigate — valid URL shape (https://example.com) returns 400 when env missing (missingEnv in body)
  const validUrlRes = await request(app).post("/api/investigate").send({ url: "https://example.com" });
  assert.ok([400, 500].includes(validUrlRes.status), "POST with valid URL should return 400 or 500 when env missing");
  if (validUrlRes.status === 400 && validUrlRes.body?.missingEnv) {
    assert.ok(Array.isArray(validUrlRes.body.missingEnv), "missingEnv should be an array");
  }

  console.log("API tests passed.");
}

run().catch((err) => {
  console.error("API tests failed:", err.message);
  process.exit(1);
});
