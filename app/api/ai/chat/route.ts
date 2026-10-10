import { NextResponse } from "next/server";
import { FALLBACKS, FIXO_MODELS, isFixoModelId, type FixoModelId, type FixoTask } from "@/lib/ai/models";

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

const FINANCE_SYSTEM_PROMPT = `You are Fixo AI, an educational financial research assistant focused on Indian markets. Explain assumptions, uncertainty, and data freshness. Do not claim to have live prices unless they are supplied in the conversation. Do not guarantee returns or present speculative outputs as facts. This product supports paper trading only; never claim to place real-money trades. Provide educational information, not personalized investment advice.`;

function candidates(task: FixoTask, requested?: FixoModelId): FixoModelId[] {
  const ordered = requested ? [requested, ...FALLBACKS[task]] : FALLBACKS[task];
  return [...new Set(ordered)];
}

export async function GET() {
  return NextResponse.json({
    service: "Fixo AI",
    configured: Boolean(process.env.AI_BASE_URL && process.env.AI_API_KEY),
    models: FIXO_MODELS,
    tasks: ["fast", "general", "reasoning", "character"],
  });
}

export async function POST(request: Request) {
  const baseUrl = process.env.AI_BASE_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.AI_API_KEY?.trim();

  if (!baseUrl || !apiKey) {
    return NextResponse.json(
      { error: "Fixo AI is not configured. Set AI_BASE_URL and AI_API_KEY in the server environment." },
      { status: 503 },
    );
  }

  let body: { messages?: ChatMessage[]; model?: string; task?: FixoTask };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const allowedTasks: FixoTask[] = ["fast", "general", "reasoning", "character"];
  const task: FixoTask = allowedTasks.includes(body.task as FixoTask) ? body.task as FixoTask : "general";
  const messages = body.messages;

  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 30 ||
      messages.some((m) => !m || !["user", "assistant"].includes(m.role) ||
        typeof m.content !== "string" || !m.content.trim() || m.content.length > 12000)) {
    return NextResponse.json({ error: "Provide 1–30 valid user/assistant messages." }, { status: 400 });
  }

  const requestedModel = isFixoModelId(body.model) ? body.model : undefined;
  const models = candidates(task, requestedModel);
  const safeMessages = [
    { role: "system", content: FINANCE_SYSTEM_PROMPT },
    ...messages.map((m) => ({ role: m.role, content: m.content.trim() })),
  ];

  let lastStatus = 502;
  for (const model of models) {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: safeMessages, temperature: 0.3, stream: false }),
        signal: AbortSignal.timeout(45000),
        cache: "no-store",
      });
    } catch {
      lastStatus = 502;
      continue;
    }

    if (!response.ok) {
      lastStatus = response.status;
      // Configuration/model errors are not improved by trying every model.
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        const detail = await response.text().catch(() => "");
        return NextResponse.json({
          error: response.status === 401 || response.status === 403
            ? "The AI gateway rejected the credentials or access."
            : "The AI gateway rejected the request or model ID.",
          model,
          detail: detail.slice(0, 500),
        }, { status: response.status });
      }
      if (response.status !== 429 && response.status < 500) {
        const detail = await response.text().catch(() => "");
        return NextResponse.json({ error: "AI gateway request failed.", model, detail: detail.slice(0, 500) }, { status: response.status });
      }
      continue;
    }

    let payload: { choices?: { message?: { content?: string | Array<{ text?: string }> } }[] };
    try {
      payload = await response.json();
    } catch {
      lastStatus = 502;
      continue;
    }
    const content = payload.choices?.[0]?.message?.content;
    const answer = typeof content === "string"
      ? content
      : Array.isArray(content) ? content.map((part) => part.text ?? "").join("") : "";
    if (!answer.trim()) {
      lastStatus = 502;
      continue;
    }
    return NextResponse.json({ answer, model, task, fallbackUsed: model !== (requestedModel ?? FALLBACKS[task][0]) });
  }

  return NextResponse.json({
    error: "All eligible Fixo AI models failed. Check model access, provider availability, and rate limits.",
    tried: models,
  }, { status: lastStatus >= 400 && lastStatus <= 599 ? lastStatus : 502 });
}
