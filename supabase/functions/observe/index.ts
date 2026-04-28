// Vitality v2 — telemetry sink Edge Function (Phase 0 skeleton).
//
// Receives a batch of OTel-shaped spans from the browser tracer
// (v2/tracer.js) via navigator.sendBeacon and inserts them into
// public.telemetry_spans, attributed to the calling user.
//
// Phase 0 ships this skeleton; Phase 2 (Observability extension) wires
// the client beacon flush. Until then this function is callable but unused.
//
// Deploy:
//   supabase functions deploy observe --no-verify-jwt=false
//
// Request shape (POST application/json, sent via sendBeacon):
//   { spans: Span[] }
// Response: 204 No Content on success, 4xx on bad input.

import { createClient } from "jsr:@supabase/supabase-js@2";

interface Span {
  trace_id: string;
  span_id: string;
  parent_span_id?: string | null;
  name: string;
  kind?: string;
  start_ms: number;
  end_ms: number;
  status?: "ok" | "error";
  attrs?: Record<string, unknown>;
}

const MAX_SPANS_PER_BATCH = 200;

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) {
    return new Response("missing bearer token", { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    return new Response("server misconfigured", { status: 500 });
  }

  // Use the caller's JWT so RLS attributes the insert to their user_id.
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return new Response("invalid token", { status: 401 });
  }
  const userId = userData.user.id;

  let body: { spans?: Span[] };
  try {
    body = await req.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }
  const spans = Array.isArray(body.spans) ? body.spans : [];
  if (spans.length === 0) {
    return new Response(null, { status: 204 });
  }
  if (spans.length > MAX_SPANS_PER_BATCH) {
    return new Response("batch too large", { status: 413 });
  }

  const rows = spans.map((s) => ({
    user_id: userId,
    trace_id: s.trace_id ?? null,
    span_id: s.span_id ?? null,
    payload: s,
  }));

  const { error: insertErr } = await supabase
    .from("telemetry_spans")
    .insert(rows);

  if (insertErr) {
    return new Response("insert failed", { status: 502 });
  }

  return new Response(null, { status: 204 });
});
