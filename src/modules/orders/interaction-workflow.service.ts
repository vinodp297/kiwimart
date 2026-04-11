// src/modules/orders/interaction-workflow.service.ts
// ─── Interaction Workflow Service — barrel re-export ─────────────────────────
// All workflow logic now lives in ./workflows/. This file re-exports every
// function so existing callers need no import changes.

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
