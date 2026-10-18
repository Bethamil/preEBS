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
    if (!confirm(`Delete the week of ${week.weekStartDate}?`)) return;
    try {
      await api.deleteWeek(week.weekStartDate);
      onnotice(`Deleted ${week.weekStartDate}.`);
      await load();
    } catch (caught) {
      onnotice(errorText(caught));
    }
  }
</script>

<section class="screen" aria-labelledby="weeks-title">
  <div class="toolbar">
    <div>
      <h2 id="weeks-title">Weeks</h2>
      <p>Newest Monday first. Status compares the week total with the daily maxima.</p>
    </div>
  </div>
  <label>
    Search weeks
    <input bind:value={query} placeholder="Date, project, task, or hour type" />
  </label>
  {#if error}<p class="banner danger" role="alert">{error}</p>{/if}
  {#if weeks.length === 0}
    <p>No saved weeks.</p>
  {:else}
    <ul class="week-list">
      {#each weeks as week (week.weekStartDate)}
        <li>
          <div>
            <strong>{weekRange(week.weekStartDate)}</strong>
            <span class="sub">{week.weekStartDate}</span>
          </div>
          <span class="pill {week.hoursStatus}">
            {formatTotal(week.totalHours)} / {formatTotal(week.requiredHours)} {week.hoursStatus}
          </span>
          <div class="row-actions">
            <button type="button" onclick={() => onopen(week.weekStartDate)}>Open</button>
            <button type="button" onclick={() => onexport(week.weekStartDate)}>Export</button>
            <button type="button" onclick={() => remove(week)}>Delete</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>
