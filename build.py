# Builds collection-tree-exporter.xpi from the contents of src/.
#
# Usage:
#     python build.py
#
# The XPI is a plain ZIP with manifest.json at its root.
#
# The manifest is validated first: Zotero 9 (patched Firefox 140) rejects a plugin
# whose manifest lacks any of these, and then only shows the generic
# "could not be installed / may be incompatible" dialog:
#     applications.zotero.id
#     applications.zotero.update_url
#     applications.zotero.strict_max_version
#
# bootstrap.js is validated too: Zotero resolves the lifecycle hooks as GLOBALS in
# the plugin sandbox, so they have to be top-level function declarations:
#     func = scope[method] || Cu.evalInSandbox(`${method};`, scope)
# A hook written as a method on an object is never found; Zotero just logs
# "is missing bootstrap method ..." and the plugin silently does nothing.

import json
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "src")
DIST = os.path.join(ROOT, "dist")
XPI_NAME = "collection-tree-exporter.xpi"

REQUIRED = ["id", "update_url", "strict_min_version", "strict_max_version"]
HOOKS = ["install", "uninstall", "startup", "shutdown",
         "onMainWindowLoad", "onMainWindowUnload"]


def check_manifest(path):
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read()
    # A BOM or any non-UTF-8 byte makes Zotero treat the manifest as invalid.
    if text.startswith("\ufeff"):
        sys.exit("ERROR: manifest.json starts with a BOM; save it as UTF-8 without BOM.")
    try:
        manifest = json.loads(text)
    except ValueError as exc:
        sys.exit("ERROR: manifest.json is not valid JSON: %s" % exc)

    if manifest.get("manifest_version") != 2:
        sys.exit("ERROR: manifest_version must be 2 for a Zotero plugin.")

    zotero = manifest.get("applications", {}).get("zotero")
    if not isinstance(zotero, dict):
        sys.exit("ERROR: manifest.json needs an 'applications.zotero' object.")

    for key in REQUIRED:
        if not zotero.get(key):
            sys.exit("ERROR: applications.zotero.%s is required by Zotero 9." % key)

    # strict_min_version must not contain '*' and strict_max_version should be a
    # concrete high number (see README section 7).
    if "*" in zotero["strict_min_version"]:
        sys.exit("ERROR: '*' is illegal in strict_min_version.")

    print("manifest OK: %s v%s (Zotero %s - %s)" % (
        zotero["id"], manifest["version"],
        zotero["strict_min_version"], zotero["strict_max_version"]))


def check_bootstrap(path):
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read()
    if text.startswith("\ufeff"):
        sys.exit("ERROR: bootstrap.js starts with a BOM.")

    for hook in HOOKS:
        # Top-level declaration: `function hook(` at the start of a line, i.e. not
        # indented inside the plugin object.
        if not re.search(r"^function\s+%s\s*\(" % hook, text, re.M):
            sys.exit(
                "ERROR: bootstrap.js has no top-level `function %s(`.\n"
                "       Zotero resolves the bootstrap hooks as globals in the plugin\n"
                "       sandbox (plugins.js: scope[method] || Cu.evalInSandbox(...)).\n"
                "       A hook defined as an object method is never found, so Zotero\n"
                "       silently skips it ('is missing bootstrap method ...') and the\n"
                "       plugin does nothing at all." % hook)

    print("bootstrap OK: top-level hooks present -> " + ", ".join(HOOKS))


def main():
    manifest_path = os.path.join(SRC, "manifest.json")
    if not os.path.isfile(manifest_path):
        sys.exit("ERROR: src/manifest.json not found - run this script from the plugin folder.")
    check_manifest(manifest_path)

    bootstrap_path = os.path.join(SRC, "bootstrap.js")
    if not os.path.isfile(bootstrap_path):
        sys.exit("ERROR: src/bootstrap.js not found.")
    check_bootstrap(bootstrap_path)

    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, XPI_NAME)

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for dirpath, dirnames, filenames in os.walk(SRC):
            dirnames.sort()
            for filename in sorted(filenames):
                full = os.path.join(dirpath, filename)
                rel = os.path.relpath(full, SRC).replace(os.sep, "/")
                zf.write(full, rel)
                print("  + " + rel)

    size = os.path.getsize(out)
    print("\nBuilt: %s (%d bytes)" % (out, size))
    print("Install in Zotero: Tools -> Add-ons -> gear icon -> Install Add-on From File...")


if __name__ == "__main__":
    main()
