import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import App from "./App.vue";
const themeCss = readFileSync(resolve(process.cwd(), "src/assets/theme.css"), "utf8");

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string) => {
    if (command === "get_status") {
      return { reachable: true, livez_ok: true, ready: false };
    }
    return undefined;
  }),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async () => () => {},
  }),
}));

vi.mock("./tauri", () => ({
  loadSettingsCache: vi.fn(async () => null),
  flushSettingsCache: vi.fn(),
}));

const globalStubs = {
  stubs: {
    "a-config-provider": { template: "<div><slot /></div>" },
    "a-layout": { template: "<section><slot /></section>" },
    "a-layout-sider": { template: "<aside><slot /></aside>" },
    "a-badge": true,
    "a-button": true,
    "a-layout-content": { template: "<main><slot /></main>" },
    Overview: { template: "<div />" },
    InferenceView: { template: "<div />" },
    SettingsView: { template: "<div />" },
  },
};

describe("App 品牌区", () => {
  it("品牌图标与中文标题一行，英文全名在下方且无截断样式", async () => {
    const wrapper = mount(App, { global: globalStubs });
    await flushPromises();
    const brand = wrapper.find(".brand");
    const row = brand.find(".brand-row");
    const subtitle = brand.find(".brand-subtitle");

    expect(brand.find(".brand-mark").exists()).toBe(true);
    expect(row.text()).toContain("可信网关");
    expect(row.text()).not.toContain("Trusted");
    expect(subtitle.text()).toBe("Trusted Network Gateway");
    expect(subtitle.attributes("style")).toBeUndefined();

    await wrapper.unmount();
  });

  it("品牌图标容器使用 4px 圆角", async () => {
    const wrapper = mount(App, { global: globalStubs });
    await flushPromises();
    expect(themeCss).toMatch(/\.brand-mark\s*\{[^}]*border-radius:\s*4px/s);

    await wrapper.unmount();
  });
});
