// Groq's qwen3.6-27b (and SEA-LION's Qwen models) wrap their answer in a
// <think>...</think> reasoning block before the JSON - strip defensively for
// any provider on this shape.
export function parseModelJson(content: string): unknown {
  let text = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();

  try {
    return JSON.parse(text);
  } catch {
    const braceMatch = text.match(/\{[\s\S]*\}/);
    if (braceMatch) return JSON.parse(braceMatch[0]);
    throw new Error(`Could not parse JSON from model response: ${text.slice(0, 200)}`);
  }
}
