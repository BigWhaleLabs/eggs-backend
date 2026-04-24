import { DateTime } from 'luxon'

export default function getClaimPeriodDates() {
  const now = DateTime.now().setZone('America/Los_Angeles')

  const currentWeekTuesday = now.startOf('week').plus({ days: 1, hours: 14 })

  const isPastTuesday = now > currentWeekTuesday
  const mostRecentDrawTuesday = isPastTuesday
    ? currentWeekTuesday
    : currentWeekTuesday.minus({ weeks: 1 })

  const periodStartMonday = mostRecentDrawTuesday.minus({ days: 1 })
  const nextMonday = periodStartMonday.plus({ weeks: 1 })
  const nextTuesday = nextMonday.plus({ days: 1 })

  const localZone = DateTime.local().zoneName

  return {
    regularTicketsStart: periodStartMonday.setZone(localZone).toJSDate(),
    regularTicketsEnd: nextMonday.setZone(localZone).toJSDate(),
    specialTicketsStart: nextMonday.setZone(localZone).toJSDate(),
    specialTicketsEnd: nextTuesday.setZone(localZone).toJSDate(),
  }
}
