const fs = require("fs");
const os = require("os");
const path = require("path");
const { prepareAudio } = require("../electron/audio-service.cjs");

async function main() {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "astral-audio-smoke-"));
  const project = {
    id: "cross-platform-smoke",
    scenes: [
      { duration: 2, narration: "A small star wakes up.", musicMood: "gentle cosmic wonder", sfx: [{ at: 0.4, note: 84, kind: "sparkle" }] },
      { duration: 2, narration: "It shines brightly.", musicMood: "warm triumphant finale", sfx: [{ at: 0.3, note: 88, kind: "whoosh" }] },
    ],
  };
  const result = await prepareAudio({
    project,
    outputDir,
    synthScript: path.resolve(__dirname, "..", "electron", "scripts", "synthesize.ps1"),
  });
  const files = [result.narrationPath, result.musicPath, result.sfxPath, result.musicMidiPath, result.sfxMidiPath];
  const sizes = Object.fromEntries(files.map((file) => [path.basename(file), fs.statSync(file).size]));
  if (Object.values(sizes).some((size) => size <= 44)) throw new Error("A generated audio artifact is empty.");
  process.stdout.write(`${JSON.stringify({ platform: process.platform, arch: process.arch, sceneDurations: result.sceneDurations, sizes }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
