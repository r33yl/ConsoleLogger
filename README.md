# Console Logger

A Cookie Clicker mod that brings a built-in log viewer directly into the game — no browser DevTools needed.

**[Steam Workshop →](https://steamcommunity.com/sharedfiles/filedetails/?id=3760038154)**

## What it does

Opens with **Ctrl+L**. Captures and displays:

- All console calls — `log`, `warn`, `error`, `debug`, `info`, `table`, `time`, `count`, `assert`, `trace`, and more
- Game notifications and popups (`Game.Notify` / `Game.Popup`)
- Uncaught JS errors and unhandled promise rejections
- Failed resource loads (images, scripts, stylesheets)
- Network errors (fetch / XHR)

Each entry shows a timestamp, level badge, and — when stack traces are enabled — a full call stack with clickable **VS Code / JetBrains** jump links.

## Features

### Log window
- Resizable and draggable overlay, always on top of the game
- Adjustable opacity
- Scroll to top / bottom buttons
- Unread banner when new entries arrive while scrolled up
- Deduplication — repeated identical entries are collapsed into `[×N]`

### Filtering & search
- Toggle visibility by level: LOG, DBG, WARN, ERR, STATS, GAME
- Toggle by source: Console, Game, Uncaught JS errors, Failed resources, Network
- Live text search with debounce

### Entries
- Copy individual entry to clipboard (copies stack trace too if it's expanded)
- Click a path in the stack trace to copy it; use the editor button to open it directly in VS Code or JetBrains
- Tables (`console.table`) are copied as CSV

### Save to file
- **Save visible** — exports only entries matching current filters/search
- **Save all** — exports everything
- Options: include stack traces, expand duplicates into separate lines

### Clear
- **Clear all** — wipes the log
- **Clear hidden** — removes only entries hidden by current filters/search

### Settings
- Timestamps on/off
- Stack trace capture on/off (affects new entries only)
- Text selection on/off
- Notify on error — shows a game notification when an error is logged while the window is closed
- Save options: stack traces, expand duplicates

### Themes
🌑 Dark · 🦊 Gruvbox · 🟢 Steam 2009 · ⛩️ Tokyo Night · 💗 Neon

## Installation

### Steam (Workshop)

1. Go to the [Steam Workshop page](https://steamcommunity.com/sharedfiles/filedetails/?id=3760038154).
2. Click **Subscribe**.
3. Launch Cookie Clicker via Steam — the mod will load automatically if you have Mod Manager enabled.

> **Tip:** The earlier Console Logger appears in your mod list, the more it will capture. Place it as high as possible so it initializes before other mods.

### Web version

1. Open [Cookie Clicker](https://orteil.dashnet.org/cookieclicker/).
2. Open the browser console (`F12`).
3. Paste the following and press Enter:

```js
Game.LoadMod("https://raw.githubusercontent.com/r33yl/ConsoleLogger/main/main.js");
```

## For mod authors

```js
// All standard console methods work as usual:
console.log('hello from my mod');
console.warn('something looks off');
console.error('something broke');
console.table(myData);
console.time('init'); /* ... */ console.timeEnd('init');
```

Errors thrown anywhere in your mod will be caught and shown automatically.

## License

This project is licensed under the MIT [License](https://github.com/r33yl/ConsoleLogger/blob/main/LICENSE).
You are free to use, modify, and distribute the code with attribution.
