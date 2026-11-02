# PreEBS -> EBS Importer (Safari)

This extension pastes a PreEBS export JSON into Oracle EBS timecard fields. The popup and the importer are the same as the Chrome and Firefox extensions. Safari only loads a web extension from a small macOS app, so this folder is wrapped by the Xcode project in `safari-extension/macos`.

## What it does

- Accepts exported PreEBS JSON (`days -> projects -> tasks -> hourTypes`) or a flat `rows[]` payload.
- Matches existing EBS rows by `Project + Taak + Soort` text.
- Uses empty rows when no match exists.
- Optionally clicks `Rij toevoegen` when more rows are needed.
- Fills Mon-Fri hour fields (`B22_<row>_<day>`).
- Lets you slow down field writes when EBS clears values that were entered too quickly.
- Optionally clicks `Opnieuw berekenen`.

## Install (local build)

macOS 13 or later. Xcode is required. A paid Apple Developer membership is not.

1. Open this project in Xcode:
   - `safari-extension/macos/PreEBS EBS Importer/PreEBS EBS Importer.xcodeproj`
2. Select the **PreEBS EBS Importer** scheme and My Mac as the destination.
3. If Xcode asks for a team, choose your Personal Team.
4. Run the app.
5. Click **Quit and Open Safari Settings…** and turn **PreEBS -> EBS Importer** on.
6. Open the EBS timecard page. Click the toolbar button and allow the extension on that website when Safari asks.

Safari hides the extension when the app is only ad-hoc signed, which is what a command-line build without a development team produces. It also ignores an app that lives in `/tmp`. Run from Xcode with your Personal Team, or install the signed app under `~/Applications`. The extension is listed as **PreEBS -> EBS Importer**.

The extension resources in this folder are referenced by the Xcode project. Edit them here, then run the app again.

## Usage

1. Open your EBS timecard page in a Safari tab.
2. Click the extension icon.
3. Paste `preebs-YYYY-MM-DD.json` into the textbox manually.
4. Choose options.
5. Increase `Delay between field updates (ms)` if EBS blanks fields right after import.
6. Click **Run Import**. Keep the popup open until the status says the import finished.
7. Check values in EBS and then click **Opslaan** or **Doorgaan** manually.

## Notes

- The importer targets the EBS field pattern from your sample page:
  - `A24{row}N1display` (Project)
  - `A25{row}N1display` (Taak)
  - `A26{row}N1display` (Soort)
  - `B22_{row}_{day}` (hours)
- Mon-Fri are filled. Weekend columns are left unchanged.
- If LOV validation in your environment is stricter, review and correct any unresolved Project/Taak/Soort fields before saving.
- The containing app does not need to stay running after Safari has enabled the extension.
- Rebuild from Xcode after each change. Safari does not load this folder as an unpacked extension.
