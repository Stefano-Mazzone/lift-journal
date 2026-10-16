# Lift Journal — Free Cloudflare Workers AI setup

Lift Journal remains hosted on GitHub Pages. A separate Cloudflare Worker runs the actual language model. The built-in local workout coach continues working until you complete this setup.

## What you need

- A Cloudflare account on the Workers Free plan (Workers AI has a daily free allowance; not unlimited).
- Node.js installed on your computer.
- Access to the GitHub repository \`Stefano-Mazzone/lift-journal\`.

No paid API key is required for a basic free-tier deployment. You must monitor Cloudflare Workers AI free limits and any changing plan requirements. See [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/) for current pricing and quotas.

## Deploy

1. In Cloudflare's Dashboard, go to **Turnstile** and create a widget for the exact hostname \`stefano-mazzone.github.io\`. Copy the **public site key** and the **private secret key**. Do not put the secret in GitHub.
2. Clone the GitHub repository locally, or download its source. In a terminal:
   \`\`\`bash
   cd lift-journal/worker
   npx wrangler login
   npx wrangler secret put TURNSTILE_SECRET
   \`\`\`
   Paste the **private** Turnstile secret into the secure prompt. Wrangler stores this outside GitHub.
3. Deploy:
   \`\`\`bash
   npx wrangler deploy
   \`\`\`
   Cloudflare will print your public Worker URL, for example \`https://lift-journal-coach.<your-subdomain>.workers.dev\`. No domain purchase is required.
4. In repository root \`coach-config.js\`, set:
   \`\`\`js
   window.LIFT_JOURNAL_AI = {
     endpoint: "https://lift-journal-coach.<your-subdomain>.workers.dev",
     turnstileSiteKey: "<your-public-site-key>"
   };
   \`\`\`
   Commit **only** this public configuration file to GitHub. Never commit the secret.
5. Allow GitHub Pages to publish the changed \`coach-config.js\`. Open Lift Journal → **Coach**, complete the verification widget, and request a workout. The app should display the mode as **Cloudflare AI**.

## Important security and behavior notes

- The Worker enforces an allowed browser origin and Turnstile token validation on the server. Both are required.
- The Worker uses a free Worker-side rate-limiter binding (4 requests per minute per client IP at each Cloudflare location). This limit can affect shared networks, so adjust as needed.
- Only recent coach messages and minimal non-medical workout preferences are sent to Cloudflare. Existing workouts and food logs are not transmitted.
- On-device local planning works if the Worker is not configured, free AI capacity is exhausted, or connectivity is unavailable.
- AI exercise names, sets, reps, training days and available equipment are constrained. A suggestion is never automatically written to the workout history. Review every generated workout and complete the app's standard readiness screening.
- Treat AI suggestions as general exercise information, not medical advice.
- Cloudflare Turnstile tokens are single use; a fresh verification may be required after each AI request.

## Support

- Cloudflare AI binding: [Workers AI setup](https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/)
- [Turnstile setup](https://developers.cloudflare.com/turnstile/get-started/)
- [Workers rate-limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
