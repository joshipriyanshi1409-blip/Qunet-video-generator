---
name: Bug report
about: Something is broken or behaving unexpectedly
title: "[Bug] "
labels: bug
assignees: ""
---

## Describe the bug

A clear description of what is wrong.

## To reproduce

1. Go to ...
2. Click ...
3. See error

## Expected behaviour

What you expected to happen instead.

## Environment

| | |
| --- | --- |
| Browser / OS | |
| `NODE_ENV` | |
| Branch or tag | |
| Demo mode | yes / no |

## Logs

Paste the relevant API or worker output. Redact any key, token or email first.

```
paste here
```

## Which surface

- [ ] Web app (14 pages under `apps/web`)
- [ ] REST API (`apps/api`, `/api/v1`)
- [ ] WebSocket (`/ws`, `/ws/voice-coach`)
- [ ] Render worker (`apps/worker`)
- [ ] Shared schemas / prompts / render pipeline
- [ ] Deployment or CI

## Severity

- [ ] Blocking - cannot use the product
- [ ] Degraded - workaround exists
- [ ] Cosmetic
