import type { APIRoute } from "astro";
import { getDb } from "../../lib/db";

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, unknown>;

  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { email, deploy, scale, comments } = body;

  if (!email || typeof email !== "string" || !EMAIL_RE.test(email)) {
    return json({ error: "Invalid email" }, 400);
  }

  if (import.meta.env.DEV) {
    console.log("[waitlist:dev] skipping db —", { email, deploy, scale, comments });
    return json({ ok: true }, 200);
  }

  try {
    const sql = await getDb();

    await sql`
      INSERT INTO waitlist (email, deploy, scale, comments)
      VALUES (
        ${email},
        ${typeof deploy === "string" ? deploy : null},
        ${typeof scale === "string" ? scale : null},
        ${typeof comments === "string" && comments ? comments : null}
      )
      ON CONFLICT (email) DO UPDATE SET
        deploy   = EXCLUDED.deploy,
        scale    = EXCLUDED.scale,
        comments = COALESCE(EXCLUDED.comments, waitlist.comments)
    `;

    await fetch("https://ntfy.sh/breadcrumb-waitlist-signup", {
      method: "POST",
      body: `New waitlist signup: ${email} for ${deploy || "unknown deploy"} at scale ${scale || "unknown scale"}. Comments: ${comments || "none"}`,
    });

    return json({ ok: true }, 200);
  } catch (err) {
    console.error("[waitlist]", err);
    return json({ error: "Server error" }, 500);
  }
};

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
