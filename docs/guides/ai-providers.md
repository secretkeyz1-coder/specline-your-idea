# AI providers

[Back to README](../../README.md) · [Troubleshooting](troubleshooting.md)

AI planning is bring-your-own-provider. SpecLine Your Idea does not supply model credits or guarantee a provider's availability, output quality, or automated-use terms. Review generated artifacts before approval. Discovery and manual planning do not need an AI provider; generation needs role routing.

## Configure the full chain

Under **Settings → AI**, add a provider connection, select or enter a model on an AI profile, then bind that profile to the appropriate planning roles. The interface includes provider connections, profiles, and role routing (some controls appear under Advanced). Project overrides can differ from workspace defaults; check both when the wrong model is used.

Test the connection with a model it actually supports. An empty model list is not necessarily a broken connection: some compatible endpoints do not list models, so enter the model ID manually. A successful probe does not prove the model can handle a large structured planning request.

| Mode | Requirements | Execution location |
|---|---|---|
| API connection | OpenAI, Anthropic, Gemini, OpenAI-compatible, or custom HTTP settings; your credentials as needed | Server calls the provider endpoint |
| Local CLI on API host | Operator enables `SDD_ENABLE_LOCAL_CLI=true`; installs/authenticates Claude Code or Codex as the API process's OS user | API host |
| Local CLI on your machine | Authenticate `sddctl`, run optional daemon, select your owned machine in the connection | Your machine through its outbound connection |

A Local CLI connection does not store a model API key: the installed CLI uses its own login. It is not the same thing as task-execution dispatch. The planning runner restricts CLI tools/environment; the execution daemon intentionally lets coding agents modify a target repository. Read [security boundaries](../../SECURITY.md).

## Operator settings

- `ALLOW_PRIVATE_AI_EGRESS=false` is the default hosted posture. Enable it only deliberately for a trusted self-hosted loopback/LAN model endpoint; it widens the egress boundary. Do not enable it merely to silence a URL-policy error on a public instance.
- `SDD_ENABLE_LOCAL_CLI=false` keeps server-side Local CLI generation disabled. Machine-side generation does not require enabling server-side execution.
- `SDD_CLAUDE_BIN` and `SDD_CODEX_BIN` can override detected CLI binary paths on the host where generation runs. Installation and authentication remain your responsibility.
- Provider credentials are encrypted using `SDD_MASTER_KEY`. Keep the key outside the database and protect its backup; replacing it casually can make saved credentials unreadable.

Do not put keys into project descriptions, prompts, exports, screenshots, or issue reports. Prompts and planning content may be sent to your selected external provider; check its retention/privacy terms and avoid sensitive input you are not authorized to share.

## When generation fails

For `AI_PROVIDER_NOT_CONFIGURED`, check the active role binding and profile, not only that a connection exists. For auth/model errors, verify endpoint, model ID, credentials, and quota. For Local CLI failures, inspect machine availability and detected login using the source daemon's `status` command in [CLI and agents](cli-and-agents.md). For truncation/timeouts, narrow the request or choose a suitable model and review any retry; do not approve partial output as complete.

See [troubleshooting](troubleshooting.md) and the existing [security specification](../13_SECURITY.md) for further context.
