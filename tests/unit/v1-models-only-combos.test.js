import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getCombos: vi.fn(),
  getProviderConnections: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getDisabledModels: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getCombos: mocks.getCombos,
  getProviderConnections: mocks.getProviderConnections,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: mocks.getDisabledModels,
}));

const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");

describe("buildModelsList with onlyExposeComboModels", () => {
  const sampleCombos = [
    { name: "combo-chat", kind: "llm" },
    { name: "combo-image", kind: "image" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCombos.mockResolvedValue(sampleCombos);
    mocks.getProviderConnections.mockResolvedValue([]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getDisabledModels.mockResolvedValue({});
  });

  it("returns only combo models when onlyExposeComboModels is true in settings", async () => {
    mocks.getSettings.mockResolvedValue({ onlyExposeComboModels: true });

    const models = await buildModelsList(["llm"]);

    expect(models).toEqual([
      { id: "combo-chat", object: "model", owned_by: "combo" },
    ]);
    expect(mocks.getProviderConnections).not.toHaveBeenCalled();
    expect(mocks.getCustomModels).not.toHaveBeenCalled();
  });

  it("returns only combo models when overridden via options", async () => {
    mocks.getSettings.mockResolvedValue({ onlyExposeComboModels: false });

    const models = await buildModelsList(["llm"], { onlyExposeComboModels: true });

    expect(models).toEqual([
      { id: "combo-chat", object: "model", owned_by: "combo" },
    ]);
    expect(mocks.getProviderConnections).not.toHaveBeenCalled();
  });

  it("includes provider models when onlyExposeComboModels is false", async () => {
    mocks.getSettings.mockResolvedValue({ onlyExposeComboModels: false });

    const models = await buildModelsList(["llm"]);

    const comboEntry = models.find((m) => m.id === "combo-chat");
    expect(comboEntry).toBeDefined();
    expect(models.length).toBeGreaterThan(1);
    expect(mocks.getProviderConnections).toHaveBeenCalled();
  });
});
