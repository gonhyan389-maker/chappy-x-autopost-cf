# Chappy AutoPost

Private automation for Reiya / Chappy. Existing X posting remains approval-first. The added note workflow can generate and publish one free note article per day from Netlify without requiring a PC to stay on.

## X safety model

- Nothing posts to X until a draft is explicitly approved.
- Every approved post is stored with an audit log.
- Global kill switch can stop outbound X posts.
- X credentials are never placed in the browser.
- Uses X OAuth 2.0 Authorization Code Flow with PKCE and `offline.access`.
- Scheduled delivery checks every 15 minutes.

## note auto-post

- Schedule: every day at **20:30 JST** (`30 11 * * *` UTC).
- Generates one Japanese **free** note article with OpenAI, then publishes it to the configured note account.
- Topic policy excludes cars, vehicle maintenance, towing and road-service content.
- It must not invent revenue, customer counts, sales results, personal experiences or other factual claims.
- Recent published titles are stored in Netlify Blobs and fed back to the generator to reduce duplicate topics.
- X announcement is separate and OFF by default (`NOTE_X_ANNOUNCE_ENABLED=false`).
- Manual test endpoint: `POST /api/note-autopost-now`, protected by `ADMIN_SECRET`.

Required environment variables:

- `NOTE_AUTOPUBLISH_ENABLED=true`
- `NOTE_URLNAME=libertas_reiya`
- `OPENAI_API_KEY` (secret)
- `OPENAI_MODEL=gpt-5.6-luna` (or another compatible Responses API model)
- Authentication: either `NOTE_SESSION_COOKIE` (secret) **or** both `NOTE_EMAIL` and `NOTE_PASSWORD` (secrets)
- Optional: `NOTE_X_ANNOUNCE_ENABLED=true` to announce the published URL via the existing X connection

### Important limitation

note.com does not provide a public article-posting API. This workflow therefore uses note.com's **unofficial internal web API**, based on current community implementations. It may stop working if note changes its editor/API or authentication behavior. Keep the posting rate low and never commit note credentials or session cookies to GitHub.

## X setup

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

## X states

`DRAFT -> APPROVED -> POSTED`

Possible terminal states: `CANCELLED`, `ERROR`.
