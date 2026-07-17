const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const ffmpegStatic = require("ffmpeg-static");

function ffmpegPath() {
  const candidate = String(ffmpegStatic || "ffmpeg").replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  return fs.existsSync(candidate) ? candidate : "ffmpeg";
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `${command} exited with ${code}.`)));
  });
}

function wavDuration(filePath) {
  const data = fs.readFileSync(filePath);
  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (offset + 8 <= data.length) {
    const id = data.toString("ascii", offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    if (id === "fmt ") byteRate = data.readUInt32LE(offset + 16);
    if (id === "data") { dataSize = size; break; }
    offset += 8 + size + (size % 2);
  }
  return byteRate ? dataSize / byteRate : 0;
}

async function synthesizeSpeech({ textPath, wavPath, synthScript }) {
  if (process.platform === "win32") {
    await run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", synthScript, "-TextPath", textPath, "-OutputPath", wavPath]);
    return;
  }
  if (process.platform === "darwin") {
    const aiffPath = wavPath.replace(/\.wav$/i, ".aiff");
    await run("/usr/bin/say", ["-f", textPath, "-o", aiffPath]);
    await run(ffmpegPath(), ["-i", aiffPath, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", "-y", wavPath]);
    fs.unlinkSync(aiffPath);
    return;
  }
  throw new Error("Narration synthesis is supported on Windows and macOS.");
}

function writeWav(filePath, samples, sampleRate = 48000) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buffer.writeInt16LE(Math.max(-32767, Math.min(32767, samples[i] * 32767)), 44 + i * 2);
  fs.writeFileSync(filePath, buffer);
}

function renderMusic(totalDuration, mood, outPath) {
  const rate = 48000;
  const samples = new Float32Array(Math.ceil(totalDuration * rate));
  const minor = /myster|danger|dark|tense/i.test(mood || "");
  const root = /triumph|hero|bright/i.test(mood || "") ? 62 : 57;
  const scale = minor ? [0, 3, 7, 10, 12, 15, 19] : [0, 4, 7, 9, 12, 16, 19];
  const bpm = /urgent|fast|chase/i.test(mood || "") ? 118 : 92;
  const beat = 60 / bpm;
  for (let step = 0; step * beat < totalDuration; step++) {
    const start = step * beat;
    const midi = root + scale[step % scale.length] + (step % 8 === 7 ? 12 : 0);
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const length = beat * 0.82;
    const startIndex = Math.floor(start * rate);
    const endIndex = Math.min(samples.length, startIndex + Math.floor(length * rate));
    for (let i = startIndex; i < endIndex; i++) {
      const t = (i - startIndex) / rate;
      const envelope = Math.min(1, t / 0.04) * Math.exp(-2.4 * t / length);
      samples[i] += envelope * (Math.sin(2 * Math.PI * freq * t) * 0.17 + Math.sin(2 * Math.PI * freq * 2 * t) * 0.045);
    }
  }
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate;
    samples[i] *= Math.min(1, t / 0.8, (totalDuration - t) / 1.2);
  }
  writeWav(outPath, samples, rate);
  return { root, scale, bpm };
}

function renderSfx(project, sceneOffsets, totalDuration, outPath) {
  const rate = 48000;
  const samples = new Float32Array(Math.ceil(totalDuration * rate));
  project.scenes.forEach((scene, sceneIndex) => {
    (scene.sfx || []).forEach((effect) => {
      const start = sceneOffsets[sceneIndex] + Number(effect.at || 0);
      const length = effect.kind === "whoosh" ? 0.75 : 0.42;
      const startIndex = Math.floor(start * rate);
      const endIndex = Math.min(samples.length, startIndex + Math.floor(length * rate));
      const base = 440 * Math.pow(2, (Number(effect.note || 76) - 69) / 12);
      for (let i = startIndex; i < endIndex; i++) {
        const t = (i - startIndex) / rate;
        const p = t / length;
        const freq = effect.kind === "whoosh" ? base * (0.45 + p * 1.7) : base * (1 + p * 0.3);
        const envelope = Math.sin(Math.PI * Math.min(1, p)) * (1 - p);
        const noise = Math.sin(i * 12.9898) * 0.045;
        samples[i] += envelope * (Math.sin(2 * Math.PI * freq * t) * 0.34 + noise);
      }
    });
  });
  writeWav(outPath, samples, rate);
}

function variableLength(value) {
  let buffer = value & 0x7f;
  const bytes = [];
  while ((value >>= 7)) { buffer <<= 8; buffer |= ((value & 0x7f) | 0x80); }
  while (true) { bytes.push(buffer & 0xff); if (buffer & 0x80) buffer >>= 8; else break; }
  return bytes;
}

function writeMidi(filePath, totalDuration, musicInfo, project, sceneOffsets, sfxOnly = false) {
  const ticks = 480;
  const micros = Math.round(60000000 / musicInfo.bpm);
  const events = [0x00, 0xff, 0x51, 0x03, (micros >> 16) & 255, (micros >> 8) & 255, micros & 255];
  const notes = [];
  if (!sfxOnly) {
    const beat = 60 / musicInfo.bpm;
    for (let step = 0; step * beat < totalDuration; step++) notes.push({ time: step * beat, duration: beat * 0.8, note: musicInfo.root + musicInfo.scale[step % musicInfo.scale.length], velocity: 58 });
  } else {
    project.scenes.forEach((scene, i) => (scene.sfx || []).forEach((fx) => notes.push({ time: sceneOffsets[i] + Number(fx.at || 0), duration: 0.35, note: Number(fx.note || 76), velocity: 100 })));
  }
  let previousTick = 0;
  const midiEvents = [];
  notes.forEach((note) => {
    midiEvents.push({ tick: Math.round(note.time * musicInfo.bpm / 60 * ticks), data: [0x90, note.note & 0x7f, note.velocity] });
    midiEvents.push({ tick: Math.round((note.time + note.duration) * musicInfo.bpm / 60 * ticks), data: [0x80, note.note & 0x7f, 0] });
  });
  midiEvents.sort((a, b) => a.tick - b.tick || a.data[0] - b.data[0]);
  midiEvents.forEach((event) => {
    events.push(...variableLength(Math.max(0, event.tick - previousTick)), ...event.data);
    previousTick = event.tick;
  });
  events.push(0x00, 0xff, 0x2f, 0x00);
  const track = Buffer.from(events);
  const header = Buffer.alloc(14);
  header.write("MThd", 0); header.writeUInt32BE(6, 4); header.writeUInt16BE(0, 8); header.writeUInt16BE(1, 10); header.writeUInt16BE(ticks, 12);
  const chunk = Buffer.alloc(8); chunk.write("MTrk", 0); chunk.writeUInt32BE(track.length, 4);
  fs.writeFileSync(filePath, Buffer.concat([header, chunk, track]));
}

async function prepareAudio({ project, outputDir, synthScript, onStatus }) {
  fs.mkdirSync(outputDir, { recursive: true });
  onStatus?.("synthesizing-narration");
  const speechPaths = [];
  const measuredDurations = [];
  for (let i = 0; i < project.scenes.length; i++) {
    const textPath = path.join(outputDir, `scene-${i + 1}.txt`);
    const wavPath = path.join(outputDir, `scene-${i + 1}.wav`);
    fs.writeFileSync(textPath, project.scenes[i].narration || project.scenes[i].caption || "");
    await synthesizeSpeech({ textPath, wavPath, synthScript });
    speechPaths.push(wavPath);
    measuredDurations.push(wavDuration(wavPath));
  }
  const sceneDurations = project.scenes.map((scene, i) => Math.max(Number(scene.duration || 5), measuredDurations[i] + 1.1));
  const offsets = [];
  sceneDurations.reduce((sum, duration) => { offsets.push(sum); return sum + duration; }, 0);
  const totalDuration = sceneDurations.reduce((sum, duration) => sum + duration, 0);
  const narrationPath = path.join(outputDir, "narration.wav");
  const filters = speechPaths.map((_file, i) => `[${i}:a]adelay=${Math.round(offsets[i] * 1000)}:all=1[n${i}]`).join(";");
  const inputs = speechPaths.flatMap((file) => ["-i", file]);
  const mixInputs = speechPaths.map((_file, i) => `[n${i}]`).join("");
  await run(ffmpegPath(), [...inputs, "-filter_complex", `${filters};${mixInputs}amix=inputs=${speechPaths.length}:duration=longest:normalize=0,apad=pad_dur=${totalDuration},atrim=0:${totalDuration}[a]`, "-map", "[a]", "-ar", "48000", "-ac", "1", "-y", narrationPath]);

  onStatus?.("composing-midi");
  const mood = project.scenes.map((scene) => scene.musicMood || "").join(" ");
  const musicPath = path.join(outputDir, "music.wav");
  const sfxPath = path.join(outputDir, "sfx.wav");
  const musicInfo = renderMusic(totalDuration, mood, musicPath);
  renderSfx(project, offsets, totalDuration, sfxPath);
  writeMidi(path.join(outputDir, "music.mid"), totalDuration, musicInfo, project, offsets, false);
  writeMidi(path.join(outputDir, "sfx.mid"), totalDuration, musicInfo, project, offsets, true);
  onStatus?.("audio-ready");
  return { sceneDurations, totalDuration, narrationPath, musicPath, sfxPath, musicMidiPath: path.join(outputDir, "music.mid"), sfxMidiPath: path.join(outputDir, "sfx.mid") };
}

async function exportVideo({ videoPath, audio, destination }) {
  await run(ffmpegPath(), [
    "-i", videoPath, "-i", audio.musicPath, "-i", audio.narrationPath, "-i", audio.sfxPath,
    "-filter_complex", "[1:a]volume=0.22[m];[2:a]volume=1.0[n];[3:a]volume=0.6[s];[m][n][s]amix=inputs=3:duration=longest:normalize=0[a]",
    "-map", "0:v:0", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", "-y", destination,
  ]);
}

module.exports = { prepareAudio, exportVideo };
