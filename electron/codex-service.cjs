const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const sharp = require("sharp");

function resolveCodexSpawn() {
  const codexJs = path.join(
    process.env.APPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Roaming"),
    "npm", "node_modules", "@openai", "codex", "bin", "codex.js"
  );
  if (process.platform === "win32" && fs.existsSync(codexJs)) {
    return {
      command: process.execPath,
      args: [codexJs, "app-server"],
      env: process.versions.electron ? { ...process.env, ELECTRON_RUN_AS_NODE: "1" } : process.env,
    };
  }
  if (process.platform === "darwin") {
    const macJsCandidates = [
      process.env.CODEX_CLI_JS,
      path.join(os.homedir(), ".npm-global", "lib", "node_modules", "@openai", "codex", "bin", "codex.js"),
      "/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js",
      "/usr/local/lib/node_modules/@openai/codex/bin/codex.js",
    ].filter(Boolean);
    const macCodexJs = macJsCandidates.find((candidate) => fs.existsSync(candidate));
    if (macCodexJs) {
      return {
        command: process.execPath,
        args: [macCodexJs, "app-server"],
        env: process.versions.electron ? { ...process.env, ELECTRON_RUN_AS_NODE: "1" } : process.env,
      };
    }
    const macBinaryCandidates = [
      process.env.CODEX_CLI_PATH,
      "/opt/homebrew/bin/codex",
      "/usr/local/bin/codex",
      path.join(os.homedir(), ".local", "bin", "codex"),
      path.join(os.homedir(), ".npm-global", "bin", "codex"),
    ].filter(Boolean);
    const macCodex = macBinaryCandidates.find((candidate) => fs.existsSync(candidate));
    if (macCodex) return { command: macCodex, args: ["app-server"], env: process.env };
  }
  return { command: "codex", args: ["app-server"], env: process.env };
}

function collectText(item) {
  if (!item) return "";
  if (typeof item.text === "string") return item.text;
  if (typeof item.content === "string") return item.content;
  if (Array.isArray(item.content)) {
    return item.content.map((part) => part?.text || part?.content || "").join("\n");
  }
  return "";
}

function runCodexTurn({ cwd, prompt, baseInstructions, onStatus, timeoutMs = 7 * 60 * 1000 }) {
  const executable = resolveCodexSpawn();
  const child = spawn(executable.command, executable.args, {
    cwd,
    shell: false,
    windowsHide: true,
    env: executable.env,
  });
  let buffer = "";
  let stderr = "";
  let threadId = null;
  let responseText = "";
  let nextId = 1;
  let settled = false;

  const send = (method, params) => {
    const id = nextId++;
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    return id;
  };

  return new Promise((resolve, reject) => {
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill("SIGTERM");
      if (error) reject(error); else resolve(result);
    };
    const timeout = setTimeout(() => finish(new Error("Codex took too long to finish this request.")), timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event.id === 2 && event.result?.thread?.id) {
          threadId = event.result.thread.id;
          onStatus?.("generating-in-codex-desktop");
          send("turn/start", {
            threadId,
            input: [{ type: "text", text: prompt }],
            cwd,
            approvalPolicy: "never",
          });
          continue;
        }
        const item = event.params?.item || event.result?.item;
        if (item && ["agentMessage", "assistant_message", "message"].includes(item.type)) {
          responseText += `${collectText(item)}\n`;
        }
        if (event.method === "turn/completed") {
          const finalText = responseText.trim() || collectText(event.params?.turn?.output) || collectText(event.result);
          finish(null, { threadId, text: finalText });
        }
        if (event.method === "turn/failed") {
          finish(new Error(event.params?.error?.message || "The Codex request failed."));
        }
      }
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (!settled) finish(new Error(stderr.trim() || `Codex app-server stopped with code ${code}.`));
    });

    onStatus?.("starting-codex-app-server");
    send("initialize", { clientInfo: { name: "astral-director", version: "1.1.0" } });
    onStatus?.("creating-thread");
    send("thread/start", {
      cwd,
      sandbox: "read-only",
      approvalPolicy: "never",
      baseInstructions,
    });
  });
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] || text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  if (!candidate.trim()) throw new Error("Codex did not return a story plan.");
  return JSON.parse(candidate.trim());
}

async function generateStory({ cwd, request, onStatus }) {
  const prompt = `Create a concise, extremely clear portrait animation plan from this user request:\n\n${request.prompt}\n\nTarget length: ${request.duration || 30} seconds. Scene count: ${request.sceneCount || 4}. Tone: ${request.tone || "uplifting adventure"}.\n\nReturn ONLY valid JSON with this shape:\n{\n  "title": "short title",\n  "logline": "one clear sentence",\n  "scenes": [{\n    "title": "scene title",\n    "duration": 6,\n    "narration": "plain spoken narration",\n    "caption": "the same narration, edited only for readability",\n    "backgroundPrompt": "visual prompt with no text",\n    "characters": [{"name":"name","imagePrompt":"transparent-background visual prompt","x":0,"y":-0.25,"scale":0.75,"action":"float|enter-left|enter-right|pulse|shake|squash|stretch|rotate"}],\n    "objects": [{"name":"name","imagePrompt":"transparent-background visual prompt","x":0.4,"y":0.1,"scale":0.3,"action":"float|pulse|shake|rotate|glow"}],\n    "musicMood": "short MIDI music direction",\n    "sfx": [{"at":1.2,"note":84,"kind":"sparkle|impact|whoosh"}]\n  }]\n}\nUse 2 or fewer characters and 2 or fewer objects per scene. Keep narration literal and easy to follow. Use no dialogue. Every scene must visibly advance one simple cause-and-effect story. Durations must total close to the target.`;
  const result = await runCodexTurn({
    cwd,
    prompt,
    baseInstructions: "You are the story-planning engine for a local Three.js portrait animation studio. Return machine-readable JSON only. Do not use tools or modify files.",
    onStatus,
  });
  return { ...extractJson(result.text), sourceThreadId: result.threadId };
}

function findThreadLogs(threadId, lookbackDays = 14) {
  const sessionsRoot = path.join(os.homedir(), ".codex", "sessions");
  if (!fs.existsSync(sessionsRoot)) throw new Error(`Codex sessions folder does not exist: ${sessionsRoot}`);
  const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const suffix = `-${threadId}.jsonl`.toLowerCase();
  const matches = [];
  const visit = (directory) => {
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(suffix)) {
        const stats = fs.statSync(fullPath);
        if (stats.mtimeMs >= cutoff) matches.push({ path: fullPath, modified: stats.mtimeMs });
      }
    }
  };
  visit(sessionsRoot);
  matches.sort((a, b) => a.modified - b.modified || a.path.localeCompare(b.path));
  if (!matches.length) throw new Error(`No Codex session log was found for task ${threadId}.`);
  return matches.map((match) => match.path);
}

async function exportImageFromLogs(threadId, outPath) {
  const logs = findThreadLogs(threadId);
  let latestBase64 = null;
  for (const logPath of logs) {
    const lines = readline.createInterface({ input: fs.createReadStream(logPath, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.includes("image_generation_end")) continue;
      try {
        const item = JSON.parse(line);
        if (item?.type === "event_msg" && item.payload?.type === "image_generation_end" && typeof item.payload.result === "string") latestBase64 = item.payload.result;
      } catch { /* ignore unrelated or partially written JSONL lines */ }
    }
  }
  if (!latestBase64) throw new Error(`No generated image was found in Codex task ${threadId}.`);
  const bytes = Buffer.from(latestBase64, "base64");
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length <= signature.length || !bytes.subarray(0, signature.length).equals(signature)) throw new Error("Recovered image data is not a valid PNG.");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, bytes);
}

async function exportImage(threadId, outPath) {
  const recovery = path.join(process.env.USERPROFILE || "", ".codex", "skills", "codex-image-recovery", "scripts", "export-codex-generated-image.ps1");
  if (process.platform === "win32" && fs.existsSync(recovery)) {
    await new Promise((resolve, reject) => {
      const child = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", recovery, "-ThreadId", threadId, "-Destination", outPath, "-Force"], { shell: false, windowsHide: true });
      let errorText = "";
      child.stderr.on("data", (chunk) => { errorText += chunk; });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(errorText || "Could not recover the generated image.")));
    });
    return;
  }
  await exportImageFromLogs(threadId, outPath);
}

async function generateImage({ cwd, request, libraryDir, onStatus }) {
  const safeId = `${Date.now()}-${String(request.name || request.kind || "asset").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  const rawPath = path.join(libraryDir, `${safeId}-raw.png`);
  const assetPath = path.join(libraryDir, `${safeId}.png`);
  fs.mkdirSync(libraryDir, { recursive: true });
  const dimensions = request.kind === "background" ? "portrait 9:16 composition" : "isolated full-body composition on a transparent background";
  const imagePrompt = [
    "Use the built-in image generation capability now.",
    "Generate exactly one image for this request.",
    "Do not call external APIs and do not ask for an API key.",
    "Save the generated image in the Codex thread; the caller will recover it from the thread log.",
    "Do not include text, captions, logos, borders, UI, or watermarks.",
    `Create a ${dimensions}. Colorful, high saturation, razor-sharp detail, bright controlled glow, dynamic modern anime aesthetic.`,
    "Black cosmic atmosphere with luminous white, gold, purple, lavender, and blue accents where appropriate.",
    "",
    request.prompt,
  ].join("\n");
  const result = await runCodexTurn({
    cwd,
    prompt: imagePrompt,
    baseInstructions: "You are a local image-generation bridge. Use only Codex Desktop built-in image generation. Never request API credentials.",
    onStatus,
  });
  onStatus?.("recovering-image");
  await exportImage(result.threadId, rawPath);
  onStatus?.("normalizing-image");
  if (request.kind === "background") {
    await sharp(rawPath).rotate().resize(1080, 1920, { fit: "cover", position: "attention" }).png({ compressionLevel: 9 }).toFile(assetPath);
  } else {
    await sharp(rawPath).rotate().resize(1024, 1024, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toFile(assetPath);
  }
  const asset = { id: safeId, name: request.name || "Generated asset", kind: request.kind, prompt: request.prompt, path: assetPath, sourceThreadId: result.threadId, createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(libraryDir, `${safeId}.json`), JSON.stringify(asset, null, 2));
  onStatus?.("complete");
  return asset;
}

module.exports = { generateStory, generateImage, exportImageFromLogs };
