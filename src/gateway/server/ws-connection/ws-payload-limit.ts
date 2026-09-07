import type { WebSocket } from "ws";

type PayloadLimited = { _maxPayload?: number };
const PERMESSAGE_DEFLATE_EXTENSION = "permessage-deflate";

/**
 * Raises the post-auth frame limit on the ws receiver and, when permessage-deflate is
 * negotiated, on the extension too: the extension checks inflated size against its own
 * copy of the server maxPayload, so raising only the receiver would still reject
 * compressed authenticated frames above the preauth cap.
 */
export function setSocketMaxPayload(socket: WebSocket, maxPayload: number): void {
  // SAFETY: ws owns these private per-frame fields; both are plain writable properties.
  const receiver = (
    socket as {
      _receiver?: PayloadLimited & { _extensions?: Record<string, PayloadLimited | undefined> };
    }
  )._receiver;
  if (!receiver) {
    return;
  }
  receiver._maxPayload = maxPayload;
  const deflate = receiver._extensions?.[PERMESSAGE_DEFLATE_EXTENSION];
  if (deflate) {
    deflate._maxPayload = maxPayload;
  }
}
