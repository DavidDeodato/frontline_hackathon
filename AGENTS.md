# Frontline project

This repository contains the Frontline product. Research experiments remain in a separate workspace and must not be bulk-copied here.

Before changing product behavior, read README.md, docs/product/solution.md, docs/product/style-guide.md and shared/API_CONTRACT.md. The design gallery in docs/visuals/ is a concept reference, not proof of implementation. Preserve the distinction between planned, implemented, tested and published behavior.

Use one shared scenario/rubric version for a session. Model output cannot override inventory, permissions, message limits or unknown deadlines. Assessment citations must occur in the stored transcript. Fixtures and synthetic data must remain labelled.

Keep secrets, runtime databases, private notes, account identifiers and bot sessions out of Git. Never copy real environment files or credentials into public documentation. Use .env.example with empty values.

Stage only reviewed files. Run git diff --check and checks appropriate to each change. Never publish unfinished concurrent writes, pretend a test passed, rewrite history, force push or create empty commits to satisfy a schedule. Sync incoming changes without overwriting collaborators. Changes to API contracts must be versioned and coordinated.

Public documentation explains the product, evidence and limitations. Do not include internal coordination transcripts or unrelated research instructions. External deployment, outgoing customer messages and paid model calls remain separate actions requiring applicable authorization.
