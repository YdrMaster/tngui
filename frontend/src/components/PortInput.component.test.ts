import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import PortInput from './PortInput.vue';

type InputEventInitWithPort = InputEventInit & { inputType?: string };

function fireBeforeInput(
  input: HTMLInputElement,
  init: InputEventInitWithPort,
): Event {
  const event = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  input.dispatchEvent(event);
  return event;
}

function getInputElement(wrapper: ReturnType<typeof mount>): HTMLInputElement {
  return wrapper.find('input').element as HTMLInputElement;
}

describe('PortInput', () => {
  it('renders a strict numeric text input', () => {
    const wrapper = mount(PortInput, {
      props: { modelValue: 443 },
    });
    const input = getInputElement(wrapper);

    expect(input.type).toBe('text');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('maxlength')).toBe('5');
    expect(input.value).toBe('443');
  });

  it('marks an empty required port as an error but not an optional port', () => {
    const required = mount(PortInput, {
      props: { modelValue: null, required: true },
    });
    const optional = mount(PortInput, {
      props: { modelValue: null, required: false },
    });

    expect(required.find('input').classes()).toContain('ant-input-status-error');
    expect(optional.find('input').classes()).not.toContain('ant-input-status-error');
    expect(getInputElement(required).value).toBe('');
    expect(getInputElement(optional).value).toBe('');
  });

  it('accepts a valid port and clears the error state', async () => {
    const wrapper = mount(PortInput, {
      props: { modelValue: null, required: true },
    });
    const input = wrapper.find('input');

    await input.setValue('443');

    expect(getInputElement(wrapper).value).toBe('443');
    expect(input.classes()).not.toContain('ant-input-status-error');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([443]);
  });

  it('rejects 0 at the empty caret before it reaches the control', async () => {
    const wrapper = mount(PortInput, {
      props: { modelValue: null },
    });
    const input = getInputElement(wrapper);

    const event = fireBeforeInput(input, {
      inputType: 'insertText',
      data: '0',
    });
    await nextTick();

    expect(event.defaultPrevented).toBe(true);
    expect(input.value).toBe('');
    expect(wrapper.find('input').classes()).toContain('ant-input-status-error');
  });

  it('rejects overflow and invalid paste while keeping the previous text', async () => {
    const wrapper = mount(PortInput, {
      props: { modelValue: 443 },
    });
    const input = getInputElement(wrapper);

    input.setSelectionRange(3, 3);
    const overflow = fireBeforeInput(input, {
      inputType: 'insertFromPaste',
      data: '65536',
    });
    await nextTick();
    expect(overflow.defaultPrevented).toBe(true);
    expect(input.value).toBe('443');
    expect(wrapper.find('input').classes()).toContain('ant-input-status-error');

    input.setSelectionRange(0, 3);
    const invalidText = fireBeforeInput(input, {
      inputType: 'insertFromDrop',
      data: '12.5',
    });
    await nextTick();
    expect(invalidText.defaultPrevented).toBe(true);
    expect(input.value).toBe('443');
  });

  it('allows a valid selected-range paste', () => {
    const wrapper = mount(PortInput, {
      props: { modelValue: 1 },
    });
    const input = getInputElement(wrapper);

    input.setSelectionRange(0, 1);
    const event = fireBeforeInput(input, {
      inputType: 'insertFromPaste',
      data: '65535',
    });

    expect(event.defaultPrevented).toBe(false);
    expect(input.value).toBe('1');
  });

  it('keeps the required-empty error state after blur', async () => {
    const wrapper = mount(PortInput, {
      props: { modelValue: null, required: true },
    });
    const input = wrapper.find('input');

    await input.trigger('blur');

    expect(input.classes()).toContain('ant-input-status-error');
    expect(getInputElement(wrapper).value).toBe('');
  });

  it('flags a required empty draft after the user clears it', async () => {
    const wrapper = mount(PortInput, {
      props: { modelValue: 443, required: true },
    });
    const input = wrapper.find('input');

    await input.setValue('');

    expect(input.classes()).toContain('ant-input-status-error');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([null]);
  });
});
