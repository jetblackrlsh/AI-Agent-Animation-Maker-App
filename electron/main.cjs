const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { generateStory, generateImage } = require("./codex-service.cjs");
const { prepareAudio, exportVideo } = require("./audio-service.cjs");

let mainWindow;
const preparedAudio = new Map();
let updateState = { state: "idle", message: "Check for updates" };

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function publishUpdateState(next) {
  updateState = { ...updateState, ...next };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("updater:status", updateState);
}

autoUpdater.on("checking-for-update", () => publishUpdateState({ state: "checking", message: "Checking GitHub…" }));
autoUpdater.on("update-available", (info) => publishUpdateState({ state: "available", message: `Downloading v${info.version}…`, version: info.version }));
autoUpdater.on("update-not-available", () => publishUpdateState({ state: "current", message: "You’re up to date" }));
autoUpdater.on("download-progress", (progress) => publishUpdateState({ state: "downloading", message: `Downloading ${Math.round(progress.percent)}%`, percent: progress.percent }));
autoUpdater.on("update-downloaded", (info) => publishUpdateState({ state: "ready", message: `Restart to install v${info.version}`, version: info.version }));
autoUpdater.on("error", (error) => publishUpdateState({ state: "error", message: error?.message || "Update check failed" }));

function paths() {
  const root = app.getPath("userData");
  return {
    root,
    project: path.join(root, "current-project.json"),
    library: path.join(root, "asset-library"),
    audio: path.join(root, "audio"),
    exports: path.join(root, "exports"),
  };
}

function ensureAppFolders() {
  const folders = paths();
  [folders.root, folders.library, folders.audio, folders.exports].forEach((folder) => fs.mkdirSync(folder, { recursive: true }));
}

function status(value) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("generation:status", value);
}

function assertProject(project) {
  if (!project || typeof project !== "object" || !Array.isArray(project.scenes)) throw new Error("Invalid project data.");
  if (project.scenes.length < 1 || project.scenes.length > 24) throw new Error("A project must have between 1 and 24 scenes.");
  const bytes = Buffer.byteLength(JSON.stringify(project));
  if (bytes > 2_000_000) throw new Error("This project is too large to save.");
}

function dataUrl(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const type = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "image/png";
  return `data:${type};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

function listAssets() {
  const library = paths().library;
  if (!fs.existsSync(library)) return [];
  return fs.readdirSync(library)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      try {
        const asset = JSON.parse(fs.readFileSync(path.join(library, file), "utf8"));
        return fs.existsSync(asset.path) ? { ...asset, dataUrl: dataUrl(asset.path) } : null;
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function safeProjectKey(project) {
  return String(project.id || "current").replace(/[^a-z0-9_-]/gi, "-").slice(0, 80);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1536,
    height: 960,
    minWidth: 1180,
    minHeight: 740,
    backgroundColor: "#05030a",
    show: false,
    autoHideMenuBar: true,
    title: "Astral Director",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = process.env.VITE_DEV_SERVER_URL || `file://${path.join(__dirname, "..", "dist", "index.html")}`;
    if (!url.startsWith(allowed)) event.preventDefault();
  });
  if (process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  else mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

app.whenReady().then(() => {
  ensureAppFolders();
  createWindow();

  ipcMain.handle("project:load", () => {
    const file = paths().project;
    if (!fs.existsSync(file)) return null;
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
  });
  ipcMain.handle("app:info", () => ({
    version: app.getVersion(),
    releaseDate: require(path.join(__dirname, "..", "package.json")).releaseDate,
    repository: "https://github.com/jetblackrlsh/AI-Agent-Animation-Maker-App",
    packaged: app.isPackaged,
  }));
  ipcMain.handle("updater:check", async () => {
    if (!app.isPackaged) {
      publishUpdateState({ state: "development", message: "Updates work in the installed app" });
      return updateState;
    }
    await autoUpdater.checkForUpdates();
    return updateState;
  });
  ipcMain.handle("updater:install", () => {
    if (updateState.state !== "ready") return { installed: false };
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return { installed: true };
  });
  ipcMain.handle("project:save", (_event, project) => {
    assertProject(project);
    fs.writeFileSync(paths().project, JSON.stringify(project, null, 2));
    return { savedAt: new Date().toISOString() };
  });
  ipcMain.handle("codex:story", async (_event, request) => {
    if (!request?.prompt || String(request.prompt).length > 12_000) throw new Error("Enter a story request under 12,000 characters.");
    return generateStory({ cwd: paths().root, request, onStatus: status });
  });
  ipcMain.handle("image:generate", async (_event, request) => {
    if (!request?.prompt || String(request.prompt).length > 4_000) throw new Error("Enter an image request under 4,000 characters.");
    if (!new Set(["background", "character", "object"]).has(request.kind)) throw new Error("Choose a valid asset type.");
    const asset = await generateImage({ cwd: paths().root, request, libraryDir: paths().library, onStatus: status });
    return { ...asset, dataUrl: dataUrl(asset.path) };
  });
  ipcMain.handle("asset:list", () => listAssets());
  ipcMain.handle("asset:import", async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: "Import reusable art", properties: ["openFile"], filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const source = result.filePaths[0];
    const id = `${Date.now()}-imported`;
    const destination = path.join(paths().library, `${id}.png`);
    await sharp(source).rotate().resize(1080, 1920, { fit: "inside", withoutEnlargement: true }).png().toFile(destination);
    const asset = { id, name: path.basename(source, path.extname(source)), kind: "object", prompt: "Imported by the user", path: destination, createdAt: new Date().toISOString() };
    fs.writeFileSync(path.join(paths().library, `${id}.json`), JSON.stringify(asset, null, 2));
    return { ...asset, dataUrl: dataUrl(destination) };
  });
  ipcMain.handle("audio:prepare", async (_event, project) => {
    assertProject(project);
    const key = safeProjectKey(project);
    const outputDir = path.join(paths().audio, key);
    const result = await prepareAudio({ project, outputDir, synthScript: path.join(__dirname, "scripts", "synthesize.ps1"), onStatus: status });
    preparedAudio.set(key, result);
    return {
      key,
      sceneDurations: result.sceneDurations,
      totalDuration: result.totalDuration,
      narrationBytes: new Uint8Array(fs.readFileSync(result.narrationPath)),
      musicBytes: new Uint8Array(fs.readFileSync(result.musicPath)),
      sfxBytes: new Uint8Array(fs.readFileSync(result.sfxPath)),
      musicMidiBytes: new Uint8Array(fs.readFileSync(result.musicMidiPath)),
      sfxMidiBytes: new Uint8Array(fs.readFileSync(result.sfxMidiPath)),
    };
  });
  ipcMain.handle("video:export", async (_event, payload) => {
    if (!payload?.videoBytes || payload.videoBytes.byteLength > 1_200_000_000) throw new Error("The recorded video is missing or too large.");
    const audio = preparedAudio.get(String(payload.audioKey));
    if (!audio) throw new Error("Build the soundtrack before exporting.");
    const name = String(payload.title || "astral-story").replace(/[^a-z0-9 _-]/gi, "").trim() || "astral-story";
    const dialogResult = await dialog.showSaveDialog(mainWindow, { title: "Export MP4", defaultPath: path.join(app.getPath("videos"), `${name}.mp4`), filters: [{ name: "MP4 Video", extensions: ["mp4"] }] });
    if (dialogResult.canceled || !dialogResult.filePath) return { canceled: true };
    const tempVideo = path.join(paths().exports, `${Date.now()}-capture.webm`);
    fs.writeFileSync(tempVideo, Buffer.from(payload.videoBytes));
    status("encoding-mp4");
    await exportVideo({ videoPath: tempVideo, audio, destination: dialogResult.filePath });
    fs.unlinkSync(tempVideo);
    status("export-complete");
    return { canceled: false, path: dialogResult.filePath };
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
