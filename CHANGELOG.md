# XO LAB — Changelog

## 5.0.1 — display fix

### Fixed
- **The display no longer jumps, goes black or hides UI when you click a button.** Toggle switches (e.g. Fixed size, Square lock) made the page taller than the window, so clicking one scrolled the whole app up: the top bar disappeared, the preview was cut off and the bottom of the window went black. The app is now locked to the window and only the settings panel scrolls.
- The PROJECT button in the top bar and the COLORS links now scroll just the settings panel instead of the whole app.

## 5.0.0 — Phase 1: desktop apps + foundation

### New
- **Windows and Mac apps.** The same XO LAB as the browser and iPhone, as a real desktop app (Electron 43).
  - Windows 10/11: installer (`XO-LAB-Setup-5.0.0-x64.exe`, `-arm64.exe`) and portable `.exe` versions.
  - Mac: `XO-LAB-5.0.0.dmg` and `XO-LAB-5.0.0.pkg`, one Universal app for Intel and Apple Silicon, macOS 12 Monterey or newer.
  - Runs fully offline from a private `app://` address. Mic, camera and MIDI permissions are built in (macOS asks once).
  - App menu: File (Open Visual / 3D Model / Audio, Open / Save Project), Edit (Undo / Redo), View (Fullscreen), Help (Check for Updates, How to Install).
  - Exports and projects open a normal Save dialog (videos default to your Movies/Videos folder).
  - Remembers window size and position. Trackpad pinch never zooms the interface. The screen stays awake while playing or rendering.
- **One build for everything.** A new GitHub Actions workflow (`build-all.yml`) runs the tests, then builds the iPhone `.ipa`, Windows `.exe` files and Mac `.dmg` + `.pkg` in parallel. A `v*` tag also creates a GitHub Release with all files and `SHA256SUMS.txt`. All builds are unsigned; no paid accounts needed.
- **Projects (.xolab).** Save your media (video / image / 3D model files, audio track, background image), all settings, scenes and filter presets in one file. It opens on iPhone, Windows, Mac and the browser.
  - Media tab → Project → SAVE PROJECT / OPEN PROJECT, or Ctrl/Cmd+S.
  - "Include media files" switch for small settings-only projects.
  - The last 6 projects are kept on the device under **Recent**.
- **Undo / redo** for every setting (50 steps). Use the ↶ ↷ buttons in the top bar, Ctrl/Cmd+Z, or Ctrl/Cmd+Shift+Z / Ctrl+Y. A slider drag counts as one step.
- **Top bar:** undo, redo and the current project name.
- **Scene migration:** scenes and projects from V3/V4 open in V5. New settings get their defaults.
- iPhone app: microphone and camera permission texts added (used by Phase 2 live input and Phase 6 camera).

### Tests
- Browser smoke test: added undo/redo, playback-doesn't-create-undo-steps, project save → reopen round trip (settings, scenes, model, audio), Recent list, zip format and V3 scene migration.
- New desktop smoke test (`npm run test:desktop`) that starts the real desktop app and checks: app:// loading, storage, WebGL2 + WebCodecs, microphone permission, the menu → undo bridge, all 35 GPU filters and a real render export.

### Changed
- `README-SIDELOAD.md` is replaced by `INSTALL.md`, which covers iPhone, Windows and Mac.
- `build-ipa.yml` is replaced by `build-all.yml`.
- Capacitor packages moved to devDependencies so they aren't bundled into the desktop app.

## 3.1.0

### New
- **3D motion system** (3D tab → Motion). Stack any of: auto spin (axis, direction, speed, audio boost), float, breathe, jelly squash & stretch, sway, orbit path (circle / figure 8), tumble, beat bounce, spin kick, glitch jitter, camera orbit, dolly zoom on drops, camera shake. Each has Amount, Speed and an audio band. One-tap presets: STILL, CHILL, CLUB, PEAK, GLITCH.
- **Touch:** drag to rotate and the model keeps gliding (inertia), pinch zooms the 3D camera, double-tap resets the view.
- **Metal materials:** Chrome (real reflections), Brushed metal, and **Liquid mercury** — the surface flows, ripples to the audio and reflects a generated environment (Studio, Neon, Dark club, Sunset; works offline). Settings: metalness, roughness, reflection strength, clear coat, oil-slick shimmer, rim glow + colour, flow speed / scale / wave height / direction, audio band + amount, detail (LOW / MED / HIGH). Low-poly models are smoothed and subdivided automatically so the liquid flows.
- **3D scene effects:** starfield warp, floating particles, audio spectrum ring, retro grid floor, laser fan, fog / haze — all audio-reactive, with colours in the Color tab.
- **12 new filters:** chromatic aberration, zoom blur, tunnel / infinite zoom, invert flash, vignette, colour grade (LUT looks: teal/orange, bleach, cross, noir, neon, sepia, ice), screen shake / punch, solarize, datamosh smear, mirror tiles, hex mosaic, hue cycle / prism. **6 new presets:** HYPERDRIVE, DATAMOSH, NOIR FILM, BASS PUNCH, CHROME DREAM, PRISM.
- **Export now renders instead of recording.** Set it up, preview, then RENDER & EXPORT builds the video frame by frame at full size and frame rate (never drops frames, even on a slow phone).
  - Timeline: audio waveform with draggable IN / OUT, exact time fields, "starts at" delay, fade in / out, export volume.
  - Video source trim (IN / OUT) with Loop / Hold last frame / Black when it ends.
  - Export length: match the audio clip, or a custom length with silence or looping audio.
  - Fade visuals in / out from black. Include or leave out the HUD, strobe and depth of field.
  - Output: aspect, 720p / 1080p / 1440p / 4K / match / custom, 24 / 30 / 60 fps, quality.
  - MP4 (H.264 + AAC) where the device has an AAC encoder (iOS 26+, desktop Chrome / Edge / Safari); otherwise MOV (H.264 + uncompressed PCM) automatically.
  - Progress with frame count, % done, time left and Cancel. Visuals react exactly as in the live preview (the audio is analysed frame by frame the same way).
  - iPhone app: SAVE / SHARE opens the share sheet → Save Video to Photos.
- **iPhone app build:** GitHub Actions workflow (`.github/workflows/build-ipa.yml`) builds an unsigned `XO-LAB.ipa` with Capacitor 7. See README-SIDELOAD.md.
- Double-click launchers: `start.command` (Mac), `start.bat` (Windows).

### Fixed
- Two-finger pinch no longer zooms or resizes the UI (viewport lock, iOS gesture events blocked, pan-only touch action, 16 px form fields so iOS doesn't zoom on focus, web view zoom off in the app).
- iPhone file picker no longer greys out .glb / .fbx / .obj files.
- 3D graphics recover automatically after the system drops the graphics context (previously asked you to re-import).
- Screen stays awake while playing and while rendering.

### Removed
- The old real-time recorder (replaced by the renderer above).
