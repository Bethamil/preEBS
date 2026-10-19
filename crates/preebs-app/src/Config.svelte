<script>
  import { open, save } from "@tauri-apps/plugin-dialog";
  import { api, errorText, inTauri } from "./lib/api.js";
  import { DAYS, collapse, displayProject, displayTask, formatHours, newHourType, parseHours, uid } from "./lib/format.js";

  let { reloadToken, dbPath = "", onnotice } = $props();

  const DOTS = ["#4ade80", "#c084fc", "#94a3b8", "#60a5fa", "#fbbf24", "#fb7185"];

  let config = $state(null);
  let tab = $state("projects");
  let query = $state("");
  let showArchived = $state(false);
  let selectedId = $state("");
  let menuOpen = $state(false);
  let editor = $state(null);
  let editorError = $state("");
  let confirmDelete = $state(false);
  let confirmError = $state("");
  let removing = $state(false);
  let error = $state("");
  let status = $state("Alles opgeslagen");
  let dirty = $state(false);

  let saveTimer = 0;
  let editVersion = 0;
  let saveChain = Promise.resolve();
  let nameInput = $state(null);

  let visibleProjects = $derived.by(() => {
    if (!config) return [];
    const needle = query.trim().toLowerCase();
    return config.projects.filter((project) => {
      if (project.archived && !showArchived) return false;
      if (!needle) return true;
      const hay = [
        project.name,
        project.label,
        ...project.tasks.flatMap((task) => [task.name, task.label, task.hourTypes?.[0]?.name]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  });

  let selected = $derived(config?.projects?.find((project) => project.id === selectedId) ?? null);

  let confirmText = $derived.by(() => {
    const task = selected?.tasks?.find((item) => item.id === editor?.taskId);
    const name = displayTask(task, editor?.name || "");
    return `${name} verdwijnt uit de configuratie. Uren die al op deze taak in weken zijn geboekt blijven staan.`;
  });

  let hourChoices = $derived.by(() => {
    const names = [];
    const seen = new Set();
    const add = (name) => {
      const trimmed = collapse(name);
      const key = trimmed.toLowerCase();
      if (!trimmed || seen.has(key)) return;
      seen.add(key);
      names.push(trimmed);
    };
    add(config?.defaultHourTypeName || "Straight Time");
    for (const project of config?.projects ?? []) {
      for (const task of project.tasks) add(task.hourTypes?.[0]?.name);
    }
    if (editor?.hourTypeName) add(editor.hourTypeName);
    return names;
  });

  function taskCount(project) {
    const count = project.tasks.length;
    return count === 1 ? "1 taak" : `${count} taken`;
  }

  function dot(project) {
    const index = config?.projects?.findIndex((item) => item.id === project.id) ?? 0;
    return DOTS[(index < 0 ? 0 : index) % DOTS.length];
  }

  function specialType(name) {
    const fallback = collapse(config?.defaultHourTypeName || "Straight Time").toLowerCase();
    return collapse(name).toLowerCase() !== fallback;
  }

  async function load() {
    try {
      config = await api.getConfig();
      error = "";
      if (!config.projects.some((project) => project.id === selectedId)) {
        selectedId = config.projects.find((project) => !project.archived)?.id ?? config.projects[0]?.id ?? "";
      }
    } catch (caught) {
      error = errorText(caught);
    }
  }

  $effect(() => {
    reloadToken;
    void load();
  });

  $effect(() => {
    if (editor && nameInput) nameInput.focus();
  });

  function markDirty() {
    editVersion += 1;
    const version = editVersion;
    dirty = true;
    status = "Niet opgeslagen";
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      void persist(version);
    }, 450);
  }

  async function persist(version) {
    if (!config) return false;
    const body = JSON.parse(JSON.stringify(config));
    status = "Opslaan…";
    const flight = saveChain.then(async () => {
      try {
        const saved = await api.saveConfig(body);
        if (version === editVersion) {
          config = saved;
          dirty = false;
          status = "Alles opgeslagen";
          error = "";
        }
        return true;
      } catch (caught) {
        if (version === editVersion) {
          status = "Niet opgeslagen";
          error = errorText(caught);
        }
        return false;
      }
    });
    saveChain = flight.then(() => {}, () => {});
    return flight;
  }

  function addProject() {
    const project = {
      id: uid(),
      name: "Nieuw project",
      label: null,
      archived: false,
      tasks: [],
    };
    config.projects = [...config.projects, project];
    selectedId = project.id;
    menuOpen = false;
    markDirty();
  }

  function moveProject(delta) {
    if (!selected) return;
    const index = config.projects.findIndex((project) => project.id === selected.id);
    const next = index + delta;
    if (next < 0 || next >= config.projects.length) return;
    const copy = [...config.projects];
    const [item] = copy.splice(index, 1);
    copy.splice(next, 0, item);
    config.projects = copy;
    menuOpen = false;
    markDirty();
  }

  function toggleArchive() {
    if (!selected) return;
    selected.archived = !selected.archived;
    menuOpen = false;
    markDirty();
  }

  function removeProject() {
    if (!selected) return;
    config.projects = config.projects.filter((project) => project.id !== selected.id);
    selectedId = visibleProjects.find((project) => project.id !== selected.id)?.id ?? "";
    menuOpen = false;
    markDirty();
  }

  function openEditor(task = null) {
    const hour = task?.hourTypes?.[0];
    editorError = "";
    confirmDelete = false;
    confirmError = "";
    editor = {
      taskId: task?.id ?? null,
      name: task?.name ?? "",
      label: task?.label ?? "",
      hourTypeName: hour?.name || config.defaultHourTypeName || "Straight Time",
      hourTypeId: hour?.id ?? "",
      useCustom: false,
      customName: "",
    };
    menuOpen = false;
  }

  function commitEditor() {
    if (!selected || !editor) return;
    const name = collapse(editor.name);
    const hourName = collapse(editor.useCustom ? editor.customName : editor.hourTypeName);
    if (!name) {
      editorError = "Taaknaam in EBS is verplicht.";
      return;
    }
    if (!hourName) {
      editorError = "Kies een uursoort.";
      return;
    }
    const label = collapse(editor.label);
    const existing = selected.tasks.find((task) => task.id === editor.taskId);
    if (existing) {
      existing.name = name;
      existing.label = label || null;
      const current = existing.hourTypes?.[0];
      if (current && collapse(current.name).toLowerCase() === hourName.toLowerCase()) {
        current.name = hourName;
        existing.hourTypes = [current];
      } else {
        existing.hourTypes = [newHourType(hourName, [])];
      }
    } else {
      selected.tasks = [
        ...selected.tasks,
        {
          id: uid(),
          name,
          label: label || null,
          hourTypes: [newHourType(hourName, [])],
        },
      ];
    }
    config.projects = config.projects;
    editor = null;
    confirmDelete = false;
    markDirty();
  }

  function closeEditor() {
    editor = null;
    confirmDelete = false;
    confirmError = "";
    editorError = "";
  }

  async function removeCurrentTask() {
    if (!editor?.taskId || removing) return;
    const id = editor.taskId;
    removing = true;
    confirmError = "";
    window.clearTimeout(saveTimer);
    editVersion += 1;
    const version = editVersion;
    try {
      await saveChain;
      if (dirty) {
        const saved = await persist(version);
        if (!saved) {
          confirmError = error || "Opslaan mislukt. De taak is niet verwijderd.";
          return;
        }
      }
      await api.removeTask(id);
      editor = null;
      confirmDelete = false;
      dirty = false;
      status = "Alles opgeslagen";
      error = "";
      await load();
    } catch (caught) {
      confirmError = errorText(caught);
    } finally {
      removing = false;
    }
  }

  function setMax(index, raw) {
    const parsed = parseHours(raw);
    if (parsed === null) {
      error = "Max uren moeten tussen 0 en 24 liggen, in stappen van 0,5.";
      return false;
    }
    config.maxHoursPerDay[index] = parsed;
    error = "";
    markDirty();
    return true;
  }

  async function exportConfig() {
    try {
      const text = await api.exportConfigText();
      const today = new Date().toISOString().slice(0, 10);
      if (!inTauri()) return;
      const path = await save({
        defaultPath: `preebs-config-${today}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      await api.writeExportFile(path, text);
      onnotice(`Geschreven naar ${path}`);
    } catch (caught) {
      onnotice(errorText(caught));
    }
  }

  async function importConfig() {
    try {
      const path = await open({ filters: [{ name: "JSON", extensions: ["json"] }] });
      if (!path || Array.isArray(path)) return;
      const text = await api.readTextFile(path);
      config = await api.importConfigText(text);
      dirty = false;
      status = "Alles opgeslagen";
      onnotice("Configuratie geïmporteerd. Weken zijn bewaard.");
    } catch (caught) {
      onnotice(errorText(caught));
    }
  }

  async function migrate() {
    try {
      const path = await open({ filters: [{ name: "JSON", extensions: ["json"] }] });
      if (!path || Array.isArray(path)) return;
      const report = await api.migrate(path);
      await load();
      onnotice(`${report.projects} projecten en ${report.weeks} weken gemigreerd.`);
    } catch (caught) {
      onnotice(errorText(caught));
    }
  }
</script>

<section class="screen config-screen" aria-labelledby="config-title">
  <header class="config-head">
    <h1 id="config-title">Instellingen</h1>
    <p class="sub">Beheer je projecten, taken en werkweek.</p>
    <div class="tabs" role="tablist">
      <button type="button" class="tab" class:active={tab === "projects"} role="tab" aria-selected={tab === "projects"} onclick={() => (tab = "projects")}>Projecten en taken</button>
      <button type="button" class="tab" class:active={tab === "week"} role="tab" aria-selected={tab === "week"} onclick={() => (tab = "week")}>Werkweek</button>
      <button type="button" class="tab" class:active={tab === "data"} role="tab" aria-selected={tab === "data"} onclick={() => (tab = "data")}>Gegevens</button>
    </div>
  </header>

  {#if error && tab !== "projects"}<p class="banner danger" role="alert">{error}</p>{/if}

  {#if config && tab === "projects"}
    <div class="settings-layout">
      <section class="card settings-panel" aria-label="Projecten">
        <div class="panel-title">
          <h2>Projecten</h2>
          <button type="button" class="icon-btn" aria-label="Project toevoegen" onclick={addProject}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke-linecap="round" />
            </svg>
          </button>
        </div>
        <label class="search">
          <span class="sr">Zoek project</span>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <circle cx="11" cy="11" r="6" />
            <path d="m20 20-3.5-3.5" stroke-linecap="round" />
          </svg>
          <input bind:value={query} placeholder="Zoek project..." />
        </label>
        <ul class="project-list">
          {#each visibleProjects as project (project.id)}
            <li>
              <button
                type="button"
                class="project-row"
                class:selected={project.id === selectedId}
                class:archived={project.archived}
                onclick={() => {
                  selectedId = project.id;
                  menuOpen = false;
                }}
              >
                <span class="dot" style="background: {dot(project)}"></span>
                <span>
                  <span class="row-name">{displayProject(project)}</span>
                  <span class="row-meta">{taskCount(project)}</span>
                </span>
              </button>
            </li>
          {/each}
          {#if visibleProjects.length === 0}
            <li class="row-meta empty-list">Geen projecten</li>
          {/if}
        </ul>
        <button type="button" class="archive-toggle" aria-pressed={showArchived} onclick={() => (showArchived = !showArchived)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
            <path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          Toon gearchiveerde projecten
        </button>
      </section>

      <section class="card settings-panel" aria-label={selected ? displayProject(selected) : "Project"}>
        {#if selected}
          <div class="panel-title">
            <h2>{displayProject(selected)}</h2>
            <div class="menu-anchor">
              <button type="button" class="icon-btn" aria-label="Projectopties" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>…</button>
              {#if menuOpen}
                <div class="menu" role="menu">
                  <button type="button" class="menu-item" onclick={() => moveProject(-1)}>Omhoog</button>
                  <button type="button" class="menu-item" onclick={() => moveProject(1)}>Omlaag</button>
                  <button type="button" class="menu-item" onclick={toggleArchive}>{selected.archived ? "Dearchiveren" : "Archiveren"}</button>
                  <button type="button" class="menu-item menu-danger" onclick={removeProject}>Verwijderen</button>
                </div>
              {/if}
            </div>
          </div>

          <div class="field-row">
            <label>
              Weergavenaam
              <input
                value={selected.label ?? ""}
                oninput={(event) => {
                  selected.label = event.currentTarget.value || null;
                  markDirty();
                }}
              />
            </label>
            <label>
              Projectnaam in EBS
              <input bind:value={selected.name} oninput={markDirty} />
              <span class="hint">De EBS-naam wordt gebruikt bij export.</span>
            </label>
          </div>

          <div class="task-head">
            <h3>Taken</h3>
            <button type="button" class="btn btn-outline" onclick={() => openEditor()}>
              <span aria-hidden="true">+</span> Taak toevoegen
            </button>
          </div>
          <table class="task-table">
            <thead>
              <tr>
                <th>Taaknaam in EBS</th>
                <th>Weergavelabel</th>
                <th>Uursoort</th>
                <th><span class="sr">Bewerken</span></th>
              </tr>
            </thead>
            <tbody>
              {#each selected.tasks as task (task.id)}
                <tr>
                  <td>{task.name}</td>
                  <td class:muted={!task.label}>{task.label?.trim() ? task.label : "—"}</td>
                  <td>
                    <span class="type-pill" class:special={specialType(task.hourTypes?.[0]?.name)}>{task.hourTypes?.[0]?.name || "—"}</span>
                  </td>
                  <td class="pencil-cell">
                    <button type="button" class="pencil" aria-label={`Bewerk ${displayTask(task, task.name)}`} onclick={() => openEditor(task)}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
                        <path d="M4 20h4l10.5-10.5a1.8 1.8 0 0 0 0-2.5l-.5-.5a1.8 1.8 0 0 0-2.5 0L5 17v3Z" stroke-linejoin="round" />
                        <path d="m13.5 6.5 3 3" stroke-linecap="round" />
                      </svg>
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
          <p class="hint">Het weergavelabel is optioneel. Zonder label verschijnt de EBS-taaknaam.</p>
          <p class="save-line panel-foot" class:warn={dirty} class:bad={status === "Niet opgeslagen" && Boolean(error)} role="status">
            {#if !dirty}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="m8 12.2 2.4 2.4L16.2 9" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            {/if}
            {status}
          </p>
        {:else}
          <p class="sub">Nog geen project. Voeg er een toe met de plus.</p>
        {/if}
      </section>
    </div>
  {:else if config && tab === "week"}
    <section class="card settings-panel data-panel">
      <h2>Werkweek</h2>
      <p class="hint">Maximale uren per weekdag. Een boeking boven dit maximum wordt geweigerd. Het weekraster waarschuwt alleen.</p>
      <div class="max-grid">
        {#each DAYS as day, index (day)}
          <label>
            {day}
            <input
              value={formatHours(config.maxHoursPerDay[index]) || "0"}
              onchange={(event) => {
                if (!setMax(index, event.currentTarget.value)) {
                  event.currentTarget.value = formatHours(config.maxHoursPerDay[index]) || "0";
                }
              }}
            />
          </label>
        {/each}
      </div>
      <p class="save-line" class:warn={dirty} role="status">{status}</p>
    </section>
  {:else if config && tab === "data"}
    <section class="card settings-panel data-panel">
      <h2>Gegevens</h2>
      <label class="grow">
        Standaard uurtype
        <input
          value={config.defaultHourTypeName}
          oninput={(event) => {
            config.defaultHourTypeName = event.currentTarget.value;
            markDirty();
          }}
        />
        <span class="hint">Nieuwe taken krijgen deze naam. Bestaande uursoorten blijven staan.</span>
      </label>
      <div>
        <p class="field-label">Database</p>
        <p class="path">{dbPath || "Database opent bij start"}</p>
      </div>
      <div class="head-actions">
        <button type="button" class="btn" onclick={exportConfig}>Exporteer configuratie</button>
        <button type="button" class="btn" onclick={importConfig}>Importeer configuratie</button>
        <button type="button" class="btn" onclick={migrate}>Migreer JSON</button>
      </div>
      <p class="hint">Importeren vervangt de configuratie en laat weken staan. Een oud bestand zonder weergavelabel of standaard uurtype blijft geldig.</p>
      <p class="save-line" class:warn={dirty} role="status">{status}</p>
    </section>
  {/if}

{#if editor}
  <div class="modal-backdrop">
    <button type="button" class="backdrop-dismiss" aria-label="Annuleren" onclick={closeEditor}></button>
    <form
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-dialog-title"
      onsubmit={(event) => {
        event.preventDefault();
        if (confirmDelete) return;
        commitEditor();
      }}
    >
      <div class="panel-title">
        <h2 id="task-dialog-title">{editor.taskId ? "Taak bewerken" : "Taak toevoegen"}</h2>
        <button type="button" class="icon-btn" aria-label="Sluiten" onclick={closeEditor}>×</button>
      </div>
      <label>
        Taaknaam in EBS
        <input bind:this={nameInput} bind:value={editor.name} />
        <span class="hint">Exacte naam voor de EBS-export.</span>
      </label>
      <label>
        Weergavelabel (optioneel)
        <input bind:value={editor.label} />
      </label>
      <label>
        Uursoort
        {#if editor.useCustom}
          <input bind:value={editor.customName} placeholder="Naam van het uurtype" />
        {:else}
          <select bind:value={editor.hourTypeName} onchange={(event) => {
            if (event.currentTarget.value === "__new__") editor.useCustom = true;
          }}>
            {#each hourChoices as name (name)}
              <option value={name}>{name}</option>
            {/each}
            <option value="__new__">Nieuw uurtype…</option>
          </select>
        {/if}
      </label>
      {#if editorError}<p class="banner danger" role="alert">{editorError}</p>{/if}
      <div class="modal-actions">
        {#if editor.taskId}
          <button type="button" class="btn btn-danger" onclick={() => { confirmError = ""; confirmDelete = true; }}>Taak verwijderen</button>
        {/if}
        <button type="button" class="btn" onclick={closeEditor}>Annuleren</button>
        <button type="submit" class="btn btn-primary">Opslaan</button>
      </div>
    </form>
  </div>
{/if}

{#if confirmDelete && editor?.taskId}
  <div class="modal-backdrop confirm-layer">
    <button type="button" class="backdrop-dismiss" aria-label="Annuleren" onclick={() => (confirmDelete = false)}></button>
    <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-body">
      <h2 id="delete-dialog-title">Taak verwijderen</h2>
      <p id="delete-dialog-body">{confirmText}</p>
      {#if confirmError}<p class="banner danger" role="alert">{confirmError}</p>{/if}
      <div class="modal-actions">
        <button type="button" class="btn" onclick={() => (confirmDelete = false)} disabled={removing}>Annuleren</button>
        <button type="button" class="btn btn-danger" onclick={removeCurrentTask} disabled={removing}>Verwijderen</button>
      </div>
    </div>
  </div>
{/if}
</section>
