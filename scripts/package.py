"""Create a Chrome Web Store ZIP from the bundled extension files."""

import argparse
import json
from html.parser import HTMLParser
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]


class PopupAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = set()

    def handle_starttag(self, tag, attrs):
        fields = dict(attrs)
        field = {"script": "src", "link": "href"}.get(tag)
        if field and fields.get(field):
            self.paths.add(fields[field])


def main():
    manifest_path = ROOT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", nargs="?", type=Path,
                        default=ROOT / f"okx-trade-goal-{manifest['version']}-chrome-store.zip")
    destination = parser.parse_args().output

    action = manifest["action"]
    popup_file = action["default_popup"]
    popup = PopupAssets()
    popup.feed((ROOT / popup_file).read_text(encoding="utf-8"))
    files = {"manifest.json", popup_file, manifest["background"]["service_worker"],
             *manifest["icons"].values(), *action["default_icon"].values(), *popup.paths}
    for script in manifest["content_scripts"]:
        files.update(script["js"])

    with ZipFile(destination, "w", ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sorted(files):
            path = ROOT / name
            if not path.resolve().is_relative_to(ROOT) or not path.is_file():
                raise ValueError(f"Invalid package file: {name}")
            archive.write(path, path.relative_to(ROOT).as_posix())

    with ZipFile(destination) as archive:
        if archive.testzip() is not None or set(archive.namelist()) != files:
            raise ValueError("Could not verify package contents")
    print(f"{destination} ({len(files)} files)")


if __name__ == "__main__":
    main()
