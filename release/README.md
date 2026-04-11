# Releases

This directory stores packaged `.zip` builds created from committed git versions.

Current convention:

- file name: `zhijiao-reader-<short-commit>-<timestamp>.zip`
- source: `git archive HEAD`
- excluded automatically: `.env`, `.git`, `node_modules`, `dist`, local caches, and other untracked files

Create a new package with:

```bash
node scripts/create-release.mjs
```
