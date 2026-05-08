import { randomUUID } from "node:crypto";
import { normalizeAnyChannelId } from "../../channels/registry.js";
import { readConfigFileSnapshot } from "../../config/config.js";
import type { GenesisConfig } from "../../config/types.genesis.js";
import { defaultRuntime } from "../../runtime.js";
import { readStringValue } from "../../shared/string-coerce.js";
import type { WizardPrompter } from "../../wizard/prompts.js";
import { WizardSession } from "../../wizard/session.js";
import {
  ErrorCodes,
  errorShape,
  validateWizardCancelParams,
  validateWizardNextParams,
  validateWizardStartParams,
  validateWizardStatusParams,
} from "../protocol/index.js";
import { formatForLog } from "../ws-log.js";
import type { GatewayRequestContext, GatewayRequestHandlers, RespondFn } from "./types.js";
import { assertValidParams } from "./validation.js";

async function runChannelsWizard(params: { channel?: unknown; prompter: WizardPrompter }) {
  await params.prompter.intro("Channel setup");
  const snapshot = await readConfigFileSnapshot();
  if (snapshot.exists && !snapshot.valid) {
    throw new Error("config invalid; fix it before running channel setup");
  }
  const rawChannel = readStringValue(params.channel);
  const initialChannel = rawChannel ? normalizeAnyChannelId(rawChannel) : null;
  if (rawChannel && !initialChannel) {
    throw new Error(`unknown channel: ${rawChannel}`);
  }
  const { runInteractiveChannelsAddWizard } = await import("../../flows/channel-add-wizard.js");
  await runInteractiveChannelsAddWizard({
    cfg: (snapshot.sourceConfig ?? snapshot.config ?? {}) as GenesisConfig,
    ...(snapshot.hash !== undefined ? { baseHash: snapshot.hash } : {}),
    runtime: defaultRuntime,
    prompter: params.prompter,
    skipIntro: true,
    ...(initialChannel ? { initialSelection: [initialChannel] } : {}),
  });
}

async function runModelsWizard(params: {
  provider?: unknown;
  authMethod?: unknown;
  setDefault?: unknown;
  prompter: WizardPrompter;
}) {
  await params.prompter.intro("Model provider setup");
  const { runModelProviderWizard } = await import("./wizard-models.js");
  await runModelProviderWizard({
    provider: params.provider,
    authMethod: params.authMethod,
    setDefault: params.setDefault,
    prompter: params.prompter,
    skipIntro: true,
  });
}

function readWizardStatus(session: WizardSession) {
  return {
    status: session.getStatus(),
    error: session.getError(),
  };
}

function findWizardSessionOrRespond(params: {
  context: GatewayRequestContext;
  respond: RespondFn;
  sessionId: string;
}): WizardSession | null {
  const session = params.context.wizardSessions.get(params.sessionId);
  if (!session) {
    params.respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "wizard not found"));
    return null;
  }
  return session;
}

export const wizardHandlers: GatewayRequestHandlers = {
  "wizard.start": async ({ params, respond, context }) => {
    if (!assertValidParams(params, validateWizardStartParams, "wizard.start", respond)) {
      return;
    }
    const running = context.findRunningWizard();
    if (running) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "wizard already running"));
      return;
    }
    const sessionId = randomUUID();
    const target = params.target ?? "setup";
    const session = new WizardSession((prompter) => {
      if (target === "channels") {
        return runChannelsWizard({ channel: params.channel, prompter });
      }
      if (target === "models") {
        return runModelsWizard({
          provider: params.provider,
          authMethod: params.authMethod,
          setDefault: params.setDefault,
          prompter,
        });
      }
      const opts = {
        mode: params.mode,
        workspace: readStringValue(params.workspace),
      };
      return context.wizardRunner(opts, defaultRuntime, prompter);
    });
    context.wizardSessions.set(sessionId, session);
    const result = await session.next();
    if (result.done) {
      context.purgeWizardSession(sessionId);
    }
    respond(true, { sessionId, ...result }, undefined);
  },
  "wizard.next": async ({ params, respond, context }) => {
    if (!assertValidParams(params, validateWizardNextParams, "wizard.next", respond)) {
      return;
    }
    const sessionId = params.sessionId;
    const session = findWizardSessionOrRespond({ context, respond, sessionId });
    if (!session) {
      return;
    }
    const answer = params.answer as { stepId?: string; value?: unknown } | undefined;
    if (answer) {
      if (session.getStatus() !== "running") {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "wizard not running"));
        return;
      }
      try {
        await session.answer(answer.stepId ?? "", answer.value);
      } catch (err) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, formatForLog(err)));
        return;
      }
    }
    const result = await session.next();
    if (result.done) {
      context.purgeWizardSession(sessionId);
    }
    respond(true, result, undefined);
  },
  "wizard.cancel": ({ params, respond, context }) => {
    if (!assertValidParams(params, validateWizardCancelParams, "wizard.cancel", respond)) {
      return;
    }
    const sessionId = params.sessionId;
    const session = findWizardSessionOrRespond({ context, respond, sessionId });
    if (!session) {
      return;
    }
    session.cancel();
    const status = readWizardStatus(session);
    context.wizardSessions.delete(sessionId);
    respond(true, status, undefined);
  },
  "wizard.status": ({ params, respond, context }) => {
    if (!assertValidParams(params, validateWizardStatusParams, "wizard.status", respond)) {
      return;
    }
    const sessionId = params.sessionId;
    const session = findWizardSessionOrRespond({ context, respond, sessionId });
    if (!session) {
      return;
    }
    const status = readWizardStatus(session);
    if (status.status !== "running") {
      context.wizardSessions.delete(sessionId);
    }
    respond(true, status, undefined);
  },
};
