# Security Policy

## Supported Versions

SpriteBoy Studio is a single-version application. The latest commit on the `main` branch is the only version that receives security updates. Older versions are not patched.

## Reporting a Vulnerability

If you discover a security vulnerability, please **do not open a public GitHub issue**. Instead, report it privately:

- **GitHub:** Use the "Report a vulnerability" button under the repository's Security tab to file a private security advisory.
- **Response time:** The maintainer aims to acknowledge new reports within 7 days.
- **Disclosure:** Please give us a reasonable amount of time (typically 90 days) to investigate and ship a fix before any public disclosure.

When reporting, please include:

1. A clear description of the vulnerability and its impact.
2. Reproduction steps (a minimal demo, screenshot, or screen recording is ideal).
3. The commit hash or version you reproduced the issue on.
4. Your assessment of severity and any suggested mitigations.

## Scope

The following are in scope:

- Code execution via the canvas/image pipelines (e.g. crafted PNG/JSON uploads).
- Cross-site scripting or content injection in exported files (PNG, JSON, Phaser 3, Godot, ZIP, GIF).
- Credential or API key leakage. Note: the Gemini API key is requested at runtime and stored only in `sessionStorage`; it is never bundled, committed, or written to disk by the app.
- Dependency vulnerabilities reported via `bun audit` or GitHub Dependabot.

## Out of Scope

- Vulnerabilities in third-party services (Google AI Studio, GitHub Pages, etc.).
- Issues that require the user to already have compromised local access.

## Notes

SpriteBoy Studio is a local-first browser app. All image processing happens client-side and no project data is uploaded to a server by the application itself.
