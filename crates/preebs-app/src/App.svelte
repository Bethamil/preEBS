<script>
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import WeekScreen from "./Week.svelte";
  import WeeksScreen from "./Weeks.svelte";
  import ConfigScreen from "./Config.svelte";
  import ExportScreen from "./Export.svelte";
  import { api, errorText, inTauri } from "./lib/api.js";
  import { mondayOf, shiftWeek } from "./lib/format.js";
  import { applyTheme, readTheme, writeTheme } from "./lib/theme.js";

  let view = $state("week");
  let weekStart = $state(mondayOf());
  let theme = $state(readTheme());
  let paletteOpen = $state(false);
  let paletteQuery = $state("");
  let paletteIndex = $state(0);
  let notice = $state("");
  let dbPath = $state("");
  let revision = $state(0);
  let reloadToken = $state(0);
  let weekApi = $state(null);

  const views = [
    { id: "week", label: "Uren", shortcut: "1" },
    { id: "weeks", label: "Weken", shortcut: "2" },
    { id: "config", label: "Instellingen", shortcut: "3" },
    { id: "export", label: "Export", shortcut: "4" },
  ];

  const actions = $derived.by(() => {
    const items = [
      ...views.map((item) => ({
        id: `nav-${item.id}`,
        label: item.id === "export" ? "Ga naar export" : `Ga naar ${item.label}`,
        hint: `Ctrl/Cmd ${item.shortcut}`,
        run: () => {
          view = item.id;
        },
      })),
      {
        id: "week-prev",
        label: "Vorige week",
        hint: "Ctrl/Cmd Left",
        run: () => {
          view = "week";
          weekStart = shiftWeek(weekStart, -1);
        },
      },
      {
        id: "week-next",
        label: "Volgende week",
        hint: "Ctrl/Cmd Right",
        run: () => {
          view = "week";
          weekStart = shiftWeek(weekStart, 1);
        },
      },
      {
        id: "week-today",
        label: "Huidige week",
        run: () => {
          view = "week";
          weekStart = mondayOf();
        },
      },
      {
        id: "week-copy",
        label: "Vorige week kopiëren",
        hint: "Ctrl/Cmd Shift C",
        run: () => weekApi?.copyPrevious(),
      },
      {
        id: "add-next",
        label: "Volgende ontbrekende regel",
        run: () => {
          view = "week";
          queueMicrotask(() => weekApi?.addNext());
        },
      },
      {
        id: "export-save",
        label: "Exporteer week-JSON",
        hint: "Ctrl/Cmd E",
        run: () => {
          view = "export";
        },
      },
      { id: "theme-system", label: "Thema: systeem", run: () => setTheme("system") },
      { id: "theme-light", label: "Thema: licht", run: () => setTheme("light") },
      { id: "theme-dark", label: "Thema: donker", run: () => setTheme("dark") },
    ];
    const query = paletteQuery.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => item.label.toLowerCase().includes(query));
  });

  $effect(() => {
    if (paletteIndex >= actions.length) paletteIndex = 0;
  });

  function setTheme(next) {
    theme = next;
    writeTheme(next);
    applyTheme(next);
  }

  function flash(message) {
    notice = message;
  }

  function runAction(action) {
    paletteOpen = false;
    paletteQuery = "";
    paletteIndex = 0;
    action?.run();
  }

  function onMenu(id) {
    if (id === "palette") {
      paletteOpen = true;
      paletteQuery = "";
      return;
    }
    if (id.startsWith("nav-")) {
      view = id.slice(4);
      return;
    }
    if (id.startsWith("theme-")) {
      setTheme(id.slice(6));
      return;
    }
    if (id === "week-prev" || id === "week-next" || id === "week-copy") view = "week";
    if (id === "week-prev") weekStart = shiftWeek(weekStart, -1);
    if (id === "week-next") weekStart = shiftWeek(weekStart, 1);
    if (id === "week-copy") weekApi?.copyPrevious();
    if (id === "export-save") view = "export";
  }

  function onKeydown(event) {
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && key === "k") {
      event.preventDefault();
      paletteOpen = !paletteOpen;
      paletteQuery = "";
      paletteIndex = 0;
      return;
    }
    if (paletteOpen) {
      if (event.key === "Escape") {
        paletteOpen = false;
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        paletteIndex = actions.length ? (paletteIndex + 1) % actions.length : 0;
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        paletteIndex = actions.length ? (paletteIndex - 1 + actions.length) % actions.length : 0;
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        runAction(actions[paletteIndex]);
        return;
      }
    }
    if (!mod) return;
    if (key === "1") view = "week";
    else if (key === "2") view = "weeks";
    else if (key === "3") view = "config";
    else if (key === "4") view = "export";
    else if (key === "e") {
      view = "export";
    } else if (key === "arrowleft") {
      view = "week";
      weekStart = shiftWeek(weekStart, -1);
    } else if (key === "arrowright") {
      view = "week";
      weekStart = shiftWeek(weekStart, 1);
    } else if (event.shiftKey && key === "c") {
      event.preventDefault();
      view = "week";
      weekApi?.copyPrevious();
    } else {
      return;
    }
    if (key !== "c") event.preventDefault();
  }

  function openWeek(date) {
    weekStart = date;
    view = "week";
  }

  onMount(() => {
    applyTheme(theme);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => {
      if (theme === "system") applyTheme("system");
    };
    media.addEventListener("change", onScheme);
    let stop = () => {};
    let timer = 0;
    if (inTauri()) {
      listen("menu", (event) => onMenu(String(event.payload))).then((unlisten) => {
        stop = unlisten;
      });
      api
        .info()
        .then((info) => {
          dbPath = info.path;
          revision = info.revision;
        })
        .catch((error) => flash(errorText(error)));
      timer = window.setInterval(() => {
        api
          .revision()
          .then((next) => {
            if (next !== revision) {
              revision = next;
              reloadToken += 1;
            }
          })
          .catch(() => {});
      }, 1000);
    } else {
      flash("Open PreEBS via de desktopapp. De interface praat via Tauri met de lokale database.");
    }
    return () => {
      media.removeEventListener("change", onScheme);
      stop();
      window.clearInterval(timer);
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />

<div class="app">
  <aside class="sidebar">
    <p class="brand">PreEBS</p>
    <nav class="side-nav" aria-label="Schermen">
      <button type="button" class="nav-item" class:active={view === "week"} aria-current={view === "week" ? "page" : undefined} onclick={() => (view = "week")}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v5l3 2" stroke-linecap="round" />
        </svg>
        <span>Uren</span>
      </button>
      <button type="button" class="nav-item" class:active={view === "weeks"} aria-current={view === "weeks" ? "page" : undefined} onclick={() => (view = "weeks")}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <path d="M8 3.5V7M16 3.5V7M4 10h16" stroke-linecap="round" />
        </svg>
        <span>Weken</span>
      </button>
      <button type="button" class="nav-item" class:active={view === "config"} aria-current={view === "config" ? "page" : undefined} onclick={() => (view = "config")}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6.1 6.1l1.6 1.6M16.3 16.3l1.6 1.6M17.9 6.1l-1.6 1.6M7.7 16.3l-1.6 1.6" stroke-linecap="round" />
        </svg>
        <span>Instellingen</span>
      </button>
    </nav>
    <p class="sidebar-meta" title={dbPath || "Database opent bij start"}>
      {dbPath || "Database opent bij start"}
    </p>
  </aside>

  <div class="workspace">
    {#if notice}
      <p class="banner" role="status">{notice}</p>
    {/if}

    {#if view === "week"}
      <WeekScreen
        {weekStart}
        {reloadToken}
        bind:api={weekApi}
        onnotice={flash}
        onshift={(delta) => (weekStart = shiftWeek(weekStart, delta))}
        onexport={() => (view = "export")}
      />
    {:else if view === "weeks"}
      <WeeksScreen {reloadToken} onopen={openWeek} onexport={(date) => { weekStart = date; view = "export"; }} onnotice={flash} />
    {:else if view === "config"}
      <ConfigScreen {reloadToken} onnotice={flash} />
    {:else}
      <ExportScreen {weekStart} {reloadToken} onnotice={flash} />
    {/if}
  </div>
</div>

{#if paletteOpen}
  <div class="palette-backdrop">
    <button type="button" class="backdrop-dismiss" aria-label="Opdrachtpalet sluiten" onclick={() => (paletteOpen = false)}></button>
    <div class="palette" role="dialog" aria-modal="true" aria-label="Opdrachtpalet">
      <input
        placeholder="Typ een opdracht"
        bind:value={paletteQuery}
        oninput={() => (paletteIndex = 0)}
        aria-label="Opdrachten filteren"
      />
      <ul role="listbox">
        {#each actions as action, index (action.id)}
          <li>
            <button
              type="button"
              role="option"
              aria-selected={index === paletteIndex}
              class:selected={index === paletteIndex}
              onclick={() => runAction(action)}
            >
              <span>{action.label}</span>
              {#if action.hint}<kbd>{action.hint}</kbd>{/if}
            </button>
          </li>
        {/each}
        {#if actions.length === 0}
          <li class="empty">Geen opdracht gevonden</li>
        {/if}
      </ul>
    </div>
  </div>
{/if}
