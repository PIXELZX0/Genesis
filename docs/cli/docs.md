---
summary: "CLI reference for `genesis docs` (search the live docs index)"
read_when:
  - You want to search the live Genesis docs from the terminal
title: "Docs"
---

# `genesis docs`

Search the live docs index.

Arguments:

- `[query...]`: search terms to send to the live docs index

Examples:

```bash
genesis docs
genesis docs browser existing-session
genesis docs sandbox allowHostControl
genesis docs gateway token secretref
```

Notes:

- With no query, `genesis docs` opens the live docs search entrypoint.
- Multi-word queries are passed through as one search request.

## Related

- [CLI reference](/cli)
