import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import {
  Form,
  Input,
  InputGroup,
  InputNumber,
} from "ant-design-vue";
import FieldRenderer from "./FieldRenderer.vue";
import { type FieldSpec } from "../formspec";

const globalComponents = {
  components: {
    "a-form": Form,
    "a-form-item": Form.Item,
    "a-input": Input,
    "a-input-group": InputGroup,
    "a-input-number": InputNumber,
  },
};

function mountField(spec: FieldSpec, fields: Record<string, unknown>) {
  return mount(FieldRenderer, {
    props: { spec, fields },
    global: globalComponents,
  });
}

describe("FieldRenderer", () => {
  it("trims leading and trailing whitespace from the http_proxy domain input", async () => {
    const fields: Record<string, unknown> = {
      domain: "",
      port: 443,
    };
    const wrapper = mountField(
      { key: "remote", label: "远端域名端口", type: "domainHostPort", required: true },
      fields,
    );
    const domain = wrapper.find('input[placeholder^="如 https://"]');
    expect(domain.exists()).toBe(true);

    await domain.setValue("  https://Ex ample.com  ");

    // 仅扣首尾空白：中间空格与大小写保持原样。
    expect(fields.domain).toBe("https://Ex ample.com");
  });

  it("does not apply domain trimming to the mapping out host input", async () => {
    const fields: Record<string, unknown> = { host: "", port: 80 };
    const wrapper = mountField(
      { key: "remote", label: "远端地址端口", type: "outHostPort", required: true },
      fields,
    );
    const host = wrapper.find('input[placeholder="远端 IP（按 TNG 约束须为 IP）"]');
    expect(host.exists()).toBe(true);

    await host.setValue(" 10.0.0.1 ");

    expect(fields.host).toBe(" 10.0.0.1 ");
  });
});
