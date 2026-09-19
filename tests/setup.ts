import { beforeAll } from "vitest";

beforeAll(() => {
  process.env.OPENAI_API_KEY = "sk-test-key-not-real";
  process.env.LOG_LEVEL = "error";
  process.env.MEMORY_ENABLED = "false";
});