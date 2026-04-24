import env from 'helpers/env'

export default async function reportToDiscord(message: string) {
  try {
    const response = await fetch(env.DISCORD_WEBHOOK_URL, {
      body: JSON.stringify({
        content: `[$eggs]: ${message}`,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })
    if (!response.ok) {
      throw new Error(`Discord API responded with status ${response.status}`)
    }
    return response
  } catch (error) {
    console.error(
      'Error sending message to Discord:',
      error instanceof Error ? error.message : error,
    )
  }
}
