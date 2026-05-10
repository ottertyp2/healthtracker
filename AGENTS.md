# Agent Instructions

This project is deployed with Firebase Hosting and Firestore.

The canonical GitHub repository is:

```text
https://github.com/ottertyp2/healthtracker.git
```

Agents should keep this repository maintained. Before starting substantial work, check `git status` and the configured remote. After completing a coherent change, commit the relevant files with a concise message and push to `origin` unless the user explicitly asks not to.

After changing app code, styles, Firestore rules, indexes, public assets, or documentation that affects the hosted app, the agent should:

1. Run `npm run build`.
2. If the build succeeds, run `npm run firebase:deploy`.
3. Verify the live app at `https://healthtracker-5f7a4.web.app`.
4. Mention the deploy result and live URL in the final response.

Do not stop after local changes when the user expects to see the result on the hosted Firebase app.

If deployment fails, report the exact failing step and leave the local changes in place.

Do not commit secrets or local-only generated files. Keep `.env.local`, `node_modules`, `dist`, `.firebase`, logs, and local screenshots out of Git.
