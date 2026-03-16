import type React from 'react';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { systemConfigApi } from '../api/systemConfig';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ChannelInfo {
  name: string;
  protocol: string;
  models: string[];
  enabled: boolean;
}

interface ModelOption {
  /** Runtime model identifier, e.g. "openai/gpt-4o" */
  value: string;
  /** Human-friendly label */
  label: string;
  /** Channel name it belongs to */
  channel: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const KNOWN_PREFIXES = new Set([
  'openai', 'anthropic', 'gemini', 'vertex_ai', 'deepseek', 'ollama',
  'cohere', 'huggingface', 'bedrock', 'sagemaker', 'azure', 'replicate',
  'together_ai', 'palm', 'groq', 'cerebras', 'fireworks_ai', 'friendliai',
]);

const PROTOCOL_ALIASES: Record<string, string> = {
  vertexai: 'vertex_ai',
  vertex: 'vertex_ai',
  claude: 'anthropic',
  google: 'gemini',
  openai_compatible: 'openai',
  openai_compat: 'openai',
};

function normalizeModel(model: string, protocol: string): string {
  const trimmed = model.trim();
  if (!trimmed) return trimmed;

  if (trimmed.includes('/')) {
    const rawPrefix = trimmed.split('/', 1)[0].trim().toLowerCase();
    const canonical = PROTOCOL_ALIASES[rawPrefix] || rawPrefix;
    if (KNOWN_PREFIXES.has(rawPrefix) || KNOWN_PREFIXES.has(canonical)) {
      if (canonical !== rawPrefix && KNOWN_PREFIXES.has(canonical)) {
        return `${canonical}/${trimmed.split('/').slice(1).join('/')}`;
      }
      return trimmed;
    }
    return `${protocol}/${trimmed}`;
  }
  return `${protocol}/${trimmed}`;
}

function splitModels(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseChannels(items: Array<{ key: string; value: string }>): ChannelInfo[] {
  const m = new Map(items.map((i) => [i.key, i.value]));
  const names = (m.get('LLM_CHANNELS') || '').split(',').map((s) => s.trim()).filter(Boolean);
  return names.map((name) => {
    const upper = name.toUpperCase();
    const rawModels = m.get(`LLM_${upper}_MODELS`) || '';
    const enabledVal = m.get(`LLM_${upper}_ENABLED`);
    const enabled = !enabledVal || !['0', 'false', 'no', 'off'].includes(enabledVal.trim().toLowerCase());
    const protocol = m.get(`LLM_${upper}_PROTOCOL`) || 'openai';
    return {
      name: name.toLowerCase(),
      protocol,
      models: splitModels(rawModels),
      enabled,
    };
  });
}

function getModelIcon(model: string): string {
  const lower = model.toLowerCase();
  if (lower.includes('claude') || lower.includes('anthropic')) return '🟣';
  if (lower.includes('gpt') || lower.includes('openai')) return '🟢';
  if (lower.includes('gemini') || lower.includes('google')) return '🔵';
  if (lower.includes('deepseek')) return '🔷';
  if (lower.includes('qwen') || lower.includes('dashscope')) return '🟠';
  if (lower.includes('glm') || lower.includes('zhipu')) return '🟤';
  if (lower.includes('moonshot')) return '🌙';
  if (lower.includes('llama')) return '🦙';
  return '⚡';
}

function getShortLabel(model: string): string {
  // Remove provider prefix for display
  const parts = model.split('/');
  if (parts.length > 1) {
    return parts.slice(1).join('/');
  }
  return model;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const QuickModelSwitcher: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSwitching, setIsSwitching] = useState(false);
  const [currentModel, setCurrentModel] = useState<string>('');
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [configVersion, setConfigVersion] = useState<string>('');
  const [maskToken, setMaskToken] = useState<string>('******');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Load config on mount
  const loadConfig = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const config = await systemConfigApi.getConfig(true);
      setConfigVersion(config.configVersion || '');
      setMaskToken(config.maskToken || '******');

      const items = (config.items || []).map((item: any) => ({
        key: item.key as string,
        value: String(item.value ?? ''),
      }));

      // Parse current primary model
      const itemMap = new Map(items.map((i: { key: string; value: string }) => [i.key, i.value]));
      setCurrentModel(itemMap.get('LITELLM_MODEL') || '');

      // Parse channels and build model options
      const channels = parseChannels(items);
      const options: ModelOption[] = [];
      const seen = new Set<string>();

      for (const ch of channels) {
        if (!ch.enabled) continue;
        for (const rawModel of ch.models) {
          const normalized = normalizeModel(rawModel, ch.protocol);
          if (!normalized || seen.has(normalized)) continue;
          seen.add(normalized);
          options.push({
            value: normalized,
            label: getShortLabel(normalized),
            channel: ch.name,
          });
        }
      }

      setModelOptions(options);
    } catch (err) {
      console.error('Failed to load model config:', err);
      setError('无法加载模型配置');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  // Switch model
  const handleSwitch = useCallback(async (model: string) => {
    if (model === currentModel || isSwitching) return;

    setIsSwitching(true);
    setError(null);
    setSuccessMsg(null);

    try {
      await systemConfigApi.update({
        configVersion,
        maskToken,
        reloadNow: true,
        items: [{ key: 'LITELLM_MODEL', value: model }],
      });
      setCurrentModel(model);
      setSuccessMsg(`已切换到 ${getShortLabel(model)}`);
      setIsOpen(false);

      // Refresh config version
      void loadConfig();

      // Clear success message after 3s
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err) {
      console.error('Failed to switch model:', err);
      setError('模型切换失败，请重试');
    } finally {
      setIsSwitching(false);
    }
  }, [currentModel, isSwitching, configVersion, maskToken, loadConfig]);

  // Display text
  const displayModel = useMemo(() => {
    if (isLoading) return '加载中...';
    if (!currentModel) return '自动选择';
    return getShortLabel(currentModel);
  }, [currentModel, isLoading]);

  const displayIcon = useMemo(() => {
    if (isLoading) return '⏳';
    if (!currentModel) return '🤖';
    return getModelIcon(currentModel);
  }, [currentModel, isLoading]);

  return (
    <div ref={dropdownRef} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => {
          if (!isLoading && modelOptions.length > 0) {
            setIsOpen((prev) => !prev);
          }
        }}
        disabled={isLoading || modelOptions.length === 0}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/10 bg-elevated/60 hover:bg-elevated hover:border-cyan/30 transition-all text-sm text-secondary hover:text-white disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap max-w-[200px]"
        title={currentModel || '当前模型'}
      >
        <span className="text-xs">{displayIcon}</span>
        <span className="truncate text-xs">{displayModel}</span>
        {!isLoading && modelOptions.length > 0 && (
          <svg className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {/* Success toast */}
      {successMsg && (
        <div className="absolute top-full mt-1 left-0 right-0 z-50 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-300 whitespace-nowrap">
          {successMsg}
        </div>
      )}

      {/* Error toast */}
      {error && (
        <div className="absolute top-full mt-1 left-0 right-0 z-50 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300 whitespace-nowrap">
          {error}
        </div>
      )}

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full mt-1 left-0 z-50 min-w-[280px] max-h-[320px] overflow-y-auto rounded-xl border border-white/10 bg-card shadow-2xl shadow-black/40 backdrop-blur-xl">
          {/* Header */}
          <div className="sticky top-0 z-10 border-b border-white/8 bg-card/95 backdrop-blur-sm px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted uppercase tracking-wider">选择模型</span>
              <span className="text-[10px] text-muted">{modelOptions.length} 个可用</span>
            </div>
          </div>

          {/* Model list */}
          <div className="p-1.5">
            {/* Auto option */}
            <button
              type="button"
              onClick={() => void handleSwitch('')}
              disabled={isSwitching}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${
                !currentModel
                  ? 'bg-cyan/10 border border-cyan/20 text-cyan'
                  : 'hover:bg-white/5 text-secondary hover:text-white'
              } disabled:opacity-50`}
            >
              <span className="text-sm">🤖</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">自动选择</div>
                <div className="text-[10px] text-muted">使用第一个可用模型</div>
              </div>
              {!currentModel && (
                <span className="text-[10px] text-cyan font-medium">当前</span>
              )}
            </button>

            {/* Model options */}
            {modelOptions.map((opt) => {
              const isActive = opt.value === currentModel;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => void handleSwitch(opt.value)}
                  disabled={isSwitching}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${
                    isActive
                      ? 'bg-cyan/10 border border-cyan/20 text-cyan'
                      : 'hover:bg-white/5 text-secondary hover:text-white'
                  } disabled:opacity-50`}
                >
                  <span className="text-sm">{getModelIcon(opt.value)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{opt.label}</div>
                    <div className="text-[10px] text-muted truncate">
                      渠道: {opt.channel}
                    </div>
                  </div>
                  {isActive && (
                    <span className="text-[10px] text-cyan font-medium">当前</span>
                  )}
                  {isSwitching && isActive && (
                    <svg className="w-3.5 h-3.5 animate-spin text-cyan" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div className="border-t border-white/8 px-3 py-2">
            <p className="text-[10px] text-muted text-center">
              切换后立即生效，新分析将使用所选模型
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
