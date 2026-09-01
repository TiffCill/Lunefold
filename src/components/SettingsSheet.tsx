import { useEffect, useState, type FormEvent } from 'react';
import { companionApi, type MaskedSettings } from '../api/companion';

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const [saved, setSaved] = useState<MaskedSettings | null>(null);
  const [gptbotsApiKey, setGptbotsApiKey] = useState('');
  const [modellixApiKey, setModellixApiKey] = useState('');
  const [region, setRegion] = useState<'sg' | 'jp' | 'th'>('sg');
  const [userId, setUserId] = useState('lumina-editor-user');
  const [status, setStatus] = useState('');
  useEffect(() => { companionApi.getSettings().then((value) => { setSaved(value); setRegion(value.gptbotsRegion); setUserId(value.gptbotsUserId); }).catch((error) => setStatus(error.message)); }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setStatus('正在保存…');
    try { setSaved(await companionApi.saveSettings({ gptbotsApiKey, modellixApiKey, gptbotsRegion: region, gptbotsUserId: userId })); setGptbotsApiKey(''); setModellixApiKey(''); setStatus('已安全保存到本机'); }
    catch (error) { setStatus((error as Error).message); }
  };
  return <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="settings-sheet material-heavy" aria-label="AI 服务设置" onSubmit={submit}>
      <header><div><strong>AI 服务设置</strong><span>密钥仅保存在这台电脑</span></div><button type="button" onClick={onClose} aria-label="关闭设置">×</button></header>
      <label>GPTBots API Key<input type="password" autoComplete="off" placeholder={saved?.gptbotsApiKey.configured ? `已配置 ····${saved.gptbotsApiKey.lastFour}` : '粘贴 API Key'} value={gptbotsApiKey} onChange={(e) => setGptbotsApiKey(e.target.value)} /></label>
      <label>Modellix API Key<input type="password" autoComplete="off" placeholder={saved?.modellixApiKey.configured ? `已配置 ····${saved.modellixApiKey.lastFour}` : '粘贴 API Key'} value={modellixApiKey} onChange={(e) => setModellixApiKey(e.target.value)} /></label>
      <div className="settings-row"><label>数据区域<select value={region} onChange={(e) => setRegion(e.target.value as typeof region)}><option value="sg">新加坡</option><option value="jp">日本</option><option value="th">泰国</option></select></label><label>用户标识<input value={userId} onChange={(e) => setUserId(e.target.value)} /></label></div>
      <footer><span role="status">{status}</span><button type="submit" className="export-button">保存设置</button></footer>
    </form>
  </div>;
}
