import type { WizardSession } from "../wizard/session.js";

// A client that abandons the wizard dialog (tab close, refresh, dropped
// connection) never calls wizard.cancel, so the session would otherwise sit
// in "running" forever and block every future wizard.start.
const STALE_WIZARD_IDLE_MS = 10 * 60 * 1000;

export function createWizardSessionTracker() {
  const wizardSessions = new Map<string, WizardSession>();

  const findRunningWizard = (): string | null => {
    for (const [id, session] of wizardSessions) {
      if (session.getStatus() !== "running") {
        continue;
      }
      if (session.idleMs() > STALE_WIZARD_IDLE_MS) {
        session.cancel();
        wizardSessions.delete(id);
        continue;
      }
      return id;
    }
    return null;
  };

  const purgeWizardSession = (id: string) => {
    const session = wizardSessions.get(id);
    if (!session) {
      return;
    }
    if (session.getStatus() === "running") {
      return;
    }
    wizardSessions.delete(id);
  };

  return { wizardSessions, findRunningWizard, purgeWizardSession };
}
