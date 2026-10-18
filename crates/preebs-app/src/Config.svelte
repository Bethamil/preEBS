<script>
  import { open, save } from "@tauri-apps/plugin-dialog";
  import { api, errorText, inTauri } from "./lib/api.js";
  import { DAYS, collapse, formatHours, newHourType, parseHours, uid } from "./lib/format.js";

  let { reloadToken, onnotice } = $props();
  let config = $state(null);
  let query = $state("");
  let error = $state("");
  let status = $state("");
  let visibleProjects = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    if (!config) return [];
    if (!needle) return config.projects;
    return config.projects.filter((project) => {
      const hay = [project.name, project.label, ...project.tasks.flatMap((task) => [task.name, ...task.hourTypes.map((hour) => hour.name)])]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  });

  async function load() {
    try {
      config = await api.getConfig();
      error = "";
      status = "Geladen";
    } catch (caught) {
      error = errorText(caught);
    }
  }

  $effect(() => {
    reloadToken;
    void load();
  });

  function move(list, index, delta) {
    const next = index + delta;
    if (next < 0 || next >= list.length) return;
    const [item] = list.splice(index, 1);
    list.splice(next, 0, item);
  }

  async function saveConfig() {
    if (!config) return;
    try {
      config = await api.saveConfig(config);
      status = "Opgeslagen";
      error = "";
      onnotice("Configuratie opgeslagen.");
    } catch (caught) {
      error = errorText(caught);
      onnotice(error);
    }
  }

  async function saveSettings() {
    if (!config) return;
    const maxHours = [];
    for (const value of config.maxHoursPerDay) {
      const parsed = parseHours(String(value).replace(".", ","));
      if (parsed === null) {
        error = "Max uren moeten tussen 0 en 24 liggen, in stappen van 0,5.";
        return;
      }
      maxHours.push(parsed);
    }
    const name = collapse(config.defaultHourTypeName);
    if (!name) {
      error = "Een naam voor het standaard uurtype is verplicht.";
      return;
    }
    try {
      config = await api.setSettings(maxHours, name);
      status = "Opgeslagen";
      error = "";
    } catch (caught) {
      error = errorText(caught);
    }
  }

  function addProject() {
    config.projects.push({ id: uid(), name: "Nieuw project", label: null, tasks: [] });
    config.projects = config.projects;
  }

  function addTask(project) {
    project.tasks.push({
      id: uid(),
      name: "Nieuwe taak",
      hourTypes: [newHourType(config.defaultHourTypeName, [])],
    });
    config.projects = config.projects;
  }

  function addHourType(task) {
    const created = newHourType(config.defaultHourTypeName, task.hourTypes);
    if (task.hourTypes.some((item) => item.id === created.id)) created.id = uid();
    task.hourTypes.push(created);
    config.projects = config.projects;
  }

  function removeHourType(task, index) {
    if (task.hourTypes.length <= 1) {
      error = "Een taak moet minstens één uurtype houden.";
      return;
    }
    task.hourTypes.splice(index, 1);
    config.projects = config.projects;
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

<section class="screen" aria-labelledby="config-title">
  <div class="page-head">
    <div>
      <h1 id="config-title">Instellingen</h1>
      <p class="sub">Projecten, taken en uurtypes. Het standaard uurtype wijzigen herschrijft bestaande taken niet.</p>
    </div>
    <div class="head-actions">
      <button type="button" class="btn btn-primary" onclick={saveConfig}>Configuratie opslaan</button>
      <button type="button" class="btn" onclick={exportConfig}>Exporteer</button>
      <button type="button" class="btn" onclick={importConfig}>Importeer</button>
      <button type="button" class="btn" onclick={migrate}>Migreer JSON</button>
    </div>
  </div>
  {#if error}<p class="banner danger" role="alert">{error}</p>{/if}
  {#if status}<p class="sub">{status}</p>{/if}

  {#if config}
    <form
      class="settings"
      onsubmit={(event) => {
        event.preventDefault();
        void saveSettings();
      }}
    >
      <label class="grow">
        Standaard uurtype voor nieuwe taken
        <input bind:value={config.defaultHourTypeName} />
      </label>
      <fieldset>
        <legend>Max uren per dag</legend>
        <div class="max-grid">
          {#each DAYS as day, index (day)}
            <label>
              {day}
              <input
                value={formatHours(config.maxHoursPerDay[index]) || "0"}
                onchange={(event) => {
                  const parsed = parseHours(event.currentTarget.value);
                  if (parsed === null) {
                    error = "Max uren moeten tussen 0 en 24 liggen, in stappen van 0,5.";
                    event.currentTarget.value = formatHours(config.maxHoursPerDay[index]) || "0";
                    return;
                  }
                  config.maxHoursPerDay[index] = parsed;
                  void saveSettings();
                }}
              />
            </label>
          {/each}
        </div>
      </fieldset>
      <button type="submit" class="btn">Instellingen opslaan</button>
    </form>

    <label>
      Configuratie zoeken
      <input bind:value={query} placeholder="Project, taak of uurtype" />
    </label>

    <div class="projects">
      {#each visibleProjects as project (project.id)}
        <article>
          <header>
            <label>
              EBS-naam
              <input bind:value={project.name} />
            </label>
            <label>
              Label
              <input
                value={project.label ?? ""}
                oninput={(event) => (project.label = event.currentTarget.value || null)}
              />
            </label>
            <div class="row-actions">
              <button type="button" aria-label="Project omhoog" onclick={() => move(config.projects, config.projects.indexOf(project), -1)}>Omhoog</button>
              <button type="button" aria-label="Project omlaag" onclick={() => move(config.projects, config.projects.indexOf(project), 1)}>Omlaag</button>
              <button type="button" onclick={() => { config.projects = config.projects.filter((item) => item.id !== project.id); }}>Verwijder</button>
            </div>
          </header>
          {#each project.tasks as task (task.id)}
            <div class="task">
              <label>
                Taak
                <input bind:value={task.name} />
              </label>
              <div class="hours-edit">
                {#each task.hourTypes as hourType, hourIndex (hourType.id)}
                  <label>
                    Uurtype
                    <input bind:value={hourType.name} />
                  </label>
                  <button type="button" aria-label="Uurtype verwijderen" disabled={task.hourTypes.length <= 1} onclick={() => removeHourType(task, hourIndex)}>×</button>
                {/each}
                <button type="button" onclick={() => addHourType(task)}>Uurtype toevoegen</button>
              </div>
              <div class="row-actions">
                <button type="button" aria-label="Taak omhoog" onclick={() => move(project.tasks, project.tasks.indexOf(task), -1)}>Omhoog</button>
                <button type="button" aria-label="Taak omlaag" onclick={() => move(project.tasks, project.tasks.indexOf(task), 1)}>Omlaag</button>
                <button type="button" onclick={() => { project.tasks = project.tasks.filter((item) => item.id !== task.id); config.projects = config.projects; }}>Taak verwijderen</button>
              </div>
            </div>
          {/each}
          <button type="button" class="add-row" onclick={() => addTask(project)}>+ Taak toevoegen</button>
        </article>
      {/each}
    </div>
    <button type="button" class="btn" onclick={addProject}>Project toevoegen</button>
  {/if}
</section>
