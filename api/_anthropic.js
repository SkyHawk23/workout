import Anthropic from "@anthropic-ai/sdk";
import { httpError } from "./_auth.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

export const anthropic = new Anthropic({ apiKey });
export const TRAINER_MODEL = process.env.TRAINER_MODEL || "claude-sonnet-5";

export const MONTHLY_TOKEN_CAP = 400_000;

function currentMonthKey() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Throws a 429 if the member has hit this month's token cap. Callers should
// show a friendly "you've hit this month's limit" message — program
// progression itself never calls this, since it doesn't use the AI.
export async function assertUnderTokenCap(sql, userId) {
  const [profile] = await sql`select tokens_used_month, tokens_month from trainer_profiles where user_id = ${userId}`;
  const month = currentMonthKey();
  if (!profile || profile.tokens_month !== month) return { usedThisMonth: 0, month };
  if (profile.tokens_used_month >= MONTHLY_TOKEN_CAP) {
    throw httpError(429, "You've hit this month's trainer usage limit. It resets on the 1st.", "token_cap");
  }
  return { usedThisMonth: profile.tokens_used_month, month };
}

export async function recordTokenUsage(sql, userId, tokensUsed) {
  const month = currentMonthKey();
  const [profile] = await sql`select tokens_used_month, tokens_month from trainer_profiles where user_id = ${userId}`;
  const used = profile && profile.tokens_month === month ? profile.tokens_used_month + tokensUsed : tokensUsed;
  await sql`
    update trainer_profiles set tokens_used_month = ${used}, tokens_month = ${month}, updated_at = now()
    where user_id = ${userId}
  `;
}
