<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/brand/local-operator-icon-2-dark-clear.png">
    <source media="(prefers-color-scheme: light)" srcset="./docs/assets/brand/local-operator-icon-2-light-clear.png">
    <img alt="The Local Operator logo: black in light color mode, white in dark color mode." width="360"
         src="./docs/assets/brand/local-operator-icon-2-light-clear.png">
  </picture>
</p>

<h1 align="center">Local Operator Mobile</h1>

<p align="center"><i>Drive the Local Operator agent sessions running on your computer from your phone.</i></p>

<p align="center">
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/github/license/damianvtran/local-operator-mobile"></a>
  <img alt="CI: not yet configured" src="https://img.shields.io/badge/CI-not%20yet%20configured-lightgrey">
  <img alt="Platforms: iOS and Android" src="https://img.shields.io/badge/platform-iOS%20%7C%20Android-lightgrey">
  <img alt="Status: in development" src="https://img.shields.io/badge/status-in%20development-orange">
</p>

<p align="center">
  <a href="https://github.com/damianvtran/local-operator">Agent backend</a> •
  <a href="https://github.com/damianvtran/local-operator-ui">Desktop app</a> •
  <a href="https://local-operator.com">Website</a>
</p>

> **Status: in development.** This repository is at the research and design stage. There is no app build yet, and nothing below describes shipped functionality — every feature is planned.

## What it is

**Local Operator Mobile** is a native iOS and Android client for [Local Operator](https://github.com/damianvtran/local-operator) sessions that run on your own computer. Your agents keep running where they are — on your machine, with your files and your tools — and the app lets you follow along, answer questions, approve risky steps, and start new work while you are away from your desk.

It talks to the mobile relay that ships with Local Operator (`lop mobile`), the same relay behind today's mobile web client, and it aims to be a faster, more native way to use it: real push-style updates, platform sign-in, and a layout designed for a phone rather than adapted to one.

## Features

All of these are **in development**; none has shipped.

- **Session list** — every live session on your computer, with what each one is doing right now.
- **Live transcript** — follow a session as it works: messages, tool calls, and results as they stream in.
- **Steer and stop** — send a follow-up to redirect a running agent, or stop it.
- **Approvals and questions** — answer an agent's questions and approve or decline the steps it asks about.
- **Model and effort** — switch a session's model and reasoning effort.
- **Slash commands** — the session's commands, with suggestions as you type.
- **Subagents** — drill into the subagents a session has started and follow each one.
- **To-dos** — the task list a session is working through.
- **Past sessions** — search earlier sessions and resume one.
- **New session** — start a session in a folder you pick on your computer.
- **Image attachments** — send a photo or screenshot into a session.

## How it connects

Local Operator's mobile relay runs on your computer and only listens locally. The app reaches it through a tunnel, and there are two ways to set one up:

- **Sign in with Radient** — sign in with your Radient account and the app finds your personal tunnels for you. The tunnel handles authentication, so you do not need a separate relay password.
- **Any tunnel or URL** — point the app at a tunnel or URL you run yourself, and sign in with your relay password.

To set up the computer side, see the Local Operator docs for [tunnels](https://github.com/damianvtran/local-operator/blob/main/docs/tunnels.md) and the [mobile relay](https://github.com/damianvtran/local-operator/blob/main/docs/mobile.md).

## Download

There is no release yet. When the first build is ready it will be listed here:

- **App Store (iOS)** — coming soon
- **TestFlight (iOS beta)** — coming soon
- **Google Play (Android)** — coming soon
- **GitHub Releases** — coming soon

## Screenshots

Screenshots will be added here with the first app build, captured from the real app in light and dark themes.

## Development

The toolchain has not been chosen yet. That decision, and the reasoning behind it, will be recorded as an architecture decision record in [`docs/adr/`](./docs/). Setup instructions will follow here once it lands.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how changes are proposed and reviewed, and [AGENTS.md](./AGENTS.md) for the conventions humans and coding agents follow in this repository.

## Documentation

The documentation index is [docs/README.md](./docs/README.md). Planned sections:

- `docs/adr/` — architecture decision records, starting with the toolchain choice.
- `docs/relay/` — how the app talks to the Local Operator mobile relay and the Radient tunnel.
- `docs/publishing/` — App Store, Google Play, and other store requirements.
- `docs/ux/` — user experience research, flows, and audit harnesses.
- `design/` — the design and brand kit.
- `store/` — store listing copy and assets.

## Security

The app is a remote control for agents that can run code on your computer, so security reports are taken seriously. Please report vulnerabilities privately as described in [SECURITY.md](./SECURITY.md) — not in a public issue.

## License

This project is licensed under the MIT License — see the [LICENSE](./LICENSE) file for details.
