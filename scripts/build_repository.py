#!/usr/bin/env python3
"""apps-src/ 의 앱들을 .ipkg 로 묶고 저장소 인덱스를 다시 쓴다.

생성물:
  packages/<appId>/<version>.ipkg   패키지 (재현 가능한 ZIP)
  apps/<appId>.json                 NAPP-APP 문서 (다운로드 URL + SHA-256)
  icons/<appId>.png                 스토어 아이콘
  repository.json                   저장소 인덱스 (repository-meta.json 기반)

사용:
  python scripts/build_repository.py
  python scripts/build_repository.py --base-url https://raw.githubusercontent.com/<owner>/<repo>/main/
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import zipfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APPS_SRC = ROOT / "apps-src"
PACKAGES = ROOT / "packages"
APPS_JSON = ROOT / "apps"
ICONS = ROOT / "icons"
META = ROOT / "repository-meta.json"

DEFAULT_BASE_URL = "https://raw.githubusercontent.com/ILLIERTION/NAPP-Repository/main/"
ZIP_EPOCH = (1980, 1, 1, 0, 0, 0)
APP_ID = re.compile(r"^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)+$")
SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$")


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, document: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def semver_key(version: str) -> tuple:
    core = version.split("-")[0].split("+")[0]
    return tuple(int(part) for part in core.split("."))


def build_package(app_dir: Path, manifest: dict) -> Path:
    app_id = manifest["app"]["id"]
    version = manifest["app"]["version"]
    target = PACKAGES / app_id / f"{version}.ipkg"
    target.parent.mkdir(parents=True, exist_ok=True)

    entries = []
    for path in sorted(app_dir.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(app_dir).as_posix()
        if relative.startswith(".") or relative.startswith("publish.") or relative == "manifest.json":
            continue
        entries.append((relative, path.read_bytes()))

    if not any(name == "manifest.json" for name, _ in entries):
        entries.insert(0, ("manifest.json", (app_dir / "manifest.json").read_bytes()))
    if not any(name == manifest["metadata"]["icon"] for name, _ in entries):
        raise SystemExit(f"{app_id}: metadata icon missing ({manifest['metadata']['icon']})")

    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, payload in entries:
            info = zipfile.ZipInfo(name, date_time=ZIP_EPOCH)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, payload)
    return target


def version_entry(package: Path, publish: dict, platforms: list[str]) -> dict:
    data = package.read_bytes()
    version = package.stem
    released = publish.get("released", {}).get(version, date.today().isoformat())
    changelog = publish.get("changelog", {}).get(version, "")
    return {
        "release_date": released,
        "changelog": changelog,
        "platforms": platforms,
        "package": {
            "type": "web",
            "url": f"{BASE_URL}packages/{package.parent.name}/{package.name}",
            "sha256": hashlib.sha256(data).hexdigest(),
            "size": len(data),
        },
    }


def publish_app(app_dir: Path) -> dict:
    manifest = load(app_dir / "manifest.json")
    app = manifest["app"]
    app_id = app["id"]
    if not APP_ID.match(app_id):
        raise SystemExit(f"{app_id}: 잘못된 앱 ID")
    if not SEMVER.match(app["version"]):
        raise SystemExit(f"{app_id}: 잘못된 버전 {app['version']}")

    publish = load(app_dir / "publish.json") if (app_dir / "publish.json").is_file() else {}
    package = build_package(app_dir, manifest)

    icon_source = app_dir / manifest["metadata"]["icon"]
    ICONS.mkdir(parents=True, exist_ok=True)
    (ICONS / f"{app_id}.png").write_bytes(icon_source.read_bytes())

    platforms = manifest.get("platforms", ["windows-x64"])
    versions = {package.stem: version_entry(package, publish, platforms)}
    for other in sorted((PACKAGES / app_id).glob("*.ipkg")):
        if other.stem not in versions:
            versions[other.stem] = version_entry(other, publish, platforms)

    document = {
        "format": "NAPP-APP",
        "schema_version": 1,
        "app": {
            "id": app_id,
            "name": app["name"],
            "description": app["description"],
            "author": app["author"],
            "category": publish.get("category", "utilities"),
            "icon": f"{BASE_URL}icons/{app_id}.png",
            "license": app.get("license", "MIT"),
        },
        "compatibility": {
            "runtime": manifest.get("runtime", {}).get("type", "chromium"),
            "minimum_runtime_version": manifest.get("runtime", {}).get("minimum_version", "1.0.0"),
            "minimum_sdk_version": manifest.get("sdk", {}).get("minimum_version", "1.0.0"),
            "platforms": platforms,
        },
        "release": {"latest": app["version"], "versions": versions},
    }
    if publish.get("homepage"):
        document["app"]["homepage"] = publish["homepage"]

    write_json(APPS_JSON / f"{app_id}.json", document)

    return {
        "id": app_id,
        "manifest": f"apps/{app_id}.json",
        "category": publish.get("category", "utilities"),
        "featured": bool(publish.get("featured", False)),
        "latest": app["version"],
        "size": package.stat().st_size,
    }


def main() -> int:
    global BASE_URL

    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    arguments = parser.parse_args()
    BASE_URL = arguments.base_url if arguments.base_url.endswith("/") else arguments.base_url + "/"

    meta = load(META)
    app_entries = []
    for app_dir in sorted(path for path in APPS_SRC.iterdir() if (path / "manifest.json").is_file()):
        entry = publish_app(app_dir)
        app_entries.append(entry)
        print(f"packaged {entry['id']} v{entry['latest']} ({entry['size']} bytes)")

    index = {
        "format": "NAPP-REPOSITORY",
        "schema_version": 1,
        "repository": {
            "id": meta["id"],
            "name": meta["name"],
            "owner": meta["owner"],
            "description": meta.get("description", ""),
            "homepage": meta.get("homepage", ""),
        },
        "categories": "categories/categories.json",
        "apps": [
            {
                "id": entry["id"],
                "manifest": entry["manifest"],
                "category": entry["category"],
                "featured": entry["featured"],
            }
            for entry in app_entries
        ],
    }
    write_json(ROOT / "repository.json", index)

    print(f"\nrepository.json  {BASE_URL}repository.json")
    for entry in app_entries:
        print(f"app manifest     {BASE_URL}{entry['manifest']}")
    print(f"\n{len(app_entries)} app(s) published")
    return 0


if __name__ == "__main__":
    sys.exit(main())
