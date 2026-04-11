# GitHub Distribution

## Goal

Let another user clone, install, and launch the reader with one command, then finish provider setup inside the app.

## Recommended publish path

1. Push this repository to GitHub.
2. Set the real repository URL in the installer commands, or export `REPO_URL` before running them.
3. Tell macOS/Linux users to run:

```bash
curl -fsSL https://raw.githubusercontent.com/<owner>/zhijiao-reader/main/install.sh | bash
```

4. Tell Windows users to run:

```powershell
irm https://raw.githubusercontent.com/<owner>/zhijiao-reader/main/install.ps1 | iex
```

## Why this packaging works

- The install script handles clone or update.
- `npm run launch` already installs missing dependencies and opens the app.
- Provider/API secrets are entered later in the app, not embedded in the shell command.

## Before the first public push

1. Confirm `README.md` describes both source launch and GitHub Releases usage.
2. Make sure no real API keys are present in `.env`, `.env.example`, installer scripts, or tracked config files.
3. Create a GitHub repository and either:
   - replace the placeholder `REPO_URL` default in [install.sh](../install.sh) and [install.ps1](../install.ps1), or
   - keep the scripts generic and document that users can set `REPO_URL` explicitly.
4. Push a tag such as `v0.1.0` to trigger the release workflow.

## Distribution recommendation

- For technical users: source launch via `git clone` + `npm run launch`
- For general users: packaged downloads from GitHub Releases
- For `Local Codex`: document clearly that Codex CLI must be installed separately on each machine

## Security note

Do not hardcode real API keys into the repository, installer script, or `.env.example`.
