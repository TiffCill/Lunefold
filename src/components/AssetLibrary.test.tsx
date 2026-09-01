import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDemoState } from '../domain/editor';
import type { MediaItem } from '../media/mediaTypes';
import { AssetLibrary } from './AssetLibrary';

describe('AssetLibrary', () => {
  it('renders every asset as a headerless square grid tile', () => {
    const state = createDemoState();
    render(<AssetLibrary assets={state.assets} selectedAssetId={state.selectedAssetId} onSelectAsset={vi.fn()} />);

    expect(screen.getByRole('grid', { name: '素材库文件' })).toBeInTheDocument();
    expect(screen.getAllByRole('gridcell')).toHaveLength(Object.keys(state.assets).length);
    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '素材版本堆栈' })).not.toBeInTheDocument();
  });

  it('selects a tile without exposing version controls', () => {
    const state = createDemoState();
    const onSelectAsset = vi.fn();
    render(<AssetLibrary assets={state.assets} selectedAssetId={state.selectedAssetId} onSelectAsset={onSelectAsset} />);

    const target = Object.values(state.assets)[1];
    fireEvent.click(screen.getByRole('gridcell', { name: new RegExp(target.name) }));
    expect(onSelectAsset).toHaveBeenCalledWith(target.id);
    expect(screen.queryByText(/版本堆栈|个版本|当前版本/)).not.toBeInTheDocument();
  });

  it('selects a right-clicked asset and restores tile focus after an opaque-ID action', async () => {
    const user = userEvent.setup();
    const state = createDemoState();
    const target = Object.values(state.assets)[1];
    const onSelectAsset = vi.fn();
    const onAddToConversation = vi.fn();
    render(
      <AssetLibrary
        assets={state.assets}
        selectedAssetId={state.selectedAssetId}
        onSelectAsset={onSelectAsset}
        onAddToConversation={onAddToConversation}
        onAddToTimeline={vi.fn()}
        onReveal={vi.fn()}
      />,
    );

    const tile = screen.getByRole('gridcell', { name: new RegExp(target.name) });
    const contextMenu = createEvent.contextMenu(tile, { clientX: 160, clientY: 90, cancelable: true });
    fireEvent(tile, contextMenu);

    expect(contextMenu.defaultPrevented).toBe(true);
    expect(onSelectAsset).toHaveBeenCalledWith(target.id);
    expect(screen.getByRole('menu', { name: '素材操作' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '在文件夹中显示' })).toBeDisabled();
    await user.click(screen.getByRole('menuitem', { name: '添加到会话' }));
    expect(onAddToConversation).toHaveBeenCalledWith(target.id);
    const closingMenu = document.querySelector('.asset-context-menu');
    expect(closingMenu).toHaveClass('is-closing');
    expect(tile).not.toHaveFocus();
    fireEvent.animationEnd(closingMenu!);
    await waitFor(() => expect(tile).toHaveFocus());
    expect(document.querySelector('.asset-context-menu')).not.toBeInTheDocument();
  });

  it('preserves the opaque asset ID in the timeline drag payload', () => {
    const state = createDemoState();
    const target = Object.values(state.assets)[2];
    const setData = vi.fn();
    render(<AssetLibrary assets={state.assets} selectedAssetId={null} onSelectAsset={vi.fn()} />);

    const dragStart = createEvent.dragStart(screen.getByRole('gridcell', { name: new RegExp(target.name) }));
    Object.defineProperty(dragStart, 'dataTransfer', { value: { setData } });
    fireEvent(screen.getByRole('gridcell', { name: new RegExp(target.name) }), dragStart);

    expect(setData).toHaveBeenCalledWith('application/x-timeline-asset', target.id);
  });

  it('reveals only current companion items and reports reveal failures without leaking details', async () => {
    const localItem: MediaItem = {
      id: 'opaque-local',
      name: 'source.mov',
      relativePath: 'shoot/source.mov',
      kind: 'video',
      size: 42,
      modifiedAt: 7,
      objectUrl: '/api/media/opaque-local/content',
      contentUrl: '/api/media/opaque-local/content',
      durationStatus: 'pending',
    };
    const onReveal = vi.fn().mockRejectedValue(new Error('failed at /Users/private/source.mov'));
    render(
      <AssetLibrary
        assets={{}}
        selectedAssetId={null}
        onSelectAsset={vi.fn()}
        localItems={[localItem]}
        onSelectLocalMedia={vi.fn()}
        onAddToConversation={vi.fn()}
        onAddToTimeline={vi.fn()}
        onReveal={onReveal}
      />,
    );

    fireEvent.contextMenu(screen.getByRole('gridcell', { name: /source\.mov/ }), { clientX: 80, clientY: 60 });
    await userEvent.click(screen.getByRole('menuitem', { name: '在文件夹中显示' }));

    expect(onReveal).toHaveBeenCalledWith('opaque-local');
    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('无法在文件夹中显示“source.mov”');
    expect(error).not.toHaveTextContent('/Users/private');
  });

  it('moves focus to the library control when the originating tile disappears before close', async () => {
    const state = createDemoState();
    const target = Object.values(state.assets)[0];
    const { rerender } = render(
      <AssetLibrary
        assets={{ [target.id]: target }}
        selectedAssetId={target.id}
        onSelectAsset={vi.fn()}
        onAddToConversation={vi.fn()}
        onAddToTimeline={vi.fn()}
        onReveal={vi.fn()}
      />,
    );
    fireEvent.contextMenu(screen.getByRole('gridcell'), { clientX: 40, clientY: 40 });

    rerender(
      <AssetLibrary
        assets={{}}
        selectedAssetId={null}
        onSelectAsset={vi.fn()}
        onAddToConversation={vi.fn()}
        onAddToTimeline={vi.fn()}
        onReveal={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: '选择素材目录' })).toHaveFocus());
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('replaces an interrupted closing menu with the newly requested asset menu', async () => {
    const state = createDemoState();
    const assets = Object.values(state.assets);
    const onAddToConversation = vi.fn();
    render(
      <AssetLibrary
        assets={state.assets}
        selectedAssetId={state.selectedAssetId}
        onSelectAsset={vi.fn()}
        onAddToConversation={onAddToConversation}
        onAddToTimeline={vi.fn()}
        onReveal={vi.fn()}
      />,
    );
    fireEvent.contextMenu(screen.getByRole('gridcell', { name: new RegExp(assets[0].name) }), { clientX: 30, clientY: 30 });
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(document.querySelector('.asset-context-menu')).toHaveClass('is-closing');

    fireEvent.contextMenu(screen.getByRole('gridcell', { name: new RegExp(assets[1].name) }), { clientX: 70, clientY: 70 });
    expect(document.querySelectorAll('.asset-context-menu')).toHaveLength(1);
    await userEvent.click(screen.getByRole('menuitem', { name: '添加到会话' }));

    expect(onAddToConversation).toHaveBeenCalledOnce();
    expect(onAddToConversation).toHaveBeenCalledWith(assets[1].id);
  });

  it('offers directory reselection separately from a non-blocking action error', () => {
    const onChooseDirectory = vi.fn();
    render(
      <AssetLibrary
        assets={{}}
        selectedAssetId={null}
        onSelectAsset={vi.fn()}
        directoryStatus="reselect-required"
        directoryError="素材目录不可用，请重新选择素材目录"
        actionError="无法在 Finder 中显示素材"
        onChooseDirectory={onChooseDirectory}
      />,
    );

    expect(screen.getByText('素材目录不可用，请重新选择素材目录')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('无法在 Finder 中显示素材');
    fireEvent.click(screen.getByRole('button', { name: '重新选择素材目录' }));
    expect(onChooseDirectory).toHaveBeenCalledTimes(1);
  });
});
