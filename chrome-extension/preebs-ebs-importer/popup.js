const jsonInput = document.getElementById("jsonInput");
const pasteButton = document.getElementById("pasteButton");
const runButton = document.getElementById("runButton");
const statusNode = document.getElementById("status");

const allowAddRows = document.getElementById("allowAddRows");
const overwriteRowHours = document.getElementById("overwriteRowHours");
const clearUntouchedRows = document.getElementById("clearUntouchedRows");
const clickRecalculate = document.getElementById("clickRecalculate");
const dryRun = document.getElementById("dryRun");

function setStatus(message) {
  statusNode.textContent = message;
}

function collectOptions() {
  return {
    allowAddRows: allowAddRows.checked,
    overwriteRowHours: overwriteRowHours.checked,
    clearUntouchedRows: clearUntouchedRows.checked,
    clickRecalculate: clickRecalculate.checked,
    dryRun: dryRun.checked,
  };
}

pasteButton.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) {
      setStatus("Clipboard is empty.");
      return;
    }
    jsonInput.value = text;
    setStatus("Pasted JSON from clipboard.");
  } catch (error) {
    setStatus(`Cannot read clipboard: ${String(error)}`);
  }
});

runButton.addEventListener("click", async () => {
  const rawJson = jsonInput.value.trim();
  if (!rawJson) {
    setStatus("Paste a JSON payload first.");
    return;
  }

  try {
    JSON.parse(rawJson);
  } catch (error) {
    setStatus(`Invalid JSON: ${String(error)}`);
    return;
  }

  runButton.disabled = true;
  setStatus("Running importer on active tab...");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("No active tab found.");
    }

    const options = collectOptions();

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: importIntoEbsPage,
      args: [rawJson, options],
    });

    const outcome = results?.[0]?.result;
    if (!outcome) {
      throw new Error("No response from injected script.");
    }

    if (!outcome.ok) {
      throw new Error(outcome.error || "Importer failed.");
    }

    setStatus(outcome.message);
  } catch (error) {
    setStatus(`Import failed: ${String(error)}`);
  } finally {
    runButton.disabled = false;
  }
});

function importIntoEbsPage(rawJson, options) {
  const opts = {
    allowAddRows: true,
    overwriteRowHours: true,
    clearUntouchedRows: false,
    clickRecalculate: true,
    dryRun: false,
    ...options,
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function normalize(value) {
    return String(value ?? "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function equivalent(a, b) {
    const left = normalize(a);
    const right = normalize(b);

    if (!left || !right) {
      return false;
    }
    if (left === right) {
      return true;
    }

    return left.includes(right) || right.includes(left);
  }

  function keyFor(projectName, taskName, hourTypeName) {
    return [normalize(projectName), normalize(taskName), normalize(hourTypeName)].join("||");
  }

  function toNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  function ensureHourArray(hours) {
    const values = Array.isArray(hours) ? hours : [];
    return Array.from({ length: 7 }, (_, index) => toNumber(values[index]));
  }

  function flattenRowsExport(rows) {
    const map = new Map();

    for (const row of rows) {
      const projectName = String(row.projectName ?? row.project ?? "").trim();
      const taskName = String(row.taskName ?? row.task ?? "").trim();
      const hourTypeName = String(row.hourTypeName ?? row.hourType ?? "").trim();
      if (!projectName || !taskName || !hourTypeName) {
        continue;
      }

      const key = keyFor(projectName, taskName, hourTypeName);
      const hours = ensureHourArray(row.hours);

      if (!map.has(key)) {
        map.set(key, {
          key,
          projectName,
          taskName,
          hourTypeName,
          hours: Array.from({ length: 7 }, () => 0),
        });
      }

      const current = map.get(key);
      for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
        current.hours[dayIndex] += hours[dayIndex];
      }
    }

    return Array.from(map.values());
  }

  function flattenDaysExport(days) {
    const map = new Map();

    days.forEach((dayNode, dayIndex) => {
      if (!dayNode || !Array.isArray(dayNode.projects)) {
        return;
      }

      dayNode.projects.forEach((projectNode) => {
        if (!projectNode || !Array.isArray(projectNode.tasks)) {
          return;
        }

        projectNode.tasks.forEach((taskNode) => {
          if (!taskNode || !Array.isArray(taskNode.hourTypes)) {
            return;
          }

          taskNode.hourTypes.forEach((hourTypeNode) => {
            const projectName = String(projectNode.projectName ?? "").trim();
            const taskName = String(taskNode.taskName ?? "").trim();
            const hourTypeName = String(hourTypeNode.hourTypeName ?? "").trim();
            if (!projectName || !taskName || !hourTypeName) {
              return;
            }

            const key = keyFor(projectName, taskName, hourTypeName);
            if (!map.has(key)) {
              map.set(key, {
                key,
                projectName,
                taskName,
                hourTypeName,
                hours: Array.from({ length: 7 }, () => 0),
              });
            }

            const current = map.get(key);
            current.hours[dayIndex] += toNumber(hourTypeNode.hours);
          });
        });
      });
    });

    return Array.from(map.values());
  }

  function parseDesiredRows(documentJson) {
    if (Array.isArray(documentJson)) {
      return flattenRowsExport(documentJson);
    }

    if (Array.isArray(documentJson.rows)) {
      return flattenRowsExport(documentJson.rows);
    }

    if (Array.isArray(documentJson.days)) {
      return flattenDaysExport(documentJson.days);
    }

    return [];
  }

  function getInputById(id) {
    const element = document.getElementById(id);
    return element instanceof HTMLInputElement ? element : null;
  }

  function rowMonFriHours(row) {
    const values = [];
    for (let dayIndex = 0; dayIndex < 5; dayIndex += 1) {
      const input = row.hoursInputs[dayIndex];
      values.push(String(input?.value ?? "").trim());
    }
    return values;
  }

  function collectRows() {
    const rows = [];
    const projectInputs = Array.from(document.querySelectorAll("input[id^='A24'][id$='N1display']"));

    for (const element of projectInputs) {
      if (!(element instanceof HTMLInputElement)) {
        continue;
      }

      const match = /^A24(\d+)N1display$/.exec(element.id);
      if (!match) {
        continue;
      }

      const rowIndex = Number(match[1]);
      const taskInput = getInputById(`A25${rowIndex}N1display`);
      const hourTypeInput = getInputById(`A26${rowIndex}N1display`);

      const hoursInputs = [];
      for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
        hoursInputs.push(getInputById(`B22_${rowIndex}_${dayIndex}`));
      }

      const row = {
        rowIndex,
        projectInput: element,
        taskInput,
        hourTypeInput,
        hoursInputs,
      };

      const hasMeta =
        String(row.projectInput.value ?? "").trim() ||
        String(row.taskInput?.value ?? "").trim() ||
        String(row.hourTypeInput?.value ?? "").trim();
      const hasMonFriHours = rowMonFriHours(row).some((value) => value !== "");

      row.isCompletelyEmpty = !(hasMeta || hasMonFriHours);
      rows.push(row);
    }

    rows.sort((a, b) => a.rowIndex - b.rowIndex);
    return rows;
  }

  function findActionButton(kind) {
    const buttons = Array.from(document.querySelectorAll("button"));

    if (kind === "addRow") {
      return (
        buttons.find((button) => String(button.getAttribute("onclick") || "").includes("addrow")) ||
        buttons.find((button) => /rij toevoegen|add row/i.test(button.textContent || "")) ||
        null
      );
    }

    if (kind === "recalculate") {
      return (
        buttons.find((button) => String(button.getAttribute("onclick") || "").includes("recalculate")) ||
        buttons.find((button) => /opnieuw berekenen|recalculate/i.test(button.textContent || "")) ||
        null
      );
    }

    return null;
  }

  async function waitUntil(check, timeoutMs = 12000, intervalMs = 120) {
    const started = Date.now();
    while (Date.now() - started <= timeoutMs) {
      if (check()) {
        return true;
      }
      await sleep(intervalMs);
    }
    return false;
  }

  async function addRows(count) {
    let added = 0;
    for (let i = 0; i < count; i += 1) {
      const addButton = findActionButton("addRow");
      if (!(addButton instanceof HTMLButtonElement)) {
        break;
      }

      const before = collectRows().length;
      addButton.click();
      const changed = await waitUntil(() => collectRows().length > before, 12000, 120);
      if (!changed) {
        break;
      }
      added += 1;
    }
    return added;
  }

  function buildAssignments(desiredRows, rows) {
    const pool = rows.map((row) => ({
      row,
      used: false,
    }));

    const assignments = [];
    const pending = [];

    for (const desired of desiredRows) {
      let selected = null;
      let kind = "";

      for (const candidate of pool) {
        if (candidate.used) {
          continue;
        }

        if (
          equivalent(candidate.row.projectInput.value, desired.projectName) &&
          equivalent(candidate.row.taskInput?.value, desired.taskName) &&
          equivalent(candidate.row.hourTypeInput?.value, desired.hourTypeName)
        ) {
          selected = candidate;
          kind = "matched";
          break;
        }
      }

      if (!selected) {
        selected = pool.find((candidate) => !candidate.used && candidate.row.isCompletelyEmpty) || null;
        if (selected) {
          kind = "empty";
        }
      }

      if (!selected) {
        pending.push(desired);
        continue;
      }

      selected.used = true;
      assignments.push({
        desired,
        row: selected.row,
        kind,
      });
    }

    const untouchedRows = pool.filter((candidate) => !candidate.used).map((candidate) => candidate.row);

    return {
      assignments,
      pending,
      untouchedRows,
    };
  }

  function formatHourValue(value) {
    const rounded = Math.round(toNumber(value) * 100) / 100;
    if (Math.abs(rounded) < 0.000001) {
      return "";
    }

    if (Number.isInteger(rounded)) {
      return String(rounded);
    }

    return String(rounded).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  }

  function setInputValue(input, value) {
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    if (descriptor && typeof descriptor.set === "function") {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }

    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function setLovSequence(row, desired) {
    const currentProject = String(row.projectInput.value ?? "").trim();
    const currentTask = String(row.taskInput?.value ?? "").trim();
    const currentHourType = String(row.hourTypeInput?.value ?? "").trim();

    if (!equivalent(currentProject, desired.projectName)) {
      row.projectInput.focus();
      setInputValue(row.projectInput, desired.projectName);
      row.projectInput.blur();
      await sleep(180);
    }

    if (row.taskInput && !equivalent(currentTask, desired.taskName)) {
      row.taskInput.focus();
      setInputValue(row.taskInput, desired.taskName);
      row.taskInput.blur();
      await sleep(180);
    }

    if (row.hourTypeInput && !equivalent(currentHourType, desired.hourTypeName)) {
      row.hourTypeInput.focus();
      setInputValue(row.hourTypeInput, desired.hourTypeName);
      row.hourTypeInput.blur();
      await sleep(120);
    }
  }

  function setMonFriHours(row, desiredHours, overwrite) {
    for (let dayIndex = 0; dayIndex < 5; dayIndex += 1) {
      const input = row.hoursInputs[dayIndex];
      if (!(input instanceof HTMLInputElement)) {
        continue;
      }

      const hour = toNumber(desiredHours[dayIndex]);
      if (!overwrite && Math.abs(hour) < 0.000001) {
        continue;
      }

      input.focus();
      setInputValue(input, formatHourValue(hour));
      input.blur();
    }
  }

  function clearMonFriHours(row) {
    for (let dayIndex = 0; dayIndex < 5; dayIndex += 1) {
      const input = row.hoursInputs[dayIndex];
      if (!(input instanceof HTMLInputElement)) {
        continue;
      }

      if (!String(input.value ?? "").trim()) {
        continue;
      }

      input.focus();
      setInputValue(input, "");
      input.blur();
    }
  }

  async function clickRecalculateButtonIfPresent() {
    const recalculateButton = findActionButton("recalculate");
    if (!(recalculateButton instanceof HTMLButtonElement)) {
      return false;
    }

    recalculateButton.click();
    await sleep(350);
    return true;
  }

  return (async () => {
    try {
      const documentJson = JSON.parse(rawJson);
      const desiredRows = parseDesiredRows(documentJson);

      if (desiredRows.length === 0) {
        return {
          ok: false,
          error:
            "No importable rows found. Expected PreEBS export JSON with days/projects/tasks/hourTypes or rows[].",
        };
      }

      const firstRows = collectRows();
      if (firstRows.length === 0) {
        return {
          ok: false,
          error:
            "No EBS row fields detected. Open a timecard page that contains Project/Taak/Soort columns first.",
        };
      }

      const firstPlan = buildAssignments(desiredRows, firstRows);

      if (opts.dryRun) {
        return {
          ok: true,
          message: [
            "Dry run completed.",
            `Rows in JSON: ${desiredRows.length}`,
            `Matched rows now: ${firstPlan.assignments.filter((item) => item.kind === "matched").length}`,
            `Rows to fill from empty slots: ${firstPlan.assignments.filter((item) => item.kind === "empty").length}`,
            `Rows still missing: ${firstPlan.pending.length}`,
            firstPlan.pending.length > 0 && opts.allowAddRows
              ? `Would click \"Rij toevoegen\" ${firstPlan.pending.length} time(s).`
              : "",
          ]
            .filter(Boolean)
            .join("\n"),
        };
      }

      let addedRows = 0;
      if (firstPlan.pending.length > 0) {
        if (!opts.allowAddRows) {
          return {
            ok: false,
            error:
              `Not enough empty rows. Missing ${firstPlan.pending.length} row(s). Enable \"Add rows when needed\" or add rows manually first.`,
          };
        }

        addedRows = await addRows(firstPlan.pending.length);
      }

      const rowsAfterAdd = collectRows();
      const finalPlan = buildAssignments(desiredRows, rowsAfterAdd);
      if (finalPlan.pending.length > 0) {
        return {
          ok: false,
          error:
            `Could not reserve enough rows. Still missing ${finalPlan.pending.length} row(s). Please add rows manually and rerun.`,
        };
      }

      for (const assignment of finalPlan.assignments) {
        await setLovSequence(assignment.row, assignment.desired);
        setMonFriHours(assignment.row, assignment.desired.hours, opts.overwriteRowHours);
      }

      let clearedRows = 0;
      if (opts.clearUntouchedRows) {
        for (const untouchedRow of finalPlan.untouchedRows) {
          const hasMonFriHours = rowMonFriHours(untouchedRow).some((value) => value !== "");
          if (!hasMonFriHours) {
            continue;
          }
          clearMonFriHours(untouchedRow);
          clearedRows += 1;
        }
      }

      let recalculated = false;
      if (opts.clickRecalculate) {
        recalculated = await clickRecalculateButtonIfPresent();
      }

      const matched = finalPlan.assignments.filter((item) => item.kind === "matched").length;
      const fromEmpty = finalPlan.assignments.filter((item) => item.kind === "empty").length;

      return {
        ok: true,
        message: [
          "Import completed.",
          `Rows imported: ${finalPlan.assignments.length}`,
          `Matched existing rows: ${matched}`,
          `Used empty/new rows: ${fromEmpty}`,
          `Rows added by button: ${addedRows}`,
          `Untouched rows cleared: ${clearedRows}`,
          `Recalculate clicked: ${recalculated ? "yes" : "no"}`,
          "Tip: review values and click Opslaan / Doorgaan yourself.",
        ].join("\n"),
      };
    } catch (error) {
      return {
        ok: false,
        error: String(error),
      };
    }
  })();
}
