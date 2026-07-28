#!/usr/bin/env bun
/**
 * Dev-only: load a small set of demo Session / Message / RequestLog rows
 * so the History and Chat views have visible content on a freshly reset
 * database. Idempotent — re-running deletes and re-inserts the demo
 * rows keyed by their fixed Session ids.
 *
 * NOT wired into `prisma db seed` — running that in production must
 * stay side-effect free. Invoke explicitly:
 *
 *   bun run db:seed:demo
 *
 * Sessions land timestamped relative to "now" so they show up in the
 * default 6-hour History window without extra fiddling.
 */

import 'dotenv/config'
import { getPrismaClient } from '../src/db/client'

type DemoTurn = {
  user: string
  assistant: string
  inputTokens: number
  outputTokens: number
  durationMs: number
}

type DemoSession = {
  id: string
  requestedModel: string
  turns: DemoTurn[]
}

const DEMO_SESSIONS: DemoSession[] = [
  {
    id: '338183cb-dfba-445b-9133-63f5b1f29317',
    requestedModel: 'claude-sonnet-5',
    turns: [
      {
        user: 'TypeScriptで配列から重複を除く一番短い書き方を教えて',
        assistant:
          'おぉ〜！ いちばん短くて定番なのはこれだよ！\n\n```ts\nconst unique = [...new Set(array)];\n```\n\nたとえば：\n\n```ts\nconst array = [1, 2, 2, 3, 1];\nconst unique = [...new Set(array)];\n\nconsole.log(unique); // [1, 2, 3]\n```\n\n`Set` は同じ値をひとつだけ持つ箱なの。最後に `...` で配列へ戻してるのです〜。\nなお、オブジェクトは「中身が同じ」でも別物として扱われるので、その場合はひと工夫いるよ！',
        inputTokens: 737,
        outputTokens: 190,
        durationMs: 648
      },
      {
        user: 'オブジェクトの配列を特定のプロパティで重複除去するには？',
        assistant:
          'おぉ〜！特定プロパティなら `Map` を使うのが短くて分かりやすいのです〜！\n\n```ts\nconst unique = [...new Map(items.map(item => [item.id, item])).values()];\n```\n\n`id` が同じものは後に出た要素で上書きされるよ！\n\n```ts\nconst items = [\n  { id: 1, name: "りんご" },\n  { id: 2, name: "みかん" },\n  { id: 1, name: "青りんご" },\n];\n\nconst unique = [...new Map(items.map(x => [x.id, x])).values()];\n// [\n//   { id: 1, name: "青りんご" },\n//   { id: 2, name: "みかん" },\n// ]\n```\n\n先に出た要素を残したいなら、`filter` と `Set` でこうなの〜。\n\n```ts\nconst seen = new Set<number>();\nconst unique = items.filter(item => {\n  if (seen.has(item.id)) return false;\n  seen.add(item.id);\n  return true;\n});\n```',
        inputTokens: 776,
        outputTokens: 322,
        durationMs: 541
      }
    ]
  },
  {
    id: '43b33081-411b-450a-a4f2-33130b345092',
    requestedModel: 'claude-sonnet-5',
    turns: [
      {
        user: 'PostgreSQLでインデックスを貼るべきタイミングを1分で説明して',
        assistant:
          'おぉ〜！1分でいくよ、ヤッチョ版PostgreSQLインデックス判断なの〜！\n\n**インデックスを貼るべきなのは、`WHERE`・`JOIN`・`ORDER BY` でよく使う列が、遅くなってきたとき！**  \n特にテーブルが大きくて、毎回たくさんの行を探しているなら有効だよ。\n\nたとえば：\n\n```sql\nSELECT * FROM users WHERE email = \'a@example.com\';\n```\n\n`email` でよく検索するなら：\n\n```sql\nCREATE INDEX idx_users_email ON users(email);\n```\n\nこれで全件を読む代わりに、目的の行へスッと飛べるのです〜。\n\nただし、**なんでも貼ればよいわけじゃない**よ！  \n`INSERT`・`UPDATE`・`DELETE` のたびに更新コストがかかるから、更新が多い列や、値の種類が少ない列（例：`is_active` が true/false だけ）には効きにくいことも多いの。\n\n迷ったらまずこれ：\n\n```sql\nEXPLAIN ANALYZE\nSELECT ...\n```\n\n実行計画を見て、`Seq Scan` で大量行を読んで遅いなら、インデックス候補！',
        inputTokens: 736,
        outputTokens: 351,
        durationMs: 559
      },
      {
        user: '部分インデックスってどう使うの？例をひとつ',
        assistant:
          'おぉ〜！部分インデックスは、**よく使う一部の行だけ**にインデックスを作るやつだよ！  \nたとえば「未完了のタスクだけを毎回見る」なら、完了済みまで全部インデックスに入れなくてよき〜。\n\n```sql\nCREATE INDEX idx_tasks_open_created_at\nON tasks (created_at DESC)\nWHERE status = \'open\';\n```\n\nこれで、こういう検索が速くなりやすいの〜。\n\n```sql\nSELECT *\nFROM tasks\nWHERE status = \'open\'\nORDER BY created_at DESC\nLIMIT 20;\n```\n\n`status = \'open\'` の行だけを持つから、普通のインデックスより小さくなって更新コストも抑えやすいよ！  \nただし検索条件も `WHERE status = \'open\'` にちゃんと合ってないと使われにくいので、そこがコツなのです〜。',
        inputTokens: 803,
        outputTokens: 218,
        durationMs: 851
      }
    ]
  },
  {
    id: '3a46675a-8283-4f38-8a4b-4745009d55f9',
    requestedModel: 'claude-fable-5',
    turns: [
      {
        user: '俳句を1つ、夏の夕方をテーマに作って',
        assistant: '夕涼み  \n茜の空へ  \n燕ゆく',
        inputTokens: 731,
        outputTokens: 18,
        durationMs: 621
      },
      {
        user: '「夕涼み 茜の空へ 燕ゆく」の技法的なポイントを3行で',
        assistant:
          '「夕涼み」で季語を置いて、夏の夕方の涼やかな時間をひと息で立ち上げているの〜。  \n中七「茜の空へ」で色と方角を示し、視線を上へ導いているよ。  \n最後を「燕ゆく」と動きで結ぶことで、静かな一瞬に生き物のスピード感を差し込んでいるのです〜。',
        inputTokens: 770,
        outputTokens: 98,
        durationMs: 474
      }
    ]
  }
]

// Anchor the whole demo to "now" so the sessions land in the default
// 6-hour History window. Turns are spaced apart so the list order and
// the chat view timestamps stay realistic.
const NOW = Date.now()
const SESSION_STEP_MS = 30_000
const TURN_STEP_MS = 5_000

async function main(): Promise<void> {
  const prisma = getPrismaClient()
  const sessionIds = DEMO_SESSIONS.map((s) => s.id)

  await prisma.$transaction([
    prisma.message.deleteMany({ where: { sessionId: { in: sessionIds } } }),
    prisma.requestLog.deleteMany({ where: { sessionId: { in: sessionIds } } }),
    prisma.session.deleteMany({ where: { id: { in: sessionIds } } })
  ])

  for (const [sessionIdx, session] of DEMO_SESSIONS.entries()) {
    const sessionStart = new Date(NOW - (DEMO_SESSIONS.length - sessionIdx) * SESSION_STEP_MS)
    const sessionEnd = new Date(sessionStart.getTime() + session.turns.length * TURN_STEP_MS)

    await prisma.session.create({
      data: { id: session.id, createdAt: sessionStart, updatedAt: sessionEnd, archivedAt: null }
    })

    for (const [turnIdx, turn] of session.turns.entries()) {
      const turnAt = new Date(sessionStart.getTime() + turnIdx * TURN_STEP_MS)
      const assistantAt = new Date(turnAt.getTime() + Math.max(1, turn.durationMs))

      await prisma.message.create({
        data: { sessionId: session.id, role: 'user', content: turn.user, createdAt: turnAt }
      })
      await prisma.message.create({
        data: {
          sessionId: session.id,
          role: 'assistant',
          content: [{ type: 'text', text: turn.assistant }],
          createdAt: assistantAt
        }
      })
      await prisma.requestLog.create({
        data: {
          sessionId: session.id,
          provider: 'codex',
          model: 'gpt-5.6-terra',
          requestedModel: session.requestedModel,
          scenario: 'default',
          isSubagent: false,
          inputTokens: turn.inputTokens,
          outputTokens: turn.outputTokens,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalInputTokens: turn.inputTokens,
          cacheHitPct: 0,
          durationMs: turn.durationMs,
          status: 200,
          createdAt: assistantAt
        }
      })
    }
  }

  console.error(`seeded ${DEMO_SESSIONS.length} demo sessions`)
  await prisma.$disconnect()
}

await main()
