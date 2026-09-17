# Export-Collection-Tree

 (Zotero 7 / 8 / 9)

In the Zotero left-hand Collection tree, right-click any Collection → **Export Collection Tree**.

The plugin exports only the **current Collection + all of its child Collections (recursively)** as a UTF-8 `collection_tree.txt` tree-structured text file.

**Read-only plugin:** The plugin only reads Collection names and never modifies any Zotero data. It does not access Items, Attachments, Notes, Tags, or metadata.

---

## 1. Directory Structure

```text
zotero-collection-tree-exporter/
├── src/
│   ├── manifest.json        Plugin manifest (ID, version, compatibility)
│   └── bootstrap.js         All plugin logic (approximately 200 lines, no third-party dependencies)
├── test/
│   └── tree_test.js         Unit tests for tree output (node test/tree_test.js)
├── build.py                 Build script (generates dist/*.xpi)
└── dist/
    └── collection-tree-exporter.xpi   ← Ready-to-install plugin
```

## 2. Building the `.xpi`

**Option A: Use the existing build**

`dist/collection-tree-exporter.xpi` has already been generated.

**Option B: Build it yourself**

```bash
cd zotero-collection-tree-exporter
python build.py
```

An `.xpi` file is essentially a ZIP archive. `manifest.json` must be located at the **root of the archive**.

You can also use the command-line `zip` utility:

```bash
cd src && zip -r ../dist/collection-tree-exporter.xpi .
```

## 3. Installing on Zotero 7 / 8 / 9

1. Open Zotero → **Tools → Add-ons**
2. Click the gear icon in the upper-right corner → **Install Add-on From File…**
3. Select `dist/collection-tree-exporter.xpi`
4. Follow the prompts and restart Zotero

### Usage

In the left-hand Collection tree:

**Right-click any Collection → Export Collection Tree**

Then choose a save location. The plugin will generate:

```text
collection_tree.txt
```

## 4. Development Mode

For development, you can place the files from `src/` directly into the current Zotero Profile's:

```text
extensions/<plugin-ID>/
```

directory, then restart Zotero. This allows the plugin to be loaded as an unpacked extension.

The Zotero extension loader supports both `jar:` and `file://` root URIs, so the directory-based development setup works.

Example on Windows:

```text
C:\Users\<Username>\AppData\Roaming\Zotero\Zotero\Profiles\<Random>.default\extensions\collection-tree-exporter@local\
    ├── manifest.json
    └── bootstrap.js
```

After modifying the code, go to the **Add-ons** page and **Disable → Enable** the plugin once to reload it.

### Output Format

```text
Literature Review
├── Empirical Studies
└── Theory
    ├── TAM
    └── UTAUT
```

The last child node uses `└──`, while intermediate child nodes use `├──`.

When there are subsequent sibling nodes, the indentation uses `│   `; otherwise, it uses four spaces.
