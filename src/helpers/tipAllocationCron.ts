import calculateTipAllocation from './calculateTipAllocation'

export default async function tipAllocationCron() {
  console.log('[TIP_ALLOCATION_CRON] 🕒 Starting tip allocation cron job...')
  await calculateTipAllocation()
  console.log('[TIP_ALLOCATION_CRON] ✅ Tip allocation completed successfully')
}
