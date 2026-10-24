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

### Enable no-account feedback (recommended after deployment)

The **Feedback** tab works immediately with a GitHub-sign-in fallback. To let users submit feedback directly without creating their own GitHub accounts, complete this optional setup:

1. In GitHub account settings, create a **fine-grained personal access token** restricted to **Stefano-Mazzone/lift-journal** with **Issues: Read and write** permission and no other repository permissions. Use an appropriate expiration and rotate it as needed. This is a privileged credential.
2. In your Cloudflare Worker → **Settings → Variables and Secrets**, add a **Secret** named exactly \`GITHUB_FEEDBACK_TOKEN\`. Paste the token **only into Cloudflare's secure secret field** — never into GitHub, the public app, or ChatGPT.
3. Deploy the latest \`worker/wrangler.json\` configuration, which includes the separate \`FEEDBACK_RATE_LIMIT\` binding (2 requests per 60 seconds per edge location/IP). The same Turnstile settings from the AI setup protect feedback submissions.
4. Once \`coach-config.js\` contains your public Worker URL and public Turnstile site key, users can submit feedback inside Lift Journal → **Feedback**, without a GitHub account.

### Protect the Feedback Hub during redeployments

The repository contains both a root `wrangler.json` and `worker/wrangler.json` for the two Cloudflare build-directory layouts. Both files specify the same safeguards:

- `secrets.required` lists `TURNSTILE_SECRET` and `GITHUB_FEEDBACK_TOKEN`. Wrangler validates the configured **secret names** and blocks deployment if either is absent. It does not store either secret value in GitHub.
- `keep_vars: true` preserves dashboard-managed **variables** when deploying. Cloudflare says Wrangler normally preserves encrypted secrets as well; this setting alone is **not a guarantee** against an unexpectedly missing secret.
- In Cloudflare → Worker → Settings → Builds → Build watch paths, restrict **Include paths** to `worker/*` and `wrangler.json` to avoid redeploying the Worker when only the GitHub Pages app changes. This is a dashboard setting, not part of the code.
- Before approving and merging a Worker-config change, confirm **Production** has both secrets; otherwise the required-secret validation should reject that deployment. If the GitHub token is missing, restore it in Cloudflare as an encrypted secret, then verify an account-free Feedback submission. Do not put a token value in source code, config, documentation or a chat.
- If a secret disappears even after this protection is enabled, inspect the specific deployment's build logs and settings and contact Cloudflare support with the deployment ID. The precise cause of the earlier deletion has not been established.

All submissions become **public GitHub issues**, not private messages. Warn users not to submit personally identifying, medical, or sensitive information. The Worker is the only code with permission to create GitHub issues. Users cannot update your app or code from the feedback form.

You can review new feedback at [Lift Journal Issues](https://github.com/Stefano-Mazzone/lift-journal/issues), prioritize requests and decide whether to implement changes. In ChatGPT, ask **"Check Lift Journal feedback"** to retrieve issues from GitHub and draft a shortlist of improvements. Feedback does **not** appear automatically as incoming chat messages here, and no updates are pushed without your approval.


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

## Feedback review process

- **New**: Submitted feedback arrives as a GitHub issue, typically titled \`[Bug report] …\`, \`[Feature request] …\`, \`[Workout feedback] …\` or \`[Other feedback] …\`. Feedback submitted without an account through the app automatically receives the existing **Under Review** label. Requests made directly on GitHub may need the label assigned manually.
- **Triage**: Check for duplicates, reproduce bugs if possible, and ask follow-up questions publicly without requesting sensitive personal details. Add priority labels if desired.
- **Approval**: The repository owner changes the request's decision label from **Under Review** to **Approved**, **Declined** or **Implemented** as appropriate (one decision label at a time). These labels record decisions only; a suggestion is not a release authorization.
- **Release**: Only after approval, change the app in GitHub, review and test the code, update the version, and publish it via GitHub Pages.
- **Close**: Link the implementing commit or version from the issue, or explain why a request is deferred or declined.

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
