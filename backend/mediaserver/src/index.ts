process.env.DEBUG = 'Gathering* Room* mediasoup*';

import observerLogger from './mediasoupObservers';
const printSoupStats = observerLogger();

import printClassInstances from './classInstanceObservers';
import Client from './classes/Client';
import uWebSockets from 'uWebSockets.js';
const { DEDICATED_COMPRESSOR_3KB } = uWebSockets;
import SocketWrapper from './classes/SocketWrapper';
import { createWorkers } from './modules/mediasoupWorkers';
import { verifyJwtToken } from 'shared-modules/jwtUtils';
import { extractMessageFromCatch } from 'shared-modules/utilFns';
import { JwtUserData, JwtUserDataSchema } from 'schemas';

const clients: Map<uWebSockets.WebSocket<JwtUserData>, Client> = new Map();
// const disconnectedClients: Map<string, Client> = new Map();

createWorkers();

const stdin = process.stdin;

// console.log('environment: ', process.env);

if(stdin && stdin.isTTY){
  // without this, we would only get streams once enter is pressed
  stdin.setRawMode( true );

  // resume stdin in the parent process (node app won't quit all by itself
  // unless an error or process.exit() happens)
  stdin.resume();

  // i don't want binary, do you?
  stdin.setEncoding( 'utf8' );

  // on any data into stdin
  stdin.on( 'data', function( key ){
    const asString = key.toString();
    // ctrl-c ( end of text )
    if ( asString === '\u0003' ) {
      process.exit();
    }
    if(asString === 'm'){
      printSoupStats();
    }
    if(asString === 'c'){
      printClassInstances();
    }
    // write the key to stdout all normal like
    // process.stdout.write( 'bajs' );
  });
}


const app = uWebSockets.App();

app.ws<JwtUserData>('/*', {

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
    try{
      const receivedToken = req.getQuery();

      // if(!receivedToken){
      //   res.writeStatus('403 Forbidden').end('YOU SHALL NOT PASS!!!');
      //   return;
      // }

      console.log('upgrade request provided this token:', receivedToken);

      const validJwt = verifyJwtToken(receivedToken);

      console.log('decoded jwt:', validJwt);

      //TODO: This doesnt scale... Perhaps we can use uuid for the clients map instead of ws instance. Then we can check directly against the keys active clients.
      // let alreadyLoggedIn = false;
      clients.forEach(value => {
        if(validJwt.role === 'user' && value.userData.uuid === validJwt.uuid){
          throw Error('already logged in!!!');
        }
      });

      const userDataOnly = JwtUserDataSchema.parse(validJwt);

      res.upgrade<JwtUserData>(
        userDataOnly,
        /* Spell these correctly */
        req.getHeader('sec-websocket-key'),
        req.getHeader('sec-websocket-protocol'),
        req.getHeader('sec-websocket-extensions'),
        context
      );
    } catch(e){
      const msg = extractMessageFromCatch(e, 'YOU SHALL NOT PASS');
      console.log('websocket upgrade was canceled / failed:', msg);
      res.writeStatus('403 Forbidden').end(msg, true);
      return;
    }
  },
  open: (ws) => {
    const userData = ws.getUserData();
    // const wsWrapper = new SocketWrapper(ws);
    console.log('socket opened');
    const client = new Client({ws: new SocketWrapper(ws), userData });

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


export type { AppRouter } from './server';
