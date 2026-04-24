import neynarApiService from './neynarApiService'

export default async function getNeynarUsers(fids: number[]) {
  return await neynarApiService.getUsersBulk(fids)
}
