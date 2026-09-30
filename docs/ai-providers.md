# AI providers: terms and data-use review

**Reviewed 2026-09-30.** Scope: the IDE's **Generate commit message** feature.

How the feature works:
- It sends one repo's diff (up to ~60k characters) and its recent commit subjects to the provider the user picked.
- The user supplies their own key (stored in the macOS Keychain), their own installed and logged-in CLI, or a local server.
- The IDE is not a hosted service and does not resell access.

This is an engineering review of the providers' published terms, not legal advice. Items marked ⚠︎ in "Sources" are either:
- facts confirmed only through secondary sources (the primary page blocked automated fetching), or
- open questions.

Re-check both before relying on them in legal copy.

## Summary

- **Risk levels:** the app's risk level for each provider is in `src/lib/aiProviders.ts`.
- **Notes:** each provider's data-use note appears in Settings.
- **First send:** providers not marked "ok" require a one-time confirmation before the first send. The confirmation shows the note and a **Send diff** button.

| Provider | Our use allowed? | Training on our data by default | Retention / location | App risk level |
|---|---|---|---|---|
| Anthropic API | Yes | No | Not retained by default for standard models; 30 days for "covered" models | ok |
| OpenAI API | Yes | No (opt-in only) | ~30 days for abuse monitoring; zero data retention available | ok |
| Google Gemini API, **paid** tier | Yes | No | Standard Google retention | caution (same key field as the free tier) |
| Google Gemini API, **free** tier | Conditional | **Yes**, and humans may review it | Google may use it to improve products; must not be used by EEA/UK/CH users | caution |
| OpenRouter | Yes | OpenRouter: no, and prompts aren't logged by default. **Some upstream providers train** unless the account's no-training option is set | Varies by upstream provider | caution |
| Groq | Yes | No | No inference retention by default; US | ok |
| Mistral, paid plans | Yes | No | EU | caution (same key field as the free plan) |
| Mistral, free "Experiment" plan | Conditional | **Yes**, unless opted out in the console | EU | caution |
| DeepSeek | Conditional | **Yes** (privacy policy); no API opt-out could be verified | **Stored in the People's Republic of China**; no published API retention window | **warning** |
| xAI API | Yes | No (Enterprise/API terms) | Deleted within 30 days | ok |
| Ollama, LM Studio (local) | Yes | No; nothing leaves the machine | Local. LM Studio has been free for work use since 2025-07-01 | ok |
| Claude Code (`claude -p`) | Yes, under conditions (below) | Follows the user's Claude account settings | Local transcripts per Claude Code settings | ok |
| Codex CLI (`codex exec`), API key or Business login | Yes | No | API terms | caution (same entry as below) |
| Codex CLI with a ChatGPT **Plus/Pro** login | Conditional | **Yes by default**; the user can turn off "Improve the model for everyone" | ChatGPT consumer terms | caution |
| Gemini CLI with a **personal Google** login | Conditional | **Yes by default**, human review possible, de-identified copies kept up to 18 months; opt-out exists | Gemini Code Assist for individuals | caution |
| Gemini CLI via Vertex or paid Code Assist | Yes | No | Google Cloud terms | caution (same entry as above) |
| OpenCode CLI | Yes (MIT license; telemetry off by default) | Depends on the provider opencode is configured with | — | caution |

The app can't tell which plan or login a key or CLI uses. Wherever the answer depends on the plan (Gemini, Mistral, Codex, Gemini CLI), the note states both cases and the entry is marked **caution**.

## Rules the implementation follows

1. **Official endpoints only.** Keys are sent in headers, never in URLs, and are never exposed to the webview or logs (`src-tauri/src/ai.rs`).
2. **Explicit sends.** Nothing is sent until the user presses **Generate**. Caution and warning providers also need a one-time acknowledgement, stored as `settings.ai.acknowledged`.
3. **Agent CLIs** (Anthropic's Claude Code legal and compliance terms apply directly):
   - The IDE spawns the **user's own, unmodified, installed** binary in its documented non-interactive mode.
   - It never reads, stores or relays the CLI's OAuth or session tokens.
   - It never offers a "Claude.ai login".
   - It never bundles or pre-installs any CLI.
   - Anthropic's own headless docs show the same pattern: `git diff main | claude -p …`.
4. **OpenRouter:** sends only the optional `X-OpenRouter-Title: IDE` header. There is no `HTTP-Referer`, because the app has no public URL and a made-up one must not be sent.
5. **No retry loops.** Rate-limit and quota errors (e.g. 429) are shown as returned.

## Open points

- **Claude Code in a distributed product.** Anthropic explicitly allows an end user signing in to the unmodified Claude Code binary with their own subscription. It is not verified whether a *distributed* desktop app that runs the user's CLI counts as "offering Claude Code in your product" under the stricter clause. Get a legal read before a public release, or restrict the Claude CLI provider to API-key logins.
- **Gemini free tier in the EEA, UK or Switzerland.** Google requires paid services when API clients are made available to users there. The app can't detect the tier or the user's region, so the note tells users to use a paid key. Consider a region check or an explicit "paid key" confirmation before a public EU release.
- **DeepSeek.** Kept as an option with the strongest warning. Consider hiding it by default in enterprise builds.

## Sources

**Anthropic**
- https://code.claude.com/docs/en/legal-and-compliance: OAuth rules, the unmodified-binary rule, and no intermediating credentials
- https://code.claude.com/docs/en/headless: the `claude -p` piping example

**OpenAI**
- https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan: ChatGPT terms apply to Codex when signed in with a ChatGPT account
- Consumer training and opt-out:
  - https://openai.com/policies ⚠︎ fetch was blocked (HTTP 403); corroborated through OpenAI help pages and a third-party terms archive

**Google**
- https://ai.google.dev/gemini-api/terms: unpaid vs paid services, "do not submit sensitive, confidential, or personal information", EEA/UK/CH paid-only
- https://developers.google.com/gemini-code-assist/resources/privacy-notice-gemini-code-assist-individuals: Gemini CLI with a personal account

**OpenRouter**
- https://openrouter.ai/docs/features/privacy-and-logging
- https://openrouter.ai/docs/app-attribution: `X-OpenRouter-Title` (`X-Title` is legacy)

**Mistral**
- https://legal.mistral.ai/terms/commercial-terms-of-service: training exception for opt-in-by-default products
- ⚠︎ The Experiment-plan help page returned 404; confirmed via search results

**DeepSeek**
- https://chat.deepseek.com/downloads/DeepSeek%20Privacy%20Policy.html ⚠︎ direct fetch failed; content confirmed through several secondary analyses

**xAI**
- Enterprise/API Terms of Service ⚠︎ x.ai blocked fetching; wording confirmed through a terms archive (conductatlas.com). The consumer terms do **not** govern `api.x.ai`.

**Groq**
- Groq's privacy policy and data processing agreement. ⚠︎ The data processing agreement itself couldn't be fetched; its no-training commitment is confirmed via Groq's public docs.

**OpenCode**
- MIT license. Telemetry requires `experimental.openTelemetry`.

**Ollama and LM Studio**
- Ollama: "does not use user inputs or outputs to train".
- LM Studio: removed the commercial-license requirement for work use on 2025-07-01.
