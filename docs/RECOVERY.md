# Clarix Pulse - Recovery Notes

## What is backed up in GitHub

GitHub now contains:

- the application source code
- deployment scripts
- onboarding and deployment documentation
- the recovery template at `recovery/ENV_RECOVERY_TEMPLATE.env`

## What is NOT stored in Git

Real production secrets are still excluded from Git on purpose:

- `.env.local`
- live database passwords
- VPS root password
- SMTP password
- signed-download secret

Reason:

- storing live secrets in Git would expose production access if the repo is shared, cloned, leaked, or downloaded to another machine

## Recovery workflow

1. Clone the repo from GitHub.
2. Copy `recovery/ENV_RECOVERY_TEMPLATE.env` to a local `.env.local`.
3. Fill in the real secret values from your private vault or password manager.
4. Run the deployment helper:

```powershell
python scripts\vps_clean_redeploy.py --archive <archive-path>
```

## Recommended real-world backup

Keep the real values in one private place outside Git, such as:

- 1Password
- Bitwarden
- Proton Pass
- an encrypted offline vault file

## Admin cleanup

The admin panel now supports:

- disable account
- renew key
- send reset link
- open workspace
- delete account

Delete is intended for unwanted customer accounts, not the platform-admin workspace.
