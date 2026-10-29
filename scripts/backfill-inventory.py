#!/usr/bin/env python3
"""Extract discovery leads from a complete Models.dev Git clone, never release facts."""

import argparse
import collections
import datetime as dt
import json
import pathlib
import posixpath
import re
import subprocess
import tempfile
import tomllib
import urllib.parse


ROOT = pathlib.Path(__file__).resolve().parents[1]
UPSTREAM = "https://github.com/anomalyco/models.dev"


def git(repo, *args):
    return subprocess.check_output(["git", f"--git-dir={repo}", *args], text=True)


def source_url(commit, path):
    return f"{UPSTREAM}/blob/{commit}/{urllib.parse.quote(path, safe='/')}"


def normalized(value):
    return re.sub(r"[^a-z0-9]", "", value.lower())


def write_json(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def read_json(path, default):
    return json.loads(path.read_text()) if path.exists() else default


def month_range(start, end):
    year, month = map(int, start.split("-"))
    while f"{year:04}-{month:02}" <= end:
        yield f"{year:04}-{month:02}"
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)


def extract(repo, ref):
    head = git(repo, "rev-parse", ref).strip()
    tree = {}
    for line in git(repo, "ls-tree", "-r", head, "models", "providers").splitlines():
        metadata, path = line.split("\t", 1)
        if path.endswith(".toml") and (path.startswith("models/") or "/models/" in path):
            tree[path] = metadata.split()[2]

    paths = collections.defaultdict(dict)
    blob_sources = {}
    changed_commits = set()
    process = subprocess.Popen(
        ["git", f"--git-dir={repo}", "log", "--full-history", "--root", "--no-renames", "-m",
         "--raw", "--no-abbrev", "--format=COMMIT %H %aI", head, "--", "models", "providers"],
        stdout=subprocess.PIPE, text=True,
    )
    for line in process.stdout:
        if line.startswith("COMMIT "):
            _, commit, date = line.split()
        elif line.startswith(":"):
            metadata, path = line.rstrip("\n").split("\t", 1)
            fields = metadata.split()
            if not path.endswith(".toml") or not (path.startswith("models/") or "/models/" in path):
                continue
            blob = fields[3]
            if blob == "0" * 40:
                continue
            changed_commits.add(commit)
            observation = {"commit": commit, "observed_at": date}
            paths[path].setdefault(blob, observation)
            blob_sources.setdefault(blob, {**observation, "path": path})
    if process.wait():
        raise RuntimeError("Git history traversal failed")

    data = {}
    failures = []
    symlink_blobs = 0
    with tempfile.TemporaryFile() as requests:
        requests.write(("\n".join(blob_sources) + "\n").encode())
        requests.seek(0)
        process = subprocess.Popen(
            ["git", f"--git-dir={repo}", "cat-file", "--batch"],
            stdin=requests, stdout=subprocess.PIPE,
        )
        while header := process.stdout.readline():
            blob, kind, size = header.decode().split()
            if kind != "blob":
                raise RuntimeError(f"Expected blob, received {kind}")
            raw = process.stdout.read(int(size)).decode()
            process.stdout.read(1)
            if re.fullmatch(r"[\w./@:+~-]+\.toml\s*", raw):
                parsed = {"symlink_target": raw.strip()}
                symlink_blobs += 1
            else:
                try:
                    parsed = tomllib.loads(raw)
                except tomllib.TOMLDecodeError as error:
                    parsed = {"parse_error": str(error)}
                    failures.append({**blob_sources[blob], "error": str(error),
                                     "source_url": source_url(blob_sources[blob]["commit"], blob_sources[blob]["path"])})
                    # Keep explicitly quoted identity/date leads despite unrelated invalid TOML.
                    for key in ("name", "release_date", "base_model", "family"):
                        match = re.search(rf'^\s*{key}\s*=\s*"([^"\n]+)"', raw, re.MULTILINE)
                        if match:
                            parsed[key] = match.group(1)
            data[blob] = {key: parsed[key] for key in
                          ("name", "release_date", "base_model", "family", "open_weights", "modalities", "symlink_target", "parse_error")
                          if key in parsed}
            data[blob]["links"] = sorted(set(re.findall(r'https?://[^\s<>"\[\]{}]+', raw)))
        if process.wait():
            raise RuntimeError("Git blob extraction failed")

    records = {}
    for path, versions in paths.items():
        current = tree.get(path)
        latest_blob = current or next(iter(versions))
        latest = data[latest_blob]
        names, bases, links, dates, outputs, access, targets = set(), set(), set(), {}, set(), set(), set()
        for blob, observation in versions.items():
            state = data[blob]
            if state.get("name"):
                names.add(state["name"])
            if state.get("base_model"):
                bases.add(state["base_model"])
            if state.get("symlink_target"):
                targets.add(posixpath.normpath(posixpath.join(posixpath.dirname(path), state["symlink_target"])))
            links.update(state["links"])
            date = str(state.get("release_date", ""))
            if date:
                dates.setdefault(date, {"date": date, "source_url": source_url(observation["commit"], path)})
            outputs.update(state.get("modalities", {}).get("output", []))
            if isinstance(state.get("open_weights"), bool):
                access.add("open" if state["open_weights"] else "closed")
        observation = versions[latest_blob]
        records[path] = {
            "path": path,
            "name": latest.get("name") or (sorted(names)[0] if names else pathlib.PurePosixPath(path).stem),
            "names": sorted(names),
            "current": current is not None,
            "source_url": source_url(head if current else observation["commit"], path),
            "latest_date_claim": str(latest["release_date"]) if latest.get("release_date") else None,
            "date_claims": sorted(dates.values(), key=lambda x: x["date"]),
            "base_models": sorted(bases),
            "symlink_targets": sorted(targets),
            "output_modalities": sorted(outputs),
            "access_claims": sorted(access),
            "source_links": sorted(links),
        }

    def resolved_bases(path, seen=None):
        seen = (seen or set()) | {path}
        record = records.get(path, {})
        result = set(record.get("base_models", []))
        if path.startswith("models/"):
            result.add(path.removeprefix("models/").removesuffix(".toml"))
        for target in record.get("symlink_targets", []):
            if target not in seen:
                result.update(resolved_bases(target, seen))
        return result

    for path, record in records.items():
        record["base_models"] = sorted(resolved_bases(path))
    return head, tree, records, failures, {
        "reachable_commits": int(git(repo, "rev-list", "--count", head)),
        "commits_changing_model_files": len(changed_commits),
        "model_blob_versions_read": len(data),
        "symlink_blob_versions": symlink_blobs,
        "invalid_toml_blob_versions": len(failures),
    }


def build(args):
    destination = pathlib.Path(args.output)
    destination.mkdir(parents=True, exist_ok=True)
    catalog = json.loads((ROOT / "data/catalog.json").read_text())
    corrections = json.loads((ROOT / "data/corrections.json").read_text())
    catalog_ids = {row["id"] for row in catalog}
    catalog_names = collections.defaultdict(set)
    for row in catalog:
        catalog_names[normalized(row["name"])].add(row["id"])
    aliases = dict(corrections.get("aliases", {}))
    for row in catalog:
        for alias in row.get("aliases", []):
            if isinstance(alias, str):
                aliases[alias] = row["id"]
    excluded = corrections.get("exclude", {})
    head, tree, records, failures, counts = extract(args.repo, args.ref)
    generated_at = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    canonical = []
    canonical_ids = {path.removeprefix("models/").removesuffix(".toml")
                     for path in records if path.startswith("models/")}
    canonical_names = collections.defaultdict(set)
    for path, record in records.items():
        if path.startswith("models/"):
            model_id = path.removeprefix("models/").removesuffix(".toml")
            for name in record["names"]:
                canonical_names[normalized(name)].add(model_id)

    def matches(model_id, names):
        exact = model_id if model_id in catalog_ids else aliases.get(model_id)
        probable = set().union(*(catalog_names[normalized(name)] for name in names)) if names else set()
        return exact, sorted(probable - {exact})

    def scope(record):
        return "text_output_claimed" if "text" in record["output_modalities"] else (
            "other_output_claimed" if record["output_modalities"] else "unspecified")

    for path, record in sorted(records.items()):
        if not path.startswith("models/"):
            continue
        model_id = path.removeprefix("models/").removesuffix(".toml")
        exact, probable = matches(model_id, record["names"])
        row = {
            "id": model_id, "publisher": model_id.split("/")[0], "name": record["name"],
            "upstream_status": "current" if record["current"] else "removed_from_catalog",
            "catalog_status": "catalogued" if exact else ("excluded" if model_id in excluded else "not_catalogued"),
            "catalog_id": exact, "possible_catalog_matches": probable,
            "scope_lead": scope(record), "date_claim": record["latest_date_claim"],
            "date_claims": record["date_claims"], "access_claims": record["access_claims"],
            "source_url": record["source_url"], "source_links": record["source_links"],
        }
        if model_id in excluded:
            row["exclusion"] = excluded[model_id]
        canonical.append(row)

    provider_groups = collections.defaultdict(list)
    bindings = []
    for path, record in sorted(records.items()):
        if path.startswith("models/"):
            continue
        provider, key = path.removeprefix("providers/").removesuffix(".toml").split("/models/", 1)
        if record["base_models"]:
            bindings.append({"provider": provider, "model_key": key, "current": record["current"],
                             "base_models": record["base_models"], "source_url": record["source_url"]})
        else:
            provider_groups[key.lower()].append({**record, "provider": provider, "model_key": key})

    provider_candidates = []
    for key, group in sorted(provider_groups.items()):
        names = sorted({name for record in group for name in record["names"]})
        exact, probable = matches(key, names)
        possible_canonical = set().union(*(canonical_names[normalized(name)] for name in names)) if names else set()
        direct = key if key in canonical_ids else None
        dates = {}
        for record in group:
            for claim in record["date_claims"]:
                dates.setdefault(claim["date"], claim)
        outputs = {item for record in group for item in record["output_modalities"]}
        latest_dates = sorted({record["latest_date_claim"] for record in group if record["latest_date_claim"]})
        provider_candidates.append({
            "id": "provider-key:" + key, "model_key": key,
            "names": names, "providers": sorted({record["provider"] for record in group}),
            "current": any(record["current"] for record in group),
            "catalog_status": "catalogued" if exact else ("excluded" if key in excluded else "unresolved_identity"),
            "catalog_id": exact, "possible_catalog_matches": probable,
            "canonical_id": direct, "possible_canonical_matches": sorted(possible_canonical - {direct}),
            "scope_lead": "text_output_claimed" if "text" in outputs else ("other_output_claimed" if outputs else "unspecified"),
            "date_claims": sorted(dates.values(), key=lambda row: row["date"]),
            "latest_date_claims": latest_dates,
            "access_claims": sorted({value for record in group for value in record["access_claims"]}),
            "distribution_or_alias_hint": bool(re.search(r"(?:latest|:free|:thinking|:high|:low|(?:^|[-_/])(gguf|gptq|awq|fp16|fp8|bf16|int8|q[2-8])(?:[-_/]|$))", key)),
            "records": [{"provider": record["provider"], "model_key": record["model_key"],
                         "current": record["current"], "source_url": record["source_url"]} for record in group],
        })

    outstanding = [row for row in canonical if row["catalog_status"] == "not_catalogued" and row["scope_lead"] != "other_output_claimed"]
    unresolved = [row for row in provider_candidates if row["catalog_status"] == "unresolved_identity" and not row["canonical_id"] and row["scope_lead"] != "other_output_claimed"]
    by_month = collections.defaultdict(set)
    for row in outstanding:
        for claim in row["date_claims"]:
            if re.fullmatch(r"\d{4}-\d{2}(?:-\d{2})?", claim["date"]):
                by_month[claim["date"][:7]].add(row["id"])
    provider_by_month = collections.defaultdict(set)
    for row in unresolved:
        for claim in row["date_claims"]:
            if re.fullmatch(r"\d{4}-\d{2}(?:-\d{2})?", claim["date"]):
                provider_by_month[claim["date"][:7]].add(row["id"])
    catalog_by_month = collections.Counter(str(row.get("release_date", ""))[:7] for row in catalog)
    existing_coverage = read_json(destination / "coverage.json", {})
    existing_months = {row["month"]: row for row in existing_coverage.get("months", [])}
    months = []
    for month in month_range(args.start, args.end):
        previous = existing_months.get(month, {})
        months.append({
            **previous, "month": month, "status": previous.get("status", "unreviewed"),
            "primary_sources_checked": previous.get("primary_sources_checked", []),
            "outstanding_candidates": len(by_month[month]) + len(provider_by_month[month]),
            "outstanding_canonical_candidates": len(by_month[month]),
            "outstanding_provider_identity_groups": len(provider_by_month[month]),
            "catalogued_releases": catalog_by_month[month],
            "last_reviewed": previous.get("last_reviewed"),
        })
    coverage = {
        "schema_version": "1.0", "updated_at": generated_at,
        "window": {"from": args.start, "through": args.end},
        "definition": "Audited means the prescribed source and publisher review was completed and its unresolved gaps recorded. It does not mean every release is known.",
        "limitations": "Candidate counts include unverified upstream date claims and provider identity groups, not additional confirmed releases. One candidate may appear in several months when dates conflict. Counts exclude non-text output leads; those remain in the research inventory. Inventory extraction alone does not change audit status.",
        "months": months,
    }
    roots = git(args.repo, "rev-list", "--max-parents=0", head).splitlines()
    metadata = {
        "schema_version": "1.0", "generated_at": generated_at,
        "upstream": {"repository": UPSTREAM, "ref": head,
                     "commit_date": git(args.repo, "show", "-s", "--format=%cI", head).strip(),
                     "roots": [{"commit": root, "date": git(args.repo, "show", "-s", "--format=%aI", root).strip()} for root in roots],
                     "history_scope": "Every commit reachable from the pinned ref, including merge-parent changes. Other branches, pull-request-only refs, deleted unreachable history and unpublished models are outside this snapshot."},
        "catalog_snapshot": {"repository_commit": git(str(ROOT / ".git"), "rev-parse", "HEAD").strip(), "records": len(catalog)},
        "counts": {**counts, "canonical_current": sum(row["upstream_status"] == "current" for row in canonical),
                   "canonical_historical_paths": len(canonical), "canonical_not_catalogued_text_or_unspecified": len(outstanding),
                   "provider_historical_paths": sum(not path.startswith("models/") for path in records),
                   "provider_explicit_bindings": len(bindings), "provider_identity_groups": len(provider_candidates),
                   "unresolved_provider_text_or_unspecified_groups": len(unresolved)},
        "canonical_catalog_status": dict(collections.Counter(row["catalog_status"] for row in canonical)),
        "canonical_missing_by_publisher": dict(sorted(collections.Counter(row["publisher"] for row in outstanding).items())),
        "canonical_missing_by_access_claim": dict(collections.Counter("/".join(row["access_claims"]) or "unspecified" for row in outstanding)),
        "outstanding_by_claimed_month": {month: {"canonical_candidates": len(by_month[month]), "provider_identity_groups": len(provider_by_month[month])}
                                         for month in sorted(set(by_month) | set(provider_by_month))},
        "provider_groups_by_provider": dict(sorted(collections.Counter(provider for row in unresolved for provider in row["providers"]).items())),
        "provider_groups_by_access_claim": dict(collections.Counter("/".join(row["access_claims"]) or "unspecified" for row in unresolved)),
        "binding_targets_without_canonical_record": sorted({target for binding in bindings for target in binding["base_models"] if target not in canonical_ids}),
        "canonical_missing_without_date_claim": [row["id"] for row in outstanding if not row["date_claims"]],
        "unresolved_provider_groups_without_date_claim": [row["id"] for row in unresolved if not row["date_claims"]],
        "deduplication": "Explicit base_model and symbolic-link bindings are grouped with their named canonical models. Unmapped provider rows are grouped only by exact case-insensitive provider model key for review, not asserted to be independent releases. Exact catalog IDs and curated aliases count as catalog matches. Name similarities, precision variants and mutable aliases are leads only; dated versions are retained.",
        "limitations": [
            "The upstream repository begins in June 2025 and is an inference-provider catalog. It does not establish historical completeness for 2022–2024 or later months.",
            "Release dates, access and modalities are unverified claims. Some historical dates are demonstrably inconsistent across providers; no claim is imported into published model data by this script.",
            "Removal from Models.dev does not establish model retirement or invalidity.",
            "Provider bindings can change over time. All observed base-model targets are retained; equivalence at a particular launch date still needs primary evidence.",
            "Non-text models and invalid historical TOML remain recorded for scope/parser review. Quoted identity/date fields are recovered from invalid TOML but are never promoted to release facts.",
            "The root models.json snapshot is not the current canonical model registry; extraction uses models and providers TOML history.",
        ],
    }
    write_json(destination / "models-dev-snapshot.json", metadata)
    write_json(destination / "models-dev-candidates.json", canonical)
    write_json(destination / "models-dev-provider-candidates.json", provider_candidates)
    with (destination / "models-dev-bindings.jsonl").open("w") as handle:
        for row in bindings:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
    write_json(destination / "models-dev-parse-errors.json", failures)
    write_json(destination / "coverage.json", coverage)
    subprocess.run(["node", str(ROOT / "scripts/reconcile-backfill.mjs"), str(destination)], check=True)
    print(json.dumps(metadata["counts"], indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, help="Path to a complete bare Models.dev clone")
    parser.add_argument("--ref", default="HEAD")
    parser.add_argument("--output", default=str(ROOT / "research/backfill"))
    parser.add_argument("--start", default="2022-01")
    parser.add_argument("--end", default="2026-10")
    build(parser.parse_args())
