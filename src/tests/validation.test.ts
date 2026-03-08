/**
 * Tests for validation utilities
 *
 * Run: npm run test:validation
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateName } from "../cli/utils/validation.js";

describe("validateName", () => {
  // Valid names
  it("accepts simple lowercase name", () => {
    assert.equal(validateName("myagent", "Agent ID"), "myagent");
  });

  it("accepts name with hyphens", () => {
    assert.equal(validateName("my-agent", "Agent ID"), "my-agent");
  });

  it("accepts name with numbers", () => {
    assert.equal(validateName("agent1", "Agent ID"), "agent1");
  });

  it("accepts name with hyphens and numbers", () => {
    assert.equal(validateName("my-agent-123", "Agent ID"), "my-agent-123");
  });

  it("accepts single letter", () => {
    assert.equal(validateName("a", "Agent ID"), "a");
  });

  it("accepts long valid name", () => {
    assert.equal(validateName("a-very-long-agent-name-with-numbers-123", "Agent ID"), "a-very-long-agent-name-with-numbers-123");
  });

  // Invalid names
  it("rejects name starting with number", () => {
    assert.throws(() => validateName("1agent", "Agent ID"), /lowercase/);
  });

  it("rejects name starting with hyphen", () => {
    assert.throws(() => validateName("-agent", "Agent ID"), /lowercase/);
  });

  it("rejects uppercase letters", () => {
    assert.throws(() => validateName("MyAgent", "Agent ID"), /lowercase/);
  });

  it("rejects mixed case", () => {
    assert.throws(() => validateName("myAgent", "Agent ID"), /lowercase/);
  });

  it("rejects underscores", () => {
    assert.throws(() => validateName("my_agent", "Agent ID"), /lowercase/);
  });

  it("rejects dots", () => {
    assert.throws(() => validateName("my.agent", "Agent ID"), /lowercase/);
  });

  it("rejects spaces", () => {
    assert.throws(() => validateName("my agent", "Agent ID"), /lowercase/);
  });

  it("rejects empty string", () => {
    assert.throws(() => validateName("", "Agent ID"), /lowercase/);
  });

  it("rejects special characters", () => {
    assert.throws(() => validateName("agent@home", "Agent ID"), /lowercase/);
  });

  it("includes label in error message", () => {
    assert.throws(
      () => validateName("BAD", "Skill name"),
      (err: any) => err.message.includes("Skill name")
    );
  });
});
