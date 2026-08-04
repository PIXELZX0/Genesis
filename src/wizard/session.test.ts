import { describe, expect, test } from "vitest";
import { WizardSession } from "./session.js";

function noteRunner() {
  return new WizardSession(async (prompter) => {
    await prompter.note("Welcome");
    const name = await prompter.text({ message: "Name" });
    await prompter.note(`Hello ${name}`);
  });
}

describe("WizardSession", () => {
  test("steps progress in order", async () => {
    const session = noteRunner();

    const first = await session.next();
    expect(first.done).toBe(false);
    expect(first.step?.type).toBe("note");

    const secondPeek = await session.next();
    expect(secondPeek.step?.id).toBe(first.step?.id);

    if (!first.step) {
      throw new Error("expected first step");
    }
    await session.answer(first.step.id, null);

    const second = await session.next();
    expect(second.done).toBe(false);
    expect(second.step?.type).toBe("text");

    if (!second.step) {
      throw new Error("expected second step");
    }
    await session.answer(second.step.id, "Peter");

    const third = await session.next();
    expect(third.step?.type).toBe("note");

    if (!third.step) {
      throw new Error("expected third step");
    }
    await session.answer(third.step.id, null);

    const done = await session.next();
    expect(done.done).toBe(true);
    expect(done.status).toBe("done");
  });

  test("invalid answers throw", async () => {
    const session = noteRunner();
    const first = await session.next();
    await expect(session.answer("bad-id", null)).rejects.toThrow(/wizard: no pending step/i);
    if (!first.step) {
      throw new Error("expected first step");
    }
    await session.answer(first.step.id, null);
  });

  test("re-prompts invalid text answers with an actionable server step", async () => {
    const session = new WizardSession(async (prompter) => {
      await prompter.text({
        message: "API Base URL",
        initialValue: "https://example.com/v1",
        validate: (value) =>
          value.startsWith("http://") || value.startsWith("https://")
            ? undefined
            : "Enter an http:// or https:// URL",
      });
    });

    const first = await session.next();
    expect(first.step?.type).toBe("text");
    if (!first.step) {
      throw new Error("expected first text step");
    }

    await session.answer(first.step.id, "not-a-url");
    const retry = await session.next();

    expect(retry.done).toBe(false);
    expect(retry.step).toMatchObject({
      type: "text",
      title: "Invalid input",
      message: "API Base URL\nEnter an http:// or https:// URL",
      initialValue: "not-a-url",
    });

    if (!retry.step) {
      throw new Error("expected retry text step");
    }
    await session.answer(retry.step.id, "https://example.com/v1");

    const done = await session.next();
    expect(done).toMatchObject({ done: true, status: "done" });
  });

  test("does not echo invalid sensitive text in the retry step", async () => {
    const invalidToken = "invalid-token";
    const session = new WizardSession(async (prompter) => {
      await prompter.text({
        message: "API token",
        sensitive: true,
        validate: (value) => (value === "valid-token" ? undefined : "Token is invalid"),
      });
    });

    const first = await session.next();
    if (!first.step) {
      throw new Error("expected first text step");
    }

    await session.answer(first.step.id, invalidToken);
    const retry = await session.next();

    expect(retry.step).toMatchObject({
      type: "text",
      sensitive: true,
      initialValue: "",
    });
    expect(JSON.stringify(retry.step)).not.toContain(invalidToken);

    if (!retry.step) {
      throw new Error("expected retry text step");
    }
    await session.answer(retry.step.id, "valid-token");

    expect(await session.next()).toMatchObject({ done: true, status: "done" });
  });

  test("cancel marks session and unblocks", async () => {
    const session = new WizardSession(async (prompter) => {
      await prompter.text({ message: "Name" });
    });

    const step = await session.next();
    expect(step.step?.type).toBe("text");

    session.cancel();

    const done = await session.next();
    expect(done.done).toBe(true);
    expect(done.status).toBe("cancelled");
  });

  test("does not lose terminal completion when the last answer finishes the runner immediately", async () => {
    const session = new WizardSession(async (prompter) => {
      await prompter.text({ message: "Token" });
    });

    const first = await session.next();
    expect(first.step?.type).toBe("text");
    if (!first.step) {
      throw new Error("expected first step");
    }

    await session.answer(first.step.id, "ok");
    await Promise.resolve();

    const done = await session.next();
    expect(done.done).toBe(true);
    expect(done.status).toBe("done");
  });
});
