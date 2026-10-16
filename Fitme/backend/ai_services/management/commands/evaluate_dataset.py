"""Run the configured provider over dataset samples and report quality signals.

    python manage.py evaluate_dataset --limit 20 --occasion casual --out eval.json

Signals reported per sample:
  * ok / error_code      - whether the provider returned schema-valid output
  * latency_ms
  * target_hit           - heuristic: does any recommended text mention a
                           category the dataset's stylist actually recommended?
The target-hit rate is a rough proxy, not an accuracy score.
"""

import json
import time
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from ai_services.base import AnalysisRequest, ProviderError
from ai_services.dataset import iter_samples, target_keywords
from ai_services.providers import get_provider
from analyses.imaging import model_input
from analyses.models import Occasion


class Command(BaseCommand):
    help = "Evaluate the configured vision provider on the bundled outfit dataset."

    def add_arguments(self, parser):
        parser.add_argument("--dataset", default=str(settings.REPO_DIR / "dataset" / "000"))
        parser.add_argument("--limit", type=int, default=10)
        parser.add_argument("--occasion", choices=[c.value for c in Occasion], default="casual")
        parser.add_argument("--out", help="Write the per-sample report as JSON to this path.")
        parser.add_argument("--allow-mock", action="store_true", help="Permit running against the mock provider.")

    def handle(self, *args, **opts):
        provider = get_provider()
        if not provider.is_configured():
            raise CommandError("No AI provider configured. Set AI_PROVIDER=qwen and QWEN_* variables.")
        if provider.is_mock and not opts["allow_mock"]:
            raise CommandError("AI_PROVIDER=mock produces fixtures, not model output. Pass --allow-mock to run anyway.")

        root = Path(opts["dataset"])
        if not root.is_dir():
            raise CommandError(f"Dataset folder not found: {root}")

        occasion_label = Occasion(opts["occasion"]).label
        rows = []
        for sample in iter_samples(root, limit=opts["limit"]):
            row = {"key": sample.key, "targets": [t.get("subcategory") for t in sample.target_items]}
            started = time.monotonic()
            try:
                request = AnalysisRequest(
                    image_bytes=model_input(sample.image_path.read_bytes()),
                    image_mime="image/jpeg",
                    occasion=occasion_label,
                )
                result = provider.analyze(request)
            except ProviderError as exc:
                row.update(ok=False, error_code=exc.code, latency_ms=int((time.monotonic() - started) * 1000))
            else:
                data = result.data
                text = " ".join(
                    [data["primary_recommendation"]]
                    + [a["title"] + " " + a["description"] + " " + " ".join(a["items"]) for a in data["alternative_outfits"]]
                ).lower()
                keywords = set().union(*(target_keywords(t) for t in sample.target_items)) if sample.target_items else set()
                row.update(
                    ok=True,
                    latency_ms=result.latency_ms,
                    detected_items=[c["name"] for c in data["clothing_items"]],
                    target_hit=any(k in text for k in keywords) if keywords else None,
                    is_mock=result.is_mock,
                )
            rows.append(row)
            status = "ok " if row["ok"] else f"ERR {row['error_code']}"
            self.stdout.write(f"{sample.key}  {status}  {row['latency_ms']}ms  hit={row.get('target_hit')}")

        ok = [r for r in rows if r["ok"]]
        scored = [r for r in ok if r.get("target_hit") is not None]
        summary = {
            "provider": provider.name,
            "model": provider.model,
            "samples": len(rows),
            "valid_output_rate": round(len(ok) / len(rows), 3) if rows else None,
            "target_hit_rate": round(sum(r["target_hit"] for r in scored) / len(scored), 3) if scored else None,
            "median_latency_ms": sorted(r["latency_ms"] for r in ok)[len(ok) // 2] if ok else None,
        }
        self.stdout.write(self.style.SUCCESS(json.dumps(summary, indent=2)))
        if opts["out"]:
            Path(opts["out"]).write_text(json.dumps({"summary": summary, "samples": rows}, indent=2), encoding="utf-8")
