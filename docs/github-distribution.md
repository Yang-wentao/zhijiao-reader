# GitHub Distribution

## Goal

Let another user clone, install, and launch the reader with one command, then finish provider setup inside the app.

## Recommended publish path

1. Push this repository to GitHub.
2. Replace `YOUR_GITHUB_NAME` in [install.sh](/Users/yangwentao/Documents/软件开发尝试/install.sh) and [install.ps1](/Users/yangwentao/Documents/软件开发尝试/install.ps1) with the real repository owner.
3. Tell macOS/Linux users to run:

```bash
curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/install.sh | bash
```

4. Tell Windows users to run:

```powershell
irm https://raw.githubusercontent.com/<owner>/<repo>/main/install.ps1 | iex
```

## Why this packaging works

- The install script handles clone or update.
- `npm run launch` already installs missing dependencies and opens the app.
- Provider/API secrets are entered later in the app, not embedded in the shell command.

## Security note

Do not hardcode real API keys into the repository, installer script, or `.env.example`.
