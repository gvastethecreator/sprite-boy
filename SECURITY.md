# Security Policy

The latest commit on `main` is the only version that receives security updates. Older versions are not patched.

## Reporting a vulnerability

Do not open a public GitHub issue. Report privately:

- **GitHub:** Use **Report a vulnerability** on the repository Security tab.
- **Response time:** The maintainer aims to acknowledge new reports within 7 days.
- **Disclosure:** Give a reasonable amount of time (typically 90 days) to investigate and ship a fix before public disclosure.

Include:

1. A clear description of the vulnerability and its impact.
2. Reproduction steps (a minimal demo, screenshot, or screen recording is ideal).
3. The commit hash or version you reproduced the issue on.
4. Your assessment of severity and any suggested mitigations.

## Scope

In scope:

- Code execution via the canvas/image pipelines (for example, crafted PNG/JSON uploads).
- Cross-site scripting or content injection in exported files (PNG, JSON, Phaser 3, Godot, ZIP, GIF).
- Credential or local project-data leakage.
- Dependency vulnerabilities reported via `bun audit` or GitHub Dependabot.

Out of scope:

- Vulnerabilities in third-party services (GitHub Pages, and similar).
- Issues that require the user to already have compromised local access.

## Notes

SpriteBoy Studio is a local-first browser app. All image processing happens client-side. The application itself does not upload project data to a server.