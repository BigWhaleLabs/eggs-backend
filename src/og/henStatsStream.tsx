import { readFileSync } from 'fs'
import isFetchable from 'helpers/isFetchable'
import prismaClient from 'helpers/prismaClient'
import { cwd } from 'process'
import getSvgStream from './getSvgStream'

const backgroundImage = readFileSync(`${cwd()}/src/og/assets/henStats.png`)
export const backgroundBase64 = Buffer.from(backgroundImage).toString('base64')

async function PendingBattleOG({
  henName,
  henLevel,
  dayilyYield,
  avatar,
}: {
  henName: string
  henLevel: number
  dayilyYield: number
  avatar: string
}) {
  const isAvatarFetchable = await isFetchable(avatar)

  return (
    <div
      style={{
        background: 'red',
        display: 'flex',
        height: '100%',
        width: '100%',
      }}
    >
      <img
        src={`data:image/png;base64,${backgroundBase64}`}
        style={{
          width: '100%',
          height: '100%',
        }}
      />
      {isAvatarFetchable ? (
        <img
          src={avatar}
          style={{
            borderRadius: 130,
            width: 96,
            height: 96,
            marginLeft: 'auto',
            marginRight: 'auto',
            marginTop: 18,
            position: 'absolute',
            top: 60,
            left: 285,
            objectFit: 'cover',
            boxShadow: '0px 4px 4px 0px #000 inset',
          }}
        />
      ) : (
        <div
          style={{
            marginLeft: 'auto',
            marginRight: 'auto',
            marginTop: 18,
            position: 'absolute',
            top: 60,
            left: 285,
            borderRadius: 130,
            width: 96,
            height: 96,
            backgroundColor: '#BF0',
            boxShadow: '0px 4px 4px 0px #000 inset',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            fontSize: 48,
          }}
        >
          💀
        </div>
      )}
      {/* <div
        style={{
          width: 48,
          height: 48,
          marginLeft: 'auto',
          marginRight: 'auto',
          marginTop: 18,
          background: `url(${avatar}) lightgray 50% / cover no-repeat`,
          boxShadow: '0px 4px 4px 0px #000 inset',
        }}
      /> */}
      <div
        style={{
          top: 62,
          left: 660,
          width: 489,
          height: 291,
          paddingTop: 64,
          paddingBottom: 24,
          paddingLeft: 12,
          paddingRight: 12,
          position: 'absolute',
          borderRadius: '80px 80px 12px 12px',
          background: '#BF0',
          boxShadow: '0px 0px 8px 0px #BF0',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            top: 64,
            fontSize: 24,
          }}
        >
          MEET
        </div>
        <div
          style={{
            textTransform: 'uppercase',
            position: 'absolute',
            top: 99,
            fontSize: 84,
          }}
        >
          {henName}
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 24,
            position: 'absolute',
            top: 79 + 99,
            color: '#2A3FFF',
          }}
        >
          lvl {henLevel}
        </div>
        <div
          style={{
            height: 1,
            width: '100%',
            background: 'rgba(159, 217, 0, 0.50)',
            position: 'absolute',
            top: 213,
          }}
        />
        <div
          style={{
            top: 213,
            display: 'flex',
            flexDirection: 'row',
            position: 'absolute',
            width: '100%',
          }}
        >
          <p
            style={{
              fontSize: 44,
              color: '#333534',
              alignSelf: 'flex-end',
            }}
          >
            $EGGS yield
            <span
              style={{
                fontSize: 16,
                alignSelf: 'flex-end',
                marginBottom: 6,
              }}
            >
              /DAY
            </span>
          </p>
          <div
            style={{
              height: '2px',
              background:
                'linear-gradient(to right, rgba(var(--color-jet-rgb), 0.6) 33%, rgba(0,0,0,0) 0%)',
              backgroundSize: '12px 4px',
              backgroundPosition: 'bottom',
              backgroundRepeat: 'repeat-x',
              marginLeft: '0.25rem',
              marginRight: '0.25rem',
              display: 'flex',
              flex: 1,
              alignSelf: 'flex-end',
              marginBottom: 26,
            }}
          />
          <p
            style={{
              fontSize: 44,
              color: '#2A3FFF',
            }}
          >
            0{dayilyYield}
          </p>
        </div>
      </div>
    </div>
  )
}

export default async function henStatsStream({ henId }: { henId: string }) {
  const hen = await prismaClient.hen.findUnique({
    include: {
      user: {
        select: {
          verifications: {
            select: {
              avatar: true,
            },
          },
        },
      },
    },
    where: {
      id: henId,
    },
  })

  if (!hen) {
    throw new Error('Hen not found')
  }

  return getSvgStream(
    await PendingBattleOG({
      henName: hen.name,
      henLevel: hen.level,
      dayilyYield: hen.dailyYield,
      avatar: `${hen.user.verifications[0].avatar}`,
    }),
    1200,
    800,
  )
}
