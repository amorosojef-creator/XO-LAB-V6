# Install XO LAB 5

GitHub builds every version for you: iPhone, Windows and Mac. You don't need Xcode, a developer account or any terminal commands.

| Device | File you install | Works on |
| --- | --- | --- |
| iPhone / iPad | `XO-LAB.ipa` | iPhone with iOS 16.4 or newer (video export needs 16.4+) |
| Windows PC | `XO-LAB-Setup-5.0.0-x64.exe` (most PCs) · `-arm64.exe` (Snapdragon PCs) | Windows 10 and 11, 64-bit |
| Mac | `XO-LAB-5.0.0.dmg` or `XO-LAB-5.0.0.pkg` | macOS 12 Monterey or newer, Intel and Apple Silicon |

> **Why macOS 12?** That's the oldest version the desktop engine (Electron 43) still supports. Older Macs that can't update to Monterey can use the browser version instead (see the end of this page).

---

## Step 1 — Upload to GitHub (once per update)

1. Create a new repo on github.com called **XO-LAB-V5** (Public).
2. Unzip **XO-LAB-V5.zip**.
3. In the repo: **Add file → Upload files**. Drag **everything inside** the unzipped folder in, then press **Commit changes**.
4. **Check the hidden `.github` folder made it.** Your repo must show a `.github` folder.
   - Mac: in the unzipped folder press **Cmd + Shift + .** (period) to show hidden files *before* dragging.
   - If it's still missing, add it by hand (4 clicks): **Add file → Create new file** → type the name `.github/workflows/build-all.yml` → open `workflows/build-all.yml` from the zip in TextEdit, copy everything, paste → **Commit changes**.

## Step 2 — Build

1. Open the **Actions** tab. The build starts by itself after an upload. You can also click **Build XO LAB (iPhone, Windows, Mac)** → **Run workflow**.
2. Wait about 20 minutes for the green ✓ on **iPhone**, **Windows** and **Mac**.
3. Open the finished run and scroll to **Artifacts**:
   - **XO-LAB-iPhone** → `XO-LAB.ipa`
   - **XO-LAB-Windows** → the `.exe` files
   - **XO-LAB-Mac** → the `.dmg` and `.pkg`

   Each one downloads as a zip; unzip it to get the file.

> **Permanent download page (optional):** Releases → **Draft a new release** → tag `v5.0.0` → **Publish**. When the build finishes, every installer is attached to that release.

---

## Step 3 — Install

### Windows

1. Double-click **XO-LAB-Setup-5.0.0-x64.exe**.
2. Blue "Windows protected your PC" box? Click **More info → Run anyway**. (It appears because the app isn't signed with a paid certificate.)
3. Follow the installer. XO LAB appears on your desktop and in the Start menu.

**No install:** `XO-LAB-Portable-5.0.0-x64.exe` runs straight from a USB stick or the Downloads folder.

### Mac — .dmg (recommended)

1. Double-click **XO-LAB-5.0.0.dmg** and drag **XO LAB** onto **Applications**.
2. Open XO LAB from Applications. macOS says it can't check the app — click **Done** (or **OK**).
3. Open **System Settings → Privacy & Security**, scroll down and click **Open Anyway** next to XO LAB, then confirm with your password.
4. From now on it opens normally.

*macOS 12 Monterey:* instead of step 3 you can **right-click XO LAB → Open → Open**.

### Mac — .pkg (installer)

1. Double-click **XO-LAB-5.0.0.pkg**. If macOS blocks it: **System Settings → Privacy & Security → Open Anyway**.
2. Click through the installer. XO LAB is placed in Applications.
3. The first time you open the app, do steps 2–3 from the .dmg section above.

### iPhone

1. Open **Sideloadly** on your computer and plug in your iPhone.
2. Drag **XO-LAB.ipa** into Sideloadly, enter your Apple ID and press **Start**.
3. On the iPhone: **Settings → General → VPN & Device Management** → trust your Apple ID.
   On iOS 16+ also turn on **Settings → Privacy & Security → Developer Mode** (the phone restarts once).

With a free Apple ID the app stops opening after 7 days. Sideload the same IPA again; your settings stay.

---

## First run: microphone and camera

The first time XO LAB uses the mic or camera, your device asks for permission. Click **Allow**.
On a Mac you can change this later in **System Settings → Privacy & Security → Microphone / Camera**.

## Try it without installing

- **Mac:** double-click **start.command** (first time: right-click → Open).
- **Windows:** double-click **start.bat**.

A browser tab opens with XO LAB. This version runs on any computer with a current Chrome, Edge or Safari.

## Browser link (optional)

Repo **Settings → Pages → Build and deployment**: Source **Deploy from a branch**, branch **main**, folder **/ (root)** → **Save**. A minute later XO LAB runs at `https://amorosojef-creator.github.io/XO-LAB-V5/`.

## If a build fails

Open the red run and click the failed job. The error is printed at the bottom. For iPhone builds, a full log is attached as **xcodebuild-log**.
