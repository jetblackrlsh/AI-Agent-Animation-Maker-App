const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("astral", {
  loadProject: (projectId) => ipcRenderer.invoke("project:load", projectId),
  saveProject: (project) => ipcRenderer.invoke("project:save", project),
  listProjects: () => ipcRenderer.invoke("project:list"),
  deleteProject: (projectId) => ipcRenderer.invoke("project:delete", projectId),
  generateStory: (request) => ipcRenderer.invoke("codex:story", request),
  generateImage: (request) => ipcRenderer.invoke("image:generate", request),
  listAssets: () => ipcRenderer.invoke("asset:list"),
  importAsset: () => ipcRenderer.invoke("asset:import"),
  prepareAudio: (project) => ipcRenderer.invoke("audio:prepare", project),
  exportVideo: (payload) => ipcRenderer.invoke("video:export", payload),
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  checkForUpdates: () => ipcRenderer.invoke("updater:check"),
  installUpdate: () => ipcRenderer.invoke("updater:install"),
  onGenerationStatus: (listener) => {
    const wrapped = (_event, status) => listener(status);
    ipcRenderer.on("generation:status", wrapped);
    return () => ipcRenderer.removeListener("generation:status", wrapped);
  },
  onUpdateStatus: (listener) => {
    const wrapped = (_event, update) => listener(update);
    ipcRenderer.on("updater:status", wrapped);
    return () => ipcRenderer.removeListener("updater:status", wrapped);
  },
});
