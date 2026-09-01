export interface WorkspaceLayoutState {
  assetWidth: number;
  assistantWidth: number;
  timelineHeight: number;
}

export interface WorkspaceViewport {
  width: number;
  height: number;
}

export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayoutState = {
  assetWidth: 260,
  assistantWidth: 320,
  timelineHeight: 300,
};

export const WORKSPACE_LAYOUT_STORAGE_KEY = 'lumina.workspace-layout';

const ASSET_MIN = 180;
const ASSET_MAX = 420;
const ASSISTANT_MIN = 280;
const ASSISTANT_MAX = 560;
const PREVIEW_MIN = 360;
const TIMELINE_MIN = 200;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function validLayout(value: unknown): value is WorkspaceLayoutState {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<WorkspaceLayoutState>;
  return [candidate.assetWidth, candidate.assistantWidth, candidate.timelineHeight]
    .every((dimension) => typeof dimension === 'number' && Number.isFinite(dimension));
}

function currentViewport(): WorkspaceViewport {
  if (typeof window === 'undefined') return { width: 1_440, height: 900 };
  return { width: window.innerWidth, height: window.innerHeight };
}

export function clampWorkspaceLayout(
  state: WorkspaceLayoutState,
  viewport: WorkspaceViewport,
): WorkspaceLayoutState {
  const sidePanelBudget = Math.max(0, viewport.width - PREVIEW_MIN);
  const assetMaximum = Math.min(ASSET_MAX, sidePanelBudget - ASSISTANT_MIN);
  const assetWidth = assetMaximum >= ASSET_MIN
    ? clamp(state.assetWidth, ASSET_MIN, assetMaximum)
    : Math.max(0, assetMaximum);
  const assistantMaximum = Math.min(ASSISTANT_MAX, sidePanelBudget - assetWidth);
  const assistantWidth = assistantMaximum >= ASSISTANT_MIN
    ? clamp(state.assistantWidth, ASSISTANT_MIN, assistantMaximum)
    : Math.max(0, assistantMaximum);
  const maxTimeline = Math.floor((viewport.height - 48) * 0.55);

  return {
    assetWidth,
    assistantWidth,
    timelineHeight: maxTimeline >= TIMELINE_MIN
      ? clamp(state.timelineHeight, TIMELINE_MIN, maxTimeline)
      : Math.max(0, maxTimeline),
  };
}

export function loadWorkspaceLayout(): WorkspaceLayoutState {
  if (typeof window === 'undefined') return DEFAULT_WORKSPACE_LAYOUT;

  try {
    const raw = window.localStorage.getItem(WORKSPACE_LAYOUT_STORAGE_KEY);
    if (!raw) return clampWorkspaceLayout(DEFAULT_WORKSPACE_LAYOUT, currentViewport());

    const stored = JSON.parse(raw) as unknown;
    return validLayout(stored)
      ? clampWorkspaceLayout(stored, currentViewport())
      : clampWorkspaceLayout(DEFAULT_WORKSPACE_LAYOUT, currentViewport());
  } catch {
    return clampWorkspaceLayout(DEFAULT_WORKSPACE_LAYOUT, currentViewport());
  }
}

export function saveWorkspaceLayout(state: WorkspaceLayoutState) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(WORKSPACE_LAYOUT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Layout preferences are optional; private browsing or quota errors should not break resizing.
  }
}
