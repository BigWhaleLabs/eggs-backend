import { Hen } from '@generated/type-graphql'
import getCurrentEmsision, {
  getEmissionFactor,
} from 'helpers/getCurrentEmission'
import type { AuthorizedContext } from 'models/Context'
import { Ctx, FieldResolver, Resolver, Root } from 'type-graphql'

@Resolver(() => Hen)
export default class HenModelResolver {
  @FieldResolver(() => Number)
  async dailyYield(@Root() hen: Hen, @Ctx() { prisma }: AuthorizedContext) {
    const currentEmission = await getCurrentEmsision(prisma)
    const emissionFactor = await getEmissionFactor(currentEmission)

    return (hen?.dailyYield || 0) * (1 - emissionFactor)
  }
}
