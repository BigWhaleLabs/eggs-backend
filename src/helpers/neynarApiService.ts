import env from './env'

const NEYNAR_BASE_URL = 'https://api.neynar.com/v2/farcaster'

const REQUESTS_PER_SECOND_LIMIT = 10
const REQUESTS_PER_MINUTE_LIMIT = 600

interface FarcasterUser {
  fid: number
  username?: string
  display_name?: string
  score: number
}

class SimpleRateLimiter {
  public requestTimestamps: number[] = []
  private readonly maxRequestsPerSecond: number
  private readonly maxRequestsPerMinute: number

  constructor(maxRequestsPerSecond: number, maxRequestsPerMinute: number) {
    this.maxRequestsPerSecond = maxRequestsPerSecond
    this.maxRequestsPerMinute = maxRequestsPerMinute
  }

  async waitForRateLimit(): Promise<void> {
    const now = Date.now()

    // Clean up old timestamps
    this.requestTimestamps = this.requestTimestamps.filter(
      (timestamp) => now - timestamp < 60000, // Keep only last minute
    )

    // Check per-minute limit
    if (this.requestTimestamps.length >= this.maxRequestsPerMinute) {
      const oldestInMinute = this.requestTimestamps[0]
      const waitTime = 60000 - (now - oldestInMinute) + 100
      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime))
      }
    }

    // Check per-second limit
    const recentRequests = this.requestTimestamps.filter(
      (timestamp) => now - timestamp < 1000,
    )

    if (recentRequests.length >= this.maxRequestsPerSecond) {
      const oldestInSecond = recentRequests[0]
      const waitTime = 1000 - (now - oldestInSecond) + 100
      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime))
      }
    }

    // Record this request
    this.requestTimestamps.push(Date.now())
  }
}

class NeynarApiService {
  private rateLimiter: SimpleRateLimiter

  constructor() {
    this.rateLimiter = new SimpleRateLimiter(
      REQUESTS_PER_SECOND_LIMIT,
      REQUESTS_PER_MINUTE_LIMIT,
    )
  }

  async makeApiCall<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T | null> {
    await this.rateLimiter.waitForRateLimit()

    try {
      const url = `${NEYNAR_BASE_URL}${endpoint}`
      const fetchOptions: RequestInit = {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'x-neynar-experimental': 'true',
          'x-api-key': env.NEYNAR_API_KEY,
          ...((options.headers as Record<string, string>) || {}),
        },
        ...options,
      }

      const response = await fetch(url, fetchOptions)

      if (response.status === 429) {
        throw new Error(
          `Rate limit exceeded: ${response.status} ${response.statusText}`,
        )
      }

      if (response.status === 404 || response.status === 400) {
        return null
      }

      if (!response.ok) {
        throw new Error(
          `Neynar API error: ${response.status} ${response.statusText} - URL: ${url}`,
        )
      }

      const data = await response.json()
      return data as T
    } catch (error) {
      console.error(`❌ Neynar API call failed: ${endpoint}`, error)
      throw error
    }
  }

  async getUsersBulk(fids: number[]): Promise<FarcasterUser[]> {
    if (fids.length === 0) return []

    const endpoint = `/user/bulk?fids=${fids.join(',')}`
    const response = await this.makeApiCall<{ users: FarcasterUser[] }>(
      endpoint,
    )

    return response?.users || []
  }

  async getUser(fid: number): Promise<FarcasterUser | null> {
    const users = await this.getUsersBulk([fid])
    return users.length > 0 ? users[0] : null
  }

  async getRateLimitStatus(): Promise<{
    maxPerSecond: number
    maxPerMinute: number
    currentRequestCount: number
  }> {
    const now = Date.now()
    const recentRequests = this.rateLimiter.requestTimestamps.filter(
      (timestamp) => now - timestamp < 60000,
    )

    return {
      maxPerSecond: REQUESTS_PER_SECOND_LIMIT,
      maxPerMinute: REQUESTS_PER_MINUTE_LIMIT,
      currentRequestCount: recentRequests.length,
    }
  }
}

export const neynarApiService = new NeynarApiService()
export default neynarApiService
