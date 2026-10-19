<script>
  import { onMount, untrack } from "svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import HoursCell from "./HoursCell.svelte";
  import { api, errorText } from "./lib/api.js";
  import {
    addDays,
    dayHeading,
    displayProject,
    displayTask,
    formatTotal,
    groupRows,
    halves,
    iso,
    isoWeekNumber,
    mondayOf,
    missingCombos,
    uid,
    weekSubtitle,
  } from "./lib/format.js";

  let {
    weekStart,
    reloadToken,
    api: bridge = $bindable(null),
    onnotice,
    onshift,
    oncurrent,
    onexport,
  } = $props();

  const DOTS = ["#4ade80", "#c084fc", "#94a3b8", "#60a5fa", "#fbbf24", "#fb7185"];

  let config = $state(null);
  let rows = $state([]);
  let customProjects = $state([]);
  let exists = $state(false);
  let dirty = $state(false);
  let stale = $state(false);
  let status = $state("");
  let error = $state("");
  let customName = $state("");
  let customOpen = $state(false);
  let loading = $state(true);
  let menuId = $state(null);
  let picker = $state(null);
  let pendingDelete = $state(null);
  let focusDay = $state(-1);

  let saveTimer = 0;
  let activeDate = "";
  let request = 0;
  let editVersion = 0;

  let grouped = $derived(groupRows(rows, config, customProjects));
  let cards = $derived.by(() => {
    const seen = new Set(grouped.map((group) => group.id));
    const extras = [];
    for (const project of config?.projects ?? []) {
      if (project.archived || seen.has(project.id) || !project.tasks?.length) continue;
      extras.push({
        id: project.id,
        name: displayProject(project),
        configured: true,
        rows: [],
      });
    }
    return [...grouped, ...extras].map((group, index) => ({
      ...group,
      dot: DOTS[index % DOTS.length],
    }));
  });
  let flat = $derived(cards.flatMap((group) => group.rows));
  let combos = $derived(missingCombos(config, rows));
  let maxHours = $derived(config?.maxHoursPerDay ?? [8, 8, 8, 8, 8]);
  let dayDates = $derived([0, 1, 2, 3, 4].map((index) => addDays(weekStart, index)));
  let todayIndex = $derived(dayDates.indexOf(iso(new Date())));
  let shadeIndex = $derived(todayIndex >= 0 ? todayIndex : focusDay);
  let dayTotals = $derived([0, 1, 2, 3, 4].map((day) => rows.reduce((sum, row) => sum + Number(row.hours[day] || 0), 0)));
  let weekTotal = $derived(dayTotals.reduce((sum, value) => sum + value, 0));
  let required = $derived(maxHours.reduce((sum, value) => sum + Number(value), 0));
  let title = $derived(`Week ${isoWeekNumber(weekStart)}`);
  let subtitle = $derived(weekSubtitle(weekStart));

  function visibleTaskName(row) {
    const project = config?.projects?.find((item) => item.id === row.projectId);
    const task = project?.tasks?.find((item) => item.id === row.taskId);
    return displayTask(task, row.taskName);
  }

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
    status = "Niet opgeslagen";
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
    status = "Opslaan…";
    try {
      const week = await api.saveWeek(date, body.rows, body.customProjects);
      if (date === activeDate && version === editVersion) {
        applyWeek(week, config);
        dirty = false;
        stale = false;
        status = "Alles opgeslagen";
      }
      error = "";
    } catch (caught) {
      status = "Niet opgeslagen";
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
      hours: [0, 1, 2, 3, 4].map((index) => Number(row.hours?.[index] ?? 0)),
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
        hours: [0, 1, 2, 3, 4].map((index) => Number(row.hours?.[index] ?? 0)),
        note: row.note ?? "",
      }));
      customProjects = view.week.customProjects ?? [];
      exists = view.exists;
      dirty = false;
      stale = false;
      status = "Alles opgeslagen";
      activeDate = date;
    } catch (caught) {
      if (token !== request) return;
      error = errorText(caught);
      status = "Niet opgeslagen";
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
        menuId = null;
        picker = null;
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
    focusDay = nextDay;
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
    picker = null;
    markDirty();
    queueMicrotask(() => focusCell(Math.max(flat.length - 1, 0), 0));
  }

  function addNext() {
    if (!combos[0]) {
      onnotice("Alle geconfigureerde regels staan al op deze week.");
      return;
    }
    addCombo(combos[0]);
  }

  function optionsFor(projectId) {
    return combos.filter((combo) => combo.projectId === projectId);
  }

  function addCustomTask(group) {
    rows = [
      ...rows,
      {
        id: uid(),
        projectId: group.id,
        projectName: group.name,
        taskId: `custom-task:${uid()}`,
        taskName: "Taak",
        hourTypeId: `custom-ht:${uid()}`,
        hourTypeName: config?.defaultHourTypeName || "Uren",
        hours: [0, 0, 0, 0, 0],
        note: "",
      },
    ];
    markDirty();
  }

  function addRow(group) {
    const options = optionsFor(group.id);
    if (options.length === 1) {
      addCombo(options[0]);
      return;
    }
    if (options.length > 1) {
      picker = picker === group.id ? null : group.id;
      menuId = null;
      return;
    }
    if (!group.configured) {
      addCustomTask(group);
      return;
    }
    onnotice("Alle geconfigureerde regels staan al op deze week.");
  }

  function addCustomProject() {
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
        taskName: "Taak",
        hourTypeId: `custom-ht:${uid()}`,
        hourTypeName: config?.defaultHourTypeName || "Uren",
        hours: [0, 0, 0, 0, 0],
        note: "",
      },
    ];
    customName = "";
    customOpen = false;
    markDirty();
  }

  function removeRow(row) {
    rows = rows.filter((item) => item.id !== row.id);
    menuId = null;
    markDirty();
  }

  function removeCustom(project) {
    customProjects = customProjects.filter((item) => item.id !== project.id);
    rows = rows.filter((row) => row.projectId !== project.id);
    menuId = null;
    markDirty();
  }

  function askRemoveRow(row) {
    menuId = null;
    picker = null;
    pendingDelete = { kind: "row", name: visibleTaskName(row), row };
  }

  function askRemoveCustom(group) {
    menuId = null;
    picker = null;
    pendingDelete = { kind: "project", name: group.name, id: group.id };
  }

  function confirmPendingDelete() {
    const pending = pendingDelete;
    pendingDelete = null;
    if (!pending) return;
    if (pending.kind === "row") removeRow(pending.row);
    else removeCustom({ id: pending.id });
  }

  async function copyPrevious() {
    try {
      if (dirty) await flush();
      await api.copyPrevious(weekStart);
      await load(weekStart);
      onnotice(`Vorige week gekopieerd naar ${weekStart}.`);
    } catch (caught) {
      onnotice(errorText(caught));
    }
  }

  function projectTotal(group) {
    return group.rows.reduce((sum, row) => sum + row.hours.reduce((inner, value) => inner + Number(value), 0), 0);
  }

  function rowTotal(row) {
    return row.hours.reduce((sum, value) => sum + Number(value), 0);
  }

  function over(value, max) {
    return halves(value) > halves(max);
  }

  function showType(group, row) {
    return group.rows.filter((item) => item.taskId === row.taskId).length > 1;
  }

  function amount(value) {
    return Number(value) ? formatTotal(value) : "–";
  }

  onMount(() => {
    bridge = { copyPrevious, addNext };
    const close = (event) => {
      if (event.key === "Escape") {
        menuId = null;
        picker = null;
      }
    };
    window.addEventListener("keydown", close);
    return () => {
      bridge = null;
      window.removeEventListener("keydown", close);
      void flush();
    };
  });
</script>

<section class="screen" aria-labelledby="week-title">
  <div class="page-head">
    <div>
      <h1 id="week-title">{title}</h1>
      <p class="sub">{subtitle}</p>
    </div>
    <div class="head-actions">
      <button type="button" class="btn" onclick={() => onshift(-1)}>
        <span aria-hidden="true">‹</span> Vorige week
      </button>
      {#if weekStart !== mondayOf()}
        <button type="button" class="btn" onclick={oncurrent}>Huidige week</button>
      {/if}
      <button type="button" class="btn" onclick={() => onshift(1)}>
        Volgende week <span aria-hidden="true">›</span>
      </button>
      <span class="sep" aria-hidden="true"></span>
      <button type="button" class="btn" onclick={copyPrevious}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <rect x="8" y="8" width="11" height="11" rx="2" />
          <path d="M5 15V5h10" stroke-linecap="round" />
        </svg>
        Vorige week kopiëren
      </button>
      <button type="button" class="btn btn-primary" onclick={onexport}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path d="M12 16V5M8 8.5 12 4.5 16 8.5" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M5 15.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2.5" stroke-linecap="round" />
        </svg>
        Exporteer EBS
      </button>
    </div>
  </div>

  {#if stale}
    <p class="banner" role="status">
      De database is in een ander venster gewijzigd.
      <button type="button" class="btn" onclick={() => { dirty = false; void load(weekStart); }}>Opnieuw laden</button>
    </p>
  {/if}
  {#if error}
    <p class="banner danger" role="alert">{error}</p>
  {/if}

  {#if loading}
    <p>Week laden…</p>
  {:else}
    <div class="cols colhead" aria-hidden="true">
      <span>Taak</span>
      {#each dayDates as date, index (date)}
        <span class:shade={index === shadeIndex} class:over={over(dayTotals[index], maxHours[index])}>{dayHeading(weekStart, index)}</span>
      {/each}
      <span style="text-align: right">Totaal</span>
    </div>

    {#if cards.length === 0}
      <p class="sub">Nog geen regels. Voeg een project toe bij Instellingen, of maak een aangepast project voor deze week.</p>
    {/if}

    {#each cards as group (group.id)}
      <section class="card project-card" aria-label={group.name}>
        <div class="cols project-line">
          <div class="project-name">
            <span class="dot" style="background: {group.dot}"></span>
            {group.name}
          </div>
          <div class="project-total">{formatTotal(projectTotal(group))} uur</div>
        </div>
        {#each group.rows as row (row.id)}
          {@const index = flat.indexOf(row)}
          <div class="cols task-line">
            <div class="task-label">
              <div style="min-width: 0">
                <span class="task-name">{visibleTaskName(row)}</span>
                {#if showType(group, row)}
                  <span class="task-meta">{row.hourTypeName}</span>
                {/if}
                {#if row.note}
                  <span class="task-meta">{row.note}</span>
                {/if}
              </div>
              <button
                type="button"
                class="more"
                aria-label={`Opties voor ${row.taskName}`}
                aria-expanded={menuId === row.id}
                onclick={() => {
                  menuId = menuId === row.id ? null : row.id;
                  picker = null;
                }}
              >…</button>
              {#if menuId === row.id}
                <div class="menu" role="menu">
                  {#if !group.configured}
                    <label>
                      Taak
                      <input bind:value={row.taskName} oninput={markDirty} />
                    </label>
                    <label>
                      Uurtype
                      <input bind:value={row.hourTypeName} oninput={markDirty} />
                    </label>
                  {:else}
                    <p class="task-meta" style="padding: 0.2rem 0.45rem">{row.hourTypeName}</p>
                  {/if}
                  <label>
                    Notitie
                    <input aria-label={`Notitie voor ${row.taskName}`} bind:value={row.note} oninput={markDirty} />
                  </label>
                  <button type="button" class="menu-item menu-danger" role="menuitem" onclick={() => askRemoveRow(row)}>Rij verwijderen</button>
                  {#if !group.configured && group.rows[0]?.id === row.id}
                    <button type="button" class="menu-item menu-danger" role="menuitem" onclick={() => askRemoveCustom(group)}>Project verwijderen</button>
                  {/if}
                </div>
              {/if}
            </div>
            {#each dayDates as date, dayIndex (date)}
              <div class="hours-wrap" class:shade={dayIndex === shadeIndex}>
                <HoursCell
                  value={row.hours[dayIndex]}
                  label={`${row.projectName}, ${row.taskName}, ${row.hourTypeName}, ${dayHeading(weekStart, dayIndex)}`}
                  cell={`${index}-${dayIndex}`}
                  oncommit={(value) => setHours(row, dayIndex, value)}
                  onmove={(key) => move(index, dayIndex, key)}
                  onfocus={() => (focusDay = dayIndex)}
                />
              </div>
            {/each}
            <div class="row-total" class:zero={!rowTotal(row)}>{amount(rowTotal(row))}</div>
          </div>
        {/each}
        <div class="add-slot">
          <button type="button" class="add-row" onclick={() => addRow(group)}>
            <span aria-hidden="true">+</span> Rij toevoegen
          </button>
          {#if picker === group.id}
            <div class="picker" role="listbox" aria-label="Regel kiezen">
              {#each optionsFor(group.id) as combo (combo.key)}
                <button type="button" onclick={() => addCombo(combo)}>
                  {combo.displayName || combo.taskName}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </section>
    {/each}

    {#if customOpen}
      <form
        class="custom-add"
        onsubmit={(event) => {
          event.preventDefault();
          addCustomProject();
        }}
      >
        <input bind:value={customName} placeholder="Naam voor deze week" aria-label="Aangepast project" />
        <button type="submit" class="btn">Toevoegen</button>
      </form>
    {:else}
      <button type="button" class="add-row" onclick={() => (customOpen = true)}>+ Aangepast project</button>
    {/if}

    <section class="card project-card" aria-label="Totaal per dag">
      <div class="cols">
        <div class="totals-label">Totaal per dag</div>
        {#each dayTotals as total, index (`total-${index}`)}
          <div class="day-total" class:shade={index === shadeIndex} class:over={over(total, maxHours[index])} class:zero={!total}>
            {amount(total)}
          </div>
        {/each}
        <div class="week-total">{formatTotal(weekTotal)} / {formatTotal(required)} uur</div>
      </div>
    </section>

    {#if pendingDelete}
      <ConfirmDialog
        title={pendingDelete.kind === "row" ? "Rij verwijderen" : "Project verwijderen"}
        message={pendingDelete.kind === "row"
          ? `${pendingDelete.name} verdwijnt uit deze week, inclusief de uren op deze regel.`
          : `${pendingDelete.name} en de regels van dit aangepaste project verdwijnen uit deze week. De configuratie blijft staan.`}
        confirmLabel="Verwijderen"
        danger
        onconfirm={confirmPendingDelete}
        oncancel={() => (pendingDelete = null)}
      />
    {/if}

    <p class="save-line" class:warn={dirty && !error} class:bad={Boolean(error)} role="status">
      {#if !dirty && !error}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12.2 2.4 2.4L16.2 9" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      {/if}
      {error && status === "Niet opgeslagen" ? "Niet opgeslagen" : status || (exists ? "Alles opgeslagen" : "Alles opgeslagen")}
    </p>
  {/if}
</section>
