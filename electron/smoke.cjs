const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const destination = process.argv[2] || path.join(app.getPath("temp"), "astral-director-smoke.png");

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1536,
    height: 960,
    show: false,
    backgroundColor: "#05030a",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  await new Promise((resolve) => setTimeout(resolve, 1800));
  const image = await window.webContents.capturePage();
  fs.writeFileSync(destination, image.toPNG());
  process.stdout.write(`${destination}\n`);
  app.quit();
});
