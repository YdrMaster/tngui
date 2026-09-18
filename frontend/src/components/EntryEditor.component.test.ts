import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import {
  Button,
  Card,
  Form,
  Input,
  InputGroup,
  InputNumber,
  Select,
  Switch,
} from "ant-design-vue";
import EntryEditor from "./EntryEditor.vue";
import { DEFAULT_HTTP_PROXY_DOMAIN, defaultModel } from "../formspec";

const globalComponents = {
  components: {
    "a-button": Button,
    "a-card": Card,
    "a-form": Form,
    "a-form-item": Form.Item,
    "a-input": Input,
    "a-input-group": InputGroup,
    "a-input-number": InputNumber,
    "a-select": Select,
    "a-switch": Switch,
  },
};

function mountEditor(props: Record<string, unknown> = {}) {
  const entry = defaultModel().ingress;
  const wrapper = mount(EntryEditor, {
    props: { entry, ...props },
    global: globalComponents,
  });
  return { wrapper, entry };
}

describe("EntryEditor", () => {
  it("默认渲染中文域名代理选项与常用默认值", () => {
    const { wrapper } = mountEditor();
    const select = wrapper.getComponent(Select);

    expect(select.props("options")).toEqual([
      { value: "mapping", label: "端点映射" },
      { value: "http_proxy", label: "域名代理" },
    ]);
    expect(select.props("value")).toBe("http_proxy");
    expect((wrapper.find('input[placeholder^="如 https://"]').element as HTMLInputElement).value)
      .toBe(DEFAULT_HTTP_PROXY_DOMAIN);
    expect((wrapper.find('input[placeholder="远端端口（可留空）"]').element as HTMLInputElement).value)
      .toBe("443");
    expect(wrapper.text()).not.toContain("mapping");
    expect(wrapper.text()).not.toContain("http_proxy");
  });

  it("远程证明开关位于 ingress 标题行且不渲染 verify 输入框或删除动作", () => {
    const { wrapper } = mountEditor();
    const extra = wrapper.find(".ant-card-extra");

    expect(extra.text()).toContain("远程证明");
    expect(extra.find(".ant-switch").exists()).toBe(true);
    expect(extra.text()).not.toContain("删除");
    expect(wrapper.text()).not.toContain("verify.model");
    expect(wrapper.text()).not.toContain("verify.as_provider");
  });

  it("标题行开关切换 no_ra，内容区不出现独立远程证明行", async () => {
    const { wrapper, entry } = mountEditor();
    const raSwitch = wrapper.find('.ant-card-extra .ant-switch');

    await raSwitch.trigger("click");
    await nextTick();

    expect(entry.no_ra).toBe(true);
    expect(wrapper.findAll(".ant-form-item").map((item) => item.text()))
      .not.toContain("远程证明");
  });

  it("切换远端类型即时重置为对应默认字段且无确认弹窗", async () => {
    const { wrapper, entry } = mountEditor();
    const select = wrapper.getComponent(Select);

    select.vm.$emit("update:value", "mapping");
    await nextTick();

    expect(entry.mode).toBe("mapping");
    expect((entry.fields.rules as Array<{ out: { host: string; port: number } }>)[0].out)
      .toEqual({ host: "", port: 80 });
    expect(wrapper.find('input[placeholder="远端 IP（按 TNG 约束须为 IP）"]').exists())
      .toBe(true);
  });

  it("锁定时远程证明、远端类型、本机绑定和远端字段不可交互", () => {
    const { wrapper } = mountEditor({ disabled: true });
    const raSwitch = wrapper.find('[aria-label="远程证明"]');
    const select = wrapper.getComponent(Select);
    const domain = wrapper.find('input[placeholder^="如 https://"]');
    const port = wrapper.find('input[placeholder="端口（必填）"]');

    expect(raSwitch.classes()).toContain("ant-switch-disabled");
    expect(select.props("disabled")).toBe(true);
    expect((domain.element as HTMLInputElement).disabled).toBe(true);
    expect((port.element as HTMLInputElement).disabled).toBe(true);
  });

  it("解锁后控件恢复可交互", () => {
    const { wrapper } = mountEditor({ disabled: false });
    const raSwitch = wrapper.find('[aria-label="远程证明"]');
    const domain = wrapper.find('input[placeholder^="如 https://"]');

    expect(raSwitch.classes()).not.toContain("ant-switch-disabled");
    expect((domain.element as HTMLInputElement).disabled).toBe(false);
  });
});
