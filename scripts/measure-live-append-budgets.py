"""Calibrate exact message hashes with two offline tokenizers (requires tiktoken).

Input: JSON object of message IDs to actual append content, emitted by
SPROUT_APPEND_BUDGET_INPUT=.sprout-evidence/append-input.json npm test -- tests/mae386-append-budget.test.ts
Output: tests/fixtures/mae386-append-token-budgets.json
Usage: python scripts/measure-live-append-budgets.py INPUT OUTPUT
These tokenizers are regression proxies, not the GPT-Live provider's exact counter.
"""
import hashlib
import json
import sys
from pathlib import Path
import tiktoken

messages = json.loads(Path(sys.argv[1]).read_text())
tokenizers = {name: tiktoken.get_encoding(name) for name in ("o200k_base", "cl100k_base")}
rows = {
    key: {
        "sha256": hashlib.sha256(content.encode()).hexdigest(),
        "tokens": {name: len(codec.encode(content)) for name, codec in tokenizers.items()},
    }
    for key, content in messages.items()
}
Path(sys.argv[2]).write_text(json.dumps({"tokenizers": list(tokenizers), "messages": rows}, indent=2) + "\n")
print(json.dumps({name: max(row["tokens"][name] for row in rows.values()) for name in tokenizers}))
