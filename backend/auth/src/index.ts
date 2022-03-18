import express, { json as parseJsonBody } from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { createJwt } from 'shared-modules/jwtUtils';
import { UserData } from 'shared-types/CustomTypes';
import createUserRouter from './userRoutes';
import Haikunator from 'haikunator';
import wordlist from './haikunator-wordlist';
import { extractMessageFromCatch } from 'shared-modules/utilFns';
import session from 'express-session';
import { PrismaSessionStore } from '@quixo3/prisma-session-store';
import prisma from './prismaClient';
import createApiRouter from './apiRoutes';

const haikunator = new Haikunator({
  adjectives: wordlist.adjectives,
  nouns: wordlist.nouns,
  defaults: { tokenLength: 2 }
});

// console.log('environment: ', process.env);
const devMode = process.env.DEVELOPMENT;

const app = express();


// We need to trust first proxy. Foremost to get secure cookie to function  properly
app.set('trust proxy', 1);

if(devMode){
  console.log('allowing cors for frontend');
  app.use(cors({
    origin: ['http://localhost:8080'],
    credentials: true,
  }));
}

app.use((req, res, next) => {
  return parseJsonBody()(req, res, (err) => {
    if(err){
      //There was error!!
      const msg = extractMessageFromCatch(err, 'failed to parse your shitt request!');
      res.status(400).send(`You suck!!! ${msg}`);
    } else {
      next();
    }
  });
});
// const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
//   console.log(error);
//   if(error){
//     console.error('Mega error of doom!!½½½½½', error);
//     const msg = extractMessageFromCatch(error, 'failed reeeaaal HARD!');
//     res.status(500).send(`Noooo good: ${msg}`);
//   }
//   next();
// };
// app.use(errorHandler);

if (!process.env.SESSION_KEY) {
  console.error('no session key provided!!!');
  throw new Error('no session key provided when starting api server');
}

// const userRouter = Router();

// TODO: Make sure we use nice settings for the cookie!!! These are kind of arbitrary chosen
// userRouter.use(session({
//   secret: env.SESSION_KEY,
//   cookie: {
//     httpOnly: true,
//     secure: true,
//     maxAge: 7 * 24 * 60 * 60 * 1000 // ms
//   },
//   name: 'inclubit',
//   resave: false,
//   saveUninitialized: false,
//   store: new PrismaSessionStore(prisma,
//     {
//       checkPeriod: 2 * 60 * 1000, // ms
//       dbRecordIdIsSessionId: true,
//       dbRecordIdFunction: undefined,
//     })
// }));

app.use(session({
  secret: process.env.SESSION_KEY,
  cookie: {
    httpOnly: true,
    secure: true,
    maxAge: 7 * 24 * 60 * 60 * 1000 // ms
  },
  name: 'inclubit',
  resave: false,
  saveUninitialized: false,
  store: new PrismaSessionStore(prisma,
    {
      checkPeriod: 2 * 60 * 1000, // ms
      dbRecordIdIsSessionId: true,
      dbRecordIdFunction: undefined,
    })
}),
);
const userRouter = createUserRouter(process.env);
app.use('/', userRouter);

const apiRouter = createApiRouter();
app.use('/', apiRouter);
  

app.get('/health', (req, res) => {
  res.status(200).send({
    message: 'I am Healthy! time:' + Date.now(),
  });
});

app.get('/guest-jwt', (req, res) => {
  const haikuName = haikunator.haikunate();
  const guestObject: UserData = {
    username: haikuName,
    role: 'guest',
    // allowedActions: ['*'],
    uuid: randomUUID(),
  };
  const jwt = createJwt(guestObject, 60);
  res.send(jwt);
});


const port = 3333;
app.listen(port, ()=> {
  console.log(`listening on ${port}`);
  if(process.env.DEVELOPMENT)
    console.log('Running in dev mode!!!');
});