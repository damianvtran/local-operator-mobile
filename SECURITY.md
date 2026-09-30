# Security Policy

## Introduction

Thank you for helping keep the Local Operator mobile app secure. The app is a remote control for [Local Operator](https://github.com/damianvtran/local-operator) agent sessions running on your own computer — agents that can read files and run code there — so a weakness in the app can be a weakness in the machine it connects to. This policy explains how to report an issue and how we handle it.

## Supported Versions

The app has not been released yet. Once it is, security fixes will target the latest release published to the app stores and to [GitHub Releases](https://github.com/damianvtran/local-operator-mobile/releases); please update to the latest version before reporting.

Issues in the relay or tunnel on the computer side (`lop mobile`, `lop tunnel`) belong to the [Local Operator repository](https://github.com/damianvtran/local-operator/security) — report them there. If you are not sure which side an issue lives on, report it here and we will route it.

## Security Model

These are the properties the app is designed to keep. A report that shows any of them can be broken is in scope.

- **No inbound exposure on your computer.** The Local Operator relay listens only on your computer; the app reaches it through a tunnel you set up, never through an open port.
- **Platform sign-in, not embedded web views.** Signing in with Radient uses the operating system's authentication session (ASWebAuthenticationSession on iOS, Custom Tabs on Android) with PKCE, so the app never sees your identity provider password.
- **Credentials in the platform keystore.** Tokens and relay passwords are stored in the iOS Keychain or Android Keystore, never in plain files, logs, or crash reports.
- **Short-lived tunnel access.** Access to a Radient tunnel uses short-lived, host-bound tokens that the app refreshes, rather than a long-lived secret sent with every request.
- **No secrets in the repository.** Signing keys, store credentials, and personal hostnames are never committed; release signing happens in CI from encrypted secrets.

## Reporting a Vulnerability

Please do **not** open a public issue for a security problem. Instead, [report it privately](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) by opening a GitHub Security Advisory on this repository. Please include:

1. **Description** — what the vulnerability is and the context needed to understand it.
2. **Reproduction steps** — how to trigger it, with any code, logs, or screenshots that help. Redact your own tunnel hostnames, tokens, and passwords.
3. **Impact** — what an attacker could do, and what data or systems are affected.
4. **Additional information** — mitigating factors, suggested fixes, or anything else useful, and optionally how to reach you for follow-up.

You can update the advisory as you learn more. We will acknowledge the report, keep you informed as we investigate, and credit you in the published advisory if you wish.

## Disclosure Policy

We follow responsible disclosure. Once a vulnerability is confirmed and fixed, we will:

- Publish a GitHub Security Advisory describing the issue, the affected versions, and how to update.
- Ship the fix through the app stores and GitHub Releases, and note it in the release notes.

## Contact

For security questions, or help creating an advisory, email [contact@local-operator.com](mailto:contact@local-operator.com).

## Additional Resources

- [GitHub Security Advisories documentation](https://docs.github.com/en/code-security/security-advisories/working-with-repository-security-advisories/creating-a-repository-security-advisory)
- [Local Operator security policy](https://github.com/damianvtran/local-operator/blob/main/SECURITY.md)

Thank you for helping keep the Local Operator mobile app secure.
