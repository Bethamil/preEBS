# PreEBS -> EBS Importer (Firefox Extension)

This extension pastes a PreEBS export JSON into Oracle EBS timecard fields.

## What it does

- Accepts exported PreEBS JSON (`days -> projects -> tasks -> hourTypes`) or a flat `rows[]` payload.
- Matches existing EBS rows by `Project + Taak + Soort` text.
- Uses empty rows when no match exists.
- Optionally clicks `Rij toevoegen` when more rows are needed.
- Fills Mon-Fri hour fields (`B22_<row>_<day>`).
- Lets you slow down field writes when EBS clears values that were entered too quickly.
- Optionally clicks `Opnieuw berekenen`.

## Install (temporary add-on)

1. Open Firefox: `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**
3. Select this file:
   - `/Users/emielbloem/projects/PreEBS/firefox-extension/preebs-ebs-importer/manifest.json`

## Usage

1. Open your EBS timecard page in a Firefox tab.
2. Click the extension icon.
3. Paste `preebs-YYYY-MM-DD.json` into the textbox manually.
4. Choose options.
5. Increase `Delay between field updates (ms)` if EBS blanks fields right after import.
6. Click **Run Import**.
7. Check values in EBS and then click **Opslaan** or **Doorgaan** manually.

## Notes

- The importer targets the EBS field pattern from your sample page:
  - `A24{row}N1display` (Project)
  - `A25{row}N1display` (Taak)
  - `A26{row}N1display` (Soort)
  - `B22_{row}_{day}` (hours)
- Mon-Fri are filled. Weekend columns are left unchanged.
- If LOV validation in your environment is stricter, review and correct any unresolved Project/Taak/Soort fields before saving.
- Firefox temporary add-ons are removed when Firefox restarts unless you sign/package the extension for distribution.
