import dayjs, { type PluginFunc } from 'dayjs'

declare module 'dayjs' {
  interface Dayjs {
    // Snap down/up to the nearest `amount` of `unit`, zeroing every
    // lower unit. e.g. dayjs().floor('minute', 5) -> :00/:05…:00.000.
    // 'date'/'dates' are valid UnitTypes but not a ManipulateType.
    floor(unit: Exclude<dayjs.UnitType, 'date' | 'dates'>, amount: number): dayjs.Dayjs
    ceil(unit: Exclude<dayjs.UnitType, 'date' | 'dates'>, amount: number): dayjs.Dayjs
  }
}

type RoundUnit = Exclude<dayjs.UnitType, 'date' | 'dates'>

// dayjs ships no official "round to N units" plugin (verified against
// the current docs), so add .floor/.ceil from built-ins only, after:
// https://zenn.dev/spacemarket/articles/round_time_for_15_minute_in_dayjs
const floorPlugin: PluginFunc = (_opt, Cls) => {
  Cls.prototype.floor = function (this: dayjs.Dayjs, unit: RoundUnit, amount: number) {
    return this.subtract(this.get(unit) % amount, unit).startOf(unit)
  }
}

const ceilPlugin: PluginFunc = (_opt, Cls) => {
  Cls.prototype.ceil = function (this: dayjs.Dayjs, unit: RoundUnit, amount: number) {
    const rem = this.get(unit) % amount
    return rem === 0 ? this.startOf(unit) : this.add(amount - rem, unit).startOf(unit)
  }
}

dayjs.extend(floorPlugin)
dayjs.extend(ceilPlugin)

// The configured singleton. Self-code imports dayjs from here so the
// .floor/.ceil augmentation is always loaded, never from 'dayjs'.
export default dayjs
export type { Dayjs } from 'dayjs'
