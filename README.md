# Astral Director

Astral Director is a Windows desktop animation studio that turns a simple or detailed story request into a clear, narrated portrait animation. It uses Codex Desktop for structured story planning and built-in image generation, Three.js for animation, Windows text-to-speech for narration, generated MIDI for music and sound effects, and FFmpeg for MP4 export.

![Astral Director production desk](docs/astral-director.png)

## What it does

- Builds direct, easy-to-follow scene plans from natural-language prompts.
- Generates reusable portrait backgrounds, characters, and objects through Codex Desktop without image API keys.
- Animates layered art with movement, rotation, glow, shake, squash, stretch, pulse, and staged entrances.
- Synchronizes Windows voice narration with scrolling karaoke-style subtitles.
- Composes full-length MIDI music and scene-specific MIDI sound effects.
- Exports a 1080 × 1920 MP4 optimized for mobile viewing.
- Stores projects and generated art locally for reuse.
- Checks GitHub Releases from one in-app update button, downloads updates automatically, and restarts into the new version when ready.
- Displays the current Huntsville, Alabama time, installed version, and last release timestamp.

## Install

Download the newest `Astral Director Setup` installer from [GitHub Releases](https://github.com/jetblackrlsh/AI-Agent-Animation-Maker-App/releases/latest). The application is currently an unsigned independent Windows build, so Windows SmartScreen may show its standard warning.

Image and story generation require a local, signed-in Codex installation. No OpenAI API key is requested or stored by this application.

## Development

Requirements: Node.js 22+, npm, Codex CLI/Desktop, Windows PowerShell, and Windows 10 or 11.

```powershell
npm install
npm run dev
```

Production checks and packaging:

```powershell
npm run build
npm run dist:win
```

## Publishing an update

1. Update the version and `releaseDate` in `package.json`.
2. Commit and push the change.
3. Tag the commit using the matching version, such as `v1.0.1`, and push the tag.
4. The release workflow builds the Windows installer plus Electron update metadata and publishes them to GitHub Releases.

Installed copies can then use **Check for updates**. The same button reports download progress and changes to **Restart to install** when the update is ready.

## Privacy and security

- The renderer is sandboxed and has no Node.js access.
- File, process, Codex, speech, update, and export operations stay in the Electron main process behind narrow IPC methods.
- Generated images are recovered from local Codex task logs and copied into the app-owned asset library.
- The source contains no direct image API integration and stores no model API keys.

## License

MIT
