<script>
  import { api, errorText } from "./lib/api.js";
  import { formatTotal, weekRange } from "./lib/format.js";

  let { reloadToken, onopen, onexport, onnotice } = $props();
  let query = $state("");
  let weeks = $state([]);
  let error = $state("");

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

  async function remove(week) {
    if (!confirm(`Week van ${week.weekStartDate} verwijderen?`)) return;
    try {
      await api.deleteWeek(week.weekStartDate);
      onnotice(`${week.weekStartDate} verwijderd.`);
      await load();
    } catch (caught) {
      onnotice(errorText(caught));
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
            <button type="button" onclick={() => remove(week)}>Verwijder</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>
