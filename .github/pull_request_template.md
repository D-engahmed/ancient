## What changed?

## Why?

## Validation
- [ ] Tests
- [ ] Typecheck
- [ ] Build
- [ ] Security impact reviewed
- [ ] Tenant/auth boundaries reviewed
- [ ] Migration/rollback plan reviewed

## Production risk
Describe failure modes, data-integrity impact, and rollback behavior.

## Checklist
- [ ] No secrets committed
- [ ] No silent failure introduced
- [ ] API/client contract remains backward compatible or is versioned
- [ ] New background work is restart-safe
- [ ] Logs do not expose credentials or user data
