import { type Dialogue, type Line } from '../data/dialogue.ts';
import type { TourNode, World } from '../data/world.ts';

export type Turn = {
  lines: Line[];
  choices: { id: string; label: string }[];
  freeText: boolean;
  ended?: boolean;
};

export type DialogueContext = {
  world: World;
  node: TourNode;
  characterName: string;
  dialogue: Dialogue;
};

export interface DialogueProvider {
  start(ctx: DialogueContext): Promise<Turn>;
  choose(ctx: DialogueContext, choiceId: string): Promise<Turn>;
  say(ctx: DialogueContext, text: string): Promise<Turn>;
}

const BYE = 'bye';

function menu(dialogue: Dialogue, freeText: boolean): Turn['choices'] {
  return [...dialogue.choices.map((c) => ({ id: c.id, label: c.label })), { id: BYE, label: freeText ? 'また来るね' : 'さようなら' }];
}

export class ScriptedProvider implements DialogueProvider {
  async start({ dialogue }: DialogueContext): Promise<Turn> {
    return { lines: dialogue.opening, choices: menu(dialogue, false), freeText: false };
  }

  async choose({ dialogue }: DialogueContext, choiceId: string): Promise<Turn> {
    if (choiceId === BYE) return { lines: dialogue.farewell, choices: [], freeText: false, ended: true };
    const choice = dialogue.choices.find((c) => c.id === choiceId);
    return { lines: choice?.lines ?? [], choices: menu(dialogue, false), freeText: false };
  }

  async say(ctx: DialogueContext): Promise<Turn> {
    return this.start(ctx);
  }
}

const COMPASS = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];

function whereIs(world: World, from: TourNode, to: TourNode): string {
  const a = world.survey?.[from.id];
  const b = world.survey?.[to.id];
  if (!a || !b) return to.name;
  const dx = b.at.e - a.at.e;
  const dy = b.at.n - a.at.n;
  const bearing = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  const metres = Math.round(Math.hypot(dx, dy));
  return `${to.name}(${COMPASS[Math.round(bearing / 45) % 8]}へ約${metres}m)`;
}

export function placeKnowledge(world: World, node: TourNode): string {
  const parts = [`いま二人がいる場所: ${node.caption}。`];
  const scene = world.scenes?.[node.id];
  if (scene) {
    if (scene.subject) parts.push(`この場所: ${scene.subject}.`);
    if (scene.scene) parts.push(scene.scene);
    if (scene.bearings) {
      parts.push(
        `周りの様子(英語のメモ): ahead=${scene.bearings.ahead}; right=${scene.bearings.right}; behind=${scene.bearings.behind}; left=${scene.bearings.left}.`,
      );
    }
  }
  const links = node.links
    .map((l) => world.nodes.find((n) => n.id === l.nodeId))
    .filter((n): n is TourNode => Boolean(n))
    .map((n) => whereIs(world, node, n));
  if (links.length) parts.push(`ここから歩いて行ける場所: ${links.join('、')}。`);
  return parts.join('\n');
}

export function systemPrompt(ctx: DialogueContext): string {
  return [
    `あなたは「${ctx.characterName}」というキャラクターとして、訪ねてきた旅人と会話します。`,
    `人物像: ${ctx.dialogue.persona}`,
    `世界: ${ctx.world.label}。`,
    placeKnowledge(ctx.world, ctx.node),
    `あなたがこれまでに旅人に言ったこと(この内容と矛盾しないこと): ${[...ctx.dialogue.opening, ...ctx.dialogue.choices.flatMap((c) => c.lines)].map((l) => l.text).join(' ')}`,
    '返答は日本語で、会話文だけを最大3文。台本のト書きや説明文は書かない。自分の名前を名乗らない。訪ねてきた人を「あなた」か「旅の人」と呼ぶ。',
  ].join('\n');
}

export class OllamaProvider implements DialogueProvider {
  private history: { role: 'user' | 'assistant'; content: string }[] = [];
  private model: string;
  private endpoint: string;

  constructor(model: string, endpoint = '/ollama/api/chat') {
    this.model = model;
    this.endpoint = endpoint;
  }

  async start({ dialogue }: DialogueContext): Promise<Turn> {
    this.history = [{ role: 'assistant', content: dialogue.opening.map((l) => l.text).join(' ') }];
    return { lines: dialogue.opening, choices: menu(dialogue, true), freeText: true };
  }

  async choose(ctx: DialogueContext, choiceId: string): Promise<Turn> {
    if (choiceId === BYE) return { lines: ctx.dialogue.farewell, choices: [], freeText: false, ended: true };
    const choice = ctx.dialogue.choices.find((c) => c.id === choiceId);
    return this.say(ctx, choice?.label ?? choiceId);
  }

  async say(ctx: DialogueContext, text: string): Promise<Turn> {
    this.history.push({ role: 'user', content: text });
    const speaker = ctx.characterName;
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          // Gemma 4 reasons before it speaks; the booth needs the speech.
          think: false,
          options: { temperature: 0.8, num_predict: 220 },
          messages: [{ role: 'system', content: systemPrompt(ctx) }, ...this.history.slice(-10)],
        }),
      });
      if (!res.ok) throw new Error(`ollama ${res.status}`);
      const data = (await res.json()) as { message?: { content?: string } };
      const reply = (data.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim() || '……';
      this.history.push({ role: 'assistant', content: reply });
      return { lines: splitLines(speaker, reply), choices: menu(ctx.dialogue, true), freeText: true };
    } catch (err) {
      return {
        lines: [{ speaker, text: `(……声が届かない。${err instanceof Error ? err.message : String(err)})` }],
        choices: menu(ctx.dialogue, true),
        freeText: true,
      };
    }
  }
}

export function splitLines(speaker: string, text: string): Line[] {
  const sentences = text
    .replace(/\r?\n+/g, ' ')
    .split(/(?<=[。！？!?])\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  const lines: Line[] = [];
  for (let i = 0; i < sentences.length; i += 2) lines.push({ speaker, text: sentences.slice(i, i + 2).join('') });
  return lines.length ? lines : [{ speaker, text }];
}

export function providerFor(model: string | null): DialogueProvider {
  return model ? new OllamaProvider(model) : new ScriptedProvider();
}
