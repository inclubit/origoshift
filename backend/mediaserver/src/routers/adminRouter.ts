import { Log } from 'debug-level';
const log = new Log('Router:Admin');
process.env.DEBUG = 'Router:Admin*, ' + process.env.DEBUG;
log.enable(process.env.DEBUG);

import { TRPCError } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import { BaseClient, Camera, loadUserPrismaData, SenderClient, UserClient, Venue } from '../classes/InternalClasses';
import { Prisma } from 'database';
import prismaClient, { cameraIncludeStuff } from '../modules/prismaClient';
import { CameraIdSchema, hasAtLeastSecurityLevel, SenderIdSchema, VenueId, VenueIdSchema, VenueUpdateSchema, CameraUpdateSchema, CameraPortalUpdateSchema } from 'schemas';
import { attachToFilteredEvent, NotifierInputData } from '../trpc/trpc-utils';
import { z } from 'zod';
import { atLeastModeratorP, currentVenueAdminP, isUserClientM, isVenueOwnerM, procedure as p, router } from '../trpc/trpc';

export const adminRouter = router({
  subProducerCreated: atLeastModeratorP.subscription(({ctx}) => {
    return attachToFilteredEvent(ctx.client.clientEvent, 'producerCreated', ctx.connectionId);
  }),
  createNewVenue: atLeastModeratorP.use(isUserClientM).input(z.object({
    name: z.string()
  })).mutation(async ({input, ctx}) => {
    const venueId = await Venue.createNewVenue(input.name, ctx.userId);
    ctx.client.loadPrismaDataAndNotifySelf('Venue created');
    return venueId;
  }),
  updateVenue: currentVenueAdminP.input(VenueUpdateSchema).mutation(async ({input, ctx}) =>{
    await ctx.venue.update(input);
    ctx.client.loadPrismaDataAndNotifySelf('updated venue info/settings');
    ctx.venue._notifyStateUpdated('venue settings/data updated');
  }),
  deleteVenue: atLeastModeratorP.use(isUserClientM).input(z.object({venueId: VenueIdSchema})).mutation(async ({ctx, input}) => {
    const venueId = input.venueId;
    if(Venue.venueIsLoaded({venueId})){
      throw new TRPCError({code: 'PRECONDITION_FAILED', message: 'Cant delete a venue when its loaded. Unload it first!'});
    }
    if(
      !hasAtLeastSecurityLevel(ctx.role, 'admin')
      && -1 === ctx.client.ownedVenues.value.findIndex(v => v.venueId === venueId)){
      throw new TRPCError({code: 'PRECONDITION_FAILED', message: 'You are not owner or dont have high enough permission. Now Cry!'});
    }

    const deletedVenue = await Venue.deleteVenue(venueId);
    await ctx.client.loadPrismaDataAndNotifySelf('venue deleted');
    return deletedVenue.venueId;
  }),
  loadVenue: atLeastModeratorP.input(z.object({venueId: VenueIdSchema})).mutation(async ({input, ctx}) => {
    const venue = await Venue.loadVenue(input.venueId, ctx.userId);
    return {publicVenueState: venue.getPublicState(), adminOnlyVenueState: venue.getAdminOnlyState()};
  }),
  loadAndJoinVenue: atLeastModeratorP.input(z.object({venueId: VenueIdSchema})).mutation(async ({input, ctx}) => {
    const venue = await Venue.loadVenue(input.venueId, ctx.userId);
    const vState = await ctx.client.joinVenue(input.venueId);
    const adminOnlyState = venue.getAdminOnlyState();
    return {publicVenueState: vState, adminOnlyVenueState: adminOnlyState};
  }),
  listMyVenues: atLeastModeratorP.query(async ({ctx}) => {
    return ctx.client.ownedVenues.value.map(({venueId, name}) => ({venueId: venueId as VenueId, name}));
  }),
  subSenderAddedOrRemoved: p.use(isVenueOwnerM).use(isUserClientM).subscription(({ctx}) => {
    return observable<NotifierInputData<UserClient['notify']['senderAddedOrRemoved']>>((scriber) => {
      log.info(`Attaching sender added notifier for client ${ctx.username} (${ctx.clientType})`);
      ctx.client.notify.senderAddedOrRemoved = scriber.next;
      return () => ctx.client.notify.senderAddedOrRemoved = undefined;
    });
  }),
  subSomeSenderStateUpdated: atLeastModeratorP.subscription(({ctx}) => {
    log.info(`${ctx.username} (${ctx.connectionId}) started subscribing to senderState`);
    return attachToFilteredEvent(ctx.client.clientEvent, 'someClientStateUpdated', (data) => {
      if(data.clientState.connectionId === ctx.connectionId) return false;
      if(data.clientState.clientType === 'client') return false;
      return true;
    }, ({clientState, reason}) => ({senderState: clientState as ReturnType<SenderClient['getPublicState']>, reason}));
  }),
  createCamera: currentVenueAdminP.input(z.object({
    name: z.string(),
    senderId: SenderIdSchema.optional(),
  })).mutation(async ({ctx, input}) => {
    try{
      const { name, senderId } = input;
      log.info(`received request to create camera with name ${name} and senderId ${senderId}`);
      const cId = await ctx.venue.createNewCamera(name, senderId);
      ctx.venue.loadCamera(cId);
    } catch(e) {
      log.error('FAILED TO CREATE CAMERA!!!');
      log.error(e);
      if(e instanceof Prisma.PrismaClientKnownRequestError){
        if(e.code === 'P2002'){
          // log.error('Is Prisma error! prisma message: ', e.message);
          throw new TRPCError({code: 'CONFLICT', message: 'upptaget kameranamn!'});
        }
      }
      throw new TRPCError({code: 'INTERNAL_SERVER_ERROR', message: 'Kunde inte skapa kamera! okänt fel 😥'});
    }
  }),
  deleteCamera: currentVenueAdminP.input(z.object({
    cameraId: CameraIdSchema,
  })).mutation(async ({ ctx, input})=> {
    return await ctx.venue.deleteCamera(input.cameraId);
  }),
  setSenderForCamera: currentVenueAdminP.input(z.object({
    senderId: SenderIdSchema,
    cameraId: CameraIdSchema,
  })).mutation(async ({ctx, input}) => {
    return ctx.venue.setSenderForCamera(input.senderId, input.cameraId);
  }),
  updateCamera: currentVenueAdminP.input(CameraUpdateSchema).mutation(async ({ ctx, input}) => {
    const {cameraId, data, reason } = input;
    const dbResponse = await prismaClient.camera.update({
      where: {
        cameraId: input.cameraId
      },
      include: cameraIncludeStuff,
      data
    });
    
    const camera = ctx.venue.cameras.get(cameraId);
    if(!camera) return;
    camera.prismaData = dbResponse;
    const reasonForPrint = reason ?? 'unknown';
    camera._notifyStateUpdated(`camera was updated: ${reasonForPrint}`);
    ctx.venue._notifyAdminOnlyState(`camera was updated: ${reasonForPrint}`);
    
  }),
  setCameraPortal: currentVenueAdminP.input(CameraPortalUpdateSchema).mutation(async ({ctx, input}) => {
    const dbResponse = await prismaClient.camera.update({
      where: {
        cameraId: input.cameraId,
      },
      include: cameraIncludeStuff,
      data: {
        cameraPortals: {
          upsert: {
            where: {
              fromCameraId_toCameraId: {
                fromCameraId: input.cameraId,
                toCameraId: input.toCameraId,
              }
            },
            create: {
              ...input.portal,
              toCameraId: input.toCameraId
            },
            update: {
              ...input.portal
            }
          },
        }
      }
    });
    const camera = ctx.venue.cameras.get(input.cameraId);
    if(!camera) return;
    camera.prismaData = dbResponse;
    camera._notifyStateUpdated('camera portal updated');
    // ctx.venue._notifyStateUpdated('camera portal updated');
    return dbResponse;
  }),
  deleteCameraPortal: currentVenueAdminP.input(z.object({
    fromCameraId: CameraIdSchema,
    toCameraId: CameraIdSchema,
  })).mutation(async ({ctx, input}) => {
    const { fromCameraId, toCameraId } = input;
    const dbResponse = await prismaClient.camera.update({
      where: {
        cameraId: fromCameraId,
      },
      include: cameraIncludeStuff,
      data: {
        cameraPortals: {
          delete: {
            fromCameraId_toCameraId: {
              fromCameraId,
              toCameraId,
            }
          }
        }
      }
    });
    const camera = ctx.venue.cameras.get(fromCameraId);
    if(!camera) return;
    camera.prismaData = dbResponse;
    camera._notifyStateUpdated('camera portal deleted');
    return dbResponse;
  }),
  subVenueStateUpdated: atLeastModeratorP.subscription(({ctx}) => {
    log.info(`attching (admin)venueStateUpdated notifier for client: ${ctx.username} (${ctx.connectionId})`);
    return observable<NotifierInputData<BaseClient['notify']['venueStateUpdatedAdminOnly']>>((scriber) => {
      ctx.client.notify.venueStateUpdatedAdminOnly = scriber.next;
      return () => ctx.client.notify.venueStateUpdatedAdminOnly = undefined;
    });
  }),
});
