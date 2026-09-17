// Apple Pay domain verification. PayPal issues a different association file
// for sandbox and live, so it comes from the runtime environment instead of
// being committed; with none configured the path 404s.
export const dynamic = "force-dynamic";

export function GET(): Response {
  const association = process.env.APPLE_PAY_DOMAIN_ASSOCIATION?.trim();

  if (!association) {
    return new Response(null, { status: 404 });
  }

  return new Response(association, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
