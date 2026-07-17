import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import type { AnimationProject, MotionAction, SceneElement, StoryScene } from "../types";

export interface StageHandle {
  record(): Promise<Uint8Array>;
}

interface Props {
  project: AnimationProject;
  currentTime: number;
  isPlaying: boolean;
  onTimeUpdate(time: number): void;
  onPlaybackEnd(): void;
}

const WIDTH = 540;
const HEIGHT = 960;

function sceneAt(project: AnimationProject, time: number) {
  let offset = 0;
  for (let i = 0; i < project.scenes.length; i++) {
    const duration = project.scenes[i].duration;
    if (time < offset + duration || i === project.scenes.length - 1) {
      return { index: i, scene: project.scenes[i], local: Math.max(0, time - offset), progress: Math.min(1, Math.max(0, (time - offset) / duration)) };
    }
    offset += duration;
  }
  return { index: 0, scene: project.scenes[0], local: 0, progress: 0 };
}

function totalDuration(project: AnimationProject) {
  return project.scenes.reduce((sum, scene) => sum + scene.duration, 0);
}

function makeBackgroundTexture(scene: StoryScene, index: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 540;
  canvas.height = 960;
  const context = canvas.getContext("2d")!;
  const gradient = context.createLinearGradient(0, 0, 540, 960);
  const palettes = [
    ["#100626", "#261054", "#071736"],
    ["#050817", "#29205f", "#532178"],
    ["#09030f", "#3a113e", "#101e50"],
    ["#13052b", "#242169", "#06152c"],
  ];
  const palette = palettes[index % palettes.length];
  gradient.addColorStop(0, palette[0]);
  gradient.addColorStop(0.55, palette[1]);
  gradient.addColorStop(1, palette[2]);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 540, 960);
  for (let i = 0; i < 180; i++) {
    const x = (Math.sin(i * 92.17 + index) * 0.5 + 0.5) * 540;
    const y = (Math.sin(i * 47.61 + index * 3) * 0.5 + 0.5) * 960;
    const radius = i % 17 === 0 ? 2.2 : i % 5 === 0 ? 1.25 : 0.65;
    context.beginPath();
    context.fillStyle = i % 9 === 0 ? "#f8d980" : i % 7 === 0 ? "#cbbcff" : "#ffffff";
    context.shadowColor = context.fillStyle;
    context.shadowBlur = radius * 5;
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 0.42;
  context.strokeStyle = "#ad8dff";
  context.lineWidth = 3;
  context.beginPath();
  context.ellipse(350, 260 + index * 24, 270, 75, -0.35, 0, Math.PI * 2);
  context.stroke();
  context.globalAlpha = 1;
  context.shadowBlur = 0;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeElementTexture(element: SceneElement, kind: "character" | "object") {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d")!;
  const hue = Math.abs(element.name.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0)) % 80 + 235;
  const glow = `hsl(${hue} 92% 76%)`;
  context.translate(256, 256);
  context.shadowColor = glow;
  context.shadowBlur = 36;
  if (kind === "character") {
    const body = context.createLinearGradient(-120, -150, 130, 190);
    body.addColorStop(0, "#ffffff");
    body.addColorStop(0.48, "#d8c8ff");
    body.addColorStop(1, "#8b64ef");
    context.fillStyle = body;
    context.beginPath();
    context.ellipse(0, -92, 72, 85, 0, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.moveTo(-96, -12);
    context.quadraticCurveTo(0, -80, 102, -8);
    context.lineTo(142, 190);
    context.quadraticCurveTo(0, 235, -142, 190);
    context.closePath();
    context.fill();
    context.fillStyle = "#17102f";
    context.shadowBlur = 0;
    context.beginPath(); context.ellipse(-28, -98, 9, 15, 0, 0, Math.PI * 2); context.fill();
    context.beginPath(); context.ellipse(28, -98, 9, 15, 0, 0, Math.PI * 2); context.fill();
    context.strokeStyle = "#d7a93d";
    context.lineWidth = 10;
    context.beginPath(); context.moveTo(-96, 40); context.lineTo(98, 40); context.stroke();
  } else {
    context.fillStyle = "#f6d26c";
    context.beginPath();
    for (let i = 0; i < 10; i++) {
      const angle = -Math.PI / 2 + i * Math.PI / 5;
      const radius = i % 2 === 0 ? 145 : 62;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.closePath();
    context.fill();
    context.strokeStyle = "#fff7d6";
    context.lineWidth = 8;
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function easeOut(value: number) {
  const t = Math.min(1, Math.max(0, value));
  return 1 - Math.pow(1 - t, 3);
}

function applyMotion(group: THREE.Group, action: MotionAction, progress: number, elapsed: number) {
  const { x, y, scale } = group.userData as { x: number; y: number; scale: number };
  group.position.set(x, y, 0);
  group.rotation.z = 0;
  group.scale.setScalar(scale);
  const wave = Math.sin(elapsed * Math.PI * 2);
  if (action === "float") group.position.y = y + Math.sin(elapsed * 1.7) * 0.025;
  if (action === "enter-left") group.position.x = -1 + (x + 1) * easeOut(progress * 3.2);
  if (action === "enter-right") group.position.x = 1 + (x - 1) * easeOut(progress * 3.2);
  if (action === "pulse" || action === "glow") group.scale.setScalar(scale * (1 + Math.sin(elapsed * 3.4) * 0.07));
  if (action === "shake" && progress > 0.16 && progress < 0.7) group.position.x += Math.sin(elapsed * 38) * 0.016;
  if (action === "rotate") group.rotation.z = Math.sin(elapsed * 1.5) * 0.22;
  if (action === "squash") group.scale.set(scale * (1 + wave * 0.1), scale * (1 - wave * 0.1), scale);
  if (action === "stretch") group.scale.set(scale * (1 - wave * 0.08), scale * (1 + wave * 0.13), scale);
}

function splitLines(context: CanvasRenderingContext2D, words: string[], maxWidth: number) {
  const lines: { word: string; index: number }[][] = [];
  let line: { word: string; index: number }[] = [];
  let width = 0;
  words.forEach((word, index) => {
    const wordWidth = context.measureText(`${word} `).width;
    if (line.length && width + wordWidth > maxWidth) { lines.push(line); line = []; width = 0; }
    line.push({ word, index });
    width += wordWidth;
  });
  if (line.length) lines.push(line);
  return lines;
}

export const AnimationStage = forwardRef<StageHandle, Props>(function AnimationStage({ project, currentTime, isPlaying, onTimeUpdate, onPlaybackEnd }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const webglCanvasRef = useRef<HTMLCanvasElement>();
  const rendererRef = useRef<THREE.WebGLRenderer>();
  const threeSceneRef = useRef<THREE.Scene>();
  const cameraRef = useRef<THREE.OrthographicCamera>();
  const currentSceneIndex = useRef(-1);
  const groupsRef = useRef<THREE.Group[]>([]);
  const projectRef = useRef(project);
  const timeRef = useRef(currentTime);
  const recordingRef = useRef(false);

  projectRef.current = project;
  timeRef.current = currentTime;

  const rebuildScene = (sceneIndex: number) => {
    const threeScene = threeSceneRef.current!;
    while (threeScene.children.length) {
      const child = threeScene.children.pop()!;
      child.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const material = mesh.material as THREE.Material | undefined;
        if (material) {
          const map = (material as THREE.MeshBasicMaterial).map;
          map?.dispose();
          material.dispose();
        }
      });
    }
    groupsRef.current = [];
    const storyScene = projectRef.current.scenes[sceneIndex];
    const assets = projectRef.current.assets || [];
    const backgroundAsset = assets.find((asset) => asset.id === storyScene.backgroundAssetId);
    const backgroundMaterial = new THREE.MeshBasicMaterial({ map: makeBackgroundTexture(storyScene, sceneIndex) });
    const background = new THREE.Mesh(new THREE.PlaneGeometry(1.125, 2), backgroundMaterial);
    background.position.z = -1;
    threeScene.add(background);
    if (backgroundAsset?.dataUrl) {
      new THREE.TextureLoader().load(backgroundAsset.dataUrl, (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        backgroundMaterial.map?.dispose();
        backgroundMaterial.map = texture;
        backgroundMaterial.needsUpdate = true;
      });
    }

    const addElement = (element: SceneElement, kind: "character" | "object", index: number) => {
      const asset = assets.find((item) => item.id === element.assetId);
      const material = new THREE.MeshBasicMaterial({ map: makeElementTexture(element, kind), transparent: true, depthTest: false });
      const geometry = new THREE.PlaneGeometry(kind === "character" ? 0.76 : 0.62, kind === "character" ? 0.76 : 0.62);
      const mesh = new THREE.Mesh(geometry, material);
      const group = new THREE.Group();
      group.add(mesh);
      group.position.z = 0.05 + index * 0.01;
      group.userData = { x: Number(element.x || 0), y: Number(element.y || 0), scale: Number(element.scale || 0.5), action: element.action };
      threeScene.add(group);
      groupsRef.current.push(group);
      if (asset?.dataUrl) {
        new THREE.TextureLoader().load(asset.dataUrl, (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          material.map?.dispose();
          material.map = texture;
          material.needsUpdate = true;
        });
      }
    };
    storyScene.characters.forEach((element, index) => addElement(element, "character", index));
    storyScene.objects.forEach((element, index) => addElement(element, "object", index + storyScene.characters.length));
    currentSceneIndex.current = sceneIndex;
  };

  const renderAt = (time: number) => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    const threeScene = threeSceneRef.current;
    const camera = cameraRef.current;
    if (!canvas || !renderer || !threeScene || !camera || !projectRef.current.scenes.length) return;
    const active = sceneAt(projectRef.current, time);
    if (active.index !== currentSceneIndex.current) rebuildScene(active.index);
    groupsRef.current.forEach((group) => applyMotion(group, group.userData.action, active.progress, active.local));
    const background = threeScene.children[0];
    background.scale.setScalar(1.02 + active.progress * 0.035);
    renderer.render(threeScene, camera);

    const context = canvas.getContext("2d")!;
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.drawImage(webglCanvasRef.current!, 0, 0, WIDTH, HEIGHT);
    const vignette = context.createRadialGradient(WIDTH / 2, HEIGHT * 0.45, 120, WIDTH / 2, HEIGHT * 0.45, 570);
    vignette.addColorStop(0, "rgba(2,1,8,0)");
    vignette.addColorStop(1, "rgba(2,1,8,.72)");
    context.fillStyle = vignette;
    context.fillRect(0, 0, WIDTH, HEIGHT);

    context.textAlign = "left";
    context.font = "600 18px Arial";
    context.shadowColor = "rgba(255,255,255,.8)";
    context.shadowBlur = 10;
    context.fillStyle = "rgba(255,255,255,.92)";
    context.fillText(projectRef.current.title.toUpperCase(), 34, 48);
    context.shadowBlur = 0;
    context.fillStyle = "rgba(246,210,108,.9)";
    context.font = "600 14px Arial";
    context.fillText(`${String(active.index + 1).padStart(2, "0")}  /  ${String(projectRef.current.scenes.length).padStart(2, "0")}`, 34, 76);

    const words = active.scene.caption.trim().split(/\s+/).filter(Boolean);
    const activeWord = Math.min(words.length - 1, Math.floor(active.progress * words.length));
    context.font = "700 25px Arial";
    const lines = splitLines(context, words, WIDTH - 88);
    const activeLine = Math.max(0, lines.findIndex((line) => line.some((word) => word.index === activeWord)));
    const startLine = Math.max(0, Math.min(lines.length - 3, activeLine - 1));
    const visibleLines = lines.slice(startLine, startLine + 3);
    const boxHeight = 82 + visibleLines.length * 36;
    const boxY = HEIGHT - boxHeight - 30;
    context.fillStyle = "rgba(4,2,12,.78)";
    context.strokeStyle = "rgba(218,183,255,.35)";
    context.lineWidth = 1;
    context.beginPath();
    context.roundRect(24, boxY, WIDTH - 48, boxHeight, 18);
    context.fill();
    context.stroke();
    context.fillStyle = "#f6d26c";
    context.font = "700 13px Arial";
    context.fillText(active.scene.title.toUpperCase(), 44, boxY + 30);
    context.font = "700 25px Arial";
    visibleLines.forEach((line, lineIndex) => {
      const totalWidth = line.reduce((sum, item) => sum + context.measureText(`${item.word} `).width, 0);
      let x = (WIDTH - totalWidth) / 2;
      const y = boxY + 68 + lineIndex * 36;
      line.forEach((item) => {
        context.fillStyle = item.index <= activeWord ? "#ffffff" : "rgba(224,214,246,.42)";
        if (item.index === activeWord) { context.shadowColor = "#c7a7ff"; context.shadowBlur = 10; }
        context.fillText(`${item.word} `, x, y);
        context.shadowBlur = 0;
        x += context.measureText(`${item.word} `).width;
      });
    });
    context.fillStyle = "rgba(255,255,255,.16)";
    context.fillRect(44, boxY + boxHeight - 18, WIDTH - 88, 2);
    context.fillStyle = "#f6d26c";
    context.fillRect(44, boxY + boxHeight - 18, (WIDTH - 88) * active.progress, 2);
  };

  useEffect(() => {
    const offscreen = document.createElement("canvas");
    offscreen.width = WIDTH;
    offscreen.height = HEIGHT;
    webglCanvasRef.current = offscreen;
    const renderer = new THREE.WebGLRenderer({ canvas: offscreen, alpha: false, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(WIDTH, HEIGHT, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    rendererRef.current = renderer;
    threeSceneRef.current = new THREE.Scene();
    cameraRef.current = new THREE.OrthographicCamera(-0.5625, 0.5625, 1, -1, 0.01, 10);
    cameraRef.current.position.z = 4;
    renderAt(0);
    return () => renderer.dispose();
  }, []);

  const visualSignature = `${project.scenes.map((scene) => `${scene.id}:${scene.backgroundAssetId || ""}:${scene.characters.map((x) => x.assetId || "").join(",")}:${scene.objects.map((x) => x.assetId || "").join(",")}`).join("|")}:${project.assets.length}`;
  useEffect(() => {
    currentSceneIndex.current = -1;
    renderAt(timeRef.current);
  }, [visualSignature]);

  useEffect(() => {
    if (!isPlaying || recordingRef.current) { renderAt(currentTime); return; }
    const startAt = timeRef.current;
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const next = startAt + (now - started) / 1000;
      const duration = totalDuration(projectRef.current);
      if (next >= duration) {
        renderAt(duration - 0.001);
        onTimeUpdate(0);
        onPlaybackEnd();
        return;
      }
      timeRef.current = next;
      renderAt(next);
      onTimeUpdate(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying]);

  useImperativeHandle(ref, () => ({
    record: () => new Promise((resolve, reject) => {
      const canvas = canvasRef.current;
      if (!canvas) { reject(new Error("Preview canvas is not ready.")); return; }
      recordingRef.current = true;
      const stream = canvas.captureStream(30);
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 10_000_000 });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { recordingRef.current = false; reject(new Error("The video recorder failed.")); };
      recorder.onstop = async () => {
        recordingRef.current = false;
        renderAt(0);
        const bytes = new Uint8Array(await new Blob(chunks, { type: mimeType }).arrayBuffer());
        resolve(bytes);
      };
      recorder.start(1000);
      const started = performance.now();
      const duration = totalDuration(projectRef.current);
      const tick = (now: number) => {
        const elapsed = Math.min(duration, (now - started) / 1000);
        renderAt(elapsed);
        onTimeUpdate(elapsed);
        if (elapsed >= duration) { recorder.stop(); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }),
  }));

  return <canvas ref={canvasRef} className="animation-canvas" width={WIDTH} height={HEIGHT} aria-label="Portrait animation preview" />;
});
