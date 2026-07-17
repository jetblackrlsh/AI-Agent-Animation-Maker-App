import { useEffect, useMemo, useRef, useState } from "react";
import {
  Aperture, Box, Captions, ChevronDown, CircleStop, Download, Film, FolderPlus,
  CloudDownload, Image, Library, LoaderCircle, Music2, Pause, Play, Plus, Save, Sparkles, Stars, WandSparkles,
} from "lucide-react";
import { AnimationStage, type StageHandle } from "./stage/AnimationStage";
import { demoProject } from "./demo";
import type { AnimationProject, AppInfo, AssetKind, AudioResult, LibraryAsset, StoryScene, UpdateStatus } from "./types";

const STATUS_LABELS: Record<string, string> = {
  "starting-codex-app-server": "Opening Codex",
  "creating-thread": "Starting a private task",
  "generating-in-codex-desktop": "Codex is creating",
  "recovering-image": "Recovering generated art",
  "normalizing-image": "Preparing reusable art",
  "synthesizing-narration": "Recording narration",
  "composing-midi": "Composing MIDI soundtrack",
  "audio-ready": "Soundtrack ready",
  "encoding-mp4": "Encoding MP4",
  "export-complete": "MP4 export complete",
  "complete": "Art added to the library",
};

function normalizeProject(raw: Partial<AnimationProject>, prompt: string): AnimationProject {
  const sourceScenes = Array.isArray(raw.scenes) ? raw.scenes : [];
  return {
    id: `project-${Date.now()}`,
    title: String(raw.title || "Untitled astral story"),
    logline: String(raw.logline || "A clear story made for a portrait screen."),
    prompt,
    updatedAt: new Date().toISOString(),
    assets: [],
    sourceThreadId: raw.sourceThreadId,
    scenes: sourceScenes.map((source, index) => {
      const scene = source as Partial<StoryScene>;
      return {
        id: `scene-${index + 1}-${Date.now()}`,
        title: String(scene.title || `Scene ${index + 1}`),
        duration: Math.max(3, Number(scene.duration || 6)),
        narration: String(scene.narration || scene.caption || ""),
        caption: String(scene.caption || scene.narration || ""),
        backgroundPrompt: String(scene.backgroundPrompt || "cosmic star field, portrait composition, no text"),
        characters: Array.isArray(scene.characters) ? scene.characters : [],
        objects: Array.isArray(scene.objects) ? scene.objects : [],
        musicMood: String(scene.musicMood || "clear cinematic cosmic journey"),
        sfx: Array.isArray(scene.sfx) ? scene.sfx : [],
      };
    }),
  };
}

function formatTime(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function huntsvilleParts(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).formatToParts(value);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function formatHuntsvilleClock(value: Date) {
  const parts = huntsvilleParts(value);
  return `${parts.hour}:${parts.minute} ${parts.dayPeriod} ${parts.month}/${parts.day}/${parts.year}`;
}

function formatReleaseDate(value: string) {
  const parts = huntsvilleParts(new Date(value));
  return `${parts.month}/${parts.day}/${parts.year} ${parts.hour}:${parts.minute} ${parts.dayPeriod}`;
}

function downloadBytes(bytes: Uint8Array, filename: string, mime: string) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export default function App() {
  const [project, setProject] = useState<AnimationProject>(demoProject);
  const [selectedScene, setSelectedScene] = useState(0);
  const [prompt, setPrompt] = useState(demoProject.prompt);
  const [duration, setDuration] = useState(30);
  const [sceneCount, setSceneCount] = useState(4);
  const [tone, setTone] = useState("uplifting cosmic adventure");
  const [rightTab, setRightTab] = useState<"scene" | "assets">("scene");
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [status, setStatus] = useState("Ready for direction");
  const [busy, setBusy] = useState<"story" | "art" | "audio" | "export" | null>(null);
  const [assetKind, setAssetKind] = useState<AssetKind>("background");
  const [assetName, setAssetName] = useState("Celestial overlook");
  const [assetPrompt, setAssetPrompt] = useState("A sweeping starry overlook above Saturn with a calm area for characters");
  const [library, setLibrary] = useState<LibraryAsset[]>([]);
  const [audio, setAudio] = useState<(AudioResult & { musicUrl: string; narrationUrl: string; sfxUrl: string }) | null>(null);
  const [clock, setClock] = useState(() => formatHuntsvilleClock(new Date()));
  const [appInfo, setAppInfo] = useState<AppInfo>({ version: "1.0.0", releaseDate: "2026-07-17T15:02:37-05:00", repository: "https://github.com/jetblackrlsh/AI-Agent-Animation-Maker-App", packaged: false });
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: "idle", message: "Check for updates" });
  const stageRef = useRef<StageHandle>(null);
  const audioPlayers = useRef<HTMLAudioElement[]>([]);

  const total = useMemo(() => project.scenes.reduce((sum, scene) => sum + scene.duration, 0), [project.scenes]);
  const sceneOffsets = useMemo(() => {
    const offsets: number[] = [];
    project.scenes.reduce((sum, scene) => { offsets.push(sum); return sum + scene.duration; }, 0);
    return offsets;
  }, [project.scenes]);
  const activeScene = project.scenes[selectedScene] || project.scenes[0];

  useEffect(() => {
    if (!window.astral) return;
    Promise.all([window.astral.loadProject(), window.astral.listAssets(), window.astral.getAppInfo()]).then(([saved, assets, info]) => {
      if (saved?.scenes?.length) { setProject(saved); setPrompt(saved.prompt || ""); }
      setLibrary(assets);
      setAppInfo(info);
    }).catch(() => setStatus("Loaded the starter project"));
    const stopGenerationListener = window.astral.onGenerationStatus((next) => setStatus(STATUS_LABELS[next] || next.replaceAll("-", " ")));
    const stopUpdateListener = window.astral.onUpdateStatus((next) => { setUpdateStatus(next); setStatus(next.message); });
    return () => { stopGenerationListener(); stopUpdateListener(); };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(formatHuntsvilleClock(new Date())), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!window.astral) return;
    const timer = setTimeout(() => window.astral.saveProject({ ...project, updatedAt: new Date().toISOString() }).catch(() => undefined), 700);
    return () => clearTimeout(timer);
  }, [project]);

  useEffect(() => () => {
    if (audio) [audio.musicUrl, audio.narrationUrl, audio.sfxUrl].forEach(URL.revokeObjectURL);
  }, [audio]);

  const updateScene = (patch: Partial<StoryScene>) => {
    setProject((current) => ({ ...current, scenes: current.scenes.map((scene, index) => index === selectedScene ? { ...scene, ...patch } : scene), updatedAt: new Date().toISOString() }));
    setAudio(null);
  };

  const seek = (time: number) => {
    setCurrentTime(time);
    const found = sceneOffsets.findIndex((offset, index) => time >= offset && time < offset + project.scenes[index].duration);
    if (found >= 0) setSelectedScene(found);
    audioPlayers.current.forEach((player) => { try { player.currentTime = time; } catch { /* media may not be ready */ } });
  };

  const createStory = async () => {
    if (!prompt.trim() || busy) return;
    setBusy("story");
    setIsPlaying(false);
    setStatus("Turning your direction into a clear scene plan");
    try {
      const raw = await window.astral.generateStory({ prompt: prompt.trim(), duration, sceneCount, tone });
      const next = normalizeProject(raw, prompt.trim());
      setProject(next);
      setSelectedScene(0);
      setCurrentTime(0);
      setAudio(null);
      setStatus("Story plan ready — review it or generate the art");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Codex could not create the story plan.");
    } finally { setBusy(null); }
  };

  const addGeneratedAsset = async (kind: AssetKind, name: string, imagePrompt: string) => {
    const asset = await window.astral.generateImage({ kind, name, prompt: imagePrompt });
    setLibrary((items) => [asset, ...items.filter((item) => item.id !== asset.id)]);
    return asset;
  };

  const generateOneAsset = async () => {
    if (!assetPrompt.trim() || busy) return;
    setBusy("art");
    try {
      const asset = await addGeneratedAsset(assetKind, assetName || `New ${assetKind}`, assetPrompt);
      useAssetInScene(asset);
      setRightTab("assets");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The image could not be generated.");
    } finally { setBusy(null); }
  };

  const generateAllArt = async () => {
    if (busy) return;
    setBusy("art");
    setStatus("Building a reusable art set, one image at a time");
    try {
      let next: AnimationProject = structuredClone(project);
      const known = new Map<string, LibraryAsset>();
      [...library, ...next.assets].forEach((asset) => known.set(`${asset.kind}:${asset.name.toLowerCase()}`, asset));
      for (let sceneIndex = 0; sceneIndex < next.scenes.length; sceneIndex++) {
        const scene = next.scenes[sceneIndex];
        if (!scene.backgroundAssetId) {
          const key = `background:${scene.title.toLowerCase()}`;
          const asset = known.get(key) || await addGeneratedAsset("background", scene.title, scene.backgroundPrompt);
          known.set(key, asset); scene.backgroundAssetId = asset.id;
          if (!next.assets.some((item) => item.id === asset.id)) next.assets.push(asset);
          setProject(structuredClone(next));
        }
        for (const entry of [...scene.characters.map((element) => ({ element, kind: "character" as const })), ...scene.objects.map((element) => ({ element, kind: "object" as const }))]) {
          if (entry.element.assetId) continue;
          const key = `${entry.kind}:${entry.element.name.toLowerCase()}`;
          const asset = known.get(key) || await addGeneratedAsset(entry.kind, entry.element.name, entry.element.imagePrompt);
          known.set(key, asset); entry.element.assetId = asset.id;
          if (!next.assets.some((item) => item.id === asset.id)) next.assets.push(asset);
          setProject(structuredClone(next));
        }
      }
      setStatus("Every scene now has reusable generated art");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Art generation stopped before the set was complete.");
    } finally { setBusy(null); }
  };

  const useAssetInScene = (asset: LibraryAsset) => {
    setProject((current) => {
      const scenes = current.scenes.map((scene, index) => {
        if (index !== selectedScene) return scene;
        if (asset.kind === "background") return { ...scene, backgroundAssetId: asset.id };
        const target = asset.kind === "character" ? "characters" : "objects";
        const elements = [...scene[target]];
        const matching = elements.findIndex((element) => element.name.toLowerCase() === asset.name.toLowerCase());
        if (matching >= 0) elements[matching] = { ...elements[matching], assetId: asset.id };
        else elements.push({ name: asset.name, imagePrompt: asset.prompt, x: asset.kind === "character" ? -0.1 : 0.25, y: asset.kind === "character" ? -0.25 : 0.05, scale: asset.kind === "character" ? 0.72 : 0.28, action: "float", assetId: asset.id });
        return { ...scene, [target]: elements };
      });
      return { ...current, scenes, assets: current.assets.some((item) => item.id === asset.id) ? current.assets : [...current.assets, asset] };
    });
    setStatus(`${asset.name} placed in scene ${selectedScene + 1}`);
  };

  const importAsset = async () => {
    const asset = await window.astral.importAsset();
    if (asset) { setLibrary((items) => [asset, ...items]); useAssetInScene(asset); }
  };

  const installAudio = (result: AudioResult) => {
    if (audio) [audio.musicUrl, audio.narrationUrl, audio.sfxUrl].forEach(URL.revokeObjectURL);
    const makeUrl = (bytes: Uint8Array) => {
      const copy = new Uint8Array(bytes.byteLength); copy.set(bytes);
      return URL.createObjectURL(new Blob([copy.buffer], { type: "audio/wav" }));
    };
    const next = { ...result, musicUrl: makeUrl(result.musicBytes), narrationUrl: makeUrl(result.narrationBytes), sfxUrl: makeUrl(result.sfxBytes) };
    setAudio(next);
    audioPlayers.current = [new Audio(next.musicUrl), new Audio(next.narrationUrl), new Audio(next.sfxUrl)];
    audioPlayers.current[0].volume = 0.22;
    audioPlayers.current[1].volume = 1;
    audioPlayers.current[2].volume = 0.6;
    return next;
  };

  const buildSoundtrack = async () => {
    if (busy) return null;
    setBusy("audio");
    setIsPlaying(false);
    try {
      const result = await window.astral.prepareAudio(project);
      setProject((current) => ({ ...current, scenes: current.scenes.map((scene, index) => ({ ...scene, duration: result.sceneDurations[index] || scene.duration })) }));
      const next = installAudio(result);
      setStatus("Narration and MIDI soundtrack are synchronized");
      return next;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The soundtrack could not be built.");
      return null;
    } finally { setBusy(null); }
  };

  const togglePlayback = () => {
    if (!audio) { void buildSoundtrack(); return; }
    if (isPlaying) {
      audioPlayers.current.forEach((player) => player.pause());
      setIsPlaying(false);
    } else {
      audioPlayers.current.forEach((player) => { player.currentTime = currentTime; void player.play().catch(() => undefined); });
      setIsPlaying(true);
    }
  };

  const exportMp4 = async () => {
    if (busy) return;
    let readyAudio = audio;
    if (!readyAudio) readyAudio = await buildSoundtrack();
    if (!readyAudio) return;
    setBusy("export");
    setIsPlaying(false);
    audioPlayers.current.forEach((player) => player.pause());
    setStatus(`Recording ${formatTime(total)} of portrait animation in real time`);
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const videoBytes = await stageRef.current!.record();
      const result = await window.astral.exportVideo({ videoBytes, audioKey: readyAudio.key, title: project.title });
      setStatus(result.canceled ? "Export canceled" : `MP4 saved to ${result.path}`);
      setCurrentTime(0);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The MP4 could not be exported.");
    } finally { setBusy(null); }
  };

  const handleUpdate = async () => {
    if (updateStatus.state === "ready") {
      await window.astral.installUpdate();
      return;
    }
    setUpdateStatus({ state: "checking", message: "Checking GitHub…" });
    try { await window.astral.checkForUpdates(); }
    catch (error) { setUpdateStatus({ state: "error", message: error instanceof Error ? error.message : "Update check failed" }); }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup"><span className="brand-mark"><Aperture size={18} /></span><div><strong>ASTRAL DIRECTOR</strong><small>CODEX ANIMATION STUDIO</small></div></div>
        <div className="project-heading"><span>PROJECT</span><strong>{project.title}</strong><span className="saved-indicator"><i /> LOCAL</span></div>
        <div className="top-actions">
          <div className="release-meta"><strong>v{appInfo.version}</strong><span>UPDATED {formatReleaseDate(appInfo.releaseDate)} CT</span></div>
          <div className="huntsville-clock"><span>HUNTSVILLE, AL</span><strong>{clock}</strong></div>
          <button className={`update-button ${updateStatus.state}`} onClick={handleUpdate} disabled={["checking", "available", "downloading"].includes(updateStatus.state)} title={updateStatus.message}><CloudDownload size={16} /><span>{updateStatus.message}</span></button>
          <button className="icon-button" title="Save project" onClick={() => window.astral.saveProject(project).then(() => setStatus("Project saved locally"))}><Save size={17} /></button>
          <button className="secondary-button" onClick={buildSoundtrack} disabled={!!busy}><Music2 size={16} /> {audio ? "Rebuild audio" : "Build audio"}</button>
          <button className="primary-button" onClick={exportMp4} disabled={!!busy}><Download size={16} /> Export MP4</button>
        </div>
      </header>

      <main className="workspace">
        <aside className="direction-panel">
          <div className="panel-kicker"><Stars size={14} /> STORY DIRECTION</div>
          <h1>Direct a clear<br /><em>portrait story.</em></h1>
          <label className="field prompt-field"><span>What happens?</span><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={8} /></label>
          <div className="compact-fields">
            <label className="field"><span>Length</span><div className="select-wrap"><select value={duration} onChange={(event) => setDuration(Number(event.target.value))}><option value={20}>20 sec</option><option value={30}>30 sec</option><option value={45}>45 sec</option><option value={60}>60 sec</option></select><ChevronDown size={14} /></div></label>
            <label className="field"><span>Scenes</span><div className="select-wrap"><select value={sceneCount} onChange={(event) => setSceneCount(Number(event.target.value))}><option value={3}>3 scenes</option><option value={4}>4 scenes</option><option value={5}>5 scenes</option><option value={6}>6 scenes</option></select><ChevronDown size={14} /></div></label>
          </div>
          <label className="field"><span>Tone</span><input value={tone} onChange={(event) => setTone(event.target.value)} /></label>
          <button className="generate-button" onClick={createStory} disabled={!!busy || !prompt.trim()}>{busy === "story" ? <LoaderCircle className="spin" size={18} /> : <WandSparkles size={18} />} Create scene plan</button>
          <div className="clarity-note"><span>CLARITY CHECK</span><p>{project.logline}</p></div>
          <div className="pipeline-status"><i className={busy ? "active" : ""} /><div><span>{busy ? "CODEX IS WORKING" : "STUDIO STATUS"}</span><p>{status}</p></div></div>
        </aside>

        <section className="stage-workspace">
          <div className="stage-toolbar"><div><span className="eyebrow">PORTRAIT PREVIEW · 9:16</span><strong>{activeScene?.title}</strong></div><div className="preview-badges"><span>THREE.JS</span><span>1080 × 1920</span></div></div>
          <div className="stage-chamber">
            <div className="orbit orbit-one" /><div className="orbit orbit-two" />
            <div className="stage-glow" />
            <div className="canvas-shell"><AnimationStage ref={stageRef} project={project} currentTime={currentTime} isPlaying={isPlaying} onTimeUpdate={setCurrentTime} onPlaybackEnd={() => { setIsPlaying(false); audioPlayers.current.forEach((player) => { player.pause(); player.currentTime = 0; }); }} /></div>
          </div>
          <div className="transport">
            <button className="play-button" onClick={togglePlayback} disabled={busy === "export"}>{isPlaying ? <Pause fill="currentColor" size={18} /> : <Play fill="currentColor" size={18} />}</button>
            <span className="timecode">{formatTime(currentTime)}</span>
            <input className="scrubber" type="range" min={0} max={Math.max(total, 0.1)} step={0.01} value={Math.min(currentTime, total)} onChange={(event) => seek(Number(event.target.value))} style={{ "--progress": `${(currentTime / Math.max(total, 0.01)) * 100}%` } as React.CSSProperties} />
            <span className="timecode muted">{formatTime(total)}</span>
            <button className="caption-toggle"><Captions size={17} /> Captions on</button>
          </div>
        </section>

        <aside className="inspector-panel">
          <div className="inspector-tabs"><button className={rightTab === "scene" ? "active" : ""} onClick={() => setRightTab("scene")}>SCENE</button><button className={rightTab === "assets" ? "active" : ""} onClick={() => setRightTab("assets")}>ASSET LIBRARY <span>{library.length}</span></button></div>
          {rightTab === "scene" ? (
            <div className="inspector-scroll">
              <div className="scene-index"><span>{String(selectedScene + 1).padStart(2, "0")}</span><div><small>SELECTED SCENE</small><strong>{activeScene.title}</strong></div></div>
              <label className="field"><span>Scene title</span><input value={activeScene.title} onChange={(event) => updateScene({ title: event.target.value })} /></label>
              <label className="field"><span>Narration & captions</span><textarea rows={6} value={activeScene.narration} onChange={(event) => updateScene({ narration: event.target.value, caption: event.target.value })} /></label>
              <label className="field"><span>Scene duration</span><div className="duration-input"><input type="range" min={3} max={18} step={0.5} value={activeScene.duration} onChange={(event) => updateScene({ duration: Number(event.target.value) })} /><strong>{activeScene.duration.toFixed(1)}s</strong></div></label>
              <div className="element-list"><div className="section-label"><span>ON STAGE</span><small>{activeScene.characters.length + activeScene.objects.length} layers</small></div>
                {[...activeScene.characters.map((element) => ({ ...element, type: "character" })), ...activeScene.objects.map((element) => ({ ...element, type: "object" }))].map((element, index) => <div className="element-row" key={`${element.name}-${index}`}><span className="element-icon">{element.type === "character" ? <Aperture size={15} /> : <Box size={15} />}</span><div><strong>{element.name}</strong><small>{element.action}</small></div><i className={element.assetId ? "linked" : ""} /></div>)}
              </div>
              <button className="outline-button gold" onClick={generateAllArt} disabled={!!busy}>{busy === "art" ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />} Generate all scene art</button>
            </div>
          ) : (
            <div className="inspector-scroll asset-pane">
              <div className="section-label"><span>CREATE REUSABLE ART</span><small>Built in Codex</small></div>
              <div className="kind-switch">{(["background", "character", "object"] as AssetKind[]).map((kind) => <button key={kind} className={assetKind === kind ? "active" : ""} onClick={() => setAssetKind(kind)}>{kind === "background" ? <Image size={14} /> : kind === "character" ? <Aperture size={14} /> : <Box size={14} />}{kind}</button>)}</div>
              <label className="field"><span>Asset name</span><input value={assetName} onChange={(event) => setAssetName(event.target.value)} /></label>
              <label className="field"><span>Visual direction</span><textarea rows={5} value={assetPrompt} onChange={(event) => setAssetPrompt(event.target.value)} /></label>
              <button className="outline-button gold" onClick={generateOneAsset} disabled={!!busy || !assetPrompt.trim()}>{busy === "art" ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />} Generate in Codex</button>
              <button className="outline-button" onClick={importAsset}><FolderPlus size={16} /> Import image</button>
              <div className="section-label library-label"><span>LIBRARY</span><small>Click to place</small></div>
              <div className="asset-grid">{library.map((asset) => <button key={asset.id} className="asset-tile" onClick={() => useAssetInScene(asset)} title={`Place ${asset.name} in this scene`}><img src={asset.dataUrl} alt="" /><span>{asset.name}</span><small>{asset.kind}</small></button>)}{!library.length && <div className="empty-library"><Library size={24} /><p>Generated and imported art will stay here for future projects.</p></div>}</div>
            </div>
          )}
        </aside>
      </main>

      <footer className="timeline-panel">
        <div className="timeline-heading"><div><Film size={15} /><strong>SCENE TIMELINE</strong><span>{project.scenes.length} scenes · {formatTime(total)}</span></div><div className="audio-actions">{audio && <><button onClick={() => downloadBytes(audio.musicMidiBytes, `${project.title}-music.mid`, "audio/midi")}><Music2 size={14} /> Music MIDI</button><button onClick={() => downloadBytes(audio.sfxMidiBytes, `${project.title}-sfx.mid`, "audio/midi")}><CircleStop size={14} /> SFX MIDI</button></>}</div></div>
        <div className="timeline-track">
          <div className="playhead" style={{ left: `${(currentTime / Math.max(total, 0.01)) * 100}%` }}><i /></div>
          {project.scenes.map((scene, index) => <button key={scene.id} className={`scene-block ${selectedScene === index ? "selected" : ""}`} style={{ flex: scene.duration }} onClick={() => { setSelectedScene(index); seek(sceneOffsets[index]); }}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{scene.title}</strong><small>{scene.duration.toFixed(1)}s · {scene.characters.length + scene.objects.length} layers</small></div></button>)}
          <button className="add-scene" onClick={() => setProject((current) => ({ ...current, scenes: [...current.scenes, { ...structuredClone(current.scenes[current.scenes.length - 1]), id: `scene-${Date.now()}`, title: "New scene" }] }))}><Plus size={18} /></button>
        </div>
      </footer>
    </div>
  );
}
