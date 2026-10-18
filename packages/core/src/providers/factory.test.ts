import { describe, expect, it } from 'vitest';
import { isLoopbackUrl, providerFromEnv, providerKind } from './factory.js';
import { GeminiProvider } from './gemini.js';
import { OllamaProvider } from './ollama.js';
import { OpenAICompatibleProvider } from './openaiCompat.js';

describe('providerFromEnv', () => {
  it('defaults to Gemini, which needs a key', () => {
    expect(providerKind({})).toBe('gemini');
    expect(providerFromEnv({ GEMINI_API_KEY: 'k' })).toBeInstanceOf(GeminiProvider);
    expect(() => providerFromEnv({})).toThrow(/GEMINI_API_KEY/);
  });

  it('builds a fully local provider without reading any Gemini key', () => {
    const p = providerFromEnv({ ENGRAM_PROVIDER: 'ollama' });
    expect(p).toBeInstanceOf(OllamaProvider);
    expect((p as OllamaProvider).model).toBe('qwen3.5:9b');
  });

  it('keeps Gemini embeddings under local generation only on request (ablation row B)', () => {
    expect(() =>
      providerFromEnv({ ENGRAM_PROVIDER: 'ollama', OLLAMA_EMBEDDINGS: 'gemini' }),
    ).toThrow(/GEMINI_API_KEY/);
  });

  it('refuses unknown providers and remote Ollama servers unless opted in', () => {
    expect(() => providerFromEnv({ ENGRAM_PROVIDER: 'openai' })).toThrow(/must be one of/);
    expect(() =>
      providerFromEnv({ ENGRAM_PROVIDER: 'ollama', OLLAMA_BASE_URL: 'http://10.0.0.5:11434' }),
    ).toThrow(/not a loopback/);
    expect(
      providerFromEnv({
        ENGRAM_PROVIDER: 'ollama',
        OLLAMA_BASE_URL: 'http://10.0.0.5:11434',
        OLLAMA_ALLOW_REMOTE: '1',
      }),
    ).toBeInstanceOf(OllamaProvider);
  });

  it('builds an openai-compatible provider for llama.cpp, LM Studio or vLLM', () => {
    const env = {
      ENGRAM_PROVIDER: 'openai-compatible',
      OPENAI_COMPAT_BASE_URL: 'http://127.0.0.1:8091',
      OPENAI_COMPAT_MODEL: 'qwen3.5-9b',
    };
    expect(providerFromEnv(env)).toBeInstanceOf(OpenAICompatibleProvider);
    expect(() => providerFromEnv({ ENGRAM_PROVIDER: 'openai-compatible' })).toThrow(
      /OPENAI_COMPAT_BASE_URL/,
    );
    expect(() =>
      providerFromEnv({ ...env, OPENAI_COMPAT_BASE_URL: 'https://api.example.com' }),
    ).toThrow(/OPENAI_COMPAT_ALLOW_REMOTE/);
  });

  it('knows loopback addresses', () => {
    for (const u of [
      'http://localhost:11434',
      'http://127.0.0.1:1',
      'http://127.4.5.6',
      'http://[::1]:11434',
    ])
      expect(isLoopbackUrl(u), u).toBe(true);
    for (const u of [
      'http://10.0.0.5',
      'https://example.com',
      'http://localhost.evil.com',
      'nonsense',
    ])
      expect(isLoopbackUrl(u), u).toBe(false);
  });
});
