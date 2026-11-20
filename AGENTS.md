# Local development workflow

- Use the API and Vite commands in `README.md` for local development.
- Keep the existing development servers running across edits. Vite updates frontend changes automatically; Uvicorn's `--reload` handles Python changes.
- Do not start Docker or run `docker compose` as part of local development.
- Do not run `npm run build` or restart the development servers after every edit. Build only when a production build or build verification is actually needed.
