# Spotify Now Playing setup (v1.27.5)

Lift Journal is a static site. It cannot read other apps' playback directly. The optional Spotify integration uses Spotify's official Web API with OAuth Authorization Code + PKCE and only the `user-read-currently-playing` scope. No Spotify password or client secret belongs in this repository.

## Enable the integration

1. Open https://developer.spotify.com/dashboard and create a Spotify developer app, subject to Spotify's current eligibility and quota requirements.
2. Register this exact HTTPS redirect URI in the app's settings:
   `https://stefano-mazzone.github.io/lift-journal/`
3. Copy the app's public **Client ID** (not the Client Secret) to `spotify-config.js` as `window.LJ_SPOTIFY_CLIENT_ID = 'YOUR_CLIENT_ID';`.
4. Open Lift Journal in Safari/Chrome, tap **Find Song**, and then **Connect Spotify**. Authorize the read-only playback permission. Test in a browser before testing an iOS Home Screen installation.

Spotify's development mode supports a limited number of explicitly allowlisted users and currently requires the app owner to have Premium. Wider public access is subject to Spotify's extended access rules; configuring a Client ID alone does not make the feature generally available.

## Behavior and privacy

- A compact Spotify bar appears **only** if Spotify reports an actively playing track; it disappears if paused, no track is active, the browser is hidden, or playback status cannot be verified.
- The widget checks periodically (~45 seconds) while the webpage is visible; this is not an instant system media notification. Browser background suspension can delay updates.
- The app requests read-only currently-playing access; it does not control playback, record microphone input, or transfer a Spotify password.
- OAuth tokens live separately in local browser storage, **not** in the Lift Journal workout/food backup. Disconnecting clears local tokens. Treat a device running a connected session as access to Spotify metadata and avoid using this on a shared phone.
- The Apple Music iOS native player state is not exposed to ordinary web pages. Lift Journal intentionally does not show a false Apple Music track indicator. Apple's MusicKit for web playback is a different feature and would require a separately designed player and developer token service.

## Troubleshooting

- **Spotify not configured:** `spotify-config.js` must contain a valid Client ID.
- **Redirect mismatch:** Ensure the registered redirect URL exactly matches the GitHub Pages URL above, including the final `/`.
- **Access denied / 403:** Ensure the Spotify account is allowed to use this development-mode app. Check Spotify's quota and Premium restrictions.
- **No music bar:** Play a track inside Spotify using the authorized account and bring Lift Journal into the foreground. Paused and idle sessions are intentionally hidden.

Documentation: https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow and https://developer.spotify.com/documentation/web-api/concepts/quota-modes .
