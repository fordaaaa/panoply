| | Level | Meaning |
|:--:|:--|:--|
| 🔴 | Critical (5) | crashes, data loss, security vulnerability, broken core functionality |
| 🟠 | High (4) | real bug with clear user-facing impact, but not catastrophic |
| 🟡 | Medium (3) | logic error, meaningful perf issue, or maintainability hazard in an edge case |
| 🟢 | Low (2) | minor inefficiency, dead code, unclear error handling |
| ⚪ | Trivial (1) | style/naming/cleanup, no functional impact |

Every finding also carries a **confidence 1–10**. Report only 8+; drop the rest entirely rather than including them as caveats. A false positive costs the user more than a missed bug.
