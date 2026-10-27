import { afterEach, describe, expect, it, vi } from "vitest";
const providers = vi.hoisted(() => ({ choose: vi.fn(() => "fake"), generate: vi.fn() }));
vi.mock("@/llm", () => ({ chooseProvider: providers.choose, getLLM: () => ({ generate: providers.generate }) }));
import { GET, POST } from "@/app/api/world/agents/route";
import { initialLayout } from "@/world/simulation";
const url = "http://localhost:3000/api/world/agents";
const snapshot = { phase: "design", layout: initialLayout, activity: ["You: collected the brief"] };
async function cookie() {
  const response = await GET(new Request(url));
  return response.headers.get("set-cookie")!.split(";")[0];
}
function turn(session: string, agent = "maya", message?: string) {
  return new Request(url, { method: "POST", headers: { cookie: session, origin: "http://localhost:3000" }, body: JSON.stringify({ agent, message, snapshot }) });
}
afterEach(() => { vi.restoreAllMocks(); providers.choose.mockReturnValue("fake"); providers.generate.mockReset(); });
describe("independent embodied character turns", () => {
  it("reports local mode honestly and validates observations", async () => {
    const response = await GET(new Request(url));
    expect(await response.json()).toMatchObject({ mode: "local" });
    const session = response.headers.get("set-cookie")!.split(";")[0];
    const result = await POST(turn(session));
    expect(await result.json()).toMatchObject({ agent: "maya", mode: "local", destination: "desk" });
    expect(providers.generate).not.toHaveBeenCalled();
    const invalid = await POST(new Request(url, { method: "POST", headers: { cookie: session }, body: JSON.stringify({ agent: "maya", snapshot: { phase: "invented" } }) }));
    expect(invalid.status).toBe(400);
  });
  it("keeps separate memories for each character and uses the shared observed world", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    providers.choose.mockReturnValue("claude");
    providers.generate.mockResolvedValue({ value: { destination: "board", line: "Let’s check the headline.", memory: "Maya noticed a small booking line." } });
    const session = await cookie();
    await POST(turn(session, "maya", "What should I improve?"));
    now += 3000;
    await POST(turn(session, "alex"));
    let prompt = JSON.parse(providers.generate.mock.calls[1][0].messages[0].content);
    expect(prompt.yourMemories).toEqual([]);
    expect(prompt.observation).toEqual(snapshot);
    now += 3000;
    await POST(turn(session, "maya"));
    prompt = JSON.parse(providers.generate.mock.calls[2][0].messages[0].content);
    expect(prompt.yourMemories).toEqual(["Maya noticed a small booking line."]);
    expect(providers.generate.mock.calls[0][0].runId).toBeTruthy();
  });
  it("requires a session, rejects cross-origin requests, and throttles rapid turns", async () => {
    expect((await POST(turn("lifeas-studio=unknown"))).status).toBe(409);
    const session = await cookie();
    const request = turn(session); request.headers.set("origin", "https://elsewhere.example");
    expect((await POST(request)).status).toBe(403);
    expect((await POST(turn(session))).status).toBe(200);
    expect((await POST(turn(session))).status).toBe(429);
  });
  it("uses local behaviour and an explicit notice when a provider fails", async () => {
    providers.choose.mockReturnValue("claude"); providers.generate.mockRejectedValue(new Error("unavailable"));
    const response = await POST(turn(await cookie(), "alex"));
    expect(await response.json()).toMatchObject({ mode: "local", notice: "AI unavailable or budget reached. Character is using local behaviour." });
  });
});
