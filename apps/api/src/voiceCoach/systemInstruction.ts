import type { CreatorDna, LiveSessionScript } from '@creatordna/shared';
import { buildDnaContext } from '@creatordna/shared';

/**
 * The Live Voice Coach's system instruction.
 *
 * This is the whole product in one prompt: the model is told who the creator is
 * (from the DNA), what they are reading (the script), and that its only job is
 * short coaching on five named dimensions. Built as a pure function so the
 * instruction can be asserted in a test without opening a socket.
 */

/** The five dimensions the coach must comment on. Spelled out, not implied. */
export const COACH_DIMENSIONS = ['pace', 'clarity', 'filler words', 'energy', 'tone match'] as const;

/** How many words a spoken tip may run to before it stops being a tip. */
export const MAX_TIP_WORDS = 25;

export interface CoachInstructionInput {
  /** Creator uid - logged with the context, never sent to the model. */
  uid: string;
  dna: CreatorDna;
  /** The script the creator is rehearsing, one line per beat. */
  script: LiveSessionScript;
}

export interface CoachInstruction {
  system: string;
  /** The first thing said to the model, so it starts listening rather than talking. */
  openingPrompt: string;
}

/**
 * Builds the system instruction and the opening turn.
 *
 * The opening prompt matters: without an explicit "listen first" instruction the
 * model tends to greet the creator and then wait, which wastes the first ten
 * seconds of a five-minute session.
 */
export function buildCoachInstruction(input: CoachInstructionInput): CoachInstruction {
  const { uid, dna, script } = input;
  // The shared builder keeps the coach's view of the creator identical to every
  // other prompt's, and caps the token budget the same way.
  const context = buildDnaContext({ uid, dna, history: [] });
  const numbered = script.map((line, index) => `${index + 1}. ${line}`).join('\n');

  const system = `You are CreatorDNA Studio's Live Voice Coach.

You are listening to ONE creator rehearse ONE script, out loud, in real time.
You are not a conversational assistant and you are not a search engine. You do
not answer questions about the script's topic. You coach delivery.

WHAT TO COACH ON - these five, and nothing else:
${COACH_DIMENSIONS.map((dimension) => `- ${dimension}`).join('\n')}

HOW TO SPEAK:
- Tips are SHORT. At most ${MAX_TIP_WORDS} words each. This is a coach talking
  between takes, not a lecture.
- One tip at a time. Wait for the next natural break before the next one.
- Name the moment: "on the second line", "right after the pause", "that last
  sentence". The creator is reading, so they cannot look at you.
- Be specific and actionable. "Slow down" is useless; "hold the pause after
  line two for a full beat" is a tip.
- Praise what is working. If the pace is steady, say so once. A coach that only
  criticises gets ignored.
- Never read the script back to the creator. They wrote it.
- Never invent facts, numbers or claims. You are coaching delivery, not content.
- Do not talk over the creator. If they are mid-sentence, wait.

WHEN TO STAY SILENT:
- The first few seconds: let them settle and start reading.
- When they are on a roll and everything is working.
- Between every single line. Silence is a tool; use it sparingly but use it.

THE CREATOR (their Creator DNA):
${context.text}

THE SCRIPT they are reading, line by line:
${numbered}

When they finish, or when asked, give a short spoken wrap-up: one strength, one
issue, one thing to try next take.`;

  const openingPrompt =
    'I am about to read the script above, out loud, from the first line. ' +
    'Listen to the whole take and coach me on pace, clarity, filler words, ' +
    'energy and tone match. Do not speak until I have read at least the first ' +
    'two lines, then give me one short tip.';

  return { system, openingPrompt };
}
