// src/modules/orders/interaction-workflow.instance.ts
// ─── InteractionWorkflowService singleton ────────────────────────────────────
// Callers that need the service instance (e.g. server actions) import from here.
// The barrel (interaction-workflow.service.ts) is a pure re-export — no class.

import {
  requestCancellation,
  respondToCancellation,
} from "./workflows/cancellation-workflow.service";
import {
  requestReturn,
  respondToReturn,
} from "./workflows/return-flow.service";
import {
  requestPartialRefund,
  respondToPartialRefund,
} from "./workflows/partial-refund-workflow.service";
import {
  notifyShippingDelay,
  respondToShippingDelay,
  getOrderInteractions,
} from "./workflows/shipping-delay-workflow.service";

export class InteractionWorkflowService {
  requestCancellation = requestCancellation;
  respondToCancellation = respondToCancellation;
  requestReturn = requestReturn;
  respondToReturn = respondToReturn;
  requestPartialRefund = requestPartialRefund;
  respondToPartialRefund = respondToPartialRefund;
  notifyShippingDelay = notifyShippingDelay;
  respondToShippingDelay = respondToShippingDelay;
  getOrderInteractions = getOrderInteractions;
}

export const interactionWorkflowService = new InteractionWorkflowService();
