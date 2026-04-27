import { resolveApprovalOverGateway } from "genesis/plugin-sdk/approval-gateway-runtime";
import type { ExecApprovalReplyDecision } from "genesis/plugin-sdk/approval-runtime";
import type { GenesisConfig } from "genesis/plugin-sdk/config-runtime";
import { isApprovalNotFoundError } from "genesis/plugin-sdk/error-runtime";

export { isApprovalNotFoundError };

export async function resolveMatrixApproval(params: {
  cfg: GenesisConfig;
  approvalId: string;
  decision: ExecApprovalReplyDecision;
  senderId?: string | null;
  gatewayUrl?: string;
}): Promise<void> {
  await resolveApprovalOverGateway({
    cfg: params.cfg,
    approvalId: params.approvalId,
    decision: params.decision,
    senderId: params.senderId,
    gatewayUrl: params.gatewayUrl,
    clientDisplayName: `Matrix approval (${params.senderId?.trim() || "unknown"})`,
  });
}
