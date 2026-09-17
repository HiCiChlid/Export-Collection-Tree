/*
	Collection Tree Exporter - Zotero 7 / 8 / 9 plugin

	Adds "Export Collection Tree" to the collection context menu. It writes the
	selected collection plus all of its subcollections to a UTF-8 text tree
	(default file name: collection_tree.txt).

	The plugin only reads collection names. Nothing in Zotero is ever modified.
*/

"use strict";

var CollectionTreeExporter = {
	MENU_ID: "collection-tree-exporter-menuitem",
	MENU_SEPARATOR_ID: "collection-tree-exporter-separator",
	MENU_POPUP_ID: "zotero-collectionmenu",
	DEFAULT_FILENAME: "collection_tree.txt",

	// Zotero's collection tree displays subcollections sorted by name
	// (collectionTree.jsx inserts rows with Zotero.localeCompare(ref.name)), so
	// sorting the same way reproduces exactly the order you see in Zotero.
	// Set to false to keep the raw order returned by getChildCollections().
	SORT_BY_NAME: true,

	// win -> { popup, onPopupShowing }
	_windows: new WeakMap(),

	/* ------------------------------------------------------------------ *
	 * Plugin lifecycle
	 * ------------------------------------------------------------------ */

	async startup({ id, version, rootURI }, reason) {
		await Zotero.initializationPromise;
		for (let win of Zotero.getMainWindows()) {
			this.addToWindow(win);
		}
		Zotero.debug("Collection Tree Exporter: started");
	},

	shutdown(data, reason) {
		// reason 2 == APP_SHUTDOWN: Zotero is quitting, the windows go with it
		if (reason === 2) {
			return;
		}
		for (let win of Zotero.getMainWindows()) {
			this.removeFromWindow(win);
		}
		Zotero.debug("Collection Tree Exporter: shut down");
	},

	onMainWindowLoad(data) {
		this.addToWindow(this.getWindow(data));
	},

	onMainWindowUnload(data) {
		this.removeFromWindow(this.getWindow(data));
	},

	// Zotero passes { window }; accept a bare window too, in case that changes.
	getWindow(data) {
		return data && data.window ? data.window : data;
	},

	/* ------------------------------------------------------------------ *
	 * Menu item
	 * ------------------------------------------------------------------ */

	addToWindow(win) {
		if (!win || !win.document || this._windows.has(win)) {
			return;
		}
		let popup = win.document.getElementById(this.MENU_POPUP_ID);
		if (!popup) {
			Zotero.debug("Collection Tree Exporter: no #" + this.MENU_POPUP_ID
				+ " in this window, skipping");
			return;
		}

		// Zotero builds this menu in place, but re-adding on every open costs
		// nothing and keeps the item working if that ever changes.
		let onPopupShowing = () => this.insertMenuItems(win);
		popup.addEventListener("popupshowing", onPopupShowing);

		this._windows.set(win, { popup, onPopupShowing });
		this.insertMenuItems(win);
	},

	removeFromWindow(win) {
		let state = win && this._windows.get(win);
		if (!state) {
			return;
		}
		state.popup.removeEventListener("popupshowing", state.onPopupShowing);

		let doc = win.document;
		let separator = doc.getElementById(this.MENU_SEPARATOR_ID);
		let menuitem = doc.getElementById(this.MENU_ID);
		if (separator) separator.remove();
		if (menuitem) menuitem.remove();

		this._windows.delete(win);
	},

	insertMenuItems(win) {
		let doc = win.document;
		if (doc.getElementById(this.MENU_ID)) {
			return; // already there
		}
		let popup = doc.getElementById(this.MENU_POPUP_ID);
		if (!popup) {
			return;
		}

		// Drop a separator left behind if the item was removed on its own
		let stale = doc.getElementById(this.MENU_SEPARATOR_ID);
		if (stale) {
			stale.remove();
		}

		let separator = doc.createXULElement("menuseparator");
		separator.id = this.MENU_SEPARATOR_ID;

		let menuitem = doc.createXULElement("menuitem");
		menuitem.id = this.MENU_ID;
		menuitem.setAttribute("class", "menuitem-iconic");
		menuitem.setAttribute("label", "Export Collection Tree");
		menuitem.addEventListener("command", () => {
			this.exportSelectedCollectionTree(win).catch(e => Zotero.logError(e));
		});

		// Append at the END, never insert: ZoteroPane.buildCollectionContextMenu()
		// assigns its own option list onto menu.childNodes[i] by index, so adding
		// anything before Zotero's items would scramble that menu.
		popup.appendChild(separator);
		popup.appendChild(menuitem);

		Zotero.debug("Collection Tree Exporter: added menu item");
	},

	/* ------------------------------------------------------------------ *
	 * Export
	 * ------------------------------------------------------------------ */

	async exportSelectedCollectionTree(win) {
		let zp = win.ZoteroPane;
		// Right-clicking a row selects it first (virtualized-table.jsx), so this
		// is the collection the user right-clicked. Returns undefined for
		// "My Library", groups, saved searches, feeds and the row headers.
		let collection = zp && zp.getSelectedCollection();

		if (!collection) {
			Zotero.alert(win, "Collection Tree Exporter", "Please select a collection first.");
			return;
		}

		let text = this.buildTreeText(collection);

		let path = await this.pickSavePath(win);
		if (!path) {
			return; // user cancelled
		}

		try {
			await IOUtils.writeUTF8(path, text);
		}
		catch (e) {
			Zotero.logError(e);
			Zotero.alert(win, "Collection Tree Exporter", "Could not save the file: " + e.message);
			return;
		}

		Zotero.debug("Collection Tree Exporter: wrote " + path);
	},

	async pickSavePath(win) {
		let { FilePicker } = ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs");
		let fp = new FilePicker();
		fp.init(win, "Export Collection Tree", fp.modeSave);
		fp.appendFilter("Text file", "*.txt");
		fp.defaultString = this.DEFAULT_FILENAME;
		fp.defaultExtension = "txt";

		let rv = await fp.show();
		if (rv !== fp.returnOK && rv !== fp.returnReplace) {
			return null;
		}

		let path = fp.file;
		if (!path) {
			return null;
		}
		if (!/\.txt$/i.test(path)) {
			path += ".txt";
		}
		return path;
	},

	/* ------------------------------------------------------------------ *
	 * Tree rendering
	 * ------------------------------------------------------------------ */

	buildTreeText(collection) {
		let lines = [collection.name];
		let seen = new Set([collection.id]); // guards against corrupted (cyclic) data
		let children = this.getChildren(collection);

		children.forEach((child, i) => {
			this.appendLines(lines, child, "", i === children.length - 1, seen);
		});

		return lines.join(this.getEOL()) + this.getEOL();
	},

	appendLines(lines, collection, prefix, isLast, seen) {
		if (seen.has(collection.id)) {
			return;
		}
		seen.add(collection.id);

		// Box-drawing characters are written as escapes so the file stays ASCII-safe:
		// \u2514\u2500\u2500 = "└──" (last child), \u251c\u2500\u2500 = "├──" (middle child)
		lines.push(prefix + (isLast ? "\u2514\u2500\u2500 " : "\u251c\u2500\u2500 ") + collection.name);

		// "\u2502   " under a middle sibling, four spaces under the last one
		let childPrefix = prefix + (isLast ? "    " : "\u2502   ");
		let children = this.getChildren(collection);

		children.forEach((child, i) => {
			this.appendLines(lines, child, childPrefix, i === children.length - 1, seen);
		});
	},

	getChildren(collection) {
		// getChildCollections() already skips collections in the trash
		let children = collection.getChildCollections();
		if (this.SORT_BY_NAME) {
			children = children.slice().sort((a, b) => {
				return Zotero.localeCompare
					? Zotero.localeCompare(a.name, b.name)
					: a.name.localeCompare(b.name);
			});
		}
		return children;
	},

	getEOL() {
		// Windows text editors (Notepad) still prefer CRLF
		return Zotero.isWin ? "\r\n" : "\n";
	},
};

/* ------------------------------------------------------------------ *
 * Bootstrap entry points
 *
 * These MUST be top-level function declarations. Zotero's plugin loader
 * (chrome/content/zotero/xpcom/plugins.js) looks them up as globals in the
 * plugin sandbox:
 *
 *     func = scope[method] || Cu.evalInSandbox(`${method};`, scope);
 *     if (!func) Zotero.warn(`Plugin ${id} is missing bootstrap method ...`);
 *
 * Methods on an object are never found, so with an object-only bootstrap.js
 * Zotero silently skips every hook: the plugin installs and can be enabled,
 * but nothing it does ever runs. This mirrors the official Make It Red
 * example and zotero-plugin-template, which both use top-level functions.
 * ------------------------------------------------------------------ */

function install() {}

function uninstall() {}

function startup(data, reason) {
	return CollectionTreeExporter.startup(data, reason);
}

function shutdown(data, reason) {
	return CollectionTreeExporter.shutdown(data, reason);
}

function onMainWindowLoad(data, reason) {
	return CollectionTreeExporter.onMainWindowLoad(data, reason);
}

function onMainWindowUnload(data, reason) {
	return CollectionTreeExporter.onMainWindowUnload(data, reason);
}
