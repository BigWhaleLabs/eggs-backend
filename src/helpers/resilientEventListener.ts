// Utility functions for creating resilient blockchain event listeners

type EventListenerConfig = {
  name: string
  createListener: () => Promise<() => void>
  retryDelayMs?: number
  maxRetryDelayMs?: number
}

type ActiveListener = {
  unwatch: (() => void) | null
  isRecreating: boolean
}

const activeListeners = new Map<string, ActiveListener>()

function isFilterRelatedError(error: Error): boolean {
  const errorMessage = error.message?.toLowerCase() || ''
  const errorString = error.toString().toLowerCase()

  return (
    errorMessage.includes('filter not found') ||
    errorMessage.includes('-32600') ||
    errorMessage.includes('invalidrequestRpcerror') ||
    errorString.includes('filter not found') ||
    errorString.includes('-32600') ||
    errorString.includes('invalidrequestRpcerror')
  )
}

export function createResilientEventListener(
  config: EventListenerConfig,
): Promise<() => void> {
  const {
    name,
    createListener,
    retryDelayMs = 5000,
    maxRetryDelayMs = 60000,
  } = config
  let currentRetryDelay = retryDelayMs

  async function startListener(): Promise<() => void> {
    let listener = activeListeners.get(name)

    if (!listener) {
      listener = { unwatch: null, isRecreating: false }
      activeListeners.set(name, listener)
    }

    try {
      console.log(`[${name}] Starting event listener...`)

      const unwatch = await createListener()
      listener.unwatch = unwatch
      listener.isRecreating = false

      // Reset retry delay on successful connection
      currentRetryDelay = retryDelayMs

      console.log(`[${name}] Event listener started successfully`)

      return () => {
        if (listener?.unwatch) {
          try {
            listener.unwatch()
            listener.unwatch = null
          } catch (e) {
            console.error(`[${name}] Error stopping listener:`, e)
          }
        }
        activeListeners.delete(name)
      }
    } catch (error) {
      console.error(`[${name}] Error starting listener:`, error)

      // Exponential backoff with jitter
      const jitter = Math.random() * 1000
      const delay = Math.min(currentRetryDelay + jitter, maxRetryDelayMs)
      currentRetryDelay = Math.min(currentRetryDelay * 2, maxRetryDelayMs)

      console.log(`[${name}] Retrying in ${Math.round(delay)}ms...`)

      return new Promise((resolve) => {
        setTimeout(async () => {
          try {
            const unwatch = await startListener()
            resolve(unwatch)
          } catch (e) {
            console.error(`[${name}] Failed to start listener on retry:`, e)
            // Return a no-op function if we can't start
            resolve(() => {})
          }
        }, delay)
      })
    }
  }

  return startListener()
}

export function wrapEventListenerWithAutoRecreation(
  name: string,
  createListener: () => Promise<() => void>,
): () => Promise<() => void> {
  return async () => {
    const config: EventListenerConfig = {
      name,
      createListener: async () => {
        const originalUnwatch = await createListener()

        // Wrap the original listener to add error handling
        return () => {
          try {
            originalUnwatch()
          } catch (error) {
            console.error(`[${name}] Error in wrapped unwatch:`, error)
          }
        }
      },
    }

    return createResilientEventListener(config)
  }
}

export function handleEventListenerError(
  name: string,
  error: Error,
  recreateListener: () => Promise<void>,
): void {
  console.error(`[${name}] Event listener error:`, error)

  if (isFilterRelatedError(error)) {
    const listener = activeListeners.get(name)
    if (listener && !listener.isRecreating) {
      listener.isRecreating = true

      console.log(`[${name}] Filter error detected, recreating listener...`)

      // Stop the current listener
      if (listener.unwatch) {
        try {
          listener.unwatch()
          listener.unwatch = null
        } catch (e) {
          console.error(`[${name}] Error stopping old listener:`, e)
        }
      }

      // Recreate the listener with a small delay
      setTimeout(async () => {
        try {
          await recreateListener()
          console.log(`[${name}] Listener recreated successfully`)
        } catch (recreateError) {
          console.error(`[${name}] Error recreating listener:`, recreateError)
          listener.isRecreating = false

          // Try again with exponential backoff
          setTimeout(async () => {
            try {
              await recreateListener()
            } catch (e) {
              console.error(
                `[${name}] Failed to recreate listener on retry:`,
                e,
              )
              listener.isRecreating = false
            }
          }, 10000)
        }
      }, 1)
    }
  }
}
