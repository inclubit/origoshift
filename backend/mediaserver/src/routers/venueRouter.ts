import { hasAtLeastSecurityLevel, VenueIdSchema } from 'schemas';
import { z } from 'zod';
import { procedure as p, moderatorP, router, isInVenueM } from '../trpc/trpc';
import Venue from '../classes/Venue';
import prismaClient from '../modules/prismaClient';
import { TRPCError } from '@trpc/server';
import type { Prisma } from 'database';
import { attachEmitter, attachFilteredEmitter } from '../trpc/trpc-utils';

export const venueRouter = router({
  createNewVenue: moderatorP.input(z.object({
    name: z.string()
  })).mutation(async ({input, ctx}) => {
    const venueId = await Venue.createNewVenue(input.name, ctx.uuid);
    return venueId;
  }),
  deleteVenue: moderatorP.input(z.object({venueId: VenueIdSchema})).mutation(async ({ctx, input}) => {
    if(Venue.venueIsLoaded({venueId: input.venueId})){
      throw new TRPCError({code: 'PRECONDITION_FAILED', message: 'Cant delete a venue when its loaded. Unload it first!'});
    }
    let where: Prisma.VenueWhereUniqueInput = {
      ownerId_uuid: {
        ownerId: ctx.uuid,
        uuid: input.venueId,
      }
    };
    if(hasAtLeastSecurityLevel(ctx.role, 'admin')){
      where = {
        uuid: input.venueId
      };
    }

    const dbResponse = await prismaClient.venue.delete({
      where
    });
    return dbResponse;
  }),
  loadVenue: moderatorP.input(z.object({uuid: z.string().uuid()})).mutation(async ({input}) => {
    const venue = await Venue.loadVenue(input.uuid);
    return venue.venueId;
  }),
  subVenueUnloaded: p.subscription(({ctx}) => {
    attachEmitter(ctx.client.venueEvents, 'venueWasUnloaded');
  }),
  listMyVenues: moderatorP.query(async ({ctx}) => {
    const dbResponse = await prismaClient.venue.findMany({
      where: {
        ownerId: ctx.uuid
      },
      select: {
        uuid: true,
        name: true,
      }
    });
    return dbResponse;
  }),
  subClientAddedOrRemoved: p.subscription(({ctx}) => {
    return attachFilteredEmitter(ctx.client.venueEvents, 'clientAddedOrRemoved', ctx.connectionId);
  }),
  listLoadedVenues: p.query(({ctx}) => {
    return Venue.getLoadedVenues();
  }),
  joinVenue: p.input(
    z.object({
      venueId: VenueIdSchema
    })
  ).mutation(({input, ctx}) => {
    console.log('request received to join venue:', input.venueId);
    ctx.client.joinVenue(input.venueId);
  }),
  leaveCurrentVenue: p.use(isInVenueM).query(({ctx}) => {
    if(!ctx.client.leaveCurrentVenue()){
      throw new TRPCError({code: 'PRECONDITION_FAILED', message: 'cant leave if not in a venue.. Duh!'});
    }
  })
});

