# XO LAB 5 — device checklist

The automatic tests run on every build (Actions tab → **Test** jobs). They can't touch a real phone, PC or Mac, so tick these by hand after installing a new build.

## 5.1.0 — advanced MIDI (Mac / Windows, with a controller)
- [ ] MIDI tab shows the controller's name after plugging it in
- [ ] Load your controller's starter profile (if listed); move each fader / knob: the right slider follows. Note any that don't: ______
- [ ] MIDI LEARN a knob → it says "Knob"; an endless encoder → "Endless encoder" and turning both ways works
- [ ] Fader with soft takeover: load a different scene, move the fader — the value only moves after the fader passes the on-screen value
- [ ] Pad on Blackout: screen goes black only while held
- [ ] Pad with velocity on a slider: soft hit = small value, hard hit = big value
- [ ] SHIFT button + a knob controls a second setting
- [ ] Crossfader mapped to "Crossfade Scene A ↔ B": sliding morphs between the two scenes
- [ ] MIDI clock from your DJ software / mixer: BPM shows MIDI CLOCK and matches
- [ ] LED feedback on: pad lights follow switches and scene slots
- [ ] Moving many faders fast keeps the preview smooth

## 5.0.1 — live input and MIDI

### Mac
- [ ] Media tab → Live input → START LIVE AUDIO → macOS asks for the microphone → Allow → the meter moves when you talk or play music
- [ ] Music through the speakers: the LEDs and effects react; no feedback howl
- [ ] START CAMERA → macOS asks for the camera → Allow → your FaceTime camera fills the stage; blob boxes follow you
- [ ] Mirror camera switch flips the picture
- [ ] Plug in a MIDI controller → MIDI panel shows its name → MIDI LEARN → click a slider → turn a knob → the slider follows
- [ ] MIDI LEARN → click a scene's LOAD → hit a pad → the pad loads the scene

### Windows
- [ ] Same as Mac (Windows asks for mic/camera the first time in Settings → Privacy if blocked)

### iPhone
- [ ] START LIVE AUDIO → allow microphone → visuals react to the room
- [ ] START CAMERA → allow camera → ⇄ switches front / back
- [ ] MIDI panel says iPhone doesn't support MIDI

## Phase 1

### Mac (your MacBook)
- [ ] `.dmg` opens, drag to Applications works
- [ ] First open: warning → **Privacy & Security → Open Anyway** → app opens
- [ ] `.pkg` installs to Applications and opens
- [ ] Load a video + audio, press play: smooth preview, LEDs react
- [ ] Load a 3D model; liquid mercury works
- [ ] File ▸ Save Project → Save dialog → `.xolab` saved; File ▸ Open Project reopens it with media
- [ ] Edit ▸ Undo / Redo (Cmd+Z / Shift+Cmd+Z) change settings back and forth
- [ ] Export tab → RENDER & EXPORT → Save dialog → the video plays in QuickTime
- [ ] Note the export format shown (MP4 or MOV): ______
- [ ] Trackpad pinch does not zoom the interface
- [ ] View ▸ Toggle Full Screen works
- [ ] Quit and reopen: window comes back at the same size and position

### Windows PC
- [ ] Installer: **More info → Run anyway** → installs, desktop shortcut appears
- [ ] Portable `.exe` opens without installing
- [ ] Same checks as Mac: play, 3D, save/open project, Ctrl+Z / Ctrl+Y, render & export, fullscreen
- [ ] Note the export format shown (MP4 or MOV): ______

### iPhone
- [ ] IPA sideloads and opens
- [ ] Two-finger pinch does not resize the interface
- [ ] Save Project → share sheet → Save to Files works; Open Project from Files reopens it
- [ ] Undo / redo buttons in the top bar work
- [ ] Render & export → SAVE / SHARE → Save Video to Photos

### Browser (GitHub Pages or start.command / start.bat)
- [ ] Opens, plays, exports
- [ ] Save Project downloads a `.xolab` file; Open Project reopens it
