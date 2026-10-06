import { Context, Schema } from 'koishi'

export const name = 'bidiao-convert'

export interface Config {
  pairs: string[][]
  ignore: string[]
  delay: number
  maxLength: number
  onceLength: number
  rate: number
  enableModel: boolean
  modelK: number
}

export const Config: Schema<Config> = Schema.object({
  pairs: Schema.array(Schema.array(Schema.string()))
    .role('table')
    .description('互为对偶的词组，每项形如 ["逼", "吊"]。')
    .default([
      ['逼', '吊'],
      ['公', '母'],
      ['苹果', '安卓'],
      ['死', '活'],
    ]),
  ignore: Schema.array(Schema.string())
    .role('table')
    .description('消息中包含任意一个关键词时，不再复读。')
    .default(['祖国']),
  delay: Schema.number()
    .description('多条消息之间的间隔（毫秒）。')
    .default(30),
  maxLength: Schema.number()
    .description('消息长度超过该值时，不回复。')
    .default(200),
  onceLength: Schema.number()
    .description('消息长度超过该值时，只发一条把全部关键词替换后的消息。')
    .default(30),
  rate: Schema.number()
    .description('概率匹配：回复概率')
    .default(0.5),
  enableModel: Schema.boolean()
    .description('启用y=e^(-kx)模型来处理回复概率与字数的关系')
    .default(false),
  modelK: Schema.number()
    .description('上文中的k值')
    .default(0.007)
})

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function apply(ctx: Context, config: Config) {
  const pairs = config.pairs.filter(
    (pair) => pair.length === 2 && pair[0] && pair[1] && pair[0] !== pair[1],
  )

  const ignore = config.ignore.filter(Boolean)

  if (!pairs.length) return

  ctx.on('message', async (session) => {
    // 防止 bot 自己的回复触发递归
    if (session.userId === session.selfId) return

    const content = session.content
    if (!content) return


    // 概率匹配，匹配所有信息，即使没有击中关键词。但最终效果的概率是一样的
    const chance = (rate: number): boolean => Math.random() < rate;
    if (config.enableModel) {
      if (!chance(Math.exp(-config.modelK * content.length))) return;
    } else {
      if (!chance(config.rate)) return
    }


    // 消息过长，跳过
    if (config.maxLength && content.length > config.maxLength) return;

    // 命中屏蔽关键词，整条跳过
    if (ignore.some((word) => content.includes(word))) return

    // 长消息：所有关键词一次性交换，只复读一条
    if (config.onceLength && content.length > config.onceLength) {
      const words = pairs.flatMap(([a, b]) => [a, b])
      const re = new RegExp(words.map(escapeRegExp).join('|'), 'g')
      const result = content.replace(re, (m) => {
        for (const [a, b] of pairs) {
          if (m === a) return b
          if (m === b) return a
        }
        return m
      })
      if (result !== content) await session.send(result)
      return
    }

    // 未超过：每个词替换一次，发多条
    const outputs: string[] = []
    for (const [a, b] of pairs) {
      for (const [from, to] of [[a, b], [b, a]]) {
        if (!content.includes(from)) continue
        const result = content.split(from).join(to)
        if (result !== content && !outputs.includes(result)) outputs.push(result)
      }
    }

    for (const text of outputs) {
      await session.send(text)
      if (config.delay) await new Promise((r) => setTimeout(r, config.delay))
    }
  })
}
