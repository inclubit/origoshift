import { randomUUID } from 'crypto';
import { RoomState } from 'shared-types/CustomTypes';
import { createMessage } from 'shared-types/MessageTypes';
import mediasoupConfig from '../mediasoupConfig';
import { getMediasoupWorker } from '../modules/mediasoupWorkers';
// import Client from './Client';
import {types as soup} from 'mediasoup';

import Room from './Room';
import Client from './Client';


export default class Gathering {
  // First some static stuff for global housekeeping
  private static gatherings: Map<string, Gathering> = new Map();


  static async createGathering(id?: string, name?: string, worker?: soup.Worker) {
    try {
      const routerOptions: soup.RouterOptions = {};
      if(mediasoupConfig.router.mediaCodecs){
        routerOptions.mediaCodecs = mediasoupConfig.router.mediaCodecs;
      }
      if(!worker){
        worker = getMediasoupWorker();
      }
      const router = await worker.createRouter(routerOptions);
      const gathering = new Gathering(id, name, router);
      return gathering;
    } catch (e) {
      console.error('failed to create gathering');
      throw e;       
    }
  }

  static getGathering(id: string) {
    const gathering = Gathering.gatherings.get(id);
    if(!gathering){
      console.warn('a gathering with that id doesnt exist');
      return;
    }
    return gathering;
  }


  id: string;
  name;
  router: soup.Router;

  private rooms: Map<string, Room> = new Map();
  private clients: Map<string, Client> = new Map();

  private constructor(id = randomUUID(), name = 'unnamed', router: soup.Router){
    this.id = id;
    this.name = name;
    this.router = router;

    const alreadyExistingGathering = Gathering.gatherings.get(this.id);
    if(alreadyExistingGathering){
      console.error('already exists a gathering with that id!');
      throw new Error('cant create gathering with already taken id');
      // return;
    }

    Gathering.gatherings.set(this.id, this);
  }

  joinGathering( client : Client){
    this.clients.set(client.id, client);
  }

  leaveGathering (client: Client) {
    this.clients.delete(client.id);
  }

  getRtpCapabilities(): soup.RtpCapabilities {
    return this.router.rtpCapabilities;
  }

  addRoom(room:Room){
    this.rooms.set(room.id, room);
    this.broadCastRooms();
  }

  broadCastRooms() {
    const rooms = this.getRoomsInGathering();
    // console.log(`gonna broadcast to ${Object.keys(rooms).length} rooms`);

    // this.rooms.forEach((room) => {
    //   console.log(`room has ${room.clients.size} clients`);
    this.clients.forEach((client) => {
      const gatheringRoomsMsg = createMessage('gatheringRooms', rooms);
      // console.log(`gonna send gatheringRoomsMsg to client ${client.nickName}`, gatheringRoomsMsg);
      client.send(gatheringRoomsMsg);
    });
    // });
  }

  removeRoom(roomOrId: Room | string){
    if(typeof roomOrId === 'string'){
      this.rooms.delete(roomOrId);
      return;
    }
    this.rooms.delete(roomOrId.id);
  }

  getRoomsInGathering() {
    // const rooms: { roomId: string; clients: string[] }[] = [];
    const rooms: Record<string, RoomState> = {};
    this.rooms.forEach((room) => {
      // const clients: RoomState['clients'] = {};
      // room.clients.forEach((client, clientId) => {
      //   const producers: string [] = [];
      //   client.producers.forEach((producer, producerId) => {
      //     producers.push(producerId);
      //   });
      //   clients[clientId] = { clientId, producers};
      // });

      // const roomInfo: RoomState = {
      //   roomId: room.id,
      //   clients: clients,
      // };
      const roomstate = room.getRoomState();
      rooms[roomstate.roomId] = roomstate;
      // rooms.push(roomstate);
    });
    return rooms;
  }

  getRoom(id: string) {
    const foundRoom = this.rooms.get(id);
    if(!foundRoom){
      console.warn('the gathering doesnt have a room with that id');
      return;
    }
    return foundRoom;
    
  }
}