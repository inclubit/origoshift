import { PrismaClient, Prisma } from '@prisma/client';
import { UserData, UserRole } from 'shared-types/CustomTypes';

const prisma = new PrismaClient();


export function exclude<User, Key extends keyof User>(
  user: User,
  ...keys: Key[]
): Omit<User, Key> {
  for (const key of keys) {
    delete user[key];
  }
  return user;
}

type Includes = {
  [Property in keyof Pick<Required<Prisma.UserInclude>, 'gathering' | 'role' | 'rooms'>]: true
}
const includes: Includes = {
  gathering: true,
  rooms: true,
  role: true,
};

const userWithIncludes = Prisma.validator<Prisma.UserArgs>()({
  include: includes
});

type UserWithIncludes = Prisma.UserGetPayload<typeof userWithIncludes>
type UserQueryWithIncludes = Prisma.UserFindUniqueArgs & {include: typeof includes };

export const users = Object.assign(prisma.user, {

  userResponseToUserData(user: UserWithIncludes){

    // TODO: Probably should define allowedactions for different models elsewhere!
    // const clientActions: AllowedAction[] = ['setRtpCapabilities', 'setName', 'getRouterRtpCapabilities', 'joinGathering', 'joinRoom', 'leaveGathering', 'leaveRoom', 'notifyCloseEvent', 'notifyPauseResume', 'createReceiveTransport', 'connectTransport', 'createConsumer', 'findGatheringByName'];
    // const adminActions: AllowedAction[] = ['*', ...clientActions];

    // const allowedActions = user.role?.role == 'admin' ? adminActions : clientActions;

    const rooms = user.rooms.map(room => {
      return room.name;
    });

    return {
      username: user.username,
      role: user.role?.role as UserRole,
      uuid: user.uuid,
      gathering: user.gathering?.name,
      allowedRooms: rooms,
      // allowedActions: allowedActions,
    };
  },
  
  async findUserAsUserData(query: Prisma.UserFindUniqueArgs): Promise<UserData> {
    // const includes: Includes = {gathering: true, role: true, rooms: true};
    const userFind: UserQueryWithIncludes = {...query, include: includes};
    const foundUser = await prisma.user.findUnique<UserQueryWithIncludes>(userFind );
    // const foundUser = await prisma.user.findUnique({where:{username: 'admin'}, include: { role: true, gathering: true, rooms: true}});

    if (!foundUser) {
      throw new Error('no user with that username found');
    }


    return this.userResponseToUserData(foundUser);
  }
});

export default prisma;

export { Prisma };
