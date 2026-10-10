export const FIXO_MODELS = [
  { id: "qwen3.8-27b", label: "Qwen 3.8 27B", use: "General reasoning and coding", task: "general" },
  { id: "qwen3.8-flash", label: "Qwen 3.8 Flash", use: "Fast everyday responses", task: "fast" },
  { id: "kimi-k3", label: "Kimi K3", use: "Complex reasoning and coding", task: "reasoning" },
  { id: "qwen3.8-max-0902", label: "Qwen 3.8 Max 0902", use: "Demanding tasks", task: "reasoning" },
  { id: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", use: "Fast coding and reasoning", task: "fast" },
  { id: "glm-5.3", label: "GLM 5.3", use: "General reasoning and coding", task: "general" },
  { id: "deepseek-v4-pro-0813", label: "DeepSeek V4 Pro 0813", use: "Demanding reasoning tasks", task: "reasoning" },
  { id: "qwen3.8-2.4t-a95b", label: "Qwen 3.8 2.4T A95B", use: "Advanced tasks; verify provider support", task: "reasoning" },
  { id: "qwen-plus-character", label: "Qwen Plus Character", use: "Character-oriented conversation", task: "character" },
  { id: "qwen-flash-character", label: "Qwen Flash Character", use: "Fast character-oriented conversation", task: "character" },
] as const;

export type FixoModelId = (typeof FIXO_MODELS)[number]["id"];
export type FixoTask = "fast" | "general" | "reasoning" | "character";

export const FALLBACKS: Record<FixoTask, FixoModelId[]> = {
  fast: ["qwen3.8-flash", "deepseek-v4.1-flash", "qwen3.8-27b", "glm-5.3"],
  general: ["qwen3.8-27b", "glm-5.3", "deepseek-v4.1-flash", "kimi-k3"],
  reasoning: ["kimi-k3", "qwen3.8-max-0902", "deepseek-v4-pro-0813", "qwen3.8-2.4t-a95b", "qwen3.8-27b"],
  character: ["qwen-plus-character", "qwen-flash-character", "qwen3.8-flash"],
};

export function isFixoModelId(value: unknown): value is FixoModelId {
  return typeof value === "string" && FIXO_MODELS.some((model) => model.id === value);
}
