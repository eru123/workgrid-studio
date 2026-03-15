# Security Policy

## Supported Versions

Only the latest release of WorkGrid Studio receives security fixes. We do not backport security patches to older versions.

| Version | Supported |
| ------- | --------- |
| Latest  | ✅ Yes    |
| Older   | ❌ No     |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

If you believe you have found a security vulnerability in WorkGrid Studio, please report it responsibly via **GitHub's private vulnerability reporting**:

1. Go to the **Security** tab of this repository.
2. Click **"Report a vulnerability"**.
3. Fill in the details and submit.

Alternatively, you may open a [GitHub Security Advisory](../../security/advisories/new) directly.

### What to include

To help us triage and resolve the issue quickly, please include:

- A clear description of the vulnerability and its potential impact.
- The affected version(s).
- Step-by-step instructions to reproduce the issue.
- Any proof-of-concept code or screenshots (if applicable).
- Your suggested fix or mitigation (optional but appreciated).

## Response Timeline

| Step | Target timeframe |
| ---- | ---------------- |
| Acknowledgement | Within **48 hours** |
| Initial assessment | Within **7 days** |
| Fix & release | Depends on severity; critical issues are prioritised |

We will keep you informed of our progress throughout the process.

## Disclosure Policy

We follow **coordinated disclosure**. Once a fix is available, we will:

1. Release a patched version.
2. Publish a GitHub Security Advisory crediting the reporter (unless you prefer to remain anonymous).

Please allow us reasonable time to investigate and patch before any public disclosure.

## Scope

The following are **in scope**:

- The WorkGrid Studio desktop application (`src/`, `src-tauri/`)
- The auto-updater service (`wgs-updater/`)
- Vulnerabilities that could expose local data, allow remote code execution, or bypass the Tauri security model

The following are **out of scope**:

- Vulnerabilities in third-party dependencies (please report those upstream)
- Issues only reproducible on unsupported or end-of-life operating systems
- Social engineering attacks

## Thank You

We appreciate the efforts of security researchers who help keep WorkGrid Studio safe. Responsible disclosure helps protect our users and we are grateful for your contribution.
