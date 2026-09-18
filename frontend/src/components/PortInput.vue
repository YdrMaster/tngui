<script setup lang="ts">
import { ref, watch } from 'vue';
import { Input } from 'ant-design-vue';
import { isValidPortDraft, nextPortDraft } from '../portInput';

const props = withDefaults(
  defineProps<{
    modelValue: number | null;
    required?: boolean;
    placeholder?: string;
    width?: string;
    disabled?: boolean;
  }>(),
  {
    required: false,
    placeholder: '',
    width: '112px',
    disabled: false,
  },
);

const emit = defineEmits<{
  'update:modelValue': [port: number | null];
}>();

const draft = ref(toDraft(props.modelValue));
const error = ref(props.required && draft.value === '');

function toDraft(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

watch(
  () => props.modelValue,
  (value) => {
    draft.value = toDraft(value);
    error.value = props.required && draft.value === '';
  },
);

function setDraft(value: string): void {
  draft.value = value;
  error.value = props.required && value === '';
  emit('update:modelValue', value === '' ? null : Number(value));
}

function onBeforeinput(event: Event): void {
  const input = event.target as HTMLInputElement;
  const inputEvent = event as InputEvent;
  const candidate = nextPortDraft({
    currentValue: draft.value,
    selectionStart: input.selectionStart ?? draft.value.length,
    selectionEnd: input.selectionEnd ?? input.selectionStart ?? draft.value.length,
    inputType: inputEvent.inputType,
    data: inputEvent.data,
    dataTransferText: inputEvent.dataTransfer?.getData('text/plain') ?? null,
  });

  // Unknown input types are rejected by design; the input layer is a strict
  // allow-list so no browser-specific mutation can bypass port validation.
  if (candidate === null || !isValidPortDraft(candidate)) {
    event.preventDefault();
    error.value = true;
    return;
  }

  // Let the browser commit this valid candidate. Ant Design Vue then emits
  // update:value; do not mutate draft eagerly, or cursor normalization may
  // overwrite native selection behavior.
  error.value = props.required && candidate === '';
}

function onUpdateValue(value: string): void {
  if (value === '') {
    setDraft('');
    return;
  }
  if (!isValidPortDraft(value)) {
    // Safety net for WebView input paths beforeinput does not describe.
    const restored = isValidPortDraft(draft.value) ? draft.value : '';
    if (draft.value !== restored) draft.value = restored;
    error.value = true;
    return;
  }
  setDraft(value);
}
</script>

<template>
  <Input
    :value="draft"
    :placeholder="placeholder"
    :status="error ? 'error' : undefined"
    :disabled="disabled"
    :maxlength="5"
    :aria-invalid="error ? 'true' : undefined"
    type="text"
    inputmode="numeric"
    autocomplete="off"
    autocapitalize="off"
    autocorrect="off"
    spellcheck="false"
    :style="{ width }"
    @beforeinput="onBeforeinput"
    @update:value="onUpdateValue"
  />
</template>
