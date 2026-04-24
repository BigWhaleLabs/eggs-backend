import {
  type SendNotificationRequest,
  sendNotificationResponseSchema,
} from '@farcaster/frame-node'
import prismaClient from 'helpers/prismaClient'

export default async function sendFarcasterNotification({
  url,
  token,
  title,
  body,
  targetUrl,
}: {
  url: string
  token: string | string[]
  title: string
  body: string
  targetUrl: string
}) {
  try {
    const response = await fetch(url, {
      body: JSON.stringify({
        body,
        notificationId: crypto.randomUUID(),
        targetUrl,
        title,
        tokens: Array.isArray(token) ? token : [token],
      } satisfies SendNotificationRequest),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })

    const responseJson = await response.json()

    if (response.status === 200) {
      // Ensure correct response
      const responseBody =
        sendNotificationResponseSchema.safeParse(responseJson)
      if (!responseBody.success) {
        throw new Error(
          `Invalid response body for sendNotification: ${responseBody.error.errors}`,
        )
      }
      // Fail when rate limited
      if (responseBody.data.result.rateLimitedTokens.length) {
        throw new Error(
          `Rate limited tokens: ${responseBody.data.result.rateLimitedTokens}`,
        )
      }
      // Remove invalid tokens
      if (responseBody.data.result.invalidTokens.length) {
        console.log(`Invalid tokens: ${responseBody.data.result.invalidTokens}`)
        await prismaClient.farcasterNotificationToken.deleteMany({
          where: {
            token: {
              in: responseBody.data.result.invalidTokens,
            },
          },
        })
      }
    } else {
      throw new Error(
        `Failed to send notification: ${response.status} ${
          responseJson ? JSON.stringify(responseJson) : ''
        }`,
      )
    }
  } catch (error) {
    console.error(
      'Failed to send notification to Farcaster:',
      error instanceof Error ? error.message : error,
    )
  }
}
