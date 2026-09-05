# Chappy X AutoPost v0.3

A private, approval-first X posting queue for Reiya / Chappy.

## Safety model

- Nothing posts until a draft is explicitly approved.
- Every approved post is stored with an audit log.
- Global kill switch can stop all outbound X posts.
- X credentials are never placed in the browser.
- Uses X OAuth 2.0 Authorization Code Flow with PKCE and `offline.access`.
- Scheduled delivery uses a Netlify Scheduled Function every 15 minutes.

## Setup

1. Create an X Developer App and enable OAuth 2.0.
2. Add this callback URL to the X app settings:
   `https://YOUR-SITE.netlify.app/api/x-auth-callback`
3. Set these Netlify environment variables:
   - `X_CLIENT_ID`
   - `X_CLIENT_SECRET` (only if your X app is a confidential client)
   - `X_REDIRECT_URI`
   - `ADMIN_SECRET`
4. Deploy to Netlify.
5. Open the site, enter `ADMIN_SECRET`, and click **Connect X**.
6. Draft a post, choose JST time, save as draft, then explicitly approve it.

## States

`DRAFT -> APPROVED -> POSTED`

Possible terminal states: `CANCELLED`, `ERROR`.

## Notes

- The scheduler checks every 15 minutes, so a post may publish a few minutes after the requested time.
- The UI intentionally has no one-click unaudited "post now" path.
- If `POSTING_ENABLED` is OFF in app settings, the scheduler will not send anything to X.

## v0.3 hardening

- X create-post payload is text-only until additional fields are verified in current official X documentation.
- `madeWithAi` is retained as internal metadata only.
- Netlify callback route must remain publicly reachable; admin APIs are protected by `ADMIN_SECRET`.
