// src/modules/orders/interaction-workflow.service.ts
// ─── Interaction Workflow Service — pure barrel re-export ────────────────────
// All workflow logic lives in ./workflows/. This file re-exports every
// function so callers that import individual functions need no changes.
//
// The InteractionWorkflowService class and singleton live in:
//   ./interaction-workflow.instance.ts
// Import from there if you need the service object (e.g. server actions).

export {
  requestCancellation,
  respondToCancellation,
} from "./workflows/cancellation-workflow.service";

export {
  requestReturn,
  respondToReturn,
} from "./workflows/return-flow.service";

export {
  requestPartialRefund,
  respondToPartialRefund,
} from "./workflows/partial-refund-workflow.service";

export {
  notifyShippingDelay,
  respondToShippingDelay,
  getOrderInteractions,
} from "./workflows/shipping-delay-workflow.service";
