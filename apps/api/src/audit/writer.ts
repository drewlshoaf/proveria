// Audit writer — thin re-export of @proveria/audit's writeAuditEvent so
// existing call sites keep working. The shared package handles the
// Enterprise hash-chain append (docs/v1 §19.4) automatically.

export { writeAuditEvent, type WriteAuditEventInput } from '@proveria/audit';
