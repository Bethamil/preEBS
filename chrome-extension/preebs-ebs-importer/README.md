# PreEBS -> EBS Importer (Chrome Extension)

This extension pastes a PreEBS export JSON into Oracle EBS timecard fields.

## What it does

- Accepts exported PreEBS JSON (`days -> projects -> tasks -> hourTypes`) or a flat `rows[]` payload.
- Matches existing EBS rows by `Project + Taak + Soort` text.
- Uses empty rows when no match exists.
- Optionally clicks `Rij toevoegen` when more rows are needed.
- Fills Mon-Fri hour fields (`B22_<row>_<day>`).
- Optionally clicks `Opnieuw berekenen`.

## Install (unpacked)

1. Open Chrome: `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder:
   - `/Users/emielbloem/projects/PreEBS/chrome-extension/preebs-ebs-importer`

## Usage

1. Open your EBS timecard page in a tab.
2. Click the extension icon.
3. Paste `preebs-YYYY-MM-DD.json` in the textbox.
4. Choose options.
5. Click **Run Import**.
6. Check values in EBS and then click **Opslaan** or **Doorgaan** manually.

## Notes

- The importer targets the EBS field pattern from your sample page:
  - `A24{row}N1display` (Project)
  - `A25{row}N1display` (Taak)
  - `A26{row}N1display` (Soort)
  - `B22_{row}_{day}` (hours)
- Mon-Fri are filled. Weekend columns are left unchanged.
- If LOV validation in your environment is stricter, review and correct any unresolved Project/Taak/Soort fields before saving.
