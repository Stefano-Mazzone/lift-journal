# Lift Journal — Free Cloudflare Workers AI setup

Lift Journal remains hosted on GitHub Pages. A separate Cloudflare Worker runs the actual language model. The built-in local workout coach continues working until you complete this setup.

## What you need

- A Cloudflare account on the Workers Free plan (Workers AI has a daily free allowance; not unlimited).
- Node.js installed on your computer.
- Access to the GitHub repository \`Stefano-Mazzone/lift-journal\`.

No paid API key is required for a basic free-tier deployment. You must monitor Cloudflare Workers AI free limits and any changing plan requirements. See [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/) for current pricing and quotas.

## Browser-only setup (recommended, including iPhone)

Cloudflare has a **GitHub integration**, so you do **not** need a local terminal.

1. Open [Cloudflare dashboard](https://dash.cloudflare.com/) and register or sign in to a **Free** account.
2. Go to **Workers & Pages → Create application → GitHub** (the exact button label may vary). Authorize GitHub and select **Stefano-Mazzone/lift-journal**.
3. Choose Worker name **lift-journal-coach** to match `worker/wrangler.json`. Set **Root directory** to `worker` and **Deploy command** to `npx wrangler deploy`. Leave the build command blank if allowed, then deploy.
4. Inside the new Worker, go to **Settings → Variables and Secrets** and create a **Secret** named `TURNSTILE_SECRET`. You will get its value in the next step.
5. Go to **Cloudflare → Turnstile**, create a widget that allows **stefano-mazzone.github.io**, and copy its *public site key* and *private secret*. Paste the **private secret** into the Worker's `TURNSTILE_SECRET` setting. Never share it in chat, GitHub, or a public file.
6. Cloudflare will show a public Worker URL resembling `https://lift-journal-coach.<your-subdomain>.workers.dev`. Edit [coach-config.js](https://github.com/Stefano-Mazzone/lift-journal/blob/main/coach-config.js) in GitHub to set **endpoint** to that URL and **turnstileSiteKey** to your *public* site key.
7. When GitHub Pages publishes the change, open Lift Journal → **Coach**. Complete the verification and submit a workout request. The Cloudflare AI will be connected. Your existing on-device coach is always available if the Worker is unavailable.

If the Worker reports "AI not configured," confirm that the **Workers AI** and **COACH_RATE_LIMIT** bindings have been created from `wrangler.json`, and that `TURNSTILE_SECRET` exists in Worker settings. Cloudflare Builds deploys on new GitHub pushes, but the Worker is not live until the initial Cloudflare deployment succeeds.

[Cloudflare GitHub deployment guide](https://developers.cloudflare.com/workers/ci-cd/builds/)

## Alternative setup with Wrangler CLI

You can also deploy from a computer:

```bash
cd lift-journal/worker
npx wrangler login
npx wrangler deploy
npx wrangler secret put TURNSTILE_SECRET
```

After deployment, configure the same public Worker endpoint and public Turnstile site key in the repository's `coach-config.js`. Never put the private secret there.

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
