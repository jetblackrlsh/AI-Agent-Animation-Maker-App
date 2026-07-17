export type AssetKind = "background" | "character" | "object";
export type MotionAction = "float" | "enter-left" | "enter-right" | "pulse" | "shake" | "squash" | "stretch" | "rotate" | "glow";

export interface LibraryAsset {
  id: string;
  name: string;
  kind: AssetKind;
  prompt: string;
  path?: string;
  dataUrl: string;
  sourceThreadId?: string;
  createdAt: string;
}

export interface SceneElement {
  name: string;
  imagePrompt: string;
  x: number;
  y: number;
  scale: number;
  action: MotionAction;
  assetId?: string;
}

export interface SoundEffect {
  at: number;
  note: number;
  kind: "sparkle" | "impact" | "whoosh";
}

export interface StoryScene {
  id: string;
  title: string;
  duration: number;
  narration: string;
  caption: string;
  backgroundPrompt: string;
  backgroundAssetId?: string;
  characters: SceneElement[];
  objects: SceneElement[];
  musicMood: string;
  sfx: SoundEffect[];
}

export interface AnimationProject {
  id: string;
  title: string;
  logline: string;
  prompt: string;
  updatedAt: string;
  scenes: StoryScene[];
  assets: LibraryAsset[];
  sourceThreadId?: string;
}

export interface AudioResult {
  key: string;
  sceneDurations: number[];
  totalDuration: number;
  narrationBytes: Uint8Array;
  musicBytes: Uint8Array;
  sfxBytes: Uint8Array;
  musicMidiBytes: Uint8Array;
  sfxMidiBytes: Uint8Array;
}

export interface StoryRequest {
  prompt: string;
  duration: number;
  sceneCount: number;
  tone: string;
}

export interface AppInfo {
  version: string;
  releaseDate: string;
  repository: string;
  packaged: boolean;
}

export interface UpdateStatus {
  state: "idle" | "checking" | "available" | "downloading" | "current" | "ready" | "error" | "development";
  message: string;
  version?: string;
  percent?: number;
}

declare global {
  interface Window {
    astral: {
      loadProject(): Promise<AnimationProject | null>;
      saveProject(project: AnimationProject): Promise<{ savedAt: string }>;
      generateStory(request: StoryRequest): Promise<Partial<AnimationProject>>;
      generateImage(request: { name: string; kind: AssetKind; prompt: string }): Promise<LibraryAsset>;
      listAssets(): Promise<LibraryAsset[]>;
      importAsset(): Promise<LibraryAsset | null>;
      prepareAudio(project: AnimationProject): Promise<AudioResult>;
      exportVideo(payload: { videoBytes: Uint8Array; audioKey: string; title: string }): Promise<{ canceled: boolean; path?: string }>;
      getAppInfo(): Promise<AppInfo>;
      checkForUpdates(): Promise<UpdateStatus>;
      installUpdate(): Promise<{ installed: boolean }>;
      onGenerationStatus(listener: (status: string) => void): () => void;
      onUpdateStatus(listener: (status: UpdateStatus) => void): () => void;
    };
  }
}
