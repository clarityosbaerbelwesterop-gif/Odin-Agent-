# Auth hotfix evidence

- Production runtime showed repeated `403` responses from `/api/config` and `/api/bot` for an unverified Neon session instead of returning users to `/login`.
- The login page CSP allowed only `connect-src 'self'`, while GitHub sign-in deliberately starts through the configured Neon Auth origin; browsers therefore blocked that request before OAuth could open.
- The hotfix routes `EMAIL_UNVERIFIED` back to the login/verification surface, clears incomplete auto-sign-in sessions after signup, corrects the bot `returnTo` parameter, and permits only the configured Neon Auth origin on the login CSP.
- `npm run verify` passed in the one-shot integration workflow before this branch was committed.
