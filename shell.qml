// Spotify player overlay. Resident and hidden; the keybind toggles it. Design: "Spotify Player Design" in Figma, no-glass variant.
//   qs -c music                         start (autostart.lua does this)
//   qs -c music ipc call music toggle   open/close (Alt+S)
//   qs -c music ipc call music search "text"   open with the search already filled in (testing)
// YouTube mode: shown while a browser Picture-in-Picture window exists; its video is shown live in the middle.
// Keys: Enter search, Space pause, Left/Right prev/next, D Spotify DJ, B background look, Escape close. In search: Up/Down + Enter plays, Shift+Enter or + adds to the queue, Escape goes back.
// Closing keeps the music playing (the hidden official Spotify app plays it; it starts on first open, quits after 10 idle minutes).
// Spotify and LRCLIB calls go through ./spot. assets/ holds the pre-rendered mesh, grain, vignette and record.
import QtQuick
import QtQuick.Effects
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import Quickshell.Widgets
import Quickshell.Hyprland
import Quickshell.Services.Mpris

ShellRoot {
    id: root
    readonly property string dir: Quickshell.env("HOME") + "/.config/quickshell/music"
    readonly property string spot: dir + "/spot"
    readonly property string fontName: "Euclid Circular A"
    readonly property int lyricOffset: 0   // ms; raise if lyrics lag the audio, lower if they run ahead

    property bool shown: false
    property bool searching: false
    property var results: []
    property string resultsFor: ""
    property int selected: 0
    property string error: ""
    property var now: ({})          // {uri,name,artist,album,art,ms,playing,pos,volume}
    property var queue: []
    property var removed: []        // Spotify has no "remove from queue" call: these are hidden here and skipped when they come up
    readonly property var upNext: queue.filter(t => !removed.includes(t.uri)).slice(0, 3)
    property real position: 0
    property var lyrics: []
    property bool synced: false
    property string lyricsFor: ""
    property string lyricsNote: ""
    property var bars: []
    property int volume: now.volume === undefined ? 0 : now.volume

    readonly property bool playing: now.playing === true
    readonly property int activeLine: {
        if (!synced) return -1;
        let i = 0;
        while (i + 1 < lyrics.length && lyrics[i + 1].t <= position + lyricOffset) i++;
        return i;
    }

    // Same order as GENRE_RULES in ./spot: base, three streak colours
    readonly property var genres: [
        ["#100a1a", "#a8406f", "#d79a92", "#4c3580"],   // pop
        ["#0b0a18", "#8e2a1c", "#c27a24", "#3a2a6a"],   // hip-hop / rap
        ["#0f0814", "#7a2a58", "#b98742", "#351a50"],   // r&b / soul
        ["#0c0a0c", "#8c2228", "#a84f2a", "#2e2a30"],   // rock
        ["#06070a", "#4c1214", "#67747e", "#1a1e26"],   // metal
        ["#060a18", "#1f8fa0", "#7fa63a", "#3a2a96"],   // electronic / dance
        ["#070d18", "#234a86", "#a9853e", "#155560"],   // jazz / blues
        ["#0d1216", "#5f7f98", "#bfb48f", "#4a6660"]    // classical / ambient
    ]
    property int genre: 1
    property string genreFor: ""
    property color c0: genres[genre][0]
    property color c1: genres[genre][1]
    property color c2: genres[genre][2]
    property color c3: genres[genre][3]
    Behavior on c0 { ColorAnimation { duration: 1200 } }
    Behavior on c1 { ColorAnimation { duration: 1200 } }
    Behavior on c2 { ColorAnimation { duration: 1200 } }
    Behavior on c3 { ColorAnimation { duration: 1200 } }
    function alpha(c, a) { return Qt.rgba(c.r, c.g, c.b, a); }

    Component {
        id: job
        Process {
            id: p
            property var done: null
            running: true
            stdout: StdioCollector {
                onStreamFinished: {
                    let v = null;
                    try { v = JSON.parse(text); } catch (e) { /* killed or empty */ }
                    if (v && v.error) root.error = v.error;
                    else if (v && p.done) { root.error = ""; p.done(v); }
                    p.destroy();
                }
            }
        }
    }
    function run(args, done) { job.createObject(root, { command: [spot].concat(args), done: done || null }); }

    property var openScreen: Quickshell.screens[0]      // chosen once on open, so moving the mouse to another monitor doesn't drag it along
    function open() { openScreen = Quickshell.screens.find(s => s.name === Hyprland.focusedMonitor?.name) ?? Quickshell.screens[0]; idleMinutes = 0; run(["ensure"]); refresh(); shown = true; }
    function refresh() {
        run(["status"], s => {
            now = s; position = s.pos || 0; lastTick = Date.now();
            if (s.uri && removed.includes(s.uri)) { removed = removed.filter(u => u !== s.uri); control(["next"]); return; }
            if (s.uri && s.uri !== lyricsFor) { loadLyrics(s); loadQueue(); }
            const artist = (s.artist || "").split(",")[0];
            if (s.uri && artist && artist !== genreFor) {
                genreFor = artist;
                run(["genre", artist], g => { if (g.artist === genreFor) genre = g.genre; });
            }
        });
    }
    function loadQueue() {
        run(["queue"], q => { queue = q.items; removed = removed.filter(u => q.items.some(t => t.uri === u)); });
    }
    function loadLyrics(s) {
        lyricsFor = s.uri; lyrics = []; synced = false; lyricsNote = "Finding lyrics…";
        run(["lyrics", s.uri, s.artist, s.name, s.album, String(Math.round(s.ms / 1000))], l => {
            if (l.uri !== lyricsFor) return;
            lyrics = l.synced ? l.lines.filter(x => x.l.trim() !== "") : l.lines;
            synced = l.synced;
            lyricsNote = l.lines.length ? "" : "No lyrics found for this song";
        });
    }
    function control(args) { run(args, () => settle.restart()); }
    function search(q) {
        if (!q.trim()) { results = []; resultsFor = ""; return; }
        run(["search", q], r => { if (r.q === input.text) { results = r.items; resultsFor = r.q; selected = 0; } });
    }
    function openSearch() { searching = true; input.text = ""; results = []; resultsFor = ""; input.forceActiveFocus(); }
    function closeSearch() { searching = false; keys.forceActiveFocus(); }
    function play(i) {
        if (!results[i]) return;
        run(["play", results[i].uri], () => settle.restart());
        closeSearch();
    }
    function startDj() { run(["dj"], () => settle.restart()); settle.restart(); }
    property string addedNote: ""
    function addToQueue(i) {
        const song = results[i];
        if (!song) return;
        run(["add", song.uri], () => {
            addedNote = "Added to queue: " + song.name;
            noteTimer.restart();
            loadQueue();
        });
    }
    function seek(ms) { position = ms; lastTick = Date.now(); control(["seek", String(Math.round(ms))]); }
    function setVolume(v) { volume = v; control(["volume", String(v)]); }
    function clock(ms) {
        const s = Math.floor((ms || 0) / 1000);
        return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    }

    IpcHandler {
        target: "music"
        function toggle(): void { root.shown ? root.shown = false : root.open() }
        function open(): void { root.open() }
        function close(): void { root.shown = false }
        function style(i: int): void { root.setStyle(i) }
        function ytstyle(i: int): void { root.ytStyle = i }
        function search(q: string): void { root.open(); root.openSearch(); input.text = q }
    }

    // ---- YouTube mode ----
    readonly property string pipTitle: Quickshell.env("MUSIC_PIP_TITLE") || "Picture-in-Picture"   // env override is for testing
    readonly property var pipWindow: Hyprland.toplevels.values.find(t => t.title === pipTitle) ?? null
    readonly property bool ytMode: pipWindow !== null
    readonly property var ytPlayer: {
        const ps = Mpris.players.values.filter(p => /firefox|chrom|brave|vivaldi|zen/i.test(p.identity + " " + p.desktopEntry));
        return ps.find(p => p.isPlaying) ?? ps[0] ?? null;
    }
    readonly property bool ytHasLength: ytPlayer !== null && ytPlayer.lengthSupported && ytPlayer.length > 1    // Firefox often reports no length for YouTube
    readonly property bool ytPlaying: ytMode && ytPlayer !== null && ytPlayer.isPlaying
    readonly property var ytStyles: ["Cosmic"]      // one design for now; more themes will get their own designs
    readonly property var ytPalettes: [            // warm, highlight, middle, cool
        ["#ff5a1f", "#ffb15a", "#2f8a4a", "#1d5f86"],
        ["#ff3d7f", "#ffb347", "#7a3cff", "#2a3a9a"],
        ["#1fb5c9", "#7ff0d8", "#2a5fb8", "#3a2a7a"],
        ["#ff7a1a", "#ffd27a", "#b3361f", "#5a2a12"]
    ]
    // Cosmic: the colours slowly travel through these palettes, about 40 seconds each, blending in between
    function mixc(a, b, t) { a = Qt.color(a); b = Qt.color(b); return Qt.rgba(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, 1); }
    readonly property real cosmicPhase: (seconds / 40) % ytPalettes.length
    function cosmicColor(k) {
        const i = Math.floor(cosmicPhase), t = cosmicPhase - i, e = t * t * (3 - 2 * t);
        return mixc(ytPalettes[i][k], ytPalettes[(i + 1) % ytPalettes.length][k], e);
    }
    readonly property string monoFont: "JetBrainsMono Nerd Font"
    readonly property color ink: "#ead8b8"
    property int ytStyle: 0
    // While the player shows it, the Picture-in-Picture window is made full size (sharp video) and tucked away on a
    // hidden workspace; when the player closes it goes back to where it was, at its old size.
    readonly property bool pipInUse: shown && ytMode
    property var pipSaved: null
    function hypr(expr) { Quickshell.execDetached(["hyprctl", "dispatch", expr]); }
    onPipInUseChanged: {
        if (pipInUse) {
            pipInfo.addr = "0x" + pipWindow.address;
            pipInfo.running = true;     // read its current place fresh (the cached copy can be out of date), then tuck it away
        } else if (pipSaved) {
            const p = pipSaved;
            pipSaved = null;
            if (!Hyprland.toplevels.values.some(t => "address:0x" + t.address === p.addr)) return;
            const ws = p.ws ? p.ws : String(Hyprland.focusedWorkspace ? Hyprland.focusedWorkspace.name : 1);
            hypr('hl.dsp.window.move({ workspace = "' + ws + '", window = "' + p.addr + '", follow = false })');
            hypr('hl.dsp.window.resize({ x = ' + p.size[0] + ', y = ' + p.size[1] + ', window = "' + p.addr + '" })');
            if (p.at) hypr('hl.dsp.window.move({ x = ' + p.at[0] + ', y = ' + p.at[1] + ', window = "' + p.addr + '" })');
            if (p.pinned) hypr('hl.dsp.window.pin({ action = "enable", window = "' + p.addr + '" })');
        }
    }
    function tuckPip(c) {
        const a = "address:" + c.address;
        pipSaved = { addr: a, size: c.size, at: c.at, pinned: c.pinned === true, ws: c.workspace ? c.workspace.name : "" };
            captureReady = false;
            hypr('hl.dsp.window.pin({ action = "disable", window = "' + a + '" })');      // Firefox pins it; pinned windows can't change workspace
            hypr('hl.dsp.window.float({ action = "enable", window = "' + a + '" })');
            hypr('hl.dsp.window.resize({ x = 1920, y = 1080, window = "' + a + '" })');
            hypr('hl.dsp.window.move({ workspace = "special:pip", window = "' + a + '", follow = false })');
            captureDelay.restart();     // start capturing once the window has its new size
    }
    Process {
        id: pipInfo
        property string addr: ""
        command: ["hyprctl", "clients", "-j"]
        stdout: StdioCollector {
            onStreamFinished: {
                let c = null;
                try { c = JSON.parse(text).find(w => w.address === pipInfo.addr); } catch (e) {}
                if (c && root.pipInUse) root.tuckPip(c);
            }
        }
    }
    property bool captureReady: false
    Timer { id: captureDelay; interval: 450; onTriggered: root.captureReady = true }
    function ytToggle() { if (ytPlayer) ytPlayer.togglePlaying(); }
    Timer { running: root.shown && root.ytMode && root.ytPlayer !== null; interval: 500; repeat: true; onTriggered: root.ytPlayer.positionChanged() }

    property real lastTick: 0
    Timer {     // smooth position between polls
        running: root.shown && root.playing
        interval: 100; repeat: true
        onTriggered: { const t = Date.now(); root.position += t - root.lastTick; root.lastTick = t; }
    }
    Timer { running: root.shown || root.removed.length > 0; interval: 3000; repeat: true; onTriggered: root.refresh() }
    Timer { id: settle; interval: 500; onTriggered: root.refresh() }   // Spotify's state lags a command slightly
    Timer { id: noteTimer; interval: 3000; onTriggered: root.addedNote = "" }
    Timer { id: debounce; interval: 280; onTriggered: root.search(input.text) }

    // The Spotify app only runs on demand: quit it after this long closed + not playing.
    readonly property int quitAfterMinutes: 10
    property int idleMinutes: 0
    Timer {
        running: !root.shown
        interval: 60000; repeat: true
        onTriggered: root.run(["idle"], r => {
            if (!r.running || r.playing) { root.idleMinutes = 0; return; }
            if (++root.idleMinutes >= root.quitAfterMinutes) { root.idleMinutes = 0; root.run(["quit"]); }
        })
    }

    // Bass drives the background. Rises fairly quickly, falls slowly, so it swells instead of snapping on every kick.
    readonly property real beatAmount: 1    // raise for a stronger reaction, lower for calmer
    property real flow: 0
    property real energy: 0
    // Fabric: the folds near the pointer get dragged a little as it moves, then settle back. Not a follow effect.
    // Background looks, all driven by the same folds, colours, bass and mouse. B cycles them.
    readonly property var bgStyles: ["Silk", "Water", "Starfield", "Lava lamp", "Pixel beach", "Cosmic"]
    // Cosmic on the Spotify player follows the genre: its rim colours come from the genre palette
    readonly property var cosmicSpotify: [Qt.lighter(c1, 1.6), Qt.lighter(c2, 1.4), Qt.lighter(c3, 1.6), Qt.lighter(c1, 1.1)]
    property int bgStyle: 0
    property real seconds: 0
    property string styleNote: ""
    function nextStyle() {
        if (ytMode) { ytStyle = (ytStyle + 1) % ytStyles.length; styleNote = "Background: " + ytStyles[ytStyle]; styleTimer.restart(); }
        else setStyle((bgStyle + 1) % bgStyles.length);
    }
    function setStyle(i) { bgStyle = i; styleNote = "Background: " + bgStyles[i]; styleTimer.restart(); }
    Timer { id: styleTimer; interval: 1500; onTriggered: root.styleNote = "" }
    readonly property real fabricAmount: 0.28  // raise for a stronger pull, 0 turns it off
    property vector2d pointer: Qt.vector2d(99, 99)      // far off-screen until the mouse is over the player
    property vector2d lag: Qt.vector2d(99, 99)
    property vector4d bassDrop: Qt.vector4d(0, 0, 0, 0)   // the jolt handed to the next simulation step
    property var pendingDrops: []
    property real quakeReadyAt: 0
    property var quakeBag: []
    function nextDrop() {      // called once per simulation step, so no jolt is missed between steps
        const i = pendingDrops.findIndex(d => d.at <= seconds);
        if (i < 0) { bassDrop = Qt.vector4d(0, 0, 0, 0); return; }
        const d = pendingDrops.splice(i, 1)[0];
        bassDrop = Qt.vector4d(d.x, d.y, 0.45, 0);
    }
    property real lastEnergy: 0
    property real slowEnergy: 0
    property real ripplePush: 0        // mouse speed, turned into a push on the water
    property vector2d lastPointer: Qt.vector2d(99, 99)
    property vector2d slowPointer: Qt.vector2d(99, 99)     // follows the mouse over a couple of seconds
    FrameAnimation {
        running: root.shown
        onTriggered: {
            const dt = Math.min(0.05, frameTime);
            const bass = (root.playing || root.ytPlaying) && root.bars.length ? ((root.bars[0] || 0) + (root.bars[1] || 0) + (root.bars[2] || 0)) / 300 : 0;
            const target = Math.min(1, bass * root.beatAmount);
            root.energy += (target - root.energy) * (1 - Math.exp(-dt * (target > root.energy ? 5 : 1.6)));
            root.flow += dt * (0.24 + 0.3 * root.energy);
            root.seconds += dt;
            const moved = root.pointer.x > 90 || root.lastPointer.x > 90 ? 0 : Math.hypot(root.pointer.x - root.lastPointer.x, root.pointer.y - root.lastPointer.y);
            root.ripplePush = Math.min(moved * 2.0, 0.5);
            root.lastPointer = root.pointer;
            const a = win.width / win.height;
            // On a bass hit, a small "quake": 3 to 5 jolts close together in a random area, a moment apart
            root.slowEnergy += (root.energy - root.slowEnergy) * (1 - Math.exp(-dt * 1.5));
            // a hit = the bass jumping above its recent level (comparing frame to frame missed hits at 144 Hz)
            if (root.bgStyle === 1 && !root.ytMode && root.energy - root.slowEnergy > 0.08 && root.seconds > root.quakeReadyAt) {
                if (root.quakeBag.length === 0)       // deal the screen out in a 4x3 grid, shuffled, so quakes spread evenly
                    root.quakeBag = [...Array(12).keys()].sort(() => Math.random() - 0.5);
                const cell = root.quakeBag.pop();
                const cx = ((cell % 4 + Math.random()) / 4 - 0.5) * 1.8 * a, cy = ((Math.floor(cell / 4) + Math.random()) / 3 - 0.5) * 1.8;
                const n = 3 + Math.floor(Math.random() * 2);
                for (let i = 0; i < n; i++)
                    root.pendingDrops.push({ x: cx + (Math.random() - 0.5) * 0.45, y: cy + (Math.random() - 0.5) * 0.45, at: root.seconds + i * 0.07 });
                root.quakeReadyAt = root.seconds + 0.55;
            }
            root.lastEnergy = root.energy;
            const k = 1 - Math.exp(-dt * 3);         // how fast the fabric catches up with the pointer
            const ks = 1 - Math.exp(-dt * 0.8);
            root.slowPointer = Qt.vector2d(root.slowPointer.x + (root.pointer.x - root.slowPointer.x) * ks, root.slowPointer.y + (root.pointer.y - root.slowPointer.y) * ks);
            root.lag = Qt.vector2d(root.lag.x + (root.pointer.x - root.lag.x) * k, root.lag.y + (root.pointer.y - root.lag.y) * k);
        }
    }

    Process {
        running: root.shown && (root.playing || root.ytPlaying)
        command: ["cava", "-p", root.dir + "/cava.conf"]
        stdout: SplitParser { onRead: data => root.bars = data.split(";").filter(v => v !== "").map(Number) }
        onRunningChanged: if (!running) root.bars = []
    }

    component Label: Text {
        font.family: root.fontName
        font.weight: Font.Medium
        color: "white"
        renderType: Text.NativeRendering
    }

    component IconButton: Item {
        id: btn
        required property string icon
        property int size: 24
        signal clicked()
        width: 40; height: 40
        Image { anchors.centerIn: parent; width: btn.size; height: btn.size; sourceSize: Qt.size(48, 48); source: "file://" + root.dir + "/assets/" + btn.icon + ".svg" }
        MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: { btn.clicked(); keys.forceActiveFocus(); } }
    }

    component Rail: Item {
        id: rail
        property real fraction: 0
        signal picked(real f)
        height: 20
        Rectangle { anchors.verticalCenter: parent.verticalCenter; width: parent.width; height: 3; color: Qt.rgba(1, 1, 1, 0.26) }
        Rectangle { anchors.verticalCenter: parent.verticalCenter; width: parent.width * Math.max(0, Math.min(1, rail.fraction)); height: 3; color: "white" }
        MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: m => rail.picked(m.x / width) }
    }

    component SongRow: Item {
        id: sr
        required property var song
        property bool selected: false
        signal clicked()
        signal added()
        height: 72
        Rectangle { anchors.fill: parent; radius: 8; visible: sr.selected; color: Qt.tint("#08070c", root.alpha(root.c1, 0.7)) }
        ClippingRectangle {
            id: thumb
            x: 10; anchors.verticalCenter: parent.verticalCenter
            width: 52; height: 52; radius: 10; color: "#222"
            Image { anchors.fill: parent; source: sr.song.thumb || ""; asynchronous: true; fillMode: Image.PreserveAspectCrop }
        }
        Column {
            anchors { left: thumb.right; leftMargin: 14; right: parent.right; rightMargin: 60; verticalCenter: parent.verticalCenter }
            Label { width: parent.width; text: sr.song.name; font.pixelSize: 18; elide: Text.ElideRight }
            Label { width: parent.width; text: sr.song.artist; font.pixelSize: 14; opacity: 0.72; elide: Text.ElideRight }
        }
        MouseArea { anchors.fill: parent; onClicked: sr.clicked() }
        Item {      // add to queue
            anchors { right: parent.right; rightMargin: 8; verticalCenter: parent.verticalCenter }
            width: 44; height: 44
            Label { anchors.centerIn: parent; text: "+"; font.pixelSize: 30; opacity: 0.85 }
            MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: sr.added() }
        }
    }

    PanelWindow {
        id: win
        visible: root.shown
        screen: root.openScreen
        anchors { top: true; bottom: true; left: true; right: true }
        exclusionMode: ExclusionMode.Ignore
        WlrLayershell.layer: WlrLayer.Overlay
        WlrLayershell.keyboardFocus: root.shown ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None
        WlrLayershell.namespace: "music"
        color: root.c0
        onVisibleChanged: if (visible) { root.searching = false; keys.forceActiveFocus(); }

        IdleInhibitor { window: win; enabled: root.shown }     // no screen-off, lock or sleep from idling while the player is open

        // ---- background: silk folds that swell with the bass, then the filmed-monitor texture ----
        // Water: a small ripple simulation that feeds back into itself every frame.
        // Only exists while the player is open on that background: moving it between monitors crashes Qt.
        Loader {
            id: rippleLoader
            active: root.shown && root.bgStyle === 1 && !root.ytMode
            sourceComponent: Item {
                property alias texture: ripples
                ShaderEffectSource {
                    id: ripples
                    sourceItem: rippleSim
                    recursive: true
                    live: false                         // stepped by the timer below, so ripple speed doesn't depend on the monitor's refresh rate
                    format: ShaderEffectSource.RGBA16F
                    textureSize: Qt.size(320, 180)
                    visible: false
                }
                Timer { interval: 16; running: true; repeat: true; onTriggered: { root.nextDrop(); ripples.scheduleUpdate(); } }   // about 60 simulation steps a second
                ShaderEffect {
                    id: rippleSim
                    x: -400; width: 320; height: 180     // parked off-screen: only the capture above reads it
                    fragmentShader: "file://" + root.dir + "/assets/ripples.frag.qsb"
                    property var src: ripples
                    property vector2d texel: Qt.vector2d(1 / 320, 1 / 180)
                    property real aspect: win.width / win.height
                    property vector2d mouse: root.pointer
                    property real push: root.ripplePush
                    property real tick: root.seconds
                    property vector4d drop: root.bassDrop
                }
            }
        }
        Rectangle { id: blank; width: 1; height: 1; color: "black"; visible: false; layer.enabled: true }   // stand-in texture when there is no simulation
        ShaderEffect {
            anchors.fill: parent
            fragmentShader: "file://" + root.dir + "/assets/folds.frag.qsb"
            property var water: rippleLoader.item ? rippleLoader.item.texture : blank
            property real flow: root.flow
            property real energy: root.energy
            property real aspect: win.width / win.height
            property vector2d mouse: root.pointer
            property real style: root.ytMode ? 5 : root.bgStyle
            property real clock: root.seconds
            property vector2d slowMouse: root.slowPointer
            property vector2d drag: {
                const dx = (root.pointer.x - root.lag.x) * root.fabricAmount, dy = (root.pointer.y - root.lag.y) * root.fabricAmount;
                const len = Math.hypot(dx, dy), cap = 0.11;
                return len > cap ? Qt.vector2d(dx * cap / len, dy * cap / len) : Qt.vector2d(dx, dy);
            }
            HoverHandler {
                onPointChanged: {
                    const a = win.width / win.height;
                    root.pointer = Qt.vector2d((point.position.x / win.width - 0.5) * a * 2, (point.position.y / win.height - 0.5) * 2);
                }
                onHoveredChanged: {        // entering isn't a drag; leaving parks the pointer off-screen so nothing reacts to it
                    if (hovered) { root.lag = root.pointer; root.slowPointer = root.pointer; }
                    else root.pointer = root.lag = root.slowPointer = Qt.vector2d(99, 99);
                }
            }
            property color c0: root.ytMode ? root.cosmicColor(0) : root.bgStyle === 5 ? root.cosmicSpotify[0] : root.c0
            property color c1: root.ytMode ? root.cosmicColor(1) : root.bgStyle === 5 ? root.cosmicSpotify[1] : root.c1
            property color c2: root.ytMode ? root.cosmicColor(2) : root.bgStyle === 5 ? root.cosmicSpotify[2] : root.c2
            property color c3: root.ytMode ? root.cosmicColor(3) : root.bgStyle === 5 ? root.cosmicSpotify[3] : root.c3
            layer.enabled: true                     // drawn small and stretched: the look is soft, and it keeps the GPU cost low
            layer.textureSize: Qt.size(960, 540)
            layer.smooth: true
        }
        Image { visible: !root.ytMode; anchors.fill: parent; source: "file://" + root.dir + "/assets/mesh.png"; fillMode: Image.Tile; smooth: false; horizontalAlignment: Image.AlignLeft; verticalAlignment: Image.AlignTop }
        Image {     // film grain, jumped to a random spot 4 times a second so it shifts gently
            id: grain
            visible: !root.ytMode
            x: -220; y: -220; width: parent.width + 220; height: parent.height + 220
            source: "file://" + root.dir + "/assets/grain.png"; fillMode: Image.Tile; opacity: 0.3
            horizontalAlignment: Image.AlignLeft; verticalAlignment: Image.AlignTop
            Timer {
                running: root.shown; interval: 250; repeat: true
                onTriggered: { grain.x = -Math.floor(Math.random() * 220); grain.y = -Math.floor(Math.random() * 220); }
            }
        }
        ShaderEffect {      // YouTube mode: each background's own filter, at full resolution
            anchors.fill: parent
            visible: root.ytMode
            fragmentShader: "file://" + root.dir + "/assets/ytfilter.frag.qsb"
            property real clock: root.seconds
            property vector2d size: Qt.vector2d(width, height)
            property real grain: 0.13
            property real lines: 0
            property real edge: 0
        }
        Image { anchors.fill: parent; source: "file://" + root.dir + "/assets/vignette.png" }

        // ---- everything else is laid out at 1920x1080 and scaled to the screen ----
        Item {
            width: 1920; height: 1080
            anchors.centerIn: parent
            scale: Math.min(win.width / 1920, win.height / 1080)

            Item { id: keys; focus: true
                Keys.onReturnPressed: root.openSearch()
                Keys.onEnterPressed: root.openSearch()
                Keys.onEscapePressed: root.shown = false
                Keys.onSpacePressed: root.ytMode ? root.ytToggle() : root.control(["toggle"])
                Keys.onLeftPressed: root.control(["prev"])
                Keys.onRightPressed: root.control(["next"])
                Keys.onPressed: e => { if (e.key === Qt.Key_D) root.startDj(); else if (e.key === Qt.Key_B) root.nextStyle(); }
            }

            // left column: title, record, queue
            Column {
                visible: !root.ytMode
                x: 110; width: 440
                y: root.upNext.length > 0 ? 136 : 262        // no queue (DJ mode): centre the title and record vertically
                Behavior on y { NumberAnimation { duration: 400; easing.type: Easing.OutCubic } }
                Label { width: parent.width; horizontalAlignment: Text.AlignHCenter; text: root.now.name || "Nothing playing"; font.pixelSize: 44; font.weight: Font.DemiBold; elide: Text.ElideRight }
                Label { width: parent.width; topPadding: 6; horizontalAlignment: Text.AlignHCenter; text: root.now.artist || "Press Enter to search"; font.pixelSize: 22; opacity: 0.75; elide: Text.ElideRight }
                Item { width: 1; height: 36 }
                Item {
                    width: 400; height: 400
                    anchors.horizontalCenter: parent.horizontalCenter
                Item {
                    id: disc
                    anchors.fill: parent
                    RotationAnimator on rotation { from: 0; to: 360; duration: 8000; loops: Animation.Infinite; running: root.shown; paused: root.shown && !root.playing }
                    Image { anchors.fill: parent; source: "file://" + root.dir + "/assets/disc.png"; sourceSize: Qt.size(800, 800); smooth: true; mipmap: true }
                    ClippingRectangle {
                        anchors.centerIn: parent
                        width: 206; height: 206; radius: 103; color: "#141216"
                        Image { anchors.fill: parent; source: root.now.art || ""; sourceSize: Qt.size(412, 412); asynchronous: true; fillMode: Image.PreserveAspectCrop }
                    }
                    Rectangle { anchors.centerIn: parent; width: 12; height: 12; radius: 6; color: "#0b0a0c"; border.width: 1; border.color: Qt.rgba(1, 1, 1, 0.35) }
                }
                    Image { anchors.fill: parent; source: "file://" + root.dir + "/assets/disc-light.png"; sourceSize: Qt.size(800, 800); smooth: true; mipmap: true }  // light stays put while the disc spins
                    // the record's own filter: a genre tint plus grid and grain, held still over the spinning disc
                    Rectangle { anchors.fill: parent; radius: 200; color: root.alpha(root.c1, 0.06) }
                    Image { anchors.fill: parent; source: "file://" + root.dir + "/assets/disc-filter.png"; sourceSize: Qt.size(800, 800); smooth: true; mipmap: true }
                }
                Item { width: 1; height: 34 }
                Label { visible: root.upNext.length > 0; text: "Up next"; font.pixelSize: 16; font.weight: Font.DemiBold; opacity: 0.75; bottomPadding: 6 }
                Repeater {
                    model: root.upNext
                    Item {
                        id: q
                        required property var modelData
                        width: 440; height: 60
                        ClippingRectangle {
                            id: qt
                            anchors.verticalCenter: parent.verticalCenter
                            width: 52; height: 52; radius: 10; color: "#222"
                            Image { anchors.fill: parent; source: q.modelData.thumb || ""; asynchronous: true; fillMode: Image.PreserveAspectCrop }
                        }
                        Column {
                            anchors { left: qt.right; leftMargin: 14; right: parent.right; verticalCenter: parent.verticalCenter }
                            Label { width: parent.width; text: q.modelData.name; font.pixelSize: 18; elide: Text.ElideRight }
                            Label { width: parent.width; text: q.modelData.artist; font.pixelSize: 14; opacity: 0.72; elide: Text.ElideRight }
                        }
                        MouseArea {     // left click plays it now, right click removes it
                            anchors.fill: parent
                            acceptedButtons: Qt.LeftButton | Qt.RightButton
                            cursorShape: Qt.PointingHandCursor
                            onClicked: m => {
                                if (m.button === Qt.RightButton) root.removed = root.removed.concat(q.modelData.uri);
                                else root.control(["skip", String(root.queue.findIndex(t => t.uri === q.modelData.uri) + 1)]);
                            }
                        }
                    }
                }
            }

            // lyrics: one tall column that slides, so the centre line is always the focused one
            Item {
                visible: !root.ytMode
                x: 860; y: 200; width: 760; height: 680
                clip: true
                property real scrolled: 0       // plain (untimed) lyrics scroll with the wheel
                WheelHandler {
                    enabled: !root.synced
                    onWheel: e => parent.scrolled = Math.max(0, Math.min(Math.max(0, lyricColumn.height - 680), parent.scrolled - e.angleDelta.y))
                }
                Column {
                    id: lyricColumn
                    width: parent.width
                    readonly property Item focusLine: root.synced && lineRepeater.count > root.activeLine ? lineRepeater.itemAt(root.activeLine) : null
                    y: focusLine ? 340 - focusLine.y - focusLine.height / 2 : -parent.scrolled
                    Behavior on y { enabled: root.synced; NumberAnimation { duration: 700; easing.type: Easing.OutCubic } }
                    Repeater {
                        id: lineRepeater
                        model: root.lyrics
                        Item {
                            id: line
                            required property var modelData
                            required property int index
                            readonly property int distance: Math.abs(index - root.activeLine)
                            width: lyricColumn.width
                            height: words.height + 30
                            Label {
                                id: words
                                anchors.centerIn: parent
                                width: parent.width
                                horizontalAlignment: Text.AlignHCenter
                                wrapMode: Text.Wrap
                                text: line.modelData.l || "♪"
                                font.pixelSize: root.synced ? 56 : 34
                                font.weight: Font.DemiBold
                                lineHeight: 71; lineHeightMode: Text.FixedHeight
                                opacity: !root.synced || line.distance === 0 ? 1 : line.distance === 1 ? 0.62 : 0
                                scale: !root.synced || line.distance === 0 ? 1 : 0.83
                                Behavior on opacity { NumberAnimation { duration: 500 } }
                                Behavior on scale { NumberAnimation { duration: 700; easing.type: Easing.OutCubic } }
                                layer.enabled: root.synced && line.distance === 1
                                layer.effect: MultiEffect { blurEnabled: true; blur: 0.5; blurMax: 16 }
                            }
                            MouseArea { anchors.fill: parent; enabled: root.synced; onClicked: root.seek(line.modelData.t) }
                        }
                    }
                }
                Label { anchors.centerIn: parent; visible: root.lyrics.length === 0; text: root.lyricsNote; font.pixelSize: 22; opacity: 0.7 }
            }

            Label { anchors { top: parent.top; topMargin: 40; horizontalCenter: parent.horizontalCenter }
                text: root.styleNote; font.pixelSize: 18; opacity: root.styleNote ? 0.85 : 0
                Behavior on opacity { NumberAnimation { duration: 250 } } }

            // ---- YouTube mode: the Picture-in-Picture video in a frame of dark panels, hairlines and mono labels ----
            Item {
                visible: root.ytMode
                anchors.fill: parent
                component Mono: Text {
                    font.family: root.monoFont; font.weight: Font.Light; font.pixelSize: 12; font.letterSpacing: 7
                    font.capitalization: Font.AllUppercase
                    color: root.ink
                }
                // dark panels with thin gaps; the corners facing the video are cut round so the glow curls around it
                Repeater {
                    model: [
                        [2, 2, 302, 92, 0, 0, 120, 0], [308, 2, 1304, 92, 0, 0, 0, 0], [1616, 2, 302, 92, 0, 0, 0, 120],
                        [2, 98, 302, 744, 0, 0, 0, 0], [1616, 98, 302, 744, 0, 0, 0, 0],
                        [2, 846, 302, 232, 0, 120, 0, 0], [308, 846, 1304, 232, 0, 0, 0, 0], [1616, 846, 302, 232, 120, 0, 0, 0]
                    ]
                    Rectangle {
                        required property var modelData
                        x: modelData[0]; y: modelData[1]; width: modelData[2]; height: modelData[3]
                        topLeftRadius: modelData[4]; topRightRadius: modelData[5]; bottomRightRadius: modelData[6]; bottomLeftRadius: modelData[7]
                        color: Qt.rgba(0.043, 0.039, 0.047, 0.55)
                    }
                }
                // Parallax: each layer shifts with the mouse (slowly) and a gentle drift; nearer layers move more
                readonly property vector2d look: root.slowPointer.x > 90 ? Qt.vector2d(0, 0) : root.slowPointer
                readonly property real driftX: Math.sin(root.seconds * 0.07) * 0.5 + Math.sin(root.seconds * 0.031) * 0.5
                readonly property real driftY: Math.cos(root.seconds * 0.053) * 0.6 + Math.sin(root.seconds * 0.019) * 0.4
                component Layer: Item {
                    required property real depth
                    width: 1920; height: 1080
                    x: -(parent.look.x * 26 + parent.driftX * 14) * depth
                    y: -(parent.look.y * 18 + parent.driftY * 10) * depth
                }
                Layer {         // far: long hairlines
                    depth: 0.5
                    Canvas {
                        anchors.fill: parent
                        onPaint: {
                            const g = getContext("2d");
                            g.strokeStyle = Qt.rgba(0.92, 0.85, 0.72, 0.16); g.lineWidth = 1;
                            for (const l of [[-40, 250, 200, 250], [1700, -40, 1960, 200], [-40, 520, 200, 760], [200, 760, -40, 760], [1720, 950, 1960, 950], [1720, 950, 1720, 1120]]) {
                                g.beginPath(); g.moveTo(l[0], l[1]); g.lineTo(l[2], l[3]); g.stroke();
                            }
                        }
                    }
                }
                Layer {         // near: circle markers
                    depth: 1.2
                    Canvas {
                        anchors.fill: parent
                        onPaint: {
                            const g = getContext("2d");
                            g.strokeStyle = Qt.rgba(0.92, 0.85, 0.72, 0.45); g.lineWidth = 1.2;
                            for (const c of [[60, 40], [96, 40], [132, 40], [1860, 40], [60, 1040], [132, 1040], [1860, 1040], [1860, 560], [1860, 700], [60, 640]]) {
                                g.beginPath(); g.arc(c[0], c[1], 4, 0, Math.PI * 2); g.stroke();
                            }
                        }
                    }
                }
                Canvas {        // the video's corner brackets stay put: they frame the video
                    anchors.fill: parent
                    onPaint: {
                        const g = getContext("2d");
                        g.strokeStyle = Qt.rgba(0.92, 0.85, 0.72, 0.6); g.lineWidth = 1.4;
                        const x0 = 306, y0 = 96, x1 = 1614, y1 = 844, k = 22;
                        for (const b of [[x0, y0 + k, x0, y0, x0 + k, y0], [x1 - k, y0, x1, y0, x1, y0 + k], [x0, y1 - k, x0, y1, x0 + k, y1], [x1 - k, y1, x1, y1, x1, y1 - k]]) {
                            g.beginPath(); g.moveTo(b[0], b[1]); g.lineTo(b[2], b[3]); g.lineTo(b[4], b[5]); g.stroke();
                        }
                    }
                }
                Rectangle { x: 320; y: 110; width: 1280; height: 720; color: "#050505" }
                ScreencopyView {
                    id: pipView
                    readonly property real fit: sourceSize.width > 0 ? Math.min(1280 / sourceSize.width, 720 / sourceSize.height) : 1
                    x: 320 + (1280 - width) / 2; y: 110 + (720 - height) / 2
                    width: sourceSize.width * fit; height: sourceSize.height * fit
                    captureSource: root.shown && root.ytMode && root.captureReady ? root.pipWindow.wayland : null
                    live: true
                    onStopped: { root.captureReady = false; captureDelay.restart(); }    // the capture breaks if the window resizes: start it again
                }
                ShaderEffect {      // the video's own filter: grain, fine scanlines and a soft edge, so it matches the scene
                    x: pipView.x; y: pipView.y; width: pipView.width; height: pipView.height
                    visible: pipView.hasContent
                    fragmentShader: "file://" + root.dir + "/assets/ytfilter.frag.qsb"
                    property real clock: root.seconds
                    property vector2d size: Qt.vector2d(width, height)
                    property real grain: 0.09
                    property real lines: 0.12
                    property real edge: 0.35
                }
                // labels
                Mono { x: 60; y: 54; text: "Now playing"; opacity: 0.55 }
                Mono { x: 60; y: 72; text: "YouTube"; opacity: 0.85 }
                Mono { x: 1700; y: 54; text: "Theme"; font.pixelSize: 11; opacity: 0.4 }
                Mono { x: 1700; y: 72; text: "Cosmic"; font.pixelSize: 11; opacity: 0.75 }
                Layer {         // middle: coordinates that keep reading out new values, like an instrument
                    depth: 0.8
                    readonly property real lat: 12.3641 + 0.35 * Math.sin(root.seconds * 0.043) + 0.04 * Math.sin(root.seconds * 0.71)
                    readonly property real lon: 13.8277 + 0.5 * Math.cos(root.seconds * 0.037) + 0.05 * Math.sin(root.seconds * 0.63)
                    Mono { x: 1890; y: 360; text: parent.lat.toFixed(4) + "° N"; font.pixelSize: 11; font.letterSpacing: 6; opacity: 0.45; rotation: 90; transformOrigin: Item.TopLeft; font.features: ({ "tnum": 1 }) }
                    Mono { x: 1660; y: 780; text: parent.lon.toFixed(4) + "° E"; font.pixelSize: 11; font.letterSpacing: 6; opacity: 0.45; font.features: ({ "tnum": 1 }) }
                    Mono { x: 60; y: 700; text: "Signal " + (60 + 35 * root.energy + 4 * Math.sin(root.seconds * 1.3)).toFixed(1); font.pixelSize: 10; font.letterSpacing: 6; opacity: 0.35; font.features: ({ "tnum": 1 }) }
                    Mono { x: 60; y: 720; text: "Orbit " + ((root.seconds * 0.9) % 360).toFixed(1) + "°"; font.pixelSize: 10; font.letterSpacing: 6; opacity: 0.35; font.features: ({ "tnum": 1 }) }
                }
                                Mono { x: 320; y: 870; width: 1280; elide: Text.ElideRight; text: root.ytPlayer ? root.ytPlayer.trackArtist : ""; font.pixelSize: 13; font.letterSpacing: 9; opacity: 0.6 }
                Mono { x: 320; y: 894; width: 1280; elide: Text.ElideRight; text: root.ytPlayer ? root.ytPlayer.trackTitle : ""; font.pixelSize: 28; font.letterSpacing: 10 }
                // play/pause, times and a barcode for progress (played bars bright; a slow scan when the length is unknown)
                Item {
                    x: 360; y: 975; width: 1240; height: 24
                    MouseArea { x: -40; width: 30; height: 24; cursorShape: Qt.PointingHandCursor; onClicked: root.ytToggle()
                        Mono { anchors.centerIn: parent; text: root.ytPlaying ? "||" : "▶"; font.letterSpacing: 0; font.pixelSize: 14 } }
                    Mono { id: tStart; anchors.verticalCenter: parent.verticalCenter; text: root.ytHasLength ? root.clock(root.ytPlayer.position * 1000) : "--:--"; font.letterSpacing: 6; opacity: 0.75 }
                    Mono { id: tEnd; anchors { right: parent.right; verticalCenter: parent.verticalCenter } text: root.ytHasLength ? root.clock(root.ytPlayer.length * 1000) : "--:--"; font.letterSpacing: 6; opacity: 0.75 }
                    Item {
                        id: barcode
                        anchors { left: tStart.right; leftMargin: 18; right: tEnd.left; rightMargin: 18; verticalCenter: parent.verticalCenter }
                        height: 22
                        readonly property int count: Math.max(0, Math.floor(width / 6.6))
                        readonly property real played: root.ytHasLength ? root.ytPlayer.position / root.ytPlayer.length : -1
                        property real scan: 0
                        NumberAnimation on scan { from: 0; to: 1; duration: 6000; loops: Animation.Infinite; running: root.shown && root.ytMode && !root.ytHasLength }
                        Repeater {
                            model: barcode.count
                            Rectangle {
                                required property int index
                                x: index * 6.6; width: index * 7 % 5 === 0 ? 2.4 : 1.2; height: 22
                                color: root.ink
                                opacity: barcode.played >= 0 ? (index < barcode.played * barcode.count ? 0.9 : 0.22)
                                                              : 0.22 + 0.5 * Math.exp(-Math.pow((index / barcode.count - barcode.scan) * 12, 2))
                            }
                        }
                        MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                            onClicked: m => { if (root.ytHasLength && root.ytPlayer.canSeek) root.ytPlayer.position = m.x / width * root.ytPlayer.length; } }
                    }
                }
                // sparkles that twinkle
                Repeater {
                    model: [[1618, 92, 28, 0.95, 3100], [200, 900, 20, 0.8, 4300], [1760, 620, 16, 0.6, 3700], [150, 420, 14, 0.6, 5200]]
                    Text {
                        required property var modelData
                        required property int index
                        property real drift: 0
                        NumberAnimation on drift { from: 0; to: Math.PI * 2; duration: 23000 + index * 7000; loops: Animation.Infinite; running: root.shown && root.ytMode }
                        x: modelData[0] - modelData[2] / 2 + 60 * Math.sin(drift + index); y: modelData[1] - modelData[2] * 0.6 + 40 * Math.cos(drift * 2 + index)
                        text: "✦"; font.pixelSize: modelData[2]; color: "#f4e6ff"
                        SequentialAnimation on opacity {
                            running: root.shown && root.ytMode; loops: Animation.Infinite
                            NumberAnimation { from: modelData[3]; to: modelData[3] * 0.25; duration: modelData[4]; easing.type: Easing.InOutSine }
                            NumberAnimation { from: modelData[3] * 0.25; to: modelData[3]; duration: modelData[4]; easing.type: Easing.InOutSine }
                        }
                    }
                }
            }

            // flat media controls
            Row {
                visible: !root.ytMode
                anchors { bottom: parent.bottom; bottomMargin: 38; horizontalCenter: parent.horizontalCenter }
                spacing: 20
                IconButton { anchors.verticalCenter: parent.verticalCenter; icon: "back"; onClicked: root.control(["prev"]) }
                IconButton { anchors.verticalCenter: parent.verticalCenter; icon: root.playing ? "pause" : "play"; onClicked: root.control(["toggle"]) }
                IconButton { anchors.verticalCenter: parent.verticalCenter; icon: "next"; onClicked: root.control(["next"]) }
                Item {
                    anchors.verticalCenter: parent.verticalCenter
                    width: 40; height: 40
                    Label { anchors.centerIn: parent; text: "DJ"; font.pixelSize: 16; font.weight: Font.DemiBold }
                    MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: { root.startDj(); keys.forceActiveFocus(); } }
                }
                Label { anchors.verticalCenter: parent.verticalCenter; text: root.clock(root.position); font.pixelSize: 14; opacity: 0.72; font.features: ({ "tnum": 1 }) }
                Rail { anchors.verticalCenter: parent.verticalCenter; width: 300; fraction: root.now.ms ? root.position / root.now.ms : 0; onPicked: f => { if (root.now.ms) root.seek(f * root.now.ms); } }
                Label { anchors.verticalCenter: parent.verticalCenter; text: root.clock(root.now.ms); font.pixelSize: 14; opacity: 0.72; font.features: ({ "tnum": 1 }) }
                Image { anchors.verticalCenter: parent.verticalCenter; width: 24; height: 24; sourceSize: Qt.size(48, 48); source: "file://" + root.dir + "/assets/volume.svg" }
                Rail { anchors.verticalCenter: parent.verticalCenter; width: 90; fraction: root.volume / 100; onPicked: f => root.setVolume(Math.round(f * 100)) }
            }
            Label { anchors { bottom: parent.bottom; bottomMargin: 12; horizontalCenter: parent.horizontalCenter }
                visible: root.error !== ""; text: root.error; font.pixelSize: 14; color: "#ffb4a8" }

            // search: solid screen, no blur
            Rectangle {
                id: sheet
                anchors.fill: parent
                color: "#08070c"
                opacity: root.searching ? 1 : 0
                visible: opacity > 0
                Behavior on opacity { NumberAnimation { duration: 220; easing.type: Easing.OutCubic } }
                MouseArea { anchors.fill: parent; onClicked: input.forceActiveFocus() }
                Column {
                    x: 580; y: 300; width: 760; spacing: 20
                    Item {
                        width: parent.width; height: 86
                        TextInput {
                            id: input
                            anchors { left: parent.left; right: parent.right; top: parent.top }
                            color: "white"; selectionColor: root.c1
                            font.family: root.fontName; font.pixelSize: 56; font.weight: Font.Medium
                            clip: true
                            onTextChanged: debounce.restart()
                            Keys.onUpPressed: root.selected = Math.max(0, root.selected - 1)
                            Keys.onDownPressed: root.selected = Math.min(root.results.length - 1, root.selected + 1)
                            Keys.onReturnPressed: e => (e.modifiers & Qt.ShiftModifier) ? root.addToQueue(root.selected) : root.play(root.selected)
                            Keys.onEnterPressed: e => (e.modifiers & Qt.ShiftModifier) ? root.addToQueue(root.selected) : root.play(root.selected)
                            Keys.onEscapePressed: root.closeSearch()
                            Label { anchors.fill: parent; visible: !input.text; text: "Search Spotify"; font: input.font; opacity: 0.45 }
                        }
                        Label { anchors { right: parent.right; bottom: parent.bottom; bottomMargin: 10 } text: root.error || root.addedNote; font.pixelSize: 16; opacity: 0.8 }
                        Rectangle { anchors.bottom: parent.bottom; width: parent.width; height: 2; color: input.activeFocus ? "white" : Qt.rgba(1, 1, 1, 0.3) }
                    }
                    ListView {
                        width: parent.width; height: 600
                        clip: true; spacing: 2
                        model: root.results
                        currentIndex: root.selected
                        delegate: SongRow {
                            required property var modelData
                            required property int index
                            width: ListView.view.width
                            song: modelData
                            selected: index === root.selected
                            onClicked: { root.selected = index; root.play(index); }
                            onAdded: root.addToQueue(index)
                        }
                        Label { visible: root.results.length === 0 && root.resultsFor !== "" && root.resultsFor === input.text; text: "No songs match that search."; font.pixelSize: 18; opacity: 0.7 }
                    }
                }
            }
        }
    }
}
