var ConsoleLogger = ConsoleLogger || {};

ConsoleLogger.ID = 'ConsoleLogger';
ConsoleLogger.name = 'Console Logger';
ConsoleLogger.version = '1.5';

ConsoleLogger.launch = function () {

	//***********************************
	//    CONSTANTS
	//***********************************

	const MAX_LOG_ENTRIES = 1000;         // Cap in-memory entries to prevent RAM leak
	const HOTKEY = 'KeyL';                // Ctrl+L opens/closes the log window
	const LOG_FILE_PREFIX = 'cc_log_';    // Filename prefix for saved log files
	const NOTIFY_COOLDOWN = 5000;         // ms between same-level game notifications
	const DEFAULT_OPACITY = 0.97;         // Default background opacity (allowed range: 0.8 - 1.0)
	const SEARCH_DEBOUNCE_MS = 200;       // Delay before applyFilters() runs after typing stops
	const DEFAULT_LABEL = 'default';      // Fallback label for time/count/group calls made without one

	let WINDOW_OPACITY = DEFAULT_OPACITY; // Current active opacity (overridden by config on load)
	let searchDebounceTimer = null;       // Pending applyFilters() call, if any

	const ENTRY_KIND = Object.freeze({
		TABLE: 'table',
		DIR: 'dir',
		DIRXML: 'dirxml',
		GROUP: 'group',
		GROUP_END: 'groupend',
		TIME: 'time',
		COUNT: 'count',
		CLEAR: 'clear',
		TRACE: 'trace',
	});

	// Kinds that never get a collapse/expand arrow (computed once, not per-row).
	const NO_TOGGLE_KINDS = new Set([
		ENTRY_KIND.TABLE,
		ENTRY_KIND.GROUP,
		ENTRY_KIND.GROUP_END,
		ENTRY_KIND.TIME,
		ENTRY_KIND.COUNT,
		ENTRY_KIND.CLEAR,
	]);

	// Kinds whose `text` is a generic placeholder — never deduplicated (different data, same text).
	const NO_DEDUP_KINDS = new Set([
		ENTRY_KIND.TABLE,
		ENTRY_KIND.DIR,
		ENTRY_KIND.DIRXML,
		ENTRY_KIND.GROUP,
		ENTRY_KIND.GROUP_END,
		ENTRY_KIND.TIME,
	]);

	// ───── Log sources: the single source of truth ────────────────────────
	const SOURCE_REGISTRY = Object.freeze({
		native: {
			label: 'Console', hint: '(log/warn/error...)',
			checkboxId: 'consoleLogger-chk-intercept-native',
			flag: '_nativeIntercepted', on: 'interceptNative', off: 'restoreNative',
			defaultEnabled: true,
		},
		game: {
			label: 'Game', hint: '(Notify/Popup)',
			checkboxId: 'consoleLogger-chk-intercept-game',
			flag: '_gameIntercepted', on: 'interceptGame', off: 'restoreGame',
			defaultEnabled: true,
		},
		globalErrors: {
			label: 'Uncaught JS errors', hint: '',
			checkboxId: 'consoleLogger-chk-intercept-global',
			flag: '_globalIntercepted', on: 'interceptGlobalErrors', off: 'restoreGlobalErrors',
			defaultEnabled: true,
		},
		resourceErrors: {
			label: 'Failed resources', hint: '(img/script/link…)',
			checkboxId: 'consoleLogger-chk-intercept-resource',
			flag: '_resourceIntercepted', on: 'interceptResourceErrors', off: 'restoreResourceErrors',
			defaultEnabled: true,
		},
		network: {
			label: 'Network', hint: '(fetch/XHR)',
			checkboxId: 'consoleLogger-chk-intercept-network',
			flag: '_networkIntercepted', on: 'interceptNetwork', off: 'restoreNetwork',
			defaultEnabled: true,
		},
	});

	// Typo-safe source name constants, auto-built from SOURCE_REGISTRY keys.
	const ENTRY_SOURCE = Object.freeze({
		...Object.fromEntries(Object.keys(SOURCE_REGISTRY).map(
			key => [key.replace(/([A-Z])/g, '_$1').toUpperCase(), key]
		)),
		UNKNOWN: 'unknown',   // fallback when no source is given — not a real interceptable source
	});

	// ───── Tree-prefix segment constants ────────────────────────
	const SEG = 4;
	const PIPE = '│'.padEnd(SEG, ' ');
	const BLANK = ''.padEnd(SEG, ' ');
	const BRANCH = '├──'.padEnd(SEG, ' ');
	const LAST = '└──'.padEnd(SEG, ' ');

	// ───── Themes: each entry is a PALETTE override ────────────────────────
	const THEMES = {
		'🌑 Dark': {
			ui: {
				primary: '#6dc1f8',
				secondary: '#ad84f8',
				success: '#6dd58b',
				warning: '#f6c24f',
				danger: '#f25659',
				white: '#e7e7e7',
				black: '#000000',
				bgPrimary: '#12141c',
				bgSecondary: '#0d0f14',
			},
			logs: {
				log: '#d5dbe2',
				debug: '#ab88fb',
				warn: '#f6c456',
				error: '#f3585b',
				stats: '#73c1ff',
				game: '#69d48a',
			},
		},
		'🦊 Gruvbox': {
			ui: {
				primary: '#83A598',
				secondary: '#D3869B',
				success: '#9BBB26',
				warning: '#FABD2F',
				danger: '#FB4934',
				white: '#EBDBB2',
				black: '#000000',
				bgPrimary: '#282828',
				bgSecondary: '#1D2021',
			},
			logs: {
				log: '#EBDBB2',
				debug: '#D3869B',
				warn: '#FABD2F',
				error: '#FB4934',
				stats: '#83A598',
				game: '#9BBB26',
			},
		},
		'🟢 Steam 2009': {
			ui: {
				primary: '#79bf72',
				secondary: '#548952',
				success: '#7cc37c',
				warning: '#e2c25c',
				danger: '#cc5b4b',
				white: '#d0ead0',
				black: '#000000',
				bgPrimary: '#151e15',
				bgSecondary: '#0f170f',
			},
			logs: {
				log: '#d4e1d0',
				debug: '#9885cc',
				warn: '#e2c25c',
				error: '#cc5b4b',
				stats: '#77c4da',
				game: '#7cc47a',
			},
		},
		'⛩️ Tokyo Night': {
			ui: {
				primary: '#7AA2F7',
				secondary: '#BB9AF7',
				success: '#9ECE6A',
				warning: '#E0AF68',
				danger: '#F7768E',
				white: '#C0CAF5',
				black: '#000000',
				bgPrimary: '#1A1B26',
				bgSecondary: '#16161E',
			},
			logs: {
				log: '#C0CAF5',
				debug: '#BB9AF7',
				warn: '#E0AF68',
				error: '#F7768E',
				stats: '#7DCFFF',
				game: '#9ECE6A',
			},
		},
		'💗 Neon': {
			ui: {
				primary: '#00f5ff',
				secondary: '#ff07ee',
				success: '#00ff55',
				warning: '#fff100',
				danger: '#f5255d',
				white: '#f5f5f5',
				black: '#000000',
				bgPrimary: '#130c1e',
				bgSecondary: '#0b0713',
			},
			logs: {
				log: '#e2e2e2',
				debug: '#ff07ee',
				warn: '#fff100',
				error: '#f5255d',
				stats: '#00f5ff',
				game: '#00ff55',
			},
		},
	};

	const DEFAULT_THEME_KEY = Object.keys(THEMES)[0];
	const PALETTE = JSON.parse(JSON.stringify(THEMES[DEFAULT_THEME_KEY])); 	// Shallow copy of the active theme; keeps THEMES entries immutable.

	// Rebuilds LOG_LEVELS from the current config (used after config changes).
	function rebuildLogLevels() {
		return {
			log: { label: 'LOG', color: PALETTE.logs.log, bg: alpha(PALETTE.logs.log, 0.08) },
			debug: { label: 'DBG', color: PALETTE.logs.debug, bg: alpha(PALETTE.logs.debug, 0.10) },
			warn: { label: 'WARN', color: PALETTE.logs.warn, bg: alpha(PALETTE.logs.warn, 0.10) },
			error: { label: 'ERR', color: PALETTE.logs.error, bg: alpha(PALETTE.logs.error, 0.10) },
			stats: { label: 'STATS', color: PALETTE.logs.stats, bg: alpha(PALETTE.logs.stats, 0.10) },
			game: { label: 'GAME', color: PALETTE.logs.game, bg: alpha(PALETTE.logs.game, 0.10) },
		};
	}
	let LOG_LEVELS = rebuildLogLevels();

	// Rebuilds the TOKENS map from PALETTE and current opacity/theme settings.
	function rebuildTokens() {
		return {
			// ───── Text ────────────────────────
			textWhite: PALETTE.ui.white,
			textPrimary: alpha(PALETTE.ui.white, 0.80),
			textSecondary: alpha(PALETTE.ui.white, 0.70),
			textSubtleHover: alpha(PALETTE.ui.white, 0.50),
			textMuted: alpha(PALETTE.ui.white, 0.40),
			textDimmer: alpha(PALETTE.ui.white, 0.30),

			textWarning: alpha(PALETTE.ui.warning, 0.80),
			textDanger: alpha(PALETTE.ui.danger, 0.90),
			textStack: alpha(PALETTE.ui.danger, 0.70),

			textTableHeader: alpha(PALETTE.ui.primary, 0.80),
			textTableCell: alpha(PALETTE.ui.danger, 0.60),
			textDirKey: alpha(PALETTE.ui.success, 0.80),
			textDirVal: alpha(PALETTE.ui.success, 0.50),
			textTypeString: alpha(PALETTE.ui.warning, 0.70),
			textTypeBoolean: alpha(PALETTE.ui.secondary, 0.80),
			textTypeFunction: alpha(PALETTE.ui.primary, 0.70),
			textTypeObject: alpha(PALETTE.ui.danger, 0.60),

			// ───── Foreground accents ────────────────────────
			accentPrimary: PALETTE.ui.primary,
			accentPrimaryMuted: alpha(PALETTE.ui.primary, 0.12),
			accentPrimaryMid: alpha(PALETTE.ui.primary, 0.40),
			accentPrimaryStrong: alpha(PALETTE.ui.primary, 0.60),

			accentSecondary: PALETTE.ui.secondary,
			accentSecondaryMuted: alpha(PALETTE.ui.secondary, 0.12),
			accentSecondaryMid: alpha(PALETTE.ui.secondary, 0.40),
			accentSecondaryStrong: alpha(PALETTE.ui.secondary, 0.60),

			accentSuccess: PALETTE.ui.success,
			accentSuccessMuted: alpha(PALETTE.ui.success, 0.12),
			accentSuccessMid: alpha(PALETTE.ui.success, 0.40),
			accentSuccessStrong: alpha(PALETTE.ui.success, 0.60),

			accentWarning: PALETTE.ui.warning,
			accentWarningMuted: alpha(PALETTE.ui.warning, 0.12),
			accentWarningMid: alpha(PALETTE.ui.warning, 0.40),
			accentWarningStrong: alpha(PALETTE.ui.warning, 0.60),

			accentDanger: PALETTE.ui.danger,
			accentDangerMuted: alpha(PALETTE.ui.danger, 0.12),
			accentDangerMid: alpha(PALETTE.ui.danger, 0.40),
			accentDangerStrong: alpha(PALETTE.ui.danger, 0.60),

			stackBorder: alpha(PALETTE.ui.danger, 0.30),
			stackColor: alpha(PALETTE.ui.danger, 0.70),

			// ───── Backgrounds ────────────────────────
			bgWindow: alpha(PALETTE.ui.bgPrimary, WINDOW_OPACITY),
			bgMenu: alpha(PALETTE.ui.bgSecondary, WINDOW_OPACITY * 0.3),
			bgButton: alpha(PALETTE.ui.bgSecondary, 0.85),

			bgPrimary: alpha(PALETTE.ui.primary, 0.04),
			bgPrimaryHover: alpha(PALETTE.ui.primary, 0.07),
			bgSecondary: alpha(PALETTE.ui.secondary, 0.04),
			bgSecondaryHover: alpha(PALETTE.ui.secondary, 0.07),

			bgSurface: alpha(PALETTE.ui.white, 0.04),
			bgSurfaceLight: alpha(PALETTE.ui.white, 0.07),
			bgSurfaceHover: alpha(PALETTE.ui.white, 0.10),
			bgSurfaceStrong: alpha(PALETTE.ui.white, 0.15),

			bgTimelinePin: PALETTE.ui.danger,
			bgHighlight: alpha(PALETTE.ui.danger, 0.30),
			bgShadow: alpha(PALETTE.ui.black, 0.60),

			// ───── Borders ────────────────────────
			borderSubtle: alpha(PALETTE.ui.white, 0.07),
			borderMedium: alpha(PALETTE.ui.white, 0.15),
			borderStrong: alpha(PALETTE.ui.white, 0.25),
			borderBold: alpha(PALETTE.ui.white, 0.35),
		};
	}
	let TOKENS = rebuildTokens();

	//***********************************
	//    THEME SWITCHING
	//***********************************

	// Applies a named theme: updates PALETTE, rebuilds TOKENS, and reloads CSS.
	ConsoleLogger.applyTheme = function (themeName) {
		const palette = THEMES[themeName];
		if (!palette) return;

		ConsoleLogger.config.theme = themeName;
		Object.assign(PALETTE, palette);
		LOG_LEVELS = rebuildLogLevels();
		TOKENS = rebuildTokens();

		ConsoleLogger.logs.forEach(entry => {
			if (entry.rawArgs) {
				const { text, segments } = parseConsoleArgs(entry.rawArgs);
				entry.text = text;
				entry.segments = segments;
			}
		});

		ConsoleLogger.reloadStyles();
		if (ConsoleLogger.config.windowOpen) {
			ConsoleLogger.rebuildLog(true);
			ConsoleLogger.updateTimeline();
		}

		// Persist to config
		ConsoleLogger.config.theme = themeName;
		const themeDropdownBtn = document.getElementById('consoleLogger-theme-dropdown-btn');
		if (themeDropdownBtn) themeDropdownBtn.textContent = themeName;

		// Sync "selected" highlight (needed when a saved theme is reapplied after async config load).
		const themeMenuContent = document.getElementById('consoleLogger-theme-dropdown-content');
		if (themeMenuContent) {
			themeMenuContent.querySelectorAll('button[data-theme]').forEach(b => {
				b.classList.toggle('selected', b.dataset.theme === themeName);
			});
		}
	};

	// Sets window opacity, rebuilds TOKENS, reloads CSS, and persists to config.
	ConsoleLogger.setOpacity = function (value) {
		value = Math.min(1, Math.max(0.2, parseFloat(value)));
		if (isNaN(value)) return;

		WINDOW_OPACITY = value;
		TOKENS = rebuildTokens();
		ConsoleLogger.reloadStyles();

		// Persist to config
		ConsoleLogger.config.windowOpacity = value;

		const slider = document.getElementById('consoleLogger-opacity-slider');
		if (slider) slider.value = Math.round(value * 100);
		const readout = document.getElementById('consoleLogger-opacity-value');
		if (readout) readout.textContent = Math.round(value * 100) + '%';
	};

	// Drops and re-injects the stylesheet; also rewires per-button CSS variables.
	ConsoleLogger.reloadStyles = function () {
		const el = document.getElementById('consoleLogger-style');
		if (el) el.remove();
		ConsoleLogger.injectStyles();

		// Re-apply per-button CSS variable (inlineStyle, not covered by the sheet)
		Object.entries(LOG_LEVELS).forEach(([key, meta]) => {
			const btn = document.querySelector(`.consoleLogger-filter-btn[data-level="${key}"]`);
			if (btn) {
				btn.style.color = meta.color;
				btn.style.setProperty('--filter-hover-bg', alpha(meta.color, 0.12));
			}
		});
	};

	//***********************************
	//    CONFIGURATION DEFAULTS
	//***********************************

	// Returns a fresh default config object.
	ConsoleLogger.getDefaultConfig = function () {
		return {
			windowOpen: false,
			windowX: 20,
			windowY: 40,
			windowW: Math.min(600, window.innerWidth - 40),
			windowH: Math.min(800, window.innerHeight - 80),
			filters: {
				log: true,
				debug: true,
				warn: true,
				error: true,
				stats: true,
				game: true,
			},
			theme: DEFAULT_THEME_KEY,         // Active colour theme
			windowOpacity: DEFAULT_OPACITY,   // Window background opacity
			// Which sources are active by default — derived from SOURCE_REGISTRY
			intercept: Object.fromEntries(
				Object.entries(SOURCE_REGISTRY).map(([key, meta]) => [key, meta.defaultEnabled])
			),
			timestampEnabled: true,           // Show timestamps next to log entries
			stackTraceEnabled: true,          // Include stack trace/call stack in log entries
			textSelectionEnabled: true,       // Allow text selection in console
			notifyOnError: false,             // Show Game.Notify popup on error when window is closed
			saveIncludeStackTraces: true,    // Append stack traces to entries when saving to file
			saveExpandDuplicates: true,      // Repeat each duplicate as its own line when saving to file
		};
	};

	//***********************************
	//    HELPERS
	//***********************************

	// Injects an alpha channel into a hex/rgb color string.
	function alpha(color, a) {
		color = color.trim();
		let r, g, b;

		if (color.startsWith('#')) {
			const hex = color.slice(1);
			if (hex.length === 3) {
				r = parseInt(hex[0] + hex[0], 16);
				g = parseInt(hex[1] + hex[1], 16);
				b = parseInt(hex[2] + hex[2], 16);
			} else if (hex.length === 6) {
				r = parseInt(hex.slice(0, 2), 16);
				g = parseInt(hex.slice(2, 4), 16);
				b = parseInt(hex.slice(4, 6), 16);
			}
		} else {
			const match = color.match(/^rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
			if (match) { [, r, g, b] = match; }
		}

		if (r === undefined) {
			throw new Error(`Unsupported color format: ${color}`);
		}

		return `rgba(${r}, ${g}, ${b}, ${a})`;
	}

	// ───── Stack capture: per-source on/off switch (edit freely) ─────────────────────────
	const STACK_CAPTURE = Object.freeze({
		// LOG
		log: true,
		info: true,
		debug: true,
		// WARN / ERROR
		warn: true,
		error: true,        // overridden by the thrown Error's own stack when available
		// GROUP
		group: false,
		groupCollapsed: false,
		groupEnd: false,    // pairs with the matching group, which already has one
		// DATA
		table: false,       // tabular dump — origin rarely useful
		dir: false,
		dirxml: false,
		// DEBUG
		trace: true,        // the whole point of console.trace()
		clear: false,       // trivial marker, no value in a stack
		assert: true,       // only matters once routed to error (assert(false))
		// STATS
		time: false,
		timeLog: false,
		timeEnd: false,
		count: false,
		countReset: false,
		// GAME
		gameNotify: true,
		gamePopup: true,
		// RESOURCE / NETWORK
		resourceError: true,
		network: true,
	});

	// Strips the leading "Error" header line (if present) from a raw stack string.
	function stripStackHeader(raw) {
		const lines = (raw || '').split('\n');
		if (lines.length && !/^\s*at\s/.test(lines[0])) lines.shift();
		return lines.join('\n').trim();
	}

	// Captures the current call stack, trimmed so it starts at the real caller.
	function captureCallStack() {
		const raw = new Error().stack || '';
		const lines = raw.split('\n');
		let start = (lines.length && !/^\s*at\s/.test(lines[0])) ? 1 : 0; // drop "Error" header
		start += 2; // drop captureCallStack's own frame + the calling wrapper's frame
		return lines.slice(start).join('\n').trim() || null;
	}

	// Returns the stackText for an entry, honouring STACK_CAPTURE and preferring a real Error's own stack when given.
	function getStackFor(sourceName, errObj) {
		if (!ConsoleLogger.config.stackTraceEnabled && sourceName !== 'trace') return;
		if (errObj instanceof Error && errObj.stack) return stripStackHeader(errObj.stack);
		if (!STACK_CAPTURE[sourceName]) return null;
		return captureCallStack();
	}

	// Finds the first Error instance among console args (used by error/warn/assert).
	function findErrorArg(args) {
		return args.find(a => a instanceof Error) || null;
	}

	function makeCircularSafeReplacer() {
		const stack = [];
		return function (key, value) {
			if (typeof value !== 'object' || value === null) return value;

			while (stack.length && stack[stack.length - 1] !== this) {
				stack.pop();
			}
			if (stack.indexOf(value) !== -1) return '[Circular]';

			stack.push(value);
			return value;
		};
	}

	// Serialises a single console argument to a plain string.
	function stringifyArg(a) {
		if (a === null) return 'null';
		if (a === undefined) return 'undefined';
		if (a instanceof Error) return `${a.name}: ${a.message}${a.stack ? '\n' + a.stack : ''}`;
		if (typeof a === 'object') {
			try { return JSON.stringify(a, null, 2); }
			catch (_) {
				try { return JSON.stringify(a, makeCircularSafeReplacer(), 2); }
				catch (_2) { return String(a); }
			}
		}
		return String(a);
	}

	// Prepends a text prefix to console args while preserving %c/%s format tokens.
	function prefixArgs(prefix, args) {
		if (args.length === 0) return [prefix];
		if (typeof args[0] === 'string') return [prefix + args[0], ...args.slice(1)];
		return [prefix, ...args];
	}

	function styleForArg(arg) {
		if (arg === null || arg === undefined)
			return `color:${TOKENS.textMuted}; font-style:italic;`;
		if (typeof arg === 'number')
			return Number.isNaN(arg) || !Number.isFinite(arg)
				? `color:${TOKENS.accentPrimary}; font-style:italic;`
				: `color:${TOKENS.accentPrimary};`;
		if (typeof arg === 'boolean')
			return `color:${TOKENS.textTypeBoolean}; font-weight:600;`;
		if (typeof arg === 'symbol')
			return `color:${TOKENS.textTypeString};`;
		if (typeof arg === 'function')
			return `color:${TOKENS.textTypeFunction}; font-style:italic;`;
		if (Array.isArray(arg))
			return `color:${TOKENS.textDirKey};`;
		if (typeof arg === 'object')
			return `color:${TOKENS.textTypeObject};`;
		return null;
	}

	// Parses printf-style directives (%s %d %c …). Returns { text, segments } — segments is null if no %c was used.
	function parseConsoleArgs(args) {
		if (typeof args[0] !== 'string' || !/%[sdifoOjc%]/.test(args[0])) {
			const segments = [];
			args.forEach((arg, idx) => {
				if (idx > 0) segments.push({ text: ' ', style: null });
				segments.push({ text: stringifyArg(arg), style: styleForArg(arg) });
			});
			const text = segments.map(s => s.text).join('');
			return { text, segments };
		}

		const fmt = args[0];
		const regex = /%[sdifoOjc%]/g;
		let i = 1;
		let lastIndex = 0;
		let buffer = '';
		let currentStyle = null;
		let usedStyle = false;
		const segments = [];
		let match;

		while ((match = regex.exec(fmt)) !== null) {
			buffer += fmt.slice(lastIndex, match.index);
			lastIndex = regex.lastIndex;
			const token = match[0];

			if (token === '%%') { buffer += '%'; continue; }

			if (token === '%c') {
				segments.push({ text: buffer, style: currentStyle });
				buffer = '';
				currentStyle = i < args.length ? String(args[i++]) : null;
				usedStyle = true;
				continue;
			}

			if (i >= args.length) { buffer += token; continue; }
			const arg = args[i++];
			switch (token) {
				case '%s': buffer += String(arg); break;
				case '%d': case '%i': buffer += String(parseInt(arg, 10)); break;
				case '%f': buffer += String(parseFloat(arg)); break;
				case '%o': case '%O': case '%j':
					try { buffer += JSON.stringify(arg); }
					catch (_) {
						try { buffer += JSON.stringify(arg, makeCircularSafeReplacer()); }
						catch (_2) { buffer += String(arg); }
					}
					break;
			}
		}
		buffer += fmt.slice(lastIndex);
		segments.push({ text: buffer, style: currentStyle });

		const restText = args.slice(i).map(stringifyArg).join(' ');
		if (restText) segments.push({ text: ' ' + restText, style: null });

		const text = segments.map(s => s.text).join('');
		return { text, segments: usedStyle ? segments : null };
	}

	// Renders %c-styled segments into a container element, falls back to plain textContent.
	function renderSegments(container, text, segments) {
		if (!container) return;

		container.textContent = '';
		if (segments && segments.length > 0) {
			segments.forEach(seg => {
				if (!seg.text) return;

				const span = document.createElement('span');
				span.textContent = seg.text;
				if (seg.style) span.setAttribute('style', seg.style);
				container.appendChild(span);
			});
		} else {
			container.textContent = text;
		}
	}

	// Formats a Date into a compact HH:MM:SS.mmm string.
	function formatTimestamp(date) {
		const pad = n => String(n).padStart(2, '0');
		return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
	}

	// Formats a single entry as one or more plain-text lines (used by copy and save).
	// opts.includeStack — append stackText below the line; opts.expandDups — repeat instead of [xN]
	function formatEntryLine(entry, includeStack = false, expandDups = false) {
		const ts = formatTimestamp(entry.ts);
		const lvl = LOG_LEVELS[entry.level]?.label ?? '???';

		const buildLine = (dupSuffix) => {
			let line = `[${ts}] [${lvl}]${dupSuffix} ${entry.text}`;
			if (entry.kind === ENTRY_KIND.TABLE && entry.tableData?.data) {
				const rows = entry.tableData.data;
				const keys = Object.keys(rows[0] ?? {});
				const csv = [keys.join(', '), ...rows.map(r => keys.map(k => r[k] ?? '').join(', '))].join('\n');
				line += '\n' + csv;
			}
			if (includeStack && entry.stackText) {
				const indented = entry.stackText.split('\n').map(l => '    ' + l).join('\n');
				line += '\n' + indented;
			}
			return line;
		};

		if (expandDups && entry.dupCount > 1) {
			return Array.from({ length: entry.dupCount }, () => buildLine('')).join('\n');
		}

		const dup = entry.dupCount > 1 ? ` [x${entry.dupCount}]` : '';
		return buildLine(dup);
	}

	//***********************************
	//    LOG STORAGE
	//***********************************

	ConsoleLogger.logs = [];          // Stored log entries
	ConsoleLogger._idCounter = 0;     // Monotonic entry ID generator
	ConsoleLogger._unreadCount = 0;   // Entries received while not at bottom

	// Entries (matching current filters) received while window closed
	ConsoleLogger._newCount = { total: 0, error: 0, warn: 0 };

	// Creates a log entry with defaults; caller only passes fields to override.
	function createLogEntry(overrides) {
		const defaults = {
			id: ++ConsoleLogger._idCounter,
			ts: new Date(),
			source: ENTRY_SOURCE.UNKNOWN,
			level: 'log',
			text: '',
			rawArgs: null,
			segments: null,
			dupCount: 1,
			collapsed: true,
			protected: false,
			pinned: false,
			kind: null,
			stackText: null,
			tableData: null,
			dirData: null,
			groupData: { depth: 0, collapsed: false },
			timeData: null,
			countData: null,
		};

		function mergeDeep(target, source) {
			if (!source) return target;

			const output = { ...target };
			for (const key in source) {
				const sourceValue = source[key];
				if (sourceValue === null || sourceValue === undefined) continue;

				if (typeof sourceValue === 'object' && !Array.isArray(sourceValue) && target[key]) {
					output[key] = mergeDeep(target[key], sourceValue);
				} else {
					output[key] = sourceValue;
				}
			}
			return output;
		}
		return mergeDeep(defaults, overrides);
	}

	// Trims the log to MAX_LOG_ENTRIES, replacing removed entries with a single purge notice.
	ConsoleLogger.purgeOldEntries = function () {
		if (ConsoleLogger._isPurging) return;

		if (ConsoleLogger.logs.length > MAX_LOG_ENTRIES) {
			ConsoleLogger._isPurging = true;

			// ───── Remove oldest unprotected entries ────────────────────────
			try {
				const overflow = ConsoleLogger.logs.length - MAX_LOG_ENTRIES;
				let removed = 0;
				let oldestTs = null;
				let i = 0;

				while (removed < overflow && i < ConsoleLogger.logs.length) {
					if (!ConsoleLogger.logs[i].protected && ConsoleLogger.logs[i]._purgeNotice !== true) {
						if (oldestTs === null) oldestTs = ConsoleLogger.logs[i].ts;
						const removedId = ConsoleLogger.logs[i].id;
						ConsoleLogger.logs.splice(i, 1);
						removed++;

						// Targeted removal from HTML (if the log window is open)
						if (ConsoleLogger.config.windowOpen) {
							const rowEl = document.querySelector(`.consoleLogger-entry[data-id="${removedId}"]`);
							if (rowEl) rowEl.remove();
						}
					} else {
						i++;
					}
				}

				// ───── Update or create purge notice ────────────────────────
				if (removed > 0) {
					// Find existing purge notice right before current entries
					const existingNotice = ConsoleLogger.logs.find(e => e._purgeNotice === true);
					const style = `color: ${TOKENS.textWarning}; font-weight: bold;`;
					const getNoticeText = (count) => `%c[ConsoleLogger]%c Deleted %c${count}%c records due to an overflow.`;


					if (existingNotice) {
						// Accumulate into existing notice
						existingNotice._purgeCount += removed;

						const noticeText = getNoticeText(existingNotice._purgeCount);
						const { text, segments } = parseConsoleArgs([noticeText, style, "", style, ""]);

						existingNotice.text = text;
						existingNotice.segments = segments;

						if (ConsoleLogger.config.windowOpen) {
							const row = document.querySelector(`.consoleLogger-entry[data-id="${existingNotice.id}"]`);
							if (row) {
								const contentEl = row.querySelector('.consoleLogger-text');
								renderSegments(contentEl, existingNotice.text, existingNotice.segments);
							}
						}
					} else {
						// Insert a new purge notice with timestamp of oldest removed entry
						const noticeText = getNoticeText(removed);
						const { text, segments } = parseConsoleArgs([noticeText, style, "", style, ""]);
						const notice = createLogEntry({
							ts: oldestTs || new Date(),
							text,
							segments,
							protected: true,
							_purgeNotice: true,
							_purgeCount: removed,
						});
						// Insert at position 0 (oldest, just after purged entries)
						ConsoleLogger.logs.unshift(notice);
						if (ConsoleLogger.config.windowOpen) {
							ConsoleLogger.rebuildLog();
						}
					}
				}
			}
			finally {
				ConsoleLogger._isPurging = false;
			}
		}
	}

	// Adds a new log entry (deduplicates against last entry if text+level+stack match).
	ConsoleLogger.addEntry = function (level, args, extra) {
		const { text, segments } = parseConsoleArgs(args);

		// ───── Duplicate counter ────────────────────────
		const noDedup = extra && NO_DEDUP_KINDS.has(extra.kind);
		if (!noDedup && ConsoleLogger.logs.length > 0) {
			const last = ConsoleLogger.logs[ConsoleLogger.logs.length - 1];
			if (last.level === level && last.text === text && last.stackText === extra.stackText) {
				last.dupCount++;
				last.ts = new Date();
				if (ConsoleLogger.config.windowOpen) ConsoleLogger.updateDupCount(last);
				ConsoleLogger.updateStatusCount();
				return;
			}
		}

		// ───── Build entry object ────────────────────────
		const entry = createLogEntry({
			source: extra?.source,
			level: level,
			text: text,
			rawArgs: args,
			segments: segments,
			protected: extra?.protected,
			pinned: extra?.pinned,
			kind: extra?.kind,
			stackText: extra?.stackText,
			tableData: extra?.tableData,
			dirData: extra?.dirData,
			groupData: extra?.groupData ?? { depth: ConsoleLogger._groupDepth },
			timeData: extra?.timeData,
			countData: extra?.countData,
		});

		// ───── Append and render ────────────────────────
		ConsoleLogger.logs.push(entry);

		ConsoleLogger.purgeOldEntries();

		if (ConsoleLogger.config.windowOpen) {
			const wasAtBottom = isScrolledToBottom();

			ConsoleLogger.renderEntry(entry);
			ConsoleLogger.updateTimeline();

			// Smart autoscroll: only scroll if we were already at bottom; otherwise show unread banner
			if (wasAtBottom) {
				ConsoleLogger.scrollToBottom();
			} else {
				if (ConsoleLogger.isEntryVisible(entry, '')) {
					ConsoleLogger._unreadCount++;
					ConsoleLogger.updateUnreadBanner();
				}
			}
		}

		ConsoleLogger.updateFilterCounters();
		ConsoleLogger.updateStatusCount();

		// ───── Update open button state (window closed) ────────────────────────
		if (!ConsoleLogger.config.windowOpen) {
			if (ConsoleLogger.isEntryVisible(entry)) {
				ConsoleLogger._newCount.total++;
				if (entry.level === 'error') ConsoleLogger._newCount.error++;
				else if (entry.level === 'warn') ConsoleLogger._newCount.warn++;
			}
			ConsoleLogger.updateOpenBtnState();
			ConsoleLogger.maybeNotify(level, entry);
		}
	};

	//***********************************
	//    CONSOLE INTERCEPTION
	//***********************************

	// Originals of patched console methods + runtime state for count/group/time interception
	ConsoleLogger._nativeConsole = {};
	ConsoleLogger._groupDepth = 0;
	ConsoleLogger._timers = {};
	ConsoleLogger._countMap = {};
	ConsoleLogger._countPeakMap = {};

	// Patches all console methods to mirror output into the log.
	ConsoleLogger.interceptNative = function () {
		const nativeSource = ENTRY_SOURCE.NATIVE;
		if (!ConsoleLogger.config.intercept[nativeSource]) return;
		if (ConsoleLogger._nativeIntercepted) return;
		ConsoleLogger._nativeIntercepted = true;

		// ───── Log, info ────────────────────────
		['log', 'info'].forEach(method => {
			ConsoleLogger._nativeConsole[method] = console[method].bind(console);
			console[method] = function (...args) {
				ConsoleLogger._nativeConsole[method].apply(console, args);
				const stackText = getStackFor(method, findErrorArg(args));
				ConsoleLogger.addEntry('log', args, { source: nativeSource, stackText });
			};
		});

		// ───── Debug ────────────────────────
		ConsoleLogger._nativeConsole.debug = console.debug.bind(console);
		console.debug = function (...args) {
			ConsoleLogger._nativeConsole.debug.apply(console, args);
			const stackText = getStackFor('debug', findErrorArg(args));
			ConsoleLogger.addEntry('debug', args, { source: nativeSource, stackText });
		};

		// ───── Warn, error ────────────────────────
		['warn', 'error'].forEach(method => {
			ConsoleLogger._nativeConsole[method] = console[method].bind(console);
			console[method] = function (...args) {
				ConsoleLogger._nativeConsole[method].apply(console, args);
				const stackText = getStackFor(method, findErrorArg(args));
				ConsoleLogger.addEntry(method, args, { source: nativeSource, stackText });
			};
		});

		// ───── Group ────────────────────────
		['group', 'groupCollapsed'].forEach(method => {
			ConsoleLogger._nativeConsole[method] = console[method].bind(console);
			console[method] = function (...args) {
				ConsoleLogger._nativeConsole[method].apply(console, args);
				const { text, segments } = parseConsoleArgs(args);
				ConsoleLogger._groupDepth++;
				const stackText = getStackFor(method);
				ConsoleLogger.addEntry('log', args.length ? args : [DEFAULT_LABEL], {
					source: nativeSource,
					kind: ENTRY_KIND.GROUP,
					groupData: { depth: ConsoleLogger._groupDepth, collapsed: method === 'groupCollapsed' },
					stackText,
				});
			};
		});

		ConsoleLogger._nativeConsole.groupEnd = console.groupEnd.bind(console);
		console.groupEnd = function () {
			ConsoleLogger._nativeConsole.groupEnd.apply(console, arguments);
			const closingDepth = ConsoleLogger._groupDepth;
			ConsoleLogger._groupDepth = Math.max(0, ConsoleLogger._groupDepth - 1);
			const stackText = getStackFor('groupEnd');
			ConsoleLogger.addEntry('log', ['(group end)'], {
				source: nativeSource, kind: ENTRY_KIND.GROUP_END,
				groupData: { depth: closingDepth, collapsed: false },
				stackText
			});
		};

		// ───── Table ────────────────────────
		ConsoleLogger._nativeConsole.table = console.table.bind(console);
		console.table = function (data, columns) {
			ConsoleLogger._nativeConsole.table.apply(console, arguments);
			const stackText = getStackFor('table');
			ConsoleLogger.addEntry('log', ['(table)'], {
				source: nativeSource, kind: ENTRY_KIND.TABLE,
				tableData: { data, columns: columns || null }, stackText
			});
		};

		// ───── Dir, dirxml────────────────────────
		ConsoleLogger._nativeConsole.dir = console.dir.bind(console);
		console.dir = function (obj) {
			ConsoleLogger._nativeConsole.dir.apply(console, arguments);
			const stackText = getStackFor('dir');
			ConsoleLogger.addEntry('log', [describeDirValue(obj)], {
				source: nativeSource, kind: ENTRY_KIND.DIR, dirData: obj, stackText
			});
		};

		ConsoleLogger._nativeConsole.dirxml = console.dirxml.bind(console);
		console.dirxml = function (obj) {
			ConsoleLogger._nativeConsole.dirxml.apply(console, arguments);
			const stackText = getStackFor('dirxml');
			ConsoleLogger.addEntry('log', [describeDirxmlValue(obj)], {
				source: nativeSource, kind: ENTRY_KIND.DIRXML, dirData: obj, stackText
			});
		};

		// ───── Trace ────────────────────────
		ConsoleLogger._nativeConsole.trace = console.trace.bind(console);
		console.trace = function (...args) {
			ConsoleLogger._nativeConsole.trace.apply(console, args);
			const entryArgs = args.length ? prefixArgs('🐾 [Trace] ', args) : ['Trace'];
			const stackText = getStackFor('trace', findErrorArg(args));
			ConsoleLogger.addEntry('debug', entryArgs, { source: nativeSource, kind: ENTRY_KIND.TRACE, stackText });
		};

		// ───── Clear ────────────────────────
		ConsoleLogger._nativeConsole.clear = console.clear.bind(console);
		console.clear = function () {
			ConsoleLogger._nativeConsole.clear.apply(console, arguments);
			const text = 'console.clear() was called';
			const stackText = getStackFor('clear');
			ConsoleLogger.addEntry('debug', [text], { source: nativeSource, kind: ENTRY_KIND.CLEAR, stackText });
		};

		// ───── Assert ────────────────────────
		ConsoleLogger._nativeConsole.assert = console.assert.bind(console);
		console.assert = function (condition, ...args) {
			ConsoleLogger._nativeConsole.assert.apply(console, arguments);
			const prefix = condition ? '🟢 [Assertion passed] ' : '🔴 [Assertion failed] ';
			const entryArgs = args.length ? prefixArgs(prefix, args) : [prefix];

			if (condition) {
				ConsoleLogger.addEntry('debug', entryArgs, { source: nativeSource, stackText: null });
			} else {
				const stackText = getStackFor('assert', findErrorArg(args));
				ConsoleLogger.addEntry('error', entryArgs, { source: nativeSource, stackText });
			}
		};

		// ───── Time, timeLog, timeEnd ────────────────────────
		ConsoleLogger._nativeConsole.time = console.time.bind(console);
		console.time = function (label) {
			ConsoleLogger._nativeConsole.time.apply(console, arguments);
			const key = label === undefined ? DEFAULT_LABEL : String(label);
			ConsoleLogger._timers[key] = performance.now();
			const stackText = getStackFor('time');
			ConsoleLogger.addEntry('stats', [`⏱️ [Timer] ${key}: started`], {
				source: nativeSource, kind: ENTRY_KIND.TIME, stackText,
				timeData: { label: key, phase: 'start', elapsedMs: null, valid: true, extra: '' },
			});
		};

		ConsoleLogger._nativeConsole.timeLog = console.timeLog.bind(console);
		console.timeLog = function (label, ...data) {
			ConsoleLogger._nativeConsole.timeLog.apply(console, arguments);
			const key = label === undefined ? DEFAULT_LABEL : String(label);
			const valid = ConsoleLogger._timers[key] !== undefined;
			const elapsedMs = valid ? performance.now() - ConsoleLogger._timers[key] : null;
			const elapsedText = valid ? `${elapsedMs.toFixed(3)} ms` : 'not exist';
			const extra = data.length ? data.map(stringifyArg).join(' ') : '';
			const stackText = getStackFor('timeLog');
			ConsoleLogger.addEntry('stats', [`⏱️ [Timer] ${key}: ${elapsedText}${extra ? ' — ' + extra : ''}`], {
				source: nativeSource, kind: ENTRY_KIND.TIME, stackText,
				timeData: { label: key, phase: 'log', elapsedMs, valid, extra },
			});
		};

		ConsoleLogger._nativeConsole.timeEnd = console.timeEnd.bind(console);
		console.timeEnd = function (label) {
			ConsoleLogger._nativeConsole.timeEnd.apply(console, arguments);
			const key = label === undefined ? DEFAULT_LABEL : String(label);
			const valid = ConsoleLogger._timers[key] !== undefined;
			const elapsedMs = valid ? performance.now() - ConsoleLogger._timers[key] : null;
			const elapsedText = valid ? `${elapsedMs.toFixed(3)} ms` : 'not exist';
			delete ConsoleLogger._timers[key];
			const stackText = getStackFor('timeEnd');
			ConsoleLogger.addEntry('stats', [`⏱️ [Timer] ${key}: ${elapsedText} (done)`], {
				source: nativeSource, kind: ENTRY_KIND.TIME, stackText,
				timeData: { label: key, phase: 'end', elapsedMs, valid, extra: '' },
			});
		};

		// ───── Count, countReset ────────────────────────
		ConsoleLogger._nativeConsole.count = console.count.bind(console);
		console.count = function (label) {
			ConsoleLogger._nativeConsole.count.apply(console, arguments);
			const key = label === undefined ? DEFAULT_LABEL : String(label);
			ConsoleLogger._countMap[key] = (ConsoleLogger._countMap[key] || 0) + 1;
			const value = ConsoleLogger._countMap[key];
			const newPeak = Math.max(ConsoleLogger._countPeakMap[key] || 0, value);
			const peakGrew = newPeak !== ConsoleLogger._countPeakMap[key];
			ConsoleLogger._countPeakMap[key] = newPeak;
			const stackText = getStackFor('count');
			ConsoleLogger.addEntry('stats', [`❇️ [Counter] ${key}: ${value}`], {
				source: nativeSource, kind: ENTRY_KIND.COUNT, stackText,
				countData: { label: key, value, valid: true, phase: 'count', maxSeen: newPeak },
			});
			// Peak grew — earlier bars for this label are now relatively shorter, refresh them.
			if (peakGrew) ConsoleLogger.refreshCountBars(key, newPeak);
		};

		ConsoleLogger._nativeConsole.countReset = console.countReset.bind(console);
		console.countReset = function (label) {
			ConsoleLogger._nativeConsole.countReset.apply(console, arguments);
			const key = label === undefined ? DEFAULT_LABEL : String(label);
			const valid = ConsoleLogger._countMap[key] !== undefined;
			ConsoleLogger._countMap[key] = 0;
			const stackText = getStackFor('countReset');
			ConsoleLogger.addEntry('stats', [`❇️ [Counter] ${key}: reset`], {
				source: nativeSource, kind: ENTRY_KIND.COUNT, stackText,
				countData: { label: key, value: 0, valid, phase: 'reset', maxSeen: ConsoleLogger._countPeakMap[key] || 1 },
			});
		};
	};

	// Restores all patched console methods to their originals. Safe to call when not intercepted.
	ConsoleLogger.restoreNative = function () {
		if (!ConsoleLogger._nativeIntercepted) return;
		[
			'log', 'info', 'debug',
			'warn', 'error',
			'group', 'groupCollapsed', 'groupEnd',
			'table', 'dir', 'dirxml',
			'trace', 'clear', 'assert',
			'time', 'timeLog', 'timeEnd',
			'count', 'countReset',
		].forEach(method => {
			if (ConsoleLogger._nativeConsole[method]) {
				console[method] = ConsoleLogger._nativeConsole[method];
			}
		});
		ConsoleLogger._nativeIntercepted = false;
	};

	//***********************************
	//    GAME INTERCEPTION
	//***********************************

	// Patches Game.Notify and Game.Popup to mirror messages into the log (HTML stripped).
	ConsoleLogger.interceptGame = function () {
		const gameSource = ENTRY_SOURCE.GAME;
		if (!ConsoleLogger.config.intercept[gameSource]) return;
		if (ConsoleLogger._gameIntercepted) return;
		ConsoleLogger._gameIntercepted = true;

		ConsoleLogger._origGameNotify = Game.Notify;
		const origNotify = ConsoleLogger._origGameNotify;
		Game.Notify = function (title, desc, icon, lifeTime, noLog) {
			origNotify.apply(this, arguments);
			const cleanDesc = typeof desc === 'string' ? desc.replace(/<[^>]*>/g, '') : String(desc);
			const stackText = getStackFor('gameNotify');
			ConsoleLogger.addEntry('game', [`[Notify] ${title}: ${cleanDesc}`], { source: gameSource, stackText });
		};

		ConsoleLogger._origGamePopup = Game.Popup;
		const origPopup = ConsoleLogger._origGamePopup;
		Game.Popup = function (str) {
			origPopup.apply(this, arguments);
			const clean = typeof str === 'string' ? str.replace(/<[^>]*>/g, '') : String(str);
			const stackText = getStackFor('gamePopup');
			ConsoleLogger.addEntry('game', [`[Popup] ${clean}`], { source: gameSource, stackText });
		};
	};

	// Restores Game.Notify and Game.Popup to their originals.
	ConsoleLogger.restoreGame = function () {
		if (!ConsoleLogger._gameIntercepted) return;
		if (ConsoleLogger._origGameNotify) Game.Notify = ConsoleLogger._origGameNotify;
		if (ConsoleLogger._origGamePopup) Game.Popup = ConsoleLogger._origGamePopup;
		ConsoleLogger._gameIntercepted = false;
	};

	//***********************************
	//    GLOBAL ERRORS INTERCEPTION
	//***********************************

	// Hooks 'error' and 'unhandledrejection' to catch uncaught exceptions/rejections (non-destructive).
	ConsoleLogger.interceptGlobalErrors = function () {
		const globalErrorsSource = ENTRY_SOURCE.GLOBAL_ERRORS;
		if (!ConsoleLogger.config.intercept[globalErrorsSource]) return;
		if (ConsoleLogger._globalIntercepted) return;
		ConsoleLogger._globalIntercepted = true;

		ConsoleLogger._onWindowError = function (e) {
			const source = e.filename ? ` (${String(e.filename).split('/').pop()}:${e.lineno}:${e.colno})` : '';
			const stackText = getStackFor('error', e.error instanceof Error ? e.error : null);
			ConsoleLogger.addEntry('error', [`[uncaught] ${e.message}${source}`], {
				source: globalErrorsSource, kind: ENTRY_KIND.TRACE, stackText
			});
		};
		window.addEventListener('error', ConsoleLogger._onWindowError);

		ConsoleLogger._onUnhandledRejection = function (e) {
			const reasonErr = e.reason instanceof Error ? e.reason : null;
			const reason = reasonErr ? reasonErr.message : String(e.reason);
			const stackText = getStackFor('error', reasonErr);
			ConsoleLogger.addEntry('error', [`[unhandledrejection] ${reason}`], {
				source: globalErrorsSource, kind: ENTRY_KIND.TRACE, stackText
			});
		};
		window.addEventListener('unhandledrejection', ConsoleLogger._onUnhandledRejection);
	};

	// Removes the 'error' and 'unhandledrejection' listeners installed above.
	ConsoleLogger.restoreGlobalErrors = function () {
		if (!ConsoleLogger._globalIntercepted) return;
		if (ConsoleLogger._onWindowError) window.removeEventListener('error', ConsoleLogger._onWindowError);
		if (ConsoleLogger._onUnhandledRejection) window.removeEventListener('unhandledrejection', ConsoleLogger._onUnhandledRejection);
		ConsoleLogger._globalIntercepted = false;
	};

	//***********************************
	//    RESOURCE ERRORS INTERCEPTION
	//***********************************

	// Resource tags whose failed-load 'error' events we care about (capture-only, doesn't bubble).
	const RESOURCE_ERROR_TAGS = new Set(['IMG', 'SCRIPT', 'LINK', 'IFRAME', 'OBJECT', 'EMBED', 'TRACK', 'SOURCE', 'STYLE', 'BODY', 'FRAMESET']);

	// Best-effort extraction of the URL that failed to load, tag-dependent.
	function getResourceUrl(el) {
		if (!el) return '';
		return el.currentSrc || el.src || el.href || el.data || '';
	}

	// Wraps Image constructor to catch load errors on detached images (not reachable via window capture).
	ConsoleLogger._patchImageConstructor = function () {
		if (ConsoleLogger._origImage) return;
		ConsoleLogger._origImage = window.Image;
		const OrigImage = ConsoleLogger._origImage;

		window.Image = function (...args) {
			const img = new OrigImage(...args);
			img.addEventListener('error', function () {
				const stackText = getStackFor('resourceError');
				ConsoleLogger.addEntry('error', [`[resource] IMG failed to load: ${getResourceUrl(img)}`], {
					source: ENTRY_SOURCE.RESOURCE_ERRORS, kind: ENTRY_KIND.TRACE, stackText
				});
			});
			return img;
		};
		window.Image.prototype = OrigImage.prototype;
	};

	// Restores native Image constructor. Clears _origImage so re-patching works correctly.
	ConsoleLogger._unpatchImageConstructor = function () {
		if (!ConsoleLogger._origImage) return;
		window.Image = ConsoleLogger._origImage;
		ConsoleLogger._origImage = null;
	};

	// Captures resource load failures (img/script/link/…) via capture-phase 'error' event.
	ConsoleLogger.interceptResourceErrors = function () {
		const resourceErrorsSource = ENTRY_SOURCE.RESOURCE_ERRORS;
		if (!ConsoleLogger.config.intercept[resourceErrorsSource]) return;
		if (ConsoleLogger._resourceIntercepted) return;
		ConsoleLogger._resourceIntercepted = true;

		ConsoleLogger._onResourceError = function (e) {
			const target = e.target;
			if (!target || target === window) return; // real script errors go through _onWindowError instead
			const tag = target.tagName;
			if (!tag || !RESOURCE_ERROR_TAGS.has(tag)) return;

			const url = getResourceUrl(target);
			const label = url ? `${tag} failed to load: ${url}` : `${tag} failed to load`;
			const stackText = getStackFor('resourceError');
			ConsoleLogger.addEntry('error', [`[resource] ${label}`], {
				source: resourceErrorsSource, kind: ENTRY_KIND.TRACE, stackText
			});
		};
		window.addEventListener('error', ConsoleLogger._onResourceError, true);
		ConsoleLogger._patchImageConstructor();
	};

	// Removes the resource-error listener and Image patch installed above.
	ConsoleLogger.restoreResourceErrors = function () {
		if (!ConsoleLogger._resourceIntercepted) return;
		if (ConsoleLogger._onResourceError) window.removeEventListener('error', ConsoleLogger._onResourceError, true);
		ConsoleLogger._unpatchImageConstructor();
		ConsoleLogger._resourceIntercepted = false;
	};

	//***********************************
	//    NETWORK INTERCEPTION (fetch / XHR)
	//***********************************

	// Wraps fetch and XHR to log failed network requests (non-2xx, errors, timeouts).
	ConsoleLogger.interceptNetwork = function () {
		const networkSource = ENTRY_SOURCE.NETWORK;
		if (!ConsoleLogger.config.intercept[networkSource]) return;
		if (ConsoleLogger._networkIntercepted) return;
		ConsoleLogger._networkIntercepted = true;

		// ───── Fetch ────────────────────────
		if (window.fetch) {
			ConsoleLogger._origFetch = window.fetch;
			window.fetch = function (input, init) {
				const url = (typeof input === 'string') ? input : (input && input.url) || '';
				const method = (init && init.method) || (input && input.method) || 'GET';
				const stackText = getStackFor('network');
				return ConsoleLogger._origFetch.apply(this, arguments).then(function (response) {
					if (!response.ok) {
						ConsoleLogger.addEntry('error', [`[fetch] ${method} ${url} -> ${response.status} ${response.statusText}`], { source: networkSource, kind: ENTRY_KIND.TRACE, stackText });
					}
					return response;
				}).catch(function (err) {
					ConsoleLogger.addEntry('error', [`[fetch] ${method} ${url} failed: ${err && err.message ? err.message : err}`], { source: networkSource, kind: ENTRY_KIND.TRACE, stackText });
					throw err;
				});
			};
		}

		// ───── XMLHttpRequest ────────────────────────
		if (window.XMLHttpRequest) {
			const origOpen = XMLHttpRequest.prototype.open;
			const origSend = XMLHttpRequest.prototype.send;

			XMLHttpRequest.prototype.open = function (method, url) {
				this._consoleLoggerMethod = method;
				this._consoleLoggerUrl = url;
				return origOpen.apply(this, arguments);
			};

			XMLHttpRequest.prototype.send = function () {
				const stackText = getStackFor('network');
				const logIfFailed = () => {
					const status = this.status;
					if (status === 0 || status >= 400) {
						ConsoleLogger.addEntry('error', [`[xhr] ${this._consoleLoggerMethod || ''} ${this._consoleLoggerUrl || ''} -> ${status || 'network error'}`], { source: networkSource, kind: ENTRY_KIND.TRACE, stackText });
					}
				};
				this.addEventListener('error', logIfFailed);
				this.addEventListener('timeout', logIfFailed);
				this.addEventListener('load', logIfFailed);
				return origSend.apply(this, arguments);
			};

			ConsoleLogger._origXhrOpen = origOpen;
			ConsoleLogger._origXhrSend = origSend;
		}
	};

	// Restores patched fetch and XHR methods to their originals.
	ConsoleLogger.restoreNetwork = function () {
		if (!ConsoleLogger._networkIntercepted) return;
		if (ConsoleLogger._origFetch) window.fetch = ConsoleLogger._origFetch;
		if (ConsoleLogger._origXhrOpen) XMLHttpRequest.prototype.open = ConsoleLogger._origXhrOpen;
		if (ConsoleLogger._origXhrSend) XMLHttpRequest.prototype.send = ConsoleLogger._origXhrSend;
		ConsoleLogger._networkIntercepted = false;
	};

	// Brings actual interceptor state in line with ConsoleLogger.config.intercept (config can change late).
	ConsoleLogger.syncIntercepts = function () {
		Object.entries(SOURCE_REGISTRY).forEach(([key, { flag, on, off }]) => {
			const wantOn = !!ConsoleLogger.config.intercept[key];
			const isOn = !!ConsoleLogger[flag];
			if (wantOn && !isOn) ConsoleLogger[on]();
			else if (!wantOn && isOn) ConsoleLogger[off]();
		});
	};

	// Removes stored entries for the given sources and refreshes the "X new" badge count.
	ConsoleLogger.purgeSourceEntries = function (sourceKeys) {
		if (!sourceKeys.length) return;
		ConsoleLogger.logs = ConsoleLogger.logs.filter(e => e.protected || !sourceKeys.includes(e.source));

		if (!ConsoleLogger.config.windowOpen) {
			const recalculated = { total: 0, error: 0, warn: 0 };
			ConsoleLogger.logs.forEach(e => {
				if (ConsoleLogger.isEntryVisible(e, '')) {
					recalculated.total++;
					if (e.level === 'error') recalculated.error++;
					else if (e.level === 'warn') recalculated.warn++;
				}
			});
			ConsoleLogger._newCount = recalculated;
			ConsoleLogger.updateOpenBtnState();
		} else {
			ConsoleLogger.rebuildLog();
		}
	};

	// Flips a source on/off, syncs the interceptor, and purges its entries when disabling.
	ConsoleLogger.setSourceEnabled = function (key, enabled) {
		const meta = SOURCE_REGISTRY[key];
		if (!meta) return;
		ConsoleLogger.config.intercept[key] = enabled;
		if (enabled) {
			ConsoleLogger[meta.on]();
		} else {
			ConsoleLogger[meta.off]();
			ConsoleLogger.purgeSourceEntries([key]);
		}
	};

	//***********************************
	//    FILE SAVE
	//***********************************

	// Downloads the log as a .txt file. visibleOnly=true exports only filter-matching entries.
	ConsoleLogger.saveLogsToFile = function (visibleOnly) {
		const source = visibleOnly
			? ConsoleLogger.logs.filter(e => ConsoleLogger.isEntryVisible(e))
			: ConsoleLogger.logs;

		const includeStack = !!ConsoleLogger.config.saveIncludeStackTraces;
		const expandDups = !!ConsoleLogger.config.saveExpandDuplicates;
		const lines = source.map(entry => formatEntryLine(entry, includeStack, expandDups));

		if (visibleOnly && lines.length === 0) {
			Game.Popup('Console Logger: no visible entries to save.');
			return;
		}

		const content = lines.join('\n');
		const now = new Date();
		const pad = n => String(n).padStart(2, '0');
		const suffix = visibleOnly ? '_filtered' : '';
		const filename = `${LOG_FILE_PREFIX}${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
			+ `_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}${suffix}.txt`;

		// Trigger browser download
		const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);

		Game.Notify(ConsoleLogger.name, `Saved: ${filename}`, [32, 17], 10);
	};

	//***********************************
	//    STYLE
	//***********************************

	// Injects all ConsoleLogger CSS into the page.
	ConsoleLogger.injectStyles = function () {
		const s = `
			/* ========================= */
			/* ====== Open button ====== */
			/* ========================= */

			#consoleLogger-open-btn {
				position: fixed;
				bottom: 16px;
				right: 16px;
				z-index: 9000;
				padding: 5px 12px;
				color: ${TOKENS.textSecondary};
				font-size: 13px;
				font-family: system-ui, -apple-system, sans-serif;
				background: ${TOKENS.bgButton};
				border: 1px solid ${TOKENS.borderStrong};
				border-radius: 6px;
				cursor: pointer;
				user-select: none;
				pointer-events: all;
				transition: background 0.15s, border-color 0.15s;
			}
			#consoleLogger-open-btn::before {
				content: "";
				position: absolute;
				inset: 0;
				z-index: -1;
				background: ${TOKENS.bgButton};
				border-radius: inherit;
			}
			#consoleLogger-open-btn:hover {
				background: ${TOKENS.bgSurfaceHover};
				color: ${TOKENS.textWhite};
				text-shadow: 0 0 10px ${TOKENS.bgSurfaceStrong};
			}

			#consoleLogger-open-btn-badge {
				display: none;
				position: absolute;
				top: -8px;
				right: 3px;
				min-width: 16px;
				height: 12px;
				padding: 0 2px;
				color: ${TOKENS.textPrimary} !important;
				font-size: 10px;
				font-weight: bold;
				font-family: system-ui, -apple-system, sans-serif;
				text-align: center;
				background: ${TOKENS.bgButton};
				border: 1px solid ${TOKENS.borderStrong};
				border-radius: 6px;
				pointer-events: none;
			}
			#consoleLogger-open-btn-badge.visible { display: inline-block; }

			/* ==================== */
			/* ====== Window ====== */
			/* ==================== */

			#consoleLogger-window {
				position: fixed;
				z-index: 99999 !important;
				display: flex;
				flex-direction: column;
				min-width: 320px;
				min-height: 180px;
				overflow: hidden;
				color: ${TOKENS.textPrimary};
				font-size: 12px;
				font-family: system-ui, -apple-system, sans-serif;
				background: ${TOKENS.bgWindow};
				border: 1px solid ${TOKENS.borderMedium};
				border-radius: 8px;
				box-shadow: 2px 8px 32px ${TOKENS.bgShadow};
				user-select: none;
				pointer-events: all;
			}
			#consoleLogger-window.hidden { display: none !important; }
			#consoleLogger-window button:focus { outline: 0 !important; box-shadow: none !important; }

			.consoleLogger-btn-primary       { border-color: ${TOKENS.accentPrimaryMid} !important; color: ${TOKENS.accentPrimary} !important; }
			.consoleLogger-btn-primary:hover { background: ${TOKENS.accentPrimaryMuted} !important; border-color: ${TOKENS.accentPrimaryStrong} !important; }
			.consoleLogger-btn-success       { border-color: ${TOKENS.accentSuccessMid} !important; color: ${TOKENS.accentSuccess} !important; }
			.consoleLogger-btn-success:hover { background: ${TOKENS.accentSuccessMuted} !important; border-color: ${TOKENS.accentSuccessStrong} !important; }
			.consoleLogger-btn-warning       { border-color: ${TOKENS.accentWarningMid} !important; color: ${TOKENS.textWarning} !important; }
			.consoleLogger-btn-warning:hover { background: ${TOKENS.accentWarningMuted} !important; border-color: ${TOKENS.accentWarningStrong} !important; }
			.consoleLogger-btn-danger        { border-color: ${TOKENS.accentDangerMid} !important;  color: ${TOKENS.textDanger} !important; }
			.consoleLogger-btn-danger:hover  { background: ${TOKENS.accentDangerMuted} !important;  border-color: ${TOKENS.accentDangerStrong} !important; }
			
			/* ======================= */
			/* ====== Title bar ====== */
			/* ======================= */

			#consoleLogger-title-bar {
				display: flex;
				gap: 6px;
				padding: 6px 8px;
				flex-shrink: 0;
				flex-wrap: wrap;
				background: ${TOKENS.bgSurface};
				border-bottom: 1px solid ${TOKENS.borderMedium};
				cursor: move;
				user-select: none;
			}
			#consoleLogger-title {
				flex: 1;
				min-width: 60px;
				align-self: center;
				overflow: hidden;
				color: ${TOKENS.textTableHeader};
				font-size: 12px;
				font-weight: bold;
				letter-spacing: 0.04em;
				line-height: 1.5;
				white-space: nowrap;
				text-overflow: ellipsis;
			}
			#consoleLogger-title-bar button {
				padding: 2px 6px;
				color: ${TOKENS.textSecondary};
				font-size: 11px;
				font-family: system-ui, -apple-system, sans-serif;
				line-height: 1.4;
				white-space: nowrap;
				background: ${TOKENS.bgButton};
				border: 1px solid ${TOKENS.borderStrong};
				border-radius: 4px;
				cursor: pointer;
			}
			#consoleLogger-title-bar button:hover { background: ${TOKENS.bgSurfaceHover}; color: ${TOKENS.textWhite}; }

			/* ============================== */
			/* ====== Opacity dropdown ====== */
			/* ============================== */

			#consoleLogger-opacity-wrap {
				position: relative;
				display: inline-flex;
				cursor: default;
			}
			#consoleLogger-opacity-btn {
				padding: 2px 6px;
				color: ${TOKENS.textSecondary};
				font-size: 11px;
				font-family: system-ui, -apple-system, sans-serif;
				line-height: 1.4;
				background: ${TOKENS.bgButton};
				border: 1px solid ${TOKENS.borderStrong};
				border-radius: 4px;
				outline: none;
				cursor: pointer;
			}
			#consoleLogger-opacity-btn:hover,
			#consoleLogger-opacity-btn.active { background: ${TOKENS.bgSurfaceHover}; color: ${TOKENS.textWhite}; }

			#consoleLogger-opacity-panel {
				display: flex;
				align-items: center;
				gap: 4px;
				position: absolute;
				top: calc(100% + 4px);
				right: -40px;
				z-index: 9000;
				padding: 8px 10px;
				white-space: nowrap;
				background: ${TOKENS.bgWindow};
				border: 1px solid ${TOKENS.borderStrong};
				border-radius: 4px;
				box-shadow: 0 4px 12px ${TOKENS.bgShadow};
			}
			#consoleLogger-opacity-panel.hidden { display: none !important; }

			#consoleLogger-opacity-slider {
				-webkit-appearance: none !important;
				width: auto;
				height: 10px;
				background: transparent;
				cursor: pointer;
			}
			#consoleLogger-opacity-slider::-webkit-slider-runnable-track {
				height: 8px;
				background: ${TOKENS.bgSurfaceStrong};
				border: 1px solid ${TOKENS.borderMedium};
				border-radius: 99px;
			}
			#consoleLogger-opacity-slider::-webkit-slider-thumb {
				-webkit-appearance: none !important;
				width: 12px;
				height: 12px;
				margin-top: -3px;
				background: ${TOKENS.accentPrimary};
				border-radius: 50%;
				box-shadow: none;
				transition: transform 0.15s ease, box-shadow 0.15s ease;
			}
			#consoleLogger-opacity-slider:hover::-webkit-slider-thumb { transform: scale(1.10); box-shadow: 0 0 8px ${TOKENS.accentPrimary}; }
			#consoleLogger-opacity-slider:active::-webkit-slider-thumb { transform: scale(1.25); }

			#consoleLogger-opacity-value {
				display: inline-block;
				min-width: 28px;
				color: ${TOKENS.textSecondary};
				font-size: 11px;
				font-family: system-ui, -apple-system, sans-serif;
				text-align: right;
			}

			/* ========================= */
			/* ====== Filters bar ====== */
			/* ========================= */

			#consoleLogger-filters {
				display: flex;
				gap: 4px;
				padding: 5px 8px;
				flex-shrink: 0;
				flex-wrap: wrap;
				background: ${TOKENS.bgSurface};
				border-bottom: 1px solid ${TOKENS.borderSubtle};
				user-select: none;
			}
			.consoleLogger-filter-btn {
				padding: 1px 7px;
				opacity: 0.35;
				font-size: 11px;
				font-family: system-ui, -apple-system, sans-serif;
				font-weight: bold;
				background: none;
				border: 1px solid currentColor;
				border-radius: 3px;
				cursor: pointer;
				transition: opacity 0.12s;
			}
			.consoleLogger-filter-btn:hover { background: var(--filter-hover-bg); }
			.consoleLogger-filter-btn.active { opacity: 1; }

			.consoleLogger-filter-count {
				font-size: 10px;
				opacity: 0.6;
				margin-left: 2px;
			}

			#consoleLogger-search {
				flex: 1;
				min-width: 80px;
				padding: 2px 6px;
				box-shadow: none;
				outline: none;
				color: ${TOKENS.textPrimary};
				font-size: 11px;
				font-family: system-ui, -apple-system, sans-serif;
				background: ${TOKENS.bgSurface};
				border: 1px solid ${TOKENS.borderMedium};
				border-radius: 3px;
			}
			#consoleLogger-search::placeholder { color: ${TOKENS.textDimmer}; }
			#consoleLogger-search:hover { background: ${TOKENS.bgSurfaceHover}; }

			/* ========================= */
			/* ====== Actions bar ====== */
			/* ========================= */

			#consoleLogger-toolbar {
				display: flex;
				gap: 4px;
				padding: 5px 8px;
				flex-shrink: 0;
				flex-wrap: wrap;
				background: ${TOKENS.bgSurface};
				border-bottom: 1px solid ${TOKENS.borderSubtle};
				user-select: none;
			}
			#consoleLogger-toolbar button {
				padding: 2px 7px;
				color: ${TOKENS.textSecondary};
				font-size: 11px;
				line-height: 1.4;
				white-space: nowrap;
				background: none;
				border: 1px solid ${TOKENS.borderStrong};
				border-radius: 4px;
				cursor: pointer;
			}
			#consoleLogger-toolbar button:hover { background: ${TOKENS.bgSurfaceHover}; color: ${TOKENS.textWhite}; }

			/* ====================== */
			/* ====== Dropdown ====== */
			/* ====================== */

			.consoleLogger-dropdown {
				position: relative;
				display: flex;
			}
			.consoleLogger-dropdown-toggle {
				position: relative;
				min-width: 110px;
				padding-right: 20px !important;
				text-align: left !important;
			}
			.consoleLogger-dropdown-toggle::after {
				content: "▼";
				position: absolute;
				top: 50%;
				right: 6px;
				font-size: 8px;
				opacity: 0.7;
				transform: translateY(-50%);
			}
			.consoleLogger-dropdown-menu {
				display: flex;
				flex-direction: column;
				position: absolute;
				top: calc(100% + 4px);
				right: 0;
				z-index: 9000;
				padding: 4px 0;
				font-size: 12px;
				white-space: nowrap;
				background: ${TOKENS.bgWindow};
				border: 1px solid ${TOKENS.borderBold};
				border-radius: 4px;
				box-shadow: 0 4px 12px ${TOKENS.bgShadow};
				cursor: auto;
			}
			.consoleLogger-dropdown-menu.hidden { display: none !important; }
			
			.consoleLogger-dropdown-menu.consoleLogger-dropdown-menu-up {
				top: auto;
				bottom: calc(100% + 4px);
			}

			.consoleLogger-dropdown-menu label,
			.consoleLogger-dropdown-menu button {
				padding: 6px 12px !important;
				color: ${TOKENS.textPrimary} !important;
				text-align: left !important;
				border: none !important;
				border-radius: 0 !important;
				cursor: pointer !important;
			}
			.consoleLogger-dropdown-menu button.selected { 
				background: ${TOKENS.bgSurface} !important; 
				color: ${TOKENS.textWhite} !important;
			}
			.consoleLogger-dropdown-menu label:hover,
			.consoleLogger-dropdown-menu button:hover {
				background: ${TOKENS.bgSurfaceHover} !important;  
				color: ${TOKENS.textWhite} !important; 
			}

			.consoleLogger-dropdown-menu .hint { color: ${TOKENS.textMuted}; }

			/* ====================== */
			/* ====== Log body ====== */
			/* ====================== */

			#consoleLogger-body-wrap {
				flex: 1;
				position: relative;
				display: flex;
				overflow: hidden;
				background: ${TOKENS.bgMenu};
			}
			#consoleLogger-body {
				flex: 1;
				overflow-y: auto;
				overflow-x: hidden;
				/* scroll-behavior: smooth; */
			}
			#consoleLogger-body::-webkit-scrollbar { width: 13px; background: transparent; border-left: 1px solid ${TOKENS.borderMedium}; }
			#consoleLogger-body::-webkit-scrollbar-track { background: transparent; }
			#consoleLogger-body::-webkit-scrollbar-thumb {
				background: ${TOKENS.textPrimary};
				background-clip: padding-box;
				border: 2px solid transparent;
				border-left: 3px solid transparent;
				border-radius: 8px;
				box-shadow: none;
			}

			#consoleLogger-timeline {
				position: absolute;
				right: 0;
				top: 6px;
				bottom: 6px;
				z-index: 100;
				pointer-events: none;
			}
			.consoleLogger-timeline-pin {
				position: absolute;
				right: 0;
				width: 10px;
				height: 10px;
				background: var(--pin-color, ${TOKENS.bgTimelinePin});
				border: 1px solid ${TOKENS.bgShadow};
				border-radius: 50%;
				cursor: pointer;
				pointer-events: all;
				transform: translateY(-50%);
				transition: transform 0.1s;
			}
			.consoleLogger-timeline-pin:hover {
				box-shadow: 0 0 4px var(--pin-color, ${TOKENS.bgTimelinePin});
				transform: translateY(-50%) scale(1.3);
			}

			/* =========================== */
			/* ====== Unread banner ====== */
			/* =========================== */

			#consoleLogger-unread-banner {
				display: none;
				align-items: center;
				justify-content: center;
				gap: 8px;
				padding: 5px 10px;
				flex-shrink: 0;
				color: ${TOKENS.accentWarning};
				font-size: 11px;
				font-weight: bold;
				letter-spacing: 0.03em;
				background: ${TOKENS.accentWarningMuted};
				border-top: 1px solid ${TOKENS.accentWarningStrong};
				cursor: pointer;
				user-select: none;
				transition: background 0.15s;
			}
			#consoleLogger-unread-banner:hover { background: ${TOKENS.accentWarningMid}; }
			#consoleLogger-unread-banner.visible { display: flex; }

			/* ======================== */
			/* ====== Status bar ====== */
			/* ======================== */

			.divider-v {
				min-height: 1em;
				align-self: stretch;
				margin: 0;
				border: none;
				border-left: 1px solid ${TOKENS.borderMedium};
			}
			#consoleLogger-status-bar {
				display: flex;
				align-items: center;
				gap: 6px;
				padding: 5px 20px 5px 8px;
				flex-shrink: 0;
				flex-wrap: wrap;
				color: ${TOKENS.textMuted};
				font-size: 10px;
				background: ${TOKENS.bgSurface};
				border-top: 1px solid ${TOKENS.borderSubtle};
				user-select: none;
			}
			#consoleLogger-status-bar button {
				padding: 2px 8px;
				color: ${TOKENS.accentPrimary};
				font-size: 11px;
				font-family: system-ui, -apple-system, sans-serif;
				line-height: 1.4;
				white-space: nowrap;
				background: ${TOKENS.bgSurfaceLight};
				border: 1px solid ${TOKENS.borderMedium};
				border-radius: 4px;
				cursor: pointer;
			}
			#consoleLogger-status-bar button:hover { background: ${TOKENS.bgSurfaceStrong}; }

			.checkbox-label {
				display: flex;
				align-items: center;
				gap: 4px;
				cursor: pointer;
			}
			.checkbox-label input[type="checkbox"] { cursor: pointer; }

			.consoleLogger-settings-divider {
				border: none;
				border-top: 1px solid ${TOKENS.borderSubtle};
				margin: 4px 0;
			}
			.consoleLogger-settings-section-label {
			    padding: 6px 12px !important;
				color: ${TOKENS.textMuted};
				font-size: 0.75em;
				text-transform: uppercase;
				letter-spacing: 0.05em;
				padding: 2px 0 1px;
				user-select: none;
			}

			.consoleLogger-btn-group {
				display: flex;
				align-items: center;
				gap: 3px;
			}
			.consoleLogger-btn-group-label {
				color: ${TOKENS.textMuted};
				white-space: nowrap;
				margin-right: 2px;
			}
			.consoleLogger-btn-group button {
				min-width: 18px;
				padding: 2px 4px !important;
				font-size: 9px !important;
				line-height: 1.5 !important;
			}
			#consoleLogger-btn-clear { color: ${TOKENS.textDanger} !important; border-color: ${TOKENS.accentDangerMid} !important; }
			#consoleLogger-btn-clear:hover { background: ${TOKENS.accentDangerMuted} !important; }

			/* =========================== */
			/* ====== Resize handle ====== */
			/* =========================== */

			#consoleLogger-resize-handle {
				position: absolute;
				bottom: 0;
				right: 0;
				width: 16px;
				height: 16px;
				opacity: 0.4;
				background: linear-gradient(135deg, transparent 50%, ${TOKENS.textSubtleHover} 50%);
				cursor: se-resize;
			}
			#consoleLogger-resize-handle:hover { opacity: 0.9; }

			/* ======================= */
			/* ====== Log entry ====== */
			/* ======================= */

			.consoleLogger-entry {
				position: relative;
				display: flex;
				align-items: flex-start;
				gap: 6px;
				padding-inline: 8px;
				border-bottom: 1px solid ${TOKENS.borderSubtle};
				transition: background 0.2s;
				isolation: isolate;
				contain: paint;
			}
			.consoleLogger-entry:last-child { border-bottom: none; }
			.consoleLogger-entry:hover { background: ${TOKENS.bgSurfaceStrong} !important; }
			.consoleLogger-entry.filtered { display: none !important; }
			.consoleLogger-entry.group-hidden { display: none !important; }

			.consoleLogger-entry.is-dir {
				box-shadow: inset 4px 0 0 0 ${TOKENS.accentSecondaryStrong};
				background: ${TOKENS.bgSecondary} !important;
			}
			.consoleLogger-entry.is-dir:hover {
				background: ${TOKENS.bgSecondaryHover} !important;
			}

			.consoleLogger-entry.in-group {
				box-shadow: inset 4px 0 0 0 ${TOKENS.accentPrimaryStrong};
				background: ${TOKENS.bgPrimary} !important;
			}
			.consoleLogger-entry.in-group:hover {
				background: ${TOKENS.bgPrimaryHover} !important;
			}

			.consoleLogger-entry-highlight { background: ${TOKENS.bgHighlight} !important; }

			.consoleLogger-meta {
				display: flex;
				align-items: center;
				gap: 6px;
				padding-block: 2px;
				flex-shrink: 0;
			}
			.consoleLogger-ts {
				flex-shrink: 0;
				padding-right: 4px;
				color: ${TOKENS.textDimmer};
				font-size: 10px;
			}
			.consoleLogger-badge {
				display: inline-flex;
				justify-content: center;
				flex-shrink: 0;
				min-width: 34px;
				padding: 2px 4px;
				font-size: 10px;
				font-weight: bold;
				letter-spacing: 0.05em;
				text-align: center;
				border-radius: 3px;
				user-select: none;
			}
			.consoleLogger-arrow {
				flex-shrink: 0;
				width: 12px;
				text-align: center;
				color: ${TOKENS.textDimmer};
				font-size: 10px;
				cursor: pointer;
				user-select: none;
			}
			.consoleLogger-dup-count {
				display: none;
				flex-shrink: 0;
				padding: 2px 6px;
				color: ${TOKENS.textSubtleHover};
				font-size: 10px;
				font-weight: bold;
				background: ${TOKENS.bgSurfaceStrong};
				border: 1px solid ${TOKENS.borderMedium};
				border-radius: 16px;
				user-select: none;
			}
			.consoleLogger-dup-count.visible { display: inline; }

			.consoleLogger-content {
				display: flex;
				padding-block: 2px;
				/* flex-direction: column; */
				flex: 1;
				min-width: 0;
    			align-items: flex-end;
    			flex-wrap: wrap;
			}
			.consoleLogger-message-row {
				display: flex;
				align-items: flex-start;
				width: 100%;
				min-width: 0;
			}
			.consoleLogger-message-row.collapsed {
				width: 100%;
				cursor: pointer;
			}
			.consoleLogger-text {
				flex: 1;
				min-width: 0;
				line-height: 1.5;
				white-space: pre-wrap;
				word-break: break-all;
			}
			.consoleLogger-message-row.collapsed .consoleLogger-text {
				max-height: 1.6em;
				overflow: hidden;
				white-space: nowrap;
				text-overflow: ellipsis;
				word-break: normal;
			}

			/* =========================== */
			/* ====== Entry actions ====== */
			/* =========================== */

			.consoleLogger-entry-actions {
				display: none;
				position: absolute;
				top: 2px;
				right: 8px;
				gap: 3px;
				flex-shrink: 0;
				user-select: none;
				transition: opacity 0.1s;
				/*backdrop-filter: blur(2px); */ /* Heavy GPU load */
			}
			.consoleLogger-entry:hover .consoleLogger-entry-actions { display: flex; }
			.consoleLogger-entry.pinned .consoleLogger-entry-actions,
			.consoleLogger-entry.protected .consoleLogger-entry-actions,
			.consoleLogger-entry.pinned.protected .consoleLogger-entry-actions { display: flex; position: initial; }

			.consoleLogger-entry-actions button {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				width: 18px;
				height: 18px;
				padding: 0;
				color: ${TOKENS.textSecondary};
				font-size: 10px;
				font-family: system-ui, -apple-system, sans-serif;
				background: ${TOKENS.bgSurfaceHover};
				border: 1px solid ${TOKENS.borderMedium};
				border-radius: 3px;
				cursor: pointer;
			}
			.consoleLogger-entry-actions button:hover { background: ${TOKENS.bgSurfaceStrong}; color: ${TOKENS.textWhite}; }

			.consoleLogger-btn-pin,
			.consoleLogger-btn-protect {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				width: 18px;
				height: 18px;
				padding: 0;
				color: ${TOKENS.textMuted};
				font-size: 10px;
				font-family: system-ui, -apple-system, sans-serif;
				background: ${TOKENS.bgSurfaceLight};
				border: 1px solid ${TOKENS.borderMedium};
				border-radius: 3px;
				cursor: pointer;
			}
			.consoleLogger-btn-pin:hover,
			.consoleLogger-btn-protect:hover  { background: ${TOKENS.bgSurfaceHover}; color: ${TOKENS.textWhite}; }
			.consoleLogger-btn-pin.active     { color: ${TOKENS.accentWarning}; background: ${TOKENS.accentWarningMid}; border-color: ${TOKENS.accentWarningStrong}; }
			.consoleLogger-btn-protect.active { color: ${TOKENS.accentPrimary}; background: ${TOKENS.accentPrimaryMid}; border-color: ${TOKENS.accentPrimaryStrong}; }

			.consoleLogger-purge-notice {
				padding: 4px 10px;
				color: ${TOKENS.accentWarning};
				font-size: 11px;
				font-style: italic;
				background: ${TOKENS.accentWarningMuted};
				border-bottom: 1px solid ${TOKENS.accentWarningMid};
			}

			/* ========================= */
			/* ====== Stack trace ====== */
			/* ========================= */

			.consoleLogger-stack {
				display: block;
				margin-top: 3px;
				color: ${TOKENS.stackColor};
				font-size: 10px;
				line-height: 1.6;
				border-left: 2px solid ${TOKENS.stackBorder};
			}
			.consoleLogger-stack.hidden { display: none; }

			.consoleLogger-stack-row {
				display: flex;
				align-items: baseline;
				gap: 6px;
				padding: 1px 0;
				padding-left: 6px;
				font-size: 10px;
			}
			.consoleLogger-stack-fn {
				flex-shrink: 0;
				min-width: 160px;
				max-width: 260px;
				overflow: hidden;
				color: ${TOKENS.textStack};
				white-space: nowrap;
				text-overflow: ellipsis;
			}
			.consoleLogger-stack-loc {
				overflow: hidden;
				color: ${TOKENS.textDimmer};
				font-size: 10px;
				white-space: nowrap;
				text-overflow: ellipsis;
				cursor: pointer;
			}
			.consoleLogger-stack-loc:hover { color: ${TOKENS.textSubtleHover}; }

			.consoleLogger-stack-copy-btn {
				flex-shrink: 0;
				padding: 0 3px;
				color: ${TOKENS.textMuted};
				font-size: 9px;
				font-family: system-ui, -apple-system, sans-serif;
				background: none;
				border: 1px solid ${TOKENS.borderStrong};
				border-radius: 3px;
				cursor: pointer;
				user-select: none;
			}
			.consoleLogger-stack-copy-btn:hover {
				background: ${TOKENS.bgSurfaceHover};
				color: ${TOKENS.textWhite};
				border-color: ${TOKENS.borderBold};
			}
			.consoleLogger-stack-editor-btn {
    			display: inline-flex;
    			padding: 0;
			}
			.consoleLogger-stack-editor-btn > span {
				min-width: 10px;
    			text-align: center;
				padding-inline: 4px;
    			color: ${TOKENS.textMuted};
    			opacity: 0.6;
			}
			.consoleLogger-stack-editor-btn > span:hover {
				background: ${TOKENS.bgSurfaceHover};
				color: ${TOKENS.textWhite};
				border-color: ${TOKENS.borderBold};
 				opacity: 1;
			}

			/* ========================= */
			/* ====== Table entry ====== */
			/* ========================= */

			.consoleLogger-table-wrap {
				display: block;
				max-width: 100%;
				margin-block: 2px;
				overflow-x: auto;
			}
			.consoleLogger-table-wrap::-webkit-scrollbar { height: 12px; background: transparent; }
			.consoleLogger-table-wrap::-webkit-scrollbar-track { background: transparent; }
			.consoleLogger-table-wrap::-webkit-scrollbar-thumb {
				background: ${TOKENS.textPrimary};
				border: 1px solid ${TOKENS.bgWindow};
				border-radius: 8px;
				box-shadow: none;
			}

			.consoleLogger-table {
				display: block;
				width: max-content;
				font-size: 11px;
				border-collapse: collapse;
			}
			.consoleLogger-table th {
				padding: 2px 10px;
				color: ${TOKENS.textTableHeader};
				font-weight: bold;
				text-align: left;
				white-space: nowrap;
				background: ${TOKENS.bgSurfaceLight};
				border: 1px solid ${TOKENS.borderMedium};
			}
			.consoleLogger-table td {
				max-width: 260px;
				padding: 2px 10px;
				overflow: hidden;
				color: ${TOKENS.textTableCell};
				white-space: pre;
				text-overflow: ellipsis;
				border: 1px solid ${TOKENS.borderSubtle};
			}
			.consoleLogger-table td.idx                { color: ${TOKENS.textMuted}; font-size: 10px; }
			.consoleLogger-table td.t-string           { color: ${TOKENS.textTypeString}; }
			.consoleLogger-table td.t-number           { color: ${TOKENS.accentPrimary}; }
			.consoleLogger-table td.t-boolean          { color: ${TOKENS.textTypeBoolean}; }
			.consoleLogger-table td.t-null             { color: ${TOKENS.textMuted}; font-style: italic; }
			.consoleLogger-table td.t-fn               { color: ${TOKENS.textTypeFunction}; font-style: italic; }
			.consoleLogger-table td.t-object           { color: ${TOKENS.textTypeObject}; }
			.consoleLogger-table tr:nth-child(even) td { background: ${TOKENS.bgSurface}; }
			.consoleLogger-table tr:hover td           { background: ${TOKENS.bgSurface}; }

			/* ======================= */
			/* ====== Dir entry ====== */
			/* ======================= */

			.consoleLogger-dir {
				margin-top: 3px;
				padding-left: 8px;
				font-size: 11px;
				line-height: 1.6;
				border-left: 2px solid ${TOKENS.borderMedium};
			}
			.consoleLogger-dir-header        { font-weight: 600; }
			.consoleLogger-dir-count         { color: ${TOKENS.textMuted}; font-weight: initial; font-style: italic; }
			.consoleLogger-dir-row           { display: flex; gap: 8px; }
			.consoleLogger-dir-key           { display: contents; flex-shrink: 0; min-width: 80px; color: ${TOKENS.textDirKey}; }
			.consoleLogger-dir-val           { color: ${TOKENS.textDirVal}; word-break: break-all; }
			.consoleLogger-dir-val.t-string  { color: ${TOKENS.textTypeString}; }
			.consoleLogger-dir-val.t-number  { color: ${TOKENS.accentPrimary}; }
			.consoleLogger-dir-val.t-boolean { color: ${TOKENS.textTypeBoolean}; }
			.consoleLogger-dir-val.t-null    { color: ${TOKENS.textMuted}; font-style: italic; }
			.consoleLogger-dir-val.t-fn      { color: ${TOKENS.textTypeFunction}; font-style: italic; }
			.consoleLogger-dir-more          { color: ${TOKENS.textDimmer}; font-size: 10px; margin-top: 2px; }

			/* ========================= */
			/* ====== Group entry ====== */
			/* ========================= */

			.consoleLogger-group-header {
				display: flex;
				align-items: flex-start;
				gap: 5px;
				font-weight: bold;
				cursor: pointer;
				user-select: none;
			}
			.consoleLogger-group-header:hover { opacity: 0.85; }
			.consoleLogger-group-toggle {
				flex-shrink: 0;
				width: 14px;
				font-size: 10px;
				color: ${TOKENS.textDimmer};
			}
			.consoleLogger-group-end { font-size: 11px; font-style: italic; opacity: 0.4; }

			.consoleLogger-tree-prefix {
				display: inline-block;
				flex-shrink: 0;
				white-space: pre;
				font-family: monospace;
				font-size: 11px;
				line-height: 1.5;
				color: ${TOKENS.accentSecondaryMid};
				letter-spacing: 0;
			}
			.consoleLogger-text-group {
				display: flex;
				flex: 1;
				min-width: 0;
			}

			/* ======================== */
			/* ====== Time entry ====== */
			/* ======================== */

			.consoleLogger-time-entry-line {
				display: flex;
			}
			.consoleLogger-stat-badge {
				display: inline-block;
				margin-left: 4px;
				padding: 0 5px;
				font-weight: 600;
				color: ${TOKENS.accentPrimary};
				font-size: 10px;
				font-variant-numeric: tabular-nums;
				background: ${TOKENS.accentPrimaryMuted};
				border: 1px solid ${TOKENS.accentPrimaryMid};
				border-radius: 3px;
				user-select: none;
			}
			.consoleLogger-stat-badge.is-start {
				color: ${TOKENS.accentSuccess};
				background: ${TOKENS.accentSuccessMuted};
				border-color: ${TOKENS.accentSuccessMid};
			}
			.consoleLogger-stat-badge.is-warning {
				color: ${TOKENS.accentWarning};
				background: ${TOKENS.accentWarningMuted};
				border-color: ${TOKENS.accentWarningMid};
			}
			.consoleLogger-stat-badge.is-error {
				color: ${TOKENS.accentDanger};
				background: ${TOKENS.accentDangerMuted};
				border-color: ${TOKENS.accentDangerMid};
			}

			/* ========================= */
			/* ====== Count entry ====== */
			/* ========================= */

			.consoleLogger-count-line {
				display: flex;
			}
			.consoleLogger-count-n,
			.consoleLogger-max-seen-n {
				min-width: 16px;
				font-weight: bold;
				text-align: right;
				color: ${TOKENS.accentWarning};
			}
			.consoleLogger-max-seen-n {
				text-align: left;
			}
			.consoleLogger-count-bar {
				display: inline-block;
				flex: 1;
				align-self: center;
				max-width: 80px;
				height: 4px;
				margin-inline: 8px;
				overflow: hidden;
				background: ${TOKENS.bgSurfaceStrong};
				border-radius: 2px;
			}
			.consoleLogger-count-fill {
				display: block;
				height: 100%;
				background: ${TOKENS.accentWarning};
				border-radius: 2px;
			}
			.consoleLogger-count-percentage {
				color: ${TOKENS.textMuted};
				font-weight: initial;
				font-style: italic;
			}
		`;
		const el = document.createElement('style');
		el.id = 'consoleLogger-style';
		el.textContent = s;
		document.head.appendChild(el);
	};

	//***********************************
	//    UI CONSTRUCTION
	//***********************************

	// Builds the "Sources" dropdown checkbox markup from SOURCE_REGISTRY — one row per
	// registered source, in registry order. Called from the titlebar template in buildUI().
	function buildSourceCheckboxesHTML() {
		return Object.entries(SOURCE_REGISTRY).map(([key, meta]) => `
			<label class="checkbox-label">
				<input type="checkbox" id="${meta.checkboxId}" ${ConsoleLogger.config.intercept[key] ? 'checked' : ''}/>
				<span>${meta.label}</span>
				${meta.hint ? `<span class="hint">${meta.hint}</span>` : ''}
			</label>`).join('');
	}

	// Builds the HTML for each option in the Themes dropdown.
	function buildThemeButtonsHTML() {
		return Object.keys(THEMES).map(themeName => `
			<button type="button" class="${themeName === ConsoleLogger.config.theme ? 'selected' : ''}" data-theme="${themeName}">${themeName}</button>`).join('');
	}

	// Builds and mounts the full UI (open button, window, all panels).
	ConsoleLogger.buildUI = function () {
		if (document.getElementById('consoleLogger-window')) return;

		// ───── Open button ────────────────────────
		const openBtn = document.createElement('div');
		openBtn.id = 'consoleLogger-open-btn';
		openBtn.innerHTML = `<span>⌨ LOG</span><span id="consoleLogger-open-btn-badge"></span>`;
		openBtn.title = 'Open Console Logger (Ctrl+L)';
		openBtn.onclick = () => ConsoleLogger.toggleWindow();
		document.body.appendChild(openBtn);

		// ───── Main window ────────────────────────
		const win = document.createElement('div');
		win.id = 'consoleLogger-window';
		win.className = 'hidden';
		win.style.left = ConsoleLogger.config.windowX + 'px';
		win.style.top = ConsoleLogger.config.windowY + 'px';
		win.style.width = ConsoleLogger.config.windowW + 'px';
		win.style.height = ConsoleLogger.config.windowH + 'px';

		// ───── Titlebar ────────────────────────
		const titlebar = document.createElement('div');
		titlebar.id = 'consoleLogger-title-bar';
		titlebar.innerHTML = `
			<span id="consoleLogger-title">⌨ ${ConsoleLogger.name} v${ConsoleLogger.version}</span>
			<div id="consoleLogger-opacity-wrap">
				<button id="consoleLogger-opacity-btn" title="Window opacity">🫧</button>
				<div id="consoleLogger-opacity-panel">
					<input type="range" id="consoleLogger-opacity-slider" min="80" max="100" step="1">
					<span id="consoleLogger-opacity-value"></span>
				</div>
			</div>
			<div id="consoleLogger-theme-dropdown" class="consoleLogger-dropdown">
    			<button id="consoleLogger-theme-dropdown-btn" class="consoleLogger-dropdown-toggle" title="Change theme">🎨 Themes</button>
    			<div id="consoleLogger-theme-dropdown-content" class="consoleLogger-dropdown-menu hidden">
    				${buildThemeButtonsHTML()}
    			</div>
			</div>
			<div id="consoleLogger-sources-dropdown" class="consoleLogger-dropdown">
    			<button id="consoleLogger-sources-dropdown-btn" class="consoleLogger-dropdown-toggle" title="Toggle what gets logged">🔗 Sources</button>
    			<div id="consoleLogger-sources-dropdown-content" class="consoleLogger-dropdown-menu hidden">
    				${buildSourceCheckboxesHTML()}
    			</div>
			</div>
			<button id="consoleLogger-btn-close" class="consoleLogger-btn-danger" title="Close">✕</button>
		`;
		win.appendChild(titlebar);

		// ───── Filters ────────────────────────
		const filtersBar = document.createElement('div');
		filtersBar.id = 'consoleLogger-filters';
		Object.entries(LOG_LEVELS).forEach(([key, meta]) => {
			const btn = document.createElement('button');
			btn.className = 'consoleLogger-filter-btn' + (ConsoleLogger.config.filters[key] ? ' active' : '');
			btn.dataset.level = key;
			btn.style.color = meta.color;
			btn.style.setProperty('--filter-hover-bg', alpha(meta.color, 0.12));
			btn.title = `Toggle ${meta.label} messages`;
			btn.onclick = () => ConsoleLogger.toggleFilter(key);

			const labelSpan = document.createElement('span');
			labelSpan.textContent = meta.label;

			const countSpan = document.createElement('span');
			countSpan.className = 'consoleLogger-filter-count';
			countSpan.dataset.counter = key;
			countSpan.textContent = '';

			btn.appendChild(labelSpan);
			btn.appendChild(countSpan);
			filtersBar.appendChild(btn);
		});
		const searchInput = document.createElement('input');
		searchInput.id = 'consoleLogger-search';
		searchInput.type = 'text';
		searchInput.placeholder = 'Search…';
		searchInput.oninput = () => {
			clearTimeout(searchDebounceTimer);
			searchDebounceTimer = setTimeout(() => ConsoleLogger.applyFilters(searchInput.value), SEARCH_DEBOUNCE_MS);
		};
		filtersBar.appendChild(searchInput);
		win.appendChild(filtersBar);

		// ───── Actions row (expand/collapse + copy) ────────────────────────
		const toolbar = document.createElement('div');
		toolbar.id = 'consoleLogger-toolbar';
		toolbar.innerHTML = `
			<div>
				<button id="consoleLogger-btn-copy-visible" class="consoleLogger-btn-primary" title="Copy only currently visible (filtered) entries to clipboard">⧉ Copy visible</button>
				<button id="consoleLogger-btn-copy-all" class="consoleLogger-btn-success" title="Copy all logs to clipboard">⧉ Copy all</button>
			</div>
			<span style="flex:1"></span>
			<div>
				<button id="consoleLogger-btn-save-visible" class="consoleLogger-btn-primary" title="Save only currently visible (filtered) entries to .txt">💾 Save visible</button>
				<button id="consoleLogger-btn-save" class="consoleLogger-btn-success" title="Save all logs to .txt">💾 Save all</button>
			</div>
			<hr class="divider-v">
			<div id="consoleLogger-clear-dropdown" class="consoleLogger-dropdown">
    			<button id="consoleLogger-clear-dropdown-btn" class="consoleLogger-dropdown-toggle consoleLogger-btn-danger" style="min-width:100px;" title="Clear options">🗑️ Clear logs</button>
    			<div id="consoleLogger-clear-dropdown-content" class="consoleLogger-dropdown-menu hidden">
        			<button id="consoleLogger-btn-clear-hidden" title="Clear entries hidden by current filters/search">🙈 Clear hidden</button>
        			<button id="consoleLogger-btn-clear" title="Clear all log entries">🗑️ Clear all</button>
    			</div>
			</div>
		`;
		win.appendChild(toolbar);

		// ───── Log body ────────────────────────
		const bodyWrap = document.createElement('div');
		bodyWrap.id = 'consoleLogger-body-wrap';

		const body = document.createElement('div');
		body.id = 'consoleLogger-body';
		bodyWrap.appendChild(body);

		const timeline = document.createElement('div');
		timeline.id = 'consoleLogger-timeline';
		bodyWrap.appendChild(timeline);

		win.appendChild(bodyWrap);

		// ───── Unread banner (sits between body and statusbar) ────────────────────────
		const unreadBanner = document.createElement('div');
		unreadBanner.id = 'consoleLogger-unread-banner';
		unreadBanner.title = 'Click to scroll to latest';
		unreadBanner.onclick = () => {
			ConsoleLogger.scrollToBottom();
			ConsoleLogger.clearUnread();
		};
		win.appendChild(unreadBanner);

		// ───── Statusbar ────────────────────────
		const statusbar = document.createElement('div');
		statusbar.id = 'consoleLogger-status-bar';
		statusbar.innerHTML = `
			<span id="consoleLogger-count">0 entries</span>
			<span style="flex:1"></span>
			<span class="consoleLogger-btn-group">
				<span class="consoleLogger-btn-group-label">Scroll:</span>
				<button id="consoleLogger-btn-scroll-top"   title="Scroll to top">👆</button>
				<button id="consoleLogger-btn-scroll-bot"   title="Scroll to bottom">👇</button>
			</span>
			<hr class="divider-v">
			<span class="consoleLogger-btn-group">
				<span class="consoleLogger-btn-group-label">Collapse:</span>
				<button id="consoleLogger-btn-expand-all"   title="Expand all entries">▼</button>
				<button id="consoleLogger-btn-collapse-all" title="Collapse all entries">▶</button>
			</span>
			<hr class="divider-v">
			<div id="consoleLogger-settings-dropdown" class="consoleLogger-dropdown">
    			<button id="consoleLogger-settings-dropdown-btn" class="consoleLogger-dropdown-toggle consoleLogger-dropdown-toggle-up" title="Display settings">⚙️ Settings</button>
    			<div id="consoleLogger-settings-dropdown-content" class="consoleLogger-dropdown-menu consoleLogger-dropdown-menu-up hidden">
					<label class="checkbox-label" title="Show timestamps next to each log entry">
						<input type="checkbox" id="consoleLogger-chk-timestamp" ${ConsoleLogger.config.timestampEnabled ? 'checked' : ''}/>
						<span>Timestamps</span>
					</label>
					<label class="checkbox-label" title="Capture and store the call stack for each entry (affects new entries only)">
						<input type="checkbox" id="consoleLogger-chk-stack-trace" ${ConsoleLogger.config.stackTraceEnabled ? 'checked' : ''}/>
						<span>Capture stack trace</span>
					</label>
					<label class="checkbox-label" title="Allow selecting and copying text from the log window">
						<input type="checkbox" id="consoleLogger-chk-text-selection" ${ConsoleLogger.config.textSelectionEnabled ? 'checked' : ''}/>
						<span>Text selection</span>
					</label>
					<label class="checkbox-label" title="Show a game notification when an error is logged while the window is closed">
						<input type="checkbox" id="consoleLogger-chk-notify-on-error" ${ConsoleLogger.config.notifyOnError ? 'checked' : ''}/>
						<span>Error popup</span>
					</label>
					<hr class="consoleLogger-settings-divider"/>
					<div class="consoleLogger-settings-section-label">On save:</div>
					<label class="checkbox-label" title="Append the call stack below each entry that has one">
						<input type="checkbox" id="consoleLogger-chk-save-stack-traces" ${ConsoleLogger.config.saveIncludeStackTraces ? 'checked' : ''}/>
						<span>Include stack traces</span>
					</label>
					<label class="checkbox-label" title="Write each duplicate occurrence as a separate line instead of [xN]">
						<input type="checkbox" id="consoleLogger-chk-save-expand-dups" ${ConsoleLogger.config.saveExpandDuplicates ? 'checked' : ''}/>
						<span>Expand duplicates</span>
					</label>
    			</div>
			</div>
		`;
		win.appendChild(statusbar);

		// ───── Resize handle ────────────────────────
		const resizeHandle = document.createElement('div');
		resizeHandle.id = 'consoleLogger-resize-handle';
		win.appendChild(resizeHandle);

		document.body.appendChild(win);

		// ───── Event handlers ────────────────────────
		document.getElementById('consoleLogger-btn-close').onclick = () => ConsoleLogger.toggleWindow(false);
		document.getElementById('consoleLogger-btn-save').onclick = () => ConsoleLogger.saveLogsToFile(false);
		document.getElementById('consoleLogger-btn-save-visible').onclick = () => ConsoleLogger.saveLogsToFile(true);

		// ───── Shared dropdown helpers ────────────────────────
		// Registry of all custom dropdowns: { toggle, menu, container }
		const dropdowns = [];

		// Closes all registered dropdowns, optionally excluding one.
		function closeAllDropdowns(except) {
			dropdowns.forEach(({ toggle, menu, container }) => {
				if (container === except) return;
				menu.classList.add('hidden');
				container.classList.remove('active');
				toggle.classList.remove('active');
			});
		}

		// Wires up open/close toggle and outside-click dismiss for a dropdown.
		function registerDropdown(container, toggle, menu) {
			dropdowns.push({ toggle, menu, container });

			toggle.onclick = (e) => {
				e.stopPropagation();
				const isHidden = menu.classList.contains('hidden');
				closeAllDropdowns(container);
				menu.classList.toggle('hidden', !isHidden);
				container.classList.toggle('active', isHidden);
				toggle.classList.toggle('active', isHidden);
			};
		}

		// Close all dropdowns when clicking outside any of them
		document.addEventListener('click', (e) => {
			const insideAny = dropdowns.some(({ container }) => container.contains(e.target));
			if (!insideAny) closeAllDropdowns(null);
		});

		// ───── Opacity dropdown ────────────────────────
		const opacityWrap = document.getElementById('consoleLogger-opacity-wrap');
		const opacityBtn = document.getElementById('consoleLogger-opacity-btn');
		const opacityPanel = document.getElementById('consoleLogger-opacity-panel');
		const opacitySlider = document.getElementById('consoleLogger-opacity-slider');
		const opacityValueLabel = document.getElementById('consoleLogger-opacity-value');

		opacitySlider.value = Math.round((ConsoleLogger.config.windowOpacity ?? DEFAULT_OPACITY) * 100);
		opacityValueLabel.textContent = opacitySlider.value + '%';

		opacityWrap.addEventListener('mousedown', (e) => e.stopPropagation());
		opacityPanel.classList.add('hidden');

		opacitySlider.oninput = () => {
			opacityValueLabel.textContent = opacitySlider.value + '%';
			ConsoleLogger.setOpacity(opacitySlider.value / 100);
		};

		registerDropdown(opacityWrap, opacityBtn, opacityPanel);

		// ───── Theme dropdown ────────────────────────
		const themeContainer = document.getElementById('consoleLogger-theme-dropdown');
		const themeToggle = document.getElementById('consoleLogger-theme-dropdown-btn');
		const themeMenuContent = document.getElementById('consoleLogger-theme-dropdown-content');

		// Delegated listener — theme buttons don't have individual IDs.
		themeMenuContent.addEventListener('click', (e) => {
			const btn = e.target.closest('button[data-theme]');
			if (!btn) return;
			e.stopPropagation();
			ConsoleLogger.applyTheme(btn.dataset.theme);
			closeAllDropdowns(null);
		});

		registerDropdown(themeContainer, themeToggle, themeMenuContent);

		// ───── Sources dropdown ────────────────────────
		const sourcesContainer = document.getElementById('consoleLogger-sources-dropdown');
		const sourcesToggle = document.getElementById('consoleLogger-sources-dropdown-btn');
		const sourcesContent = document.getElementById('consoleLogger-sources-dropdown-content');

		registerDropdown(sourcesContainer, sourcesToggle, sourcesContent);
		ConsoleLogger.updateSourcesIndicator();

		Object.entries(SOURCE_REGISTRY).forEach(([key, { checkboxId }]) => {
			const chk = document.getElementById(checkboxId);
			if (!chk) return;
			chk.onchange = e => {
				ConsoleLogger.setSourceEnabled(key, e.target.checked);
				ConsoleLogger.updateSourcesIndicator();
			};
		});

		// ───── Clear dropdown ────────────────────────
		const clearContainer = document.getElementById('consoleLogger-clear-dropdown');
		const clearToggle = document.getElementById('consoleLogger-clear-dropdown-btn');
		const clearContent = document.getElementById('consoleLogger-clear-dropdown-content');

		registerDropdown(clearContainer, clearToggle, clearContent);

		// ───── Settings dropdown (statusbar, opens upward) ────────────────────────
		const settingsContainer = document.getElementById('consoleLogger-settings-dropdown');
		const settingsToggle = document.getElementById('consoleLogger-settings-dropdown-btn');
		const settingsContent = document.getElementById('consoleLogger-settings-dropdown-content');

		registerDropdown(settingsContainer, settingsToggle, settingsContent);

		// ───── Toolbar buttons ────────────────────────
		document.getElementById('consoleLogger-btn-copy-all').onclick = () => ConsoleLogger.copyAllLogs(false);
		document.getElementById('consoleLogger-btn-copy-visible').onclick = () => ConsoleLogger.copyAllLogs(true);
		document.getElementById('consoleLogger-btn-clear').onclick = () => ConsoleLogger.clearLogs();
		document.getElementById('consoleLogger-btn-clear-hidden').onclick = () => ConsoleLogger.clearLogs(true);

		// ───── Status bar buttons ────────────────────────
		document.getElementById('consoleLogger-btn-expand-all').onclick = () => ConsoleLogger.setAllCollapsed(false);
		document.getElementById('consoleLogger-btn-collapse-all').onclick = () => ConsoleLogger.setAllCollapsed(true);
		document.getElementById('consoleLogger-btn-scroll-top').onclick = () => ConsoleLogger.scrollToTop();
		document.getElementById('consoleLogger-btn-scroll-bot').onclick = () => {
			ConsoleLogger.scrollToBottom();
			ConsoleLogger.clearUnread();
		};

		document.getElementById('consoleLogger-chk-timestamp').onchange = e => {
			ConsoleLogger.config.timestampEnabled = e.target.checked;
			ConsoleLogger.rebuildLog();
		};
		document.getElementById('consoleLogger-chk-stack-trace').onchange = e => {
			ConsoleLogger.config.stackTraceEnabled = e.target.checked;
		};
		document.getElementById('consoleLogger-chk-text-selection').onchange = e => {
			const isEnabled = e.target.checked;
			ConsoleLogger.config.textSelectionEnabled = isEnabled;

			const consoleWindow = document.getElementById('consoleLogger-window');
			if (consoleWindow) consoleWindow.style.userSelect = isEnabled ? 'text' : 'none';
		};
		document.getElementById('consoleLogger-chk-notify-on-error').onchange = e => {
			ConsoleLogger.config.notifyOnError = e.target.checked;
		};
		document.getElementById('consoleLogger-chk-save-stack-traces').onchange = e => {
			ConsoleLogger.config.saveIncludeStackTraces = e.target.checked;
		};
		document.getElementById('consoleLogger-chk-save-expand-dups').onchange = e => {
			ConsoleLogger.config.saveExpandDuplicates = e.target.checked;
		};

		// Timeline update throttled to one rAF — scroll fires many times per frame.
		let timelineRafPending = false;
		body.addEventListener('scroll', function () {
			if (isScrolledToBottom()) ConsoleLogger.clearUnread();
			if (!timelineRafPending) {
				timelineRafPending = true;
				requestAnimationFrame(function () {
					ConsoleLogger.updateTimeline();
					timelineRafPending = false;
				});
			}
		});

		ConsoleLogger.makeDraggable(win, titlebar);
		ConsoleLogger.makeResizable(win, resizeHandle);
	};

	//***********************************
	//    ENTRY RENDER HELPERS
	//***********************************

	// Trims %c segments to the length of mainText, splitting the last segment if needed.
	function getMainSegments(segments, mainText) {
		if (!segments) return null;
		const len = mainText.length;
		let acc = 0;
		const result = [];
		for (const seg of segments) {
			if (acc >= len) break;
			const remaining = len - acc;
			if (seg.text.length <= remaining) {
				result.push(seg);
				acc += seg.text.length;
			} else {
				result.push({ text: seg.text.slice(0, remaining), style: seg.style });
				break;
			}
		}
		return result;
	}


	// Builds an HTML <table> element from console.table data.
	function buildTableEl(data, columns) {
		const wrap = document.createElement('div');
		wrap.className = 'consoleLogger-table-wrap';
		if (data === null || data === undefined || typeof data !== 'object') {
			wrap.textContent = String(data);
			return wrap;
		}

		const rows = Array.isArray(data)
			? data
			: Object.entries(data).map(([k, v]) =>
				({ '(index)': k, ...(typeof v === 'object' && v !== null ? v : { Value: v }) }));

		if (rows.length === 0) {
			wrap.textContent = '(empty)';
			return wrap;
		}

		// Determine columns
		const allKeys = columns
			? ['(index)', ...columns]
			: Array.from(new Set(['(index)', ...rows.flatMap(r => Object.keys(r))]));

		const table = document.createElement('table');
		table.className = 'consoleLogger-table';

		// ───── Header ────────────────────────
		const thead = document.createElement('thead');
		const headerRow = document.createElement('tr');
		allKeys.forEach(k => {
			const th = document.createElement('th');
			th.textContent = k;
			headerRow.appendChild(th);
		});
		thead.appendChild(headerRow);
		table.appendChild(thead);

		// ───── Body ────────────────────────
		const tbody = document.createElement('tbody');
		rows.forEach((row, i) => {
			const tr = document.createElement('tr');
			allKeys.forEach(k => {
				const td = document.createElement('td');
				if (k === '(index)') {
					td.className = 'idx';
					td.textContent = Array.isArray(data) ? i : row['(index)'];
				} else {
					const val = row[k];
					if (val === undefined) {
						td.textContent = '';
					} else if (val === null) {
						td.textContent = 'null';
						td.classList.add('t-null');
					} else if (typeof val === 'string') {
						td.textContent = val;
						td.classList.add('t-string');
					} else if (typeof val === 'number') {
						td.textContent = String(val);
						td.classList.add('t-number');
					} else if (typeof val === 'boolean') {
						td.textContent = String(val);
						td.classList.add('t-boolean');
					} else if (typeof val === 'function') {
						td.textContent = 'ƒ ' + (val.name || 'anonymous') + '()';
						td.classList.add('t-fn');
					} else {
						td.textContent = JSON.stringify(val);
						td.classList.add('t-object');
					}
				}
				tr.appendChild(td);
			});
			tbody.appendChild(tr);
		});
		table.appendChild(tbody);
		wrap.appendChild(table);
		return wrap;
	}

	// Fallback label for unrecognised object types.
	function ctorName(obj) {
		return (obj && obj.constructor && obj.constructor.name) || 'Object';
	}

	// One-line label for a value in console.dir() output.
	function describeDirValue(obj) {
		if (obj === null) return 'null';
		if (obj === undefined) return 'undefined';
		if (typeof Element !== 'undefined' && obj instanceof Element) {
			return obj.tagName.toLowerCase()
				+ (obj.id ? '#' + obj.id : '')
				+ (obj.className ? '.' + obj.className : '');
		}
		if (typeof Document !== 'undefined' && obj instanceof Document) return '#document';
		if (typeof Text !== 'undefined' && obj instanceof Text) return '#text';
		if (Array.isArray(obj)) return `Array(${obj.length})`;
		if (typeof obj === 'object') return ctorName(obj);
		return String(obj);
	}

	// Same idea for console.dirxml(obj), but favors a "<tag>" label for DOM nodes.
	function describeDirxmlValue(obj) {
		if (obj === null) return 'null';
		if (obj === undefined) return 'undefined';
		if (obj.nodeName) return "<" + obj.nodeName.toLowerCase()
			+ (obj.id ? ` id="${obj.id}"` : '')
			+ (obj.className ? ` className="${obj.className}"` : '')
			+ ">";
		return typeof obj === 'object' ? ctorName(obj) : String(obj);
	}

	// Sets a dir-row value cell with type-appropriate colour and text.
	function applyDirValue(valEl, v) {
		if (v === null) { valEl.textContent = 'null'; valEl.classList.add('t-null'); }
		else if (v === undefined) { valEl.textContent = 'undefined'; valEl.classList.add('t-null'); }
		else if (typeof v === 'string') { valEl.textContent = '"' + v + '"'; valEl.classList.add('t-string'); }
		else if (typeof v === 'number') { valEl.textContent = String(v); valEl.classList.add('t-number'); }
		else if (typeof v === 'boolean') { valEl.textContent = String(v); valEl.classList.add('t-boolean'); }
		else if (typeof v === 'function') { valEl.textContent = 'ƒ ' + (v.name || 'anonymous') + '()'; valEl.classList.add('t-fn'); }
		else if (Array.isArray(v)) { valEl.textContent = `Array(${v.length})`; }
		// DOM nodes have no own enumerable keys — the generic branch below would print "{}"
		else if (typeof Node !== 'undefined' && v instanceof Node) { valEl.textContent = describeDirValue(v); }
		else {
			const keys = Object.keys(v);
			valEl.textContent = keys.length
				? '{' + keys.slice(0, 4).join(', ') + (keys.length > 4 ? ', …' : '') + '}'
				: ctorName(v) + ' {}';
		}
	}

	// Appends one key/value row to a dir container.
	function appendDirRow(wrap, keyLabel, v) {
		const row = document.createElement('div');
		row.className = 'consoleLogger-dir-row';

		const keyEl = document.createElement('span');
		keyEl.className = 'consoleLogger-dir-key';
		keyEl.textContent = keyLabel;

		const valEl = document.createElement('span');
		valEl.className = 'consoleLogger-dir-val';
		applyDirValue(valEl, v);

		row.appendChild(keyEl);
		row.appendChild(valEl);
		wrap.appendChild(row);
	}

	// Walks the full prototype chain for getter/data properties — needed because DOM classes
	// (Node, EventTarget, …) put almost everything there, not on the instance's own keys.
	function collectPrototypeProps(obj) {
		const seen = new Set();
		const names = [];
		let proto = obj;
		while (proto && proto !== Object.prototype) {
			for (const name of Object.getOwnPropertyNames(proto)) {
				if (name === 'constructor' || seen.has(name)) continue;
				seen.add(name);
				const desc = Object.getOwnPropertyDescriptor(proto, name);
				if (!desc) continue;
				// Skip prototype methods — only show data-like properties (same as native console.dir).
				if (typeof desc.value === 'function' && proto !== obj) continue;
				names.push(name);
			}
			proto = Object.getPrototypeOf(proto);
		}
		return names.sort();
	}

	// Formats Map keys (can be any value, not just strings).
	function formatDirKey(k) {
		if (typeof k === 'string') return `"${k}"`;
		if (k === null) return 'null';
		if (k === undefined) return 'undefined';
		if (typeof k === 'object') return ctorName(k);
		return String(k);
	}

	// Object types whose state doesn't show up via Object.keys() — each renderer fills `wrap` directly.
	const DIR_SPECIAL_CASES = [
		{
			test: obj => obj instanceof Map,
			render: (wrap, obj) => {
				if (obj.size === 0) { wrap.textContent = 'Map(0) {}'; return; }
				let i = 0;
				obj.forEach((v, k) => appendDirRow(wrap, `[${i++}] ${formatDirKey(k)} =>`, v));
			},
		},
		{
			test: obj => obj instanceof Set,
			render: (wrap, obj) => {
				if (obj.size === 0) { wrap.textContent = 'Set(0) {}'; return; }
				let i = 0;
				obj.forEach(v => appendDirRow(wrap, `[${i++}]`, v));
			},
		},
		{
			test: obj => obj instanceof Date,
			render: (wrap, obj) => { wrap.textContent = isNaN(obj.getTime()) ? 'Invalid Date' : obj.toISOString(); },
		},
		{
			test: obj => obj instanceof RegExp,
			render: (wrap, obj) => { wrap.textContent = obj.toString(); },
		},
		{
			test: obj => obj instanceof Error,
			render: (wrap, obj) => {
				appendDirRow(wrap, 'name:', obj.name);
				appendDirRow(wrap, 'message:', obj.message);
				if (obj.stack) appendDirRow(wrap, 'stack:', obj.stack);
			},
		},
	];

	// Renders a plain object/array as a key/value list (own keys + prototype accessors).
	function renderPlainObjectDir(wrap, obj) {
		const MAX_KEYS = 1000;
		const ownKeys = Object.keys(obj);
		const protoNames = collectPrototypeProps(obj).filter(name => !ownKeys.includes(name));
		const allNames = ownKeys.concat(protoNames);

		if (allNames.length === 0) {
			wrap.textContent = Array.isArray(obj) ? `${ctorName(obj)}(0) []` : `${ctorName(obj)} {}`;
			return;
		}

		allNames.slice(0, MAX_KEYS).forEach(name => {
			let val;
			try { val = obj[name]; }
			catch (e) { val = undefined; } // some getters throw outside their expected context
			appendDirRow(wrap, name + ':', val);
		});

		if (allNames.length > MAX_KEYS) {
			const more = document.createElement('div');
			more.className = 'consoleLogger-dir-more';
			more.textContent = `… truncated (over ${MAX_KEYS} keys)`;
			wrap.appendChild(more);
		}
	}

	// Builds a key/value tree element for console.dir output.
	function buildDirEl(obj) {
		const wrap = document.createElement('div');
		wrap.className = 'consoleLogger-dir';

		if (obj === null || obj === undefined) { wrap.textContent = String(obj); return wrap; }
		if (typeof obj !== 'object') { wrap.textContent = String(obj); return wrap; }

		const special = DIR_SPECIAL_CASES.find(c => c.test(obj));
		if (special) special.render(wrap, obj);
		else renderPlainObjectDir(wrap, obj);

		return wrap;
	}

	// Elements that can never have children/closing tags in HTML.
	const DIRXML_VOID_ELEMENTS = new Set([
		'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
		'link', 'meta', 'param', 'source', 'track', 'wbr',
	]);

	// A blank row at the right indent depth, ready for callers to fill in.
	function dirxmlRow(depth) {
		const row = document.createElement('div');
		row.className = 'consoleLogger-dir-row';
		row.style.paddingLeft = (depth * 14) + 'px';
		return row;
	}

	// A row with a single styled span — used by every dirxml row type below.
	function dirxmlSpanRow(depth, text, className) {
		const row = dirxmlRow(depth);
		const span = document.createElement('span');
		span.className = className;
		span.textContent = text;
		row.appendChild(span);
		return row;
	}

	function dirxmlOpenTag(node) {
		const tagName = node.nodeName ? node.nodeName.toLowerCase() : 'node';
		const attrsText = (node.attributes && node.attributes.length)
			? ' ' + Array.from(node.attributes).map(a => `${a.name}="${a.value}"`).join(' ')
			: '';
		return `<${tagName}${attrsText}>`;
	}

	// Renders one DOM node as a single row (returns null for empty text nodes).
	function dirxmlRowFor(node, depth) {
		switch (node.nodeType) {
			case Node.TEXT_NODE: {
				const text = node.textContent.trim();
				return text ? dirxmlSpanRow(depth, `"${text}"`, 'consoleLogger-dir-val t-string') : null;
			}
			case Node.COMMENT_NODE:
				return dirxmlSpanRow(depth, `<!--${node.textContent}-->`, 'consoleLogger-dir-val');
			case Node.ELEMENT_NODE:
			case Node.DOCUMENT_NODE:
				return dirxmlSpanRow(depth, dirxmlOpenTag(node), 'consoleLogger-dir-key');
			default:
				return dirxmlSpanRow(depth, node.nodeName, '');
		}
	}

	// Mirrors dirxmlRowFor's opening-tag row, but for the "</tag>" closer.
	function dirxmlClosingRowFor(node, depth) {
		const tagName = node.nodeName ? node.nodeName.toLowerCase() : 'node';
		return dirxmlSpanRow(depth, `</${tagName}>`, 'consoleLogger-dir-key');
	}

	// Recursively renders a DOM node as an HTML/XML-style tree, capped at MAX_NODES rows.
	function buildDomTreeEl(root) {
		const wrap = document.createElement('div');
		wrap.className = 'consoleLogger-dir';

		const MAX_NODES = 1000;
		let count = 0;

		function walk(node, depth) {
			if (count >= MAX_NODES) return;

			const row = dirxmlRowFor(node, depth);
			if (row) { wrap.appendChild(row); count++; }
			if (count >= MAX_NODES) return;

			// Only real elements get a children block + closing tag
			if (node.nodeType !== Node.ELEMENT_NODE) return;

			const tagName = node.nodeName ? node.nodeName.toLowerCase() : '';
			if (DIRXML_VOID_ELEMENTS.has(tagName)) return; // e.g. <br>, <img> never close

			const children = node.childNodes ? Array.from(node.childNodes) : [];
			children.forEach(child => walk(child, depth + 1));

			if (count < MAX_NODES) { wrap.appendChild(dirxmlClosingRowFor(node, depth)); count++; }
		}

		walk(root, 0);

		if (count >= MAX_NODES) {
			const more = document.createElement('div');
			more.className = 'consoleLogger-dir-more';
			more.textContent = `… truncated (over ${MAX_NODES} nodes)`;
			wrap.appendChild(more);
		}

		return wrap;
	}

	// Builds an HTML/XML-style tree element for console.dirxml output (tag/attribute tree, not key/value).
	function buildDirxmlEl(obj) {
		if (obj === null || obj === undefined) {
			const wrap = document.createElement('div');
			wrap.className = 'consoleLogger-dir';
			wrap.textContent = String(obj);
			return wrap;
		}

		// Not a DOM node — fall back to dir() rendering, same as native console.
		if (typeof Node === 'undefined' || !(obj instanceof Node)) return buildDirEl(obj);

		return buildDomTreeEl(obj);
	}

	//***********************************
	//    WINDOW RENDERING
	//***********************************

	// Opens or closes the log window. Pass a boolean to force a specific state.
	ConsoleLogger.toggleWindow = function (forceState) {
		const win = document.getElementById('consoleLogger-window');
		if (!win) return;
		const open = forceState !== undefined ? forceState : win.classList.contains('hidden');
		ConsoleLogger.config.windowOpen = open;

		if (open) {
			ConsoleLogger.clampWindowPosition(win);
			win.classList.remove('hidden');
			ConsoleLogger._unreadCount = 0;
			ConsoleLogger._newCount = { total: 0, error: 0, warn: 0 };
			ConsoleLogger.updateOpenBtnState();
			ConsoleLogger.rebuildLog();
			ConsoleLogger.scrollToBottom();
		} else {
			win.classList.add('hidden');
		}
	};

	// Clamps the window position so at least 160px stays inside the viewport.
	ConsoleLogger.clampWindowPosition = function (win) {
		const w = parseInt(win.style.width) || ConsoleLogger.config.windowW;
		const h = parseInt(win.style.height) || ConsoleLogger.config.windowH;
		const vw = window.innerWidth;
		const vh = window.innerHeight;

		let x = parseInt(win.style.left) || ConsoleLogger.config.windowX;
		let y = parseInt(win.style.top) || ConsoleLogger.config.windowY;

		const targetWidth = Math.min(w, 160);
		const targetHeight = Math.min(h, 120);
		x = Math.max(targetWidth - w, Math.min(x, vw - targetWidth));
		y = Math.max(0, Math.min(y, vh - targetHeight));

		win.style.left = x + 'px';
		win.style.top = y + 'px';
		ConsoleLogger.config.windowX = x;
		ConsoleLogger.config.windowY = y;
	};

	ConsoleLogger.rebuildLog = function (restoreScroll = false) {
		const body = document.getElementById('consoleLogger-body');
		if (!body) return;

		const scrollTop = body.scrollTop;
		const scrollHeight = body.scrollHeight;

		body.innerHTML = '';
		ConsoleLogger.logs.forEach(entry => ConsoleLogger.renderEntry(entry));
		ConsoleLogger.updateStatusCount();
		ConsoleLogger.updateFilterCounters();

		if (restoreScroll) body.scrollTop = scrollTop * (body.scrollHeight / scrollHeight || 1);
	};

	//***********************************
	//    PER-KIND ENTRY RENDERERS
	//***********************************

	// ───── console.table() ────────────────────────
	ConsoleLogger.renderTableEntry = function (entry, textEl) {
		const t = entry.tableData;
		textEl.appendChild(buildTableEl(t?.data, t?.columns ?? null));
	};

	// ───── console.dir() ────────────────────────
	ConsoleLogger.renderDirEntry = function (entry, textEl, meta, mainText) {
		const header = document.createElement('div');
		header.className = 'consoleLogger-dir-header';

		const dirEl = buildDirEl(entry.dirData);
		const keyCount = dirEl.querySelectorAll('.consoleLogger-dir-row').length;

		header.appendChild(document.createTextNode(mainText));

		if (keyCount) {
			const countEl = document.createElement('span');
			countEl.className = 'consoleLogger-dir-count';
			countEl.textContent = ` (${keyCount} keys)`;
			header.appendChild(countEl);
		}

		textEl.appendChild(header);
		textEl.appendChild(dirEl);
	};

	// ───── console.dirxml() ────────────────────────
	ConsoleLogger.renderDirxmlEntry = function (entry, textEl, meta, mainText) {
		const header = document.createElement('div');
		header.className = 'consoleLogger-dir-header';

		const xmlEl = buildDirxmlEl(entry.dirData);
		const nodeCount = xmlEl.querySelectorAll('.consoleLogger-dir-row').length;
		const isDomTree = typeof Node !== 'undefined' && entry.dirData instanceof Node;

		header.appendChild(document.createTextNode(mainText));

		if (nodeCount) {
			const countEl = document.createElement('span');
			countEl.className = 'consoleLogger-dir-count';
			countEl.textContent = ` (${nodeCount} ${isDomTree ? 'nodes' : 'keys'})`;
			header.appendChild(countEl);
		}

		textEl.appendChild(header);
		textEl.appendChild(xmlEl);
	};

	// ───── console.group() ────────────────────────
	ConsoleLogger.renderGroupEntry = function (entry, textEl, meta, mainText) {
		const hdr = document.createElement('span');
		hdr.className = 'consoleLogger-group-header';
		hdr.style.color = TOKENS.textTableHeader;

		const arrow = document.createElement('span');
		arrow.textContent = entry.groupData.collapsed ? '▶ ' : '▼ ';
		hdr.appendChild(arrow);

		const msgEl = document.createElement('span');
		hdr.appendChild(msgEl);
		const mainSegments = getMainSegments(entry.segments, mainText);
		renderSegments(msgEl, mainText, mainSegments);

		textEl.appendChild(hdr);

		return function onContentClick() {
			entry.groupData.collapsed = !entry.groupData.collapsed;
			arrow.textContent = entry.groupData.collapsed ? '▶ ' : '▼ ';
			ConsoleLogger.applyGroupVisibility(entry);
		};
	};


	// ───── console.groupEnd() ────────────────────────
	ConsoleLogger.renderGroupEndEntry = function (entry, textEl) {
		const endMarker = document.createElement('span');
		endMarker.className = 'consoleLogger-group-end';
		endMarker.textContent = 'end';
		textEl.appendChild(endMarker);
	};

	// Returns true if any ancestor group of this entry has groupCollapsed=true.
	ConsoleLogger._isHiddenByGroup = function (entry) {
		const idx = ConsoleLogger.logs.indexOf(entry);
		if (idx <= 0) return false;

		const ancestorGroups = [];
		for (let i = 0; i < idx; i++) {
			const e = ConsoleLogger.logs[i];
			if (e.kind === ENTRY_KIND.GROUP) {
				ancestorGroups.push(e);
			} else if (e.kind === ENTRY_KIND.GROUP_END) {
				// Pop the most recent still-open group at this same depth.
				for (let j = ancestorGroups.length - 1; j >= 0; j--) {
					if (ancestorGroups[j].groupData.depth === e.groupData.depth) {
						ancestorGroups.splice(j, 1);
						break;
					}
				}
			}
		}
		return ancestorGroups.some(group => group.groupData.collapsed);
	};

	// Toggles group-hidden on all entries belonging to groupEntry (until its matching GROUP_END).
	// Anchors scroll so the group header stays visually stable during collapse/expand.
	ConsoleLogger.applyGroupVisibility = function (groupEntry) {
		const startIdx = ConsoleLogger.logs.indexOf(groupEntry);
		if (startIdx < 0) return;

		const body = document.getElementById('consoleLogger-body');
		const anchorRow = document.querySelector(`.consoleLogger-entry[data-id="${groupEntry.id}"]`);
		const anchorOffsetBefore = anchorRow ? anchorRow.offsetTop - body.scrollTop : null;

		// Scan forward to the matching GROUP_END, tracking depth for nested groups.
		let nestingDepth = 0;
		for (let i = startIdx + 1; i < ConsoleLogger.logs.length; i++) {
			const e = ConsoleLogger.logs[i];
			if (e.kind === ENTRY_KIND.GROUP) nestingDepth++;
			if (e.kind === ENTRY_KIND.GROUP_END && nestingDepth === 0) {
				const endRow = document.querySelector(`.consoleLogger-entry[data-id="${e.id}"]`);
				if (endRow) endRow.classList.toggle('group-hidden', groupEntry.groupData.collapsed);
				break;
			}
			if (e.kind === ENTRY_KIND.GROUP_END) nestingDepth--;

			const row = document.querySelector(`.consoleLogger-entry[data-id="${e.id}"]`);
			if (!row) continue;
			row.classList.toggle('group-hidden', ConsoleLogger._isHiddenByGroup(e));
		}

		// Restore scroll so the anchor row stays at the same visual position.
		if (anchorRow && anchorOffsetBefore !== null) {
			body.scrollTop = anchorRow.offsetTop - anchorOffsetBefore;
		}
	};

	ConsoleLogger._markLastChildOfClosedGroup = function (groupEndEntry) {
		const groupEndIndex = ConsoleLogger.logs.indexOf(groupEndEntry);

		// Count consecutive GROUP_END entries closing at once.
		let closingLevels = 1;
		let i = groupEndIndex - 1;
		while (ConsoleLogger.logs[i] && ConsoleLogger.logs[i].kind === ENTRY_KIND.GROUP_END) {
			closingLevels++;
			i--;
		}
		const lastChild = ConsoleLogger.logs[i];

		// Empty group — nothing to mark.
		if (!lastChild || lastChild.kind === ENTRY_KIND.GROUP) return;

		// Find the tree-prefix element (│ / ├── / └──) on the last child's row
		const row = document.querySelector(`.consoleLogger-entry[data-id="${lastChild.id}"]`);
		const prefix = row && row.querySelector('.consoleLogger-tree-prefix');
		if (!prefix) return;

		// Split into fixed-width segments (one per nesting level) to replace specific ones.
		const text = prefix.textContent;
		const segCount = Math.floor(text.length / SEG);
		const segments = [];
		for (let s = 0; s < segCount; s++) {
			segments.push(text.slice(s * SEG, s * SEG + SEG));
		}

		// Replace the last `closingLevels` segments with the corner glyph.
		const replaceCount = Math.min(closingLevels, segments.length);
		for (let s = segments.length - replaceCount; s < segments.length; s++) {
			segments[s] = LAST;
		}

		prefix.textContent = segments.join('');
	};


	// ───── console.time() ────────────────────────
	ConsoleLogger.renderTimeEntry = function (entry, textEl, meta, mainText) {
		const t = entry.timeData;
		if (!t) { textEl.textContent = mainText; return; }
		const isStart = t.phase === 'start';
		const isError = t.phase !== 'start' && !t.valid;

		const wrap = document.createElement('span');
		wrap.className = 'consoleLogger-time-entry-line';

		const labelEl = document.createElement('span');
		labelEl.style.color = meta.color;
		labelEl.textContent = isError
			? `⚠️ [Timer] ${t.label}: `
			: `⏱️ [Timer] ${t.label}: `;
		wrap.appendChild(labelEl);

		const valueEl = document.createElement('span');
		valueEl.className = 'consoleLogger-stat-badge'
			+ (isStart ? ' is-start' : '')
			+ (isError ? ' is-error' : '');
		valueEl.textContent = isStart
			? 'started'
			: (t.valid ? `${t.elapsedMs.toFixed(3)} ms` : 'not exist');
		wrap.appendChild(valueEl);

		if (t.phase === 'end') {
			const doneEl = document.createElement('span');
			doneEl.className = 'consoleLogger-stat-badge'
				+ (t.valid ? ' is-start' : ' is-warning');
			doneEl.textContent = 'done';
			wrap.appendChild(doneEl);
		}
		if (t.phase === 'log' && t.extra) {
			const extraEl = document.createElement('span');
			extraEl.style.color = meta.color;
			extraEl.textContent = ' — ' + t.extra;
			wrap.appendChild(extraEl);
		}

		textEl.appendChild(wrap);
	};

	// ───── console.count() / countReset() ────────────────────────

	// Updates all rendered bar widths for a label when its peak count grows.
	ConsoleLogger.refreshCountBars = function (label, newPeak) {
		ConsoleLogger.logs.forEach(entry => {
			if (entry.kind !== ENTRY_KIND.COUNT || !entry.countData || entry.countData.label !== label) return;
			entry.countData.maxSeen = newPeak;

			if (!ConsoleLogger.config.windowOpen) return;
			const row = document.querySelector(`.consoleLogger-entry[data-id="${entry.id}"]`);
			if (!row) return;
			const fill = row.querySelector('.consoleLogger-count-fill');
			if (!fill) return;
			const progressWidth = Math.round((entry.countData.value / newPeak) * 100) + '%';
			fill.style.width = progressWidth;

			const maxSeenEl = row.querySelector('.consoleLogger-max-seen-n');
			if (!maxSeenEl) return;
			maxSeenEl.textContent = String(newPeak);

			const percentageEl = row.querySelector('.consoleLogger-count-percentage');
			if (!percentageEl) return;
			percentageEl.textContent = `(${progressWidth})`;
		});
	};

	ConsoleLogger.renderCountEntry = function (entry, textEl, meta, mainText) {
		const c = entry.countData;
		if (!c) { textEl.textContent = mainText; return; }
		const isError = !c.valid;

		const wrap = document.createElement('span');
		wrap.className = 'consoleLogger-count-line';

		const labelEl = document.createElement('span');
		labelEl.style.color = meta.color;

		labelEl.textContent = isError
			? `⚠️ [Counter] ${c.label}: `
			: `❇️ [Counter] ${c.label}: `;
		wrap.appendChild(labelEl);

		const countEl = document.createElement('span');
		countEl.className = 'consoleLogger-count-n';
		countEl.textContent = String(c.value);
		wrap.appendChild(countEl);

		if (c.phase === 'reset') {
			if (isError) {
				const valueEl = document.createElement('span');
				valueEl.className = 'consoleLogger-stat-badge is-error';
				valueEl.textContent = 'not exist';
				wrap.appendChild(valueEl);
			}

			const resetEl = document.createElement('span');
			resetEl.className = 'consoleLogger-stat-badge is-warning';
			resetEl.textContent = 'reset';
			wrap.appendChild(resetEl);

		} else {
			const barBg = document.createElement('span');
			barBg.className = 'consoleLogger-count-bar';
			const barFill = document.createElement('span');
			barFill.className = 'consoleLogger-count-fill';
			const maxSeen = c.maxSeen || c.value || 1;
			const progressWidth = Math.round((c.value / maxSeen) * 100) + '%';
			barFill.style.width = progressWidth;
			barBg.appendChild(barFill);
			wrap.appendChild(barBg);

			const maxSeenEl = document.createElement('span');
			maxSeenEl.className = 'consoleLogger-max-seen-n';
			maxSeenEl.textContent = String(maxSeen);
			wrap.appendChild(maxSeenEl);

			const percentageEl = document.createElement('span');
			percentageEl.className = 'consoleLogger-count-percentage';
			percentageEl.textContent = `(${progressWidth})`;
			wrap.appendChild(percentageEl);
		}

		textEl.appendChild(wrap);
	};

	// Renders a plain log/debug/warn/error/stats/game entry, supporting %c segments.
	ConsoleLogger.renderDefaultEntry = function (entry, textEl, meta, mainText) {
		const mainSegments = getMainSegments(entry.segments, mainText);
		renderSegments(textEl, mainText, mainSegments);
	};

	function buildEditorBtn(copyLocation) {
		const editorBtn = document.createElement('span');
		editorBtn.className = 'consoleLogger-stack-copy-btn consoleLogger-stack-editor-btn';
		editorBtn.onclick = e => e.stopPropagation();

		const editors = [
			{
				label: 'VS',
				title: 'Open in VS Code',
				getUrl: loc => loc.replace(
					/^file:\/\/\/(.*?)(?::(\d+):(\d+))?$/,
					(_, path, line, col) => `vscode://file///${path}${line ? `:${line}:${col}` : ''}`
				),
			},
			{
				label: 'JB',
				title: 'Open in JetBrains',
				getUrl: loc => loc.replace(
					/^file:\/\/\/(.*?)(?::(\d+):(\d+))?$/,
					(_, path, line, col) => `jetbrains://web-storm/navigate/reference?path=${path}${line ? `&line=${line}` : ''}`
				),
			},
		];

		editors.forEach(({ label, title, getUrl }, i) => {
			if (i > 0) {
				const divider = document.createElement('hr');
				divider.className = 'divider-v';
				editorBtn.appendChild(divider);
			}

			const half = document.createElement('span');
			half.textContent = label;
			half.title = title;
			if (i < editors.length - 1) half.className = 'consoleLogger-stack-editor-divider';
			half.onclick = e => {
				e.stopPropagation();
				const url = getUrl(copyLocation);
				const win = window.open(url, '_blank', 'noopener,width=1,height=1,left=-9999,top=-9999');
				setTimeout(() => win?.close(), 100);
			};
			editorBtn.appendChild(half);
		});

		return editorBtn;
	}

	// Parses a raw stack trace string and returns a formatted, collapsible <span>.
	function buildStackEl(stackSource, collapsed) {
		const stackEl = document.createElement('span');
		stackEl.className = 'consoleLogger-stack' + (collapsed ? ' hidden' : '');

		const modPath = 'ConsoleLogger/main.js';
		const rawLines = stackSource.split('\n');
		const toRemove = new Set();

		rawLines.forEach((line, i) => {
			if (line.includes(modPath) && line.includes('<computed>')) {
				toRemove.add(i);
			}
		});

		const lines = (toRemove.size > 0) ? rawLines.filter((_, i) => !toRemove.has(i)) : rawLines;
		lines.forEach(rawLine => {
			const line = rawLine.trim();
			if (!line) return;

			const atMatch = line.match(/^at\s+(?:(.+?)\s+\((.+)\)|(.+))$/);
			const lineEl = document.createElement('span');
			lineEl.className = 'consoleLogger-stack-row';

			if (atMatch) {
				const fnName = atMatch[1] || '(anonymous)';
				const location = atMatch[2] || atMatch[3] || '';
				const shortLoc = location.replace(/^.*[\\/]([^\\/]+:[0-9]+:[0-9]+).*$/, '$1')
					.replace(/\?[^:]*$/, '');
				const copyLocation = location.replace(/\?[^:]*(:[0-9]+:[0-9]+)$/, '$1');

				const fnEl = document.createElement('span');
				fnEl.className = 'consoleLogger-stack-fn';
				fnEl.textContent = fnName;

				const locEl = document.createElement('span');
				locEl.className = 'consoleLogger-stack-loc';
				locEl.textContent = '@' + (shortLoc || location);
				locEl.title = location;
				if (copyLocation) {
					locEl.style.cursor = 'pointer';
					locEl.onclick = e => {
						e.stopPropagation();
						ConsoleLogger.copyText(copyLocation, 'Path copied to clipboard.');
					};
				}

				lineEl.appendChild(fnEl);
				lineEl.appendChild(locEl);

				if (copyLocation) {
					const editorBtn = buildEditorBtn(copyLocation);
					lineEl.appendChild(editorBtn);

					const copyLocBtn = document.createElement('button');
					copyLocBtn.className = 'consoleLogger-stack-copy-btn';
					copyLocBtn.textContent = '⧉';
					copyLocBtn.title = 'Copy frame';
					copyLocBtn.onclick = e => {
						e.stopPropagation();
						ConsoleLogger.copyText(`${fnName} ${copyLocation}`, 'Frame copied to clipboard.');
					};
					lineEl.appendChild(copyLocBtn);
				}
			} else {
				lineEl.textContent = line;
			}

			stackEl.appendChild(lineEl);
		});

		return stackEl;
	}

	// Builds the pin, protect, and copy action buttons for an entry row.
	function buildActionsEl(entry) {
		const actions = document.createElement('span');
		actions.className = 'consoleLogger-entry-actions';

		const pinBtn = document.createElement('button');
		pinBtn.className = 'consoleLogger-btn-pin' + (entry.pinned ? ' active' : '');
		pinBtn.textContent = '📌';
		pinBtn.title = entry.pinned ? 'Unpin' : 'Pin';
		pinBtn.onclick = e => { e.stopPropagation(); ConsoleLogger.togglePinned(entry); };
		actions.appendChild(pinBtn);

		const protectBtn = document.createElement('button');
		protectBtn.className = 'consoleLogger-btn-protect' + (entry.protected ? ' active' : '');
		protectBtn.textContent = entry.protected ? '🔒' : '🔓';
		protectBtn.title = entry.protected ? 'Unprotect' : 'Protect from deletion';
		protectBtn.onclick = e => { e.stopPropagation(); ConsoleLogger.toggleProtected(entry); };
		actions.appendChild(protectBtn);

		const copyBtn = document.createElement('button');
		copyBtn.textContent = '⧉';
		copyBtn.title = 'Copy to clipboard';
		copyBtn.onclick = e => {
			e.stopPropagation();
			const includeStack = entry.stackText && entry.collapsed === false;
			ConsoleLogger.copyEntry(entry, includeStack);
		};
		actions.appendChild(copyBtn);

		return actions;
	}

	// Creates and appends a DOM row for a single log entry.
	ConsoleLogger.renderEntry = function (entry) {
		// GROUP_END has no row — just flips the last child's "├─" to "└─".
		if (entry.kind === ENTRY_KIND.GROUP_END) {
			ConsoleLogger._markLastChildOfClosedGroup(entry);
			return;
		}

		const body = document.getElementById('consoleLogger-body');
		if (!body) return;

		const meta = LOG_LEVELS[entry.level] || LOG_LEVELS.log;
		const hidden = !ConsoleLogger.isEntryVisible(entry);

		// ───── Stack trace ────────────────────────
		const mainText = entry.text;
		const hasStack = !!entry.stackText;
		const isDirLike = entry.kind === ENTRY_KIND.DIR || entry.kind === ENTRY_KIND.DIRXML;
		const isLong = isDirLike || mainText.length > 160 || mainText.includes('\n');

		// ───── Row element ────────────────────────
		const row = document.createElement('div');
		row.className = 'consoleLogger-entry' + (hidden ? ' filtered' : '');
		if (isDirLike) row.classList.add('is-dir');
		if (entry.pinned) row.classList.add('pinned');
		if (entry.protected) row.classList.add('protected');
		if (entry.groupData?.depth > 0) {
			row.classList.add('in-group');
			if (ConsoleLogger._isHiddenByGroup(entry)) row.classList.add('group-hidden');
		}
		row.dataset.id = entry.id;
		row.dataset.level = entry.level;
		row.style.background = meta.bg;

		// ─────  Timestamp ────────────────────────
		const tsEl = document.createElement('span');
		tsEl.className = 'consoleLogger-ts';
		tsEl.style.display = ConsoleLogger.config.timestampEnabled ? '' : 'none';
		tsEl.textContent = formatTimestamp(entry.ts);

		// ─────  Badge ────────────────────────
		const badge = document.createElement('span');
		badge.className = 'consoleLogger-badge';
		badge.style.color = meta.color;
		badge.style.background = meta.bg;
		badge.style.border = `1px solid ${meta.color}44`;
		badge.textContent = meta.label;

		// ───── Expand arrow ────────────────────────
		const canExpand = !NO_TOGGLE_KINDS.has(entry.kind) && (isLong || hasStack);
		const arrow = document.createElement('span');
		arrow.className = 'consoleLogger-arrow';
		arrow.textContent = canExpand ? (entry.collapsed ? '▶' : '▼') : ' ';

		// ─────  Duplicate counter ────────────────────────
		const dupEl = document.createElement('span');
		dupEl.className = 'consoleLogger-dup-count' + (entry.dupCount > 1 ? ' visible' : '');
		dupEl.dataset.dup = entry.id;
		dupEl.textContent = `x${entry.dupCount}`;

		// ───── Content by kind ────────────────────────
		const textEl = document.createElement('span');
		textEl.className = 'consoleLogger-message-row' + (isLong && entry.collapsed ? ' collapsed' : '');

		const contentEl = document.createElement('span');
		contentEl.className = 'consoleLogger-text';
		contentEl.style.color = meta.color;

		let onContentClick;

		switch (entry.kind) {
			case ENTRY_KIND.TABLE:
				ConsoleLogger.renderTableEntry(entry, contentEl, meta, mainText);
				break;
			case ENTRY_KIND.DIR:
				ConsoleLogger.renderDirEntry(entry, contentEl, meta, mainText);
				break;
			case ENTRY_KIND.DIRXML:
				ConsoleLogger.renderDirxmlEntry(entry, contentEl, meta, mainText);
				break;
			case ENTRY_KIND.GROUP:
				onContentClick = ConsoleLogger.renderGroupEntry(entry, contentEl, meta, mainText);
				break;
			case ENTRY_KIND.GROUP_END:
				ConsoleLogger.renderGroupEndEntry(entry, contentEl, meta, mainText);
				break;
			case ENTRY_KIND.TIME:
				ConsoleLogger.renderTimeEntry(entry, contentEl, meta, mainText);
				break;
			case ENTRY_KIND.COUNT:
				ConsoleLogger.renderCountEntry(entry, contentEl, meta, mainText);
				break;
			default:
				ConsoleLogger.renderDefaultEntry(entry, contentEl, meta, mainText);
		}

		textEl.appendChild(contentEl);

		// ───── Stack element ────────────────────────
		const stackEl = hasStack ? buildStackEl(entry.stackText, entry.collapsed) : document.createElement('span');
		if (!hasStack) stackEl.className = 'consoleLogger-stack' + (entry.collapsed ? ' hidden' : '');

		// ─────  Body (all entries) ────────────────────────
		const contentWrap = document.createElement('span');
		contentWrap.className = 'consoleLogger-content';

		// ───── Expand / collapse toggle ────────────────────────
		if (onContentClick) {
			contentWrap.onclick = onContentClick;
		} else {
			const canToggle = (isLong && entry.kind !== ENTRY_KIND.TABLE) || hasStack;
			if (canToggle) {
				const toggle = () => {
					entry.collapsed = !entry.collapsed;
					arrow.textContent = entry.collapsed ? '▶' : '▼';
					textEl.classList.toggle('collapsed', entry.collapsed && isLong);
					stackEl.classList.toggle('hidden', entry.collapsed);
				};
				arrow.onclick = toggle;
				// Don't collapse if user just finished a text-selection drag.
				contentWrap.onclick = () => {
					const sel = window.getSelection();
					if (sel && sel.toString().length > 0) return;
					toggle();
				};
			}
		}

		// ───── Tree prefix for nested entries ────────────────────────
		let treePrefix;
		if (entry.groupData?.depth > 0 || entry.kind === ENTRY_KIND.GROUP_END) {
			treePrefix = document.createElement('span');
			treePrefix.className = 'consoleLogger-tree-prefix';

			// Build the tree guide string based on depth
			const d = entry.groupData.depth;
			let guide = '';
			if (entry.kind === ENTRY_KIND.GROUP_END) {
				guide = (d > 0 ? PIPE.repeat(d - 1) : '') + LAST;
			} else if (entry.kind === ENTRY_KIND.GROUP) {
				guide = (d > 0 ? PIPE.repeat(d - 1) : '');
			} else {
				guide = PIPE.repeat(d - 1) + BRANCH;
			}

			treePrefix.textContent = guide;
		}

		// ───── Content (prefix, text) ────────────────────────
		if (treePrefix) {
			const textGroup = document.createElement('div');
			textGroup.className = 'consoleLogger-text-group';

			textGroup.appendChild(treePrefix);
			textGroup.appendChild(textEl);
			contentWrap.appendChild(textGroup);
		} else {
			contentWrap.appendChild(textEl);
		}

		if (hasStack) {
			stackEl.style.width = '100%';
			contentWrap.appendChild(stackEl);
		}

		// ─────  Metadata (time, badge, arrow, counter) ────────────────────────
		const metaWrap = document.createElement('span');
		metaWrap.className = 'consoleLogger-meta';
		metaWrap.appendChild(tsEl);
		metaWrap.appendChild(badge);
		metaWrap.appendChild(arrow);
		metaWrap.appendChild(dupEl);

		// ───── Action buttons: pin / protect / copy ────────────────────────
		const actions = buildActionsEl(entry);
		textEl.appendChild(actions);

		// ─────  Final build ────────────────────────
		row.appendChild(metaWrap);
		row.appendChild(contentWrap);

		body.appendChild(row);
	};

	ConsoleLogger.updateDupCount = function (entry) {
		const el = document.querySelector(`[data-dup="${entry.id}"]`);
		if (!el) return;
		el.textContent = `x${entry.dupCount}`;
		el.classList.add('visible');
	};

	ConsoleLogger.updateFilterCounters = function () {
		if (!ConsoleLogger.config.windowOpen) return;

		const counts = {};
		Object.keys(LOG_LEVELS).forEach(k => counts[k] = 0);
		ConsoleLogger.logs.forEach(e => { if (counts[e.level] !== undefined) counts[e.level]++; });
		Object.entries(counts).forEach(([level, n]) => {
			const el = document.querySelector(`[data-counter="${level}"]`);
			if (el) el.textContent = n > 0 ? `(${n})` : '';
		});
	};

	ConsoleLogger.updateStatusCount = function () {
		if (!ConsoleLogger.config.windowOpen) return;

		const countEl = document.getElementById('consoleLogger-count');
		if (!countEl) return;
		const visibleEntries = ConsoleLogger.logs.filter(e => ConsoleLogger.isEntryVisible(e));

		const visibleCount = visibleEntries.length;
		const totalCount = ConsoleLogger.logs.length;
		const totalMsgs = ConsoleLogger.logs.reduce((sum, e) => sum + (e.dupCount || 1), 0);

		const msgsPart = totalMsgs !== totalCount ? `(${totalMsgs})` : '';
		countEl.textContent = `${visibleCount} / ${totalCount} ${msgsPart} entries`;
	};

	//***********************************
	//    SCROLL & UNREAD BANNER
	//***********************************

	// Returns true when the log body is scrolled within 4px of the bottom
	function isScrolledToBottom() {
		const body = document.getElementById('consoleLogger-body');
		if (!body) return true;
		return body.scrollHeight - body.scrollTop - body.clientHeight < 4;
	}

	ConsoleLogger.scrollToBottom = function () {
		const body = document.getElementById('consoleLogger-body');
		if (body) body.scrollTop = body.scrollHeight;
	};

	ConsoleLogger.scrollToTop = function () {
		const body = document.getElementById('consoleLogger-body');
		if (body) body.scrollTop = 0;
	};

	ConsoleLogger.clearUnread = function () {
		ConsoleLogger._unreadCount = 0;
		const banner = document.getElementById('consoleLogger-unread-banner');
		if (banner) banner.classList.remove('visible');
	};

	ConsoleLogger.updateUnreadBanner = function () {
		const banner = document.getElementById('consoleLogger-unread-banner');
		if (!banner) return;
		const n = ConsoleLogger._unreadCount;
		banner.textContent = `▼  ${n} new unread ${n === 1 ? 'entry' : 'entries'} — click to scroll down`;
		banner.classList.add('visible');
	};

	// Re-renders the timeline rail with a pin marker for each pinned entry.
	ConsoleLogger.updateTimeline = function () {
		if (!ConsoleLogger.config.windowOpen) return;

		const rail = document.getElementById('consoleLogger-timeline');
		const body = document.getElementById('consoleLogger-body');
		if (!rail || !body) return;

		rail.innerHTML = '';

		const pinned = ConsoleLogger.logs.filter(e => e.pinned);
		if (pinned.length === 0) return;

		const totalH = body.scrollHeight;
		if (totalH === 0) return;

		// ───── Pins ────────────────────────
		pinned.forEach(entry => {
			const row = document.querySelector(`.consoleLogger-entry[data-id="${entry.id}"]`);
			if (!row) return;
			if (row.classList.contains('filtered')) return;

			const pct = ((row.offsetTop + row.offsetHeight / 2) / totalH) * 100;
			const marker = document.createElement('div');
			marker.className = 'consoleLogger-timeline-pin';
			marker.style.top = pct + '%';
			marker.title = entry.text.slice(0, 60);

			const meta = LOG_LEVELS[entry.level] || LOG_LEVELS.log;
			marker.style.setProperty('--pin-color', meta.color);

			marker.onclick = () => {
				body.scrollTop = row.offsetTop - body.clientHeight / 2;
				row.classList.add('consoleLogger-highlight');
				setTimeout(() => row.classList.remove('consoleLogger-highlight'), 1200);
			};
			rail.appendChild(marker);
		});
	};

	//***********************************
	//    LOG ACTIONS
	//***********************************

	// Clears the log. onlyHidden=true removes only filtered-out entries; otherwise clears all unprotected entries.
	ConsoleLogger.clearLogs = function (onlyHidden) {
		const isHidden = (entry) => !ConsoleLogger.isEntryVisible(entry);

		const total = ConsoleLogger.logs.length;
		const protectedEntries = ConsoleLogger.logs.filter(e => e.protected);
		const allProtected = !onlyHidden && protectedEntries.length === total && total > 0;

		if (onlyHidden) {
			ConsoleLogger.logs = ConsoleLogger.logs.filter(e => e.protected || !isHidden(e));
		}
		// All entries are protected — clear completely rather than no-op.
		else if (allProtected) {
			ConsoleLogger.logs = [];
		} else {
			ConsoleLogger.logs = ConsoleLogger.logs.filter(e => e.protected);
		}

		const removed = total - ConsoleLogger.logs.length;

		if (ConsoleLogger.config.windowOpen) ConsoleLogger.rebuildLog();
		if (!onlyHidden) ConsoleLogger.clearUnread();
		ConsoleLogger.updateStatusCount();
		ConsoleLogger.updateFilterCounters();
		ConsoleLogger.updateOpenBtnState();
		ConsoleLogger.updateTimeline();

		if (removed > 0 && !allProtected) {
			const msg = onlyHidden
				? `%c[ConsoleLogger]%c Deleted %c${removed}%c hidden entries.`
				: `%c[ConsoleLogger]%c Deleted %c${removed}%c entries.`;
			const style = `color: ${TOKENS.textWarning}; font-weight: bold;`;
			ConsoleLogger.addEntry('log', [msg, style, "", style, ""], { protected: true });
		}
	};

	ConsoleLogger.toggleProtected = function (entry) {
		entry.protected = !entry.protected;
		const row = document.querySelector(`.consoleLogger-entry[data-id="${entry.id}"]`);
		if (row) {
			row.classList.toggle('protected', entry.protected);
			const btn = row.querySelector('.consoleLogger-btn-protect');
			if (btn) {
				btn.textContent = entry.protected ? '🔒' : '🔓';
				btn.title = entry.protected ? 'Unprotect' : 'Protect from deletion';
				btn.classList.toggle('active', entry.protected);
			}
		}
	};

	ConsoleLogger.togglePinned = function (entry) {
		entry.pinned = !entry.pinned;
		const row = document.querySelector(`.consoleLogger-entry[data-id="${entry.id}"]`);
		if (row) {
			row.classList.toggle('pinned', entry.pinned);
			const btn = row.querySelector('.consoleLogger-btn-pin');
			if (btn) {
				btn.textContent = '📌';
				btn.title = entry.pinned ? 'Unpin' : 'Pin';
				btn.classList.toggle('active', entry.pinned);
			}
		}
		ConsoleLogger.updateTimeline();
	};

	ConsoleLogger.setAllCollapsed = function (collapsed) {
		ConsoleLogger.logs.forEach(e => e.collapsed = collapsed);
		if (ConsoleLogger.config.windowOpen) ConsoleLogger.rebuildLog();
	};

	//***********************************
	//    COPY
	//***********************************

	// Clipboard fallback for browsers where navigator.clipboard is unavailable.
	ConsoleLogger.copyTextFallback = function (text, message = 'Copied to clipboard.') {
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.style.cssText = 'position:fixed; opacity:0; pointer-events:none';

		document.body.appendChild(ta);
		ta.select();

		try {
			const success = document.execCommand('copy');
			if (success) Game.Popup(message);
			else console.error('ConsoleLogger: execCommand("copy") returned false');
		} catch (err) {
			console.error('ConsoleLogger: Failed to copy text via fallback', err);
		} finally {
			document.body.removeChild(ta);
		}
	};

	// Writes text to the clipboard with a fallback, then shows a confirmation popup.
	ConsoleLogger.copyText = function (text, message = 'Copied to clipboard.') {
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(text)
				.then(() => Game.Popup(message))
				.catch(() => ConsoleLogger.copyTextFallback(text, message));
		} else {
			ConsoleLogger.copyTextFallback(text, message);
		}
	};

	// Copies a single log entry to the clipboard.
	ConsoleLogger.copyEntry = function (entry, includeStack = false) {
		const message = includeStack ? 'Copied with stack trace.' : 'Copied to clipboard.';
		ConsoleLogger.copyText(formatEntryLine(entry, includeStack), message);
	};

	// Copies all log entries (or only the currently visible ones) to the clipboard as plain text.
	ConsoleLogger.copyAllLogs = function (visibleOnly = false) {
		const source = visibleOnly
			? ConsoleLogger.logs.filter(e => ConsoleLogger.isEntryVisible(e))
			: ConsoleLogger.logs;

		if (source.length === 0) {
			Game.Popup(visibleOnly
				? 'Console Logger: no visible entries to copy.'
				: 'Console Logger: nothing to copy.');
			return;
		}

		const lines = source.map(entry => formatEntryLine(entry));
		const text = lines.join('\n');
		const message = visibleOnly ? 'Visible logs copied to clipboard.' : 'All logs copied to clipboard.';

		ConsoleLogger.copyText(text, message);
	};

	//***********************************
	//    FILTERS & SEARCH
	//***********************************

	// Returns true if the entry passes the current filter toggles and search query (pre-lowercased).
	ConsoleLogger.isEntryVisible = function (entry, search = null) {
		if (!ConsoleLogger.config.filters[entry.level]) return false;
		const q = search ?? (document.getElementById('consoleLogger-search')?.value || '').toLowerCase();
		if (q && !entry.text.toLowerCase().includes(q)) return false;
		return true;
	};

	// Re-evaluates the filtered class on every rendered row against current filters and search.
	ConsoleLogger.applyFilters = function (searchText) {
		const entryMap = new Map(ConsoleLogger.logs.map(e => [e.id, e]));

		document.querySelectorAll('#consoleLogger-body .consoleLogger-entry').forEach(row => {
			const id = Number(row.dataset.id);
			const entry = entryMap.get(id);
			if (!entry) return;

			row.classList.toggle(
				'filtered',
				!ConsoleLogger.isEntryVisible(entry, searchText)
			);
		});

		ConsoleLogger.updateStatusCount();
		ConsoleLogger.updateTimeline();
	};

	// Toggles a log-level filter and re-applies filters to all rendered rows.
	ConsoleLogger.toggleFilter = function (level) {
		const filters = ConsoleLogger.config.filters;
		filters[level] = !filters[level];

		const btn = document.querySelector(`.consoleLogger-filter-btn[data-level="${level}"]`);
		if (btn) btn.classList.toggle('active', filters[level]);

		ConsoleLogger.applyFilters();
	};

	//***********************************
	//    OPEN BUTTON STATE
	//***********************************

	// Updates the open button state class based on unseen entries.
	ConsoleLogger.updateOpenBtnState = function () {
		const btn = document.getElementById('consoleLogger-open-btn');
		if (!btn) return;
		btn.classList.remove('consoleLogger-btn-danger', 'consoleLogger-btn-warning', 'consoleLogger-btn-primary');

		const hasError = ConsoleLogger._newCount.error > 0;
		const hasWarn = ConsoleLogger._newCount.warn > 0;
		const hasNew = ConsoleLogger._newCount.total > 0;

		if (hasError) btn.classList.add('consoleLogger-btn-danger');
		else if (hasWarn) btn.classList.add('consoleLogger-btn-warning');
		else if (hasNew) btn.classList.add('consoleLogger-btn-primary');

		// Badge
		const badge = document.getElementById('consoleLogger-open-btn-badge');
		if (badge) {
			badge.classList.remove('consoleLogger-btn-danger', 'consoleLogger-btn-warning', 'consoleLogger-btn-primary', 'visible');

			if (hasNew) {
				badge.textContent =
					ConsoleLogger._newCount.total > 99
						? '99+'
						: String(ConsoleLogger._newCount.total);

				if (hasError) badge.classList.add('consoleLogger-btn-danger');
				else if (hasWarn) badge.classList.add('consoleLogger-btn-warning');
				else badge.classList.add('consoleLogger-btn-primary');

				badge.classList.add('visible');
			}
		}
	};

	//***********************************
	//    ERROR / WARN NOTIFICATIONS
	//***********************************

	ConsoleLogger._notifyCooldowns = {};

	// Shows a Game.Notify toast for error/warn entries when the log window is closed, respecting NOTIFY_COOLDOWN.
	ConsoleLogger.maybeNotify = function (level, entry) {
		if (!ConsoleLogger.config.notifyOnError) return;
		if (level !== 'error' && level !== 'warn') return;

		const now = Date.now();
		if (ConsoleLogger._notifyCooldowns[level] && now - ConsoleLogger._notifyCooldowns[level] < NOTIFY_COOLDOWN) return;
		ConsoleLogger._notifyCooldowns[level] = now;

		const meta = LOG_LEVELS[level];
		const preview = entry.text.length > 60 ? entry.text.slice(0, 60) + '…' : entry.text;
		const msg = `<span style="color:${meta.color}">[${meta.label}]</span> ${preview}`
			+ `<br/><small style="opacity:0.6">Click to open logger (Ctrl+L)</small>`;

		Game.Notify(ConsoleLogger.name, msg, [32, 17], 10);

		// Wire the fresh toast to open the logger on click.
		setTimeout(function () {
			const notes = document.getElementById('notes');
			if (!notes) return;
			const last = notes.lastElementChild;
			if (last) {
				last.style.cursor = 'pointer';
				last.addEventListener('click', function () {
					ConsoleLogger.toggleWindow(true);
				}, { once: true });
			}
		}, 50);
	};

	//***********************************
	//    DRAG & RESIZE
	//***********************************

	// Makes the window draggable via its title bar; persists position to config.
	ConsoleLogger.makeDraggable = function (win, handle) {
		let startX, startY, startL, startT;

		handle.addEventListener('mousedown', function (e) {
			if (e.target.closest('.consoleLogger-dropdown-menu')) return;
			if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
			e.preventDefault();
			startX = e.clientX;
			startY = e.clientY;
			startL = parseInt(win.style.left) || 0;
			startT = parseInt(win.style.top) || 0;

			function onMove(ev) {
				win.style.left = (startL + ev.clientX - startX) + 'px';
				win.style.top = Math.max(0, startT + ev.clientY - startY) + 'px';
			}
			function onUp() {
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
				ConsoleLogger.config.windowX = parseInt(win.style.left);
				ConsoleLogger.config.windowY = parseInt(win.style.top);
			}
			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		});
	};

	// Makes the window resizable via its corner handle; persists size to config.
	ConsoleLogger.makeResizable = function (win, handle) {
		let startX, startY, startW, startH;

		handle.addEventListener('mousedown', function (e) {
			e.preventDefault();
			startX = e.clientX;
			startY = e.clientY;
			startW = parseInt(win.style.width) || 620;
			startH = parseInt(win.style.height) || 420;

			function onMove(ev) {
				win.style.width = Math.max(320, startW + ev.clientX - startX) + 'px';
				win.style.height = Math.max(180, startH + ev.clientY - startY) + 'px';
			}
			function onUp() {
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
				ConsoleLogger.config.windowW = parseInt(win.style.width);
				ConsoleLogger.config.windowH = parseInt(win.style.height);

				ConsoleLogger.updateTimeline();
			}
			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		});
	};

	//***********************************
	//    KEYBOARD SHORTCUT
	//***********************************

	// Registers Ctrl+L to toggle the log window.
	ConsoleLogger.addKeyListener = function () {
		if (ConsoleLogger._keyListenerAdded) return;
		ConsoleLogger._keyListenerAdded = true;

		document.addEventListener('keydown', function (e) {
			if (e.ctrlKey && e.code === HOTKEY) {
				e.preventDefault();
				ConsoleLogger.toggleWindow();
			}
		});

		// document.addEventListener('copy', e => {
		// 	e.preventDefault();
		// 	e.clipboardData.setData('text/plain', window.getSelection().toString());
		// 	e.clipboardData.setData('text/html', "");
		// });
	};

	//***********************************
	//    SAVE / LOAD / RESET CONFIG
	//***********************************

	ConsoleLogger.save = function () {
		return JSON.stringify(ConsoleLogger.config);
	};

	ConsoleLogger.load = function (str) {
		const base = ConsoleLogger.getDefaultConfig();
		if (!str) { ConsoleLogger.config = base; return; }

		try {
			const parsed = JSON.parse(str);
			ConsoleLogger.config = Object.assign({}, base, parsed);
			ConsoleLogger.config.windowOpen = false; // never auto-open on game load

			// ───── Restore theme ────────────────────────
			// Apply palette + styles before UI is shown.
			if (ConsoleLogger.config.theme && THEMES[ConsoleLogger.config.theme]) {
				Object.assign(PALETTE, THEMES[ConsoleLogger.config.theme]);
				LOG_LEVELS = rebuildLogLevels();
				TOKENS = rebuildTokens();

				ConsoleLogger.reloadStyles();
				if (ConsoleLogger.config.windowOpen) {
					ConsoleLogger.rebuildLog();
					ConsoleLogger.updateTimeline();
				}
			}

			// ───── Restore opacity ────────────────────────
			if (typeof ConsoleLogger.config.windowOpacity === 'number') {
				WINDOW_OPACITY = Math.min(1, Math.max(0.2, ConsoleLogger.config.windowOpacity));
				TOKENS = rebuildTokens();
				ConsoleLogger.reloadStyles();
			}

		} catch (e) {
			const style = `color: ${TOKENS.textWarning}; font-weight: bold;`;
			console.error('%c[ConsoleLogger]%c Failed to load config:', style, "", e);
			ConsoleLogger.config = base;
		}

		// ───── Reconcile interceptors with the loaded config ────────────────────────
		if (ConsoleLogger.isLoaded) {
			const toDisable = Object.keys(SOURCE_REGISTRY).filter(key => {
				const isOn = !!ConsoleLogger[SOURCE_REGISTRY[key].flag];
				const wantOn = !!ConsoleLogger.config.intercept[key];
				return isOn && !wantOn;
			});
			ConsoleLogger.purgeSourceEntries(toDisable);
			ConsoleLogger.syncIntercepts();
		}

		ConsoleLogger.syncConfigToUI();
	};

	// Highlights the Sources button with a warning when any source is disabled.
	ConsoleLogger.updateSourcesIndicator = function () {
		const btn = document.getElementById('consoleLogger-sources-dropdown-btn');
		if (!btn) return;

		const sourceKeys = Object.keys(ConsoleLogger.config.intercept);
		const disabledCount = sourceKeys.filter(key => !ConsoleLogger.config.intercept[key]).length;

		if (disabledCount > 0) {
			btn.classList.add('consoleLogger-btn-warning');
			btn.textContent = `⚠️ Sources (${disabledCount} off)`;
			btn.title = 'Some log sources are disabled — you may be missing errors';

		} else {
			btn.classList.remove('consoleLogger-btn-warning');
			btn.textContent = '🔗 Sources';
			btn.title = 'Toggle what gets logged';
		}
	};

	// Syncs all UI controls to the current config state.
	ConsoleLogger.syncConfigToUI = function () {
		const consoleWindow = document.getElementById('consoleLogger-window');

		// ───── Log level filter buttons ────────────────────────
		Object.keys(LOG_LEVELS).forEach(key => {
			const btn = document.querySelector(`.consoleLogger-filter-btn[data-level="${key}"]`);
			if (btn) btn.classList.toggle('active', !!ConsoleLogger.config.filters[key]);
		});

		// ───── Sources dropdown checkboxes ────────────────────────
		Object.entries(SOURCE_REGISTRY).forEach(([key, { checkboxId }]) => {
			const chk = document.getElementById(checkboxId);
			if (chk) chk.checked = !!ConsoleLogger.config.intercept[key];
		});
		ConsoleLogger.updateSourcesIndicator();

		// ───── Theme ────────────────────────
		if (ConsoleLogger.config.theme) ConsoleLogger.applyTheme(ConsoleLogger.config.theme);

		// ───── Opacity slider ────────────────────────
		const opacitySlider = document.getElementById('consoleLogger-opacity-slider');
		const opacityReadout = document.getElementById('consoleLogger-opacity-value');
		const opacityValue = ConsoleLogger.config.windowOpacity ?? DEFAULT_OPACITY;
		const opacityPercent = Math.round(opacityValue * 100);
		if (opacitySlider) opacitySlider.value = opacityPercent;
		if (opacityReadout) opacityReadout.textContent = `${opacityPercent}%`;

		// ───── Timestamp toggle ────────────────────────
		const chkTimestamp = document.getElementById('consoleLogger-chk-timestamp');
		if (chkTimestamp) chkTimestamp.checked = !!ConsoleLogger.config.timestampEnabled;

		// ───── Stack trace toggle ────────────────────────
		const chkStackTrace = document.getElementById('consoleLogger-chk-stack-trace');
		if (chkStackTrace) chkStackTrace.checked = !!ConsoleLogger.config.stackTraceEnabled;

		// ───── Text selection toggle ────────────────────────
		const chkTextSelection = document.getElementById('consoleLogger-chk-text-selection');
		if (chkTextSelection) {
			const isEnabled = !!ConsoleLogger.config.textSelectionEnabled;
			chkTextSelection.checked = isEnabled;
			if (consoleWindow) consoleWindow.style.userSelect = isEnabled ? 'text' : 'none';
		}

		// ───── Notify on error toggle ────────────────────────
		const chkNotifyOnError = document.getElementById('consoleLogger-chk-notify-on-error');
		if (chkNotifyOnError) chkNotifyOnError.checked = !!ConsoleLogger.config.notifyOnError;

		// ───── Save options ────────────────────────
		const chkSaveStackTraces = document.getElementById('consoleLogger-chk-save-stack-traces');
		if (chkSaveStackTraces) chkSaveStackTraces.checked = !!ConsoleLogger.config.saveIncludeStackTraces;
		const chkSaveExpandDups = document.getElementById('consoleLogger-chk-save-expand-dups');
		if (chkSaveExpandDups) chkSaveExpandDups.checked = !!ConsoleLogger.config.saveExpandDuplicates;

		// ───── Window position / size ────────────────────────
		if (consoleWindow) {
			consoleWindow.style.left = ConsoleLogger.config.windowX + 'px';
			consoleWindow.style.top = ConsoleLogger.config.windowY + 'px';
			consoleWindow.style.width = ConsoleLogger.config.windowW + 'px';
			consoleWindow.style.height = ConsoleLogger.config.windowH + 'px';
		}

		// ───── Re-render log if window is open ────────────────────────
		if (ConsoleLogger.config.windowOpen) ConsoleLogger.rebuildLog();
	};

	ConsoleLogger.resetConfig = function () {
		ConsoleLogger.config = ConsoleLogger.getDefaultConfig();
		if (ConsoleLogger.isLoaded) ConsoleLogger.syncIntercepts();
		ConsoleLogger.syncConfigToUI();
		Game.UpdateMenu();
		Game.Popup('Console Logger: settings reset.');
	};

	//***********************************
	//    INIT
	//***********************************

	// ───── Active mods summary ────────────────────────
	ConsoleLogger.logActiveMods = function () {
		const style = `color: ${TOKENS.textWarning}; font-weight: bold;`;

		if (!Game.mods || typeof Game.mods !== 'object') {
			console.warn('%c[ConsoleLogger]%c Could not read Game.mods — active mods list unavailable.', style, "");
			return;
		}

		const rows = Object.keys(Game.mods)
			.map(id => {
				const mod = Game.mods[id];
				return {
					Name: (mod && mod.name) ? mod.name : id,
					ID: id,
					Version: (mod && mod.version) ? String(mod.version) : '',
				};
			})
			.sort((a, b) => a.Name.localeCompare(b.Name, undefined, { sensitivity: 'base' }));

		console.groupCollapsed(`%c[ConsoleLogger]%c Active mods: %c${rows.length}`, style, "", style);
		console.table(rows);
		console.groupEnd();
	};

	// Entry point: loads saved config, launches the mod, and sets up persistence.
	ConsoleLogger.init = function () {
		ConsoleLogger.isLoaded = true;

		if (!ConsoleLogger.config) {
			ConsoleLogger.config = ConsoleLogger.getDefaultConfig();
		}

		// ───── Hook save / load ────────────────────────
		const _origLoadModData = Game.loadModData;
		Game.loadModData = function () {
			_origLoadModData();
			if (Game.modSaveData[ConsoleLogger.ID]) {
				ConsoleLogger.load(Game.modSaveData[ConsoleLogger.ID]);
			}
			setTimeout(ConsoleLogger.logActiveMods, 2000);
		};

		// ───── Setup UI ────────────────────────
		ConsoleLogger.injectStyles();
		ConsoleLogger.buildUI();
		ConsoleLogger.addKeyListener();

		// ───── Hook console and global errors ────────────────────────
		ConsoleLogger.syncIntercepts();

		// ───── Ready ────────────────────────
		const style = `color: ${TOKENS.textWarning}; font-weight: bold;`;
		console.log(`%c[ConsoleLogger]%c Version %c${ConsoleLogger.version}%c loaded.`, style, "", style, "");
		Game.Notify(ConsoleLogger.name, 'Logger active — press <b>Ctrl+L</b> to open.', [32, 17], 10);
	};

	//***********************************
	//    MOD REGISTRATION
	//***********************************

	Game.registerMod(ConsoleLogger.ID, ConsoleLogger);
};

// Wait for the game to load, then launches the mod.
function waitForGame() {
	if (Game && Game.ready) {
		ConsoleLogger.launch();
	} else {
		setTimeout(waitForGame, 100);
	}
}

if (!ConsoleLogger.isLoaded) {
	waitForGame();
}