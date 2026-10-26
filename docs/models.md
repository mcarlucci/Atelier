# AI models

[← Back to README](../README.md)

Choose a model provider under **Settings → AI model**:

| Provider | Kind | Key |
|---|---|---|
| Anthropic (default: Claude Opus 5.5, adaptive thinking, selectable effort) | Anthropic SDK, with prompt caching | Required, or set `ANTHROPIC_API_KEY`. Settings offers to import one saved in macOS Keychain or Windows Credential Manager under the name `Atelier`, `anthropic`, `ANTHROPIC_API_KEY` or `anthropic-api-key` |
| Ollama | Native `/api/chat`, with a configurable context window (default 32768 tokens) | None, runs locally |
| LM Studio | OpenAI-compatible | None, runs locally |
| OpenRouter, Groq, Google Gemini, Mistral | OpenAI-compatible | Required (each has a free tier) |
| OpenAI-compatible (vLLM, llama.cpp, Jan, LocalAI, Together, DeepSeek, …) | OpenAI-compatible | Optional |

Models are listed from the provider, and you can also type any model id. Under **Models in the prompt**, choose which models the prompt's model menu offers from every connected provider at once (by default, all of the active provider's and none of the others'). The menu groups them by provider, and choosing one switches the active provider. Open models vary in how well they follow Atelier's action tags and design system rules. Larger coding models work best, and the compliance check flags mistakes. Reasoning output inside `<think>` tags is hidden. Ollama's OpenAI-compatible endpoint can't raise the context window, so Ollama uses its native API instead: at the default window the design system catalog and codebase would be cut off.
