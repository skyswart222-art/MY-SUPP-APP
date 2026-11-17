// Vercel server function: reads photos, PDFs and numbers with Claude for the planner.
// The Anthropic key lives only here, as the ANTHROPIC_API_KEY environment variable on Vercel.
// Every request must carry the person's Supabase login, and each account has an hourly limit.
import Anthropic from "@anthropic-ai/sdk";

const SB_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SB_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "";
const HOURLY = Number(process.env.AI_HOURLY_LIMIT || 30);
const MAX_IMAGES = 5;
const MODEL = "claude-opus-5-5";
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const SYSTEM = "You read photos, PDF pages and numbers for a personal supplements, meals, workouts and health planner. " +
  "Follow the instructions in the message and reply with only the JSON they ask for: no markdown fences and no commentary.";

const ready = () => !!(process.env.ANTHROPIC_API_KEY && SB_URL && SB_KEY);
let client = null;
const anthropic = () => (client ||= new Anthropic());

async function who(req) {
  const tok = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!tok) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${tok}` } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return u && u.id ? { id: u.id, tok } : null;
}
const rest = (path, tok, init = {}) => fetch(`${SB_URL}/rest/v1/${path}`, {
  ...init, headers: { apikey: SB_KEY, Authorization: `Bearer ${tok}`, "Content-Type": "application/json", ...(init.headers || {}) },
});
async function useOne(u) {
  const since = new Date(Date.now() - 3600e3).toISOString();
  const r = await rest(`ai_usage?select=id&at=gte.${encodeURIComponent(since)}`, u.tok, { method: "HEAD", headers: { Prefer: "count=exact" } });
  if (!r.ok) throw new Error("usage check failed: " + r.status);
  const n = Number((r.headers.get("content-range") || "").split("/")[1] || 0);
  if (n >= HOURLY) return false;
  const w = await rest("ai_usage", u.tok, { method: "POST", headers: { Prefer: "return=minimal" }, body: "{}" });
  if (!w.ok) throw new Error("usage log failed: " + w.status);
  return true;
}
function parseJson(text) {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(t); } catch {}
  const a = t.search(/[[{]/), b = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  return null;
}
const send = (res, status, body) => { res.status(status).setHeader("Cache-Control", "no-store"); res.json(body); };

export default async function handler(req, res) {
  if (req.method === "GET") return send(res, 200, { ready: ready(), maxImages: MAX_IMAGES });
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  if (!ready()) return send(res, 503, { error: "Photo reading isn't set up yet.", code: "not_granted" });

  let u;
  try { u = await who(req); } catch { return send(res, 502, { error: "Couldn't check your login." }); }
  if (!u) return send(res, 401, { error: "Log in again.", code: "auth" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const images = Array.isArray(body.images) ? body.images : [];
  if (!prompt || prompt.length > 120000) return send(res, 400, { error: "Missing or oversized prompt." });
  if (images.length > MAX_IMAGES) return send(res, 400, { error: `At most ${MAX_IMAGES} images.` });
  for (const im of images) {
    if (!im || !TYPES.has(im.media_type) || typeof im.data !== "string" || im.data.length > 6_000_000) return send(res, 400, { error: "Unsupported image." });
  }

  try { if (!(await useOne(u))) return send(res, 429, { error: "Too many requests this hour.", code: "rate_limited" }); }
  catch (e) { console.error(e); return send(res, 502, { error: "Couldn't check your usage. Run the SQL setup again." }); }

  const content = [
    ...images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } })),
    { type: "text", text: prompt },
  ];
  try {
    const msg = await anthropic().messages.stream({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      system: SYSTEM,
      messages: [{ role: "user", content }],
    }).finalMessage();
    if (msg.stop_reason === "refusal") return send(res, 422, { error: "Claude couldn't help with that one.", code: "refused" });
    const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const data = parseJson(text);
    if (data == null) return send(res, 502, { error: "Couldn't read the answer. Try again.", code: "bad_output" });
    return send(res, 200, { data });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return send(res, 429, { error: "Busy right now. Try again in a minute.", code: "rate_limited" });
    if (e instanceof Anthropic.APIError) { console.error("Anthropic error", e.status, e.message); return send(res, 502, { error: "Claude is unavailable right now. Try again soon.", code: "upstream" }); }
    console.error(e); return send(res, 500, { error: "Something went wrong." });
  }
}
