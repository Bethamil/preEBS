<script>
  import { formatHours, parseHours } from "./lib/format.js";

  let { value = 0, label, cell, oncommit, onmove, onfocus = () => {} } = $props();
  let draft = $state(null);
  let invalid = $state(false);

  function shown() {
    return draft === null ? formatHours(value) : draft;
  }

  function commit() {
    if (draft === null) return;
    const parsed = parseHours(draft);
    const text = draft;
    draft = null;
    if (parsed === null) {
      invalid = true;
      return;
    }
    invalid = false;
    if (parsed !== Number(value)) oncommit(parsed, text);
  }

  function onkeydown(event) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter"].includes(event.key)) return;
    commit();
    onmove(event.key);
    event.preventDefault();
  }
</script>

<input
  class="hours"
  class:invalid
  inputmode="decimal"
  autocomplete="off"
  data-cell={cell}
  aria-label={label}
  aria-invalid={invalid}
  placeholder="–"
  value={shown()}
  onfocus={(event) => {
    draft = formatHours(value);
    invalid = false;
    onfocus();
    event.currentTarget.select();
  }}
  oninput={(event) => (draft = event.currentTarget.value)}
  onblur={commit}
  {onkeydown}
/>
