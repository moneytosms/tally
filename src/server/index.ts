// Hono app. Serves /api/*; static assets are served by the Worker's asset binding.
// TODO: mount routes, session middleware, ledger-membership middleware, security headers.
export default {
  fetch(_request: Request): Response {
    return new Response("TODO");
  },
};
