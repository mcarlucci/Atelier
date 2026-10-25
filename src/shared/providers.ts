/**
 * Model providers Atelier can build with. Anthropic goes through its SDK;
 * Ollama through its native API (so the context window can be raised past its
 * small default); everything else through the OpenAI-compatible
 * chat-completions API that most hosted and local servers expose.
 */

export type ProviderId = "anthropic" | "ollama" | "lmstudio" | "openrouter" | "groq" | "gemini" | "mistral" | "custom";
export type ProviderKind = "anthropic" | "ollama" | "openai";

export interface ProviderPreset {
  id: ProviderId;
  label: string;
  kind: ProviderKind;
  /** Runs on this computer: no key, nothing leaves the machine. */
  local: boolean;
  needsKey: boolean;
  /** Empty for Anthropic, whose SDK knows its endpoint. */
  defaultBaseUrl: string;
  blurb: string;
  /** Where to get a key, or how to install the server. */
  setupUrl?: string;
  modelPlaceholder: string;
}

export const PROVIDERS: readonly ProviderPreset[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    kind: "anthropic",
    local: false,
    needsKey: true,
    defaultBaseUrl: "",
    blurb: "Claude models. Best results, with prompt caching and adaptive thinking.",
    setupUrl: "https://console.anthropic.com/settings/keys",
    modelPlaceholder: "claude-opus-5-5",
  },
  {
    id: "ollama",
    label: "Ollama",
    kind: "ollama",
    local: true,
    needsKey: false,
    defaultBaseUrl: "http://localhost:11434",
    blurb: "Free. Runs open models such as Qwen, Llama, DeepSeek, Gemma and Mistral on this computer.",
    setupUrl: "https://ollama.com/download",
    modelPlaceholder: "qwen2.5-coder:32b",
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    kind: "openai",
    local: true,
    needsKey: false,
    defaultBaseUrl: "http://localhost:1234/v1",
    blurb: "Free. Runs open models on this computer. Start its local server first.",
    setupUrl: "https://lmstudio.ai",
    modelPlaceholder: "qwen2.5-coder-32b-instruct",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai",
    local: false,
    needsKey: true,
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    blurb: "Hundreds of open and hosted models behind one key. Models ending in :free cost nothing.",
    setupUrl: "https://openrouter.ai/keys",
    modelPlaceholder: "qwen/qwen-2.5-coder-32b-instruct:free",
  },
  {
    id: "groq",
    label: "Groq",
    kind: "openai",
    local: false,
    needsKey: true,
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    blurb: "Very fast hosted open models, with a free tier.",
    setupUrl: "https://console.groq.com/keys",
    modelPlaceholder: "llama-3.3-70b-versatile",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    kind: "openai",
    local: false,
    needsKey: true,
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    blurb: "Gemini models through Google AI Studio, with a free tier.",
    setupUrl: "https://aistudio.google.com/apikey",
    modelPlaceholder: "gemini-2.5-flash",
  },
  {
    id: "mistral",
    label: "Mistral",
    kind: "openai",
    local: false,
    needsKey: true,
    defaultBaseUrl: "https://api.mistral.ai/v1",
    blurb: "Mistral and Codestral models, with a free experiment tier.",
    setupUrl: "https://console.mistral.ai/api-keys",
    modelPlaceholder: "codestral-latest",
  },
  {
    id: "custom",
    label: "OpenAI-compatible",
    kind: "openai",
    local: false,
    needsKey: false,
    defaultBaseUrl: "http://localhost:8000/v1",
    blurb: "Any server with a /chat/completions endpoint: vLLM, llama.cpp, Jan, LocalAI, Together, DeepSeek and others.",
    modelPlaceholder: "model-id",
  },
];

export const DEFAULT_OLLAMA_CONTEXT = 32768;

export function providerPreset(id: string): ProviderPreset {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return p;
}
