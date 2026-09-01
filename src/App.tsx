import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AIAssistant } from './components/AIAssistant';
import { AssetLibrary } from './components/AssetLibrary';
import { PanelSplitter } from './components/PanelSplitter';
import { Preview } from './components/Preview';
import type { PreviewAsset } from './components/AssetPreview';
import { Timeline } from './components/Timeline';
import { applyCommand, conversationModels, createEmptyState, generationModels, redo, undo, type EditorCommand, type EditorState, type TrackKind } from './domain/editor';
import { clampWorkspaceLayout, loadWorkspaceLayout, saveWorkspaceLayout, type WorkspaceLayoutState } from './layout/workspaceLayout';
import { useCompanionMediaLibrary } from './media/useCompanionMediaLibrary';
import type { CompanionMediaLibraryOptions } from './media/useCompanionMediaLibrary';
import { getProgramDuration, resolveProgramFrame } from './program/resolveProgramFrame';
import { useProgramClock } from './program/useProgramClock';
import { companionApi } from './api/companion';
import { streamAssistantResponse } from './conversation/stream';
import { SettingsSheet } from './components/SettingsSheet';
import './styles.css';

interface AppProps {
  mediaLibraryOptions?: CompanionMediaLibraryOptions;
  initialState?: EditorState;
}

type PreviewSource = { mode: 'timeline' } | { mode: 'asset'; assetId: string };

export default function App({ mediaLibraryOptions, initialState }: AppProps = {}) {
  const [state, setState] = useState<EditorState>(() => initialState ?? createEmptyState());
  const [layout, setLayout] = useState<WorkspaceLayoutState>(() => loadWorkspaceLayout());
  const [selectedLocalMediaId, setSelectedLocalMediaId] = useState<string | null>(null);
  const [previewSource, setPreviewSource] = useState<PreviewSource>({ mode: 'timeline' });
  const [conversationReferenceIds, setConversationReferenceIds] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [insertionNotice, setInsertionNotice] = useState<string | null>(null);
  const mediaLibrary = useCompanionMediaLibrary(mediaLibraryOptions);
  const companionAssetIdsRef = useRef(new Set<string>());
  const programDuration = useMemo(() => getProgramDuration(state), [state]);
  const playback = useProgramClock(programDuration);
  const programFrame = useMemo(() => resolveProgramFrame(state, playback.state.currentTime), [state, playback.state.currentTime]);
  const canUndo = state.past.length > 0;
  const canRedo = state.future.length > 0;

  useEffect(() => {
    if (selectedLocalMediaId && !mediaLibrary.items.some((item) => item.id === selectedLocalMediaId)) setSelectedLocalMediaId(null);
  }, [selectedLocalMediaId, mediaLibrary.items]);
  useEffect(() => {
    const previousCompanionIds = companionAssetIdsRef.current;
    const currentCompanionIds = new Set(mediaLibrary.items.map((item) => item.id));
    companionAssetIdsRef.current = new Set([...previousCompanionIds, ...currentCompanionIds]);
    setState((current) => {
      const additions = Object.fromEntries(mediaLibrary.items.map((item) => [item.id, {
        id: item.id,
        name: item.name,
        kind: item.kind,
        src: item.contentUrl,
        sourceDuration: item.kind === 'image' ? null : item.duration ?? null,
        availability: 'online' as const,
      }]));
      const referencedAssetIds = new Set([
        ...Object.values(current.clips).map((clip) => clip.assetId),
      ]);
      const assets = { ...current.assets, ...additions };
      for (const id of previousCompanionIds) {
        if (!currentCompanionIds.has(id) && !referencedAssetIds.has(id)) delete assets[id];
      }
      const currentIds = Object.keys(current.assets);
      const nextIds = Object.keys(assets);
      const changed = currentIds.length !== nextIds.length
        || nextIds.some((id) => (
          current.assets[id]?.src !== assets[id].src
          || current.assets[id]?.sourceDuration !== assets[id].sourceDuration
        ));
      return changed ? { ...current, assets } : current;
    });
  }, [mediaLibrary.items, state.clips]);
  useEffect(() => {
    const availableIds = new Set([
      ...Object.keys(state.assets),
      ...mediaLibrary.items.map((item) => item.id),
    ]);
    setConversationReferenceIds((current) => {
      const next = current.filter((id) => availableIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [mediaLibrary.items, state.assets]);
  useEffect(() => {
    const resize = () => setLayout((current) => clampWorkspaceLayout(current, { width: window.innerWidth, height: window.innerHeight }));
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const commitLayout = (next: WorkspaceLayoutState) => {
    const clamped = clampWorkspaceLayout(next, { width: window.innerWidth, height: window.innerHeight });
    setLayout(clamped);
    saveWorkspaceLayout(clamped);
  };
  const updateLayout = (key: keyof WorkspaceLayoutState, value: number) => setLayout((current) => ({ ...current, [key]: value }));
  const commitDimension = (key: keyof WorkspaceLayoutState, value: number) => commitLayout({ ...layout, [key]: value });

  const commands = useMemo(() => {
    const insertAsset = (command: Extract<EditorCommand, { type: 'insert-asset-at-playhead' }>) => {
      const item = mediaLibrary.items.find((candidate) => candidate.id === command.assetId);
      if (item && item.kind !== 'image' && item.durationStatus !== 'ready') {
        setInsertionNotice(item.durationStatus === 'pending'
          ? `“${item.name}”的时长仍在读取，已按 5 秒添加，可在时间线中调整。`
          : `无法读取“${item.name}”的原始时长，已按 5 秒添加，可在时间线中调整。`);
      } else {
        setInsertionNotice(null);
      }
      setState((current) => applyCommand(current, command));
    };
    return {
      selectAsset: (assetId: string) => {
        setSelectedLocalMediaId(null);
        if (state.assets[assetId]?.kind !== 'audio') setPreviewSource({ mode: 'asset', assetId });
        setState((current) => applyCommand(current, { type: 'select-asset', assetId }));
      },
      selectClip: (clipId: string) => setState((current) => applyCommand(current, { type: 'select-clip', clipId })),
      setConversationModel: (modelId: string) => setState((current) => applyCommand(current, { type: 'set-conversation-model', modelId })),
      setGenerationModel: (modelId: string) => setState((current) => applyCommand(current, { type: 'set-generation-model', modelId })),
      addTrack: (kind: TrackKind) => setState((current) => applyCommand(current, { type: 'add-track', kind })),
      deleteTrack: (trackId: string, confirmed: boolean) => setState((current) => applyCommand(current, { type: 'delete-track', trackId, confirmed })),
      editTimeline: (command: import('./timeline/commands').TimelineCommand) => setState((current) => applyCommand(current, { type: 'timeline', command })),
      insertAsset,
      addToConversation: (assetId: string) => setConversationReferenceIds((current) => current.includes(assetId) ? current : [...current, assetId]),
      removeFromConversation: (assetId: string) => setConversationReferenceIds((current) => current.filter((id) => id !== assetId)),
      addToTimeline: (assetId: string) => insertAsset({ type: 'insert-asset-at-playhead', assetId, playheadTime: playback.state.currentTime }),
      applyAssistantEdit: async (submission: import('./components/AIAssistant').AssistantSubmission) => {
      if (!submission.conversationId) throw new Error('本地对话尚未准备好');
      const referencedMedia = submission.referenceAssetIds.flatMap((id) => {
        const local = mediaLibrary.items.find((item) => item.id === id);
        if (local) return [{ name: local.name, kind: local.kind, contentUrl: local.contentUrl }];
        const projectAsset = state.assets[id];
        return projectAsset?.src
          ? [{ name: projectAsset.name, kind: projectAsset.kind, contentUrl: projectAsset.src }]
          : [];
      });
      const encodedMedia = referencedMedia.length ? await Promise.all(referencedMedia.map(async (item) => {
        const response = await fetch(item.contentUrl);
        if (!response.ok) throw new Error(`无法读取附件“${item.name}”`);
        const blob = await response.blob();
        const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
        return { kind: item.kind, value: { base64_content: base64, format: item.name.split('.').pop()?.toLowerCase() || 'bin', name: item.name } };
      })) : undefined;
      const images = encodedMedia?.filter((item) => item.kind === 'image').map((item) => item.value);
      const audios = encodedMedia?.filter((item) => item.kind === 'audio').map((item) => item.value);
      const videos = encodedMedia?.filter((item) => item.kind === 'video').map((item) => item.value);
      const response = await companionApi.sendMessage({
        conversationId: submission.conversationId,
        text: submission.prompt,
        ...(images?.length ? { images } : {}),
        ...(audios?.length ? { audios } : {}),
        ...(videos?.length ? { videos } : {}),
      });
      return streamAssistantResponse(response);
      },
    };
  }, [mediaLibrary.items, playback.state.currentTime, state.assets]);

  const libraryAssets = useMemo(() => Object.fromEntries(
    Object.entries(state.assets).filter(([id]) => !companionAssetIdsRef.current.has(id)),
  ), [state.assets, mediaLibrary.items]);
  const conversationReferences = useMemo(() => conversationReferenceIds.flatMap((assetId) => {
    const currentItem = mediaLibrary.items.find((item) => item.id === assetId);
    if (currentItem) return [{ id: currentItem.id, name: currentItem.name, kind: currentItem.kind, sourceUrl: currentItem.contentUrl }];
    const retainedAsset = state.assets[assetId];
    return retainedAsset ? [{ id: retainedAsset.id, name: retainedAsset.name, kind: retainedAsset.kind, sourceUrl: retainedAsset.src }] : [];
  }), [conversationReferenceIds, mediaLibrary.items, state.assets]);
  const previewAsset = useMemo<PreviewAsset | null>(() => {
    if (previewSource.mode !== 'asset') return null;
    const local = mediaLibrary.items.find((item) => item.id === previewSource.assetId);
    if (local && local.kind !== 'audio') return { id: local.id, name: local.name, kind: local.kind, src: local.contentUrl, duration: local.duration };
    const projectAsset = state.assets[previewSource.assetId];
    if (projectAsset && projectAsset.kind !== 'audio') return { id: projectAsset.id, name: projectAsset.name, kind: projectAsset.kind, src: projectAsset.src, duration: projectAsset.sourceDuration ?? undefined };
    return null;
  }, [mediaLibrary.items, previewSource, state.assets]);
  useEffect(() => {
    if (previewSource.mode === 'asset' && !previewAsset) setPreviewSource({ mode: 'timeline' });
  }, [previewAsset, previewSource.mode]);

  const style = {
    '--asset-width': `${layout.assetWidth}px`,
    '--ai-width': `${layout.assistantWidth}px`,
    '--timeline-height': `${layout.timelineHeight}px`,
  } as CSSProperties;
  const maxTimeline = Math.max(200, Math.floor(window.innerHeight * 0.55));
  const assetMax = Math.max(180, Math.min(420, window.innerWidth - 360 - layout.assistantWidth));
  const assistantMax = Math.max(280, Math.min(560, window.innerWidth - 360 - layout.assetWidth));

  return (
    <div className="app-frame">
      <main className="workspace" style={style}>
        <AssetLibrary assets={libraryAssets} selectedAssetId={state.selectedAssetId} onSelectAsset={commands.selectAsset} localItems={mediaLibrary.items} directoryStatus={mediaLibrary.status} directoryError={mediaLibrary.directoryError} actionError={mediaLibrary.actionError} insertionNotice={insertionNotice} onChooseDirectory={() => void mediaLibrary.chooseDirectory()} onRestoreDirectory={() => void mediaLibrary.refresh()} selectedLocalMediaId={selectedLocalMediaId} onSelectLocalMedia={(item) => { setSelectedLocalMediaId(item.id); if (item.kind !== 'audio') setPreviewSource({ mode: 'asset', assetId: item.id }); }} onAddToConversation={commands.addToConversation} onAddToTimeline={commands.addToTimeline} onReveal={mediaLibrary.reveal} onClearActionError={mediaLibrary.clearActionError} />
        <div className="splitter-slot splitter-assets"><PanelSplitter orientation="vertical" value={layout.assetWidth} min={180} max={assetMax} aria-label="调整素材库宽度" onChange={(value) => updateLayout('assetWidth', value)} onCommit={(value) => commitDimension('assetWidth', value)} /></div>
        <Preview asset={previewAsset} program={programFrame} playback={playback.state} onTogglePlayback={playback.toggle} onSeek={playback.scrub} onStepFrame={playback.stepFrame} canUndo={canUndo} canRedo={canRedo} onUndo={() => setState(undo)} onRedo={() => setState(redo)} />
        <div className="splitter-slot splitter-assistant"><PanelSplitter orientation="vertical" invert value={layout.assistantWidth} min={280} max={assistantMax} aria-label="调整创作助手宽度" onChange={(value) => updateLayout('assistantWidth', value)} onCommit={(value) => commitDimension('assistantWidth', value)} /></div>
        <AIAssistant conversationModels={conversationModels} generationModels={generationModels} conversationModelId={state.conversationModelId} generationModelId={state.generationModelId} onConversationModelChange={commands.setConversationModel} onGenerationModelChange={commands.setGenerationModel} references={conversationReferences} onRemoveReference={commands.removeFromConversation} onOpenSettings={() => setSettingsOpen(true)} onSubmit={commands.applyAssistantEdit} />
        <div className="splitter-slot splitter-timeline"><PanelSplitter orientation="horizontal" invert value={layout.timelineHeight} min={200} max={maxTimeline} aria-label="调整时间线高度" onChange={(value) => updateLayout('timelineHeight', value)} onCommit={(value) => commitDimension('timelineHeight', value)} /></div>
        <Timeline state={state} onSelectClip={commands.selectClip} onAddTrack={commands.addTrack} onDeleteTrack={commands.deleteTrack} onEdit={commands.editTimeline} onInsertAsset={commands.insertAsset} currentTime={playback.state.currentTime} duration={playback.state.duration} onSeek={(time) => { setPreviewSource({ mode: 'timeline' }); playback.scrub(time); }} onActivate={() => setPreviewSource({ mode: 'timeline' })} />
      </main>
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
