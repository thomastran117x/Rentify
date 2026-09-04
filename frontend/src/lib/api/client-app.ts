export const CLIENT_APP_HEADER_NAME = "x-client-app";

const APP_TOKEN = "rentify-web";

/**
 * Names this app on every backend call, as `rentify-web/<runtime>`.
 *
 * The backend logs the value so traffic from the web app can be told apart from
 * direct API calls, and so a browser request can be told apart from one made by
 * a server component — the latter reaches the backend over the container
 * network with no `Origin`, `Referer`, or device headers to infer from.
 *
 * Observability only: the backend never trusts this for authorization.
 */
export function getClientAppHeader(): Record<string, string> {
  const runtime = typeof window === "undefined" ? "server" : "browser";

  return { [CLIENT_APP_HEADER_NAME]: `${APP_TOKEN}/${runtime}` };
}
