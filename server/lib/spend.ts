export interface Usage {
  inputTokens: number
  outputTokens: number
}

export interface SpendMeter {
  check(): Promise<void>
  record(usage: Usage): Promise<void>
  status(): Promise<SpendStatus>
}

export interface SpendStatus {
  totalUsd: number
  todayUsd: number
  capUsd: number
  dailyCapUsd: number
  capped: boolean
}

interface KeyValueStorage {
  getItem(key: string): Promise<unknown>
  setItem(key: string, value: any): Promise<void>
}

interface Ledger {
  totalUsd: number
  days: Record<string, number>
  calls: number
}

export interface SpendOptions {
  capUsd: number
  dailyCapUsd: number
  inputPerMillion: number
  outputPerMillion: number
  key?: string
}

export class SpendCapError extends Error {}

function today() {
  return new Date().toISOString().slice(0, 10)
}

export function createSpendMeter(storage: KeyValueStorage, opts: SpendOptions): SpendMeter {
  const key = opts.key ?? 'llm-spend'
  let chain: Promise<unknown> = Promise.resolve()

  async function read(): Promise<Ledger> {
    try {
      const raw = await storage.getItem(key)
      const value = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (value && typeof value === 'object' && typeof (value as Ledger).totalUsd === 'number') return value as Ledger
    } catch {
      throw new SpendCapError('LLM spend ledger unreadable, refusing to call the LLM')
    }
    return { totalUsd: 0, days: {}, calls: 0 }
  }

  function summarize(ledger: Ledger): SpendStatus {
    const todayUsd = ledger.days[today()] ?? 0
    return {
      totalUsd: ledger.totalUsd,
      todayUsd,
      capUsd: opts.capUsd,
      dailyCapUsd: opts.dailyCapUsd,
      capped: ledger.totalUsd >= opts.capUsd || todayUsd >= opts.dailyCapUsd
    }
  }

  return {
    async check() {
      const s = summarize(await read())
      if (s.totalUsd >= s.capUsd) throw new SpendCapError(`LLM spend cap reached ($${s.totalUsd.toFixed(2)} of $${s.capUsd})`)
      if (s.todayUsd >= s.dailyCapUsd) throw new SpendCapError(`LLM daily spend cap reached ($${s.todayUsd.toFixed(2)} of $${s.dailyCapUsd})`)
    },
    async record(usage) {
      const cost = (usage.inputTokens * opts.inputPerMillion + usage.outputTokens * opts.outputPerMillion) / 1_000_000
      const next = chain.then(async () => {
        const ledger = await read()
        const day = today()
        ledger.totalUsd += cost
        ledger.days[day] = (ledger.days[day] ?? 0) + cost
        ledger.calls += 1
        await storage.setItem(key, JSON.stringify(ledger))
      })
      chain = next.catch(() => {})
      await next
    },
    async status() {
      return summarize(await read())
    }
  }
}
