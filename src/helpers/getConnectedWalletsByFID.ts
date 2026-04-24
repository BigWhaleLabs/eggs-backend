interface VerificationResponse {
  messages: {
    data: {
      type: string
      verificationAddAddressBody?: {
        address: string
      }
      verificationAddEthAddressBody?: {
        address: string
      }
    }
  }[]
}

interface OnChainEventsResponse {
  events: {
    type: string
    idRegisterEventBody?: {
      to: string
      eventType: string
      from: string
      recoveryAddress: string
    }
  }[]
}

export default async function getConnectedWalletsByFID(fid: number) {
  const addresses = new Set<string>()

  try {
    // Fetch verification messages
    const verificationResponse = await fetch(
      `http://52.3.147.174:3381/v1/verificationsByFid?fid=${fid}`,
    )
    const verificationData: VerificationResponse =
      await verificationResponse.json()

    verificationData.messages.forEach((message) => {
      if (message.data.type !== 'MESSAGE_TYPE_VERIFICATION_ADD_ETH_ADDRESS') {
        return
      }
      const addressBody =
        message.data.verificationAddAddressBody ||
        message.data.verificationAddEthAddressBody
      if (addressBody?.address) {
        addresses.add(addressBody.address)
      }
    })
  } catch (error) {
    console.error(
      `[getConnectedWalletsByFID] Error fetching verifications for FID ${fid}:`,
      error,
    )
  }

  try {
    // Fetch on-chain ID register events
    const onChainResponse = await fetch(
      `http://52.3.147.174:3381/v1/onChainEventsByFid?fid=${fid}&event_type=EVENT_TYPE_ID_REGISTER`,
    )
    const onChainData: OnChainEventsResponse = await onChainResponse.json()

    onChainData.events.forEach((event) => {
      if (
        event.type === 'EVENT_TYPE_ID_REGISTER' &&
        event.idRegisterEventBody?.to
      ) {
        addresses.add(event.idRegisterEventBody.to)
      }
    })
  } catch (error) {
    console.error(
      `[getConnectedWalletsByFID] Error fetching on-chain events for FID ${fid}:`,
      error,
    )
  }

  return Array.from(addresses)
}
