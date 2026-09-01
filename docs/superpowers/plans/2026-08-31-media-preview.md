# Media Preview and Image Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AI-generated images responsive and inspectable, preview image/video library assets independently, and restore timeline preview whenever the timeline becomes active.

**Architecture:** `App` owns a transient discriminated-union preview source and resolves library selections into a media descriptor. `Preview` delegates asset images to a reusable zoom/pan surface and asset videos to an isolated transport, while the existing timeline program path remains unchanged. A shared modal image viewer gives linked AI images and stored image attachments identical detail behavior.

**Tech Stack:** React 19, TypeScript, CSS, Testing Library, Vitest, native HTML media elements and Pointer Events.

**Spec:** `docs/superpowers/specs/2026-08-31-media-preview-design.md`

## Global Constraints

- A single click previews image/video assets; audio selection does not replace the central preview.
- Asset preview never mutates the timeline playhead or editor undo history.
- Timeline pointer or keyboard focus restores timeline preview without resetting playhead time.
- Image zoom supports wheel, minus, fit, plus, and pointer-drag pan.
- Video asset preview has independent playback and seeking.
- Generated and stored conversation images share one accessible detail viewer.
- No new runtime dependency is introduced.

---

### Task 1: Shared Zoomable Image Surface

**Files:**
- Create: `src/components/ZoomableImage.tsx`
- Create: `src/components/ZoomableImage.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Produces: `ZoomableImage({ src, alt, className?, controlsLabel? })` with buttons named `缩小图片`, `适应窗口`, and `放大图片`.
- Produces: a focusable viewport that handles wheel zoom and pointer-captured pan.

- [ ] **Step 1: Write the failing zoom-control test**

```tsx
it('supports button, wheel, fit, and pointer pan controls', async () => {
  render(<ZoomableImage src="/image.png" alt="素材图片" />);
  const image = screen.getByRole('img', { name: '素材图片' });
  fireEvent.click(screen.getByRole('button', { name: '放大图片' }));
  expect(image).toHaveStyle({ transform: 'translate3d(0px, 0px, 0) scale(1.25)' });
  fireEvent.wheel(screen.getByRole('region', { name: '素材图片查看区域' }), { deltaY: -100 });
  expect(image.getAttribute('style')).toContain('scale(1.5)');
  fireEvent.pointerDown(image, { pointerId: 1, clientX: 20, clientY: 20 });
  fireEvent.pointerMove(image, { pointerId: 1, clientX: 40, clientY: 35 });
  expect(image.getAttribute('style')).toContain('translate3d(20px, 15px, 0)');
  fireEvent.click(screen.getByRole('button', { name: '适应窗口' }));
  expect(image.getAttribute('style')).toContain('scale(1)');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm test src/components/ZoomableImage.test.tsx`

Expected: FAIL because `ZoomableImage` does not exist.

- [ ] **Step 3: Implement the minimal zoom/pan state machine**

```tsx
export function ZoomableImage({ src, alt, className = '', controlsLabel = '图片缩放控制' }: ZoomableImageProps) {
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const drag = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number } | null>(null);
  const zoom = (delta: number) => setView((current) => ({
    ...current,
    scale: Math.min(4, Math.max(1, Math.round((current.scale + delta) * 100) / 100)),
    ...(current.scale + delta <= 1 ? { x: 0, y: 0 } : {}),
  }));
  return <div className={`zoomable-image ${className}`}>
    <div role="region" aria-label={`${alt}查看区域`} className="zoomable-image-viewport" onWheel={(event) => { event.preventDefault(); zoom(event.deltaY < 0 ? .25 : -.25); }}>
      <img src={src} alt={alt} draggable={false} style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})` }} />
    </div>
    <div className="zoomable-image-controls" aria-label={controlsLabel}>
      <button type="button" aria-label="缩小图片" onClick={() => zoom(-.25)}>−</button>
      <button type="button" aria-label="适应窗口" onClick={() => setView({ scale: 1, x: 0, y: 0 })}>适应</button>
      <button type="button" aria-label="放大图片" onClick={() => zoom(.25)}>＋</button>
    </div>
  </div>;
}
```

Use these pointer handlers on the image:

```tsx
onPointerDown={(event) => {
  if (view.scale <= 1) return;
  event.currentTarget.setPointerCapture(event.pointerId);
  drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: view.x, originY: view.y };
}}
onPointerMove={(event) => {
  if (drag.current?.pointerId !== event.pointerId) return;
  setView((current) => ({ ...current, x: drag.current!.originX + event.clientX - drag.current!.x, y: drag.current!.originY + event.clientY - drag.current!.y }));
}}
onPointerUp={(event) => { if (drag.current?.pointerId === event.pointerId) drag.current = null; }}
onPointerCancel={() => { drag.current = null; }}
```

- [ ] **Step 4: Add bounded, interruptible styling**

Add `.zoomable-image`, `.zoomable-image-viewport`, and `.zoomable-image-controls` rules. The viewport must use `min-width:0`, `min-height:0`, `overflow:hidden`, and `touch-action:none`; the image uses `max-width:100%`, `max-height:100%`, `object-fit:contain`, and transform-origin center. Under `prefers-reduced-motion`, remove transform transitions.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `pnpm test src/components/ZoomableImage.test.tsx`

Expected: PASS.

---

### Task 2: Accessible Image Detail Viewer

**Files:**
- Create: `src/components/ImageDetailViewer.tsx`
- Create: `src/components/ImageDetailViewer.test.tsx`
- Modify: `src/components/MarkdownMessage.tsx`
- Modify: `src/components/AIAssistant.tsx`
- Modify: `src/components/MarkdownMessage.test.tsx`
- Modify: `src/components/AIAssistant.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `ZoomableImage` from Task 1.
- Produces: `ImageDetailViewer({ src, alt, filename, onClose })` rendered as a dialog named `图片详情：${alt}`.
- Produces: clickable linked images and stored image attachments that open the same viewer.

- [ ] **Step 1: Write failing viewer behavior tests**

```tsx
it('opens image details and closes with Escape', async () => {
  render(<MarkdownMessage content={'[生成图片](https://file.example/result.webp)'} />);
  fireEvent.click(screen.getByRole('button', { name: '查看图片详情：生成图片' }));
  expect(screen.getByRole('dialog', { name: '图片详情：生成图片' })).toBeVisible();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: '图片详情：生成图片' })).toBeNull();
});
```

Add a second test in `AIAssistant.test.tsx` that loads a conversation containing one image attachment, clicks `查看图片详情：fixture.png`, and expects the same dialog.

- [ ] **Step 2: Run viewer tests and verify RED**

Run: `pnpm test src/components/MarkdownMessage.test.tsx src/components/AIAssistant.test.tsx -t '图片详情|image details'`

Expected: FAIL because images are not interactive detail triggers.

- [ ] **Step 3: Implement the shared dialog**

```tsx
export function ImageDetailViewer({ src, alt, filename, onClose }: ImageDetailViewerProps) {
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [onClose]);
  return <div className="image-detail-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <dialog open className="image-detail-viewer" aria-label={`图片详情：${alt}`}>
      <header><strong>{alt}</strong><button type="button" aria-label="关闭图片详情" onClick={onClose}>×</button></header>
      <ZoomableImage key={src} src={src} alt={alt} />
      <footer><a href={src} download={filename} target="_blank" rel="noopener noreferrer">下载</a></footer>
    </dialog>
  </div>;
}
```

- [ ] **Step 4: Integrate both image sources**

In `LinkedMedia`, wrap the inline image in a button named `查看图片详情：${label}` and hold viewer-open state locally. In `AttachmentMedia`, do the same for `attachment.kind === 'image'`. Failed images remain non-clickable.

- [ ] **Step 5: Make inline media responsive**

Ensure `.message`, `.markdown-media`, `.markdown-media img`, `.markdown-media video`, `.message-attachment`, and their media descendants use `min-width:0` and `max-width:100%`. Use `height:auto` for images, a bounded `max-height`, and `object-fit:contain`. Add backdrop/dialog material styling and reduced-motion fallbacks.

- [ ] **Step 6: Run viewer tests and verify GREEN**

Run: `pnpm test src/components/MarkdownMessage.test.tsx src/components/AIAssistant.test.tsx`

Expected: PASS.

---

### Task 3: Independent Asset Preview UI

**Files:**
- Create: `src/components/AssetPreview.tsx`
- Create: `src/components/AssetPreview.test.tsx`
- Modify: `src/components/Preview.tsx`
- Modify: `src/components/Preview.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `ZoomableImage` from Task 1.
- Produces: `PreviewAsset = { id: string; name: string; kind: 'image' | 'video'; src: string; duration?: number }`.
- Changes: `Preview` accepts `asset?: PreviewAsset | null`; non-null asset selects asset mode.

- [ ] **Step 1: Write failing image/video preview tests**

```tsx
it('renders an image asset with zoom controls instead of timeline transport', () => {
  render(<Preview {...timelineProps} asset={{ id: 'i1', name: 'still.png', kind: 'image', src: '/still.png' }} />);
  expect(screen.getByRole('img', { name: 'still.png素材预览' })).toBeVisible();
  expect(screen.getByRole('button', { name: '放大图片' })).toBeVisible();
  expect(screen.getByText('素材预览')).toBeVisible();
});

it('seeks video assets independently', () => {
  render(<Preview {...timelineProps} asset={{ id: 'v1', name: 'clip.mp4', kind: 'video', src: '/clip.mp4' }} />);
  const video = screen.getByLabelText('clip.mp4素材视频') as HTMLVideoElement;
  fireEvent.loadedMetadata(video);
  fireEvent.change(screen.getByRole('slider', { name: '素材播放进度' }), { target: { value: '3' } });
  expect(video.currentTime).toBe(3);
  expect(timelineProps.onSeek).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run preview tests and verify RED**

Run: `pnpm test src/components/Preview.test.tsx src/components/AssetPreview.test.tsx`

Expected: FAIL because `Preview` has no asset mode.

- [ ] **Step 3: Implement `AssetPreview`**

For images, render `ZoomableImage` with `alt={`${asset.name}素材预览`}`. Use the following video state boundary:

```tsx
const videoRef = useRef<HTMLVideoElement>(null);
const [videoState, setVideoState] = useState({ currentTime: 0, duration: asset.duration ?? 0, playing: false });
useEffect(() => () => videoRef.current?.pause(), []);
return <>
  <video ref={videoRef} src={asset.src} aria-label={`${asset.name}素材视频`} onLoadedMetadata={(event) => setVideoState((current) => ({ ...current, duration: event.currentTarget.duration }))} onTimeUpdate={(event) => setVideoState((current) => ({ ...current, currentTime: event.currentTarget.currentTime }))} />
  <input aria-label="素材播放进度" type="range" min="0" max={videoState.duration} value={videoState.currentTime} onChange={(event) => { if (videoRef.current) videoRef.current.currentTime = Number(event.target.value); }} />
</>;
```

- [ ] **Step 4: Add the `Preview` mode branch**

```tsx
export interface PreviewAsset {
  id: string;
  name: string;
  kind: 'image' | 'video';
  src: string;
  duration?: number;
}

export function Preview({ asset, ...timelineProps }: PreviewProps) {
  if (asset) return <section className="preview" aria-label="预览器"><AssetPreview key={asset.id} asset={asset} /></section>;
  return <TimelineProgramPreview {...timelineProps} />;
}
```

Keep undo, redo, and export available in both modes; timeline transport is replaced only by asset-specific controls.

- [ ] **Step 5: Run preview tests and verify GREEN**

Run: `pnpm test src/components/Preview.test.tsx src/components/AssetPreview.test.tsx`

Expected: PASS.

---

### Task 4: App Preview State and Timeline Activation

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/components/Timeline.tsx`
- Modify: `src/components/Timeline.test.tsx`

**Interfaces:**
- Consumes: `PreviewAsset` from Task 3.
- Produces in `App`: `type PreviewSource = { mode: 'timeline' } | { mode: 'asset'; assetId: string }`.
- Changes: `TimelineProps` gains optional `onActivate?: () => void`.

- [ ] **Step 1: Replace the old selection invariant with failing mode-switch tests**

Replace `library selection does not change the timeline program preview` in `App.test.tsx` with:

```tsx
test('single-click previews an image or video asset without moving the timeline', async () => {
  render(<App initialState={createDemoState()} />);
  const timelineSeek = screen.getByRole('slider', { name: '时间线定位' });
  expect(timelineSeek).toHaveValue('0');
  await userEvent.click(screen.getByRole('gridcell', { name: /人物剪影/ }));
  expect(screen.getByRole('img', { name: '人物剪影素材预览' })).toBeVisible();
  expect(timelineSeek).toHaveValue('0');
});

test('timeline pointer or focus restores timeline preview', async () => {
  render(<App initialState={createDemoState()} />);
  await userEvent.click(screen.getByRole('gridcell', { name: /人物剪影/ }));
  fireEvent.pointerDown(screen.getByRole('region', { name: '时间线' }));
  expect(screen.getByLabelText('花园漫步视频画面')).toBeVisible();
  await userEvent.click(screen.getByRole('gridcell', { name: /人物剪影/ }));
  fireEvent.focus(screen.getByRole('slider', { name: '时间线播放头' }));
  expect(screen.getByLabelText('花园漫步视频画面')).toBeVisible();
});
```

- [ ] **Step 2: Run App tests and verify RED**

Run: `pnpm test src/App.test.tsx -t 'single-click previews|timeline pointer or focus'`

Expected: FAIL because asset selection still leaves timeline preview active.

- [ ] **Step 3: Implement preview source resolution in `App`**

Set asset mode inside both project and local selection callbacks only for `image`/`video`, then resolve it explicitly:

```tsx
const [previewSource, setPreviewSource] = useState<PreviewSource>({ mode: 'timeline' });
const previewAsset = useMemo<PreviewAsset | null>(() => {
  if (previewSource.mode !== 'asset') return null;
  const local = mediaLibrary.items.find((item) => item.id === previewSource.assetId);
  if (local && local.kind !== 'audio') return { id: local.id, name: local.name, kind: local.kind, src: local.contentUrl, duration: local.duration };
  const project = state.assets[previewSource.assetId];
  if (project && project.kind !== 'audio') return { id: project.id, name: project.name, kind: project.kind, src: project.src, duration: project.sourceDuration ?? undefined };
  return null;
}, [mediaLibrary.items, previewSource, state.assets]);
useEffect(() => {
  if (previewSource.mode === 'asset' && !previewAsset) setPreviewSource({ mode: 'timeline' });
}, [previewAsset, previewSource]);
```

Pass `asset={previewAsset}` to `Preview`.

- [ ] **Step 4: Report timeline activation once at the root**

```tsx
<section
  className="timeline"
  aria-label="时间线"
  onPointerDownCapture={onActivate}
  onFocusCapture={onActivate}
>
```

Pass `onActivate={() => setPreviewSource({ mode: 'timeline' })}` from `App`.

- [ ] **Step 5: Run App and Timeline tests and verify GREEN**

Run: `pnpm test src/App.test.tsx src/components/Timeline.test.tsx`

Expected: PASS.

---

### Task 5: Integrated Verification and Visual Review

**Files:**
- Modify only files required by failures discovered in this task.

**Interfaces:**
- Consumes all behavior from Tasks 1–4.
- Produces no new API.

- [ ] **Step 1: Run all focused media tests**

Run: `pnpm test src/components/ZoomableImage.test.tsx src/components/ImageDetailViewer.test.tsx src/components/MarkdownMessage.test.tsx src/components/AIAssistant.test.tsx src/components/AssetPreview.test.tsx src/components/Preview.test.tsx src/components/Timeline.test.tsx src/App.test.tsx`

Expected: all focused files pass.

- [ ] **Step 2: Run the full suite**

Run: `pnpm test`

Expected: every test file passes with zero failed tests.

- [ ] **Step 3: Run type-check and production build**

Run: `pnpm build`

Expected: TypeScript exits zero and Vite produces `dist/` successfully.

- [ ] **Step 4: Inspect the running app at desktop width**

Verify in `http://localhost:5173/`:

- generated images stay within the AI panel;
- detail viewer opens, zooms, pans, downloads, and closes;
- library image and video clicks replace central preview;
- video progress changes only the asset video;
- timeline pointer and keyboard focus restore the timeline frame;
- no media overflows its panel.

- [ ] **Step 5: Record completion evidence**

Report focused test results, full suite counts, build result, and the interactions checked in the running app. This workspace currently has no recognized Git repository, so omit commit steps rather than claiming commits were created.
