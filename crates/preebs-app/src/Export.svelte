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
      onnotice("Export-JSON gekopieerd.");
    } catch {
      onnotice("Kopiëren lukte niet. Selecteer de preview en kopieer handmatig.");
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
      onnotice(`Geschreven naar ${path}`);
    } catch (caught) {
      onnotice(errorText(caught));
    }
  }
</script>

<section class="screen" aria-labelledby="export-title">
  <div class="page-head">
    <div>
      <h1 id="export-title">Exporteer EBS</h1>
      <p class="sub">{weekRange(weekStart)}. Deze JSON importeren de Chrome- en Firefox-extensies. Opslaan vervangt nooit een bestaand bestand.</p>
    </div>
    <div class="head-actions">
      <button type="button" class="btn" onclick={copy} disabled={!text}>Kopieer</button>
      <button type="button" class="btn btn-primary" onclick={saveFile} disabled={!text}>Bewaar JSON…</button>
    </div>
  </div>
  {#if error}<p class="banner danger" role="alert">{error}</p>{/if}
  <pre aria-label="Weekexport JSON">{text || "Nog niets om te exporteren."}</pre>
</section>
