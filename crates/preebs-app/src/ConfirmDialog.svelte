<script>
  let {
    title,
    message,
    confirmLabel = "Verwijderen",
    cancelLabel = "Annuleren",
    danger = true,
    busy = false,
    error = "",
    onconfirm,
    oncancel,
  } = $props();

  const titleId = `confirm-title-${Math.random().toString(36).slice(2, 8)}`;
  const bodyId = `confirm-body-${Math.random().toString(36).slice(2, 8)}`;

  // Updated every render so the key listener always sees the latest callbacks
  // without re-running the focus effect when the parent passes new functions.
  const current = {
    busy: false,
    onconfirm: () => {},
    oncancel: () => {},
  };

  let dialog = $state(null);

  $effect(() => {
    current.busy = busy;
    current.onconfirm = onconfirm;
    current.oncancel = oncancel;
  });

  function focusable() {
    if (!dialog) return [];
    return [...dialog.querySelectorAll("button, [href], input, select, textarea")].filter((node) => {
      return node instanceof HTMLElement && !node.hasAttribute("disabled") && node.tabIndex >= 0;
    });
  }

  $effect(() => {
    const node = dialog;
    if (!node) return;

    function onKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!current.busy) current.oncancel();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        if (!current.busy) current.onconfirm();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        node.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const outside = !node.contains(active);
      if (event.shiftKey) {
        if (active === first || outside) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || outside) {
        event.preventDefault();
        first.focus();
      }
    }

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const items = focusable();
    (items[0] ?? node).focus();
    window.addEventListener("keydown", onKeydown, true);
    return () => {
      window.removeEventListener("keydown", onKeydown, true);
      if (previous && document.contains(previous)) previous.focus();
    };
  });
</script>

<div class="modal-backdrop confirm-layer">
  <button
    type="button"
    class="backdrop-dismiss"
    aria-label={cancelLabel}
    onclick={() => {
      if (!busy) oncancel();
    }}
  ></button>
  <div
    class="modal"
    bind:this={dialog}
    role="alertdialog"
    aria-modal="true"
    aria-labelledby={titleId}
    aria-describedby={bodyId}
    tabindex="-1"
  >
    <h2 id={titleId}>{title}</h2>
    <p id={bodyId}>{message}</p>
    {#if error}<p class="banner danger" role="alert">{error}</p>{/if}
    <div class="modal-actions">
      <button type="button" class="btn" onclick={() => oncancel()} disabled={busy}>{cancelLabel}</button>
      <button type="button" class="btn {danger ? 'btn-danger' : 'btn-primary'}" onclick={() => onconfirm()} disabled={busy}>{confirmLabel}</button>
    </div>
  </div>
</div>
