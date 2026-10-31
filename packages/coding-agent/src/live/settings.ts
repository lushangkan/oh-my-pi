/**
 * Settings declared by this domain (see `config/registry.ts`). Declaration order is the
 * settings-panel order; `config/all-settings.ts` registers every domain.
 */
import { register, type ScopeLike } from "../config/registry";
import { DEFAULT_LIVE_VOICE, LIVE_VOICE_OPTIONS, LIVE_VOICE_VALUES } from "./voices";

/** Provider whose endpoint implements the Codex Live protocol. */
export const cfgLiveProvider = register({ id: "live.provider", type: "string", default: "openai-codex" });

export const cfgLiveVoice = register({
	id: "live.voice",
	type: "enum",
	values: LIVE_VOICE_VALUES,
	default: DEFAULT_LIVE_VOICE,
	ui: {
		tab: "providers",
		group: "Services",
		label: "Live Voice",
		description: "Voice used by Codex-backed realtime voice sessions",
		options: LIVE_VOICE_OPTIONS,
	},
});

/** The voice a live session uses: an explicit choice, else the `live.voice` setting, else the default. */
export function resolveLiveVoice(scope: ScopeLike, voice?: string): string {
	return voice?.trim() || cfgLiveVoice.get(scope) || DEFAULT_LIVE_VOICE;
}
