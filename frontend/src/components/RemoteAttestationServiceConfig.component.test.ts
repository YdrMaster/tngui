import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { Card, Form, Input } from "ant-design-vue";
import RemoteAttestationServiceConfig from "./RemoteAttestationServiceConfig.vue";

const globalComponents = {
  components: {
    "a-card": Card,
    "a-form": Form,
    "a-form-item": Form.Item,
    "a-input": Input,
  },
};

describe("RemoteAttestationServiceConfig", () => {
  it("仅在 RA 开启时显示标题与输入框", () => {
    const visible = mount(RemoteAttestationServiceConfig, {
      props: { visible: true, value: "https://private-rvs.example.com:8443" },
      global: globalComponents,
    });
    expect(visible.text()).toContain("远程证明服务配置");
    expect(visible.text()).toContain("RVS 地址");
    expect((visible.find("input").element as HTMLInputElement).value).toBe(
      "https://private-rvs.example.com:8443",
    );

    const hidden = mount(RemoteAttestationServiceConfig, {
      props: { visible: false, value: "https://private-rvs.example.com:8443" },
      global: globalComponents,
    });
    expect(hidden.text()).not.toContain("远程证明服务配置");
    expect(hidden.find("input").exists()).toBe(false);
  });

  it("输入值与配置模型保持双向同步", async () => {
    const wrapper = mount(RemoteAttestationServiceConfig, {
      props: { visible: true, value: "https://rvs.tsk.com:9443" },
      global: globalComponents,
    });
    await wrapper.find("input").setValue("https://private-rvs.example.com:8443");
    expect(wrapper.emitted("update:value")?.at(-1)).toEqual([
      "https://private-rvs.example.com:8443",
    ]);
    await wrapper.setProps({ value: "https://another-rvs.example.com:9443" });
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe(
      "https://another-rvs.example.com:9443",
    );
  });
});
