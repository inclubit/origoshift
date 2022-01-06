import uWebSockets from 'uWebSockets.js';
const { DEDICATED_COMPRESSOR_3KB } = uWebSockets;
import Client from './classes/Client';
import SocketWrapper from './classes/SocketWrapper';
import { createWorkers } from './modules/mediasoupWorkers';
import { verifyJwtToken, DecodedJwt } from 'shared-modules/jwtUtils';

const clients: Map<uWebSockets.WebSocket, Client> = new Map();
const disconnectedClients: Map<string, Client> = new Map();

createWorkers();


const app = uWebSockets.App();

app.ws('/*', {

  /* There are many common helper features */
  idleTimeout: 64,
  maxBackpressure: 1024,
  // maxPayloadLength: 512,
  compression: DEDICATED_COMPRESSOR_3KB,

  /* For brevity we skip the other events (upgrade, open, ping, pong, close) */
  message: (ws, message) => {
    /* You can do app.publish('sensors/home/temperature', '22C') kind of pub/sub as well */

    const client = clients.get(ws);
    if(client) {
      // const strMsg = textDecoder.decode(message);
      // console.log('converted message:', strMsg);
      
      // @ts-expect-error: In ooonly this specific case we want to ignore the private field (ws). But never elsewhere
      client.ws.incomingMessage(message);
      // console.log('client :>> ', client);
    }
    // console.log('isBinary:', isBinary);

    /* Here we echo the message back, using compression if available */
    // const ok = ws.send(message, isBinary, true);
    // console.log('was ok:', ok);
  },
  upgrade: (res, req, context) => {
    console.log('upgrade request received:', req);
    //TODO: authenticate received JWT token here. If nice, only then should we upgrade to websocket!
    try{
      const receivedToken = req.getQuery();

      // if(!receivedToken){
      //   res.writeStatus('403 Forbidden').end('YOU SHALL NOT PASS!!!');
      //   return;
      // }
    
      console.log('upgrade request provided this token:', receivedToken);

      const decoded = verifyJwtToken(receivedToken);
      if(typeof decoded === 'string'){
        throw Error('jwtVerify returned a string. No good!');
      }

      if(decoded){
        console.log('decoded jwt:', decoded);
        res.upgrade(
          {decoded},
          /* Spell these correctly */
          req.getHeader('sec-websocket-key'),
          req.getHeader('sec-websocket-protocol'),
          req.getHeader('sec-websocket-extensions'),
          context
        );
      }
    } catch(e){
      res.writeStatus('403 Forbidden').end('YOU SHALL NOT PASS!!!');
      return;
    }
  },
  open: (ws) => {
    const decodedJwt = ws.decoded as DecodedJwt;
    const wsWrapper = new SocketWrapper(ws);
    const idleClient = disconnectedClients.get(decodedJwt.uuid);
    let client: Client;
    if(false && idleClient){
      // disconnectedClients.delete(decodedJwt.uuid);
      // idleClient.assignSocketWrapper(wsWrapper);
      // client = idleClient;
      // console.log('socket REopened with provided data: ', decodedJwt);
    } else {
      // console.log('socket opened with provided data: ', decodedJwt);
      console.log('socket opened');
      client = new Client({ws: wsWrapper, userData: decodedJwt });
    }
    // Check so client is unique!!

    // client.userData = ws.decoded;
    clients.set(ws, client);
    console.log('client :>> ', client);
  },
  close: (ws) => {
    const client = clients.get(ws);
    if(!client){
      throw Error('a disconnecting client was not in client list! Something is astray!');
    }
    clients.delete(ws);
    if( false && client){
      // disconnectedClients.set(client.id, client);
      // setTimeout(() => {
      //   disconnectedClients.delete(client.id);
      // }, 1000 * 60 * 5);
    }
    client.onDisconnected();
    console.log('client disconnected:', client.id);
  }
  // 
  
}).get('/*', (res, _req) => {

  /* It does Http as well */
  res.writeStatus('200 OK').writeHeader('IsExample', 'Yes').end('Hello there!');
  
}).listen(9001, (listenSocket) => {

  if (listenSocket) {
    console.log('listenSocket:' ,listenSocket);
    console.log('Listening to port 9001');
  }
  
});