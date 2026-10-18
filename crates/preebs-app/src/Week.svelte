<script>
  import { onMount, untrack } from "svelte";
  import HoursCell from "./HoursCell.svelte";
  import { api, errorText } from "./lib/api.js";
  import {
    DAYS,
    addDays,
    formatTotal,
    groupRows,
    halves,
    missingCombos,
    uid,
  } from "./lib/format.js";

  let {
    weekStart,
    reloadToken,
    rangeLabel,
    api: bridge = $bindable(null),
    onnotice,
    onshift,
    ontoday,
  } = $props();

  let config = $state(null);
  let rows = $state([]);
  let customProjects = $state([]);
  let exists = $state(false);
  let dirty = $state(false);
  let stale = $state(false);
  let status = $state("");
  let error = $state("");
  let query = $state("");
  let customName = $state("");
  let highlight = $state(0);
  let loading = $state(true);

  let saveTimer = 0;
  let activeDate = "";
  let request = 0;
  let editVersion = 0;

  let groups = $derived(groupRows(rows, config, customProjects));
  let flat = $derived(groups.flatMap((group) => group.rows));
  let combos = $derived(missingCombos(config, rows));
  let filtered = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    const list = needle
      ? combos.filter((combo) =>
          `${combo.projectLabel} ${combo.projectName} ${combo.taskName} ${combo.hourTypeName}`
            .toLowerCase()
            .includes(needle),
        )
      : combos;
    return list.slice(0, 8);
  });
  let maxHours = $derived(config?.maxHoursPerDay ?? [8, 8, 8, 8, 8]);
  let dayDates = $derived(DAYS.map((_, index) => addDays(weekStart, index)));
  let dayTotals = $derived(DAYS.map((_, day) => rows.reduce((sum, row) => sum + Number(row.hours[day] || 0), 0)));
  let weekTotal = $derived(dayTotals.reduce((sum, value) => sum + value, 0));
  let required = $derived(maxHours.reduce((sum, value) => sum + Number(value), 0));

  function payloadRows() {
    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      projectName: row.projectName,
      taskId: row.taskId,
      taskName: row.taskName,
      hourTypeId: row.hourTypeId,
      hourTypeName: row.hourTypeName,
      hours: row.hours.map((value) => Number(value) || 0),
      note: row.note?.trim() ? row.note : null,
    }));
  }

  function snapshot() {
    return {
      rows: payloadRows(),
      customProjects: customProjects.map((project) => ({ id: project.id, name: project.name })),
    };
  }

  function markDirty() {
    editVersion += 1;
    dirty = true;
    stale = false;
    status = "Unsaved";
    scheduleSave(weekStart, editVersion);
  }

  function scheduleSave(date, version) {
    window.clearTimeout(saveTimer);
    const body = snapshot();
    saveTimer = window.setTimeout(() => {
      void persist(date, body, version);
    }, 500);
  }

  async function persist(date, body, version) {
    status = "Saving…";
    try {
      const week = await api.saveWeek(date, body.rows, body.customProjects);
      if (date === activeDate && version === editVersion) {
        applyWeek(week, config);
        dirty = false;
        stale = false;
        status = "Saved";
      }
      error = "";
    } catch (caught) {
      status = "Not saved";
      error = errorText(caught);
      onnotice(error);
    }
  }

  async function flush() {
    window.clearTimeout(saveTimer);
    if (!dirty || !activeDate) return;
    const version = editVersion;
    const date = activeDate;
    await persist(date, snapshot(), version);
  }

  function applyWeek(week, nextConfig) {
    config = nextConfig ?? config;
    rows = (week.rows ?? []).map((row) => ({
      ...row,
      hours: DAYS.map((_, index) => Number(row.hours?.[index] ?? 0)),
      note: row.note ?? "",
    }));
    customProjects = (week.customProjects ?? []).map((project) => ({ ...project }));
    exists = true;
  }

  async function load(date) {
    const token = ++request;
    loading = rows.length === 0;
    error = "";
    try {
      const view = await api.weekView(date);
      if (token !== request) return;
      config = view.config;
      rows = (view.week.rows ?? []).map((row) => ({
        ...row,
        hours: DAYS.map((_, index) => Number(row.hours?.[index] ?? 0)),
        note: row.note ?? "",
      }));
      customProjects = view.week.customProjects ?? [];
      exists = view.exists;
      dirty = false;
      stale = false;
      status = view.exists ? "Saved" : "Not saved yet";
      activeDate = date;
    } catch (caught) {
      if (token !== request) return;
      error = errorText(caught);
    } finally {
      if (token === request) loading = false;
    }
  }

  $effect(() => {
    const date = weekStart;
    const token = reloadToken;
    untrack(() => {
      void (async () => {
        if (dirty && activeDate && activeDate !== date) await flush();
        if (dirty && token && activeDate === date) {
          stale = true;
          return;
        }
        await load(date);
      })();
    });
  });

  function focusCell(rowIndex, day) {
    const node = document.querySelector(`[data-cell="${rowIndex}-${day}"]`);
    node?.focus();
  }

  function move(rowIndex, day, key) {
    let nextRow = rowIndex;
    let nextDay = day;
    if (key === "ArrowLeft") nextDay -= 1;
    if (key === "ArrowRight") nextDay += 1;
    if (key === "ArrowUp") nextRow -= 1;
    if (key === "ArrowDown" || key === "Enter") nextRow += 1;
    if (nextDay < 0) {
      nextDay = 4;
      nextRow -= 1;
    }
    if (nextDay > 4) {
      nextDay = 0;
      nextRow += 1;
    }
    if (nextRow < 0) nextRow = 0;
    if (nextRow > flat.length - 1) nextRow = Math.max(flat.length - 1, 0);
    focusCell(nextRow, nextDay);
  }

  function setHours(row, day, value) {
    row.hours[day] = value;
    markDirty();
  }

  function addCombo(combo) {
    if (!combo) return;
    rows = [
      ...rows,
      {
        id: uid(),
        projectId: combo.projectId,
        projectName: combo.projectName,
        taskId: combo.taskId,
        taskName: combo.taskName,
        hourTypeId: combo.hourTypeId,
        hourTypeName: combo.hourTypeName,
        hours: [0, 0, 0, 0, 0],
        note: "",
      },
    ];
    query = "";
    highlight = 0;
    markDirty();
    queueMicrotask(() => focusCell(flat.length - 1, 0));
  }

  function addNext() {
    addCombo(combos[0]);
    if (!combos[0]) onnotice("Every configured line is already on this week.");
  }

  function addCustom() {
    const name = customName.trim().replace(/\s+/g, " ");
    if (!name) return;
    const id = `custom-project:${uid()}`;
    customProjects = [...customProjects, { id, name }];
    rows = [
      ...rows,
      {
        id: uid(),
        projectId: id,
        projectName: name,
        taskId: `custom-task:${uid()}`,
        taskName: "Task",
        hourTypeId: `custom-ht:${uid()}`,
        hourTypeName: config?.defaultHourTypeName || "Hours",
        hours: [0, 0, 0, 0, 0],
        note: "",
      },
    ];
    customName = "";
    markDirty();
  }

  function removeRow(row) {
    rows = rows.filter((item) => item.id !== row.id);
    markDirty();
  }

  function removeCustom(project) {
    customProjects = customProjects.filter((item) => item.id !== project.id);
    rows = rows.filter((row) => row.projectId !== project.id);
    markDirty();
  }

  async function copyPrevious() {
    try {
      if (dirty) await flush();
      await api.copyPrevious(weekStart);
      await load(weekStart);
      onnotice(`Copied the previous week into ${weekStart}.`);
    } catch (caught) {
      onnotice(errorText(caught));
    }
  }

  function projectDayTotal(group, day) {
    return group.rows.reduce((sum, row) => sum + Number(row.hours[day] || 0), 0);
  }

  function over(value, max) {
    return halves(value) > halves(max);
  }

  onMount(() => {
    bridge = { copyPrevious, addNext };
    return () => {
      bridge = null;
      void flush();
    };
  });
</script>

<section class="screen" aria-labelledby="week-title">
  <div class="toolbar">
    <div class="week-nav">
      <button type="button" onclick={() => onshift(-1)} aria-label="Previous week">←</button>
      <div>
        <h2 id="week-title">{rangeLabel}</h2>
        <p>{exists ? "Saved week" : "New week"} · {status}</p>
      </div>
      <button type="button" onclick={() => onshift(1)} aria-label="Next week">→</button>
      <button type="button" onclick={ontoday}>Today</button>
    </div>
    <div class="toolbar-actions">
      <button type="button" onclick={copyPrevious}>Copy previous</button>
      <button type="button" onclick={addNext} disabled={!combos.length}>Add next line</button>
    </div>
  </div>

  {#if stale}
    <p class="banner" role="status">
      The database changed in another window.
      <button type="button" onclick={() => { dirty = false; void load(weekStart); }}>Reload</button>
    </p>
  {/if}
  {#if error}
    <p class="banner danger" role="alert">{error}</p>
  {/if}

  <div class="adder">
    <label>
      Add a configured line
      <input
        bind:value={query}
        placeholder={combos.length ? "Project, task, or hour type" : "All configured lines are on this week"}
        aria-autocomplete="list"
        aria-controls="combo-list"
        onkeydown={(event) => {
          if (event.key === "ArrowDown") {
            highlight = Math.min(highlight + 1, filtered.length - 1);
            event.preventDefault();
          } else if (event.key === "ArrowUp") {
            highlight = Math.max(highlight - 1, 0);
            event.preventDefault();
          } else if (event.key === "Enter" && filtered[highlight]) {
            addCombo(filtered[highlight]);
            event.preventDefault();
          }
        }}
      />
    </label>
    {#if query && filtered.length}
      <ul id="combo-list" role="listbox">
        {#each filtered as combo, index (combo.key)}
          <li>
            <button type="button" role="option" aria-selected={index === highlight} class:selected={index === highlight} onclick={() => addCombo(combo)}>
              {combo.projectLabel} / {combo.taskName} / {combo.hourTypeName}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    <form
      onsubmit={(event) => {
        event.preventDefault();
        addCustom();
      }}
    >
      <label>
        Custom project
        <input bind:value={customName} placeholder="Name for this week only" />
      </label>
      <button type="submit">Add</button>
    </form>
  </div>

  {#if loading}
    <p>Loading week…</p>
  {:else if flat.length === 0}
    <p class="empty-week">No lines yet. Add a configured task or a custom project.</p>
  {:else}
    <div class="sheet-wrap">
      <table class="sheet">
        <colgroup>
          <col />
          {#each DAYS as day (day)}<col class="day-col" />{/each}
          <col class="total-col" />
          <col class="action-col" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Project / task</th>
            {#each DAYS as day, index (day)}
              <th scope="col" class:warn={over(dayTotals[index], maxHours[index])}>
                {day}
                <span class="sub">{dayDates[index].slice(8)}</span>
                {#if over(dayTotals[index], maxHours[index])}
                  <span class="sub">{formatTotal(dayTotals[index])} &gt; {formatTotal(maxHours[index])}</span>
                {/if}
              </th>
            {/each}
            <th scope="col">Total</th>
            <th scope="col"><span class="sr">Remove</span></th>
          </tr>
        </thead>
        <tbody>
          {#each groups as group (group.id)}
            <tr class="group">
              <th scope="colgroup" colspan="8">{group.name}</th>
            </tr>
            {#each group.rows as row (row.id)}
              {@const index = flat.indexOf(row)}
              {@const custom = !group.configured}
              <tr>
                <th scope="row">
                  {#if custom}
                    <input aria-label="Task name" bind:value={row.taskName} oninput={markDirty} />
                    <input aria-label="Hour type" bind:value={row.hourTypeName} oninput={markDirty} />
                  {:else}
                    <span class="name">{row.taskName}</span>
                    <span class="sub">{row.hourTypeName}</span>
                  {/if}
                  <input class="note" aria-label={`Note for ${row.taskName}`} placeholder="Note" bind:value={row.note} oninput={markDirty} />
                </th>
                {#each DAYS as day, dayIndex (day)}
                  <td class:warn={over(row.hours[dayIndex], maxHours[dayIndex])}>
                    <HoursCell
                      value={row.hours[dayIndex]}
                      label={`${row.projectName}, ${row.taskName}, ${row.hourTypeName}, ${day} ${dayDates[dayIndex]}`}
                      cell={`${index}-${dayIndex}`}
                      oncommit={(value) => setHours(row, dayIndex, value)}
                      onmove={(key) => move(index, dayIndex, key)}
                    />
                  </td>
                {/each}
                <td class="total">{formatTotal(row.hours.reduce((sum, value) => sum + Number(value), 0))}</td>
                <td>
                  <button type="button" aria-label={`Remove ${row.taskName}`} onclick={() => removeRow(row)}>×</button>
                </td>
              </tr>
            {/each}
            <tr class="subtotal">
              <th scope="row">Project total</th>
              {#each DAYS as day, dayIndex (day)}
                {@const total = projectDayTotal(group, dayIndex)}
                <td class:warn={over(total, maxHours[dayIndex])}>{formatTotal(total)}</td>
              {/each}
              <td class="total">{formatTotal(group.rows.reduce((sum, row) => sum + row.hours.reduce((inner, value) => inner + Number(value), 0), 0))}</td>
              <td>
                {#if !group.configured}
                  <button type="button" onclick={() => removeCustom(group)}>Remove</button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Day total</th>
            {#each dayTotals as total, index (`day-${index}`)}
              <td class:warn={over(total, maxHours[index])}>{formatTotal(total)}</td>
            {/each}
            <td class="total">{formatTotal(weekTotal)}</td>
            <td></td>
          </tr>
          <tr>
            <th scope="row">Daily max</th>
            {#each maxHours as max, index (`max-${index}`)}
              <td>{formatTotal(max)}</td>
            {/each}
            <td class="total">{formatTotal(required)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
    <p class="week-status" class:warn={halves(weekTotal) > halves(required)} class:ok={halves(weekTotal) === halves(required)}>
      Week {formatTotal(weekTotal)} / {formatTotal(required)}
      {#if halves(weekTotal) < halves(required)}under{:else if halves(weekTotal) === halves(required)}match{:else}over{/if}
    </p>
  {/if}
</section>
