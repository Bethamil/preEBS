<script>
  import { save } from "@tauri-apps/plugin-dialog";
  import { api, errorText, inTauri } from "./lib/api.js";
  import { weekRange } from "./lib/format.js";

  let { weekStart, reloadToken, onnotice } = $props();
  let text = $state("");
  let error = $state("");

  async function load() {
    try {
      text = await api.exportWeekText(weekStart);
      error = "";
    } catch (caught) {
      text = "";
      error = errorText(caught);
    }
  }

  $effect(() => {
    weekStart;
    reloadToken;
    void load();
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      onnotice("Copied the export JSON.");
    } catch {
      onnotice("Could not copy. Select the preview and copy it manually.");
    }
  }

  async function saveFile() {
    if (!text || !inTauri()) return;
    try {
      const path = await save({
        defaultPath: `preebs-${weekStart}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      await api.writeExportFile(path, text);
      onnotice(`Wrote ${path}`);
    } catch (caught) {
      onnotice(errorText(caught));
    }
  }
</script>

<section class="screen" aria-labelledby="export-title">
  <div class="toolbar">
    <div>
      <h2 id="export-title">Export</h2>
      <p>{weekRange(weekStart)}. This JSON is what the Chrome and Firefox extensions import. Saving never replaces an existing file.</p>
    </div>
    <div class="toolbar-actions">
      <button type="button" onclick={copy} disabled={!text}>Copy</button>
      <button type="button" onclick={saveFile} disabled={!text}>Save JSON…</button>
    </div>
  </div>
  {#if error}<p class="banner danger" role="alert">{error}</p>{/if}
  <pre aria-label="Week export JSON">{text || "Nothing to export yet."}</pre>
</section>
