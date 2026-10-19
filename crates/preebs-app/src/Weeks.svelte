<script>
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import { api, errorText } from "./lib/api.js";
  import { formatTotal, weekRange } from "./lib/format.js";

  let { reloadToken, onopen, onexport, onnotice } = $props();
  let query = $state("");
  let weeks = $state([]);
  let error = $state("");
  let pendingWeek = $state(null);
  let deleteError = $state("");
  let deleting = $state(false);

  async function load() {
    try {
      weeks = await api.listWeeks(query);
      error = "";
    } catch (caught) {
      error = errorText(caught);
    }
  }

  $effect(() => {
    query;
    reloadToken;
    const handle = window.setTimeout(() => void load(), 150);
    return () => window.clearTimeout(handle);
  });

  function askRemove(week) {
    deleteError = "";
    pendingWeek = week;
  }

  async function confirmRemove() {
    if (!pendingWeek || deleting) return;
    const week = pendingWeek;
    deleting = true;
    deleteError = "";
    try {
      await api.deleteWeek(week.weekStartDate);
      pendingWeek = null;
      onnotice(`${week.weekStartDate} verwijderd.`);
      await load();
    } catch (caught) {
      deleteError = errorText(caught);
    } finally {
      deleting = false;
    }
  }
</script>

<section class="screen" aria-labelledby="weeks-title">
  <div class="page-head">
    <div>
      <h1 id="weeks-title">Weken</h1>
      <p class="sub">Nieuwste maandag eerst. De status vergelijkt het weektotaal met de dagmaxima.</p>
    </div>
  </div>
  <label>
    Weken zoeken
    <input bind:value={query} placeholder="Datum, project, taak of uurtype" />
  </label>
  {#if error}<p class="banner danger" role="alert">{error}</p>{/if}
  {#if weeks.length === 0}
    <p>Geen opgeslagen weken.</p>
  {:else}
    <ul class="week-list">
      {#each weeks as week (week.weekStartDate)}
        <li>
          <div>
            <strong>{weekRange(week.weekStartDate)}</strong>
            <span class="sub">{week.weekStartDate}</span>
          </div>
          <span class="pill {week.hoursStatus}">
            {formatTotal(week.totalHours)} / {formatTotal(week.requiredHours)} {week.hoursStatus === "match" ? "gelijk" : week.hoursStatus === "over" ? "over" : "onder"}
          </span>
          <div class="row-actions">
            <button type="button" onclick={() => onopen(week.weekStartDate)}>Open</button>
            <button type="button" onclick={() => onexport(week.weekStartDate)}>Exporteer</button>
            <button type="button" onclick={() => askRemove(week)}>Verwijder</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

{#if pendingWeek}
  <ConfirmDialog
    title="Week verwijderen"
    message={`De week van ${weekRange(pendingWeek.weekStartDate)} (${pendingWeek.weekStartDate}) wordt verwijderd, inclusief de geboekte uren.`}
    confirmLabel="Verwijderen"
    danger
    busy={deleting}
    error={deleteError}
    onconfirm={confirmRemove}
    oncancel={() => {
      if (!deleting) pendingWeek = null;
    }}
  />
{/if}
