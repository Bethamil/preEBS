<script>
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import WeekScreen from "./Week.svelte";
  import WeeksScreen from "./Weeks.svelte";
  import ConfigScreen from "./Config.svelte";
  import ExportScreen from "./Export.svelte";
  import { api, errorText, inTauri } from "./lib/api.js";
  import { mondayOf, shiftWeek, weekRange } from "./lib/format.js";
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
    { id: "week", label: "Week", shortcut: "1" },
    { id: "weeks", label: "Weeks", shortcut: "2" },
    { id: "config", label: "Config", shortcut: "3" },
    { id: "export", label: "Export", shortcut: "4" },
  ];

  const actions = $derived.by(() => {
    const items = [
      ...views.map((item) => ({
        id: `nav-${item.id}`,
        label: `Go to ${item.label}`,
        hint: `Ctrl/Cmd ${item.shortcut}`,
        run: () => {
          view = item.id;
        },
      })),
      {
        id: "week-prev",
        label: "Previous week",
        hint: "Ctrl/Cmd Left",
        run: () => {
          view = "week";
          weekStart = shiftWeek(weekStart, -1);
        },
      },
      {
        id: "week-next",
        label: "Next week",
        hint: "Ctrl/Cmd Right",
        run: () => {
          view = "week";
          weekStart = shiftWeek(weekStart, 1);
        },
      },
      {
        id: "week-today",
        label: "Current week",
        run: () => {
          view = "week";
          weekStart = mondayOf();
        },
      },
      {
        id: "week-copy",
        label: "Copy previous week",
        hint: "Ctrl/Cmd Shift C",
        run: () => weekApi?.copyPrevious(),
      },
      {
        id: "add-next",
        label: "Add next missing line",
        run: () => {
          view = "week";
          queueMicrotask(() => weekApi?.addNext());
        },
      },
      {
        id: "export-save",
        label: "Export week JSON",
        hint: "Ctrl/Cmd E",
        run: () => {
          view = "export";
        },
      },
      { id: "theme-system", label: "Theme: follow system", run: () => setTheme("system") },
      { id: "theme-light", label: "Theme: light", run: () => setTheme("light") },
      { id: "theme-dark", label: "Theme: dark", run: () => setTheme("dark") },
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
      flash("Open PreEBS from the desktop app. The UI talks to the local database through Tauri.");
    }
    return () => {
      media.removeEventListener("change", onScheme);
      stop();
      window.clearInterval(timer);
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />

<div class="shell">
  <header class="top">
    <div class="brand">
      <img src="/logo.png" alt="" width="92" height="28" />
      <div>
        <p class="eyebrow">Monday – Friday</p>
        <h1>PreEBS</h1>
      </div>
    </div>
    <nav aria-label="Screens">
      {#each views as item (item.id)}
        <button
          type="button"
          class:active={view === item.id}
          aria-current={view === item.id ? "page" : undefined}
          onclick={() => (view = item.id)}
        >
          {item.label}
        </button>
      {/each}
    </nav>
    <div class="top-actions">
      <button type="button" onclick={() => setTheme(theme === "dark" ? "light" : theme === "light" ? "system" : "dark")}>
        Theme: {theme}
      </button>
      <button type="button" onclick={() => (paletteOpen = true)}>
        Commands <kbd>Ctrl K</kbd>
      </button>
    </div>
  </header>

  {#if notice}
    <p class="banner" role="status">{notice}</p>
  {/if}

  <main>
    {#if view === "week"}
      <WeekScreen
        {weekStart}
        {reloadToken}
        rangeLabel={weekRange(weekStart)}
        bind:api={weekApi}
        onnotice={flash}
        onshift={(delta) => (weekStart = shiftWeek(weekStart, delta))}
        ontoday={() => (weekStart = mondayOf())}
      />
    {:else if view === "weeks"}
      <WeeksScreen {reloadToken} onopen={openWeek} onexport={(date) => { weekStart = date; view = "export"; }} onnotice={flash} />
    {:else if view === "config"}
      <ConfigScreen {reloadToken} onnotice={flash} />
    {:else}
      <ExportScreen {weekStart} {reloadToken} onnotice={flash} />
    {/if}
  </main>

  <footer>
    <span>{dbPath || "Database opens on launch"}</span>
    <span>Revision {revision}</span>
  </footer>
</div>

{#if paletteOpen}
  <div class="palette-backdrop">
    <button type="button" class="backdrop-dismiss" aria-label="Close command palette" onclick={() => (paletteOpen = false)}></button>
    <div class="palette" role="dialog" aria-modal="true" aria-label="Command palette">
      <input
        placeholder="Type a command"
        bind:value={paletteQuery}
        oninput={() => (paletteIndex = 0)}
        aria-label="Filter commands"
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
          <li class="empty">No matching command</li>
        {/if}
      </ul>
    </div>
  </div>
{/if}
