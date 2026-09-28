// Thin client for the /api/* serverless functions. Every call is a POST to
// /api/<resource>?action=<action> with a JSON body; the session lives in an
// httpOnly cookie, never in this client.
export async function api(resource, action, payload) {
  const res = await fetch(`/api/${resource}?action=${encodeURIComponent(action)}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // no body
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data?.code;
    throw err;
  }
  return data;
}
