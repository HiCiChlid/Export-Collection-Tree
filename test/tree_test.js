/*
	Verifies bootstrap.js against the specification:

	  1-7  buildTreeText(): tree shape, ordering, indentation, UTF-8, CRLF
	  8-9  the Zotero loader can actually find the bootstrap hooks
	  10   menu injection is append-only, idempotent and self-healing

	Run with Node:
	    node test/tree_test.js
*/

const fs = require("fs");
const path = require("path");
const vm = require("vm");

/* ---------- load bootstrap.js with a minimal Zotero stub ---------- */

const sandbox = {
	Zotero: {
		initializationPromise: Promise.resolve(),
		debug() {},
		logError(e) { console.log("Zotero.logError: " + e); },
		alert() {},
		isWin: false,
		localeCompare: (a, b) => a.localeCompare(b, "en"),
		getMainWindows: () => [],
	},
	ChromeUtils: { importESModule: () => ({}) },
	IOUtils: {},
};

vm.createContext(sandbox);
vm.runInContext(
	fs.readFileSync(path.join(__dirname, "..", "src", "bootstrap.js"), "utf8"),
	sandbox
);

const CTE = sandbox.CollectionTreeExporter;

/* ---------- helpers ---------- */

let failed = 0;

function check(title, actual, expected) {
	if (actual === expected) {
		console.log("PASS  " + title);
	}
	else {
		failed++;
		console.log("FAIL  " + title);
		console.log("--- expected ---\n" + JSON.stringify(expected));
		console.log("--- actual   ---\n" + JSON.stringify(actual));
	}
}

function col(name, children) {
	return {
		id: name,
		name: name,
		getChildCollections: () => children || [],
	};
}

/* ---------- 1. collection without subcollections ---------- */

check(
	"no subcollections",
	CTE.buildTreeText(col("Theory")),
	"Theory\n"
);

/* ---------- 2. full example ---------- */

const research = col("Research", [
	col("Literature Review", [
		col("Theory", [col("TAM"), col("UTAUT")]),
		col("Empirical Studies"),
	]),
	col("Methodology", [col("Quantitative"), col("Qualitative")]),
	col("Data"),
]);

check(
	"selection + subcollections only",
	CTE.buildTreeText(research.getChildCollections()[0]),
	[
		"Literature Review",
		"\u251c\u2500\u2500 Empirical Studies",
		"\u2514\u2500\u2500 Theory",
		"    \u251c\u2500\u2500 TAM",
		"    \u2514\u2500\u2500 UTAUT",
		"",
	].join("\n")
);

/* ---------- 3. nested selection must not leak siblings ---------- */

const theoryOnly = CTE.buildTreeText(
	research.getChildCollections()[0].getChildCollections()[0]
);

check(
	"nested selection excludes siblings and ancestors",
	theoryOnly,
	["Theory", "\u251c\u2500\u2500 TAM", "\u2514\u2500\u2500 UTAUT", ""].join("\n")
);

check(
	"no leaking of other collections",
	["Research", "Empirical Studies", "Methodology", "Quantitative", "Data"]
		.some(name => theoryOnly.includes(name)),
	false
);

/* ---------- 4. continuation prefix "\u2502   " on middle branches ---------- */

const deep = col("Root", [
	col("A", [col("A1", [col("X")]), col("A2")]),
	col("B"),
]);

check(
	"multi-level indentation",
	CTE.buildTreeText(deep),
	[
		"Root",
		"\u251c\u2500\u2500 A",
		"\u2502   \u251c\u2500\u2500 A1",
		"\u2502   \u2502   \u2514\u2500\u2500 X",
		"\u2502   \u2514\u2500\u2500 A2",
		"\u2514\u2500\u2500 B",
		"",
	].join("\n")
);

/* ---------- 5. Chinese names, raw order ---------- */

CTE.SORT_BY_NAME = false;
const chinese = col("\u7814\u7a76", [
	col("\u6587\u732e\u7efc\u8ff0", [
		col("\u7406\u8bba"),
		col("\u5b9e\u8bc1\u7814\u7a76"),
	]),
	col("\u65b9\u6cd5"),
]);

check(
	"Chinese names are preserved",
	CTE.buildTreeText(chinese),
	[
		"\u7814\u7a76",
		"\u251c\u2500\u2500 \u6587\u732e\u7efc\u8ff0",
		"\u2502   \u251c\u2500\u2500 \u7406\u8bba",
		"\u2502   \u2514\u2500\u2500 \u5b9e\u8bc1\u7814\u7a76",
		"\u2514\u2500\u2500 \u65b9\u6cd5",
		"",
	].join("\n")
);
CTE.SORT_BY_NAME = true;

/* ---------- 6. Windows line endings ---------- */

sandbox.Zotero.isWin = true;
check("CRLF on Windows", CTE.buildTreeText(col("A", [col("B")])), "A\r\n\u2514\u2500\u2500 B\r\n");
sandbox.Zotero.isWin = false;

/* ---------- 7. cyclic data does not hang ---------- */

const loopA = col("LoopA");
const loopB = col("LoopB", [loopA]);
loopA.getChildCollections = () => [loopB];
check(
	"cyclic data is cut off",
	CTE.buildTreeText(loopA),
	["LoopA", "\u2514\u2500\u2500 LoopB", ""].join("\n")
);

/* ---------- 8. the hooks must be sandbox GLOBALS ---------- *
 * Zotero's loader resolves them like this:
 *     func = scope[method] || Cu.evalInSandbox(`${method};`, scope)
 *     if (!func) Zotero.warn(`Plugin ${id} is missing bootstrap method ...`)
 * An object-only bootstrap.js is never found and the plugin silently does
 * nothing, so this is the single most important regression test here.
 */

const HOOKS = [
	"install", "uninstall", "startup", "shutdown",
	"onMainWindowLoad", "onMainWindowUnload",
];

for (const hook of HOOKS) {
	check("hook '" + hook + "' is a global function", typeof sandbox[hook], "function");
	// exactly what Cu.evalInSandbox(`${method};`, scope) does
	check(
		"loader lookup('" + hook + "') finds a function",
		typeof vm.runInContext(hook + ";", sandbox),
		"function"
	);
}

/* ---------- 9. menu injection ---------- */

function fakeWindow() {
	const byId = {};
	function node(tagName) {
		return {
			tagName,
			id: "",
			attrs: {},
			listeners: {},
			setAttribute(k, v) { this.attrs[k] = v; },
			addEventListener(type, fn) {
				(this.listeners[type] = this.listeners[type] || []).push(fn);
			},
			removeEventListener(type, fn) {
				const l = this.listeners[type] || [];
				const i = l.indexOf(fn);
				if (i >= 0) l.splice(i, 1);
			},
			remove() {
				delete byId[this.id];
				const i = popup.children.indexOf(this);
				if (i >= 0) popup.children.splice(i, 1);
			},
		};
	}
	const popup = node("menupopup");
	popup.id = "zotero-collectionmenu";
	popup.children = [];
	popup.appendChild = n => {
		popup.children.push(n);
		if (n.id) byId[n.id] = n;
	};
	byId[popup.id] = popup;

	const doc = {
		getElementById: id => byId[id] || null,
		createXULElement: tag => node(tag),
	};
	return { document: doc, ZoteroPane: {} };
}

const win = fakeWindow();
const popup = win.document.getElementById("zotero-collectionmenu");

sandbox.onMainWindowLoad({ window: win });
check(
	"menu gets a separator then the item",
	popup.children.map(n => n.tagName).join(","),
	"menuseparator,menuitem"
);
check(
	"menu item id",
	win.document.getElementById(CTE.MENU_ID) !== null,
	true
);
check(
	"menu item label",
	win.document.getElementById(CTE.MENU_ID).attrs.label,
	"Export Collection Tree"
);

sandbox.onMainWindowLoad({ window: win });
check("injection is idempotent", popup.children.length, 2);

// if the item ever disappears, opening the menu puts it back - exactly once,
// without leaving a stray separator behind
win.document.getElementById(CTE.MENU_ID).remove();
check(
	"item really removed for the next check",
	win.document.getElementById(CTE.MENU_ID),
	null
);
(popup.listeners.popupshowing || []).forEach(fn => fn());
check(
	"item is restored on popupshowing",
	win.document.getElementById(CTE.MENU_ID) !== null,
	true
);
check(
	"restore does not duplicate the separator",
	popup.children.map(n => n.tagName).join(","),
	"menuseparator,menuitem"
);

sandbox.onMainWindowUnload({ window: win });
check(
	"unload removes the item",
	win.document.getElementById(CTE.MENU_ID),
	null
);
check("unload leaves Zotero's own menu intact", popup.children.length, 0);

/* ---------- 10. startup() wires up already-open windows ---------- */

const startupWin = fakeWindow();
sandbox.Zotero.getMainWindows = () => [startupWin];

sandbox.startup({ id: "collection-tree-exporter@local", version: "1.0.3", rootURI: "file:///" }, 1)
	.then(() => {
		check(
			"startup() adds the item to open windows",
			startupWin.document.getElementById(CTE.MENU_ID) !== null,
			true
		);
		console.log(failed ? "\n" + failed + " test(s) FAILED" : "\nALL TESTS PASSED");
		process.exit(failed ? 1 : 0);
	})
	.catch(e => {
		console.log("FAIL  startup() threw: " + e);
		process.exit(1);
	});
