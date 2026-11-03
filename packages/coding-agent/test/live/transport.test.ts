import { expect, test } from "bun:test";
import { AuthStorage } from "@oh-my-pi/pi-ai";
import { CodexLiveTransport } from "../../src/live/transport";

// A caller-owned media peer lets these tests exercise real HTTP/WebSocket signaling
// without opening a microphone or depending on an external WebRTC server.
test("proxy live calls authenticate both channels and keep sideband credentials on the configured origin", async () => {
	const authStorage = await AuthStorage.create(":memory:");
	const started = Promise.withResolvers<string>();
	const closed = Promise.withResolvers<string>();
	const requests: string[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request, server) {
			const path = new URL(request.url).pathname;
			requests.push(`${request.method} ${path}`);
			if (
				request.headers.get("authorization") !== "Bearer proxy-key" ||
				request.headers.get("openai-alpha") !== "quicksilver=v2" ||
				request.headers.get("x-proxy-tenant") !== "tenant-a"
			)
				return new Response("Missing proxy authentication", { status: 401 });
			for (const header of ["chatgpt-account-id", "x-oai-attestation", "originator"]) {
				expect(request.headers.has(header)).toBe(false);
			}
			if (request.method === "POST" && path === "/gateway/v1/live") {
				const body = await request.json();
				expect(body).toEqual({
					sdp: "caller-offer",
					session: {
						model: "gpt-live-1-codex",
						instructions: "Test instructions",
						audio: { output: { voice: "sol" } },
						delegation: { type: "client" },
					},
				});
				return new Response("server-answer", {
					status: 201,
					// Location is untrusted. Only its call ID, never its origin, is used.
					headers: { location: "https://untrusted.invalid/v1/live/rtc_proxy-test" },
				});
			}
			if (path === "/gateway/v1/live/rtc_proxy-test" && server.upgrade(request)) return;
			return new Response("Unexpected live route", { status: 404 });
		},
		websocket: {
			open(socket) {
				socket.send(JSON.stringify({ type: "session.started", session: { id: "proxy-session" } }));
			},
			message(_socket, message) {
				closed.resolve(String(message));
			},
		},
	});
	const transport = new CodexLiveTransport({
		authStorage,
		sessionId: "test-session",
		instructions: "Test instructions",
		voice: "sol",
		sdpOffer: "caller-offer",
		provider: {
			id: "proxy",
			baseUrl: `http://127.0.0.1:${server.port}/gateway/v1/`,
			apiKey: "proxy-key",
			headers: { "x-proxy-tenant": "tenant-a", Authorization: "Bearer stale-key" },
		},
		callbacks: {
			onEvent(event) {
				if (event.type === "session.started") started.resolve(event.session.id);
			},
			onOutputLevel() {},
		},
	});
	try {
		await transport.connect();
		expect(transport.sdpAnswer).toBe("server-answer");
		expect(await started.promise).toBe("proxy-session");
		await transport.send({ type: "session.close" });
		expect(JSON.parse(await closed.promise)).toEqual({ type: "session.close" });
		expect(requests).toEqual(["POST /gateway/v1/live", "GET /gateway/v1/live/rtc_proxy-test"]);
	} finally {
		await transport.close();
		server.stop(true);
		authStorage.close();
	}
});

for (const scenario of [
	{ status: 401, body: "Invalid proxy key", location: null, error: "signaling failed (401): Invalid proxy key" },
	{ status: 201, body: "answer", location: null, error: "returned no valid call ID" },
	{ status: 201, body: "", location: "/v1/live/rtc_empty", error: "returned an empty SDP answer" },
]) {
	test(`proxy signaling rejects ${scenario.error} without falling back to OAuth`, async () => {
		const authStorage = await AuthStorage.create(":memory:");
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch() {
				return new Response(scenario.body, {
					status: scenario.status,
					headers: scenario.location ? { location: scenario.location } : undefined,
				});
			},
		});
		const transport = new CodexLiveTransport({
			authStorage,
			sessionId: "test-session",
			instructions: "Test",
			voice: "sol",
			sdpOffer: "caller-offer",
			provider: { id: "proxy", baseUrl: `http://127.0.0.1:${server.port}/v1`, apiKey: "proxy-key" },
			callbacks: { onEvent() {}, onOutputLevel() {} },
		});
		try {
			await expect(transport.connect()).rejects.toThrow(scenario.error);
		} finally {
			await transport.close();
			server.stop(true);
			authStorage.close();
		}
	});
}
